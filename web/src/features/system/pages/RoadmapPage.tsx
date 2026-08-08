import { type ElementType, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Rocket, CheckCircle, Clock, Star, Zap,
  Bell, Smartphone, Cloud, Brain, Plug,
  Shield, Map, BarChart3, Leaf, Globe, Wrench, Users,
  Layers, Sparkles,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, IconBox, SectionTitle, PanelTitle, Text } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { cn } from '@/lib/cn';
import { neonColorMap, type NeonColor } from '@/lib/tokens';
import type { RoadmapPhase } from '@/types/admin';

/* ------------------------------------------------------------------ */
/*  Types & Config                                                     */
/* ------------------------------------------------------------------ */

interface RoadmapEntry {
  title: string;
  description: string;
  icon: ElementType;
  phase: RoadmapPhase;
  features: string[];
}

interface PhaseMeta {
  /** Toned neon accent used for icon boxes, dots, chips and glows. */
  neon: NeonColor;
  /** Icon shown in the phase-band header. */
  icon: ElementType;
  /** Icon shown next to each feature in a card list. */
  statusIcon: ElementType;
  labelKey: string;
  labelFallback: string;
  descKey: string;
  descFallback: string;
}

const PHASE_ORDER: RoadmapPhase[] = ['done', 'current', 'next', 'future'];

const PHASE_META: Record<RoadmapPhase, PhaseMeta> = {
  done: {
    neon: 'green',
    icon: CheckCircle,
    statusIcon: CheckCircle,
    labelKey: 'roadmap.phase.done',
    labelFallback: 'Completed',
    descKey: 'roadmap.phaseDesc.done',
    descFallback: 'Shipped and available in your deployment today.',
  },
  current: {
    neon: 'cyan',
    icon: Zap,
    statusIcon: Zap,
    labelKey: 'roadmap.phase.current',
    labelFallback: 'In Progress',
    descKey: 'roadmap.phaseDesc.current',
    descFallback: 'Actively being built right now.',
  },
  next: {
    neon: 'purple',
    icon: Star,
    statusIcon: Star,
    labelKey: 'roadmap.phase.next',
    labelFallback: 'Up Next',
    descKey: 'roadmap.phaseDesc.next',
    descFallback: 'Designed and queued for the next development cycle.',
  },
  future: {
    neon: 'amber',
    icon: Rocket,
    statusIcon: Clock,
    labelKey: 'roadmap.phase.future',
    labelFallback: 'Future',
    descKey: 'roadmap.phaseDesc.future',
    descFallback: 'On the long-term vision — not yet scheduled.',
  },
};

/* ------------------------------------------------------------------ */
/*  Roadmap data                                                       */
/* ------------------------------------------------------------------ */

const roadmapItems: RoadmapEntry[] = [
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
    title: 'Helix & Predictive Analytics',
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
];

/* ------------------------------------------------------------------ */
/*  PhaseChip — token-based status pill (neon bg + ring + toned text)  */
/* ------------------------------------------------------------------ */

function PhaseChip({ phase, label }: { phase: RoadmapPhase; label: string }) {
  const c = neonColorMap[PHASE_META[phase].neon];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 ring-1', c.bg, c.ring)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', c.dot)} aria-hidden="true" />
      <Text size="xs" weight="medium" className={c.text}>{label}</Text>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  RoadmapCard                                                        */
/* ------------------------------------------------------------------ */

function RoadmapCard({ item }: { item: RoadmapEntry }) {
  const { t } = useTranslation();
  const meta = PHASE_META[item.phase];
  const c = neonColorMap[meta.neon];
  const Icon = item.icon;
  const StatusIcon = meta.statusIcon;
  const features = item.features ?? [];

  return (
    <GlassPanel className="relative h-full overflow-hidden p-4 sm:p-5">
      <div
        className={cn('pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-10 blur-3xl', c.dot)}
        aria-hidden="true"
      />
      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <IconBox color={meta.neon} size="md">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </IconBox>
            <div className="min-w-0">
              <PanelTitle className="truncate">{item.title}</PanelTitle>
              <Text as="p" variant="caption" className="mt-0.5 line-clamp-2">{item.description}</Text>
            </div>
          </div>
          <PhaseChip phase={item.phase} label={t(meta.labelKey, meta.labelFallback)} />
        </div>

        <ul className="mt-4 space-y-1.5">
          {features.map((feature, i) => (
            <li key={i} className="flex items-start gap-2">
              <StatusIcon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', c.text)} aria-hidden="true" />
              <Text as="span" variant="bodySm">{feature}</Text>
            </li>
          ))}
        </ul>
      </div>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  DeliveryProgress — segmented proportional bar + legend             */
/* ------------------------------------------------------------------ */

function DeliveryProgress({
  counts,
  total,
  shipped,
}: {
  counts: Record<RoadmapPhase, number>;
  total: number;
  shipped: number;
}) {
  const { t } = useTranslation();
  const segments = PHASE_ORDER.map((phase) => ({
    phase,
    count: counts[phase] ?? 0,
    meta: PHASE_META[phase],
  }));

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-8">
        <div className="shrink-0 lg:w-56">
          <SectionTitle>{t('roadmap.progress.title', 'Delivery Progress')}</SectionTitle>
          <div className="mt-1 flex items-baseline gap-2">
            <Text as="span" variant="metricValue">{shipped}</Text>
            <Text as="span" variant="caption">
              {t('roadmap.progress.ofTotal', 'of {{total}} initiatives shipped', { total })}
            </Text>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {total === 0 ? (
            // no-action: derived from the hardcoded roadmapItems array in this file — never empty without a source-code edit.
            <EmptyState message={t('roadmap.progress.empty', 'No roadmap items to display yet.')} />
          ) : (
            <>
              <div
                className="flex h-3 w-full overflow-hidden rounded-full bg-white/[0.04] ring-1 ring-white/[0.06]"
                role="img"
                aria-label={t('roadmap.progress.barLabel', 'Roadmap initiatives by phase')}
              >
                {segments.map((s) => {
                  const pct = total > 0 ? (s.count / total) * 100 : 0;
                  if (pct <= 0) return null;
                  return (
                    <div
                      key={s.phase}
                      className={cn('h-full', neonColorMap[s.meta.neon].dot)}
                      style={{ width: `${pct}%` }}
                    />
                  );
                })}
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                {segments.map((s) => (
                  <li key={s.phase} className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', neonColorMap[s.meta.neon].dot)} aria-hidden="true" />
                    <Text as="span" variant="bodySm">{t(s.meta.labelKey, s.meta.labelFallback)}</Text>
                    <Text as="span" variant="caption" className="tabular-nums">{s.count}</Text>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  PhaseSection — labeled band + responsive card grid                 */
/* ------------------------------------------------------------------ */

function PhaseSection({
  phase,
  items,
  delay,
}: {
  phase: RoadmapPhase;
  items: RoadmapEntry[];
  delay: number;
}) {
  const { t } = useTranslation();
  const meta = PHASE_META[phase];
  const c = neonColorMap[meta.neon];
  const PhaseIcon = meta.icon;
  const list = items ?? [];

  return (
    <FadeIn delay={delay}>
      <section aria-label={t(meta.labelKey, meta.labelFallback)} className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <IconBox color={meta.neon} size="sm">
            <PhaseIcon className="h-4 w-4" aria-hidden="true" />
          </IconBox>
          <SectionTitle>{t(meta.labelKey, meta.labelFallback)}</SectionTitle>
          <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 ring-1', c.bg, c.ring)}>
            <Text size="xs" weight="semibold" className={cn('tabular-nums', c.text)}>{list.length}</Text>
          </span>
          <Text as="p" variant="caption" className="w-full sm:w-auto">
            {t(meta.descKey, meta.descFallback)}
          </Text>
        </div>

        {list.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            {/* no-action: derived from the hardcoded roadmapItems array in this file, filtered by phase. */}
            <EmptyState message={t('roadmap.noItems', 'No items in this phase yet.')} />
          </GlassPanel>
        ) : (
          <StaggerContainer className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
            {list.map((item) => (
              <StaggerItem key={item.title} className="h-full">
                <RoadmapCard item={item} />
              </StaggerItem>
            ))}
          </StaggerContainer>
        )}
      </section>
    </FadeIn>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function RoadmapPage() {
  const { t } = useTranslation();
  usePageTitle(t('roadmap.title', 'Roadmap'));

  const grouped = useMemo(() => {
    const g: Record<RoadmapPhase, RoadmapEntry[]> = { done: [], current: [], next: [], future: [] };
    for (const item of roadmapItems) g[item.phase].push(item);
    return g;
  }, []);

  const counts = useMemo<Record<RoadmapPhase, number>>(
    () => ({
      done: grouped.done.length,
      current: grouped.current.length,
      next: grouped.next.length,
      future: grouped.future.length,
    }),
    [grouped],
  );

  const total = roadmapItems.length;
  const shipped = counts.done;
  const featuresShipped = useMemo(
    () => grouped.done.reduce((sum, item) => sum + (item.features?.length ?? 0), 0),
    [grouped],
  );

  return (
    <PageContainer
      title={t('roadmap.title', 'Roadmap')}
      subtitle={t('roadmap.subtitle', "What's been built, what's in progress, and what's coming next")}
    >
      {/* 1 — KPI band: initiatives per phase + totals */}
      <FadeIn>
        <section
          aria-label={t('roadmap.overview', 'Roadmap overview')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6"
        >
          <MetricCard
            label={t('roadmap.phase.done', 'Completed')}
            value={counts.done}
            color="green"
            icon={<CheckCircle className="h-5 w-5" aria-hidden="true" />}
          />
          <MetricCard
            label={t('roadmap.phase.current', 'In Progress')}
            value={counts.current}
            color="cyan"
            icon={<Zap className="h-5 w-5" aria-hidden="true" />}
          />
          <MetricCard
            label={t('roadmap.phase.next', 'Up Next')}
            value={counts.next}
            color="purple"
            icon={<Star className="h-5 w-5" aria-hidden="true" />}
          />
          <MetricCard
            label={t('roadmap.phase.future', 'Future')}
            value={counts.future}
            color="amber"
            icon={<Rocket className="h-5 w-5" aria-hidden="true" />}
          />
          <MetricCard
            label={t('roadmap.metric.total', 'Total Initiatives')}
            value={total}
            color="blue"
            icon={<Layers className="h-5 w-5" aria-hidden="true" />}
          />
          <MetricCard
            label={t('roadmap.metric.featuresShipped', 'Features Shipped')}
            value={featuresShipped}
            color="green"
            icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
          />
        </section>
      </FadeIn>

      {/* 2 — Primary visual: delivery progress across phases */}
      <FadeIn delay={0.1}>
        <DeliveryProgress counts={counts} total={total} shipped={shipped} />
      </FadeIn>

      {/* 3 — Detail bands: one responsive card grid per phase */}
      {PHASE_ORDER.map((phase, i) => (
        <PhaseSection key={phase} phase={phase} items={grouped[phase]} delay={0.15 + i * 0.05} />
      ))}
    </PageContainer>
  );
}
