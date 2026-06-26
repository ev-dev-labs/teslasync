// Native parity port of web/src/features/system/pages/StatusApiDocsPage.tsx.
//
// StatusApiDocsPage is the static documentation page for the /api/v1/status/*
// endpoints. Self-hosted operators wire TeslaSync into their own dashboards
// (Grafana, Uptime Kuma, Home Assistant) and this page documents the stable
// contract so they don't have to reverse-engineer the Go handler. The content is
// entirely static — there is NO backend round-trip, NO data hook, and NO i18n on
// the web original (every string is a hard-coded English literal), so the native
// port keeps every string verbatim rather than inventing translation keys.
//
// The web original leans on a handful of browser-only / web-UI dependencies that
// have no native analogue, so — following the established conversion idiom
// (HelpPage / SafetyPage / WebhooksPage) — every such dependency is reproduced
// with React Native primitives + the shared native building blocks and documented
// in the sidecar:
//
//   - react-router-dom `Link to="/system-status"` performs in-app SPA
//     navigation; React Native has no DOM router, so the back action becomes a
//     Pressable (accessibilityRole="link") whose onPress delegates to a
//     native-safe `onNavigate(to)` callback — the analogue of the SPA navigate
//     and the same idiom HelpPage uses. Optional, so the page can mount before a
//     shell wires navigation (the tap is then a no-op, like a Link with no
//     router).
//   - lucide-react icons (Server, ArrowLeft, Code) have no native SVG analogue.
//     The two marker icons (Server in the Overview heading, Code in the
//     additive-only note) map to the closest shared SemanticIcon glyphs
//     (Server->'server', Code->'terminal'); the directional ArrowLeft in the back
//     pill becomes a muted `\u2190` text glyph (the HelpPage ArrowRight->`\u2192`
//     precedent for borderless inline arrows).
//   - @/components/layout PageContainer (title + subtitle + actions scaffold) is
//     inlined as a ScrollView + header (title, subtitle, and the back-link action
//     pill), preserving the exact strings.
//   - @/components/ui GlassPanel -> the already-ported native GlassPanel (bordered
//     glass surface); the web usage passed no `padding` prop, so native adds card
//     padding so content does not clip the rounded border (the established native
//     GlassPanel idiom). @/components/ui Badge variant="info" -> a local info chip
//     (rounded-full, blue tint + blue-200 text) reproducing the SafetyPage badge
//     idiom.
//   - The web `<details>/<summary>` "Example response" disclosure is a native
//     `useState` collapsible: the summary becomes a Pressable that toggles a
//     `>`/`v` glyph, and the `<pre>{JSON.stringify(example, null, 2)}</pre>` body
//     renders only when expanded inside a monospace code block (the WebhooksPage
//     response-body disclosure idiom). Default-collapsed mirrors a `<details>`
//     without the `open` attribute.
//   - Tailwind utility classes + CSS custom properties (var(--text-primary/
//     secondary/muted), text-cyan-200, text-amber-200/80, bg-white/[0.05]) resolve
//     to StyleSheet styles against the native theme tokens; the `max-w-3xl mx-auto`
//     reading column renders as the full-width phone column. Inline `<code>` and
//     `<strong>` spans are reproduced as nested AppText runs (monospace / bold).
//
// The Endpoint sub-component, its EndpointProps shape (method/path/description/
// query/example), every endpoint path + query + description, and all six example
// JSON payloads (plus the SSE note) are preserved verbatim. No DOM, react-router,
// lucide-react, Recharts, Leaflet, framer-motion, or old web UI components are
// imported.

import React, {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

// Native-safe replacement for react-router-dom `Link`'s in-app navigation: the
// resolved destination path is handed to the navigation shell. Optional so the
// page can be mounted before a shell wires navigation; when absent the tap is a
// no-op (the back pill still renders), mirroring a `Link` rendered without a
// router.
export type StatusApiDocsNavigateHandler = (to: string) => void;

export interface StatusApiDocsPageProps {
  onNavigate?: StatusApiDocsNavigateHandler;
}

// Matches the web Endpoint props. `example` is typed Record<string, unknown>
// (lint-safe equivalent of the web `object`); every payload below is a plain
// JSON object so JSON.stringify(example, null, 2) renders identically.
interface EndpointProps {
  method: 'GET';
  path: string;
  description: string;
  query?: string;
  example: Record<string, unknown>;
}

// One documented endpoint card. The web `<details>` disclosure becomes a
// native-safe useState collapsible: default-collapsed (like `<details>` without
// `open`), and the example JSON only renders once the summary is pressed.
function Endpoint({method, path, description, query, example}: EndpointProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <GlassPanel style={styles.endpoint} testID={`status-api-endpoint-${path}`}>
      <View style={styles.endpointHeader}>
        <View style={styles.methodBadge}>
          <AppText style={styles.methodBadgeText} weight="semibold">
            {method}
          </AppText>
        </View>
        <AppText style={styles.pathCode}>{path}</AppText>
        {query ? <AppText style={styles.queryText}>{`?${query}`}</AppText> : null}
      </View>

      <AppText style={styles.endpointDescription}>{description}</AppText>

      <View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setExpanded(value => !value)}
          style={({pressed}) => [pressed && styles.summaryPressed]}
          testID={`status-api-example-toggle-${path}`}>
          <AppText style={styles.summaryText}>
            {`${expanded ? 'v' : '>'}  Example response`}
          </AppText>
        </Pressable>
        {expanded ? (
          <View style={styles.examplePre}>
            <AppText style={styles.exampleCode}>
              {JSON.stringify(example, null, 2)}
            </AppText>
          </View>
        ) : null}
      </View>
    </GlassPanel>
  );
}

export default function StatusApiDocsPage({onNavigate}: StatusApiDocsPageProps = {}) {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={styles.screen}
      testID="status-api-docs-page">
      {/* PageContainer title + subtitle + actions scaffold, inlined. */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText variant="title" weight="bold">
            Status API
          </AppText>
          <AppText style={styles.subtitle}>
            Stable contract for external integrations
          </AppText>
        </View>
        <Pressable
          accessibilityRole="link"
          onPress={() => onNavigate?.('/system-status')}
          style={({pressed}) => [styles.backPill, pressed && styles.backPillPressed]}
          testID="status-api-back-link">
          <AppText style={styles.backArrow}>{'\u2190'}</AppText>
          <AppText style={styles.backText} weight="semibold">
            Back to System Status
          </AppText>
        </Pressable>
      </View>

      {/* max-w-3xl mx-auto reading column -> full-width phone column. */}
      <View style={styles.column}>
        <GlassPanel style={styles.overviewPanel}>
          <View style={styles.overviewHeading}>
            <SemanticIcon name="server" size="sm" decorative />
            <AppText style={styles.overviewTitle} weight="semibold">
              Overview
            </AppText>
          </View>

          <View style={styles.overviewBody}>
            <AppText style={styles.bodyText}>
              All endpoints are mounted under{' '}
              <AppText style={styles.codeCyan}>/api/v1/status</AppText> and inherit
              the same authentication as the rest of the API. If you proxy this
              with ForwardAuth (Authelia, Authentik, Tinyauth, etc.), the proxy
              handles auth — otherwise pass an API key in the standard{' '}
              <AppText style={styles.codeInline}>Authorization: Bearer …</AppText>{' '}
              header.
            </AppText>
            <AppText style={styles.bodyText}>
              Designed for: <AppText style={styles.strong}>Grafana</AppText> (JSON
              datasource), <AppText style={styles.strong}>Uptime Kuma</AppText>{' '}
              (HTTP(s) JSON Query monitor),{' '}
              <AppText style={styles.strong}>Home Assistant</AppText> (REST sensor),
              <AppText style={styles.strong}> Healthchecks.io</AppText> (synthetic
              monitor), or any other system that consumes JSON over HTTP.
            </AppText>
            <View style={styles.noteRow}>
              <SemanticIcon name="terminal" size="sm" decorative />
              <AppText style={styles.noteText}>
                The shape is additive-only — new fields may appear, but existing
                field types and names won't change without a major version bump.
              </AppText>
            </View>
          </View>
        </GlassPanel>

        <Endpoint
          method="GET"
          path="/api/v1/status"
          description="Overall snapshot — answers 'is it healthy right now?' in a single round-trip. Includes counts, version, resources, maintenance, and a list of active incidents."
          example={{
            status: 'operational',
            generated_at: '2025-01-15T14:32:11Z',
            version: {build: '1.4.2', go_version: 'go1.22.5', started_at: '2025-01-10T08:00:00Z'},
            counts: {components_total: 8, components_healthy: 8, components_degraded: 0, components_unhealthy: 0},
            resources: {goroutines: 142, uptime_seconds: 458321.4, go_version: 'go1.22.5'},
            incidents: [],
          }}
        />

        <Endpoint
          method="GET"
          path="/api/v1/status/components"
          description="Per-component health array — useful for surfacing individual subsystem status (database, mqtt, tesla, telemetry, etc.) in your own dashboard."
          example={{
            generated_at: '2025-01-15T14:32:11Z',
            counts: {components_total: 3, components_healthy: 3, components_degraded: 0, components_unhealthy: 0},
            components: [
              {name: 'database', status: 'healthy', consecutive_failures: 0, last_check_at: '2025-01-15T14:32:08Z'},
              {name: 'mqtt', status: 'healthy', consecutive_failures: 0, last_check_at: '2025-01-15T14:32:08Z'},
              {name: 'tesla', status: 'healthy', consecutive_failures: 0, last_check_at: '2025-01-15T14:32:08Z'},
            ],
          }}
        />

        <Endpoint
          method="GET"
          path="/api/v1/status/resources"
          description="Runtime resources only (goroutines, uptime, Go version). Light enough to poll at high frequency."
          example={{
            generated_at: '2025-01-15T14:32:11Z',
            resources: {goroutines: 142, uptime_seconds: 458321.4, go_version: 'go1.22.5'},
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
                  {at: '2025-01-15T13:55:00Z', status: 'investigating', message: 'Incident opened.', author: 'operator'},
                  {at: '2025-01-15T14:10:00Z', status: 'identified', message: 'Cause: TLS cert rotation gap.', author: 'operator'},
                  {at: '2025-01-15T14:20:00Z', status: 'monitoring', message: 'Cert rotated; watching.', author: 'operator'},
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

        <GlassPanel style={styles.footerPanel}>
          <AppText style={styles.footerText}>
            Need an additional endpoint or field? Open an issue on the project repo
            — the API surface is intentionally small, but additive changes are
            welcome.
          </AppText>
        </GlassPanel>
      </View>
    </ScrollView>
  );
}

// Resolved palette. The web uses Tailwind tokens / CSS vars; native carries the
// literal hexes / token references so the visual intent survives without
// Tailwind.
const WHITE_05 = 'rgba(255, 255, 255, 0.05)'; // bg-white/[0.05] (back pill)
const WHITE_08 = 'rgba(255, 255, 255, 0.08)'; // hover:bg-white/[0.08]
const CYAN_200 = '#a5f3fc'; // text-cyan-200 (path / inline code)
const AMBER_200_80 = 'rgba(253, 230, 138, 0.8)'; // text-amber-200/80 (additive note)
const SURFACE_OVERLAY = 'rgba(2, 6, 13, 0.85)'; // var(--surface-overlay) (pre block)
const BADGE_INFO_BG = 'rgba(30, 58, 138, 0.55)'; // bg-blue-900 (info, on glass)
const BADGE_INFO_BORDER = 'rgba(96, 165, 250, 0.32)'; // blue-400/32 outline
const BADGE_INFO_TEXT = '#bfdbfe'; // text-blue-200

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.md,
  },
  headerText: {
    gap: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  backPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderRadius: 8,
    backgroundColor: WHITE_05,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  backPillPressed: {
    backgroundColor: WHITE_08,
  },
  backArrow: {
    fontSize: 13,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  backText: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  column: {
    gap: spacing.lg,
  },
  overviewPanel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  overviewHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  overviewTitle: {
    fontSize: 16,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  overviewBody: {
    gap: spacing.md,
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  codeCyan: {
    fontFamily: 'monospace',
    color: CYAN_200,
  },
  codeInline: {
    fontFamily: 'monospace',
    color: colors.textSecondary,
  },
  strong: {
    fontWeight: '700',
    color: colors.textSecondary,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  noteText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    color: AMBER_200_80,
  },
  endpoint: {
    padding: spacing.md,
    gap: spacing.md,
  },
  endpointHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  methodBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BADGE_INFO_BORDER,
    backgroundColor: BADGE_INFO_BG,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  methodBadgeText: {
    fontSize: 12,
    lineHeight: 16,
    color: BADGE_INFO_TEXT,
  },
  pathCode: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 18,
    color: CYAN_200,
  },
  queryText: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  endpointDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  summaryPressed: {
    opacity: 0.7,
  },
  summaryText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  examplePre: {
    marginTop: spacing.sm,
    borderRadius: 8,
    backgroundColor: SURFACE_OVERLAY,
    padding: spacing.md,
  },
  exampleCode: {
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  footerPanel: {
    padding: spacing.md,
  },
  footerText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
});
