# CodeViz

Deterministic TypeScript/TSX control-flow analysis with a native Neovim navigation surface. The analyzer owns semantics and source provenance. Neovim only displays the resulting `ExecutionModel`. No LLM, runtime execution, browser UI, or network service participates in analysis.

## Status

This repository implements the **V1 single-function flow-view milestone**, plus conservative call-definition resolution and Mermaid export. It is an initial static-analysis tool, not a proof that every displayed path is feasible. Sequence views, bounded recursive call expansion, ELK layout, levels of detail, and floating-node renderers remain later milestones.

## Quick start

Requirements: Node.js 22+, pnpm 10, and Neovim 0.10+ for the plugin.

```sh
pnpm install --frozen-lockfile
pnpm build
./bin/codeviz analyze fixtures/conditions/branches.ts:5:3
./bin/codeviz analyze fixtures/conditions/branches.ts:5:3 --mermaid
```

If pnpm is not installed, use `npx --yes pnpm@10.18.3` in place of `pnpm`. Run the analyzer against your actual project:

```sh
./bin/codeviz analyze /path/to/project/src/order.ts:52:10
./bin/codeviz analyze /path/to/project/src/order.ts:52:10 --tsconfig /path/to/project/tsconfig.json
```

The nearest `tsconfig.json` is loaded, including compiler options, imports, and project references. Without a config, a standalone program is created. The compiler's AST and TypeChecker are used directly rather than adding a convenience wrapper. Each request reloads the program so changes on disk are visible. This favors correctness over large-project latency in V1.

Coordinates are **one-based UTF-16 columns**, with exclusive end positions. Syntax-invalid files and invalid cursor positions return errors rather than misleading graphs. The innermost implemented function is selected, including arrows, methods, accessors, and constructors.

## Neovim setup

Add this repository's `nvim/` directory to your runtime path, then configure the plugin in `init.lua`:

```lua
vim.opt.runtimepath:prepend('/absolute/path/to/codeviz/nvim')
require('codeviz').setup({
  keymap = '<leader>vf',
  timeout = 10000,
  -- Optional: use an explicitly built analyzer from another location.
  -- command = { 'node', '/absolute/path/to/codeviz/dist/cli/index.js', 'serve' },
  -- tsconfig = '/absolute/path/to/project/tsconfig.json',
})
```

Restart Neovim after adding the runtime path, or run `:runtime plugin/codeviz.lua`. Open a named TypeScript/TSX source buffer, place the cursor inside a function, and run `:CodeVizFlow` or `<leader>vf`. A vertical `nofile` split shows semantic node cards with labeled outgoing edges and destination IDs. This intentionally simple V1 renderer is a graph adjacency surface, not yet a spatial node-layout canvas.

| Key | Action |
| --- | --- |
| `Enter` | Jump to the exact source range start |
| `Tab` / `Shift-Tab` | Next / previous graph node |
| `gd` | Jump to a resolved call definition |
| `gr` | Jump to source and request LSP references, if an LSP is attached |
| `K` | Show AST kind, provenance, limitations, and call-resolution details |
| `r` | Reanalyze the source buffer, including unsaved edits |
| `q` | Close the graph and stop its analyzer process |

Moving through source code highlights the smallest corresponding non-synthetic graph node. The plugin translates UTF-16 positions into Neovim byte offsets, including non-BMP characters. Unsaved source contents are sent as an in-memory override; analysis never writes source files. Other project files are read from disk. Graph navigation is refused after the source changes until `r` refreshes it, and responses for obsolete snapshots are discarded.

`:CodeVizExportMermaid` opens an export buffer. `:CodeVizExportMermaid path.mmd` writes a new file without overwriting an existing file. Both use the analyzer's same model and deterministic exporter. You may also export directly from a source buffer without first opening a graph.

## Execution model

The public schema lives in `packages/core/model.ts`:

```ts
interface ExecutionModel {
  schemaVersion: 1;
  entryFunction: FunctionInfo;
  entryNodeId: string;
  exitNodeId: string;
  nodes: ExecutionNode[];
  edges: ExecutionEdge[];
  calls: CallSite[];
  diagnostics: AnalysisDiagnostic[];
}
```

Every node includes an AST kind and exact source range. Basic blocks preserve their constituent statement ranges. Entry, exit, loop backedge connectors, and completion-routing nodes are marked synthetic. IDs and traversal order are deterministic for identical project contents and requests, but are not persistent identities across edits. The call-site array follows graph traversal order, not a promised total runtime order across branches; **edges are the authority for ordering**.

### Implemented control flow

- Sequential ordinary statements grouped into basic blocks.
- `if/else`, conditional expressions, and `&&`, `||`, `??` short-circuit evaluation.
- Early returns, explicit throws, and dead-code pruning after abrupt completion.
- `switch` case-test order, middle/default clauses, fallthrough, and breaks.
- `for`, `for...of`, `for...in`, `while`, and `do...while`, with nearest-loop break/continue targets and explicit backedges.
- `try/catch/finally`, with separate normal, return, throw, break, and continue continuations. Finalizers can override a pending completion. Finalizer nodes are duplicated per continuation when necessary so unrelated completion paths do not merge incorrectly.
- Call/new-expression evaluation order, including nested arguments.
- `await` continuation points. Async runtime scheduling and callback execution are not inferred.

### Trust boundaries and limitations

- This is a syntactic, intraprocedural CFG, not value-range analysis or runtime tracing. Correlated predicates and conservative exceptions can produce infeasible paths. JavaScript implicit conversions/getters and evaluation internals are abstracted at expression/basic-block granularity.
- `exception` edges explicitly mean **may throw, conservative**. They do not assert that a call necessarily throws. Grouped blocks do not expose an exact throwing substatement.
- Direct functions, imported aliases, constant arrow/function bindings, static methods, and implemented constructors can have a statically identified definition. `resolved` means a unique compiler-known definition for navigation, not a guarantee against runtime monkey-patching, reassignment, proxies, or instrumentation.
- Dynamic element-access calls, mutable function bindings, non-unique targets, and instance/runtime receiver dispatch remain `unresolved`, with reasons. Declaration-only APIs are `external`. No dynamic call target is invented.
- Optional chains, resource disposal (`using`/`await using`), labeled statements/jumps, generators, tagged templates, spread execution, class statements/expressions, parameter defaults, and destructuring defaults are explicitly opaque where encountered. Calls inside opaque regions are not listed as guaranteed calls. A normal outgoing edge from an unsupported node is only an opaque possible completion, not a complete account of that construct.
- Iteration structure is modeled, but iterator/enumerator machinery and iterator-close side effects are not expanded. This limitation is emitted as a diagnostic.
- JSX source is supported, but compiler-generated JSX factory/runtime calls are not expanded. Nested function bodies, including React callbacks, are not executed just because the enclosing function constructs them.
- No cross-function exception inference, recursive expansion, semantic-error certification, incremental compiler cache, or runtime participants are provided in V1.

## Stdio protocol

Start `./bin/codeviz serve`. Transport is **newline-delimited UTF-8 JSON-RPC 2.0**, not Neovim MessagePack RPC or LSP `Content-Length` framing. Send one request per line:

```json
{"jsonrpc":"2.0","id":1,"method":"analyze","params":{"file":"/project/src/foo.ts","line":52,"column":10}}
```

Optional `params.tsconfig` selects a config. Optional `params.sourceText` replaces only the selected file in memory. `exportMermaid` accepts the same parameters and returns a string. Notifications have no reply; numeric, string, and null request IDs are supported. Parse, request, method, parameter, and analysis errors are returned as structured errors. Batch arrays are not supported. Stdout is reserved for protocol messages.

## Development and validation

```sh
pnpm typecheck
pnpm test
pnpm test:nvim
```

Analyzer tests assert edges, graph reachability, abrupt completions, evaluation order, determinism, source coordinates, resolution, and explicit unsupported constructs. CLI tests exercise the built executable and malformed/fragmented RPC requests. The headless Neovim test opens a real fixture, invokes the flow command, navigates with `Enter`, checks source-to-graph highlighting, tests Unicode conversion, blocks stale navigation, refreshes unsaved contents, and closes the analyzer.

```text
packages/core/                 model and protocol contract
packages/typescript-analyzer/  project loading, function selection, CFG and call resolution
packages/mermaid-renderer/     export from the same ExecutionModel
cli/                          standalone analyze command and stdio server
nvim/                         native Lua plugin, help, and headless acceptance test
fixtures/                     TypeScript fixtures
tests/                        analyzer and CLI tests
```

## Next milestones

1. Exercise the MVP against representative PCF/React projects and expand correctness fixtures before claiming broader language coverage.
2. Add bounded call expansion with explicit depth and cycle limits.
3. Derive sequence/unified execution views from CFG plus resolved calls, not another analysis pipeline.
4. Introduce ELK layout and a native floating-node renderer while retaining model provenance and navigation.
5. Add deterministic levels of detail. Optional graphics remain renderer-only experiments.
