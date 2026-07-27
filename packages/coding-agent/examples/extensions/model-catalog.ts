/**
 * Model Catalog Tool - query the bundled LLM model catalog
 *
 * pi-ai ships a generated catalog of ~1200 models across ~38 providers, with
 * pricing, context window, and capability metadata. This exposes it as a
 * read-only tool so the agent can answer questions like "cheapest tool-calling
 * model with at least 200k context" without leaving the session or hitting the
 * network.
 *
 * Usage:
 * 1. Copy this file to ~/.athena/agent/extensions/ or your project's .athena/extensions/
 * 2. Ask things like "which models under $1/M input have 1M context?"
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface ModelCost {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

interface CatalogModel {
	id: string;
	name?: string;
	api?: string;
	provider?: string;
	reasoning?: boolean;
	input?: string[];
	cost?: ModelCost;
	contextWindow?: number;
	maxTokens?: number;
}

/** Subpaths that hold the generated catalog, relative to a package or repo root. */
const DATA_SUBPATHS = [
	join("node_modules", "@earendil-works", "pi-ai", "dist", "providers", "data"),
	join("packages", "ai", "dist", "providers", "data"),
	join("packages", "ai", "src", "providers", "data"),
];

/** Walk up from the given dirs looking for the catalog, so this works both in the monorepo and when installed. */
function findDataDir(): string {
	const override = process.env.ATHENA_MODEL_DATA_DIR;
	if (override && existsSync(override)) return override;

	const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
	for (const start of starts) {
		let dir = resolve(start);
		while (true) {
			for (const sub of DATA_SUBPATHS) {
				const candidate = join(dir, sub);
				if (existsSync(candidate)) return candidate;
			}
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}
	throw new Error(
		"Could not locate the pi-ai model catalog. Set ATHENA_MODEL_DATA_DIR to the providers/data directory.",
	);
}

/** Shared result metadata shape, so every branch of execute() reports the same type. */
interface CatalogDetails {
	mode: "search" | "get" | "providers";
	providers?: number;
	id?: string;
	total?: number;
	shown?: number;
}

let cache: CatalogModel[] | undefined;

function loadCatalog(): CatalogModel[] {
	if (cache) return cache;
	const dir = findDataDir();
	const models: CatalogModel[] = [];
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
		const parsed = JSON.parse(readFileSync(join(dir, file), "utf-8")) as Record<string, Record<string, unknown>>;
		// Shape is { apiName: { modelId: model } }
		for (const byId of Object.values(parsed)) {
			if (!byId || typeof byId !== "object") continue;
			for (const model of Object.values(byId)) {
				if (model && typeof model === "object" && typeof (model as CatalogModel).id === "string") {
					models.push(model as CatalogModel);
				}
			}
		}
	}
	cache = models;
	return models;
}

function fmtCost(n: number | undefined): string {
	if (n === undefined) return "-";
	return n === 0 ? "free" : `$${n}`;
}

function fmtContext(n: number | undefined): string {
	if (!n) return "-";
	return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function formatTable(models: CatalogModel[]): string {
	const rows = models.map((m) => [
		m.id,
		m.provider ?? "-",
		fmtContext(m.contextWindow),
		fmtCost(m.cost?.input),
		fmtCost(m.cost?.output),
		m.reasoning ? "yes" : "no",
	]);
	const header = ["model", "provider", "ctx", "in/M", "out/M", "reasoning"];
	const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
	const line = (cells: string[]) =>
		cells
			.map((c, i) => c.padEnd(widths[i]))
			.join("  ")
			.trimEnd();
	return [line(header), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

const modelCatalogTool = defineTool({
	name: "model_catalog",
	label: "Model Catalog",
	description:
		"Query the bundled LLM model catalog (~1200 models, ~38 providers) for pricing, context window, and capabilities. " +
		"Costs are USD per million tokens. Modes: 'search' (filter and sort models), 'get' (full details for one model id), " +
		"'providers' (list providers with model counts). Data is local and offline; it reflects the catalog generated at build time.",
	parameters: Type.Object({
		mode: Type.Union([Type.Literal("search"), Type.Literal("get"), Type.Literal("providers")], {
			description: "Query mode",
		}),
		query: Type.Optional(
			Type.String({
				description: "Substring matched against model id and name. Required for 'get' (exact or partial id).",
			}),
		),
		provider: Type.Optional(
			Type.String({ description: "Restrict to a provider, e.g. 'anthropic', 'openai', 'openrouter'" }),
		),
		minContext: Type.Optional(Type.Number({ description: "Minimum context window in tokens, e.g. 200000" })),
		maxInputCost: Type.Optional(Type.Number({ description: "Maximum input cost in USD per million tokens" })),
		reasoning: Type.Optional(
			Type.Boolean({ description: "If set, only models whose reasoning support matches this" }),
		),
		vision: Type.Optional(Type.Boolean({ description: "If true, only models accepting image input" })),
		sort: Type.Optional(
			Type.Union(
				[Type.Literal("input-cost"), Type.Literal("output-cost"), Type.Literal("context"), Type.Literal("name")],
				{
					description: "Sort order. Costs ascending, context descending. Default: input-cost",
				},
			),
		),
		limit: Type.Optional(Type.Number({ description: "Max rows to return (default 25)" })),
	}),

	async execute(_toolCallId, params) {
		const p = params as {
			mode: "search" | "get" | "providers";
			query?: string;
			provider?: string;
			minContext?: number;
			maxInputCost?: number;
			reasoning?: boolean;
			vision?: boolean;
			sort?: "input-cost" | "output-cost" | "context" | "name";
			limit?: number;
		};
		const all = loadCatalog();

		if (p.mode === "providers") {
			const counts = new Map<string, number>();
			for (const m of all) counts.set(m.provider ?? "-", (counts.get(m.provider ?? "-") ?? 0) + 1);
			const text = [...counts.entries()]
				.sort((a, b) => b[1] - a[1])
				.map(([name, n]) => `${name}: ${n}`)
				.join("\n");
			const details: CatalogDetails = { mode: p.mode, providers: counts.size };
			return { content: [{ type: "text", text }], details };
		}

		if (p.mode === "get") {
			if (!p.query) throw new Error("Mode 'get' requires a query (a model id).");
			const needle = p.query.toLowerCase();
			const hit =
				all.find((m) => m.id.toLowerCase() === needle) ?? all.find((m) => m.id.toLowerCase().includes(needle));
			if (!hit) throw new Error(`No model matching "${p.query}". Try mode 'search' to browse.`);
			const details: CatalogDetails = { mode: p.mode, id: hit.id };
			return {
				content: [{ type: "text", text: JSON.stringify(hit, null, 2) }],
				details,
			};
		}

		let results = all;
		if (p.query) {
			const needle = p.query.toLowerCase();
			results = results.filter(
				(m) => m.id.toLowerCase().includes(needle) || (m.name ?? "").toLowerCase().includes(needle),
			);
		}
		if (p.provider) {
			const needle = p.provider.toLowerCase();
			results = results.filter((m) => (m.provider ?? "").toLowerCase() === needle);
		}
		if (p.minContext !== undefined) results = results.filter((m) => (m.contextWindow ?? 0) >= p.minContext!);
		if (p.maxInputCost !== undefined)
			results = results.filter((m) => m.cost?.input !== undefined && m.cost.input <= p.maxInputCost!);
		if (p.reasoning !== undefined) results = results.filter((m) => Boolean(m.reasoning) === p.reasoning);
		if (p.vision) results = results.filter((m) => (m.input ?? []).includes("image"));

		const sort = p.sort ?? "input-cost";
		const costOf = (m: CatalogModel, key: "input" | "output") => m.cost?.[key] ?? Number.POSITIVE_INFINITY;
		results = [...results].sort((a, b) => {
			if (sort === "context") return (b.contextWindow ?? 0) - (a.contextWindow ?? 0);
			if (sort === "name") return a.id.localeCompare(b.id);
			return (
				costOf(a, sort === "output-cost" ? "output" : "input") -
				costOf(b, sort === "output-cost" ? "output" : "input")
			);
		});

		const total = results.length;
		const limit = p.limit ?? 25;
		const shown = results.slice(0, limit);
		if (shown.length === 0) {
			const details: CatalogDetails = { mode: p.mode, total: 0 };
			return {
				content: [{ type: "text", text: "No models matched those filters." }],
				details,
			};
		}
		const note =
			total > shown.length ? `\n\nShowing ${shown.length} of ${total} matches.` : `\n\n${total} match(es).`;
		const details: CatalogDetails = { mode: p.mode, total, shown: shown.length };
		return {
			content: [{ type: "text", text: `${formatTable(shown)}${note}` }],
			details,
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(modelCatalogTool);
}
