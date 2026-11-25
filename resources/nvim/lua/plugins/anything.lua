-- Managed by AnythingEditor. Edits to this file are overwritten on update.
return {
  -- Colorscheme matching the AnythingEditor UI.
  { "folke/tokyonight.nvim", opts = { style = "night", transparent = false } },
  { "LazyVim/LazyVim", opts = { colorscheme = "tokyonight" } },

  -- Which-key group for the tutor integration keymaps.
  {
    "folke/which-key.nvim",
    opts = {
      spec = {
        { "<leader>a", group = "AnythingEditor tutor", icon = "󰭹 " },
      },
    },
  },

  -- A calmer dashboard (shown only when no file is opened).
  {
    "folke/snacks.nvim",
    opts = {
      dashboard = {
        preset = {
          header = [[
    ___                __  __    _           ______    ___ __
   /   |  ____  __  __/ /_/ /_  (_)___  ____/ ____/___/ (_) /_____  _____
  / /| | / __ \/ / / / __/ __ \/ / __ \/ __ `/ __/ / __  / / __/ __ \/ ___/
 / ___ |/ / / / /_/ / /_/ / / / / / / / /_/ / /___/ /_/ / / /_/ /_/ / /
/_/  |_/_/ /_/\__, /\__/_/ /_/_/_/ /_/\__, /_____/\__,_/_/\__/\____/_/
             /____/                  /____/ ]],
        },
      },
      -- Start every exercise in a clean state; don't restore old sessions.
      scroll = { enabled = false },
    },
  },

  -- Keep mason quiet about tools that need missing toolchains.
  { "mason-org/mason.nvim", opts = { ui = { border = "rounded" } } },
}
