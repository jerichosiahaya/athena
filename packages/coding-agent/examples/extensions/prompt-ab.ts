/**
 * Prompt A/B Tool - compare one prompt across multiple models
 *
 * Spawns a separate, tool-less `athena` process per model (same technique as
 * the official subagent extension), so each response is generated in
 * isolation with no shared context. Returns outputs side by side with cost
 * and latency, so picking a model is a measurement instead of a guess.
 *
 * Usage:
 * 1. Copy this file to ~/.athena/agent/extensions/ or your project's .athena/extensions/
 * 2. Ask: "prompt_ab this across gpt-5.4-mini, deepseek-v4-flash, and kimi-k2.6: <prompt>"
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import { type ExtensionAPI, getAgentDir, type Theme } from "@earendil-works/pi-coding-agent";
import {
	type AutocompleteItem,
	type Component,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

const MAX_MODELS = 6;
const CONCURRENCY = 4;
const OUTPUT_CAP = 20 * 1024;
const MIN_COLUMN_WIDTH = 16;
const COLLAPSED_BODY_LINES = 12;
const COLUMN_GAP = " │ ";

interface RunResult {
	model: string;
	exitCode: number;
	text: string;
	stderr: string;
	usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
	latencyMs: number;
}

function padColumn(str: string, width: number): string {
	const gap = width - visibleWidth(str);
	return gap > 0 ? str + " ".repeat(gap) : str;
}

function statsLine(r: RunResult): string {
	const status = r.exitCode === 0 ? "ok" : "failed";
	const cost = `$${r.usage.cost.toFixed(5)}`;
	const tokens = `in:${r.usage.input} out:${r.usage.output}`;
	return `${status} · ${(r.latencyMs / 1000).toFixed(1)}s · ${cost} · ${tokens}`;
}

/**
 * Lay out each model's output in its own column, side by side, so differences are visible at a
 * glance without scrolling past one full response to reach the next. Columns share the viewport
 * width evenly; each model's header, stats, and body are word-wrapped to its column width and
 * padded to line up with the others, separated by a vertical divider.
 */
function buildColumnsComponent(results: RunResult[], theme: Theme, expanded: boolean): Component {
	return {
		render(width: number): string[] {
			const count = results.length;
			const gapWidth = visibleWidth(COLUMN_GAP);
			const columnWidth = Math.max(MIN_COLUMN_WIDTH, Math.floor((width - gapWidth * (count - 1)) / count));

			const columns = results.map((r) => {
				const icon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
				const header = `${icon} ${truncateToWidth(theme.bold(theme.fg("toolTitle", r.model)), columnWidth - 2)}`;
				// Stats and body both wrap to the column width (not just truncate), so narrow
				// columns don't silently cut off cost/timing info or push the divider out of
				// alignment with the header/other columns.
				const statsLines = wrapTextWithAnsi(theme.fg("dim", statsLine(r)), columnWidth);
				const bodyText = r.exitCode === 0 ? r.text || "(no output)" : r.stderr || "(no output, process failed)";
				let bodyLines = wrapTextWithAnsi(bodyText.trim(), columnWidth);
				if (!expanded && bodyLines.length > COLLAPSED_BODY_LINES) {
					bodyLines = [...bodyLines.slice(0, COLLAPSED_BODY_LINES), theme.fg("muted", "(Ctrl+O to expand)")];
				}
				const contentLines = [...statsLines, "", ...bodyLines];
				return { header, contentLines, width: columnWidth };
			});

			const rowCount = Math.max(...columns.map((c) => 1 + c.contentLines.length)); // header + rest
			const lines: string[] = [];
			for (let row = 0; row < rowCount; row++) {
				const cells = columns.map((c) => {
					const content = row === 0 ? c.header : (c.contentLines[row - 1] ?? "");
					return padColumn(content, c.width);
				});
				lines.push(cells.join(theme.fg("muted", COLUMN_GAP)));
			}
			return lines;
		},
		invalidate() {},
	};
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	return { command: "athena", args };
}

function getFinalText(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

async function runOneModel(
	prompt: string,
	model: string,
	allowTools: boolean,
	signal: AbortSignal | undefined,
): Promise<RunResult> {
	const args = ["--mode", "json", "-p", "--no-session", "--model", model];
	if (!allowTools) args.push("--no-tools");
	args.push(prompt);

	const messages: Message[] = [];
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	let stderr = "";
	const started = Date.now();

	const exitCode = await new Promise<number>((resolve) => {
		const invocation = getPiInvocation(args);
		const proc = spawn(invocation.command, invocation.args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
		let buffer = "";

		const processLine = (line: string) => {
			if (!line.trim()) return;
			let event: any;
			try {
				event = JSON.parse(line);
			} catch {
				return;
			}
			if (event.type === "message_end" && event.message) {
				const msg = event.message as Message;
				messages.push(msg);
				if (msg.role === "assistant" && msg.usage) {
					usage.input += msg.usage.input || 0;
					usage.output += msg.usage.output || 0;
					usage.cacheRead += msg.usage.cacheRead || 0;
					usage.cacheWrite += msg.usage.cacheWrite || 0;
					usage.cost += msg.usage.cost?.total || 0;
				}
			}
		};

		proc.stdout.on("data", (data) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) processLine(line);
		});
		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});
		proc.on("close", (code) => {
			if (buffer.trim()) processLine(buffer);
			resolve(code ?? 0);
		});
		proc.on("error", () => resolve(1));

		const killProc = () => proc.kill("SIGTERM");
		if (signal) {
			if (signal.aborted) killProc();
			else signal.addEventListener("abort", killProc, { once: true });
		}
	});

	let text = getFinalText(messages);
	if (Buffer.byteLength(text, "utf8") > OUTPUT_CAP) {
		text = `${text.slice(0, OUTPUT_CAP)}\n\n[truncated]`;
	}

	return { model, exitCode, text, stderr: stderr.trim(), usage, latencyMs: Date.now() - started };
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn) => Promise<TOut>,
): Promise<TOut[]> {
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const limit = Math.max(1, Math.min(concurrency, items.length));
	await Promise.all(
		new Array(limit).fill(null).map(async () => {
			while (true) {
				const current = nextIndex++;
				if (current >= items.length) return;
				results[current] = await fn(items[current]);
			}
		}),
	);
	return results;
}

/**
 * Cached "provider/id" strings for models you've actually enabled, read directly from
 * settings.json rather than the full model-registry catalog. The registry's
 * hasConfiguredAuth() is unreliable behind a shared gateway (e.g. litellm): it can report a
 * provider as "authed" even when the specific downstream model has no real credentials, which
 * surfaces as a failure only once prompt_ab actually tries to call it. Reading enabledModels
 * matches exactly what Ctrl+P cycling offers, so anything listed here is known-good.
 */
let knownModels: string[] = [];

function readEnabledModels(): string[] {
	try {
		const settingsPath = join(getAgentDir(), "settings.json");
		const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as { enabledModels?: string[] };
		return settings.enabledModels ?? [];
	} catch {
		return [];
	}
}

/**
 * Resolve a user-typed model string against the enabled-models list: exact match first, then a
 * substring match (case-insensitive), so "flash" or "deepseek" work without memorizing the full
 * "azure_ai/deepseek-v4-flash" form. Passes through unresolved input unchanged, so an explicit
 * provider/id string for a model outside the enabled list still works.
 */
function resolveModel(input: string): string {
	const needle = input.trim().toLowerCase();
	if (!needle) return input;
	if (knownModels.some((m) => m.toLowerCase() === needle)) return input;
	const partial = knownModels.filter((m) => m.toLowerCase().includes(needle));
	if (partial.length === 1) return partial[0];
	return input;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		knownModels = readEnabledModels();
	});
	pi.on("session_tree", async () => {
		knownModels = readEnabledModels();
	});

	pi.registerTool({
		name: "prompt_ab",
		label: "Prompt A/B",
		description:
			"Run the same prompt across multiple models in isolated, tool-less subprocesses, and compare outputs, " +
			"cost, and latency side by side. Use for picking a model, not for tasks that need file/bash access. " +
			"Model names are resolved fuzzily (substring match against provider/id), so a short unambiguous " +
			`fragment like "flash" or "deepseek" works without the full provider/id string. Max ${MAX_MODELS} models per call.`,
		parameters: Type.Object({
			prompt: Type.String({ description: "The prompt to send to every model" }),
			models: Type.Array(Type.String(), {
				description: "Model patterns to compare, e.g. ['azure_ai/gpt-5.4-mini', 'azure_ai/deepseek-v4-flash']",
				minItems: 2,
				maxItems: MAX_MODELS,
			}),
			allowTools: Type.Optional(
				Type.Boolean({
					description:
						"Allow each subprocess to use tools. Default false, for a fair apples-to-apples comparison.",
				}),
			),
		}),

		async execute(_toolCallId, params, signal) {
			const { prompt, models, allowTools } = params as { prompt: string; models: string[]; allowTools?: boolean };
			const resolvedModels = models.map(resolveModel);

			const results = await mapWithConcurrencyLimit(resolvedModels, CONCURRENCY, (model) =>
				runOneModel(prompt, model, allowTools ?? false, signal),
			);

			const sections = results.map((r) => {
				const body = r.exitCode === 0 ? r.text || "(no output)" : r.stderr || "(no output, process failed)";
				return `### ${r.model}\n${statsLine(r)}\n\n${body}`;
			});

			const totalCost = results.reduce((sum, r) => sum + r.usage.cost, 0);
			const summary = `Compared ${models.length} models. Total cost: $${totalCost.toFixed(5)}.`;

			return {
				content: [{ type: "text", text: `${summary}\n\n${sections.join("\n\n---\n\n")}` }],
				details: { results },
			};
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as { results: RunResult[] } | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return { render: () => [text?.type === "text" ? text.text : "(no output)"], invalidate: () => {} };
			}
			return buildColumnsComponent(details.results, theme, expanded);
		},
	});

	pi.registerCommand("ab", {
		description: "Compare a prompt across models: /ab model1,model2[,...] <prompt>",
		getArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
			if (knownModels.length === 0) return null;
			// Only offer completions while typing the comma-separated model list,
			// i.e. before the first space that starts the prompt text.
			if (argumentPrefix.includes(" ")) return null;

			const lastComma = argumentPrefix.lastIndexOf(",");
			const before = argumentPrefix.slice(0, lastComma + 1);
			const current = argumentPrefix.slice(lastComma + 1).toLowerCase();

			const matches = knownModels
				.filter((m) => m.toLowerCase().includes(current))
				.slice(0, 20)
				.map((m) => ({ value: `${before}${m}`, label: m }));

			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const firstSpace = trimmed.indexOf(" ");
			const modelsPart = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
			const prompt = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();
			const models = modelsPart
				.split(",")
				.map((m) => m.trim())
				.filter(Boolean);

			if (models.length < 2 || !prompt) {
				ctx.ui.notify("Usage: /ab model1,model2[,model3...] <prompt>", "error");
				return;
			}
			if (models.length > MAX_MODELS) {
				ctx.ui.notify(`Too many models (${models.length}). Max is ${MAX_MODELS}.`, "error");
				return;
			}

			pi.sendUserMessage(
				`Use the prompt_ab tool with these exact models: ${JSON.stringify(models)} and this exact prompt: ${JSON.stringify(prompt)}`,
			);
		},
	});
}
