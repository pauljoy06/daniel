local M = {}

local kind_icons = {
  entry = '▶', exit = '■', condition = '◇', call = '☎', ['return'] = '↩',
  loop = '↻', throw = '⚠', ['break'] = '⤴', continue = '⟳', basicBlock = '□', unsupported = '?',
}

local function one_line(value)
  return (value or ''):gsub('[\r\n]+', ' ')
end

function M.build(model)
  local outgoing = {}
  local calls = {}
  for _, call in ipairs(model.calls or {}) do calls[call.nodeId] = call end
  for _, edge in ipairs(model.edges or {}) do
    outgoing[edge.from] = outgoing[edge.from] or {}
    table.insert(outgoing[edge.from], edge)
  end
  local lines = {
    ('Daniel Flow: %s%s'):format(model.entryFunction.name, model.entryFunction.async and ' (async)' or ''),
    ('File: %s'):format(model.entryFunction.source.file),
    '',
  }
  local line_nodes, node_lines = {}, {}
  for _, node in ipairs(model.nodes or {}) do
    local start = #lines
    local icon = kind_icons[node.kind] or '•'
    table.insert(lines, ('┌─ %s [%s] %s'):format(icon, node.id, one_line(node.label)))
    table.insert(lines, ('│  %s  %d:%d-%d:%d'):format(node.kind, node.source.startLine,
      node.source.startColumn, node.source.endLine, node.source.endColumn))
    local call = calls[node.id]
    if call then
      table.insert(lines, '│  call: ' .. call.resolution .. (call.reason and (' · ' .. call.reason) or ''))
    end
    if node.detail and node.detail ~= '' then table.insert(lines, '│  ' .. one_line(node.detail)) end
    local edges = outgoing[node.id] or {}
    if #edges == 0 then
      table.insert(lines, '└─ outgoing: ∅')
    else
      table.insert(lines, '├─ outgoing')
      for index, edge in ipairs(edges) do
        local branch = index == #edges and '└' or '├'
        local label = edge.label and edge.label ~= '' and (' ' .. one_line(edge.label)) or ''
        table.insert(lines, ('│  %s─(%s%s)→ [%s]'):format(branch, edge.type, label, edge.to))
      end
      table.insert(lines, '└')
    end
    for line = start, #lines - 1 do line_nodes[line] = node.id end
    node_lines[node.id] = start
    table.insert(lines, '')
  end
  if #(model.diagnostics or {}) > 0 then
    table.insert(lines, 'Diagnostics')
    for _, diagnostic in ipairs(model.diagnostics) do
      table.insert(lines, ('  %s: %s (%d:%d)'):format(diagnostic.code, one_line(diagnostic.message),
        diagnostic.source.startLine, diagnostic.source.startColumn))
    end
  end
  return lines, line_nodes, node_lines
end

return M
