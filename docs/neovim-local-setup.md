# Daniel: local Neovim setup record

Setup date: October 5, 2026. Local checkout: `/home/paul/repos/daniel`.

The setup steps below are the historical installation record. The installed plugin now uses the [connected visual-flow renderer](visual-flow-verification.md), with `+`/`-` detail controls, `e` exception visibility, and `F`/`f` enclosing-function selection. The existing configuration file is unchanged. Restart Neovim after rebuilding to replace cached Lua modules.

## Steps executed

1. **Inspected the requirements and existing installation.** Read `README.md`, `nvim/doc/daniel.txt`, the plugin's startup code, and the build scripts. Located Neovim **0.11.6**, Node.js **24.13.0**, and npm **11.6.2**. Daniel's TypeScript dependency and built output already existed. No runtime upgrade, dependency download, global CLI install, or pnpm installation was needed.

2. **Inspected the actual Neovim configuration.** Read `~/.config/nvim/init.lua`, `lua/me/{init,packer,set,remap}.lua`, and relevant `after/plugin/` files. Confirmed the existing leader is a comma and `,vf` was unused. Existing local edits in `packer.lua`, `remap.lua`, and the untracked `after/plugin/yazi.lua` were left alone. Recorded SHA-256 fingerprints of those files and `init.lua` before setup.

3. **Ran a baseline using normal user startup.** Launched headless Neovim without `-u NONE`, with swap and ShaDa writes disabled for the probe. Confirmed the config path, Node's availability inside Neovim, the leader, the free mapping, and that Daniel was not installed. The strict baseline probe returned status 1 because `vim.v.errmsg` contained `E716: Key not present in Dictionary: "collapsed"`. Inspection of the installed Dadbod UI plugin found `silent! call remove(..., 'collapsed')` on an initially empty icon dictionary. This is a pre-existing suppressed plugin error, not a Daniel error or a visible startup failure. Dadbod UI was not changed.

4. **Added only one file to the existing Neovim setup:** `~/.config/nvim/after/plugin/daniel.lua`:

   ```lua
   -- Local Daniel checkout. No Packer install/sync is needed.
   local root = vim.fn.expand('~/repos/daniel')
   vim.opt.runtimepath:prepend(root .. '/nvim')

   -- This file runs after the normal plugin scan, so load the commands explicitly.
   vim.cmd('runtime plugin/daniel.lua')
   require('daniel').setup({
     keymap = '<leader>vf', -- The existing comma leader makes this ,vf.
     timeout = 10000,
   })
   ```

   The configuration uses Daniel's default analyzer command, `node /home/paul/repos/daniel/dist/cli/index.js serve`, with Node resolved from Neovim's PATH. It does not pin the temporary fnm session path or force a project-specific tsconfig. No existing configuration file was overwritten, so no restore backup was needed.

5. **Rebuilt the analyzer** from `/home/paul/repos/daniel`:

   ```sh
   npm run build
   ```

   The compiler exited with status **0** and refreshed `dist/`.

6. **Generated Daniel's help index**:

   ```sh
   nvim --headless -u NONE -i NONE -n \
     -c 'helptags /home/paul/repos/daniel/nvim/doc' -c 'qa!'
   ```

   This exited with status **0**, generating `nvim/doc/tags` for `:help daniel`.

7. **Documented help installation** in `README.md` and ignored generated `nvim/doc/tags` in `.gitignore`, so locally generated help tags do not dirty the application checkout.

8. **Created and ran acceptance checks against the actual user configuration**, from `/home/paul` rather than the application checkout. The probe does not inject a runtime path, source Daniel's plugin, or call `setup()` itself. It checks the installation performed in step 4. It explicitly records the known suppressed baseline error and rejects any different startup error or any new error during the workflow. Temporary source edits remain in memory and are discarded on exit.

   ```sh
   cd /home/paul
   nvim --headless -n -i NONE \
     -c "lua dofile('/home/paul/.jcode/scratch/daniel-nvim-setup-acceptance.lua')"
   ```

   This exited with status **0**. Verified normal startup loads the module and both commands, the comma-leader mapping is installed, `:help daniel` opens the correct help file, real TypeScript analysis opens a graph, `Enter` jumps to exact source coordinates, `r` analyzes unsaved edits without writing them, `q` wipes the graph and stops the analyzer, `,vf` analyzes TSX, `gd` follows an imported definition, and Mermaid export opens a buffer. No new workflow error was observed.

9. **Reran the native editor regression and integration suite**:

   ```sh
   npm run test:nvim
   ```

   It exited with status **0**: **10 editor regressions passed**, followed by **`daniel integration: ok`**. This additionally exercises stale-navigation protection, export safety, Unicode positions, controlled callback/lifecycle races, and cleanup. The suite's LSP references check uses a stub, not an actual attached TypeScript server.

10. **Checked preservation of the user's existing configuration**:

    ```sh
    sha256sum -c /home/paul/.jcode/scratch/daniel-nvim-setup-existing.sha256
    ```

    The checks for `init.lua`, `lua/me/packer.lua`, `lua/me/remap.lua`, and `after/plugin/yazi.lua` all returned **OK**, with exit status **0**.

11. **Recorded all steps and raw validation evidence**, then reviewed and committed only the new Daniel configuration file in the Neovim configuration repository and the setup documentation/help-tag ignore rule in the application repository. Existing unrelated configuration edits were not staged or committed.

## How to use the installed plugin

Restart an already-running Neovim, or load the new file in that session:

```vim
:luafile ~/.config/nvim/after/plugin/daniel.lua
```

Open a named TypeScript or TSX file and put the cursor inside a function. Press **`,vf`** in normal mode, or run **`:DanielFlow`**. In the graph: `Enter` jumps to source, `Tab`/`Shift-Tab` select nodes, `gd` follows resolved definitions, `K` shows details, `r` refreshes including unsaved edits, and `q` closes the graph and analyzer.

Use **`:DanielExportMermaid`** for an export buffer or **`:DanielExportMermaid /new/path.mmd`** for a new file. Use **`:help daniel`** for plugin documentation.

No TypeScript LSP was installed as part of this setup. Daniel's analysis and definition navigation use its own TypeScript analyzer. The optional `gr` references action needs an attached language server and was not certified with a real TypeScript LSP here. The existing Lua LSP configuration was not modified.

This installation intentionally uses the local checkout. Keep the repository at the configured path. After changing analyzer sources, run `npm run build` again. After changing help text, regenerate the help index.

## Verification evidence

Validation was executed by a dedicated **gpt-6-luna, low-effort** worker. The coordinator inspected raw output and each command's actual exit status, not just worker summaries. Evidence is stored locally under `/home/paul/.jcode/scratch/`:

| Check | Log and status filename prefix | Exit status | Observed result |
| --- | --- | --- | --- |
| Strict pre-setup baseline | `daniel-nvim-setup-baseline-01` | 1 | Existing suppressed Dadbod UI error, captured before Daniel was installed |
| Analyzer build | `daniel-nvim-setup-build-01` | 0 | TypeScript compilation completed |
| Help index generation | `daniel-nvim-setup-helptags-01` | 0 | Help tags generated |
| Actual-user-config acceptance | `daniel-nvim-setup-acceptance-01` | 0 | All installed-plugin workflow checks reached `daniel local Neovim setup: ok` |
| Native regressions/integration | `daniel-nvim-setup-regressions-01` | 0 | 10 regressions passed and integration completed |
| Existing-config checksums | `daniel-nvim-setup-preservation-01` | 0 | All four protected files unchanged |

Each prefix has a `.log` file and a `.status` file. The first baseline failure is preserved, not hidden or counted as a pass. No failed acceptance run was retried. The baseline error was identified as unrelated before the actual Daniel workflow check, which rejects new errors.
