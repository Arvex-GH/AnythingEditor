import { useState } from 'react'
import type { Plan } from '@shared/types'
import { orderPlan } from '../lib/logic'
import { Icon } from './Icon'

export function PlanPanel({ plan }: { plan: Plan }) {
  const [open, setOpen] = useState(false)
  const nodes = orderPlan(plan.nodes)
  const done = nodes.filter((n) => n.status === 'done').length
  const current = nodes.find((n) => n.status === 'current')
  return (
    <div className="plan">
      <div className="plan-head" onClick={() => setOpen((o) => !o)}>
        <Icon name="map" size={13} />
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>{current ? current.title : done === nodes.length && nodes.length ? 'Plan complete' : 'Plan'}</span>
        <div className="bar">
          <div style={{ width: `${nodes.length ? (done / nodes.length) * 100 : 0}%` }} />
        </div>
        <span>
          {done}/{nodes.length}
        </span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
      </div>
      {open && (
        <div className="plan-body">
          <div className="plan-goal">Goal: {plan.goal}</div>
          {nodes.map((n) => (
            <div key={n.id} className={`plan-node ${n.status}`}>
              <span className="mark">{n.status === 'done' ? '✓' : ''}</span>
              <div>
                <div className="pt">{n.title}</div>
                {n.detail && <div className="pd">{n.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
