import type { LanguageInfo } from './types'

export interface LanguageDef extends LanguageInfo {
  aliases: string[]
  /** LazyVim extras that give this language LSP/treesitter/formatting support. */
  lazyExtras: string[]
  /** CodeMirror language-data name for the built-in editor. */
  cmName?: string
  /** Executables that indicate the toolchain is present (any of). */
  toolchain: string[]
  winget?: string
  linuxHint?: string
  url?: string
}

export const LANGUAGES: LanguageDef[] = [
  { id: 'python', name: 'Python', aliases: ['py', 'python3'], extensions: ['.py'], mainFile: 'main.py', icon: '', color: '#3776ab', lazyExtras: ['lang.python'], cmName: 'Python', toolchain: ['python', 'python3', 'py'], winget: 'Python.Python.3.13', linuxHint: 'sudo apt install python3', url: 'https://www.python.org/downloads/' },
  { id: 'rust', name: 'Rust', aliases: ['rs'], extensions: ['.rs'], mainFile: 'src/main.rs', icon: '', color: '#dea584', lazyExtras: ['lang.rust', 'lang.toml'], cmName: 'Rust', toolchain: ['cargo', 'rustc'], winget: 'Rustlang.Rustup', linuxHint: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh", url: 'https://rustup.rs' },
  { id: 'csharp', name: 'C#', aliases: ['c#', 'cs', 'dotnet', '.net', 'c sharp', 'csharp'], extensions: ['.cs'], mainFile: 'Program.cs', icon: '󰌛', color: '#68217a', lazyExtras: ['lang.dotnet'], cmName: 'C#', toolchain: ['dotnet'], winget: 'Microsoft.DotNet.SDK.10', linuxHint: 'sudo apt install dotnet-sdk-10.0', url: 'https://dotnet.microsoft.com/download' },
  { id: 'javascript', name: 'JavaScript', aliases: ['js', 'node', 'nodejs'], extensions: ['.js', '.mjs', '.cjs'], mainFile: 'main.js', icon: '', color: '#f1e05a', lazyExtras: ['lang.typescript', 'lang.json'], cmName: 'JavaScript', toolchain: ['node'], winget: 'OpenJS.NodeJS.LTS', linuxHint: 'sudo apt install nodejs', url: 'https://nodejs.org' },
  { id: 'typescript', name: 'TypeScript', aliases: ['ts'], extensions: ['.ts', '.mts', '.cts'], mainFile: 'main.ts', icon: '', color: '#3178c6', lazyExtras: ['lang.typescript', 'lang.json'], cmName: 'TypeScript', toolchain: ['node'], winget: 'OpenJS.NodeJS.LTS', linuxHint: 'sudo apt install nodejs', url: 'https://nodejs.org' },
  { id: 'go', name: 'Go', aliases: ['golang'], extensions: ['.go'], mainFile: 'main.go', icon: '', color: '#00add8', lazyExtras: ['lang.go'], cmName: 'Go', toolchain: ['go'], winget: 'GoLang.Go', linuxHint: 'sudo apt install golang', url: 'https://go.dev/dl/' },
  { id: 'c', name: 'C', aliases: [], extensions: ['.c', '.h'], mainFile: 'main.c', icon: '', color: '#555555', lazyExtras: ['lang.clangd', 'lang.cmake'], cmName: 'C', toolchain: ['gcc', 'clang', 'zig', 'cl'], winget: 'BrechtSanders.WinLibs.POSIX.UCRT', linuxHint: 'sudo apt install build-essential', url: 'https://winlibs.com' },
  { id: 'cpp', name: 'C++', aliases: ['c++', 'cplusplus', 'cxx'], extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh'], mainFile: 'main.cpp', icon: '', color: '#f34b7d', lazyExtras: ['lang.clangd', 'lang.cmake'], cmName: 'C++', toolchain: ['g++', 'clang++', 'zig', 'cl'], winget: 'BrechtSanders.WinLibs.POSIX.UCRT', linuxHint: 'sudo apt install build-essential', url: 'https://winlibs.com' },
  { id: 'java', name: 'Java', aliases: [], extensions: ['.java'], mainFile: 'Main.java', icon: '', color: '#b07219', lazyExtras: ['lang.java'], cmName: 'Java', toolchain: ['java'], winget: 'EclipseAdoptium.Temurin.21.JDK', linuxHint: 'sudo apt install openjdk-21-jdk', url: 'https://adoptium.net' },
  { id: 'kotlin', name: 'Kotlin', aliases: ['kt'], extensions: ['.kt', '.kts'], mainFile: 'Main.kt', icon: '', color: '#a97bff', lazyExtras: ['lang.kotlin'], cmName: 'Kotlin', toolchain: ['kotlinc', 'kotlin'], winget: 'JetBrains.Kotlin.Compiler', linuxHint: 'sdk install kotlin', url: 'https://kotlinlang.org' },
  { id: 'lua', name: 'Lua', aliases: [], extensions: ['.lua'], mainFile: 'main.lua', icon: '', color: '#000080', lazyExtras: [], cmName: 'Lua', toolchain: ['lua', 'luajit', 'nvim'], winget: 'DEVCOM.Lua', linuxHint: 'sudo apt install lua5.4', url: 'https://www.lua.org' },
  { id: 'ruby', name: 'Ruby', aliases: ['rb'], extensions: ['.rb'], mainFile: 'main.rb', icon: '', color: '#701516', lazyExtras: ['lang.ruby'], cmName: 'Ruby', toolchain: ['ruby'], winget: 'RubyInstallerTeam.Ruby.3.4', linuxHint: 'sudo apt install ruby', url: 'https://www.ruby-lang.org' },
  { id: 'php', name: 'PHP', aliases: [], extensions: ['.php'], mainFile: 'main.php', icon: '', color: '#4f5d95', lazyExtras: ['lang.php'], cmName: 'PHP', toolchain: ['php'], winget: 'PHP.PHP.8.4', linuxHint: 'sudo apt install php-cli', url: 'https://www.php.net' },
  { id: 'swift', name: 'Swift', aliases: [], extensions: ['.swift'], mainFile: 'main.swift', icon: '', color: '#f05138', lazyExtras: [], cmName: 'Swift', toolchain: ['swift'], winget: 'Swift.Toolchain', url: 'https://www.swift.org/install' },
  { id: 'haskell', name: 'Haskell', aliases: ['hs'], extensions: ['.hs'], mainFile: 'Main.hs', icon: '', color: '#5e5086', lazyExtras: ['lang.haskell'], cmName: 'Haskell', toolchain: ['runghc', 'ghc'], winget: 'Haskell.GHCup', linuxHint: 'curl --proto =https --tlsv1.2 -sSf https://get-ghcup.haskell.org | sh', url: 'https://www.haskell.org/ghcup/' },
  { id: 'elixir', name: 'Elixir', aliases: ['ex'], extensions: ['.ex', '.exs'], mainFile: 'main.exs', icon: '', color: '#6e4a7e', lazyExtras: ['lang.elixir'], cmName: 'Elixir', toolchain: ['elixir'], winget: 'ElixirLang.Elixir', linuxHint: 'sudo apt install elixir', url: 'https://elixir-lang.org/install.html' },
  { id: 'zig', name: 'Zig', aliases: [], extensions: ['.zig'], mainFile: 'main.zig', icon: '', color: '#ec915c', lazyExtras: ['lang.zig'], cmName: 'Zig', toolchain: ['zig'], winget: 'zig.zig', linuxHint: 'snap install zig --classic', url: 'https://ziglang.org/download/' },
  { id: 'dart', name: 'Dart', aliases: ['flutter'], extensions: ['.dart'], mainFile: 'main.dart', icon: '', color: '#00b4ab', lazyExtras: ['lang.dart'], cmName: 'Dart', toolchain: ['dart'], winget: 'Google.DartSDK', url: 'https://dart.dev/get-dart' },
  { id: 'scala', name: 'Scala', aliases: [], extensions: ['.scala', '.sc'], mainFile: 'Main.scala', icon: '', color: '#c22d40', lazyExtras: ['lang.scala'], cmName: 'Scala', toolchain: ['scala-cli', 'scala'], url: 'https://scala-cli.virtuslab.org/install' },
  { id: 'ocaml', name: 'OCaml', aliases: ['ml'], extensions: ['.ml'], mainFile: 'main.ml', icon: '', color: '#3be133', lazyExtras: ['lang.ocaml'], cmName: 'OCaml', toolchain: ['ocaml'], linuxHint: 'sudo apt install ocaml', url: 'https://ocaml.org/install' },
  { id: 'r', name: 'R', aliases: ['rlang'], extensions: ['.r', '.R'], mainFile: 'main.R', icon: '󰟔', color: '#198ce7', lazyExtras: ['lang.r'], cmName: 'R', toolchain: ['Rscript'], winget: 'RProject.R', linuxHint: 'sudo apt install r-base', url: 'https://cran.r-project.org' },
  { id: 'julia', name: 'Julia', aliases: ['jl'], extensions: ['.jl'], mainFile: 'main.jl', icon: '', color: '#a270ba', lazyExtras: ['lang.julia'], cmName: 'Julia', toolchain: ['julia'], winget: 'Julialang.Juliaup', url: 'https://julialang.org/downloads/' },
  { id: 'perl', name: 'Perl', aliases: ['pl'], extensions: ['.pl'], mainFile: 'main.pl', icon: '', color: '#0298c3', lazyExtras: [], cmName: 'Perl', toolchain: ['perl'], winget: 'StrawberryPerl.StrawberryPerl', linuxHint: 'sudo apt install perl', url: 'https://strawberryperl.com' },
  { id: 'bash', name: 'Bash', aliases: ['shell', 'sh', 'shell scripting'], extensions: ['.sh'], mainFile: 'main.sh', icon: '', color: '#89e051', lazyExtras: [], cmName: 'Shell', toolchain: ['bash'], winget: 'Git.Git', linuxHint: 'preinstalled', url: 'https://git-scm.com' },
  { id: 'powershell', name: 'PowerShell', aliases: ['ps', 'pwsh', 'ps1'], extensions: ['.ps1'], mainFile: 'main.ps1', icon: '󰨊', color: '#012456', lazyExtras: [], cmName: 'PowerShell', toolchain: ['pwsh', 'powershell'], winget: 'Microsoft.PowerShell', url: 'https://aka.ms/powershell' },
  { id: 'sql', name: 'SQL', aliases: ['sqlite', 'mysql', 'postgres', 'postgresql'], extensions: ['.sql'], mainFile: 'main.sql', icon: '', color: '#e38c00', lazyExtras: ['lang.sql'], cmName: 'SQL', toolchain: ['sqlite3'], winget: 'SQLite.SQLite', linuxHint: 'sudo apt install sqlite3', url: 'https://sqlite.org/download.html' },
  { id: 'clojure', name: 'Clojure', aliases: ['clj'], extensions: ['.clj'], mainFile: 'main.clj', icon: '', color: '#db5855', lazyExtras: ['lang.clojure'], cmName: 'Clojure', toolchain: ['clojure', 'clj'], url: 'https://clojure.org/guides/install_clojure' },
  { id: 'erlang', name: 'Erlang', aliases: ['erl'], extensions: ['.erl'], mainFile: 'main.erl', icon: '', color: '#b83998', lazyExtras: ['lang.erlang'], cmName: 'Erlang', toolchain: ['escript', 'erl'], winget: 'Erlang.ErlangOTP', url: 'https://www.erlang.org/downloads' },
  { id: 'gleam', name: 'Gleam', aliases: [], extensions: ['.gleam'], mainFile: 'src/main.gleam', icon: '', color: '#ffaff3', lazyExtras: ['lang.gleam'], toolchain: ['gleam'], url: 'https://gleam.run/getting-started/installing/' },
  { id: 'html', name: 'HTML & CSS', aliases: ['html', 'css', 'web'], extensions: ['.html', '.css'], mainFile: 'index.html', icon: '', color: '#e34c26', lazyExtras: ['lang.tailwind'], cmName: 'HTML', toolchain: [], url: 'https://developer.mozilla.org' }
]

export const BASE_LAZY_EXTRAS = [
  'coding.mini-surround',
  'coding.yanky',
  'editor.inc-rename',
  'editor.illuminate',
  'editor.mini-files',
  'editor.dial',
  'editor.harpoon2',
  'ui.treesitter-context',
  'util.mini-hipatterns',
  'util.dot',
  'lang.json',
  'lang.toml',
  'lang.yaml',
  'dap.core'
]

export function findLanguage(input: string | undefined | null): LanguageDef | undefined {
  if (!input) return undefined
  const q = input.trim().toLowerCase()
  return LANGUAGES.find((l) => l.id === q || l.name.toLowerCase() === q || l.aliases.includes(q))
}

/** Best effort: find a language mentioned in free text ("I want to learn Rust"). */
export function detectLanguage(text: string): LanguageDef | undefined {
  const lower = ` ${text.toLowerCase()} `
  // Multi-character / symbolic names first.
  const special: [RegExp, string][] = [
    [/c\s*#|c\s*sharp|\.net|dotnet/, 'csharp'],
    [/c\+\+|cpp|cplusplus/, 'cpp'],
    [/typescript|\bts\b/, 'typescript'],
    [/javascript|\bnode(js)?\b|\bjs\b/, 'javascript'],
    [/\bgo(lang)?\b/, 'go'],
    [/\bc\b(?!\s*[#+])/, 'c'],
    [/\br\b(?:\s+language|\s+programming)/, 'r']
  ]
  for (const l of LANGUAGES) {
    if (['c', 'go', 'r', 'javascript', 'typescript', 'csharp', 'cpp'].includes(l.id)) continue
    const names = [l.name.toLowerCase(), l.id, ...l.aliases.filter((a) => a.length > 2)]
    for (const n of names) {
      const re = new RegExp(`[^a-z0-9]${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z0-9]`)
      if (re.test(lower)) return l
    }
  }
  for (const [re, id] of special) if (re.test(lower)) return findLanguage(id)
  return undefined
}

export function languageForFile(path: string): LanguageDef | undefined {
  const lower = path.toLowerCase()
  return LANGUAGES.find((l) => l.extensions.some((e) => lower.endsWith(e.toLowerCase())))
}

export function languageInfo(id: string): LanguageInfo {
  const l = findLanguage(id)
  if (l) return { id: l.id, name: l.name, extensions: l.extensions, mainFile: l.mainFile, icon: l.icon, color: l.color }
  return { id, name: id.charAt(0).toUpperCase() + id.slice(1), extensions: [], mainFile: 'main.txt', icon: '', color: '#888' }
}
