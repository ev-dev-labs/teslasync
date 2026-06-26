// Native parity port of web/src/features/charging/pages/TeslaChargingSessionsMap.tsx.
//
// The web module renders a 350px Leaflet map (`MapContainer` + `MapTileLayer` +
// `MarkerCluster`) of charging sessions: it averages the sessions' coordinates
// into a `center`, then derives `clusterPoints` — one `{id, lat, lng, popupHtml,
// ariaLabel}` per session with valid coords, where `popupHtml` is an escaped HTML
// bubble (site name, start datetime, energy in kWh, cost, charger type).
//
// react-leaflet (`MapContainer`/`MarkerCluster`) and the leaflet runtime are
// browser/DOM-only and there is no react-native-maps / leaflet in this native
// dependency set, so the interactive raster map + marker clustering cannot be
// reproduced (rules 4/5/7). This port therefore:
//   • preserves the default-exported component, the `Props { sessions }` shape,
//     the `center` useMemo (same 37.77/-122.42 fallback + average), and the
//     `clusterPoints` useMemo VERBATIM — including the inner `escapeHtml`, the
//     `tesla_sessions.unknown` site-name fallback, the SI energy conversion
//     (`convertEnergyFromSI(total_energy_added_wh, 'kWh')`), the `formatCurrency`
//     cost, the charger-type branch, the built `popupHtml`, and the
//     `tesla_sessions.markerLabel` aria label;
//   • reuses the already-ported native <MapTileLayer /> (mirroring the web
//     `<MapTileLayer />` child) for the tile-preview surface;
//   • surfaces an explicit "interactive map + clustering unavailable on native"
//     notice plus the derived data: the averaged center + zoom, and a scrollable
//     list of every cluster point rendered from its own `popupHtml` (decoded back
//     to plain text) and tagged with its `ariaLabel`, so no marker data is hidden;
//   • keeps the leaflet-only props (`zoom={5}`, `scrollWheelZoom`,
//     `maxClusterRadius={60}`, `defaultColor="#22d3ee"`) as documented constants —
//     zoom + radius are shown in the info row and the default colour drives each
//     marker dot; scroll-wheel zoom has no native analog and is dropped.
//
// No DOM elements, react-i18next, Recharts, Leaflet, react-leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {useCallback, useMemo} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';

import {useSettings} from '../../../api/hooks/useSettings';
import type {TeslaChargingSession} from '../../../api/hooks/useCharging';
import {MapTileLayer} from '../../../components/maps/MapTileLayer';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation) ──────────────────── */

type TVars = Record<string, string | number>;
type TFunc = (key: string, fallback?: string, vars?: TVars) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site, with {{var}} interpolation so the
// tesla_sessions.markerLabel '{{name}} charging session' call still substitutes.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback, vars) => {
    let out = fallback ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        out = out.replace(
          new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, 'g'),
          String(value),
        );
      }
    }
    return out;
  }, []);
  return {t};
}

/* ─── inlined @/lib/numberFormat fmtNumber ──────────────────────────────── */

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber(value, decimals?, locale?): locale-aware fixed-decimal formatting
// with non-finite inputs coerced to 0; the web global precision default is 2 and
// a bad locale tag falls back to en-US so a string is always produced.
function fmtNumber(
  v: unknown,
  decimals: number = DEFAULT_PRECISION,
  locale: string = DEFAULT_LOCALE,
): string {
  const d = Math.max(0, Math.min(20, Math.floor(decimals)));
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

/* ─── inlined @/lib/dateFormat formatDateTime ───────────────────────────── */

// web formatDateTime: "Apr 4, 2026, 02:30 PM"; '—' for null/invalid input.
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(DEFAULT_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ─── inlined @/lib/unitConversion convertEnergyFromSI ──────────────────── */

// web convertEnergyFromSI(wh, 'kWh') = wh / 1000.
function convertEnergyFromSI(wh: number, to: 'Wh' | 'kWh'): number {
  return to === 'kWh' ? wh / 1000 : wh;
}

/* ─── inlined @/hooks/useFormatting (settings-derived formatCurrency) ───── */

function derivePrecision(decimalPrecision: unknown): number {
  if (
    typeof decimalPrecision === 'number' &&
    Number.isFinite(decimalPrecision) &&
    decimalPrecision >= 0
  ) {
    return Math.floor(decimalPrecision);
  }
  return DEFAULT_PRECISION;
}

// web useFormatting: formatCurrency(amount, decimals?) =
// `${currency_symbol||'$'}${fmtNumber(amount, decimals ?? decimal_precision)}`,
// using the settings-driven currency symbol, precision, and locale.
function useFormatting(): {formatCurrency: (amount: number, decimals?: number) => string} {
  const {data} = useSettings();
  const locale =
    typeof data?.locale === 'string' && data.locale.trim().length > 0
      ? data.locale
      : DEFAULT_LOCALE;
  const currencySymbol =
    data?.currency_symbol && data.currency_symbol.trim()
      ? data.currency_symbol
      : '$';
  const userPrecision = derivePrecision(data?.decimal_precision);

  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string =>
      `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision, locale)}`,
    [currencySymbol, userPrecision, locale],
  );

  return {formatCurrency};
}

/* ─── leaflet props preserved as documented constants ──────────────────── */

// MarkerCluster defaultColor="#22d3ee" — drives each marker dot below.
const DEFAULT_MARKER_COLOR = '#22d3ee';
// MapContainer zoom={5} — surfaced in the info row (no interactive native map).
const MAP_ZOOM = 5;
// MarkerCluster maxClusterRadius={60} — surfaced in the info row; clustering is
// unavailable on native (no leaflet), so it is documentary only.
const MAX_CLUSTER_RADIUS = 60;

/* ─── native cluster-point shape (web @/components/maps ClusterPoint) ───── */

interface ClusterPoint {
  id: string | number;
  lat: number;
  lng: number;
  popupHtml?: string;
  ariaLabel?: string;
}

// Decode the leaflet popup HTML back to display lines for the native list: each
// <p>…</p> becomes one line, inner tags are stripped, and the escapeHtml entities
// are reversed (named entities first, &amp; last) so user content round-trips.
function popupHtmlToLines(html: string | undefined): string[] {
  if (!html) return [];
  const blocks = html.match(/<p[^>]*>([\s\S]*?)<\/p>/g) ?? [];
  return blocks
    .map(block =>
      block
        .replace(/<[^>]*>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(line => line.length > 0);
}

interface Props {
  sessions: TeslaChargingSession[];
}

export default function TeslaChargingSessionsMap({sessions}: Props) {
  const {t} = useTranslation();
  const {formatCurrency} = useFormatting();
  const center = useMemo(() => {
    if (sessions.length === 0) return {lat: 37.77, lng: -122.42};
    const avgLat =
      sessions.reduce((sum, s) => sum + (s.latitude ?? 0), 0) / sessions.length;
    const avgLng =
      sessions.reduce((sum, s) => sum + (s.longitude ?? 0), 0) / sessions.length;
    return {lat: avgLat, lng: avgLng};
  }, [sessions]);

  /* Cluster points are derived from sessions with valid coords. */
  const clusterPoints = useMemo<ClusterPoint[]>(
    () =>
      sessions
        .filter(
          s =>
            typeof s.latitude === 'number' &&
            typeof s.longitude === 'number' &&
            !Number.isNaN(s.latitude) &&
            !Number.isNaN(s.longitude),
        )
        .map(s => {
          const escapeHtml = (str: string) =>
            str.replace(/[&<>"']/g, c => {
              switch (c) {
                case '&':
                  return '&amp;';
                case '<':
                  return '&lt;';
                case '>':
                  return '&gt;';
                case '"':
                  return '&quot;';
                case "'":
                  return '&#39;';
                default:
                  return c;
              }
            });
          const siteName = escapeHtml(
            s.site_location_name || t('tesla_sessions.unknown', 'Unknown'),
          );
          const energy =
            s.total_energy_added_wh != null
              ? `<p>${fmtNumber(
                  convertEnergyFromSI(s.total_energy_added_wh, 'kWh'),
                  1,
                )} kWh</p>`
              : '';
          const cost =
            s.total_cost != null
              ? `<p>${formatCurrency(s.total_cost, 2)}</p>`
              : '';
          const charger = s.charger_type
            ? `<p style="text-transform:uppercase">${escapeHtml(
                String(s.charger_type),
              )}</p>`
            : '';
          return {
            id: s.session_id,
            lat: s.latitude as number,
            lng: s.longitude as number,
            popupHtml: `
              <div style="font-size:12px;line-height:1.3">
                <p style="font-weight:600;margin-bottom:2px">${siteName}</p>
                <p>${escapeHtml(formatDateTime(s.charge_start_datetime))}</p>
                ${energy}${cost}${charger}
              </div>
            `,
            ariaLabel: t(
              'tesla_sessions.markerLabel',
              '{{name}} charging session',
              {
                name:
                  s.site_location_name || t('tesla_sessions.unknown', 'Unknown'),
                defaultValue: '{{name}} charging session',
              },
            ) as string,
          };
        }),
    [sessions, t, formatCurrency],
  );

  return (
    <View
      accessibilityLabel={t('tesla_sessions.mapLabel', 'Charging sessions map')}
      style={styles.container}
      testID="tesla-charging-sessions-map">
      <MapTileLayer containerStyle={styles.tile} />

      <View style={styles.infoRow}>
        <AppText variant="caption" weight="semibold">
          {t('tesla_sessions.markerCount', '{{count}} mapped sessions', {
            count: clusterPoints.length,
          })}
        </AppText>
        <AppText variant="caption" tone="secondary">
          {t(
            'tesla_sessions.centerInfo',
            'Center {{lat}}, {{lng}} · zoom {{zoom}} · cluster radius {{radius}}px',
            {
              lat: center.lat.toFixed(4),
              lng: center.lng.toFixed(4),
              zoom: MAP_ZOOM,
              radius: MAX_CLUSTER_RADIUS,
            },
          )}
        </AppText>
        <AppText variant="caption" tone="muted">
          {t(
            'tesla_sessions.nativeUnavailable',
            'Interactive map and marker clustering are unavailable in this native parity component; sessions are listed below.',
          )}
        </AppText>
      </View>

      <ScrollView
        contentContainerStyle={styles.listContent}
        nestedScrollEnabled
        style={styles.list}>
        {clusterPoints.length === 0 ? (
          <AppText variant="caption" tone="muted">
            {t(
              'tesla_sessions.noMappedSessions',
              'No charging sessions with map coordinates.',
            )}
          </AppText>
        ) : (
          clusterPoints.map(point => {
            const lines = popupHtmlToLines(point.popupHtml);
            return (
              <View
                accessible
                accessibilityLabel={point.ariaLabel}
                key={point.id}
                style={styles.markerRow}>
                <View
                  style={[
                    styles.markerDot,
                    {backgroundColor: DEFAULT_MARKER_COLOR},
                  ]}
                />
                <View style={styles.markerBody}>
                  {lines.map((line, index) => (
                    <AppText
                      key={`${point.id}-${index}`}
                      tone={index === 0 ? 'primary' : 'secondary'}
                      variant="caption"
                      weight={index === 0 ? 'semibold' : 'regular'}>
                      {line}
                    </AppText>
                  ))}
                  <AppText tone="muted" variant="caption">
                    {`${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`}
                  </AppText>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.sm,
    minHeight: 350,
    overflow: 'hidden',
    padding: spacing.sm,
  },
  infoRow: {
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  list: {
    flexGrow: 0,
    maxHeight: 220,
  },
  listContent: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  markerBody: {
    flex: 1,
    gap: 2,
  },
  markerDot: {
    borderRadius: 5,
    height: 10,
    marginTop: spacing.xs,
    width: 10,
  },
  markerRow: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  tile: {
    minHeight: 140,
  },
});
