/**
 * StatusApiDocsPage — Phase-2 docs page for /api/v1/status/* endpoints.
 *
 * Self-hosted operators wire TeslaSync into their own dashboards
 * (Grafana, Uptime Kuma, Home Assistant). This page documents the
 * stable contract so they don't have to reverse-engineer the Go
 * handler. Static content — no backend round-trip.
 */

import { Link } from 'react-router-dom'
import { Server, ArrowLeft, Code } from 'lucide-react'
import { PageContainer } from '@/components/layout'
import { GlassPanel, Badge } from '@/components/ui'

interface EndpointProps {
  method: 'GET'
  path: string
  description: string
  query?: string
  example: object
}

function Endpoint({ method, path, description, query, example }: EndpointProps) {
  return (
    <GlassPanel className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="info">{method}</Badge>
        <code className="font-mono text-sm text-cyan-200">{path}</code>
        {query && <span className="text-xs text-[var(--text-muted)]">?{query}</span>}
      </div>
      <p className="text-sm text-[var(--text-secondary)]">{description}</p>
      <details className="text-xs">
        <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          Example response
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-md bg-[var(--surface-overlay)] p-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
{JSON.stringify(example, null, 2)}
        </pre>
      </details>
    </GlassPanel>
  )
}

export default function StatusApiDocsPage() {
  return (
    <PageContainer
      title="Status API"
      subtitle="Stable contract for external integrations"
      actions={
        <Link to="/system-status" className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to System Status
        </Link>
      }
    >
      <div className="max-w-3xl mx-auto space-y-5">
        <GlassPanel className="p-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)] inline-flex items-center gap-2">
            <Server className="h-4 w-4" />
            Overview
          </h2>
          <div className="mt-3 space-y-3 text-sm text-[var(--text-secondary)]">
            <p>
              All endpoints are mounted under <code className="font-mono text-cyan-200">/api/v1/status</code> and
              inherit the same authentication as the rest of the API. If you proxy this with ForwardAuth
              (Authelia, Authentik, Tinyauth, etc.), the proxy handles auth — otherwise pass an API key in the
              standard <code className="font-mono">Authorization: Bearer …</code> header.
            </p>
            <p>
              Designed for: <strong>Grafana</strong> (JSON datasource), <strong>Uptime Kuma</strong>{' '}
              (HTTP(s) JSON Query monitor), <strong>Home Assistant</strong> (REST sensor),
              <strong> Healthchecks.io</strong> (synthetic monitor), or any other system that consumes JSON over HTTP.
            </p>
            <p className="inline-flex items-start gap-1.5 text-amber-200/80">
              <Code className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                The shape is additive-only — new fields may appear, but existing field types and names won't
                change without a major version bump.
              </span>
            </p>
          </div>
        </GlassPanel>

        <Endpoint
          method="GET"
          path="/api/v1/status"
          description="Overall snapshot — answers 'is it healthy right now?' in a single round-trip. Includes counts, version, resources, maintenance, and a list of active incidents."
          example={{
            status: 'operational',
            generated_at: '2025-01-15T14:32:11Z',
            version: { build: '1.4.2', go_version: 'go1.22.5', started_at: '2025-01-10T08:00:00Z' },
            counts: { components_total: 8, components_healthy: 8, components_degraded: 0, components_unhealthy: 0 },
            resources: { goroutines: 142, uptime_seconds: 458321.4, go_version: 'go1.22.5' },
            incidents: [],
          }}
        />

        <Endpoint
          method="GET"
          path="/api/v1/status/components"
          description="Per-component health array — useful for surfacing individual subsystem status (database, mqtt, tesla, telemetry, etc.) in your own dashboard."
          example={{
            generated_at: '2025-01-15T14:32:11Z',
            counts: { components_total: 3, components_healthy: 3, components_degraded: 0, components_unhealthy: 0 },
            components: [
              { name: 'database', status: 'healthy', consecutive_failures: 0, last_check_at: '2025-01-15T14:32:08Z' },
              { name: 'mqtt',     status: 'healthy', consecutive_failures: 0, last_check_at: '2025-01-15T14:32:08Z' },
              { name: 'tesla',    status: 'healthy', consecutive_failures: 0, last_check_at: '2025-01-15T14:32:08Z' },
            ],
          }}
        />

        <Endpoint
          method="GET"
          path="/api/v1/status/resources"
          description="Runtime resources only (goroutines, uptime, Go version). Light enough to poll at high frequency."
          example={{
            generated_at: '2025-01-15T14:32:11Z',
            resources: { goroutines: 142, uptime_seconds: 458321.4, go_version: 'go1.22.5' },
          }}
        />

        <Endpoint
          method="GET"
          path="/api/v1/status/uptime"
          query="window=24h | 7d | 30d | 90d | 1y"
          description="Uptime percentage over the requested window. Until per-component heartbeat history is wired, the percentage is derived from the current snapshot — the historical_source field signals which is in play."
          example={{
            window: '30d',
            uptime_percent: 100,
            healthy_count: 8,
            total_count: 8,
            generated_at: '2025-01-15T14:32:11Z',
            historical_source: 'current_snapshot',
            note: 'Per-window uptime requires the heartbeat history backend (planned). This value reflects the current snapshot only.',
          }}
        />

        <Endpoint
          method="GET"
          path="/api/v1/status/incidents"
          query="active=1 | limit=N"
          description="Active incidents list. Pass active=1 to filter to incidents whose resolved_at is NULL."
          example={{
            count: 1,
            incidents: [
              {
                id: 17, title: 'MQTT broker reconnect storm', status: 'monitoring', severity: 'minor',
                source: 'manual', affected_components: ['mqtt'],
                started_at: '2025-01-15T13:55:00Z', updated_at: '2025-01-15T14:20:00Z',
                updates: [
                  { at: '2025-01-15T13:55:00Z', status: 'investigating', message: 'Incident opened.', author: 'operator' },
                  { at: '2025-01-15T14:10:00Z', status: 'identified',    message: 'Cause: TLS cert rotation gap.', author: 'operator' },
                  { at: '2025-01-15T14:20:00Z', status: 'monitoring',    message: 'Cert rotated; watching.',       author: 'operator' },
                ],
              },
            ],
          }}
        />

        <Endpoint
          method="GET"
          path="/api/v1/status/live"
          description="Server-Sent Events stream. Pushes a `status` event with the full snapshot every 30 seconds. Heartbeat events emitted every 25s so reverse proxies don't garbage-collect the connection mid-flight. Browsers consume this via EventSource(). For curl: -N --no-buffer."
          example={{
            note: 'event: status\\ndata: <full StatusSnapshot JSON>\\n\\n',
          }}
        />

        <GlassPanel className="p-4 text-xs text-[var(--text-muted)]">
          Need an additional endpoint or field? Open an issue on the project repo — the API surface is
          intentionally small, but additive changes are welcome.
        </GlassPanel>
      </div>
    </PageContainer>
  )
}
