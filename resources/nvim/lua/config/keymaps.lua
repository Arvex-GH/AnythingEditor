-- Keymaps are automatically loaded on the VeryLazy event.
-- LazyVim defaults: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- AnythingEditor adds (when connected to the app):
--   <leader>as  submit the current exercise to your tutor
--   <leader>ar  run the current file (output appears in the app's Run panel)
--   <leader>aa  ask the tutor about the current line / visual selection
-- This file is yours: AnythingEditor creates it once and never overwrites it.
vim.keymap.set("i", "jk", "<Esc>", { desc = "Exit insert mode" })
