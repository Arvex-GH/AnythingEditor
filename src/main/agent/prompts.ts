import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Phase, Session } from '@shared/types'
import { findLanguage, languageInfo } from '@shared/languages'
import { dataPath, resourcesDir } from '../paths'
import { getSettings } from '../store/settings'
import { firstAvailable } from '../runner'
import { editor } from '../editor/manager'

const PHASE_FILE: Record<Phase, string> = {
  probe: '10-probe.md',
  teach: '20-teach.md',
  project: '30-project.md',
  practice: '40-practice.md'
}

/** Prompt files can be overridden by dropping a file with the same name into <data>/prompts. */
export function readPrompt(name: string): string {
  const override = dataPath('prompts', name)
  if (existsSync(override)) return readFileSync(override, 'utf8')
  return readFileSync(join(resourcesDir(), 'prompts', name), 'utf8')
}

export function listPromptFiles(): string[] {
  return readdirSync(join(resourcesDir(), 'prompts')).filter((f) => f.endsWith('.md'))
}

function toolchainLine(language: string): string {
  const def = findLanguage(language)
  if (!def || def.toolchain.length === 0) return 'Toolchain: not applicable / unknown.'
  const found = firstAvailable(def.toolchain)
  return found
    ? `Toolchain: \`${found}\` is installed, so run_code works for ${def.name}.`
    : `Toolchain: NOT installed (looked for ${def.toolchain.join(', ')}). run_code will fail until the learner installs it from Settings → Doctor${def.winget ? ` (winget id ${def.winget})` : ''}. Tell him once, briefly, when code needs running; you can still teach and read code meanwhile.`
}

export function buildSystemPrompt(session: Session): string {
  const settings = getSettings()
  const parts = [readPrompt('00-base.md'), readPrompt(PHASE_FILE[session.phase]), readPrompt('90-shared.md')]
  const lang = languageInfo(session.language)
  const files = editor.listFiles(session, 80).filter((f) => !f.dir).map((f) => f.rel)
  const ctx: string[] = [
    '# Session context',
    `- Language being learned: **${lang.name}** (id \`${session.language}\`)`,
    `- Session mode: ${session.mode}; current phase: ${session.phase}`,
    `- Platform: ${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'}`,
    `- Editor: ${editor.isActive(session) && editor.mode === 'neovim' ? 'Neovim + LazyVim (LSP diagnostics available, undo with u)' : 'Vim-mode editor'}`,
    `- ${toolchainLine(session.language)}`,
    `- Running code: ${settings.agent.allowRunCode ? 'you may call run_code' : 'DISABLED by the learner — ask him to run code himself'}`,
    `- Preferred quiz style: ${settings.agent.quizStyle === 'mixed' ? 'mix multiple choice and free recall as fits' : settings.agent.quizStyle === 'choice' ? 'multiple choice' : 'free recall'}`,
    settings.agent.learnerName ? `- Learner's name: ${settings.agent.learnerName}` : '',
    settings.agent.language ? `- Answer in: ${settings.agent.language}` : '',
    `- Workspace files (${files.length}): ${files.length ? files.slice(0, 60).join(', ') : '(empty)'}`,
    `- Today: ${new Date().toISOString().slice(0, 10)}`
  ].filter(Boolean)
  if (session.goal) ctx.push(`- Learner's goal: ${session.goal}`)
  if (session.assessment) {
    ctx.push('\n## Probe assessment (from the measuring phase)')
    ctx.push(`Goal: ${session.assessment.goal}`)
    ctx.push(`Summary: ${session.assessment.summary}`)
    for (const s of session.assessment.strands) ctx.push(`- **${s.strand}**${s.level ? ` [${s.level}]` : ''}: ${s.assessment}`)
  }
  if (session.plan) {
    ctx.push('\n## Current plan')
    ctx.push(`Goal: ${session.plan.goal}`)
    for (const n of session.plan.nodes) {
      ctx.push(`- [${n.status === 'done' ? 'x' : n.status === 'current' ? '>' : ' '}] ${n.id}: ${n.title}${n.dependsOn.length ? ` (after ${n.dependsOn.join(', ')})` : ''}`)
    }
  }
  return [...parts, ctx.join('\n')].map((p) => p.trim()).join('\n\n---\n\n')
}
