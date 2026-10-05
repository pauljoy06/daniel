local root = vim.fn.getcwd()
vim.opt.runtimepath:prepend(root .. '/nvim')
local daniel = require('daniel')
daniel.setup({})
local state = daniel._state
local Client = require('daniel.rpc')
local original_new, mock_client = Client.new, nil
Client.new = function() return mock_client end
local scratch = (vim.env.JCODE_SCRATCH_DIR or vim.fn.stdpath('cache')) .. '/daniel-editor-reaudit-' .. vim.fn.getpid()
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
      elseif method == 'layout' then
        local nodes, width, height = {}, 0, 0
        for _, n in ipairs(params.nodes) do nodes[#nodes + 1] = { id = n.id, x = 5, y = height, width = n.width, height = n.height }; width = math.max(width, n.width + 5); height = height + n.height + 2 end
        callback(nil, { schemaVersion = 1, width = width, height = height, nodes = nodes, edges = {}, elapsedMs = 0 })
      else requests[#requests + 1] = { callback = callback, params = params } end
    end,
  }
  state.client = mock_client
  daniel.open()
  return a
end

local function test(name, action)
  count = count + 1
  requests = {}
  local ok, err = pcall(action)
  if not ok then failures[#failures + 1] = name .. ': ' .. tostring(err) end
  pcall(daniel.close)
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
  daniel.export_mermaid(scratch .. '/pending.mmd')
  check(state.source_buf == a, 'export rebound the graph source')
end)

test('failed analysis of another buffer invalidates the old graph', function()
  local a = open_graph()
  vim.api.nvim_set_current_win(vim.fn.bufwinid(a))
  vim.api.nvim_set_current_buf(source('b'))
  state.client.request = function(_, _, _, callback) callback('not in a function', nil) end
  daniel.open()
  check(state.model == nil, 'old model survived a source switch')
end)

test('stale imported-definition navigation is refused', function()
  local target = source('target')
  local a = open_graph({ file = vim.api.nvim_buf_get_name(target), startLine = 1, startColumn = 1 })
  vim.api.nvim_buf_set_lines(a, 0, 1, false, { 'function main(){ replacement(); }' })
  vim.api.nvim_set_current_win(state.graph_win)
  vim.api.nvim_win_set_cursor(0, { state.node_positions.n1.y + 1, state.node_positions.n1.x })
  vim.fn.maparg('gd', 'n', false, true).callback()
  check(vim.api.nvim_get_current_buf() == state.graph_buf, 'gd navigated from a stale source snapshot')
end)

test('fresh imported-definition navigation still works', function()
  local target = source('target')
  vim.bo[target].modified = false
  open_graph({ file = vim.api.nvim_buf_get_name(target), startLine = 1, startColumn = 1 })
  vim.api.nvim_win_set_cursor(0, { state.node_positions.n1.y + 1, state.node_positions.n1.x })
  vim.fn.maparg('gd', 'n', false, true).callback()
  check(vim.api.nvim_get_current_buf() == target, 'fresh gd did not navigate to its definition')
end)

test('definition navigation refuses an unsaved external target', function()
  local target = source('target')
  open_graph({ file = vim.api.nvim_buf_get_name(target), startLine = 1, startColumn = 1 })
  vim.api.nvim_win_set_cursor(0, { state.node_positions.n1.y + 1, state.node_positions.n1.x })
  vim.fn.maparg('gd', 'n', false, true).callback()
  check(vim.api.nvim_get_current_buf() == state.graph_buf, 'gd used disk coordinates in an unsaved target')
end)

test('close wipes graph buffers displayed in duplicate windows', function()
  open_graph()
  local graph = state.graph_buf
  vim.cmd('split')
  daniel.close()
  check(not vim.api.nvim_buf_is_valid(graph), 'duplicate window retained the graph buffer')
end)

test('export callback cannot create a file after close', function()
  open_graph()
  local path = scratch .. '/closed.mmd'
  daniel.export_mermaid(path)
  local callback = requests[1].callback
  daniel.close()
  callback(nil, 'flowchart TD\n')
  check(vim.fn.getftype(path) == '', 'a queued export wrote after close')
end)

test('export callback ignores an edited source snapshot', function()
  local a = open_graph()
  local path = scratch .. '/stale.mmd'
  daniel.export_mermaid(path)
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
  daniel.export_mermaid('relative.mmd')
  vim.cmd('cd ' .. vim.fn.fnameescape(elsewhere))
  requests[1].callback(nil, 'flowchart TD\n')
  vim.cmd('cd ' .. vim.fn.fnameescape(original_cwd))
  check(vim.fn.filereadable(scratch .. '/relative.mmd') == 1, 'export used callback-time cwd')
end)

test('existing dangling symlinks are never overwritten', function()
  open_graph()
  local target, link = scratch .. '/symlink-target.mmd', scratch .. '/symlink.mmd'
  assert(vim.uv.fs_symlink(target, link))
  daniel.export_mermaid(link)
  requests[1].callback(nil, 'flowchart TD\n')
  check(vim.fn.getftype(target) == '', 'export followed an existing dangling symlink')
end)

test('layout callbacks respect toggle, resize, edit and close generations', function()
  local a = open_graph()
  local old = state.model
  local queued = {}
  state.client.request = function(_, method, params, callback)
    if method == 'layout' then queued[#queued + 1] = { callback = callback, params = params }
    else callback(nil, model(params.file)) end
  end
  local function finish(index, x)
    local q = queued[index]; local n = q.params.nodes[1]
    q.callback(nil, { schemaVersion = 1, width = x + n.width, height = n.height, nodes = {
      { id = n.id, x = x, y = 0, width = n.width, height = n.height },
    }, edges = {} })
  end
  vim.fn.maparg('+', 'n', false, true).callback()
  vim.fn.maparg('e', 'n', false, true).callback()
  finish(1, 20)
  check(state.node_positions.n1.x == 5, 'obsolete detail layout applied')
  finish(2, 30)
  check(state.node_positions.n1.x == 30, 'latest toggle layout missing')
  vim.cmd('doautocmd VimResized')
  check(vim.wait(1000, function() return #queued == 3 end, 10), 'debounced resize request missing')
  daniel.relayout()
  finish(3, 40)
  check(state.node_positions.n1.x == 30, 'obsolete resize layout applied')
  finish(4, 50)
  check(state.node_positions.n1.x == 50, 'latest resize layout missing')
  daniel.relayout()
  vim.api.nvim_buf_set_lines(a, 0, 1, false, { 'function main(){ changed(); }' })
  finish(5, 60)
  check(state.node_positions.n1.x == 50, 'edited snapshot layout applied')
  daniel.relayout()
  daniel.close()
  finish(6, 70)
  check(state.model == nil and state.graph_buf == nil, 'layout reopened a closed graph')
  check(old ~= nil, 'initial valid graph missing')
end)

test('parent analysis error preserves valid region and original cursor', function()
  open_graph()
  local old = state.model
  local captured
  state.client.request = function(_, method, params, callback)
    captured = params
    callback('no enclosing function', nil)
  end
  vim.fn.maparg('F', 'n', false, true).callback()
  check(captured.functionDepth == 1 and captured.line == 1 and captured.column == 19, 'parent request lost original cursor/depth')
  check(state.model == old and state.depth == 0, 'parent failure destroyed valid region')
end)

test('safe grouping, unicode measurement, truncation and explicit exception preservation', function()
  local renderer = require('daniel.render')
  local m = model('/fixture.ts')
  local range = m.nodes[1].source
  m.calls = {}
  m.nodes = {
    { id = 'a', kind = 'basicBlock', label = '界😀' .. string.rep(' long', 1000), source = range },
    { id = 'b', kind = 'basicBlock', label = 'second', source = range },
    { id = 'c', kind = 'throw', label = 'throw error', source = range },
    { id = 'd', kind = 'basicBlock', label = 'catch (error)', source = range },
    { id = 'z', kind = 'exit', label = 'exit', source = range },
  }
  m.edges = {
    { id = 'ab', from = 'a', to = 'b', type = 'next' },
    { id = 'bc', from = 'b', to = 'c', type = 'next' },
    { id = 'cd', from = 'c', to = 'd', type = 'exception' },
    { id = 'dz', from = 'd', to = 'z', type = 'exception' },
  }
  local g = renderer.prepare(m, 2, false)
  check(g.members.b == 'a' and g.members.c == 'c', 'unsafe grouping or safe grouping missing')
  check(g.hidden == 0 and #g.edges == 3, 'explicit throw/catch path hidden')
  for _, n in ipairs(g.nodes) do
    check(n.width <= 160 and n.height <= 30, 'node dimensions exceed cap')
    for _, line in ipairs(n.lines) do check(vim.fn.strdisplaywidth(line) <= n.width - 4, 'unicode label escapes box') end
  end
  check(table.concat(g.nodes[1].lines, '\n'):find('truncated', 1, true), 'truncation unmarked')
  check(#renderer.prepare(m, 3, true).nodes == 5, 'detailed view grouped nodes')
  local lines = renderer.build(m, g, nil, 'backend unavailable', 0)
  check(lines[3]:find('LAYOUT FAILED', 1, true), 'failure silently fell back')
end)

test('self loops and same-label parallel edges retain original identities', function()
  local renderer = require('daniel.render')
  local m = model('/fixture.ts')
  m.edges = {
    { id = 'loop-a', from = 'n1', to = 'n1', type = 'back', label = 'again' },
    { id = 'loop-b', from = 'n1', to = 'n1', type = 'back', label = 'again' },
  }
  local g = renderer.prepare(m, 2, false)
  check(#g.edges == 2 and g.edges[1].id == 'loop-a' and g.edges[2].id == 'loop-b', 'self-loop or parallel identity lost')
end)

test('group selection uses canonical box and exact member source', function()
  local a = open_graph()
  state.detail = 2
  local m = model(vim.api.nvim_buf_get_name(a))
  m.calls = {}
  m.nodes[1].kind = 'basicBlock'
  m.nodes[2] = vim.deepcopy(m.nodes[1])
  m.nodes[2].id, m.nodes[2].label = 'n2', 'second'
  m.nodes[2].source.startColumn = 20
  m.edges = { { id = 'sequence', from = 'n1', to = 'n2', type = 'next' } }
  local request = state.client.request
  state.client.request = function(self, method, params, callback)
    if method == 'analyze' then callback(nil, m) else request(self, method, params, callback) end
  end
  daniel.refresh()
  local p = state.node_positions.n2
  check(require('daniel.render').hit(state.node_positions, p.y + 1, p.x + 1) == 'n1', 'group hit returned arbitrary alias')
  vim.api.nvim_win_set_cursor(0, { p.y + 1, p.x })
  vim.fn.maparg(']', 'n', false, true).callback()
  local header = vim.api.nvim_buf_get_lines(state.graph_buf, 3, 4, false)[1]
  check(header:find('member 2/2 [n2]', 1, true), 'selected member absent from stable header')
  vim.fn.maparg('<CR>', 'n', false, true).callback()
  check(vim.api.nvim_get_current_buf() == a and vim.api.nvim_win_get_cursor(0)[2] == 19, 'group member Enter lost exact location')
end)

test('wide combining glyph stays intact in cell grid', function()
  local renderer = require('daniel.render')
  local m = model('/fixture.ts')
  m.nodes[1].label = '界́ 😀 é'
  local g = renderer.prepare(m, 2, false)
  local n = g.nodes[1]
  local lines = renderer.build(m, g, { nodes = { { id = n.id, x = 3, y = 0, width = n.width, height = n.height } }, edges = {}, width = n.width + 3, height = n.height })
  check(table.concat(lines, '\n'):find('界́ 😀 é', 1, true), 'combining glyph detached from wide character')
  check(vim.fn.strdisplaywidth(lines[6]) == n.width + 3, 'combining glyph shifted box geometry')
end)

test('graph export keeps committed region, source export defaults to cursor depth zero', function()
  local a = open_graph()
  state.depth = 1
  state.source_cursor = { 1, 2 }
  daniel.export_mermaid(scratch .. '/region.mmd')
  check(requests[1].params.functionDepth == 1 and requests[1].params.column == 19, 'graph export lost selected region')
  vim.api.nvim_set_current_win(vim.fn.bufwinid(a))
  vim.api.nvim_win_set_cursor(0, { 1, 2 })
  daniel.export_mermaid(scratch .. '/cursor.mmd')
  check(requests[2].params.functionDepth == 0 and requests[2].params.column == 3, 'source export reused graph region')
  check(state.depth == 1, 'source export mutated committed graph region')
end)

test('viewport wrapping is bounded and deterministic', function()
  local renderer = require('daniel.render')
  local m = model('/fixture.ts')
  m.nodes[1].label = string.rep('界 text ', 20)
  local narrow = renderer.prepare(m, 2, false, 20)
  local wide = renderer.prepare(m, 2, false, 48)
  check(narrow.nodes[1].width <= 24 and wide.nodes[1].width <= 52, 'viewport label width ignored')
  check(narrow.nodes[1].height > wide.nodes[1].height, 'resize did not change measured wrapping')
  check(vim.deep_equal(narrow, renderer.prepare(m, 2, false, 20)), 'viewport preparation is nondeterministic')
end)

test('resize bursts coalesce, preserve source focus and reject deferred close', function()
  local a = open_graph()
  local deferred, queued = {}, {}
  local original_defer = vim.defer_fn
  vim.defer_fn = function(callback, delay)
    check(delay == 80, 'resize debounce delay changed')
    deferred[#deferred + 1] = callback
  end
  local ok, err = pcall(function()
    state.client.request = function(_, method, params, callback)
      check(method == 'layout', 'resize unexpectedly analyzed')
      queued[#queued + 1] = { params = params, callback = callback }
    end
    vim.api.nvim_set_current_win(vim.fn.bufwinid(a))
    local focused = vim.api.nvim_get_current_win()
    vim.cmd('doautocmd VimResized')
    vim.cmd('doautocmd VimResized')
    if vim.fn.exists('##WinResized') == 1 then vim.cmd('doautocmd WinResized') end
    for i = 1, #deferred - 1 do deferred[i]() end
    check(#queued == 0, 'obsolete burst events issued requests')
    deferred[#deferred]()
    check(#queued == 1, 'last resize event did not issue exactly one request')
    local n = queued[1].params.nodes[1]
    queued[1].callback(nil, { schemaVersion = 1, width = n.width + 5, height = n.height,
      nodes = { { id = n.id, x = 5, y = 0, width = n.width, height = n.height } }, edges = {} })
    check(vim.api.nvim_get_current_win() == focused, 'resize completion stole source focus')
    vim.cmd('doautocmd VimResized')
    local last = deferred[#deferred]
    daniel.close()
    last()
    check(#queued == 1, 'deferred resize issued a request after close')
  end)
  vim.defer_fn = original_defer
  if not ok then error(err, 0) end
end)

test('pinned warnings and quiet next arrows preserve full model identity', function()
  state.detail, state.exceptions = 2, false
  open_graph()
  check(vim.wo[state.graph_win].winbar:find('e:0h', 1, true), 'hidden-edge summary scrolls away')
  check(vim.wo[state.graph_win].winbar:find('?:0', 1, true), 'uncertainty summary not pinned')
  local renderer = require('daniel.render')
  local m = model('/fixture.ts')
  m.nodes[2] = vim.deepcopy(m.nodes[1]); m.nodes[2].id = 'n2'
  m.edges = { { id = 'next-id', from = 'n1', to = 'n2', type = 'next' } }
  local normal = renderer.prepare(m, 2, false)
  check(normal.edges[1].id == 'next-id' and normal.edges[1].label == nil, 'normal view invents/drops next edge')
  check(renderer.prepare(m, 3, true).edges[1].label == 'next', 'full edge label lost in detailed view')
  check(m.edges[1].type == 'next' and m.edges[1].label == nil, 'presentation mutated model')
end)

test('later routes cannot erase labels or turn a crossing into a junction', function()
  local renderer = require('daniel.render')
  local m = model('/fixture.ts')
  m.edges = { { id = 'a', from = 'n1', to = 'n1', type = 'back' }, { id = 'b', from = 'n1', to = 'n1', type = 'back' } }
  local g = renderer.prepare(m, 2, false)
  local n = g.nodes[1]
  local lines, _, _, positions = renderer.build(m, g, {
    width = 50, height = 30,
    nodes = { { id = n.id, x = 0, y = 0, width = n.width, height = n.height } },
    edges = {
      { id = 'a', points = { {x=4,y=n.height-1}, {x=4,y=20}, {x=0,y=20}, {x=0,y=1} }, label = { text='true', x=4, y=10, width=4 } },
      { id = 'b', points = { {x=5,y=n.height-1}, {x=5,y=8}, {x=4,y=8}, {x=4,y=12}, {x=10,y=12}, {x=10,y=1}, {x=n.width-1,y=1} } },
    },
  })
  local offset = positions.n1.y
  check(lines[offset + 11]:sub(5, 8) == 'true', 'crossing route erased branch label')
  check(lines[offset + 13]:sub(5, 5) == 'x', 'revisited crossing became a false junction')
end)

test('contraction preserves back edges between distinct grouped members', function()
  local renderer = require('daniel.render')
  local m = model('/fixture.ts')
  m.calls = {}
  m.nodes[1].kind = 'basicBlock'
  m.nodes[2] = vim.deepcopy(m.nodes[1]); m.nodes[2].id = 'n2'
  m.edges = {
    { id = 'next', from = 'n1', to = 'n2', type = 'next' },
    { id = 'back', from = 'n2', to = 'n1', type = 'back' },
  }
  local g = renderer.prepare(m, 2, false)
  check(#g.nodes == 1 and #g.edges == 1, 'linear contraction lost or duplicated cycle edges')
  check(g.edges[1].id == 'back' and g.edges[1].from == 'n1' and g.edges[1].to == 'n1', 'group cycle lost identity')
  check(#renderer.prepare(m, 3, true).edges == 2, 'full model cycle changed')
end)

vim.notify = original_notify
Client.new = original_new
vim.fn.delete(scratch, 'rf')
if #failures > 0 then
  for _, failure in ipairs(failures) do print('daniel editor regression: FAIL ' .. failure) end
  vim.cmd('cquit 1')
else
  print('daniel editor regressions: ' .. count .. ' passed')
  vim.cmd('qa!')
end
