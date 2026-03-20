import {
  Rocket, CheckCircle, Clock, Star, Zap,
  Bell, Smartphone, Cloud, Brain, Plug,
} from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem } from '../components/ui'
import clsx from 'clsx'

type Phase = 'done' | 'current' | 'next' | 'future'

interface RoadmapItem {
  title: string
  description: string
  icon: React.ElementType
  phase: Phase
  features: string[]
}

const phaseConfig: Record<Phase, { label: string; color: string; bg: string }> = {
  done:    { label: 'Completed', color: '#10b981', bg: 'bg-neon-green/10' },
  current: { label: 'In Progress', color: '#00f0ff', bg: 'bg-neon-cyan/10' },
  next:    { label: 'Up Next', color: '#a855f7', bg: 'bg-neon-purple/10' },
  future:  { label: 'Future', color: '#f59e0b', bg: 'bg-neon-amber/10' },
}

const roadmapItems: RoadmapItem[] = [
  {
    title: 'Core Platform',
    description: 'Real-time fleet monitoring, analytics, and vehicle control',
    icon: Rocket,
    phase: 'done',
    features: [
      'Real-time vehicle state tracking via SSE',
      'Live GPS map with animated markers',
      'Remote vehicle commands (14 commands)',
      'Drive and charging session recording',
      'Energy analytics and efficiency scoring',
      'Battery health monitoring and degradation tracking',
      'Glassmorphism UI with 5 color themes',
      'PWA support — installable on any device',
      'Command palette (Cmd+K) navigation',
      'Grafana dashboards (16 pre-built)',
      'MQTT telemetry publishing',
      'CSV and JSON data export',
    ],
  },
  {
    title: 'Intelligence & Insights',
    description: 'Advanced analytics, date filtering, and system observability',
    icon: Brain,
    phase: 'current',
    features: [
      'Date range filtering on all historical data pages',
      'System status / health dashboard',
      'Last updated indicators on dashboard',
      'Enhanced data export with date & vehicle filtering',
      'Improved chart visualizations',
      'Theme readability improvements across all modes',
      'Security headers and hardening',
      'Better error handling with toast notifications',
    ],
  },
  {
    title: 'Smart Notifications',
    description: 'Multi-channel alerts and custom automation rules',
    icon: Bell,
    phase: 'next',
    features: [
      'Email, SMS, and push notification channels',
      'Discord, Slack, and Telegram integrations',
      'Custom alert rules with complex conditions',
      'Battery level thresholds with configurable triggers',
      'Geofence enter/exit notifications',
      'Charging completion and cost alerts',
      'Notification history and analytics',
      'Quiet hours and notification preferences',
    ],
  },
  {
    title: 'External Integrations',
    description: 'Connect with calendars, weather, and smart home systems',
    icon: Plug,
    phase: 'next',
    features: [
      'Calendar integration for trip planning',
      'Weather-adjusted range predictions',
      'Home Assistant / smart home integration',
      'IFTTT and Zapier webhooks',
      'Google Maps / Waze route import',
      'Electricity rate API integration for cost optimization',
    ],
  },
  {
    title: 'AI & Predictive Analytics',
    description: 'Machine learning models for predictive insights',
    icon: Brain,
    phase: 'future',
    features: [
      'Predictive battery degradation modeling',
      'Optimal charging schedule recommendations',
      'Driving pattern analysis and coaching',
      'Anomaly detection for vehicle health',
      'Energy cost forecasting',
      'Range prediction based on weather + route + driving style',
    ],
  },
  {
    title: 'Enterprise & Scale',
    description: 'Multi-tenant support, advanced security, and horizontal scaling',
    icon: Cloud,
    phase: 'future',
    features: [
      'Multi-tenant fleet management',
      'Role-based access control (RBAC)',
      'Data archiving and retention policies',
      'Horizontal scaling with load balancing',
      'Audit logging and compliance reporting',
      'SSO / SAML authentication',
      'API rate limiting per tenant',
      'White-label customization',
    ],
  },
  {
    title: 'Mobile App',
    description: 'Native mobile experience for iOS and Android',
    icon: Smartphone,
    phase: 'future',
    features: [
      'Native iOS and Android apps',
      'Widgets for battery level and charging status',
      'Background notifications',
      'Apple Watch / Wear OS companion',
      'Offline mode with local data caching',
      'Haptic feedback for vehicle commands',
    ],
  },
]

function RoadmapCard({ item }: { item: RoadmapItem }) {
  const phase = phaseConfig[item.phase]
  const Icon = item.icon

  return (
    <GlassPanel className="p-5 h-full relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-[60px] opacity-5" style={{ backgroundColor: phase.color }} />
      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl" style={{ backgroundColor: `${phase.color}15` }}>
              <Icon className="h-5 w-5" style={{ color: phase.color }} />
            </div>
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.title}</h3>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{item.description}</p>
            </div>
          </div>
          <span
            className={clsx('text-[10px] font-medium px-2 py-0.5 rounded-full')}
            style={{ backgroundColor: `${phase.color}15`, color: phase.color }}
          >
            {phase.label}
          </span>
        </div>

        <ul className="mt-4 space-y-1.5">
          {item.features.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              {item.phase === 'done' ? (
                <CheckCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-neon-green" />
              ) : item.phase === 'current' ? (
                <Zap className="h-3.5 w-3.5 shrink-0 mt-0.5 text-neon-cyan" />
              ) : (
                <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
              )}
              {f}
            </li>
          ))}
        </ul>
      </div>
    </GlassPanel>
  )
}

export default function Roadmap() {
  const phases: Phase[] = ['done', 'current', 'next', 'future']

  return (
    <div className="space-y-8">
      <PageHeader
        title="Roadmap"
        subtitle="What's been built, what's in progress, and what's coming next"
      />

      {/* Phase progress bar */}
      <FadeIn>
        <GlassPanel className="p-4">
          <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto">
            {phases.map((phase, i) => {
              const config = phaseConfig[phase]
              const count = roadmapItems.filter(item => item.phase === phase).length
              return (
                <div key={phase} className="flex items-center gap-2 sm:gap-4 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: config.color }} />
                    <span className="text-xs font-medium" style={{ color: config.color }}>{config.label}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${config.color}15`, color: config.color }}>{count}</span>
                  </div>
                  {i < phases.length - 1 && (
                    <div className="w-8 sm:w-16 h-px" style={{ backgroundColor: 'var(--glass-border)' }} />
                  )}
                </div>
              )
            })}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Roadmap cards by phase */}
      {phases.map(phase => {
        const items = roadmapItems.filter(item => item.phase === phase)
        if (items.length === 0) return null
        const config = phaseConfig[phase]
        return (
          <div key={phase}>
            <FadeIn>
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2" style={{ color: config.color }}>
                {phase === 'done' && <CheckCircle className="h-5 w-5" />}
                {phase === 'current' && <Zap className="h-5 w-5" />}
                {phase === 'next' && <Star className="h-5 w-5" />}
                {phase === 'future' && <Rocket className="h-5 w-5" />}
                {config.label}
              </h2>
            </FadeIn>
            <StaggerContainer className={clsx(
              'grid gap-4',
              items.length === 1 ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'
            )}>
              {items.map(item => (
                <StaggerItem key={item.title}>
                  <RoadmapCard item={item} />
                </StaggerItem>
              ))}
            </StaggerContainer>
          </div>
        )
      })}
    </div>
  )
}
