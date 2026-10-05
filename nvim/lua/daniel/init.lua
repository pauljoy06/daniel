local Client = require('daniel.rpc')
local render = require('daniel.render')
local util = require('daniel.util')

local M = {}
local render_ns = vim.api.nvim_create_namespace('daniel-render')
local current_ns = vim.api.nvim_create_namespace('daniel-current')
local state = { source_buf = nil, graph_buf = nil, graph_win = nil, model = nil, generation = 0, detail = 2, exceptions = false, depth = 0, member = {} }

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
  local cursor = vim.api.nvim_win_get_cursor(0)
  local line = vim.api.nvim_get_current_line()
  local col = vim.fn.strdisplaywidth(line:sub(1, cursor[2]))
  local id = render.hit(state.node_positions, cursor[1] - 1, col)
  local group = state.display and state.display.by_id[state.display.members[id]]
  return group and group.members[state.member[group.id] or 1] or node_by_id(id)
end

local function selection_status()
  if vim.api.nvim_get_current_buf() ~= state.graph_buf then return end
  local node = current_node()
  local group = node and state.display.by_id[state.display.members[node.id]]
  local text = 'Selected: none | [/] cycle group members'
  if group then
    local index = state.member[group.id] or 1
    text = ('Selected [%s] member %d/%d [%s] | %s:%d:%d-%d:%d'):format(group.id, index, #group.members, node.id,
      node.source.file, node.source.startLine, node.source.startColumn, node.source.endLine, node.source.endColumn)
  end
  local old = vim.api.nvim_buf_get_lines(state.graph_buf, 3, 4, false)[1]
  if old ~= text then
    vim.bo[state.graph_buf].modifiable = true
    vim.api.nvim_buf_set_lines(state.graph_buf, 3, 4, false, { text })
    vim.bo[state.graph_buf].modifiable = false
  end
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

local function cell_byte(line, cell)
  local byte, width = 0, 0
  for _, c in ipairs(vim.fn.split(line, '\\zs')) do
    if width >= cell then break end
    byte = byte + #c; width = width + vim.fn.strdisplaywidth(c)
  end
  return byte
end

local function center_node(id)
  local owner = state.display and state.display.members[id]
  if owner and state.member[owner] then state.member[owner] = 1 end
  local p = state.node_positions and state.node_positions[id]
  if not p or not state.graph_win or not vim.api.nvim_win_is_valid(state.graph_win) then return end
  vim.api.nvim_win_call(state.graph_win, function()
    local row, col = p.y + math.floor(p.height / 2), p.x + math.floor(p.width / 2)
    local line = vim.api.nvim_buf_get_lines(state.graph_buf, row, row + 1, false)[1] or ''
    vim.api.nvim_win_set_cursor(0, { row + 1, cell_byte(line, col) })
    local view = vim.fn.winsaveview()
    view.topline = math.max(1, row + 1 - math.floor(vim.api.nvim_win_get_height(0) / 2))
    view.leftcol = math.max(0, col - math.floor(vim.api.nvim_win_get_width(0) / 2))
    vim.fn.winrestview(view)
    selection_status()
  end)
end

local function highlight_node(id)
  if not state.graph_buf or not vim.api.nvim_buf_is_valid(state.graph_buf) then return end
  vim.api.nvim_buf_clear_namespace(state.graph_buf, current_ns, 0, -1)
  local p = state.node_positions and state.node_positions[id]
  if p then
    for row = p.y, p.y + p.height - 1 do
      local line = vim.api.nvim_buf_get_lines(state.graph_buf, row, row + 1, false)[1] or ''
      vim.api.nvim_buf_set_extmark(state.graph_buf, current_ns, row, cell_byte(line, p.x), {
        end_col = cell_byte(line, p.x + p.width), hl_group = 'DanielCurrentNode', priority = 200,
      })
    end
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
    center_node(next_node.id)
    local owner = state.display.members[next_node.id]
    for i, member in ipairs(state.display.by_id[owner].members) do if member.id == next_node.id then state.member[owner] = i end end
    selection_status()
  end)
  map('<S-Tab>', function()
    if not state.model or #(state.model.nodes or {}) == 0 then return end
    local node = current_node(); local index = 1
    for i, value in ipairs(state.model.nodes or {}) do if value.id == (node and node.id) then index = i end end
    local previous = state.model.nodes[((index - 2) % #state.model.nodes) + 1]
    center_node(previous.id)
    local owner = state.display.members[previous.id]
    for i, member in ipairs(state.display.by_id[owner].members) do if member.id == previous.id then state.member[owner] = i end end
    selection_status()
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
    local lines = { node.kind .. ': ' .. node.label, 'AST: ' .. (node.astKind or '?'),
      ('Source: %s:%d:%d-%d:%d'):format(node.source.file, node.source.startLine, node.source.startColumn, node.source.endLine, node.source.endColumn) }
    local group = state.display.by_id[state.display.members[node.id]]
    if #group.members > 1 then
      table.insert(lines, 'Group members (exact provenance):')
      for _, member in ipairs(group.members) do
        table.insert(lines, ('[%s] %s @ %s:%d:%d-%d:%d'):format(member.id, member.label, member.source.file, member.source.startLine, member.source.startColumn, member.source.endLine, member.source.endColumn))
        if member.detail then table.insert(lines, member.detail) end
      end
    end
    for _, diagnostic in ipairs(state.model.diagnostics or {}) do table.insert(lines, diagnostic.code .. ': ' .. diagnostic.message) end
    if node.detail then table.insert(lines, node.detail) end
    for _, call in ipairs(state.model.calls or {}) do
      if call.nodeId == node.id then
        table.insert(lines, 'Call: ' .. call.resolution)
        if call.reason then table.insert(lines, call.reason) end
      end
    end
    lines = vim.split(table.concat(lines, '\n'), '\n', { plain = true })
    vim.lsp.util.open_floating_preview(lines, 'plaintext', { border = 'rounded' })
  end)
  map('+', function() state.detail = math.min(3, state.detail + 1); M.relayout() end)
  map('-', function() state.detail = math.max(1, state.detail - 1); M.relayout() end)
  map('e', function() state.exceptions = not state.exceptions; M.relayout() end)
  map('F', function() M.refresh(state.depth + 1) end)
  map('f', function() M.refresh(math.max(0, state.depth - 1)) end)
  for key, delta in pairs({ ['['] = -1, [']'] = 1 }) do
    map(key, function()
      local node = current_node()
      local group = node and state.display.by_id[state.display.members[node.id]]
      if group then
        state.member[group.id] = ((state.member[group.id] or 1) - 1 + delta) % #group.members + 1
        highlight_node(group.id)
        selection_status()
        util.notify(('member %d/%d: %s'):format(state.member[group.id], #group.members, group.members[state.member[group.id]].label), vim.log.levels.INFO)
      end
    end)
  end
  map('r', function() M.refresh() end)
  map('q', function() M.close() end)
end

local function show_model(model, display, layout, failure, depth, tick, preserve_focus)
  local ok, lines, line_nodes, node_lines, positions = pcall(render.build, model, display, layout, failure, depth)
  if not ok then
    failure = tostring(lines)
    lines, line_nodes, node_lines, positions = render.build(model, display, nil, failure, depth)
  end
  local selected = current_node()
  state.model, state.display, state.depth, state.analyzed_tick = model, display, depth, tick
  state.line_nodes, state.node_lines, state.node_positions = line_nodes, node_lines, positions
  if not state.graph_buf or not vim.api.nvim_buf_is_valid(state.graph_buf) then
    vim.cmd(M.config.split)
    state.graph_win = vim.api.nvim_get_current_win()
    state.graph_buf = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_win_set_buf(state.graph_win, state.graph_buf)
    vim.bo[state.graph_buf].buftype = 'nofile'
    vim.bo[state.graph_buf].bufhidden = 'wipe'
    vim.bo[state.graph_buf].swapfile = false
    vim.bo[state.graph_buf].filetype = 'daniel'
    vim.api.nvim_buf_set_name(state.graph_buf, 'Daniel Flow')
    set_graph_keymaps(state.graph_buf)
  end
  vim.bo[state.graph_buf].modifiable = true
  vim.api.nvim_buf_set_lines(state.graph_buf, 0, -1, false, lines)
  vim.bo[state.graph_buf].modifiable = false
  vim.api.nvim_buf_clear_namespace(state.graph_buf, render_ns, 0, -1)
  vim.api.nvim_buf_clear_namespace(state.graph_buf, current_ns, 0, -1)
  for id, line in pairs(node_lines) do
    local node = node_by_id(id)
    local p = positions[id]
    local text = lines[line + 1] or ''
    vim.api.nvim_buf_add_highlight(state.graph_buf, render_ns, node and node.kind == 'condition' and 'DanielCondition' or 'DanielNode', line, cell_byte(text, p.x), cell_byte(text, p.x + p.width))
  end
  if state.graph_win and vim.api.nvim_win_is_valid(state.graph_win) then
    -- Buffer headers scroll away. Keep simplification/uncertainty visible.
    local prefix = failure and '!layout' or 'Daniel'
    vim.wo[state.graph_win].winbar = ('%s %s | e:%dh | ?:%d'):format(prefix,
      ({ 'S', 'N', 'D' })[state.detail], display.hidden, display.uncertain)
    for _, option in ipairs({ 'wrap', 'number', 'relativenumber', 'foldenable', 'cursorline' }) do vim.wo[state.graph_win][option] = false end
    if not preserve_focus then vim.api.nvim_set_current_win(state.graph_win) end
    center_node(selected and positions[selected.id] and selected.id or (model.nodes[1] and model.nodes[1].id))
  end
end

local function request_layout(model, generation, source_buf, tick, depth, preserve_focus)
  state.analysis_generation = nil
  local viewport
  if state.graph_win and vim.api.nvim_win_is_valid(state.graph_win) then viewport = vim.api.nvim_win_get_width(state.graph_win)
  else
    viewport = vim.api.nvim_win_get_width(0)
    if M.config.split:match('vnew') or M.config.split:match('vsplit') then viewport = math.floor(viewport / 2) end
  end
  local wrap_width = math.max(20, math.min(48, math.floor(viewport / 2) - 6))
  local display = render.prepare(model, state.detail, state.exceptions, wrap_width)
  display.wrap_width = wrap_width
  display.detail = ({ 'structural', 'normal', 'detailed' })[state.detail]
  client():request('layout', render.params(display), function(err, layout)
    if generation ~= state.generation or source_buf ~= state.source_buf then return end
    if not vim.api.nvim_buf_is_valid(source_buf) or vim.api.nvim_buf_get_changedtick(source_buf) ~= tick then return end
    if not err and (type(layout) ~= 'table' or layout.schemaVersion ~= 1) then err = 'unsupported layout response' end
    show_model(model, display, layout, err, depth, tick, preserve_focus)
  end)
end

function M.relayout(preserve_focus)
  if state.analysis_generation == state.generation then M.refresh(state.requested_depth, preserve_focus); return end
  state.generation = state.generation + 1
  if state.model and state.source_buf then
    request_layout(state.model, state.generation, state.source_buf, state.analyzed_tick, state.depth, preserve_focus)
  elseif state.source_buf then M.refresh() end
end

function M.refresh(depth, preserve_focus)
  local params, err = source_params(state.source_buf, state.original_cursor or state.source_cursor)
  depth = depth or state.depth
  if params then params.functionDepth = depth end
  if not params then util.notify(err, vim.log.levels.ERROR); return end
  state.generation = state.generation + 1
  local generation = state.generation
  state.analysis_generation, state.requested_depth = generation, depth
  local source_buf = state.source_buf
  local tick = vim.api.nvim_buf_get_changedtick(source_buf)
  client():request('analyze', params, function(request_err, model)
    if generation ~= state.generation or source_buf ~= state.source_buf then return end
    if not vim.api.nvim_buf_is_valid(source_buf) or vim.api.nvim_buf_get_changedtick(source_buf) ~= tick then
      util.notify('source changed while analyzing; refresh to analyze the current buffer', vim.log.levels.WARN)
      return
    end
    if request_err then state.analysis_generation = nil; util.notify(request_err, vim.log.levels.ERROR); return end
    if type(model) ~= 'table' or model.schemaVersion ~= 1 then
      util.notify('analyzer returned an unsupported model', vim.log.levels.ERROR); return
    end
    request_layout(model, generation, source_buf, tick, depth, preserve_focus)
  end)
end

function M.open()
  local buf = vim.api.nvim_get_current_buf()
  if vim.bo[buf].buftype ~= '' then util.notify('open Daniel from a source buffer', vim.log.levels.ERROR); return end
  if state.source_buf and state.source_buf ~= buf then M.close() end
  state.source_buf = buf
  state.source_cursor = vim.api.nvim_win_get_cursor(0)
  state.original_cursor = vim.deepcopy(state.source_cursor)
  state.depth = 0
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
  state.member, state.detail, state.exceptions, state.depth, state.analysis_generation = {}, 2, false, 0, nil
  state.source_buf, state.source_cursor, state.original_cursor, state.node_positions, state.display = nil, nil, nil, nil, nil
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
  local from_graph = vim.api.nvim_get_current_buf() == state.graph_buf
  local buf, cursor = state.source_buf, from_graph and state.original_cursor or state.source_cursor
  if vim.bo.buftype == '' then
    buf = vim.api.nvim_get_current_buf()
    cursor = vim.api.nvim_win_get_cursor(0)
  end
  local params, err = source_params(buf, cursor)
  if params then params.functionDepth = from_graph and state.depth or 0 end
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
  if M.config.keymap then vim.keymap.set('n', M.config.keymap, M.open, { desc = 'Daniel flow' }) end
end

vim.api.nvim_set_hl(0, 'DanielNode', { default = true, link = 'Title' })
vim.api.nvim_set_hl(0, 'DanielCondition', { default = true, link = 'Conditional' })
vim.api.nvim_set_hl(0, 'DanielCurrentNode', { default = true, link = 'Visual' })

local function resize_layout()
  if not state.model or not state.graph_win or not vim.api.nvim_win_is_valid(state.graph_win) then return end
  state.resize_sequence = (state.resize_sequence or 0) + 1
  local sequence, generation, win = state.resize_sequence, state.generation, state.graph_win
  vim.defer_fn(function()
    if sequence ~= state.resize_sequence or generation ~= state.generation or win ~= state.graph_win
      or not vim.api.nvim_win_is_valid(win) or not state.model then return end
    M.relayout(true)
  end, 80)
end
vim.api.nvim_create_autocmd('VimResized', { callback = resize_layout })
if vim.fn.exists('##WinResized') == 1 then vim.api.nvim_create_autocmd('WinResized', { callback = resize_layout }) end
vim.api.nvim_create_autocmd('CursorMoved', { callback = function() sync_from_source(); selection_status() end })
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
