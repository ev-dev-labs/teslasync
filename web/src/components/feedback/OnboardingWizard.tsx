import { useState, useEffect } from 'react'
import { X, ChevronRight, Zap, Settings, Car, CheckCircle } from 'lucide-react'
import { COLOR } from '@/lib/colors'

const ONBOARDED_KEY = 'teslasync-onboarded'

interface OnboardingStep {
  title: string
  description: string
  icon: React.ElementType
  color: string
}

const steps: OnboardingStep[] = [
  {
    title: 'Welcome to TeslaSync',
    description:
      'Your all-in-one Tesla fleet management dashboard. Track drives, monitor battery health, analyze energy usage, and control your vehicles — all in one place.',
    icon: Zap,
    color: '#00f0ff',
  },
  {
    title: 'Connect Your Tesla',
    description:
      'Head to Settings and link your Tesla account via OAuth. TeslaSync will securely poll your vehicle data and keep everything in sync automatically.',
    icon: Car,
    color: '#10b981',
  },
  {
    title: 'Configure Settings',
    description:
      'Customize your polling interval, distance units, energy cost per kWh, notification preferences, and MQTT integration to match your setup.',
    icon: Settings,
    color: '#f59e0b',
  },
  {
    title: "You're All Set!",
    description:
      'Your dashboard is ready. Explore drives, charging sessions, efficiency analytics, and more. You can always revisit settings to fine-tune your experience.',
    icon: CheckCircle,
    color: '#8b5cf6',
  },
]

export default function OnboardingWizard() {
  const [visible, setVisible] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)

  useEffect(() => {
    const onboarded = localStorage.getItem(ONBOARDED_KEY)
    if (!onboarded) {
      // Delay so the app renders first and user can interact with nav
      const timer = setTimeout(() => setVisible(true), 1500)
      return () => clearTimeout(timer)
    }
  }, [])

  const handleClose = () => {
    localStorage.setItem(ONBOARDED_KEY, 'true')
    setVisible(false)
  }

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      handleClose()
    }
  }

  if (!visible) return null

  const step = steps[currentStep]
  const StepIcon = step.icon

  return (
    <div className="fixed inset-0 top-12 lg:top-0 z-50 flex items-center justify-center p-4"
      onKeyDown={e => { if (e.key === 'Escape') handleClose() }}>
      {/* Backdrop — doesn't cover mobile header so hamburger stays clickable */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      {/* Modal */}
      <div
        className="relative w-full max-w-md rounded-2xl border p-6"
        style={{
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(20px)',
          borderColor: 'rgba(255, 255, 255, 0.08)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(0, 240, 255, 0.05)',
        }}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-white/[0.05] hover:text-[var(--text-secondary)] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {steps.map((_, i) => (
            <div
              key={i}
              className="h-1.5 rounded-full transition-all duration-300"
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
            style={{
              background: `${step.color}15`,
              boxShadow: `0 0 30px ${step.color}10`,
            }}
          >
            <StepIcon className="h-8 w-8" style={{ color: step.color }} />
          </div>

          <h2 className="text-xl font-bold text-white mb-2">{step.title}</h2>
          <p className="text-sm text-[var(--text-muted)] leading-relaxed mb-8">{step.description}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={handleClose}
            className="rounded-lg px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleNext}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-white transition-all"
            style={{
              background: 'linear-gradient(135deg, #00f0ff20, #8b5cf620)',
              border: '1px solid rgba(0, 240, 255, 0.2)',
            }}
          >
            {currentStep < steps.length - 1 ? (
              <>
                Next <ChevronRight className="h-4 w-4" />
              </>
            ) : (
              'Get Started'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

