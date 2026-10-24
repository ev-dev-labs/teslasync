import { lazy, Suspense, useEffect, useState } from 'react'
import { TOUR_OPEN_LAUNCHER_EVENT } from '@/lib/tourRegistry'

const LazyTourLauncher = lazy(async () => {
  const module = await import('@/features/onboarding/TourLauncher')
  return { default: module.TourLauncher }
})

/** Keep the closed dialog out of startup; retain the first opening event. */
export function TourLauncherHost() {
  const [activated, setActivated] = useState(false)

  useEffect(() => {
    if (activated) return
    const activate = () => setActivated(true)
    window.addEventListener(TOUR_OPEN_LAUNCHER_EVENT, activate)
    return () => window.removeEventListener(TOUR_OPEN_LAUNCHER_EVENT, activate)
  }, [activated])

  if (!activated) return null
  return <Suspense fallback={null}><LazyTourLauncher initialOpen /></Suspense>
}
