local root = vim.fn.getcwd()
vim.opt.runtimepath:prepend(root .. '/nvim')
local codeviz = require('codeviz')
codeviz.setup({})
local state = codeviz._state
local Client = require('codeviz.rpc')
local original_new, mock_client = Client.new, nil
Client.new = function() return mock_client end
local scratch = (vim.env.JCODE_SCRATCH_DIR or vim.fn.stdpath('cache')) .. '/codeviz-editor-reaudit-' .. vim.fn.getpid()
vim.fn.mkdir(scratch, 'p')
local buffers, requests, failures = {}, {}, {}
local count = 0
local original_notify = vim.notify
vim.notify = function() end

local function check(value, message)
  if not value then error(message, 0) end
end

local function source(name)
  local buf = vim.api.nvim_create_buf(true, false)
  buffers[#buffers + 1] = buf
  vim.api.nvim_buf_set_name(buf, scratch .. '/' .. name .. '.ts')
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, { 'function main(){ target(); }' })
  return buf
end

local function model(file, target)
  local range = { file = file, startLine = 1, startColumn = 18, endLine = 1, endColumn = 26 }
  return { schemaVersion = 1, entryFunction = { name = 'main', source = range }, nodes = {
    { id = 'n1', kind = 'call', label = 'target()', astKind = 'CallExpression', source = range },
  }, edges = {}, calls = { { nodeId = 'n1', resolution = 'resolved', target = {
    name = 'target', source = target or range,
  } } }, diagnostics = {} }
end

local function open_graph(target)
  local a = source('a')
  vim.api.nvim_set_current_buf(a)
  vim.api.nvim_win_set_cursor(0, { 1, 18 })
  mock_client = {
    stop = function() end,
    request = function(_, method, params, callback)
      if method == 'analyze' then callback(nil, model(params.file, target))
      else requests[#requests + 1] = { callback = callback, params = params } end
    end,
  }
  state.client = mock_client
  codeviz.open()
  return a
end

local function test(name, action)
  count = count + 1
  requests = {}
  local ok, err = pcall(action)
  if not ok then failures[#failures + 1] = name .. ': ' .. tostring(err) end
  pcall(codeviz.close)
  vim.cmd('silent only!')
  for _, buf in ipairs(buffers) do
    if vim.api.nvim_buf_is_valid(buf) then vim.api.nvim_buf_delete(buf, { force = true }) end
  end
  buffers = {}
end

test('export does not rebind an existing graph to another source', function()
  local a = open_graph()
  local b = source('b')
  vim.api.nvim_set_current_win(vim.fn.bufwinid(a))
  vim.api.nvim_set_current_buf(b)
  vim.api.nvim_win_set_cursor(0, { 1, 18 })
  codeviz.export_mermaid(scratch .. '/pending.mmd')
  check(state.source_buf == a, 'export rebound the graph source')
end)

test('failed analysis of another buffer invalidates the old graph', function()
  local a = open_graph()
  vim.api.nvim_set_current_win(vim.fn.bufwinid(a))
  vim.api.nvim_set_current_buf(source('b'))
  state.client.request = function(_, _, _, callback) callback('not in a function', nil) end
  codeviz.open()
  check(state.model == nil, 'old model survived a source switch')
end)

test('stale imported-definition navigation is refused', function()
  local target = source('target')
  local a = open_graph({ file = vim.api.nvim_buf_get_name(target), startLine = 1, startColumn = 1 })
  vim.api.nvim_buf_set_lines(a, 0, 1, false, { 'function main(){ replacement(); }' })
  vim.api.nvim_set_current_win(state.graph_win)
  vim.api.nvim_win_set_cursor(0, { state.node_lines.n1 + 1, 0 })
  vim.fn.maparg('gd', 'n', false, true).callback()
  check(vim.api.nvim_get_current_buf() == state.graph_buf, 'gd navigated from a stale source snapshot')
end)

test('fresh imported-definition navigation still works', function()
  local target = source('target')
  vim.bo[target].modified = false
  open_graph({ file = vim.api.nvim_buf_get_name(target), startLine = 1, startColumn = 1 })
  vim.api.nvim_win_set_cursor(0, { state.node_lines.n1 + 1, 0 })
  vim.fn.maparg('gd', 'n', false, true).callback()
  check(vim.api.nvim_get_current_buf() == target, 'fresh gd did not navigate to its definition')
end)

test('definition navigation refuses an unsaved external target', function()
  local target = source('target')
  open_graph({ file = vim.api.nvim_buf_get_name(target), startLine = 1, startColumn = 1 })
  vim.api.nvim_win_set_cursor(0, { state.node_lines.n1 + 1, 0 })
  vim.fn.maparg('gd', 'n', false, true).callback()
  check(vim.api.nvim_get_current_buf() == state.graph_buf, 'gd used disk coordinates in an unsaved target')
end)

test('close wipes graph buffers displayed in duplicate windows', function()
  open_graph()
  local graph = state.graph_buf
  vim.cmd('split')
  codeviz.close()
  check(not vim.api.nvim_buf_is_valid(graph), 'duplicate window retained the graph buffer')
end)

test('export callback cannot create a file after close', function()
  open_graph()
  local path = scratch .. '/closed.mmd'
  codeviz.export_mermaid(path)
  local callback = requests[1].callback
  codeviz.close()
  callback(nil, 'flowchart TD\n')
  check(vim.fn.getftype(path) == '', 'a queued export wrote after close')
end)

test('export callback ignores an edited source snapshot', function()
  local a = open_graph()
  local path = scratch .. '/stale.mmd'
  codeviz.export_mermaid(path)
  vim.api.nvim_buf_set_lines(a, 0, 1, false, { 'function main(){ changed(); }' })
  requests[1].callback(nil, 'flowchart TD\n')
  check(vim.fn.getftype(path) == '', 'stale export was written')
end)

test('relative export path is fixed at invocation', function()
  open_graph()
  local original_cwd = vim.fn.getcwd()
  local elsewhere = scratch .. '/elsewhere'
  vim.fn.mkdir(elsewhere, 'p')
  vim.cmd('cd ' .. vim.fn.fnameescape(scratch))
  codeviz.export_mermaid('relative.mmd')
  vim.cmd('cd ' .. vim.fn.fnameescape(elsewhere))
  requests[1].callback(nil, 'flowchart TD\n')
  vim.cmd('cd ' .. vim.fn.fnameescape(original_cwd))
  check(vim.fn.filereadable(scratch .. '/relative.mmd') == 1, 'export used callback-time cwd')
end)

test('existing dangling symlinks are never overwritten', function()
  open_graph()
  local target, link = scratch .. '/symlink-target.mmd', scratch .. '/symlink.mmd'
  assert(vim.uv.fs_symlink(target, link))
  codeviz.export_mermaid(link)
  requests[1].callback(nil, 'flowchart TD\n')
  check(vim.fn.getftype(target) == '', 'export followed an existing dangling symlink')
end)

vim.notify = original_notify
Client.new = original_new
vim.fn.delete(scratch, 'rf')
if #failures > 0 then
  for _, failure in ipairs(failures) do print('codeviz editor regression: FAIL ' .. failure) end
  vim.cmd('cquit 1')
else
  print('codeviz editor regressions: ' .. count .. ' passed')
  vim.cmd('qa!')
end
