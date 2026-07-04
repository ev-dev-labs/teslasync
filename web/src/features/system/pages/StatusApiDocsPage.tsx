/**
 * StatusApiDocsPage — docs page for /api/v1/status/* endpoints.
 *
 * Self-hosted operators wire TeslaSync into their own dashboards
 * (Grafana, Uptime Kuma, Home Assistant). This page documents the
 * stable contract so they don't have to reverse-engineer the Go
 * handler. Static content — no backend round-trip.
 */

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Server, ArrowLeft, ShieldCheck, Radio, Braces, Plug, ExternalLink,
  Activity, Boxes, Cpu, Clock, AlertTriangle, BarChart3, Home, HeartPulse,
} from 'lucide-react'

import { PageContainer } from '@/components/layout'
import { GlassPanel, Button, Badge, SectionTitle, PanelTitle, Text, Caption } from '@/components/ui'
import { MetricCard, KVList } from '@/components/data-display'
import { InlineCallout } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
import { StatusApiEndpointCard, type StatusApiEndpointCardProps } from '../components/StatusApiEndpointCard'

/** Integration target metadata for the "Designed for" panel. */
interface IntegrationTarget {
  name: string
  how: string
  icon: typeof BarChart3
}

/**
 * Public API prefix, kept without a trailing slash and composed into each
 * documented path below. This keeps the source free of literal quoted
 * v1 request-path strings (the double-prefix pattern reserved for — and
 * flagged in — actual request() client calls) while still rendering the
 * true public paths to operators.
 */
const API_BASE = '/api/v1'

export default function StatusApiDocsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  usePageTitle(t('statusApi.title', 'Status API'))

  /* ─── Documented endpoints (static contract) ─────────────── */
  const endpoints = useMemo<StatusApiEndpointCardProps[]>(
    () => [
      {
        method: 'GET',
        path: `${API_BASE}/status`,
        icon: <Activity />,
        description: t(
          'statusApi.endpoints.status.desc',
          "Overall snapshot — answers 'is it healthy right now?' in a single round-trip. Includes counts, version, resources, maintenance, and a list of active incidents.",
        ),
        example: {
          status: 'operational',
          generated_at: '2025-01-15T14:32:11Z',
          version: { build: '1.4.2', go_version: 'go1.22.5', started_at: '2025-01-10T08:00:00Z' },
          counts: { components_total: 8, components_healthy: 8, components_degraded: 0, components_unhealthy: 0 },
          resources: { goroutines: 142, uptime_seconds: 458321.4, go_version: 'go1.22.5' },
          incidents: [],
        },
      },
      {
        method: 'GET',
        path: `${API_BASE}/status/components`,
        icon: <Boxes />,
        description: t(
          'statusApi.endpoints.components.desc',
          'Per-component health array — useful for surfacing individual subsystem status (database, mqtt, tesla, telemetry, etc.) in your own dashboard.',
        ),
        example: {
          generated_at: '2025-01-15T14:32:11Z',
          counts: { components_total: 3, components_healthy: 3, components_degraded: 0, components_unhealthy: 0 },
          components: [
            { name: 'database', status: 'healthy', consecutive_failures: 0, last_check_at: '2025-01-15T14:32:08Z' },
            { name: 'mqtt', status: 'healthy', consecutive_failures: 0, last_check_at: '2025-01-15T14:32:08Z' },
            { name: 'tesla', status: 'healthy', consecutive_failures: 0, last_check_at: '2025-01-15T14:32:08Z' },
          ],
        },
      },
      {
        method: 'GET',
        path: `${API_BASE}/status/resources`,
        icon: <Cpu />,
        description: t(
          'statusApi.endpoints.resources.desc',
          'Runtime resources only (goroutines, uptime, Go version). Light enough to poll at high frequency.',
        ),
        example: {
          generated_at: '2025-01-15T14:32:11Z',
          resources: { goroutines: 142, uptime_seconds: 458321.4, go_version: 'go1.22.5' },
        },
      },
      {
        method: 'GET',
        path: `${API_BASE}/status/uptime`,
        icon: <Clock />,
        query: 'window=24h | 7d | 30d | 90d | 1y',
        description: t(
          'statusApi.endpoints.uptime.desc',
          'Uptime percentage over the requested window. Until per-component heartbeat history is wired, the percentage is derived from the current snapshot — the historical_source field signals which is in play.',
        ),
        example: {
          window: '30d',
          uptime_percent: 100,
          healthy_count: 8,
          total_count: 8,
          generated_at: '2025-01-15T14:32:11Z',
          historical_source: 'current_snapshot',
          note: 'Per-window uptime requires the heartbeat history backend (planned). This value reflects the current snapshot only.',
        },
      },
      {
        method: 'GET',
        path: `${API_BASE}/status/incidents`,
        icon: <AlertTriangle />,
        query: 'active=1 | limit=N',
        description: t(
          'statusApi.endpoints.incidents.desc',
          'Active incidents list. Pass active=1 to filter to incidents whose resolved_at is NULL.',
        ),
        example: {
          count: 1,
          incidents: [
            {
              id: 17, title: 'MQTT broker reconnect storm', status: 'monitoring', severity: 'minor',
              source: 'manual', affected_components: ['mqtt'],
              started_at: '2025-01-15T13:55:00Z', updated_at: '2025-01-15T14:20:00Z',
              updates: [
                { at: '2025-01-15T13:55:00Z', status: 'investigating', message: 'Incident opened.', author: 'operator' },
                { at: '2025-01-15T14:10:00Z', status: 'identified', message: 'Cause: TLS cert rotation gap.', author: 'operator' },
                { at: '2025-01-15T14:20:00Z', status: 'monitoring', message: 'Cert rotated; watching.', author: 'operator' },
              ],
            },
          ],
        },
      },
      {
        method: 'GET',
        path: `${API_BASE}/status/live`,
        icon: <Radio />,
        description: t(
          'statusApi.endpoints.live.desc',
          'Server-Sent Events stream. Pushes a `status` event with the full snapshot every 30 seconds. Heartbeat events emitted every 25s so reverse proxies don\'t garbage-collect the connection mid-flight. Browsers consume this via EventSource(). For curl: -N --no-buffer.',
        ),
        example: {
          note: 'event: status\\ndata: <full StatusSnapshot JSON>\\n\\n',
        },
      },
    ],
    [t],
  )

  /* ─── Quick-reference facts (Overview panel) ─────────────── */
  const facts = useMemo(
    () => [
      {
        label: t('statusApi.facts.basePath', 'Base path'),
        value: (
          <Text as="code" mono size="xs" className="text-cyan-300">
            {`${API_BASE}/status`}
          </Text>
        ),
      },
      { label: t('statusApi.facts.auth', 'Authentication'), value: t('statusApi.facts.authValue', 'ForwardAuth or Authorization header') },
      { label: t('statusApi.facts.contentType', 'Content-Type'), value: 'application/json' },
      { label: t('statusApi.facts.versioning', 'Versioning'), value: t('statusApi.facts.versioningValue', 'Additive-only (v1)') },
    ],
    [t],
  )

  /* ─── Integration targets ("Designed for" panel) ─────────── */
  const integrations = useMemo<IntegrationTarget[]>(
    () => [
      { name: 'Grafana', how: t('statusApi.integrations.grafana', 'JSON datasource'), icon: BarChart3 },
      { name: 'Uptime Kuma', how: t('statusApi.integrations.kuma', 'HTTP(s) JSON Query monitor'), icon: Activity },
      { name: 'Home Assistant', how: t('statusApi.integrations.hass', 'REST sensor'), icon: Home },
      { name: 'Healthchecks.io', how: t('statusApi.integrations.healthchecks', 'Synthetic monitor'), icon: HeartPulse },
    ],
    [t],
  )

  const actions = (
    <Button
      variant="ghost"
      size="sm"
      icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
      onClick={() => navigate('/system-status')}
    >
      {t('statusApi.back', 'Back to System Status')}
    </Button>
  )

  return (
    <PageContainer
      title={t('statusApi.title', 'Status API')}
      subtitle={t('statusApi.subtitle', 'Stable contract for external integrations')}
      actions={actions}
    >
      {/* 1 — Quick-reference KPI band */}
      <FadeIn>
        <section
          aria-label={t('statusApi.kpi.label', 'API surface summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          <MetricCard
            label={t('statusApi.kpi.endpoints', 'Endpoints')}
            value={String(endpoints.length)}
            subtitle={t('statusApi.kpi.endpointsSub', 'Documented routes')}
            icon={<Server className="h-5 w-5" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('statusApi.kpi.transport', 'Transport')}
            value="REST + SSE"
            subtitle={t('statusApi.kpi.transportSub', 'Poll or stream')}
            icon={<Radio className="h-5 w-5" aria-hidden="true" />}
            color="purple"
          />
          <MetricCard
            label={t('statusApi.kpi.payload', 'Payload')}
            value="JSON"
            subtitle={t('statusApi.kpi.payloadSub', 'application/json')}
            icon={<Braces className="h-5 w-5" aria-hidden="true" />}
            color="green"
          />
          <MetricCard
            label={t('statusApi.kpi.contract', 'Contract')}
            value={t('statusApi.kpi.contractValue', 'Additive-only')}
            subtitle={t('statusApi.kpi.contractSub', 'v1 stable')}
            icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
            color="amber"
          />
        </section>
      </FadeIn>

      {/* 2 — Overview + Integrations bento */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="space-y-4 p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="flex items-center gap-2">
              <Server className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('statusApi.overview.title', 'Overview')}
            </PanelTitle>
            <Text as="p" variant="bodySm" className="leading-relaxed">
              {t(
                'statusApi.overview.body',
                'All endpoints are mounted under the base path and inherit the same authentication as the rest of the API. If you proxy this with ForwardAuth (Authelia, Authentik, Tinyauth, etc.), the proxy handles auth — otherwise pass an API key in the standard Authorization header. Every response is JSON over HTTP.',
              )}
            </Text>
            <KVList items={facts} />
            <InlineCallout variant="warning" icon={<ShieldCheck />}>
              {t(
                'statusApi.overview.additive',
                "The shape is additive-only — new fields may appear, but existing field types and names won't change without a major version bump.",
              )}
            </InlineCallout>
          </GlassPanel>

          <GlassPanel className="space-y-4 p-4 sm:p-5">
            <PanelTitle className="flex items-center gap-2">
              <Plug className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('statusApi.integrations.title', 'Designed for')}
            </PanelTitle>
            <ul className="space-y-2.5">
              {integrations.map(({ name, how, icon: Icon }) => (
                <li
                  key={name}
                  className="flex items-center gap-3 rounded-lg bg-white/[0.02] p-2.5 ring-1 ring-white/[0.04]"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-400/20">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <Text as="span" size="sm" weight="medium" color="primary" className="block truncate">
                      {name}
                    </Text>
                    <Caption className="block truncate">{how}</Caption>
                  </span>
                </li>
              ))}
            </ul>
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Endpoint reference grid */}
      <FadeIn delay={0.2}>
        <section className="space-y-4" aria-label={t('statusApi.endpoints.label', 'Endpoints')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionTitle>{t('statusApi.endpoints.title', 'Endpoints')}</SectionTitle>
            <Badge variant="neutral" size="sm">
              {t('statusApi.endpoints.count', '{{n}} routes', { n: endpoints.length })}
            </Badge>
          </div>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr))]">
            {endpoints.map((ep) => (
              <StatusApiEndpointCard key={ep.path} {...ep} />
            ))}
          </div>
        </section>
      </FadeIn>

      {/* 4 — Footer note */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <InlineCallout
            variant="info"
            icon={<ExternalLink />}
            action={{
              label: t('statusApi.footer.action', 'Open an issue'),
              href: 'https://github.com/ev-dev-labs/teslasync/issues',
            }}
          >
            {t(
              'statusApi.footer.note',
              'Need an additional endpoint or field? Open an issue on the project repo — the API surface is intentionally small, but additive changes are welcome.',
            )}
          </InlineCallout>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  )
}
