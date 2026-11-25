## AnythingEditor

AnythingEditor teaches you any programming language with an AI tutor. The tutor works next to an embedded Neovim with LazyVim, and a knowledge graph remembers what you've learned across sessions.

### Downloads
| Platform | File |
| --- | --- |
| **Linux** (any distro) | `AnythingEditor-<version>-x86_64.AppImage`: run `chmod +x` on it, then run it |
| **Debian / Ubuntu / Mint / Pop!_OS** | `AnythingEditor-<version>-amd64.deb`: `sudo apt install ./AnythingEditor-*.deb` |
| Linux (manual) | `AnythingEditor-<version>-x64.tar.gz` |
| **Windows 10/11** | `AnythingEditor-Setup-<version>.exe` (installer) or `AnythingEditor-<version>-portable.exe` |

### Linux notes
- The AppImage needs FUSE 2. On Ubuntu 22.04 and later, install it with `sudo apt install libfuse2` (on 24.04 the package is `libfuse2t64`).
- Neovim **0.11 or newer** is needed for LazyVim. Distro packages are often older, so get it from the [Neovim releases](https://github.com/neovim/neovim/releases) page or with `brew install neovim`. If no suitable Neovim is found, the app uses its built-in Vim-mode editor.
- **Settings → Doctor** shows any missing tools (git, a C compiler, ripgrep, fd, lazygit and language toolchains) along with the command to install each one.

### First run
1. Go to **Settings → Models** and add any OpenAI-compatible endpoint: OpenAI, OpenRouter, Anthropic, Gemini, Ollama, LM Studio or your own.
2. Type what you want to learn on the start screen.
