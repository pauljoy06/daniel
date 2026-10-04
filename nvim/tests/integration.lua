local function fail(message)
  error('codeviz integration: ' .. message, 0)
end

local function wait_for(predicate, message)
  if not vim.wait(15000, predicate, 20) then fail(message) end
end

local root = vim.fn.getcwd()
vim.opt.runtimepath:prepend(root .. '/nvim')
vim.cmd('runtime plugin/codeviz.lua')
local function press(key)
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(key, true, false, true), 'x', false)
end

-- The transport must tolerate arbitrary stdout chunk boundaries.
local Client = require('codeviz.rpc')
local transport = Client.new({ 'unused' }, 1000)
local received
transport.pending[7] = { callback = function(err, result) if err then fail(err) end; received = result end }
transport:_stdout({ '{"jsonrpc":"2.0","id":7,"res' })
transport:_stdout({ 'ult":{"value":42}}', '' })
wait_for(function() return received ~= nil end, 'fragmented transport response was lost')
if received.value ~= 42 then fail('fragmented transport response was corrupted') end

local source = { file = '/fixture.ts', startLine = 1, startColumn = 1, endLine = 1, endColumn = 2 }
local fixture_model = { entryFunction = { name = 'main', source = source }, nodes = {
  { id = 'a', kind = 'condition', label = 'x', source = source },
  { id = 'b', kind = 'call', label = 'handler()', source = source },
}, edges = { { from = 'a', to = 'b', type = 'true' } }, calls = {
  { nodeId = 'b', resolution = 'unresolved', reason = 'dynamic' },
} }
local lines, _, positions = require('codeviz.render').build(fixture_model)
if lines[positions.a + 1] ~= '┌─ ◇ [a] x' then fail('condition renderer changed unexpectedly') end
local rendered = table.concat(lines, '\n')
if not rendered:find('(true)→ [b]', 1, true) then fail('renderer lost branch routing') end
if not rendered:find('call: unresolved · dynamic', 1, true) then fail('renderer hides unresolved calls') end

local fixture = root .. '/fixtures/conditions/branches.ts'
if vim.fn.filereadable(fixture) == 0 then
  fixture = vim.fn.tempname() .. '.ts'
  vim.fn.writefile({
    'export function saveOrder(total: number) {',
    '  const fee = total > 100 ? 0 : 5;',
    '  const finalTotal = total + fee;',
    '  if (finalTotal > 0) {',
    '    return finalTotal;',
    '  }',
    '  return 0;',
    '}',
  }, fixture)
end

vim.cmd('edit ' .. vim.fn.fnameescape(fixture))
local source_buf = vim.api.nvim_get_current_buf()
vim.api.nvim_win_set_cursor(0, { 5, 4 })

local codeviz = require('codeviz')
codeviz.setup({ timeout = 12000 })
if codeviz._util.byte_to_utf16('😀 target()', 5) ~= 4 then fail('UTF-8 to UTF-16 conversion failed') end
if codeviz._util.utf16_to_byte('😀 target()', 4) ~= 5 then fail('UTF-16 to UTF-8 conversion failed') end
vim.cmd('CodeVizFlow')
wait_for(function()
  return codeviz._state.model ~= nil and codeviz._state.graph_buf ~= nil
end, 'real analyze response did not produce a graph')

local state = codeviz._state
if state.model.schemaVersion ~= 1 then fail('unexpected schema version') end
local graph_text = table.concat(vim.api.nvim_buf_get_lines(state.graph_buf, 0, -1, false), '\n')
if not graph_text:find('outgoing', 1, true) or not graph_text:find('→', 1, true) then
  fail('graph lacks explicit outgoing labeled edges')
end

local jump_node
for _, node in ipairs(state.model.nodes) do
  if not node.synthetic and node.source.startLine > 1 then jump_node = node; break end
end
if not jump_node then fail('analyze response has no real source node') end
local first = state.model.nodes[1]
vim.api.nvim_win_set_cursor(state.graph_win, { state.node_lines[first.id] + 1, 0 })
press('<Tab>')
if vim.api.nvim_win_get_cursor(state.graph_win)[1] ~= state.node_lines[state.model.nodes[2].id] + 1 then
  fail('Tab did not select next node')
end
press('<S-Tab>')
if vim.api.nvim_win_get_cursor(state.graph_win)[1] ~= state.node_lines[first.id] + 1 then
  fail('Shift-Tab did not select previous node')
end
vim.api.nvim_set_current_win(state.graph_win)
vim.api.nvim_win_set_cursor(state.graph_win, { state.node_lines[jump_node.id] + 1, 0 })
vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes('<CR>', true, false, true), 'x', false)
wait_for(function() return vim.api.nvim_get_current_buf() == source_buf end, 'Enter did not jump to source')
local cursor = vim.api.nvim_win_get_cursor(0)
if cursor[1] ~= jump_node.source.startLine then fail('Enter jumped to wrong source line') end
local source_line = vim.api.nvim_get_current_line()
local expected_byte = codeviz._util.utf16_to_byte(source_line, jump_node.source.startColumn)
if cursor[2] ~= expected_byte then fail('Enter did not convert UTF-16 column to byte offset') end

vim.api.nvim_win_set_cursor(0, { jump_node.source.startLine, expected_byte })
vim.cmd('doautocmd CursorMoved')
local current_ns = vim.api.nvim_get_namespaces()['codeviz-current']
local marks = vim.api.nvim_buf_get_extmarks(state.graph_buf, current_ns, 0, -1, {})
if #marks ~= 1 then fail('source CursorMoved did not highlight one graph node') end

local original = vim.api.nvim_buf_get_lines(source_buf, 4, 5, false)[1]
local changed = original:gsub('blocked', 'notBlocked')
if changed == original then changed = original:gsub('finalTotal', 'finalTotal + 1') end
if changed == original then fail('unsaved edit did not change source text') end
vim.api.nvim_buf_set_lines(source_buf, 4, 5, false, { changed })
vim.api.nvim_set_current_win(state.graph_win)
vim.api.nvim_win_set_cursor(state.graph_win, { state.node_lines[jump_node.id] + 1, 0 })
vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes('<CR>', true, false, true), 'x', false)
if vim.api.nvim_get_current_buf() ~= state.graph_buf then fail('stale graph navigated to changed source') end
local old_model = state.model
press('r')
wait_for(function() return state.model ~= old_model end, 'refresh of unsaved source did not return a new model')
if not vim.bo[source_buf].modified then fail('refresh unexpectedly wrote the source buffer') end
local labels = {}
for _, node in ipairs(state.model.nodes) do table.insert(labels, node.label) end
if not table.concat(labels, '\n'):find('notBlocked', 1, true) then fail('refresh did not analyze unsaved condition') end

local graph_buf = state.graph_buf
press('q')
wait_for(function() return state.client == nil end, 'close did not stop and clear the analyzer client')
if vim.api.nvim_buf_is_valid(graph_buf) then fail('close did not wipe the graph buffer') end

-- Exercise the same native workflow against an actual TSX file and imported calls.
local tsx = root .. '/fixtures/react/control.tsx'
vim.cmd('hide edit ' .. vim.fn.fnameescape(tsx))
local tsx_buf = vim.api.nvim_get_current_buf()
vim.api.nvim_win_set_cursor(0, { 15, 2 })
codeviz.setup({ timeout = 12000, keymap = '<leader>vf' })
press((vim.g.mapleader or '\\') .. 'vf')
wait_for(function() return state.model and state.model.entryFunction.name == 'renderControl' end,
  'mapped flow command did not analyze TSX')
local imported
for _, call in ipairs(state.model.calls) do if call.name == 'helper' then imported = call end end
if not imported or imported.resolution ~= 'resolved' then fail('TSX imported call was not resolved') end
vim.api.nvim_win_set_cursor(state.graph_win, { state.node_lines[imported.nodeId] + 1, 0 })
press('gd')
if vim.api.nvim_buf_get_name(0) ~= imported.target.source.file then fail('gd did not jump to imported definition') end
if vim.api.nvim_win_get_cursor(0)[1] ~= imported.target.source.startLine then fail('gd jumped to wrong definition line') end

-- Exporting this other source must leave the existing TSX graph attached to TSX.
local scratch = (vim.env.JCODE_SCRATCH_DIR or vim.fn.stdpath('cache'))
local export = scratch .. '/codeviz-acceptance-' .. vim.fn.getpid() .. '.mmd'
vim.api.nvim_win_set_cursor(0, { 1, 19 })
vim.cmd('CodeVizExportMermaid ' .. vim.fn.fnameescape(export))
wait_for(function() return vim.fn.filereadable(export) == 1 end, 'real Mermaid export did not create its file')
if state.source_buf ~= tsx_buf then fail('source export rebound the TSX graph') end
local exported = table.concat(vim.fn.readfile(export), '\n')
if not exported:find('flowchart TD', 1, true) then fail('export file lacks Mermaid graph') end
-- A real existing file is preserved, even when a second export finishes.
vim.fn.writefile({ 'preserve-existing-export' }, export)
local export_id = state.client.next_id
vim.cmd('CodeVizExportMermaid ' .. vim.fn.fnameescape(export))
wait_for(function() return state.client.pending[export_id] == nil end, 'second export response did not finish')
vim.wait(50)
if table.concat(vim.fn.readfile(export), '\n') ~= 'preserve-existing-export' then fail('export overwrote an existing file') end
vim.fn.delete(export)

vim.api.nvim_set_current_win(state.graph_win)
vim.api.nvim_win_set_cursor(0, { state.node_lines[imported.nodeId] + 1, 0 })
press('K')
local details
for _, win in ipairs(vim.api.nvim_list_wins()) do
  if vim.api.nvim_win_get_config(win).relative ~= '' then
    details = table.concat(vim.api.nvim_buf_get_lines(vim.api.nvim_win_get_buf(win), 0, -1, false), '\n')
    vim.api.nvim_win_close(win, true)
    break
  end
end
if not details or not details:find('Call: resolved', 1, true) then fail('K did not show call analysis details') end

local references, original_references = 0, vim.lsp.buf.references
vim.lsp.buf.references = function() references = references + 1 end
press('gr')
vim.lsp.buf.references = original_references
if references ~= 1 or vim.api.nvim_get_current_buf() ~= tsx_buf then fail('gr did not route through source navigation') end

-- Imported gd must also be blocked after the analyzed TSX source changes.
vim.api.nvim_buf_set_lines(tsx_buf, 14, 15, false, { '  formatTitle(title);' })
vim.api.nvim_set_current_win(state.graph_win)
vim.api.nvim_win_set_cursor(0, { state.node_lines[imported.nodeId] + 1, 0 })
press('gd')
if vim.api.nvim_get_current_buf() ~= state.graph_buf then fail('stale imported gd navigated') end

graph_buf = state.graph_buf
vim.cmd('split')
press('q')
wait_for(function() return state.client == nil end, 'duplicate-window close did not stop analyzer')
if vim.api.nvim_buf_is_valid(graph_buf) then fail('duplicate-window close retained graph buffer') end

print('codeviz integration: ok')
vim.cmd('qa!')
