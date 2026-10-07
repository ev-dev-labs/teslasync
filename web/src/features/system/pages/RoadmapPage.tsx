import { type ElementType, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';

import { PageContainer } from '@/components/layout';
import { GlassPanel, IconBox, SectionTitle, PanelTitle, Text } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { cn } from '@/lib/cn';
import { neonColorMap, type NeonColor } from '@/lib/tokens';
import type { RoadmapPhase } from '@/types/admin';

const {
  sparkles: Rocket, success: CheckCircle, clock: Clock, star: Star, charging: Zap,
  notifications: Bell, monitor: Smartphone, cpu: Brain, charger: Plug,
  security: Shield, map: Map, analytics: BarChart3, leaf: Leaf,
  maintenance: Wrench, users: Users, layoutGrid: Layers, lightbulb: Sparkles,
} = Icons;

/* ------------------------------------------------------------------ */
/*  Types & Config                                                     */
/* ------------------------------------------------------------------ */

interface RoadmapEntry {
  id?: string;
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
    labelFallback: 'Active Focus',
    descKey: 'roadmap.phaseDesc.current',
    descFallback: 'Areas receiving attention; priorities may change.',
  },
  next: {
    neon: 'purple',
    icon: Star,
    statusIcon: Star,
    labelKey: 'roadmap.phase.next',
    labelFallback: 'Up Next',
    descKey: 'roadmap.phaseDesc.next',
    descFallback: 'Potential next priorities, not scheduled commitments.',
  },
  future: {
    neon: 'amber',
    icon: Rocket,
    statusIcon: Clock,
    labelKey: 'roadmap.phase.future',
    labelFallback: 'Future',
    descKey: 'roadmap.phaseDesc.future',
    descFallback: 'Ideas to evaluate, not promised releases.',
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
      'Remote vehicle commands with proxy routing',
      'Drive and charging session recording',
      'Energy analytics and efficiency scoring',
      'Battery health monitoring and degradation tracking',
      'PWA support — installable on any device',
      'Command palette (Cmd+K) navigation',
      'Provisioned Grafana dashboards',
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
      'Helix assistant with typed tools for vehicle queries',
      'Async export worker (MQTT-backed background jobs)',
      'Audit trail logging',
      'API key management with HMAC authentication',
      '25+ developer tools (VIN decoder, JWT decoder, API diagnostics)',
      'CI tests gate Docker image builds',
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
      'Shared UI library (Button, Input, Select, Modal, DataTable, etc.)',
      'WCAG AA accessibility — focus traps, keyboard nav, ARIA labels, contrast',
      'Light and dark mode with 5 neon color themes',
      'Glassmorphism design tokens and cn() utility',
      'Route-aware error and loading states',
      'Global decimal precision control (0–20)',
      'SVG car visualization per Tesla model',
      'Page title hooks for screen readers',
    ],
  },
  {
    id: 'history',
    title: 'Vehicle History & Physics',
    description: 'Evidence-led history and explainable vehicle behavior',
    icon: Map,
    phase: 'done',
    features: [
      'Vehicle day log and full state timeline',
      'Time-machine views of historical signals',
      'Drive physics energy ledger and Science Lab',
      'Driving dynamics and efficiency workbench',
      'Signal history, coverage, and diagnostics',
      'Fleet and vehicle history in the same navigation tree',
    ],
  },
  {
    id: 'charging',
    title: 'Charging & Energy Intelligence',
    description: 'From charge history to costs, thermal behavior, and energy flows',
    icon: Leaf,
    phase: 'done',
    features: [
      'Charging history, curves, and patterns',
      'Charge interruption and charger resilience analysis',
      'Battery degradation, range, and standby insights',
      'Energy ledger and power-flow views',
      'Tariff analysis and charging reconciliation',
      'Charge planning and departure alignment',
    ],
  },
  {
    id: 'journeys',
    title: 'Journeys & Ownership',
    description: 'Planning, travel context, and fleet ownership insights',
    icon: Users,
    phase: 'done',
    features: [
      'Journeys and trip planning with direct route access',
      'Arrival reliability and departure forecasts',
      'Vehicle comparison and fleet operations',
      'Maintenance, warranty, and consumables views',
      'Driver attribution and privacy benchmarks',
    ],
  },
  {
    id: 'helixStudio',
    title: 'Helix & Alert Studio',
    description: 'Assisted investigations and configurable notification workflows',
    icon: Brain,
    phase: 'done',
    features: [
      'Helix analysis tools and Azure Foundry provider support',
      'Alert Studio and editable installed alert rules',
      'Curated alert packs and custom pack previews',
      'Pack defaults for alert behavior, cooldown, and channels',
      'Notification inbox, delivery channels, and health',
    ],
  },
  {
    id: 'operator',
    title: 'Operator Experience',
    description: 'Direct navigation and responsive controls across the application',
    icon: Layers,
    phase: 'done',
    features: [
      'Inline sidebar collections preserve original page routes',
      'Searchable feature catalogue and direct sibling switching',
      'Desktop sidebar resizing and wrap-safe navigation labels',
      'Customizable dashboard and shared data displays',
      'Local Docker and Helm deployment options',
    ],
  },
  {
    id: 'reliability',
    title: 'Reliability & Data Trust',
    description: 'Active focus on telemetry correctness and operational recovery',
    icon: Shield,
    phase: 'current',
    features: [
      'Improve stale-stream detection and resubscription recovery',
      'Close gaps between available signals and surfaced data',
      'Strengthen unit consistency between live and historical views',
      'Clarify failure states and recovery guidance for operators',
    ],
  },
  {
    id: 'helixQuality',
    title: 'Helix Quality & Cost Controls',
    description: 'Improve grounded answers without making AI mandatory',
    icon: Brain,
    phase: 'next',
    features: [
      'Improve retrieval quality and citation surfaces',
      'Make per-feature model cost controls easier to inspect',
      'Explain AI spend anomalies before they become surprises',
      'Expand typed tools for high-value operator questions',
    ],
  },
  {
    id: 'recovery',
    title: 'Recovery & Documentation',
    description: 'Make self-hosted operations easier to validate and restore',
    icon: Wrench,
    phase: 'next',
    features: [
      'Rehearse restores and document recovery evidence',
      'Reduce backup size and simplify restore workflows',
      'Keep deployment guidance in sync with supported setups',
      'Extend meaningful service-level health checks',
    ],
  },
  {
    id: 'ecosystem',
    title: 'Energy Ecosystem',
    description: 'Explore deeper integration with home energy and charging decisions',
    icon: Leaf,
    phase: 'future',
    features: [
      'Connect charging decisions to local solar production',
      'Compare time-of-use tariffs with observed charging costs',
      'Explore Powerwall and home-energy context',
      'Evaluate additional charging-network data sources',
    ],
  },
  {
    id: 'fleetInsights',
    title: 'Privacy-preserving Fleet Insights',
    description: 'Explore useful comparisons without exposing individual journeys',
    icon: BarChart3,
    phase: 'future',
    features: [
      'Aggregate fleet efficiency trends with clear provenance',
      'Support opt-in comparison without publishing private trips',
      'Explain how benchmarks are calculated',
      'Keep data retention and sharing under operator control',
    ],
  },
  {
    id: 'interoperability',
    title: 'Interoperability',
    description: 'Evaluate integrations that serve self-hosted deployments',
    icon: Plug,
    phase: 'future',
    features: [
      'Assess Home Assistant integration needs',
      'Explore calendar context for trip planning',
      'Document stable webhook and API extension points',
      'Prioritize integrations based on operator demand',
    ],
  },
  {
    id: 'accessibleOps',
    title: 'Accessible Operator Workflows',
    description: 'Continue refining navigation and dense screens on every display size',
    icon: Smartphone,
    phase: 'future',
    features: [
      'Improve the heaviest screens on compact displays',
      'Refine keyboard navigation and reduced-motion behavior',
      'Improve PWA installation guidance and offline messaging',
      'Keep product documentation aligned with the application',
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
              <PanelTitle className="whitespace-normal break-words">{item.id ? t(`roadmap.entries.${item.id}.title`, item.title) : item.title}</PanelTitle>
              <Text as="p" variant="caption" className="mt-0.5">{item.id ? t(`roadmap.entries.${item.id}.description`, item.description) : item.description}</Text>
            </div>
          </div>
          <PhaseChip phase={item.phase} label={t(meta.labelKey, meta.labelFallback)} />
        </div>

        <ul className="mt-4 space-y-1.5">
          {features.map((feature, i) => (
            <li key={i} className="flex items-start gap-2">
              <StatusIcon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', c.text)} aria-hidden="true" />
              <Text as="span" variant="bodySm">{item.id ? t(`roadmap.entries.${item.id}.features.${i}`, feature) : feature}</Text>
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
      <Text as="p" variant="bodySm">
        {t('roadmap.note', 'This is a direction of travel, not a release schedule. Future work depends on operator needs and data correctness.')}
      </Text>
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
            label={t('roadmap.phase.current', 'Active Focus')}
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
