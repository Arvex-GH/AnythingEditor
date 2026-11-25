import { languageInfo } from '@shared/languages'

export function LangDot({ language, size = 26 }: { language: string; size?: number }) {
  const l = languageInfo(language)
  return (
    <div className="lang-dot" style={{ width: size, height: size, color: l.color, background: `${l.color}1f` }} title={l.name}>
      {l.icon}
    </div>
  )
}

export function LangBadge({ language }: { language: string }) {
  const l = languageInfo(language)
  return (
    <span className="badge" style={{ color: l.color, background: `${l.color}1c` }}>
      <span style={{ fontFamily: 'var(--mono)' }}>{l.icon}</span> {l.name}
    </span>
  )
}
