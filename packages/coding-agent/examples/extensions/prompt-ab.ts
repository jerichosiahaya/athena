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
import type { Message } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_MODELS = 6;
const CONCURRENCY = 4;
const OUTPUT_CAP = 20 * 1024;

interface RunResult {
	model: string;
	exitCode: number;
	text: string;
	stderr: string;
	usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
	latencyMs: number;
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

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "prompt_ab",
		label: "Prompt A/B",
		description:
			"Run the same prompt across multiple models in isolated, tool-less subprocesses, and compare outputs, " +
			"cost, and latency side by side. Use for picking a model, not for tasks that need file/bash access. " +
			`Max ${MAX_MODELS} models per call.`,
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

			const results = await mapWithConcurrencyLimit(models, CONCURRENCY, (model) =>
				runOneModel(prompt, model, allowTools ?? false, signal),
			);

			const sections = results.map((r) => {
				const status = r.exitCode === 0 ? "ok" : "failed";
				const cost = `$${r.usage.cost.toFixed(5)}`;
				const tokens = `in:${r.usage.input} out:${r.usage.output}`;
				const stats = `${status} · ${(r.latencyMs / 1000).toFixed(1)}s · ${cost} · ${tokens}`;
				const body = r.exitCode === 0 ? r.text || "(no output)" : r.stderr || "(no output, process failed)";
				return `### ${r.model}\n${stats}\n\n${body}`;
			});

			const totalCost = results.reduce((sum, r) => sum + r.usage.cost, 0);
			const summary = `Compared ${models.length} models. Total cost: $${totalCost.toFixed(5)}.`;

			return {
				content: [{ type: "text", text: `${summary}\n\n${sections.join("\n\n---\n\n")}` }],
				details: { results },
			};
		},
	});
}
