local M = {}
local function clean(s) return tostring(s or ''):gsub('[\r\n\t]', ' '):gsub('%c', '?') end
local function wrap(s, width)
  local lines, line = {}, ''
  for _, c in ipairs(vim.fn.split(clean(s), '\\zs')) do
    if vim.fn.strdisplaywidth(line .. c) > width then lines[#lines + 1], line = line, '' end
    line = line .. c
  end
  lines[#lines + 1] = line
  return lines
end
function M.prepare(model, detail, exceptions, wrap_width)
  wrap_width = math.max(20, math.min(156, wrap_width or 48))
  detail = detail or 2
  local graph = { nodes = {}, edges = {}, by_id = {}, members = {}, hidden = 0, uncertain = 0 }
  local incoming, outgoing, calls = {}, {}, {}
  for _, c in ipairs(model.calls or {}) do calls[c.nodeId] = c end
  for _, e in ipairs(model.edges or {}) do
    incoming[e.to] = (incoming[e.to] or 0) + 1
    outgoing[e.from] = outgoing[e.from] or {}; table.insert(outgoing[e.from], e)
  end
  local original = {}; for _, n in ipairs(model.nodes) do original[n.id] = n end
  local used = {}
  for _, node in ipairs(model.nodes) do
    if not used[node.id] then
      local members, n = { node }, node
      used[n.id] = true
      if detail < 3 then
        while n.kind == 'basicBlock' and not n.synthetic and not calls[n.id] and #(outgoing[n.id] or {}) == 1 do
          local e = outgoing[n.id][1]; local next_node = original[e.to]
          if e.type ~= 'next' or not next_node or next_node.kind ~= 'basicBlock' or next_node.synthetic
            or calls[next_node.id] or incoming[next_node.id] ~= 1 or used[next_node.id] then break end
          members[#members + 1] = next_node; used[next_node.id] = true; n = next_node
        end
      end
      local text = { ('[%s] %s%s'):format(node.id, node.kind, #members > 1 and (' x' .. #members) or '') }
      for _, member in ipairs(members) do
        graph.members[member.id] = node.id
        if detail > 1 then text[#text + 1] = member.label end
        if detail == 3 and member.detail then text[#text + 1] = member.detail end
      end
      local call = calls[node.id]
      if node.kind == 'unsupported' or (call and call.resolution ~= 'resolved') then
        graph.uncertain = graph.uncertain + 1; text[#text + 1] = '[? uncertainty] ' .. (call and call.resolution or 'unsupported')
      end
      local lines = {}
      for _, s in ipairs(text) do for _, l in ipairs(wrap(s, wrap_width)) do lines[#lines + 1] = l end end
      if #lines > 28 then while #lines > 27 do table.remove(lines) end; lines[#lines + 1] = '[truncated: K full]' end
      local width = 8; for _, l in ipairs(lines) do width = math.max(width, vim.fn.strdisplaywidth(l) + 4) end
      local display = { id = node.id, width = math.min(160, width), height = #lines + 2, lines = lines, members = members }
      graph.nodes[#graph.nodes + 1] = display; graph.by_id[node.id] = display
    end
  end
  for i, e in ipairs(model.edges or {}) do
    local from, to = graph.members[e.from], graph.members[e.to]
    -- Only the linear next links used by contraction disappear. A back/other
    -- edge between grouped members is still a real self-loop of that group.
    if from ~= to or e.from == e.to or e.type ~= 'next' then
      local source, target = original[e.from], original[e.to]
      local repetitive = e.type == 'exception' and source.kind ~= 'throw' and target.kind ~= 'catch'
        and target.kind ~= 'finally' and not clean(source.label):lower():match('catch') and not clean(source.label):lower():match('finally')
        and not clean(target.label):lower():match('catch') and not clean(target.label):lower():match('finally')
      if not exceptions and repetitive then graph.hidden = graph.hidden + 1
      else
        -- A plain next arrow is self-explanatory. Keep meaningful edge labels
        -- and all edge identities, but avoid a label dummy layer for each step.
        local plain_next = e.type == 'next' and (not e.label or e.label == '') and detail < 3
        local label = not plain_next and clean(e.label or e.type) or nil
        graph.edges[#graph.edges + 1] = { id = e.id or ('edge-' .. i), from = from, to = to,
          label = label, labelWidth = label and vim.fn.strdisplaywidth(label) or nil }
      end
    end
  end
  return graph
end
function M.params(graph)
  local nodes = {}; for _, n in ipairs(graph.nodes) do nodes[#nodes + 1] = { id = n.id, width = n.width, height = n.height } end
  return { nodes = nodes, edges = graph.edges }
end
function M.build(model, graph, layout, failure, depth)
  local source = model.entryFunction.source
  local headers = { ('Daniel Flow: %s | region depth %d | %s:%d:%d-%d:%d'):format(model.entryFunction.name, depth or 0, vim.fn.fnamemodify(source.file, ':t'), source.startLine, source.startColumn, source.endLine, source.endColumn),
    ('%s | %d exception edges hidden | %d uncertainty | +/- detail, e exceptions, F parent, f back'):format(graph.detail or 'normal', graph.hidden, graph.uncertain),
    failure and ('LAYOUT FAILED: labelled cards only | ' .. clean(failure)) or 'Connected flow | crossings marked x (not junctions) | K full detail, [/] group member', '' }
  local grid, positions, line_nodes, node_lines, owners = {}, {}, {}, {}, {}
  local function put(x, y, s, edge)
    grid[y] = grid[y] or {}
    local row = grid[y]
    owners[y] = owners[y] or {}
    if edge and row[x] then
      if row[x] == 'x' or owners[y][x] ~= edge then row[x] = 'x'
      elseif row[x] ~= s then row[x] = '+' end
    else row[x] = s end
    if edge then owners[y][x] = edge end
  end
  local function text(x, y, s)
    local glyph_x
    for _, c in ipairs(vim.fn.split(clean(s), '\\zs')) do
      local w = vim.fn.strdisplaywidth(c)
      if w == 0 then if glyph_x then grid[y][glyph_x] = grid[y][glyph_x] .. c end
      else glyph_x = x; put(x, y, c); for k = 1, w - 1 do put(x + k, y, '') end; x = x + w end
    end
  end
  if failure then
    layout = { nodes = {}, edges = {}, width = 0, height = 0 }
    for _, n in ipairs(graph.nodes) do
      layout.nodes[#layout.nodes + 1] = { id = n.id, x = 0, y = layout.height, width = n.width, height = n.height }
      layout.width = math.max(layout.width, n.width); layout.height = layout.height + n.height + 2
    end
  end
  for _, e in ipairs(layout.edges) do
    for i = 2, #e.points do
      local a, b = e.points[i - 1], e.points[i]
      assert(a.x == b.x or a.y == b.y, 'layout edge is not orthogonal')
      for y = math.min(a.y,b.y), math.max(a.y,b.y) do
        for x = math.min(a.x,b.x), math.max(a.x,b.x) do put(x,y,a.x == b.x and '|' or '-',e.id) end
      end
    end
    local p, prev = e.points[#e.points], e.points[#e.points - 1]
    if p and prev then put(p.x,p.y,p.x > prev.x and '>' or p.x < prev.x and '<' or p.y > prev.y and 'v' or '^') end
  end
  for _, p in ipairs(layout.nodes) do
    local n = assert(graph.by_id[p.id], 'unknown layout node')
    positions[p.id] = { id = p.id, x = p.x, y = p.y + #headers, width = p.width, height = p.height }
    for _, member in ipairs(n.members) do positions[member.id] = positions[p.id]; node_lines[member.id] = p.y + #headers end
    for y = p.y, p.y + p.height - 1 do
      for x = p.x, p.x + p.width - 1 do
        local border = y == p.y or y == p.y + p.height - 1
        put(x,y,border and ((x == p.x or x == p.x + p.width - 1) and '+' or '-') or ((x == p.x or x == p.x + p.width - 1) and '|' or ' '))
      end
      line_nodes[y + #headers] = p.id -- legacy compatibility, never used for hit testing
    end
    for i, l in ipairs(n.lines) do text(p.x + 2,p.y + i,l) end
  end
  for _, e in ipairs(layout.edges) do
    -- Labels are painted after every route, so a later crossing cannot erase
    -- branch text. The backend validates label rectangles against all boxes.
    if e.label then text(e.label.x,e.label.y,e.label.text) end
    local p, prev = e.points[#e.points], e.points[#e.points - 1]
    if p and prev then put(p.x,p.y,p.x > prev.x and '>' or p.x < prev.x and '<' or p.y > prev.y and 'v' or '^') end
  end
  for y = 0, layout.height - 1 do
    local row = {}; for x = 0, layout.width - 1 do row[#row + 1] = (grid[y] or {})[x] or ' ' end
    headers[#headers + 1] = table.concat(row):gsub('%s+$','')
  end
  return headers, line_nodes, node_lines, positions
end
function M.hit(positions, row, col)
  for id, p in pairs(positions or {}) do
    if row >= p.y and row < p.y + p.height and col >= p.x and col < p.x + p.width then return p.id end
  end
end
return M
