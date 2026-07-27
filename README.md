# Athena

A personal coding agent harness — an extensible CLI agent that reads, writes, and runs code in your terminal, with a tool system you can extend in TypeScript.

Athena is tuned for AI engineering work and for Arch Linux, and is built to stay small: the tools it ships are the ones that earn their place.

## Install

Requires Node.js >= 22.19.0.

```bash
git clone git@github.com:jerichosiahaya/athena.git
cd athena
npm install
npm run build
```

Then expose the `athena` command:

```bash
ln -sf "$PWD/packages/coding-agent/dist/cli.js" ~/.local/bin/athena
```

Make sure `~/.local/bin` is on your `PATH`.

## Usage

```bash
athena                       # start an interactive session
athena "explain this repo"   # start with a prompt
athena -p "list all TODOs"   # non-interactive, print and exit
athena -c                    # continue the previous session
athena --help                # all flags
```

Inside a session: `/` for commands, `!` to run a shell command, `/exit` or `/quit` to leave, `Ctrl+P` to cycle models.

Configuration and sessions live in `~/.athena/agent/`. Project-local resources go in `.athena/` — `skills/`, `prompts/`, `extensions/`, and `themes/` are all picked up automatically.

## Custom tools

Beyond the built-in `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`:

| Tool | What it does |
|---|---|
| **`model_catalog`** | Offline queries over the bundled catalog of ~1200 models across ~38 providers — filter by price, context window, reasoning, or vision, and sort by cost. |
| **`pacman_query`** | Read-only Arch Linux package introspection: package details, repo search, which package owns a file, and explicitly-installed packages. |

Both live in [`packages/coding-agent/examples/extensions/`](packages/coding-agent/examples/extensions). Load one for a single run with `-e`:

```bash
athena -e ./packages/coding-agent/examples/extensions/model-catalog.ts
```

Or install it permanently:

```bash
athena install ./packages/coding-agent/examples/extensions/model-catalog.ts
```

## Writing your own tool

A tool is a `defineTool` call plus a registration hook. That's the whole contract:

```ts
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const greetTool = defineTool({
	name: "greet",
	label: "Greet",
	description: "Say hello to someone",
	parameters: Type.Object({
		name: Type.String({ description: "Who to greet" }),
	}),

	async execute(_toolCallId, params) {
		return {
			content: [{ type: "text", text: `Hello, ${params.name}!` }],
			details: { greeted: params.name },
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(greetTool);
}
```

Errors are signalled by throwing, not by a flag on the result. Extensions can also register slash commands, add keybindings, hook session events, and override built-in tools — see the other files in [`examples/extensions/`](packages/coding-agent/examples/extensions).

## Packages

| Package | Description |
|---------|-------------|
| [`packages/coding-agent`](packages/coding-agent) | The interactive CLI, tools, and extension system |
| [`packages/agent`](packages/agent) | Agent runtime with tool calling and state management |
| [`packages/ai`](packages/ai) | Unified multi-provider LLM API (OpenAI, Anthropic, Google, and more) |
| [`packages/tui`](packages/tui) | Terminal UI library with differential rendering |

## Permissions

Athena has **no built-in permission system**. It runs with the full permissions of the user and process that launched it — it can read any file you can read and run any command you can run, without prompting.

If you need real boundaries, sandbox it. See [containerization.md](packages/coding-agent/docs/containerization.md) for working patterns, including a micro-VM extension and plain Docker.

## Development

```bash
npm install           # install dependencies
npm run build         # refresh model data from provider APIs, then build
npm run build:offline # rebuild from the existing model snapshot, no network
npm run check         # lint, format, and type check
./test.sh             # run tests (LLM-dependent tests skip without API keys)
```

Pre-commit hooks run lint, formatting, type checks, and lockfile consistency checks. Dependency changes are treated as reviewed code changes: direct dependencies are pinned exactly, and `.npmrc` sets `min-release-age` to avoid same-day releases. Lockfile commits require `PI_ALLOW_LOCKFILE_CHANGE=1`.

`npm run build` hits provider APIs to regenerate the model catalog. Use `build:offline` for faster, network-free rebuilds.

## License

MIT — see [LICENSE](LICENSE).

Built on [Pi](https://github.com/earendil-works/pi) by Mario Zechner, also MIT licensed.
