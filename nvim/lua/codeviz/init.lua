local Client = require('codeviz.rpc')
local render = require('codeviz.render')
local util = require('codeviz.util')

local M = {}
local render_ns = vim.api.nvim_create_namespace('codeviz-render')
local current_ns = vim.api.nvim_create_namespace('codeviz-current')
local state = { source_buf = nil, graph_buf = nil, graph_win = nil, model = nil, generation = 0 }

local defaults = {
  command = nil,
  timeout = 10000,
  keymap = nil,
  split = 'botright vnew',
  tsconfig = nil,
}
M.config = vim.deepcopy(defaults)

local function command()
  return M.config.command or { 'node', util.root() .. '/dist/cli/index.js', 'serve' }
end

local function client()
  if not state.client then state.client = Client.new(command(), M.config.timeout) end
  return state.client
end

local function node_by_id(id)
  for _, node in ipairs((state.model and state.model.nodes) or {}) do
    if node.id == id then return node end
  end
end

local function current_node()
  if vim.api.nvim_get_current_buf() ~= state.graph_buf then return nil end
  return node_by_id(state.line_nodes[vim.api.nvim_win_get_cursor(0)[1] - 1])
end

local function source_params(buf, cursor)
  buf = buf or state.source_buf
  if not buf or not vim.api.nvim_buf_is_valid(buf) then return nil, 'source buffer is no longer valid' end
  local name = vim.api.nvim_buf_get_name(buf)
  if name == '' then return nil, 'source buffer must have a file name' end
  if not cursor then
    cursor = vim.api.nvim_get_current_buf() == buf and vim.api.nvim_win_get_cursor(0)
      or state.source_cursor or { 1, 0 }
  end
  local line = vim.api.nvim_buf_get_lines(buf, cursor[1] - 1, cursor[1], false)[1] or ''
  local params = {
    file = vim.fn.fnamemodify(name, ':p'),
    line = cursor[1],
    column = util.byte_to_utf16(line, cursor[2]),
    sourceText = util.read_buffer(buf),
  }
  if M.config.tsconfig then params.tsconfig = M.config.tsconfig end
  return params
end

local function highlight_node(id)
  if not state.graph_buf or not vim.api.nvim_buf_is_valid(state.graph_buf) then return end
  vim.api.nvim_buf_clear_namespace(state.graph_buf, current_ns, 0, -1)
  local line = state.node_lines and state.node_lines[id]
  if line then
    vim.api.nvim_buf_set_extmark(state.graph_buf, current_ns, line, 0, {
      line_hl_group = 'CodeVizCurrentNode', priority = 200,
    })
  end
end

local function jump_source(location)
  if not location then return false end
  if not state.source_buf or not vim.api.nvim_buf_is_valid(state.source_buf)
    or state.analyzed_tick ~= vim.api.nvim_buf_get_changedtick(state.source_buf) then
    util.notify('source changed; press r in the graph to refresh before navigating', vim.log.levels.WARN)
    return false
  end
  local target = vim.fn.bufnr(location.file)
  if target < 0 then target = vim.fn.bufadd(location.file); vim.fn.bufload(target) end
  if target ~= state.source_buf and vim.bo[target].modified then
    util.notify('target has unsaved edits; save and refresh before navigating', vim.log.levels.WARN)
    return false
  end
  local win = vim.fn.bufwinid(target)
  if win == -1 then
    if state.graph_win and vim.api.nvim_win_is_valid(state.graph_win) then vim.api.nvim_set_current_win(state.graph_win) end
    vim.cmd('wincmd p')
    win = vim.api.nvim_get_current_win()
    vim.api.nvim_win_set_buf(win, target)
  else
    vim.api.nvim_set_current_win(win)
  end
  local text = vim.api.nvim_buf_get_lines(target, location.startLine - 1, location.startLine, false)[1] or ''
  vim.api.nvim_win_set_cursor(win, { location.startLine, util.utf16_to_byte(text, location.startColumn) })
  vim.cmd('normal! zv')
  return true
end

local function smallest_node_at(line, column)
  local best, best_size
  for _, node in ipairs((state.model and state.model.nodes) or {}) do
    local s = node.source
    if not node.synthetic and line >= s.startLine and line <= s.endLine
      and (line > s.startLine or column >= s.startColumn)
      and (line < s.endLine or column < s.endColumn) then
      local size = (s.endLine - s.startLine) * 1000000 + s.endColumn - s.startColumn
      if not best_size or size < best_size then best, best_size = node, size end
    end
  end
  return best
end

local function sync_from_source()
  if vim.api.nvim_get_current_buf() ~= state.source_buf then return end
  local cursor = vim.api.nvim_win_get_cursor(0)
  state.source_cursor = cursor
  local text = vim.api.nvim_get_current_line()
  local node = smallest_node_at(cursor[1], util.byte_to_utf16(text, cursor[2]))
  if state.analyzed_tick ~= vim.api.nvim_buf_get_changedtick(state.source_buf) then
    highlight_node(nil)
    return
  end
  highlight_node(node and node.id)
end

local function set_graph_keymaps(buf)
  local map = function(lhs, rhs) vim.keymap.set('n', lhs, rhs, { buffer = buf, silent = true }) end
  map('<CR>', function() local node = current_node(); if node then jump_source(node.source) end end)
  map('<Tab>', function()
    if not state.model or #(state.model.nodes or {}) == 0 then return end
    local node = current_node(); local index
    for i, value in ipairs(state.model.nodes or {}) do if value.id == (node and node.id) then index = i end end
    local next_node = state.model.nodes[((index or 0) % #state.model.nodes) + 1]
    vim.api.nvim_win_set_cursor(0, { state.node_lines[next_node.id] + 1, 0 })
  end)
  map('<S-Tab>', function()
    if not state.model or #(state.model.nodes or {}) == 0 then return end
    local node = current_node(); local index = 1
    for i, value in ipairs(state.model.nodes or {}) do if value.id == (node and node.id) then index = i end end
    local previous = state.model.nodes[((index - 2) % #state.model.nodes) + 1]
    vim.api.nvim_win_set_cursor(0, { state.node_lines[previous.id] + 1, 0 })
  end)
  map('gd', function()
    local node = current_node()
    for _, call in ipairs((state.model and state.model.calls) or {}) do
      if call.nodeId == (node and node.id) and call.resolution == 'resolved' and call.target then
        jump_source(call.target.source); return
      end
    end
    util.notify('no resolved call target for this node', vim.log.levels.INFO)
  end)
  map('gr', function() local node = current_node(); if node and jump_source(node.source) then vim.lsp.buf.references() end end)
  map('K', function()
    local node = current_node()
    if not node then return end
    local lines = { node.kind .. ': ' .. node.label, 'AST: ' .. node.astKind,
      ('Source: %s:%d:%d'):format(node.source.file, node.source.startLine, node.source.startColumn) }
    if node.detail then table.insert(lines, node.detail) end
    for _, call in ipairs(state.model.calls or {}) do
      if call.nodeId == node.id then
        table.insert(lines, 'Call: ' .. call.resolution)
        if call.reason then table.insert(lines, call.reason) end
      end
    end
    vim.lsp.util.open_floating_preview(lines, 'plaintext', { border = 'rounded' })
  end)
  map('r', function() M.refresh() end)
  map('q', function() M.close() end)
end

local function show_model(model)
  state.model = model
  local lines, line_nodes, node_lines = render.build(model)
  state.line_nodes, state.node_lines = line_nodes, node_lines
  if not state.graph_buf or not vim.api.nvim_buf_is_valid(state.graph_buf) then
    vim.cmd(M.config.split)
    state.graph_win = vim.api.nvim_get_current_win()
    state.graph_buf = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_win_set_buf(state.graph_win, state.graph_buf)
    vim.bo[state.graph_buf].buftype = 'nofile'
    vim.bo[state.graph_buf].bufhidden = 'wipe'
    vim.bo[state.graph_buf].swapfile = false
    vim.bo[state.graph_buf].filetype = 'codeviz'
    vim.api.nvim_buf_set_name(state.graph_buf, 'CodeViz Flow')
    set_graph_keymaps(state.graph_buf)
  end
  vim.bo[state.graph_buf].modifiable = true
  vim.api.nvim_buf_set_lines(state.graph_buf, 0, -1, false, lines)
  vim.bo[state.graph_buf].modifiable = false
  vim.api.nvim_buf_clear_namespace(state.graph_buf, render_ns, 0, -1)
  vim.api.nvim_buf_clear_namespace(state.graph_buf, current_ns, 0, -1)
  for id, line in pairs(node_lines) do
    local node = node_by_id(id)
    vim.api.nvim_buf_add_highlight(state.graph_buf, render_ns, 'CodeVizNode', line, 0, -1)
    if node and node.kind == 'condition' then vim.api.nvim_buf_add_highlight(state.graph_buf, render_ns, 'CodeVizCondition', line, 0, -1) end
  end
  if state.graph_win and vim.api.nvim_win_is_valid(state.graph_win) then vim.api.nvim_set_current_win(state.graph_win) end
end

function M.refresh()
  local params, err = source_params()
  if not params then util.notify(err, vim.log.levels.ERROR); return end
  state.generation = state.generation + 1
  local generation = state.generation
  local source_buf = state.source_buf
  local tick = vim.api.nvim_buf_get_changedtick(source_buf)
  client():request('analyze', params, function(request_err, model)
    if generation ~= state.generation or source_buf ~= state.source_buf then return end
    if not vim.api.nvim_buf_is_valid(source_buf) or vim.api.nvim_buf_get_changedtick(source_buf) ~= tick then
      util.notify('source changed while analyzing; refresh to analyze the current buffer', vim.log.levels.WARN)
      return
    end
    if request_err then util.notify(request_err, vim.log.levels.ERROR); return end
    if type(model) ~= 'table' or model.schemaVersion ~= 1 then
      util.notify('analyzer returned an unsupported model', vim.log.levels.ERROR); return
    end
    state.analyzed_tick = tick
    show_model(model)
  end)
end

function M.open()
  local buf = vim.api.nvim_get_current_buf()
  if vim.bo[buf].buftype ~= '' then util.notify('open CodeViz from a source buffer', vim.log.levels.ERROR); return end
  if state.source_buf and state.source_buf ~= buf then M.close() end
  state.source_buf = buf
  state.source_cursor = vim.api.nvim_win_get_cursor(0)
  M.refresh()
end

function M.close()
  state.generation = state.generation + 1
  if state.client then state.client:stop(); state.client = nil end
  local graph_buf = state.graph_buf
  if state.graph_win and vim.api.nvim_win_is_valid(state.graph_win) and #vim.api.nvim_list_wins() > 1 then
    vim.api.nvim_win_close(state.graph_win, true)
  end
  -- A graph can be displayed in duplicate windows. Wipe the buffer itself too.
  if graph_buf and vim.api.nvim_buf_is_valid(graph_buf) then vim.api.nvim_buf_delete(graph_buf, { force = true }) end
  state.graph_buf, state.graph_win, state.model = nil, nil, nil
  state.line_nodes, state.node_lines, state.analyzed_tick = nil, nil, nil
  state.source_buf, state.source_cursor = nil, nil
end

local function present_mermaid(text, path)
  if path and path ~= '' then
    local uv = vim.uv or vim.loop
    local fd, open_err, code = uv.fs_open(path, 'wx', 420)
    if not fd then
      util.notify(code == 'EEXIST' and ('refusing to overwrite existing export: ' .. path)
        or ('cannot create export: ' .. tostring(open_err)), vim.log.levels.ERROR)
      return
    end
    local offset = 0
    while offset < #text do
      local written, write_err = uv.fs_write(fd, text:sub(offset + 1), offset)
      if not written or written == 0 then
        uv.fs_close(fd)
        uv.fs_unlink(path)
        util.notify('cannot write export: ' .. tostring(write_err), vim.log.levels.ERROR)
        return
      end
      offset = offset + written
    end
    local closed, close_err = uv.fs_close(fd)
    if not closed then util.notify('cannot close export: ' .. tostring(close_err), vim.log.levels.ERROR); return end
    util.notify('wrote ' .. path)
    return
  end
  vim.cmd('botright new')
  local buf = vim.api.nvim_get_current_buf()
  vim.bo[buf].buftype = 'nofile'; vim.bo[buf].bufhidden = 'wipe'; vim.bo[buf].swapfile = false
  vim.bo[buf].filetype = 'mermaid'
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, vim.split(text, '\n', { plain = true }))
  vim.bo[buf].modifiable = false
end

function M.export_mermaid(path)
  local buf, cursor = state.source_buf, state.source_cursor
  if vim.bo.buftype == '' then
    buf = vim.api.nvim_get_current_buf()
    cursor = vim.api.nvim_win_get_cursor(0)
  end
  local params, err = source_params(buf, cursor)
  if not params then util.notify(err, vim.log.levels.ERROR); return end
  local generation = state.generation
  local tick = vim.api.nvim_buf_get_changedtick(buf)
  path = path and path ~= '' and vim.fn.fnamemodify(path, ':p') or nil
  client():request('exportMermaid', params, function(request_err, result)
    if generation ~= state.generation then return end
    if not vim.api.nvim_buf_is_valid(buf) or vim.api.nvim_buf_get_changedtick(buf) ~= tick then
      util.notify('source changed while exporting; request a fresh export', vim.log.levels.WARN)
      return
    end
    local text = type(result) == 'string' and result or type(result) == 'table' and (result.mermaid or result.text)
    if request_err or type(text) ~= 'string' then
      util.notify(request_err or 'no model to export', vim.log.levels.ERROR)
      return
    end
    present_mermaid(text, path)
  end)
end

function M.setup(options)
  M.config = vim.tbl_deep_extend('force', vim.deepcopy(defaults), options or {})
  if M.config.keymap then vim.keymap.set('n', M.config.keymap, M.open, { desc = 'CodeViz flow' }) end
end

vim.api.nvim_set_hl(0, 'CodeVizNode', { default = true, link = 'Title' })
vim.api.nvim_set_hl(0, 'CodeVizCondition', { default = true, link = 'Conditional' })
vim.api.nvim_set_hl(0, 'CodeVizCurrentNode', { default = true, link = 'Visual' })

vim.api.nvim_create_autocmd('CursorMoved', { callback = sync_from_source })
vim.api.nvim_create_autocmd('BufWipeout', { callback = function(event)
  if event.buf == state.graph_buf then
    state.generation = state.generation + 1
    if state.client then state.client:stop(); state.client = nil end
    state.graph_buf, state.graph_win, state.model = nil, nil, nil
  end
end })
vim.api.nvim_create_autocmd('VimLeavePre', { callback = function() if state.client then state.client:stop() end end })

M._state = state
M._util = util
return M
