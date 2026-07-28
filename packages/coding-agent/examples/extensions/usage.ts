/**
 * Usage & Budget Tool - token/cost reporting and a daily spend threshold
 *
 * Scans session files under ~/.athena/agent/sessions/ (every project) for assistant
 * message usage/cost, and aggregates it by day, week, all-time, a specific date, or a
 * date range. Also supports setting a daily USD threshold that triggers a one-time
 * warning notification once crossed - a soft alert, not a hard block (Athena has no
 * built-in permission system, so nothing here can stop an in-flight API call).
 *
 * Usage:
 * 1. Copy this file to ~/.athena/agent/extensions/ or your project's .athena/extensions/
 * 2. /usage [today|week|all|YYYY-MM-DD|YYYY-MM-DD..YYYY-MM-DD]  (default: today)
 * 3. /budget set <amount>   - set a daily USD threshold
 *    /budget                - show threshold and today's spend
 *    /budget clear          - remove the threshold
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

const SESSIONS_DIRNAME = "sessions";
const BUDGET_FILENAME = "budget.json";

interface UsageEntry {
	timestamp: Date;
	model: string;
	provider: string;
	cost: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
}

function sessionsDir(): string {
	return join(getAgentDir(), SESSIONS_DIRNAME);
}

/** Session filenames start with an ISO timestamp (colons dashed), e.g. "2026-07-27T09-58-...". */
function fileDateFromName(basename: string): Date | null {
	const match = basename.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
	if (!match) return null;
	const [, date, h, m, s] = match;
	const iso = `${date}T${h}:${m}:${s}Z`;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d;
}

function listSessionFiles(): string[] {
	const dir = sessionsDir();
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { recursive: true } as { recursive: true })
		.filter((f): f is string => typeof f === "string" && f.endsWith(".jsonl"))
		.map((f) => join(dir, f));
}

/**
 * Read assistant-message usage entries from session files. When `coarseRange` is given,
 * files are pre-filtered by the date embedded in their filename (with a 1-day buffer for
 * sessions that cross midnight) before being opened, so scoped queries (and especially the
 * per-turn budget check) stay cheap regardless of how much total history accumulates. Final
 * inclusion is always decided by each entry's real timestamp, not the filename.
 */
function collectUsageEntries(coarseRange?: { start: Date; end: Date }): UsageEntry[] {
	const entries: UsageEntry[] = [];
	const buffered = coarseRange
		? { start: new Date(coarseRange.start.getTime() - 86400000), end: new Date(coarseRange.end.getTime() + 86400000) }
		: undefined;

	for (const filePath of listSessionFiles()) {
		if (buffered) {
			const fileDate = fileDateFromName(filePath.split("/").pop() ?? "");
			if (fileDate && (fileDate < buffered.start || fileDate > buffered.end)) continue;
		}

		let raw: string;
		try {
			raw = readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;
			let entry: any;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
			const usage = entry.message.usage;
			if (!usage) continue;
			const timestamp = new Date(entry.timestamp);
			if (Number.isNaN(timestamp.getTime())) continue;
			entries.push({
				timestamp,
				model: entry.message.model ?? "unknown",
				provider: entry.message.provider ?? "unknown",
				cost: usage.cost?.total ?? 0,
				input: usage.input ?? 0,
				output: usage.output ?? 0,
				cacheRead: usage.cacheRead ?? 0,
				cacheWrite: usage.cacheWrite ?? 0,
				totalTokens: usage.totalTokens ?? 0,
			});
		}
	}
	return entries;
}

function startOfLocalDay(d: Date): Date {
	const copy = new Date(d);
	copy.setHours(0, 0, 0, 0);
	return copy;
}

function endOfLocalDay(d: Date): Date {
	const copy = startOfLocalDay(d);
	copy.setDate(copy.getDate() + 1);
	copy.setMilliseconds(-1);
	return copy;
}

interface Period {
	label: string;
	start: Date;
	end: Date;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RANGE_RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

/** Parse a period token from /usage or the usage_stats tool. Returns null if unrecognized. */
function resolvePeriod(token: string | undefined): Period | null {
	const now = new Date();
	const t = (token ?? "today").trim().toLowerCase();

	if (t === "today" || t === "day") {
		return { label: "today", start: startOfLocalDay(now), end: endOfLocalDay(now) };
	}
	if (t === "week") {
		const start = new Date(now.getTime() - 6 * 86400000);
		return { label: "last 7 days", start: startOfLocalDay(start), end: endOfLocalDay(now) };
	}
	if (t === "all") {
		return { label: "all time", start: new Date(0), end: endOfLocalDay(now) };
	}
	if (DATE_RE.test(t)) {
		const d = new Date(`${t}T00:00:00`);
		if (Number.isNaN(d.getTime())) return null;
		return { label: t, start: startOfLocalDay(d), end: endOfLocalDay(d) };
	}
	const rangeMatch = t.match(RANGE_RE);
	if (rangeMatch) {
		const start = new Date(`${rangeMatch[1]}T00:00:00`);
		const end = new Date(`${rangeMatch[2]}T00:00:00`);
		if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
		return { label: `${rangeMatch[1]}..${rangeMatch[2]}`, start: startOfLocalDay(start), end: endOfLocalDay(end) };
	}
	return null;
}

interface Aggregate {
	cost: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	turns: number;
	byModel: Map<string, { cost: number; totalTokens: number; turns: number }>;
}

function aggregate(entries: UsageEntry[], period: Period): Aggregate {
	const agg: Aggregate = {
		cost: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		turns: 0,
		byModel: new Map(),
	};
	for (const e of entries) {
		if (e.timestamp < period.start || e.timestamp > period.end) continue;
		agg.cost += e.cost;
		agg.input += e.input;
		agg.output += e.output;
		agg.cacheRead += e.cacheRead;
		agg.cacheWrite += e.cacheWrite;
		agg.totalTokens += e.totalTokens;
		agg.turns++;
		const key = e.model;
		const existing = agg.byModel.get(key) ?? { cost: 0, totalTokens: 0, turns: 0 };
		existing.cost += e.cost;
		existing.totalTokens += e.totalTokens;
		existing.turns++;
		agg.byModel.set(key, existing);
	}
	return agg;
}

function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatCost(n: number): string {
	return `$${n.toFixed(n < 1 ? 5 : 2)}`;
}

function formatReport(period: Period, agg: Aggregate): string {
	const lines: string[] = [];
	lines.push(`Usage for ${period.label}`);
	lines.push(`Total cost: ${formatCost(agg.cost)}`);
	lines.push(
		`Tokens: ${formatTokens(agg.totalTokens)} total (in:${formatTokens(agg.input)} out:${formatTokens(agg.output)} ` +
			`cacheR:${formatTokens(agg.cacheRead)} cacheW:${formatTokens(agg.cacheWrite)})`,
	);
	lines.push(`Assistant turns: ${agg.turns}`);

	if (agg.byModel.size > 0) {
		lines.push("");
		lines.push("By model:");
		const sorted = [...agg.byModel.entries()].sort((a, b) => b[1].cost - a[1].cost);
		for (const [model, stats] of sorted) {
			lines.push(
				`  ${model}: ${formatCost(stats.cost)} · ${formatTokens(stats.totalTokens)} tok · ${stats.turns} turns`,
			);
		}
	}
	return lines.join("\n");
}

interface Budget {
	dailyThresholdUsd: number;
}

function budgetPath(): string {
	return join(getAgentDir(), BUDGET_FILENAME);
}

function readBudget(): Budget | null {
	try {
		return JSON.parse(readFileSync(budgetPath(), "utf-8")) as Budget;
	} catch {
		return null;
	}
}

function writeBudget(budget: Budget | null): void {
	if (budget === null) {
		try {
			writeFileSync(budgetPath(), "{}");
		} catch {
			/* ignore */
		}
		return;
	}
	writeFileSync(budgetPath(), JSON.stringify(budget, null, 2));
}

function todaySpend(): number {
	const period = resolvePeriod("today")!;
	const entries = collectUsageEntries({ start: period.start, end: period.end });
	return aggregate(entries, period).cost;
}

export default function (pi: ExtensionAPI) {
	let warnedForDate: string | null = null;

	pi.registerTool(
		defineTool({
			name: "usage_stats",
			label: "Usage Stats",
			description:
				"Report your token usage and API cost, aggregated across all projects' sessions. " +
				"period: 'today' (default), 'week' (last 7 days), 'all', a specific date (YYYY-MM-DD), " +
				"or a date range (YYYY-MM-DD..YYYY-MM-DD). Read-only, no network access.",
			parameters: Type.Object({
				period: Type.Optional(
					Type.String({ description: "today | week | all | YYYY-MM-DD | YYYY-MM-DD..YYYY-MM-DD" }),
				),
			}),
			async execute(_toolCallId, params) {
				const { period: periodToken } = params as { period?: string };
				const period = resolvePeriod(periodToken);
				if (!period) {
					throw new Error(
						`Unrecognized period "${periodToken}". Use today, week, all, YYYY-MM-DD, or YYYY-MM-DD..YYYY-MM-DD.`,
					);
				}
				const entries = collectUsageEntries({ start: period.start, end: period.end });
				const agg = aggregate(entries, period);
				return {
					content: [{ type: "text", text: formatReport(period, agg) }],
					details: { cost: agg.cost, turns: agg.turns },
				};
			},
		}),
	);

	pi.registerCommand("usage", {
		description: "Show token/cost usage: /usage [today|week|all|YYYY-MM-DD|YYYY-MM-DD..YYYY-MM-DD]",
		getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
			const options = ["today", "week", "all"];
			const matches = options.filter((o) => o.startsWith(prefix.toLowerCase()));
			return matches.length > 0 ? matches.map((m) => ({ value: m, label: m })) : null;
		},
		handler: async (args, ctx) => {
			const period = resolvePeriod(args.trim() || undefined);
			if (!period) {
				ctx.ui.notify(
					`Unrecognized period "${args.trim()}". Use today, week, all, YYYY-MM-DD, or YYYY-MM-DD..YYYY-MM-DD.`,
					"error",
				);
				return;
			}
			const entries = collectUsageEntries({ start: period.start, end: period.end });
			const agg = aggregate(entries, period);
			ctx.ui.notify(formatReport(period, agg), "info");
		},
	});

	pi.registerCommand("budget", {
		description: "Manage your daily spend threshold: /budget [set <amount>|clear]",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const budget = readBudget();

			if (!trimmed) {
				const spend = todaySpend();
				if (!budget?.dailyThresholdUsd) {
					ctx.ui.notify(
						`No daily budget set. Today's spend so far: ${formatCost(spend)}.\nSet one with /budget set <amount>.`,
						"info",
					);
					return;
				}
				const pct = ((spend / budget.dailyThresholdUsd) * 100).toFixed(0);
				ctx.ui.notify(
					`Daily budget: ${formatCost(budget.dailyThresholdUsd)}\nSpent today: ${formatCost(spend)} (${pct}%)`,
					spend >= budget.dailyThresholdUsd ? "warning" : "info",
				);
				return;
			}

			if (trimmed === "clear") {
				writeBudget(null);
				ctx.ui.notify("Daily budget cleared.", "info");
				return;
			}

			const setMatch = trimmed.match(/^set\s+([\d.]+)$/i);
			if (setMatch) {
				const amount = Number.parseFloat(setMatch[1]);
				if (!Number.isFinite(amount) || amount <= 0) {
					ctx.ui.notify("Invalid amount. Usage: /budget set <amount>", "error");
					return;
				}
				writeBudget({ dailyThresholdUsd: amount });
				ctx.ui.notify(
					`Daily budget set to ${formatCost(amount)}. This is a soft warning, not a hard stop.`,
					"info",
				);
				return;
			}

			ctx.ui.notify("Usage: /budget [set <amount>|clear]", "error");
		},
	});

	// Soft warning only: Athena has no built-in permission system, so this cannot block an
	// in-flight or upcoming API call. It fires at most once per calendar day, the first time
	// the running total is seen to cross the threshold.
	pi.on("turn_end", async (_event, ctx) => {
		const budget = readBudget();
		if (!budget?.dailyThresholdUsd) return;

		const todayKey = startOfLocalDay(new Date()).toISOString();
		if (warnedForDate === todayKey) return;

		const spend = todaySpend();
		if (spend >= budget.dailyThresholdUsd) {
			warnedForDate = todayKey;
			ctx.ui.notify(
				`Daily budget exceeded: spent ${formatCost(spend)} of ${formatCost(budget.dailyThresholdUsd)} today.`,
				"warning",
			);
		}
	});
}
