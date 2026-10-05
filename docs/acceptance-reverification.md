# Daniel: fresh acceptance re-verification

Verified October 5, 2026, after re-reading the approved proposal and all flagged historical goals. The current implementation at `7cfc7f7` was rebuilt and every selected acceptance check was rerun together. Subsequent application-repository changes are documentation only.

## Evidence and observed improvement

The earlier adjacency-card output has been replaced by an actual connected terminal diagram. Fresh normal-config captures show the real `CreateLegacyReturn.tsx` callback with labeled true/false branches and a visible merge. A separate real installed-plugin loop capture shows the back-edge route and upward destination arrow. This is observable improvement over destination-ID lists, not a claim that prettier layout fixes unsupported language semantics.

The routing correction also has live evidence: a new implementation worker spawned **without a model override** produced this document's initial matrix on **gpt-6.1-sol, low effort**, while a separate worker spawned explicitly on **gpt-6-luna, low effort** executed the actual project commands and installed editor workflows. The coordinator inspected their raw outputs and diagnosed the results. No global routing configuration was changed during this re-audit.

### Live routing locators

- Implementation: `session_gorilla_1791224282874_0f938d4ccd60a9ef`. Its spawn input omits `model`; its own `swarm list_models` reports current/default `gpt-6.1-sol`; native session metadata records `provider_key: openai-oauth`, `model: gpt-6.1-sol`, `reasoning_effort: low`.
- Mechanical execution: `session_orangutan_1791224290340_8258cdffa2f8f406`. Spawn input explicitly selects `gpt-6-luna` and `low`; its runtime reports Luna and native metadata records `model: gpt-6-luna`, `reasoning_effort: low`.
- Metadata snapshots and current journals under `/home/paul/.jcode/sessions/` were consulted because the ordinary worker list omitted the new workers' model labels. Policy/config fingerprints before and after execution match. This verifies the live available routes, not the unavailable-provider fallback.

## Whole-result check inventory

The root-authored `/home/paul/.jcode/scratch/daniel-acceptance-runner-01.sh` selected exact commands, working directories, time limits and unique artifacts. Each `daniel-acceptance-<name>-01` prefix has a full `.log` and actual `.status`. The runner records command identity and working directory, stops on the first failure, and refuses reused paths. All **13 commands** completed with **exit 0**, and the coordinator inspected their raw evidence, not merely a worker completion report.

| Name | Command / public path | Observed result |
| --- | --- | --- |
| `baseline` | Policy/config SHA-256 fingerprints | Recorded before execution |
| `typecheck` | `npm run typecheck` | TypeScript no-emit check completed |
| `build` | `npm run build` | Current analyzer, RPC and layout compiled |
| `tests` | `npm test` | **106 tests across 8 files** passed |
| `nvim` | `npm run test:nvim` | **22 editor regressions** passed and real analyzer/layout TS/TSX integration completed |
| `clihelp` | Direct `./bin/daniel --help` | Advertises Daniel analyze/serve and UTF-16 JSON-RPC conventions |
| `package` | `npm pack --dry-run --json` | Private `daniel@0.1.0` inventory has the renamed executable, plugin and help; packaging limit below remains |
| `public` | Normal-config Neovim public acceptance | New commands/modules/mapping/root and `:help daniel` work; CodeViz commands/module are absent |
| `installed` | Normal-config real `,vf` workflow | Detail/exception controls, parent/back, matching export, narrow resize/focus on sanitized TSX; actual user's callback arrows, exact source jump, per-box highlight, read-only source and `q` cleanup |
| `terminal` | Owned QA05 interactive Neovim | Actual TSX wide **180 × 55** and narrow **120 × 40** frames inspected |
| `loop` | Owned QA02 interactive Neovim | Real plugin on synthetic countdown source, **180 × 120** frame inspected with loop-back identity and arrow assertions |
| `preservation` | Original source/plugin-config checksum check | User application source and `after/plugin/daniel.lua` unchanged |
| `policyafter` | Policy/config SHA-256 fingerprints | Both identical to `baseline` |

## Requirement-to-result traceability

Controlled tests supplement, rather than replace, the real installed actual-source acceptance. Edge/failure behavior that the actual callback does not naturally contain is explicitly identified as controlled coverage.

| Goal / requirement | Fresh mapped checks and changed public output | Observed behavior and boundary |
| --- | --- | --- |
| Routing correction: configured implementation default, separate Luna-low checks | Live spawn/runtime metadata above, actual docs implementation, all 13 assigned commands | Actual routes match the requested division; validators executed commands only, root selected checks and inspected evidence. Existing policy/default config preserved. |
| Application re-verification: audit scope, repaired bugs and whole-result regressions | `typecheck`, `build`, `tests`, `nvim`, `installed` | Current code passes 106 tests and 22 editor regressions/integration, including the original analyzer/call/project/overlay and stale-navigation/export defects. Real user's TSX analyzes and navigates. The full roadmap is still not finished. |
| Rename to Daniel: new APIs work and no legacy compatibility | `tests` built executable/RPC cases, `clihelp`, `public`, `nvim` | `bin/daniel`, `@daniel/*`, `require('daniel')`, `DanielFlow`, `DanielExportMermaid` and installed help work. Old executable/plugin files, commands and Lua modules are absent by acceptance assertions. No aliases retained. |
| Neovim setup: configured end-user workflow without runtime injection | `public`, `installed`, `terminal`, `preservation` | Normal `/home/paul/.config/nvim` startup supplies `,vf`, plugin modules and help. No injected runtime path or setup call. Actual callback source jump/highlight and cleanup work. User source/config are unchanged. |
| Visual diagram proposal: approved local canvas rather than unfinished richer roadmap | `installed`, `terminal`, `loop`, `public` | Observed boxes/arrows, split/merge and loop routing, warning summary, source synchronization and controls match the approved single-buffer direction. Per-node floats, sequence views and expansion remain deferred. |
| Visual flow: layout geometry, identity, branches, joins and loops | `tests` 23 layout cases and built async layout RPC; `terminal`; `loop` | Integer cell geometry, border endpoints, orthogonality, deterministic layout, parallel/self/back edges and disconnected/special IDs pass controlled checks. Actual shipto branch merges visibly. Real plugin loop route returns upward to its header. |
| Visual flow: Unicode, widths, overlap and resource/failure bounds | `tests` layout validation; `nvim` measurement, combining glyph, truncation/fallback regressions | Caller-measured widths, finite cells/routes, node/label collision limits, 300-node/1500-edge/area limits, Unicode and explicitly labeled fallback pass controlled cases. No claim that the actual callback exercises all these limits or Unicode variants. |
| Visual flow: structural/normal/detailed, exceptions, uncertainty and safe groups | `installed` detail/exception controls; `terminal`; `nvim` member/projection regressions | Normal and detailed toggles and exception restoration work. Actual callback retains `e:35h` and `?:16` in its pinned bar. Safe groups retain identities and exact member jumps in controlled/editor integration cases. Explicit throw/catch routes are not hidden. |
| Visual flow: exact hit selection and Enter/Tab/gd/gr/K | `installed` actual source coordinates/box highlight; `nvim` real TS/TSX integration and same-row/member checks | Real Enter and source sync match UTF-16-to-byte positions. Tab, definition jumps, details and grouped member jumps work in integration. `gr` dispatch is stub-tested only, not a certified real LSP session. |
| Visual flow: stale snapshots, unsaved refresh, imported-target safety and cleanup | `nvim`, `installed` | Controlled races reject obsolete analyze/layout/export callbacks and source changes. Real integration refreshes unsaved text without writing, guards modified definition targets and exclusive exports, and wipes duplicated graph buffers. Actual-source acceptance separately verifies normal q cleanup. |
| Visual flow: viewport, resize and source focus | `installed`, `terminal`, `nvim` debounce/wrapping/generation checks | Fresh narrow frame wraps expressions and preserves connectors/pinned warnings. Very narrow splits visibly crop a branch offscreen, requiring horizontal scrolling; no fit-all guarantee. Debounced resize preserves source focus. |
| Visual flow: callback names, parent selection and export provenance | `tests` visual contract; `installed`; `nvim` parent-error/export cases | Innermost region is named `map callback`, parent/back works, and exported Mermaid matches the selected parent. Failed parent requests retain the valid region. Graph and source exports use their appropriate cursor/depth. |
| Visual flow: stdio framing, serialized async RPC and EOF | `tests` actual built CLI/RPC processes; `nvim` transport integration | Parse/method/params/oversize errors are structured, notifications have no replies, fragmented input/unsaved contents work, responses remain ordered and EOF drains queued layout requests. |
| Packaging boundaries and likely deployment failure | `package`, `build`, `clihelp`, installed checkout | Current private source checkout builds and runs. Dry-run packaging omits gitignored `dist`, so it is **not certified as a ready-to-run npm distribution**. Direct use from such an archive requires a build. No package was installed, published or released. |

## Fresh actual-source measurements and captures

- `CreateLegacyReturn.tsx` selected `.map()` region remains lines **1618–1635**: **39 semantic nodes**, **47 displayed edges**, **35 hidden conservative exception connectors**, **16 uncertain nodes/calls**, normal layout **76 × 573 cells**.
- Fresh opening measurement: **4222.2 ms**. Detailed timings in `daniel-visual-real-metrics-audit01.json`: analysis about **3704 ms**, layout about **471 ms**. This run is slower than the previous 3.8–4.0-second sample, so there is no universal sub-four-second claim.
- Real-source frames: `daniel-visual-terminal-wide-05.txt` and `daniel-visual-terminal-narrow-05.txt`. The wide frame shows the entered-shipto decision, false-path fallback and merge into partnum. The narrow frame exposes real horizontal clipping, not a silently hidden edge category.
- Loop frame: `daniel-visual-loop-terminal-02.txt`. Metrics in `daniel-visual-loop-metrics-02.json` record **8 nodes**, **8 displayed edges**, **52 × 71 cells** and the back edge. This uses actual installed Neovim/analyzer/RPC/layout on a synthetic scratch source, not stubbed responses or the actual TSX callback.
- Frames/source labels remain local scratch artifacts. QA servers are intentionally stopped after capture. That is not a normal interactive-exit claim; normal plugin cleanup is verified separately by `installed` and `nvim`.

## Remaining limitations and stopping criterion

All selected requirements were checked against the same current implementation after the traceability map was completed. No additional implementation bug was observed in this rerun. Finite tests and one real callback do not prove absence of bugs or certify the whole PCF/React project.

The existing suppressed Dadbod UI `E716` startup baseline and parent missing `pcf-scripts` config warning remain unrelated, nonfatal observations. Packaging emitted an `.npmignore`/gitignore-fallback warning and is source-only as described above. Optional chains remain explicitly opaque. Recursive expansion, sequence/unified views, rich floating-node rendering, terminal graphics, actual LSP references and release distribution are not claimed as delivered.

The feedback loops are closed for the requested routing behavior, audit/rename/setup outcomes, approved proposal acceptance and current visual phase. Completion refers to those scoped outcomes, not the entire original application roadmap. Global configuration and user application files remain preserved.
