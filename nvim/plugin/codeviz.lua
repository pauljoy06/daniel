if vim.g.loaded_codeviz then return end
vim.g.loaded_codeviz = 1

vim.api.nvim_create_user_command('CodeVizFlow', function() require('codeviz').open() end, {})
vim.api.nvim_create_user_command('CodeVizExportMermaid', function(args)
  require('codeviz').export_mermaid(args.args ~= '' and args.args or nil)
end, { nargs = '?', complete = 'file' })
