import { useState, useEffect, useCallback, useRef } from 'react'
import { X, ChevronRight, Zap, Settings, Car, CheckCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { COLOR } from '@/lib/colors'
import { broadcast, subscribe } from '@/lib/broadcast'

const ONBOARDED_KEY = 'teslasync-onboarded'

/** Delay before the intro surfaces so the app can paint and the user can
 *  interact with the nav first (they may dismiss without ever reading it). */
const REVEAL_DELAY_MS = 1500

interface OnboardingStep {
  /** i18n key + English fallback for the step heading. */
  titleKey: string
  titleDefault: string
  /** i18n key + English fallback for the step body copy. */
  descKey: string
  descDefault: string
  icon: React.ElementType
  color: string
}

const steps: OnboardingStep[] = [
  {
    titleKey: 'onboarding.welcome.title',
    titleDefault: 'Welcome to TeslaSync',
    descKey: 'onboarding.welcome.desc',
    descDefault:
      'Your all-in-one Tesla fleet management dashboard. Track drives, monitor battery health, analyze energy usage, and control your vehicles — all in one place.',
    icon: Zap,
    color: '#00f0ff',
  },
  {
    titleKey: 'onboarding.connect.title',
    titleDefault: 'Connect Your Tesla',
    descKey: 'onboarding.connect.desc',
    descDefault:
      'Head to Settings and link your Tesla account via OAuth. TeslaSync will securely poll your vehicle data and keep everything in sync automatically.',
    icon: Car,
    color: '#10b981',
  },
  {
    titleKey: 'onboarding.configure.title',
    titleDefault: 'Configure Settings',
    descKey: 'onboarding.configure.desc',
    descDefault:
      'Customize your polling interval, distance units, energy cost per kWh, notification preferences, and MQTT integration to match your setup.',
    icon: Settings,
    color: '#f59e0b',
  },
  {
    titleKey: 'onboarding.done.title',
    titleDefault: "You're All Set!",
    descKey: 'onboarding.done.desc',
    descDefault:
      'Your dashboard is ready. Explore drives, charging sessions, efficiency analytics, and more. You can always revisit settings to fine-tune your experience.',
    icon: CheckCircle,
    color: '#8b5cf6',
  },
]

export default function OnboardingWizard() {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let onboarded: string | null = null
    try {
      onboarded = localStorage.getItem(ONBOARDED_KEY)
    } catch {
      // Storage disabled (private mode / hardened browser) — treat the user
      // as first-run rather than crashing the shell.
      onboarded = null
    }
    if (!onboarded) {
      // Delay so the app renders first and user can interact with nav
      const timer = setTimeout(() => setVisible(true), REVEAL_DELAY_MS)
      return () => clearTimeout(timer)
    }
  }, [])

  // When another tab finishes onboarding, dismiss the wizard here too
  // instead of letting two tabs race the same intro.
  useEffect(() => {
    return subscribe((m) => {
      if (m.type === 'onboarded') setVisible(false)
    })
  }, [])

  const handleClose = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDED_KEY, 'true')
    } catch {
      // Best-effort persistence — a peer tab or a later visit will retry.
    }
    setVisible(false)
    broadcast({ type: 'onboarded' })
  }, [])

  const handleNext = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      handleClose()
    }
  }, [currentStep, handleClose])

  // Escape-to-dismiss. The previous onKeyDown lived on a non-focusable
  // wrapper <div>, so it never received the event; a document-level
  // listener makes the shortcut work regardless of where focus sits.
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible, handleClose])

  // Move focus into the dialog on open so keyboard + screen-reader users
  // land on the surface and Tab stays within it.
  useEffect(() => {
    if (visible) dialogRef.current?.focus()
  }, [visible])

  if (!visible) return null

  const step = steps[currentStep] ?? steps[0]
  const StepIcon = step.icon
  const isLastStep = currentStep >= steps.length - 1

  return (
    <div className="fixed inset-0 top-12 lg:top-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop — doesn't cover mobile header so hamburger stays clickable.
          Decorative: the accessible dismiss path is the Skip/Close buttons. */}
      <div
        className="absolute inset-0 bg-[var(--surface-overlay)] backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden="true"
        data-testid="onboarding-backdrop"
      />

      {/* Modal */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-desc"
        tabIndex={-1}
        data-testid="onboarding-wizard"
        className="relative w-full max-w-md rounded-2xl border p-6 bg-[var(--surface-1)]/95 outline-none"
        style={{
          backdropFilter: 'blur(20px)',
          borderColor: 'rgba(255, 255, 255, 0.08)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(0, 240, 255, 0.05)',
        }}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={handleClose}
          aria-label={t('onboarding.close', 'Close and skip introduction')}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-white/[0.05] hover:text-[var(--text-secondary)] transition-colors"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        {/* Step indicators */}
        <div
          className="flex items-center justify-center gap-2 mb-6"
          role="group"
          aria-label={t('onboarding.progress', 'Step {{current}} of {{total}}', {
            current: currentStep + 1,
            total: steps.length,
          })}
        >
          {steps.map((_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="h-1.5 rounded-full transition-all duration-normal"
              style={{
                width: i === currentStep ? '24px' : '8px',
                background: i <= currentStep ? COLOR.CYAN : 'rgba(255,255,255,0.1)',
                boxShadow: i === currentStep ? '0 0 8px rgba(0, 240, 255, 0.4)' : 'none',
              }}
            />
          ))}
        </div>

        {/* Content */}
        <div className="flex flex-col items-center text-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl mb-5"
            aria-hidden="true"
            style={{
              background: `${step.color}15`,
              boxShadow: `0 0 30px ${step.color}10`,
            }}
          >
            <StepIcon className="h-8 w-8" style={{ color: step.color }} />
          </div>

          <h2 id="onboarding-title" className="text-xl font-bold text-[var(--text-primary)] mb-2">
            {t(step.titleKey, step.titleDefault)}
          </h2>
          <p id="onboarding-desc" className="text-sm text-[var(--text-muted)] leading-relaxed mb-8">
            {t(step.descKey, step.descDefault)}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            {t('onboarding.skip', 'Skip')}
          </button>
          <button
            type="button"
            onClick={handleNext}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-[var(--text-primary)] transition-all"
            style={{
              background: 'linear-gradient(135deg, #00f0ff20, #8b5cf620)',
              border: '1px solid rgba(0, 240, 255, 0.2)',
            }}
          >
            {isLastStep ? (
              t('onboarding.getStarted', 'Get Started')
            ) : (
              <>
                {t('onboarding.next', 'Next')} <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

