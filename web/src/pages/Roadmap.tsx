import {
  Rocket, CheckCircle, Clock, Star, Zap,
  Bell, Smartphone, Cloud, Brain, Plug,
  Shield, Map, BarChart3, Leaf, Globe, Wrench, Users,
} from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, Badge } from '../components/ui'
import clsx from 'clsx'
import { usePageTitle } from '../hooks/usePageTitle'

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
      'PWA support — installable on any device',
      'Command palette (Cmd+K) navigation',
      'Grafana dashboards (16 pre-built)',
      'MQTT telemetry publishing',
      'CSV and JSON data export',
    ],
  },
  {
    title: 'Smart Notifications',
    description: 'Multi-channel alerts, scheduling, and custom automation rules',
    icon: Bell,
    phase: 'done',
    features: [
      'Discord, Slack, and Telegram integrations',
      'Webhook, ntfy, and Pushover channels',
      'Custom alert rules (battery, speed, charge, geofence, sentry)',
      'Battery level thresholds with configurable triggers',
      'Geofence enter/exit notifications',
      'Charging completion alerts',
      'Notification history, analytics, and metrics',
      'Scheduled & recurring notifications',
      'Per-channel notification preferences',
    ],
  },
  {
    title: 'Intelligence & Observability',
    description: 'Advanced analytics, system health, and background processing',
    icon: Brain,
    phase: 'done',
    features: [
      'Fleet analytics with deep drive/charging/battery insights',
      'System status and component health dashboard',
      'Natural language chatbot for vehicle queries',
      'Async export worker (MQTT-backed background jobs)',
      'Audit trail logging',
      'API key management with HMAC authentication',
      '25+ developer tools (VIN decoder, JWT decoder, API diagnostics)',
      'Parallel CI/CD Docker builds',
    ],
  },
  {
    title: 'Fleet Telemetry',
    description: 'Real-time streaming from vehicles via Tesla Fleet Telemetry',
    icon: Zap,
    phase: 'done',
    features: [
      'Full signal ingestion (50+ signals — driving, charging, climate, TPMS)',
      'Hybrid poll/stream mode (auto-reduces polling when streaming)',
      'Drive & charge session detection from streaming data',
      'Alert evaluation from streaming signals',
      'SSE broadcast of streamed telemetry to frontend',
      'Per-vehicle streaming health monitoring',
      'Bundled or external Fleet Telemetry server support',
    ],
  },
  {
    title: 'Premium UI & Design System',
    description: 'Shared component library, accessibility, and consistent design language',
    icon: Star,
    phase: 'done',
    features: [
      '17-component shared library (Button, Input, Select, Modal, DataTable, etc.)',
      'WCAG AA accessibility — focus traps, keyboard nav, ARIA labels, contrast',
      'Light and dark mode with 5 neon color themes',
      'Glassmorphism design tokens and cn() utility',
      'Error and loading states across all 77 pages',
      'Global decimal precision control (0–20)',
      'SVG car visualization per Tesla model',
      'Page title hooks for screen readers',
    ],
  },
  {
    title: 'External Integrations',
    description: 'Connect with calendars, weather, and smart home systems',
    icon: Plug,
    phase: 'current',
    features: [
      'Home Assistant MQTT auto-discovery',
      'Calendar integration for trip planning',
      'Weather-adjusted range predictions',
      'IFTTT and Zapier webhooks',
      'Electricity rate API for cost optimization',
      'Fleet Telemetry deployment wizard',
    ],
  },
  {
    title: 'Enhanced Visualization',
    description: 'Interactive replays, custom dashboards, and advanced maps',
    icon: Star,
    phase: 'next',
    features: [
      'Interactive trip replay with elevation profile',
      'Charging station map overlay',
      'Fleet heatmap showing high-traffic corridors',
      'Custom dashboard builder (drag-and-drop widgets)',
      'Signal-level real-time graphs for Fleet Telemetry',
      'Streaming vs polling cost comparison dashboard',
    ],
  },
  {
    title: 'AI & Predictive Analytics',
    description: 'Machine learning models for predictive insights',
    icon: Brain,
    phase: 'next',
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
      'SSO / SAML authentication',
      'Horizontal scaling with load balancing',
      'Compliance reporting (SOC 2, GDPR)',
      'White-label customization',
      'API rate limiting per tenant',
      'Audit log export and retention policies',
    ],
  },
  {
    title: 'Mobile App',
    description: 'Native mobile experience for iOS and Android',
    icon: Smartphone,
    phase: 'future',
    features: [
      'Native iOS and Android apps (React Native)',
      'Widgets for battery level and charging status',
      'Background push notifications',
      'Apple Watch / Wear OS companion',
      'Offline mode with local data caching',
      'Biometric authentication (Face ID / fingerprint)',
      'Quick actions — lock, unlock, climate from home screen',
    ],
  },
  {
    title: 'Advanced Fleet Intelligence',
    description: 'Fleet-wide insights, benchmarking, and operational optimization',
    icon: BarChart3,
    phase: 'future',
    features: [
      'Fleet-wide efficiency leaderboard and benchmarks',
      'Total cost of ownership (TCO) calculator per vehicle',
      'Maintenance prediction and service scheduling',
      'Driver behavior scoring with gamification',
      'Fleet utilization reports and idle vehicle detection',
      'Carbon offset tracking and sustainability reports',
      'Automated monthly/quarterly fleet digest emails',
    ],
  },
  {
    title: 'Smart Routing & Navigation',
    description: 'Intelligent trip planning with charging stops and real-time conditions',
    icon: Map,
    phase: 'future',
    features: [
      'Multi-stop trip planner with optimal charging stops',
      'Real-time Supercharger availability and queue times',
      'Elevation-aware range estimation',
      'Weather and traffic impact on range calculation',
      'Charging cost comparison across networks (Tesla, ChargePoint, etc.)',
      'Shareable trip plans with ETA and charging schedule',
      'Historical route efficiency analysis',
    ],
  },
  {
    title: 'Security & Privacy',
    description: 'Advanced security features and privacy controls',
    icon: Shield,
    phase: 'future',
    features: [
      'End-to-end encryption for all vehicle data',
      'Geo-restricted access zones (block commands outside regions)',
      'Valet mode monitoring with speed/area alerts',
      'Theft detection with instant notifications and GPS tracking',
      'Data anonymization for shared fleet analytics',
      'Configurable data retention and auto-purge policies',
      'Two-factor authentication for critical commands',
    ],
  },
  {
    title: 'Smart Home & EV Ecosystem',
    description: 'Deep integration with home energy, solar, and smart devices',
    icon: Leaf,
    phase: 'future',
    features: [
      'Tesla Powerwall and Solar Roof integration',
      'Smart charging — charge when solar production is high',
      'Time-of-use electricity rate optimization',
      'Vehicle-to-home (V2H) energy flow monitoring',
      'Smart home scene triggers (arrive home → lights on, garage open)',
      'Amazon Alexa and Google Home voice commands',
      'Apple HomeKit and Matter protocol support',
    ],
  },
  {
    title: 'Community & Social',
    description: 'Connect with other Tesla owners, share data, and compete',
    icon: Users,
    phase: 'future',
    features: [
      'Public efficiency leaderboards (opt-in)',
      'Road trip sharing with photos and stats',
      'Community charging station reviews and ratings',
      'Fleet comparison — how does your car stack up?',
      'Achievement badges (100k miles, 1000 charges, etc.)',
      'Community-contributed alert rules marketplace',
      'Regional Tesla meetup and event discovery',
    ],
  },
  {
    title: 'Developer Platform',
    description: 'Open APIs, plugins, and extensibility for power users',
    icon: Wrench,
    phase: 'future',
    features: [
      'Public REST API with OAuth 2.0',
      'GraphQL API for flexible data queries',
      'Plugin system for custom dashboard widgets',
      'Custom automation scripting (JavaScript/Python)',
      'Webhook builder with visual flow editor',
      'Community plugin marketplace',
      'CLI tool for headless fleet management',
    ],
  },
  {
    title: 'Global & Multi-Brand',
    description: 'Expand beyond Tesla to support all electric vehicles',
    icon: Globe,
    phase: 'future',
    features: [
      'Rivian, Polestar, and BMW i integration',
      'Ford Mustang Mach-E and F-150 Lightning support',
      'Hyundai/Kia EV platform support',
      'Multi-language localization (20+ languages)',
      'Region-specific charging network integrations',
      'Universal OBD-II dongle support for any EV',
      'Cross-brand fleet management for mixed fleets',
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
          <Badge color={({ done: 'green', current: 'cyan', next: 'purple', future: 'amber' } as Record<string, 'green' | 'cyan' | 'purple' | 'amber'>)[item.phase] ?? 'cyan'}>
            {phase.label}
          </Badge>
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
  usePageTitle('Roadmap')
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
                    <Badge color={({ done: 'green', current: 'cyan', next: 'purple', future: 'amber' } as Record<string, 'green' | 'cyan' | 'purple' | 'amber'>)[phase] ?? 'cyan'}>{count}</Badge>
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
