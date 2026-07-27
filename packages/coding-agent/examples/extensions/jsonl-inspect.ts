/**
 * JSONL Inspect Tool - stats and schema check for JSONL datasets
 *
 * Streams the file line by line (no full-file load), so it's safe on large
 * eval/fine-tune datasets. Reports row count, parse errors, key/field
 * presence across a sample (to catch schema drift), a chat-vs-raw format
 * guess, and a rough token-length estimate (chars/4, not a real tokenizer).
 *
 * Usage:
 * 1. Copy this file to ~/.athena/agent/extensions/ or your project's .athena/extensions/
 * 2. Ask: "jsonl_inspect ./data/train.jsonl"
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_PARSE_ERRORS_SHOWN = 10;
const MAX_SAMPLE_ROWS = 20;

interface ParseError {
	line: number;
	message: string;
}

/** Very rough token estimate (chars/4). Not a real tokenizer; good enough for a ballpark. */
function roughTokenEstimate(s: string): number {
	return Math.ceil(s.length / 4);
}

function guessFormat(sample: Record<string, unknown>[]): string {
	if (sample.length === 0) return "unknown (no parseable rows)";
	const first = sample[0];
	if (Array.isArray(first.messages)) return "chat (has 'messages' array)";
	if ("prompt" in first && "completion" in first) return "prompt/completion pair";
	if ("text" in first) return "plain text ('text' field)";
	if ("input" in first && "output" in first) return "input/output pair";
	return "unrecognized (custom schema)";
}

const jsonlInspectTool = defineTool({
	name: "jsonl_inspect",
	label: "JSONL Inspect",
	description:
		"Read-only stats and schema check for a JSONL file: total row count, malformed lines, field/key presence " +
		"across a sample (to catch schema drift between rows), a guess at chat vs prompt/completion vs plain-text " +
		"format, and a rough token-length estimate (character-based, not a real tokenizer). " +
		"Streams the file, so it's safe on large datasets.",
	parameters: Type.Object({
		path: Type.String({ description: "Path to the .jsonl file" }),
		sampleSize: Type.Optional(
			Type.Number({ description: `Rows to sample for schema/token stats (default ${MAX_SAMPLE_ROWS})` }),
		),
	}),

	async execute(_toolCallId, params, signal) {
		const { path, sampleSize } = params as { path: string; sampleSize?: number };
		const resolved = resolve(path);
		if (!existsSync(resolved)) throw new Error(`File not found: ${resolved}`);

		const fileSizeBytes = statSync(resolved).size;
		const limit = sampleSize ?? MAX_SAMPLE_ROWS;

		let totalLines = 0;
		let parsedRows = 0;
		const parseErrors: ParseError[] = [];
		const sample: Record<string, unknown>[] = [];
		const fieldCounts = new Map<string, number>();
		let tokenEstimateSum = 0;
		let tokenEstimateCount = 0;
		let minTokens = Number.POSITIVE_INFINITY;
		let maxTokens = 0;

		const rl = createInterface({
			input: createReadStream(resolved, { encoding: "utf-8" }),
			crlfDelay: Number.POSITIVE_INFINITY,
		});

		for await (const rawLine of rl) {
			if (signal?.aborted) {
				rl.close();
				throw new Error("aborted");
			}
			const line = rawLine.trim();
			if (!line) continue;
			totalLines++;

			let row: unknown;
			try {
				row = JSON.parse(line);
			} catch (err) {
				if (parseErrors.length < MAX_PARSE_ERRORS_SHOWN) {
					parseErrors.push({ line: totalLines, message: err instanceof Error ? err.message : String(err) });
				}
				continue;
			}
			parsedRows++;

			if (row && typeof row === "object" && !Array.isArray(row)) {
				const record = row as Record<string, unknown>;
				for (const key of Object.keys(record)) {
					fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1);
				}
				if (sample.length < limit) sample.push(record);

				const asText = JSON.stringify(record);
				const est = roughTokenEstimate(asText);
				tokenEstimateSum += est;
				tokenEstimateCount++;
				minTokens = Math.min(minTokens, est);
				maxTokens = Math.max(maxTokens, est);
			}
		}

		const lines: string[] = [];
		lines.push(`File: ${resolved}`);
		lines.push(`Size: ${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`);
		lines.push(`Rows: ${totalLines} total, ${parsedRows} parsed, ${totalLines - parsedRows} malformed`);
		lines.push(`Format guess: ${guessFormat(sample)}`);

		if (fieldCounts.size > 0) {
			lines.push("");
			lines.push("Field presence (of parsed rows):");
			const sorted = [...fieldCounts.entries()].sort((a, b) => b[1] - a[1]);
			for (const [key, count] of sorted) {
				const pct = ((count / parsedRows) * 100).toFixed(0);
				const flag = count !== parsedRows ? "  <- inconsistent across rows" : "";
				lines.push(`  ${key}: ${count}/${parsedRows} (${pct}%)${flag}`);
			}
		}

		if (tokenEstimateCount > 0) {
			lines.push("");
			lines.push(
				`Rough token estimate per row (char/4, whole-row JSON): avg ${Math.round(tokenEstimateSum / tokenEstimateCount)}, ` +
					`min ${minTokens}, max ${maxTokens}`,
			);
		}

		if (parseErrors.length > 0) {
			lines.push("");
			lines.push(`Parse errors (first ${parseErrors.length}):`);
			for (const e of parseErrors) lines.push(`  line ${e.line}: ${e.message}`);
		}

		return {
			content: [{ type: "text", text: lines.join("\n") }],
			details: {
				totalLines,
				parsedRows,
				malformed: totalLines - parsedRows,
				fields: Object.fromEntries(fieldCounts),
			},
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(jsonlInspectTool);
}
