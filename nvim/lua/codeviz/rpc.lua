local util = require('codeviz.util')

local Client = {}
Client.__index = Client

function Client.new(command, timeout)
  return setmetatable({
    command = command,
    timeout = timeout or 10000,
    job = nil,
    next_id = 1,
    pending = {},
    partial = '',
    stopping = false,
  }, Client)
end

function Client:_fail_all(message)
  local pending = self.pending
  self.pending = {}
  for _, request in pairs(pending) do
    if request.timer then
      request.timer:stop()
      request.timer:close()
    end
    vim.schedule(function() request.callback(message, nil) end)
  end
end

function Client:_line(line)
  if line == '' then return end
  local ok, response = pcall(vim.json.decode, line)
  if not ok or type(response) ~= 'table' or response.id == nil then return end
  local request = self.pending[response.id]
  if not request then return end
  self.pending[response.id] = nil
  if request.timer then
    request.timer:stop()
    request.timer:close()
  end
  local err = response.error and (response.error.message or vim.inspect(response.error)) or nil
  vim.schedule(function() request.callback(err, response.result) end)
end

function Client:_stdout(data)
  if not data then return end
  data[1] = self.partial .. (data[1] or '')
  self.partial = table.remove(data) or ''
  for _, line in ipairs(data) do self:_line(line) end
end

function Client:start()
  if self.job and self.job > 0 then return true end
  self.stopping = false
  self.job = vim.fn.jobstart(self.command, {
    stdin = 'pipe',
    stdout_buffered = false,
    stderr_buffered = false,
    on_stdout = function(job, data) if job == self.job then self:_stdout(data) end end,
    on_stderr = function(job, data)
      if job ~= self.job then return end
      local message = table.concat(data or {}, '\n'):gsub('^%s+', ''):gsub('%s+$', '')
      if message ~= '' then util.notify(message, vim.log.levels.WARN) end
    end,
    on_exit = function(job, code)
      if job ~= self.job then return end
      self.job = nil
      self.partial = ''
      if not self.stopping then self:_fail_all('analyzer exited with code ' .. code) end
    end,
  })
  if self.job <= 0 then
    local code = self.job
    self.job = nil
    return false, 'could not start analyzer (jobstart returned ' .. code .. ')'
  end
  return true
end

function Client:request(method, params, callback)
  local ok, err = self:start()
  if not ok then callback(err, nil); return nil end
  local id = self.next_id
  self.next_id = id + 1
  local timer = vim.loop.new_timer()
  self.pending[id] = { callback = callback, timer = timer }
  timer:start(self.timeout, 0, vim.schedule_wrap(function()
    local request = self.pending[id]
    if not request then return end
    self.pending[id] = nil
    timer:close()
    request.callback(('request %d timed out after %dms'):format(id, self.timeout), nil)
  end))
  local payload = vim.json.encode({ jsonrpc = '2.0', id = id, method = method, params = params }) .. '\n'
  local sent_ok, sent = pcall(vim.fn.chansend, self.job, payload)
  if not sent_ok or sent == 0 then
    self.pending[id] = nil
    timer:stop(); timer:close()
    callback('failed to write request to analyzer', nil)
    return nil
  end
  return id
end

function Client:stop()
  self.stopping = true
  self:_fail_all('analyzer stopped')
  if self.job and self.job > 0 then vim.fn.jobstop(self.job) end
  self.job = nil
  self.partial = ''
end

return Client
