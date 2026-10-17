import { useCallback, useRef, useState } from 'react'
import { motion } from '@/components/motion/runtime'
import { Text } from '@/components/ui/Typography'
import { useMotionPreference } from '@/hooks/useMotionPreference'

interface FlyoutContent {
  label: string
  context?: string
  top: number
}

export function useSidebarFlyout() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<FlyoutContent | null>(null)
  const showTip = useCallback((anchor: HTMLElement, label: string, context?: string) => {
    const rootBox = rootRef.current?.getBoundingClientRect()
    if (!rootBox) return
    const box = anchor.getBoundingClientRect()
    setTip({ label, context, top: box.top - rootBox.top + box.height / 2 })
  }, [])
  const hideTip = useCallback(() => setTip(null), [])
  const tipHandlers = (label: string, context?: string) => ({
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => showTip(event.currentTarget, label, context),
    onMouseLeave: hideTip,
    onFocus: (event: React.FocusEvent<HTMLElement>) => showTip(event.currentTarget, label, context),
    onBlur: hideTip,
  })
  return { rootRef, tip, showTip, hideTip, tipHandlers }
}

export function SidebarFlyout({ tip, testId }: { tip: FlyoutContent | null; testId: string }) {
  const { reduce } = useMotionPreference()
  if (!tip) return null
  return (
    <motion.div
      aria-hidden
      data-testid={testId}
      initial={reduce ? false : { opacity: 0, scale: 0.95, y: '-50%' }}
      animate={{ opacity: 1, scale: 1, y: '-50%' }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      style={{ top: tip.top }}
      className="pointer-events-none absolute start-full z-50 ms-2 whitespace-nowrap rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] px-2.5 py-1.5 shadow-e2 forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]"
    >
      <Text size="xs" weight="medium" color="primary" className="block forced-colors:text-[CanvasText]">{tip.label}</Text>
      {tip.context && <Text size="xs" color="secondary" className="block forced-colors:text-[CanvasText]">{tip.context}</Text>}
    </motion.div>
  )
}
