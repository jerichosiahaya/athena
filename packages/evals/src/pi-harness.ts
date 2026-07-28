import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createHarness, type SimpleHarnessResult } from "vitest-evals/harness";

type EvalSession = Awaited<ReturnType<typeof createAgentSession>>["session"];

async function cleanupEvalResources(session: EvalSession | undefined, removeRoot: () => Promise<void>): Promise<void> {
	const failures: unknown[] = [];
	if (session) {
		try {
			session.dispose();
		} catch (error) {
			failures.push(error);
		}
	}
	try {
		await removeRoot();
	} catch (error) {
		failures.push(error);
	}
	if (failures.length === 1) {
		throw failures[0];
	}
	if (failures.length > 1) {
		throw new AggregateError(failures, "Pi eval session disposal and temporary directory cleanup failed.");
	}
}

function getRequiredModelSelection(): { provider: string; model: string } {
	const provider = process.env.PI_PROVIDER?.trim();
	const model = process.env.PI_MODEL?.trim();
	if (!provider || !model) {
		throw new Error("PI_PROVIDER and PI_MODEL must both be set for eval runs.");
	}
	return { provider, model };
}

async function runPiEval(input: string, signal: AbortSignal | undefined): Promise<SimpleHarnessResult<string>> {
	signal?.throwIfAborted();
	const selection = getRequiredModelSelection();
	const modelRuntime = await ModelRuntime.create();

	// Load litellm provider from models-store if available (local proxy)
	try {
		const storePath = join(getAgentDir(), "models-store.json");
		const storeContent = readFileSync(storePath, "utf-8");
		const store = JSON.parse(storeContent) as Record<
			string,
			{
				models?: Array<{
					id: string;
					name: string;
					reasoning?: boolean;
					thinkingLevelMap?: Record<string, string | null>;
					input: ("text" | "image")[];
					cost: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
					contextWindow: number;
					maxTokens: number;
					compat?: Record<string, unknown>;
					provider?: string;
					api?: string;
					baseUrl?: string;
				}>;
				baseUrl?: string;
				apiKeyFingerprint?: string;
			}
		>;
		const litellmEntry = store.litellm;
		if (litellmEntry) {
			// Register litellm as an openai-compatible provider pointing at the proxy
			const authPath = join(getAgentDir(), "auth.json");
			const authContent = readFileSync(authPath, "utf-8");
			const authStore = JSON.parse(authContent) as Record<string, { baseUrl?: string; access?: string }>;
			const litellmAuth = authStore.litellm;
			if (litellmAuth?.baseUrl && litellmEntry.models) {
				// Build model definitions from store, with api+baseUrl from the proxy config
				const proxyBaseUrl = litellmAuth.baseUrl;
				const models = litellmEntry.models.map((m) => ({
					id: m.id,
					name: m.name,
					api: (m.api || "openai-chat") as "openai-chat" | "openai-responses",
					baseUrl: proxyBaseUrl,
					reasoning: m.reasoning ?? false,
					thinkingLevelMap: m.thinkingLevelMap as Record<string, string | null> | undefined,
					input: (m.input ?? ["text"]) as ("text" | "image")[],
					cost: {
						input: m.cost?.input ?? 0,
						output: m.cost?.output ?? 0,
						cacheRead: m.cost?.cacheRead ?? 0,
						cacheWrite: m.cost?.cacheWrite ?? 0,
					},
					contextWindow: m.contextWindow ?? 128000,
					maxTokens: m.maxTokens ?? 16384,
					compat: m.compat as
						| { supportsStore?: boolean; supportsDeveloperRole?: boolean; supportsReasoningEffort?: boolean }
						| undefined,
				}));
				modelRuntime.registerProvider("litellm", {
					baseUrl: proxyBaseUrl,
					apiKey: litellmAuth.access,
					models,
				});
				// Set the API key in the runtime so auth works
				await modelRuntime.setRuntimeApiKey("litellm", litellmAuth.access!);
			}
		}
	} catch {
		// models-store not available, use defaults
	}

	await modelRuntime.refresh({ allowNetwork: false });
	signal?.throwIfAborted();

	const model = modelRuntime.getModel(selection.provider, selection.model);
	if (!model) {
		throw new Error(`Eval model not found: ${selection.provider}/${selection.model}`);
	}
	const auth = await modelRuntime.checkAuth(selection.provider);
	signal?.throwIfAborted();
	if (!auth) {
		throw new Error(`No authentication configured for eval model ${selection.provider}/${selection.model}.`);
	}

	const root = await mkdtemp(join(tmpdir(), "pi-eval-"));
	const cwd = join(root, "workspace");
	const agentDir = join(root, "agent");
	const cleanup = () => rm(root, { recursive: true, force: true });
	let createdSession: EvalSession | undefined;
	try {
		signal?.throwIfAborted();
		await Promise.all([mkdir(cwd), mkdir(agentDir)]);
		signal?.throwIfAborted();

		const settingsManager = SettingsManager.inMemory();
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await resourceLoader.reload();
		signal?.throwIfAborted();

		createdSession = (
			await createAgentSession({
				cwd,
				agentDir,
				model,
				modelRuntime,
				thinkingLevel: "off",
				noTools: "all",
				resourceLoader,
				settingsManager,
				sessionManager: SessionManager.inMemory(cwd),
			})
		).session;
		signal?.throwIfAborted();
	} catch (error) {
		try {
			await cleanupEvalResources(createdSession, cleanup);
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], "Pi eval setup failed and cleanup also failed.");
		}
		throw error;
	}
	if (!createdSession) {
		throw new Error("Pi eval session setup completed without a session.");
	}

	const session = createdSession;
	const abort = () => void session.abort();
	signal?.addEventListener("abort", abort, { once: true });
	let result: SimpleHarnessResult<string>;
	try {
		signal?.throwIfAborted();
		await session.prompt(input);
		const assistant = session.messages
			.slice()
			.reverse()
			.find((message) => message.role === "assistant");
		if (!assistant) {
			throw new Error("Pi eval did not produce an assistant message.");
		}
		if (assistant.stopReason !== "stop") {
			throw new Error(assistant.errorMessage ?? `Pi eval stopped unexpectedly: ${assistant.stopReason}`);
		}

		const output = session.getLastAssistantText();
		if (!output) {
			throw new Error("Pi eval produced an empty assistant response.");
		}

		const stats = session.getSessionStats();
		result = {
			output,
			events: [
				{ type: "message", role: "user", content: input },
				{ type: "message", role: "assistant", content: output },
			],
			usage: {
				provider: model.provider,
				model: model.id,
				inputTokens: stats.tokens.input,
				outputTokens: stats.tokens.output,
				totalTokens: stats.tokens.total,
			},
		};
	} catch (error) {
		signal?.removeEventListener("abort", abort);
		try {
			await cleanupEvalResources(session, cleanup);
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], "Pi eval run failed and cleanup also failed.");
		}
		throw error;
	}
	signal?.removeEventListener("abort", abort);
	await cleanupEvalResources(session, cleanup);
	return result;
}

export const piCodingAgentHarness = createHarness<string, string>({
	name: "pi-coding-agent",
	run: ({ input, signal }) => runPiEval(input, signal),
});
