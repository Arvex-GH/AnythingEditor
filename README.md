# AnythingEditor

Learn **any** programming language with an AI tutor that sits next to a real editor.

- **Left:** Neovim running a full **LazyVim** configuration, embedded in the app. If Neovim isn't installed, a built-in CodeMirror editor with Vim keybindings is used instead.
- **Right:** a tutor chat for the session. It measures what you know, plans a minimal path to your goal and teaches one step at a time. It writes buggy code for you to fix, fill-in-the-blank skeletons and build tasks straight into the editor, and it reads your code when you submit.
- **Memory:** after every session the ideas you worked on go into a local **knowledge graph**. The graph records concepts, which ones build on which, and evidence of what you demonstrated or struggled with. New sessions start from where you actually stand.

The teaching algorithms (measure → plan → teach, binary-search probing per dependency strand, quiz-after-every-step, a proposition/derivation graph across sessions) are adapted from [LearnHarness](https://github.com/amosblomqvist/learnharness).

## Modes

| Mode | What happens |
| --- | --- |
| **Learn** | *Measure:* the tutor checks your history, then asks short diagnostic questions and gives small editor tasks to find the edge of your understanding. *Plan:* it builds a minimal dependency map to your goal. *Teach:* it goes one reasoning step at a time, checks after each step and repairs gaps before moving on. |
| **Build a project** | Propose a project. The tutor measures the skills it needs, then builds it **with** you: it scaffolds, sets tasks, asks questions and reviews your code. It never hands you the solution. You can point it at an existing folder. |
| **Practice** | Varied exercises drawn from what your knowledge graph says you've learned or found shaky. |

## Install

Download the latest build from **[Releases](https://github.com/Arvex-GH/AnythingEditor/releases/latest)**:

- **Windows:** run `AnythingEditor-Setup-<version>.exe`. The app then appears in the Start menu and in search. A portable `.exe` is also available.
- **Debian / Ubuntu:** `sudo apt install ./AnythingEditor-<version>-amd64.deb`. The app then appears in your application menu.
- **Any Linux:** `chmod +x AnythingEditor-<version>-x86_64.AppImage && ./AnythingEditor-<version>-x86_64.AppImage`. This needs FUSE 2 (`sudo apt install libfuse2`, or `libfuse2t64` on Ubuntu 24.04).

## Requirements

- Windows 10/11 x64, or Linux x64 (AppImage, deb or tar.gz).
- An **OpenAI-compatible** Chat Completions endpoint that supports streaming and tool calling. Examples: OpenAI, OpenRouter, Anthropic, Gemini, DeepSeek, Groq, Mistral, Ollama, LM Studio, vLLM or your own gateway. Set the base URL, key and model in **Settings → Models**.
- Recommended, all installable with one click from **Settings → Doctor** (winget on Windows):
  - Neovim ≥ 0.11, Git and a C compiler (for treesitter);
  - ripgrep, fd and lazygit;
  - the toolchains of the languages you study.

## Editor

The bundled config is the LazyVim starter plus these extras:

- the base set: mini-surround, yanky, inc-rename, illuminate, mini-files, dial, harpoon2, treesitter-context, mini-hipatterns, dot, json/toml/yaml and dap.core;
- language extras (LSP, formatter, debugger) added automatically per language you study;
- any extras you add yourself.

It runs isolated (`NVIM_APPNAME=anything-nvim`) and never touches your own `~/.config/nvim`. You can switch to your own config in Settings.

Tutor keymaps in Neovim:

| Keys | Action |
| --- | --- |
| `<Space>as` | Submit the current exercise |
| `<Space>ar` | Run the current file (output appears in the Run panel) |
| `<Space>aa` | Send the selection / current line to the chat |

## Development

```bash
npm install
npm run dev        # Electron + Vite with hot reload
npm run typecheck
npm test           # node:test unit tests (graph merger, tools, rpc, languages, UI logic)
npm run dist:win   # NSIS installer + portable exe in release/<version>/
npm run dist:linux # AppImage + deb + tar.gz
```

Pushing a `v*` tag runs `.github/workflows/release.yml`. It builds the Windows and Linux packages, smoke-tests the Linux builds under Xvfb and publishes them as a GitHub Release.

Project layout:

```
src/main/          Electron main process
  agent/           LLM client, agent loop, tools, prompts, compaction, graph extraction
  editor/          Neovim (pty + msgpack-rpc) and editor manager
  store/           settings (keys encrypted via OS keychain), sessions, knowledge graph (JSONL ledgers)
src/preload/       typed IPC bridge
src/renderer/      React UI (home, sessions, settings, graph)
resources/nvim/    bundled LazyVim config + tutor integration
resources/prompts/ tutor doctrine (override in <data>/prompts)
```

Data lives in `%APPDATA%/AnythingEditor/data` (Windows) or `~/.config/AnythingEditor/data` (Linux). Set `ANYTHING_DATA_DIR` to override.

## License

MIT
