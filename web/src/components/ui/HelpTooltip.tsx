import { HelpCircle } from 'lucide-react'
import { useState } from 'react'

export function HelpTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-flex">
      <HelpCircle className="h-3.5 w-3.5 cursor-help text-white/40"
        onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} />
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded text-[10px] max-w-[200px] sm:max-w-xs whitespace-normal z-50 bg-white/[0.03] text-white/90 border border-white/[0.06]">
          {text}
        </span>
      )}
    </span>
  )
}
