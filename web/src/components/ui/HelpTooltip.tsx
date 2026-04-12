import { HelpCircle } from 'lucide-react'
import { useState } from 'react'

export function HelpTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-flex">
      <HelpCircle className="h-3.5 w-3.5 cursor-help" style={{ color: 'var(--text-muted)' }}
        onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} />
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded text-[10px] max-w-[200px] sm:max-w-xs whitespace-normal z-50"
          style={{ background: 'var(--surface-2)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)' }}>
          {text}
        </span>
      )}
    </span>
  )
}
