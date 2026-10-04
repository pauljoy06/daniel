# Application verification and original-plan checklist

## Conclusion

**The original full application roadmap is not finished.** The delivered scope is the V1 single-function analyzer and native flow/navigation surface, plus conservative call-definition resolution and Mermaid export. Later execution/sequence views and V2 rendering remain unimplemented, not silently counted as complete.

The V1 renderer is an explicit adjacency/card view with labeled outgoing edges, not the spatial branch diagram sketched in the original plan. It has a real native editor workflow, but not graph layout or a floating-node canvas. The compiler API is used directly instead of the suggested ts-morph convenience layer. These are documented implementation choices, not hidden dependencies on an LLM or browser.

## Original 14-stage plan

| Stage | Requirement | Status and evidence |
| --- | --- | --- |
| 1 | Analyzer foundation, project config, containing function, standalone CLI | Implemented. Compiler Program/TypeChecker, config/overlay/project-reference tests, and built executable tests. |
| 2 | Single-function CFG, basic blocks, branches, loops, abrupt completion, exceptions | Implemented within documented syntactic limits. Graph-edge/reachability tests cover ordering and continuation routing. |
| 3 | Observable correctness, exact provenance, explicit unsupported/dynamic constructs | Implemented. Schema, AST-kind, UTF-16/source-range, deterministic ID and conservative-resolution tests. This is not complete JavaScript semantics. |
| 4 | Native Neovim flow command and stdio JSON-RPC | Implemented. Real analyzer process and newline transport integration tests. `<leader>vf` is installed when configured through `setup({keymap = '<leader>vf'})`. |
| 5 | V1 native buffer visualization | Implemented in simplified form. Native nofile split, Unicode cards/edges, highlights and extmarks. A spatial branch canvas and virtual-text edge renderer are not implemented. |
| 6 | Bidirectional navigation, Enter, gd, gr, K | Implemented. Real source jumps/highlighting, imported definition navigation, details, stale protection and refresh tests. `gr` routing is tested with a stub, not an attached real language server. |
| 7 | Compiler-owned call-definition resolution | Implemented conservatively. Resolved/external/unresolved call sites with reasons and targets. No project-wide recursively expanded call graph. |
| 8 | Bounded recursive expansion, o/c, depth and cycle limits | Not implemented. |
| 9 | Sequence view, CodeVizSequence, `<leader>vs` | Not implemented. |
| 10 | V2 semantic floating-window nodes and canvas | Not implemented. The K details popup is not a V2 node renderer. |
| 11 | ELK layout and terminal coordinate mapping | Not implemented. |
| 12 | Deterministic structural/normal/detailed views, +/- | Not implemented. |
| 13 | Mermaid export from the same ExecutionModel | Implemented. Built CLI/RPC and native editor export tests. Exclusive file creation prevents overwriting files or symlinks. |
| 14 | Optional later terminal graphics experiments | Not implemented and explicitly optional/future. |

The proposed unified execution view and `<leader>ve` are also not implemented.

## Defects found and repaired during this audit

The old 48-test suite passed before new adversarial tests were added. Passing that baseline did not establish absence of bugs.

### Analyzer and call resolution

- Computed object method/getter/setter names dropped calls made while constructing the object. Their names now execute in the model while their bodies remain excluded.
- Class expressions without calls were silently grouped as ordinary statements rather than explicitly marked opaque.
- For-of/for-in destructuring bindings silently omitted opaque/default diagnostics. Iteration assignment targets also dropped evaluation calls. Binding/target evaluation is now explicit on each iteration.
- Adjacent destructuring-assignment and iteration-resource cases now remain explicitly opaque instead of fabricating default-call execution.
- Invalid LF/CRLF cursor columns could spill into the next line and select the wrong function.
- Calling an accessor's returned function incorrectly resolved to the accessor itself.
- Instance arrow fields and function-valued members of mutable object bindings bypassed conservative receiver-dispatch safeguards.
- New unsaved files in otherwise empty configured projects were rejected by the config's no-input diagnostic before the overlay could be installed.
- Explicit solution/project references redirected the selected source into declaration output, losing the implementation or unsaved overlay. Analysis now asks the compiler to use source redirects rather than declaration-only cursor files.
- Nested declaration-only namespace calls were misclassified as dynamic instead of external.

### Native editor safety and lifecycle

- Exporting from a second source buffer rebound an existing graph to that buffer without invalidating its old model. Export no longer mutates graph provenance.
- Switching sources could leave an old model active after new analysis failed. Old graph state is now closed and invalidated on a source switch.
- Imported-definition `gd` skipped stale-source protection because only jumps back to the primary file checked freshness. All graph source navigation now checks the analyzed source snapshot.
- Unsaved external target buffers are refused for definition navigation until saved and reanalyzed, rather than using disk-derived coordinates against edited text.
- Closing a graph displayed in duplicate windows left an orphan interactive graph buffer. The graph buffer is now wiped as well as the recorded window being closed.
- Queued export callbacks could write after close or after source edits. Generation and source snapshot checks now discard those results.
- Relative export paths were resolved against response-time working directories rather than invocation-time directories.
- Export overwrite prevention checked file readability and performed a non-atomic write. Exclusive creation now rejects existing files, including dangling symlinks, and avoids the check/write race.

## Verification results

| Check | Observed result | Evidence prefix under `$JCODE_SCRATCH_DIR` |
| --- | --- | --- |
| `npm run typecheck` | Passed, exit 0 | `codeviz-reaudit-typecheck-03` |
| `npm test` | **69 tests passed across 6 files**, exit 0 | `codeviz-reaudit-tests-03` |
| `npm run build` | Passed, exit 0 | `codeviz-reaudit-build-03` |
| `npm run test:nvim` | **10 controlled editor regressions passed, plus the real TS/TSX acceptance workflow**, exit 0 | `codeviz-reaudit-nvim-04` |
| `git diff --check` | Passed, exit 0 | `codeviz-reaudit-diff-03` |

Each evidence prefix has a `.log` containing captured stdout/stderr and a `.status` containing the actual command exit code. The coordinator inspected these files, not just worker completion reports. The earlier nine-case editor acceptance run also passed; the final run added an unsaved external-target case and reran the full native workflow.

### Evidence and test boundaries

- Mechanical execution was delegated to `gpt-6-luna` at low effort. The coordinator selected commands, inspected raw output/exit codes, diagnosed failures and implemented fixes.
- The initial analyzer regression run exposed nine failing cases. The initial project/call regression run exposed seven failures and one preserved success. The initial isolated editor regression run exposed eight failures. Logs were preserved rather than overwritten by green retries.
- The first post-fix run passed 17 analyzer/project cases and nine isolated editor checks. Four more analyzer/TSX cases and expanded real editor acceptance were then added for the final full run.
- `nvim/tests/regressions.lua` uses controlled analyzer responses to make races and callback ordering deterministic. These are synthetic editor regressions, not a substitute for the real analyzer/editor acceptance test.
- `nvim/tests/integration.lua` invokes the actual built analyzer and native commands against on-disk TS and TSX fixtures, including unsaved source refresh. Its references-routing check stubs the LSP call because no language server is attached.
- `fixtures/react/control.tsx` represents PCF/React-style branching, imported calls, JSX and callback construction. It does not certify usefulness or performance on the user's actual application, invoke React/PCF at runtime, or establish complete language coverage.
- Mermaid tests establish consistency of model export and safe editor output. They do not independently parse every possible output using Mermaid's own parser.
- A non-fatal test-runner warning references the parent directory's missing `pcf-scripts/tsconfig_base.json`. No parent/global project configuration was changed as part of this audit.

## Remaining work and trust limits

1. Exercise this milestone on a representative actual PCF/React project and measure graph usefulness and latency. The new TSX fixture is a useful acceptance sample, not this project-level evaluation.
2. Implement bounded depth/cycle-limited call expansion, then sequence/unified views from the same model.
3. Add ELK layout, floating-node rendering and deterministic detail levels.
4. Keep extending fixture-based language correctness coverage. Optional chains, generators, class evaluation, resource disposal, spread/tagged templates, labeled jumps and binding defaults remain explicitly opaque in the documented V1 boundary.
5. Add real attached-LSP navigation acceptance and independent Mermaid-parser coverage if stronger guarantees are needed.

No static audit and finite test suite proves the absence of all bugs. This audit establishes the specific repaired cases and supported workflows above, not full-roadmap completion or unrestricted JavaScript semantics.
