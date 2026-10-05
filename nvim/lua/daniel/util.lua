local M = {}

function M.root()
  local source = debug.getinfo(1, 'S').source:sub(2)
  return vim.fn.fnamemodify(source, ':p:h:h:h:h')
end

function M.utf16_to_byte(line, column)
  local index = math.max(0, (column or 1) - 1)
  local ok, byte = pcall(vim.str_byteindex, line or '', index, true)
  return ok and byte or #(line or '')
end

function M.byte_to_utf16(line, byte)
  local ok, _, utf16 = pcall(vim.str_utfindex, line or '', byte or 0)
  return ok and (utf16 or 0) + 1 or (byte or 0) + 1
end

function M.read_buffer(buf)
  return table.concat(vim.api.nvim_buf_get_lines(buf, 0, -1, false), '\n')
end

function M.notify(message, level)
  vim.schedule(function()
    vim.notify('daniel: ' .. message, level or vim.log.levels.INFO)
  end)
end

return M
