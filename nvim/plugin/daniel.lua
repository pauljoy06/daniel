if vim.g.loaded_daniel then return end
vim.g.loaded_daniel = 1

vim.api.nvim_create_user_command('DanielFlow', function() require('daniel').open() end, {})
vim.api.nvim_create_user_command('DanielExportMermaid', function(args)
  require('daniel').export_mermaid(args.args ~= '' and args.args or nil)
end, { nargs = '?', complete = 'file' })
