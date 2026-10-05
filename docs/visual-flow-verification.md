# Daniel: visual-flow phase verification

Verified October 5, 2026. This implements the approved connected native diagram phase, not the entire application roadmap.

## Delivered

- Local ELKjs 0.12.0 layout through a separate `layout` RPC. Execution semantics remain in the unchanged `ExecutionModel` contract.
- Native scrollable boxes, orthogonal arrows, true/false labels, merges and loop routes. Selection uses row and display-cell column, not just the line.
- Structural / normal / detailed views (`-` / `+`), conservative-exception visibility (`e`), uncertainty badges and a pinned summary that stays visible when scrolling.
- Safe presentation grouping, exact member selection (`[` / `]`), `Enter` source jumps, `gd`, optional LSP `gr`, `K`, unsaved refresh (`r`) and cleanup (`q`).
- Contextual callback names and bounded enclosing-function selection (`F` / `f`). Export from the graph preserves its selected region; export directly from source uses the source cursor.
- Viewport wrapping, debounced resize, source-focus preservation, stale response protection across analysis and layout, and explicit failure fallback.

No browser, image protocol, remote layout service or execution of the analyzed application is required. The existing local Neovim configuration was not rewritten.

## Inspected final evidence

Each prefix below has captured `.log` output and an actual `.status` under `/home/paul/.jcode/scratch`.

| Check | Prefix | Observed result |
| --- | --- | --- |
| Typecheck | `daniel-visual-typecheck-03` | Exit 0 |
| Full TypeScript suite | `daniel-visual-tests-02` | **106 tests, 8 files**, exit 0 |
| Build | `daniel-visual-build-02` | Exit 0 |
| Native editor suite | `daniel-visual-nvim-03` | **22 controlled regressions**, plus real TS/TSX integration, exit 0 |
| Installed user configuration and actual TSX | `daniel-visual-installed-03` | All workflow checks completed, exit 0 |
| Interactive terminal confirmation | `daniel-visual-terminal-04` | Wide/narrow captures collected, exit 0; disposable QA server intentionally cleaned up |
| Help index | `daniel-visual-help-01` | Exit 0 |
| Source/config preservation | `daniel-visual-preservation-01` | Actual application file and existing plugin configuration checksums unchanged, exit 0 |
| Loop-back terminal acceptance | `daniel-visual-loop-check-01` | Installed mapping, real analyzer/layout, upward back edge and arrow assertions, 180 × 120 capture inspected, exit 0 |
| Final staged whitespace check | `daniel-visual-precommit-02` | Exit 0 |
| Earlier disposable QA session cleanup | `daniel-visual-qa03-cleanup-02` | Owned QA03 server already absent, exit 0 |

Mechanical execution used **gpt-6-luna at low effort**. Implementation workers followed the configured default and were observed as **gpt-6.1-sol at low effort**. The coordinator inspected raw logs/statuses, selected fixes and controlled reruns.

## Actual application acceptance

The selected `.map()` callback in `CreateLegacyReturn.tsx`, lines **1618–1635**, produced:

- **39 semantic nodes**, **47 displayed edges**, **35 hidden conservative exception connectors** and **16 uncertain nodes/calls**.
- A normal-view canvas of **76 × 573 cells**. A tall graph requires vertical scrolling, and very narrow splits can require horizontal scrolling. `Tab` centers a node; `zh`/`zl` and `<C-w>|` are standard Neovim viewport controls.
- Approximately **3.8–4.0 seconds** to open in the final headless runs. In the latest inspected timing sample (`daniel-visual-real-metrics-03.json`), analysis took about **3.31 seconds**, and layout about **0.44 seconds**. These are measurements of this callback on this machine, not a project-wide performance guarantee.

The installed-configuration probe did not inject a runtime path or call plugin setup. It used the real `,vf` mapping, real analyzer/RPC layout, detail and exception controls, parent/back selection, matching Mermaid export, narrow resize/focus, exact source coordinates, source-to-box highlighting and `q` cleanup. It verified that every routed edge endpoint retained its arrow. Source was read only.

Final terminal captures were inspected at **180 × 55** and **120 × 40**. Files: `daniel-visual-terminal-wide-04.txt` and `daniel-visual-terminal-narrow-04.txt`. Full canvas, excerpt and timing artifacts use `daniel-visual-real-*-03` and `daniel-visual-real-*-terminal-04`. They remain local because the diagram contains application-source labels.

An acceptance re-audit identified that the initial terminal captures showed branches and joins, but not a loop. A separate real installed-plugin capture now closes that gap: `daniel-visual-loop-terminal-01.txt`, at **180 × 120**, shows a scratch `countdown` function, both condition paths, return, exit, and a labeled right-side loop-back route with an upward arrow into the loop header. The real analyzer/layout produced **8 nodes, 8 displayed edges and a 52 × 71-cell layout**. Assertions verify the back-edge identity, upward destination and rendered endpoint arrow. `daniel-visual-loop-metrics-01.json` records the exact route. The source is a synthetic local fixture, but this uses the actual installed mapping, analyzer, RPC and canvas, not stubbed responses. Only the disposable capture server is stopped afterward.

## Bugs found and repaired

- NodeNext interpreted the published bundled ELK constructor declaration as a namespace. The adapter now uses the published constructor interface without changing runtime import behavior.
- ELK's in-process bundled worker has no `terminate()` method. Unconditional cleanup masked successes and typed layout failures. Only real worker transports are terminated.
- Async RPC completion attempted to resume readline after EOF. The close guard now preserves queued responses.
- Original/self/grouped back edges and parallel edge identities could disappear during display projection. They now survive, including a back edge between contracted members.
- Group aliases made hit selection nondeterministic. Canonical boxes and explicit member selection preserve exact provenance.
- Combining marks could attach to a wide glyph's continuation cell. They now remain attached to the glyph.
- Resize bursts could queue stale layouts or steal source focus. Debounced generation guards and focus preservation are tested.
- Graph-origin export could ignore the selected parent depth. It now preserves the graph's region.
- Later routes could overwrite branch text or turn a crossing into a junction. Labels and crossing markers now survive.
- Simplification counts scrolled away with buffer headers. The pinned winbar now keeps them visible.

## Preserved failures and verification limits

Initial typecheck (`typecheck-01`) failed with exit 2. Initial full suite (`tests-01`) had 8 failures and 98 passes, exit 1. These logs were retained, not overwritten by later passes.

Terminal attempts 01 and 02 failed before a ready marker. Attempt 03 produced useful frames, but its completion status was not persisted, so it is **not counted as a passed workflow or normal shutdown**. The final capture runner uses an explicit isolated shell/config and intentionally cleans up its own QA server after frame collection. Normal plugin shutdown is separately verified by the headless installed workflow and editor suite.

The first final-check delegation reported an ambiguous duplicate execution count for `precommit-01`, and `qa03-cleanup-01` failed shell parsing before its log/status files were recorded. These are not treated as reliable final evidence. A new root-authored runner produced independently inspected `precommit-02` and `qa03-cleanup-02` output/statuses, both exit 0. No earlier status was reconstructed or overwritten.

The existing suppressed Dadbod UI dictionary error (`E716`, `collapsed`) is recorded as a known startup baseline. The parent project's missing `pcf-scripts` base-config warning remains nonfatal. Neither unrelated configuration was changed.

Optional-chain semantics remain opaque, and warnings are retained. Call expansion, sequence/unified views, per-node floating windows and optional terminal graphics are not delivered by this phase. Real TypeScript LSP references are not certified, and one callback does not certify the whole PCF/React application. Finite tests do not prove absence of all bugs.

## Use the new version

The analyzer is built and help tags are refreshed. **Restart Neovim** to replace cached Lua modules and old analyzer processes. Open a named TS/TSX source file, place the cursor inside the function and press **`,vf`**. No additional plugin-manager install or configuration edit is required for this local checkout.
