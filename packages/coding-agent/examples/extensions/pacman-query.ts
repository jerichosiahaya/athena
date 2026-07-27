/**
 * Pacman Query Tool - Arch Linux package introspection
 *
 * Read-only wrapper around `pacman -Q` / `pacman -S` / `pacman -F` so the
 * agent can look up installed packages, search the sync repos, and find
 * which package owns a given file, without ever mutating system state.
 *
 * Usage:
 * 1. Copy this file to ~/.pi/agent/extensions/ or your project's .pi/extensions/
 * 2. Ask the agent things like "is neovim installed?" or "which package owns /usr/bin/ssh?"
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

type Mode = "info" | "search" | "owns" | "list-explicit";

const MODE_ARGS: Record<Mode, (query: string) => string[]> = {
	info: (query) => ["-Qi", query],
	search: (query) => ["-Ss", query],
	owns: (query) => ["-Qo", query],
	"list-explicit": () => ["-Qe"],
};

const pacmanQueryTool = defineTool({
	name: "pacman_query",
	label: "Pacman Query",
	description:
		"Read-only query of the Arch Linux package database via pacman. " +
		"Modes: 'info' (details of an installed package), 'search' (search sync repos by name/desc), " +
		"'owns' (which package owns a file path), 'list-explicit' (packages explicitly installed, not as a dependency).",
	parameters: Type.Object({
		mode: Type.Union(
			[Type.Literal("info"), Type.Literal("search"), Type.Literal("owns"), Type.Literal("list-explicit")],
			{
				description: "Query mode",
			},
		),
		query: Type.Optional(
			Type.String({ description: "Package name, search term, or file path (ignored for list-explicit)" }),
		),
	}),

	async execute(_toolCallId, params, signal) {
		const { mode, query } = params as { mode: Mode; query?: string };

		if (mode !== "list-explicit" && !query) {
			throw new Error(`Mode '${mode}' requires a query.`);
		}

		try {
			const args = MODE_ARGS[mode](query ?? "");
			const { stdout, stderr } = await execFileAsync("pacman", args, { signal, maxBuffer: 1024 * 1024 });
			const text = stdout.trim() || stderr.trim() || "(no output)";
			return {
				content: [{ type: "text", text }],
				details: { mode, query },
			};
		} catch (err) {
			const stderr = (err as { stderr?: string })?.stderr?.trim();
			const message = stderr || (err instanceof Error ? err.message : String(err));
			throw new Error(`pacman query failed: ${message}`);
		}
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(pacmanQueryTool);
}
