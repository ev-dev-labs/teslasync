// Native parity port of web/src/features/admin/pages/ApiLogsPage.tsx.
//
// The web source is the admin "API Logs" page: a stat header (total calls,
// error rate, avg duration, last-24h) + a by-service chip row, a filter panel
// (service / method / status Selects + an endpoint search Input), and a
// paginated, expandable table of API-call-log rows (timestamp, service badge,
// method badge, endpoint, status badge, duration, error message) whose expanded
// detail shows the request URL, error, and request/response JSON bodies. It is
// driven by two `useQuery` calls (`/api-logs/stats` @30s, `/api-logs` @10s),
// a unified `<RangePicker>` for the from/to window, and URL-synced filter state.
//
// It composes a large amount of DOM/web-only chrome that React Native has no
// equivalent for, so — mirroring the sibling admin parity ports (StatusHeader
// inlines its StatCard/AlertBanner/Grid, RedisDiagnosticEmptyState inlines its
// Badge/Button/EmptyState) — this self-contained port rebuilds each piece with
// React Native primitives and the existing native tokens/components:
//   * `<PageContainer>` -> an inline `PageContainerView` (a `ScrollView` with a
//     title/subtitle header row + an `actions` slot, then the page body stack).
//   * `<StatCard>` -> an inline `StatCardView` on the shared `GlassPanel`
//     (label + corner icon, large value, optional danger trend line).
//   * `<Badge>` (info/success/warning/danger/neutral) -> an inline `Badge` pill
//     using the matching token surfaces (info->accent, success, warning, danger,
//     neutral) — the same approach as the RedisDiagnostic ModeBadge.
//   * `<Select>` -> an inline `SelectField` (a field-styled trigger that opens a
//     React Native `Modal` list of options; picking one fires `onChange`) — the
//     native analogue of an HTML <select>.
//   * `<Input type=text>` with a Search affordance -> an inline `SearchInput`
//     (a bordered row with a search `SemanticIcon` + RN `TextInput`).
//   * `<Spinner>` -> RN `ActivityIndicator`.
//   * `<AlertBanner variant="danger">` -> an inline `DangerBanner` (rose
//     translucent bordered notice with an alert icon, matching the sibling
//     warning-banner ports).
//   * `<FadeIn>` -> a passthrough `View`; the web entrance animation
//     (framer-motion) has no behavioural contract, so the wrapper + its stagger
//     `delay` are preserved structurally without the animation.
//   * `<RangePicker>` (a DOM popover with react-day-picker calendar) -> an inline
//     `RangePickerControl` of preset chips (All / 24h / 7d / 30d / 90d). The
//     calendar popover + `react-day-picker` are DOM-only; the preset row keeps
//     the behavioural contract ("the picker drives the from/to window; absence
//     of bounds = full history") with only RN primitives. Documented native-safe
//     adaptation.
//   * The lucide-react glyphs (FileText, Clock, AlertTriangle, Activity,
//     Download, ChevronLeft/Right/Down/Up, Search, Filter, X, AlertCircle) map
//     to the nearest repo `SemanticIcon` names; no lucide-react / DOM import.
//   * `<DateTime value={log.ts} in="utc" />` -> an inline `formatTimestampUtc`
//     (Intl `DateTimeFormat` pinned to `timeZone: 'UTC'`), preserving the web
//     "render this instant in UTC" intent that `in="utc"` selected.
//   * `handleExport` (a Blob + `<a download>` click) -> the RN `Share` API
//     (share the same pretty-printed JSON, using the same dated filename as the
//     share title). Browser file download has no native equivalent; the share
//     sheet preserves the "get these logs out as JSON" intent. Documented.
//   * The URL-state hooks (`useUrlNumber`/`useUrlString`/`useUrlBatch`) and
//     `useRangeState` -> in-process `useState` + a `setUrl` batch writer. Native
//     has no router/URL or `localStorage`, so filter/page/range state lives in
//     memory; the exact state names (`page`, `method`, `status`, `endpoint`,
//     `service`, `expandedId`) and the page-reset-on-filter-change semantics are
//     preserved. The `persistKey` localStorage memory is dropped (documented).
//   * `usePageTitle` -> a no-op `useNativePageTitle` (no `document.title` on
//     native); the title is still rendered in the page header.
//   * `deriveServiceOptions` / `ServiceSelectOption` (from ../lib/serviceOptions)
//     and the tiny `getErrorMessage` / `fmtNumber` / `fmtInt` helpers are inlined
//     verbatim because no native lib port exists yet; the logic is identical.
//   * react-i18next `useTranslation` -> a self-contained
//     `useNativeTranslationFallback` that returns each English fallback and
//     reproduces i18next `{{var}}` interpolation, preserving every key, fallback,
//     and the from/to/total/page/label/tracked/known substitutions.
//
// No DOM, no lucide-react, no Recharts/Leaflet, no react-router, no
// framer-motion, and no web UI components are imported. The API functions and
// types (getAPICallLogs / getAPICallLogStats / APICallLog / APICallLogStats) are
// reused from the existing native api/devtools port (the same shapes the web
// source imported from @/api/devtools + @/api/types). The native request()
// preserves the snake_case keys, so every `log.http_method` / `log.status_code`
// / `stats.by_service` access reads identically.

import React, { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';
import {
  getAPICallLogs,
  getAPICallLogStats,
  type APICallLog,
  type APICallLogStats,
} from '../../../api/devtools';

/* ------------------------------------------------------------------ */
/*  i18n + native-safe helpers                                         */
/* ------------------------------------------------------------------ */

type TVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, vars?: TVars) => string;

// The web page read `t` from react-i18next. Native parity has no i18n runtime
// wired yet, so this returns the English fallback string and reproduces
// i18next's `{{name}}` interpolation, preserving every key, fallback, and the
// from / to / total / page / label / tracked / known substitutions used by the
// stats, table, and pagination copy.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string, vars?: TVars) => {
    if (!vars) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name)
        ? String(vars[name])
        : match,
    );
  }, []);
}

// Native no-op for the web `usePageTitle` (which set `document.title`). There is
// no document on native; the page header still renders the title.
function useNativePageTitle(_title: string): void {
  // Intentionally empty — see note above.
}

// Inlined from web `@/lib/errorMessage`. Normalises an unknown React Query error
// into a human-readable string.
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unexpected error occurred';
}

// Inlined locale-aware number formatters mirroring web `@/lib/numberFormat`
// (`fmtNumber` default precision 2, `fmtInt` precision 0). The web global locale
// defaults to 'en-US' until useSettings overrides it; native has no useSettings
// wired here, so 'en-US' is the faithful default.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// Native analogue of `<DateTime value={log.ts} in="utc" />`: render the instant
// in UTC (what `in="utc"` selected) using the same short month/day + time shape
// as the repo's default datetime formatter.
function formatTimestampUtc(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

// Tailwind breakpoints used by the responsive `hidden sm:block` / `hidden
// md:block` / `sm:hidden` log-row affordances.
const SM_BREAKPOINT = 640;
const MD_BREAKPOINT = 768;

/* ------------------------------------------------------------------ */
/*  Local helpers (ported verbatim from the web source)                */
/* ------------------------------------------------------------------ */

type LogBadgeVariant = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

const METHOD_VARIANTS: Record<string, LogBadgeVariant> = {
  GET: 'success',
  POST: 'info',
  PUT: 'warning',
  PATCH: 'warning',
  DELETE: 'danger',
};

const SERVICE_CONFIG: Record<string, { label: string; variant: LogBadgeVariant }> = {
  'teslasync-api':      { label: 'TeslaSync API',      variant: 'info'    },
  'tesla-api':          { label: 'Tesla API',          variant: 'info'    },
  'tesla-auth':         { label: 'Tesla Auth',         variant: 'info'    },
  'geocoder-google':    { label: 'Geocoder (Google)',  variant: 'warning' },
  'geocoder-nominatim': { label: 'Geocoder (Nominatim)', variant: 'warning' },
  'geocoder-azure':     { label: 'Geocoder (Azure)',   variant: 'warning' },
  'geocoder-search':    { label: 'Geocoder (Search)',  variant: 'warning' },
  'github-releases':    { label: 'GitHub Releases',    variant: 'neutral' },
  'notify-generic':     { label: 'Notifications',      variant: 'neutral' },
  'system-dns-check':   { label: 'DNS Health Check',   variant: 'neutral' },
  'eia':                { label: 'EIA',                variant: 'neutral' },
};

/** Static catalog of services the frontend knows the backend can write.
 *  Stable identity → safe to pass to deriveServiceOptions / useMemo deps. */
const KNOWN_SERVICES = Object.freeze(Object.keys(SERVICE_CONFIG));

function statusBadgeVariant(code: number | null): LogBadgeVariant {
  if (!code) return 'neutral';
  if (code < 300) return 'success';
  if (code < 400) return 'info';
  if (code < 500) return 'warning';
  return 'danger';
}

function serviceBadgeConfig(service: string): { label: string; variant: LogBadgeVariant } {
  return SERVICE_CONFIG[service] ?? { label: service, variant: 'neutral' };
}

// Inlined from web `../lib/serviceOptions` (no native lib port yet). Builds the
// Service-filter option list as the union of the static catalog, the live
// `stats.by_service` keys, and the active selection, sorted alphabetically by
// label, with the "All Services" head pinned first.
interface ServiceSelectOption {
  value: string;
  label: string;
}

interface DeriveOpts {
  byService: Record<string, number> | undefined;
  activeService: string;
  labelFor: (svc: string) => string;
  allLabel: string;
  knownServices?: readonly string[];
}

function deriveServiceOptions(opts: DeriveOpts): ServiceSelectOption[] {
  const { byService, activeService, labelFor, allLabel, knownServices } = opts;
  const head: ServiceSelectOption = { value: '', label: allLabel };

  const values = new Set<string>();
  for (const svc of knownServices ?? []) values.add(svc);
  for (const svc of Object.keys(byService ?? {})) values.add(svc);
  if (activeService) values.add(activeService);

  const tail: ServiceSelectOption[] = Array.from(values, (value) => ({
    value,
    label: labelFor(value),
  })).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  );

  return [head, ...tail];
}

/* ------------------------------------------------------------------ */
/*  Inline native chrome                                               */
/* ------------------------------------------------------------------ */

// FadeIn: web framer-motion entrance wrapper. The animation carries no
// behavioural contract, so this preserves the wrapper structurally (the
// `delay` stagger is accepted and ignored on native).
function FadeIn({ children }: { children: ReactNode; delay?: number }) {
  return <View style={styles.fadeIn}>{children}</View>;
}

// Native parity for the shared web Badge (size="sm").
function Badge({
  variant = 'neutral',
  children,
}: {
  variant?: LogBadgeVariant;
  children: ReactNode;
}) {
  return (
    <View style={[styles.badge, badgeToneStyles[variant]]}>
      <AppText
        style={badgeTextStyles[variant]}
        variant="caption"
        weight="semibold"
      >
        {children}
      </AppText>
    </View>
  );
}

interface StatCardTrend {
  direction: 'up' | 'down' | 'flat';
  value: string;
  positive?: boolean;
}

// Native parity for the shared web StatCard (label + corner icon, large value,
// optional trend line).
function StatCardView({
  fullWidth,
  wide,
  icon,
  label,
  value,
  trend,
}: {
  fullWidth: boolean;
  wide: boolean;
  icon: SemanticIconName;
  label: string;
  value: string;
  trend?: StatCardTrend;
}) {
  const trendArrow =
    trend?.direction === 'up' ? '↑' : trend?.direction === 'down' ? '↓' : '—';
  return (
    <GlassPanel
      style={[
        styles.statCard,
        fullWidth
          ? styles.statCardFull
          : wide
          ? styles.statCardQuarter
          : styles.statCardHalf,
      ]}
    >
      <View style={styles.statCardHeader}>
        <AppText tone="muted" variant="caption" weight="semibold">
          {label}
        </AppText>
        <SemanticIcon decorative name={icon} size="sm" />
      </View>
      <AppText variant="title" weight="bold">
        {value}
      </AppText>
      {trend ? (
        <View style={styles.statTrendRow}>
          <AppText
            style={trend.positive ? styles.trendPositive : styles.trendNegative}
            variant="caption"
          >
            {trendArrow} {trend.value}
          </AppText>
        </View>
      ) : null}
    </GlassPanel>
  );
}

// Native parity for the web AlertBanner variant="danger" (with an alert icon).
function DangerBanner({ children }: { children: ReactNode }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.dangerBanner}>
      <SemanticIcon decorative name="alertCircle" size="sm" />
      <AppText style={styles.dangerBannerText}>{children}</AppText>
    </View>
  );
}

// Native parity for the web <Select>: a field-styled trigger that opens a Modal
// list of options. Picking one fires onChange and closes the sheet.
function SelectField({
  value,
  options,
  onChange,
  accessibilityLabel,
  testID,
}: {
  value: string;
  options: ServiceSelectOption[];
  onChange: (value: string) => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected =
    options.find((o) => o.value === value) ?? options[0] ?? { value: '', label: '' };
  return (
    <View>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.field, pressed && styles.fieldPressed]}
        testID={testID}
      >
        <AppText style={styles.fieldText} numberOfLines={1}>
          {selected.label}
        </AppText>
        <SemanticIcon decorative name="expand" size="sm" />
      </Pressable>
      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.modalSheet}>
            <ScrollView>
              {options.map((o) => {
                const active = o.value === value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    key={o.value || '__all__'}
                    onPress={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.optionRow,
                      active && styles.optionRowActive,
                      pressed && styles.optionRowPressed,
                    ]}
                  >
                    <AppText
                      style={active ? styles.optionTextActive : styles.optionText}
                    >
                      {o.label}
                    </AppText>
                    {active ? (
                      <SemanticIcon decorative name="confirm" size="sm" />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// Native parity for the web search <Input>: a bordered row with a leading search
// icon + a TextInput.
function SearchInput({
  value,
  placeholder,
  onChangeText,
}: {
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <SemanticIcon decorative name="search" size="sm" />
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.searchInput}
        value={value}
      />
    </View>
  );
}

interface RangeValue {
  start: string;
  end: string;
}

const RANGE_PRESETS: { id: string; label: string; days: number | null }[] = [
  { id: 'all', label: 'All', days: null },
  { id: '24h', label: '24h', days: 1 },
  { id: '7d', label: '7d', days: 7 },
  { id: '30d', label: '30d', days: 30 },
  { id: '90d', label: '90d', days: 90 },
];

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function presetToRange(days: number | null): RangeValue {
  if (days == null) {
    return { start: '', end: '' };
  }
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  return { start: isoDay(start), end: isoDay(end) };
}

// Native parity for the web <RangePicker>: a row of preset chips. The DOM
// calendar popover (react-day-picker) is browser-only; the presets keep the
// behavioural contract — the picker drives the from/to window, and the "All"
// preset clears the bounds (= full history).
function RangePickerControl({
  value,
  onChange,
  testID,
}: {
  value: RangeValue;
  onChange: (value: RangeValue) => void;
  testID?: string;
}) {
  const activeId = useMemo(() => {
    if (!value.start && !value.end) {
      return 'all';
    }
    const match = RANGE_PRESETS.find((p) => {
      if (p.days == null) {
        return false;
      }
      const r = presetToRange(p.days);
      return r.start === value.start && r.end === value.end;
    });
    return match?.id;
  }, [value.start, value.end]);

  return (
    <View style={styles.rangeRow} testID={testID}>
      {RANGE_PRESETS.map((preset) => {
        const active = preset.id === activeId;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            key={preset.id}
            onPress={() => onChange(presetToRange(preset.days))}
            style={({ pressed }) => [
              styles.rangeChip,
              active && styles.rangeChipActive,
              pressed && styles.rangeChipPressed,
            ]}
          >
            <AppText
              style={active ? styles.rangeChipTextActive : styles.rangeChipText}
              variant="caption"
              weight="semibold"
            >
              {preset.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// Native parity for the web <PageContainer>: a scrollable page with a
// title/subtitle header + an actions slot, then the body stack.
function PageContainerView({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      style={styles.pageRoot}
    >
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderCopy}>
          <AppText variant="display" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText tone="muted" variant="caption">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>
      <View style={styles.pageBody}>{children}</View>
    </ScrollView>
  );
}

// Native parity for the web JsonViewer: pretty-prints a JSON string in a
// scrollable monospace GlassPanel, or an italic "no data" line when null.
function JsonViewer({ data, label }: { data: string | null; label: string }) {
  const t = useNativeTranslationFallback();
  if (!data) {
    return (
      <AppText style={styles.jsonEmpty} tone="muted" variant="caption">
        {t('apiLogs.noData', 'No {{label}}', { label: label.toLowerCase() })}
      </AppText>
    );
  }
  let formatted = data;
  try {
    formatted = JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    /* raw */
  }
  return (
    <View style={styles.jsonBlock}>
      <AppText style={styles.fieldLabel} tone="muted" variant="caption">
        {label}
      </AppText>
      <GlassPanel style={styles.jsonPanel}>
        <ScrollView horizontal style={styles.jsonScroll}>
          <AppText style={styles.jsonText}>{formatted}</AppText>
        </ScrollView>
      </GlassPanel>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

type FilterKey = 'method' | 'status' | 'endpoint' | 'service';

export default function ApiLogsPage() {
  const t = useNativeTranslationFallback();
  useNativePageTitle(t('apiLogs.title', 'API Logs'));

  const { width } = useWindowDimensions();
  const showTimestampCol = width >= SM_BREAKPOINT;
  const showErrorCol = width >= MD_BREAKPOINT;
  const isCompact = width < SM_BREAKPOINT;
  const isWide = width >= SM_BREAKPOINT;

  // Native in-memory replacements for the web URL-state hooks. The exact state
  // names are preserved; there is no router/URL on native.
  const [page, setPage] = useState(0);
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [service, setService] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const limit = 25;

  // Unified date range — no hardcoded windows. The picker drives the from/to
  // window; absence of bounds = full history. (Web's localStorage `persistKey`
  // memory has no native equivalent and is dropped.)
  const [range, setRangeState] = useState<RangeValue>({ start: '', end: '' });
  const start = range.start;
  const end = range.end;
  const setRange = useCallback((r: RangeValue) => setRangeState(r), []);

  // Multi-key writer. On web this batched URL params (every filter change resets
  // `page` AND writes its own key); here it fans out to the matching setters.
  const setUrl = useCallback((updates: Record<string, string>) => {
    for (const [key, value] of Object.entries(updates)) {
      switch (key) {
        case 'page':
          setPage(value === '' ? 0 : Number(value));
          break;
        case 'method':
          setMethod(value);
          break;
        case 'status':
          setStatus(value);
          break;
        case 'endpoint':
          setEndpoint(value);
          break;
        case 'service':
          setService(value);
          break;
        default:
          break;
      }
    }
  }, []);

  const setFilter = useCallback(
    (key: FilterKey, value: string) => {
      setUrl({ [key]: value, page: '' });
    },
    [setUrl],
  );

  const { data: stats, error: statsError } = useQuery<APICallLogStats>({
    queryKey: ['api-log-stats'],
    queryFn: getAPICallLogStats,
    refetchInterval: 30_000,
  });

  const { data, isLoading, error: logsError } = useQuery({
    queryKey: ['api-logs', page, method, status, endpoint, service, start, end],
    queryFn: () => getAPICallLogs({
      limit,
      offset: page * limit,
      method: method || undefined,
      status: status || undefined,
      endpoint: endpoint || undefined,
      service: service || undefined,
      // RangePicker emits `YYYY-MM-DD`; backend stores ts as UTC timestamptz.
      // Send local-day boundaries so the comparison window matches the user's
      // picked dates (start of day .. end of day in their local zone).
      start: start ? new Date(`${start}T00:00:00`).toISOString() : undefined,
      end: end ? new Date(`${end}T23:59:59.999`).toISOString() : undefined,
    }),
    refetchInterval: 10_000,
  });

  const anyError = [statsError, logsError].find(Boolean);

  const logs = useMemo(() => data?.data ?? [], [data]);
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const hasFilters = !!(method || status || endpoint || service);

  const clearFilters = useCallback(() => {
    setUrl({
      method: '',
      status: '',
      endpoint: '',
      service: '',
      page: '',
    });
  }, [setUrl]);

  const selectService = useCallback(
    (svc: string) => setFilter('service', svc),
    [setFilter],
  );

  const serviceOptions = useMemo(
    () =>
      deriveServiceOptions({
        byService: stats?.by_service,
        activeService: service,
        labelFor: (svc) => serviceBadgeConfig(svc).label,
        allLabel: t('apiLogs.allServices', 'All Services'),
        knownServices: KNOWN_SERVICES,
      }),
    [stats?.by_service, service, t],
  );

  const trackedCount = stats?.by_service ? Object.keys(stats.by_service).length : 0;

  // Web exported a Blob via an <a download> click. Native has no file download;
  // the RN Share sheet preserves the "get these logs out as JSON" intent, using
  // the same dated filename as the share title.
  const handleExport = useCallback(() => {
    const json = JSON.stringify(logs, null, 2);
    const filename = `teslasync-api-logs-${new Date().toISOString().split('T')[0]}.json`;
    void Share.share({ message: json, title: filename }).catch(() => {
      // Intentionally ignored: matches the web <a download> which surfaces no error.
    });
  }, [logs]);

  return (
    <PageContainerView
      title={t('apiLogs.title', 'API Logs')}
      subtitle={t('apiLogs.subtitle', 'Record of all API calls with request/response details')}
      actions={
        <RangePickerControl
          value={{ start, end }}
          onChange={(r) => {
            setRange(r);
            if (page !== 0) setPage(0);
          }}
          testID="api-logs-range"
        />
      }
    >
      {anyError ? (
        <DangerBanner>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </DangerBanner>
      ) : null}

      {/* Stats */}
      <FadeIn>
        <View style={styles.statGrid}>
          <StatCardView
            fullWidth={false}
            wide={isWide}
            icon="fileText"
            label={t('apiLogs.totalCalls', 'Total Calls')}
            value={stats?.total_calls != null ? fmtInt(stats.total_calls) : '—'}
          />
          <StatCardView
            fullWidth={false}
            wide={isWide}
            icon="warning"
            label={t('apiLogs.errorRate', 'Error Rate')}
            value={stats ? `${fmtNumber(stats.error_rate)}%` : '—'}
            trend={
              stats && stats.error_rate > 5
                ? { direction: 'up', value: String(stats.error_count), positive: false }
                : undefined
            }
          />
          <StatCardView
            fullWidth={false}
            wide={isWide}
            icon="clock"
            label={t('apiLogs.avgDuration', 'Avg Duration')}
            value={stats ? `${fmtInt(stats.avg_duration_ms)}ms` : '—'}
          />
          <StatCardView
            fullWidth={false}
            wide={isWide}
            icon="activity"
            label={t('apiLogs.last24h', 'Last 24h')}
            value={stats?.last_24h != null ? fmtInt(stats.last_24h) : '—'}
          />
        </View>
        {stats?.by_service && Object.keys(stats.by_service).length > 0 ? (
          <View style={styles.byServiceRow}>
            <AppText style={styles.byServiceLabel} tone="muted" variant="caption" weight="semibold">
              {t('apiLogs.byService', 'By Service')}:
            </AppText>
            {Object.entries(stats.by_service).map(([svc, count]) => {
              const config = serviceBadgeConfig(svc);
              return (
                <Pressable
                  accessibilityRole="button"
                  key={svc}
                  onPress={() => selectService(svc)}
                  style={styles.byServiceChip}
                >
                  <Badge variant={config.variant}>{config.label}</Badge>
                  <AppText tone="secondary" variant="caption">{fmtInt(count)}</AppText>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </FadeIn>

      {/* Filters */}
      <FadeIn delay={0.05}>
        <GlassPanel style={styles.filterPanel}>
          <View style={styles.filterHeader}>
            <SemanticIcon decorative name="filter" size="sm" />
            <AppText style={styles.filterHeaderLabel} tone="muted" variant="caption" weight="semibold">
              {t('apiLogs.filters', 'Filters')}
            </AppText>
            {hasFilters ? (
              <Pressable
                accessibilityRole="button"
                onPress={clearFilters}
                style={styles.clearButton}
              >
                <SemanticIcon decorative name="close" size="sm" />
                <AppText tone="secondary" variant="caption" weight="semibold">
                  {t('apiLogs.clear', 'Clear')}
                </AppText>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.filterControls}>
            <View>
              <SelectField
                value={service}
                onChange={(v) => selectService(v)}
                options={serviceOptions}
                accessibilityLabel={t('apiLogs.serviceFilterAria', 'Filter by service')}
              />
              {stats?.by_service ? (
                <AppText style={styles.serviceCount} tone="muted" variant="caption">
                  {t('apiLogs.serviceCount', '{{tracked}} with data · {{known}} known', {
                    tracked: trackedCount,
                    known: KNOWN_SERVICES.length,
                  })}
                </AppText>
              ) : null}
            </View>
            <SelectField
              value={method}
              onChange={(v) => setFilter('method', v)}
              accessibilityLabel={t('apiLogs.allMethods', 'All Methods')}
              options={[
                { value: '', label: t('apiLogs.allMethods', 'All Methods') },
                { value: 'GET', label: 'GET' },
                { value: 'POST', label: 'POST' },
                { value: 'PUT', label: 'PUT' },
                { value: 'DELETE', label: 'DELETE' },
              ]}
            />
            <SelectField
              value={status}
              onChange={(v) => setFilter('status', v)}
              accessibilityLabel={t('apiLogs.allStatus', 'All Status')}
              options={[
                { value: '', label: t('apiLogs.allStatus', 'All Status') },
                { value: '2xx', label: '2xx Success' },
                { value: '3xx', label: '3xx Redirect' },
                { value: '4xx', label: '4xx Client Error' },
                { value: '5xx', label: '5xx Server Error' },
              ]}
            />
            <SearchInput
              placeholder={t('apiLogs.filterEndpoint', 'Filter by endpoint...')}
              value={endpoint}
              onChangeText={(v) => setFilter('endpoint', v)}
            />
          </View>
        </GlassPanel>
      </FadeIn>

      {/* Table */}
      <FadeIn delay={0.1}>
        <GlassPanel style={styles.tablePanel}>
          {/* Header with export */}
          <View style={styles.tableHeader}>
            <AppText style={styles.tableHeaderText} tone="secondary" variant="caption">
              {total > 0
                ? t('apiLogs.showing', 'Showing {{from}}–{{to}} of {{total}}', {
                    from: page * limit + 1,
                    to: Math.min((page + 1) * limit, total),
                    total: fmtInt(total),
                  })
                : t('apiLogs.noLogs', 'No logs found')}
            </AppText>
            <Pressable
              accessibilityRole="button"
              disabled={logs.length === 0}
              onPress={handleExport}
              style={({ pressed }) => [
                styles.exportButton,
                logs.length === 0 && styles.exportButtonDisabled,
                pressed && logs.length > 0 && styles.exportButtonPressed,
              ]}
            >
              <SemanticIcon decorative name="download" size="sm" />
              <AppText tone="secondary" variant="caption" weight="semibold">
                {t('apiLogs.exportJson', 'Export JSON')}
              </AppText>
            </Pressable>
          </View>

          {isLoading ? (
            <View style={styles.loadingBlock}>
              <ActivityIndicator color={colors.accent} />
              <AppText style={styles.loadingText} tone="muted" variant="caption">
                {t('apiLogs.loading', 'Loading logs...')}
              </AppText>
            </View>
          ) : logs.length === 0 ? (
            <View style={styles.emptyBlock}>
              <SemanticIcon decorative name="fileText" size="lg" />
              <AppText style={styles.emptyText} tone="muted" variant="caption">
                {t('apiLogs.noLogsFound', 'No API call logs found')}
              </AppText>
              {hasFilters ? (
                <AppText tone="muted" variant="caption">
                  {t('apiLogs.adjustFilters', 'Try adjusting your filters')}
                </AppText>
              ) : null}
            </View>
          ) : (
            <View style={styles.logList}>
              {logs.map((log: APICallLog) => {
                const serviceConfig = serviceBadgeConfig(log.service);
                const expanded = expandedId === log.id;
                return (
                  <View key={log.id} style={styles.logEntry}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setExpandedId(expanded ? null : log.id)}
                      style={({ pressed }) => [
                        styles.logRow,
                        pressed && styles.logRowPressed,
                      ]}
                    >
                      {showTimestampCol ? (
                        <AppText style={styles.logTimestamp} variant="caption">
                          {formatTimestampUtc(log.ts)}
                        </AppText>
                      ) : null}
                      <Badge variant={serviceConfig.variant}>{serviceConfig.label}</Badge>
                      <Badge variant={METHOD_VARIANTS[log.http_method] ?? 'neutral'}>
                        {log.http_method}
                      </Badge>
                      <AppText
                        style={styles.logEndpoint}
                        numberOfLines={1}
                        tone="secondary"
                        variant="caption"
                      >
                        {log.endpoint ?? ''}
                      </AppText>
                      <Badge variant={statusBadgeVariant(log.status_code)}>
                        {log.status_code ?? 'N/A'}
                      </Badge>
                      <AppText style={styles.logDuration} tone="secondary" variant="caption">
                        {log.duration_ms}ms
                      </AppText>
                      {showErrorCol ? (
                        <AppText style={styles.logErrorInline} numberOfLines={1} variant="caption">
                          {log.error_message || '—'}
                        </AppText>
                      ) : null}
                      <SemanticIcon
                        decorative
                        name={expanded ? 'collapse' : 'expand'}
                        size="sm"
                      />
                    </Pressable>

                    {/* Mobile date + error (visible on small screens) */}
                    {!expanded && isCompact ? (
                      <View style={styles.mobileMeta}>
                        <AppText style={styles.mobileDate} tone="muted" variant="caption">
                          {formatTimestampUtc(log.ts)}
                        </AppText>
                        {log.error_message ? (
                          <AppText style={styles.mobileError} numberOfLines={1} variant="caption">
                            {log.error_message}
                          </AppText>
                        ) : null}
                      </View>
                    ) : null}

                    {/* Expanded detail */}
                    {expanded ? (
                      <View style={styles.expandedDetail}>
                        {isCompact ? (
                          <View style={styles.expandedMobileMeta}>
                            <AppText style={styles.mobileDate} tone="muted" variant="caption">
                              {formatTimestampUtc(log.ts)}
                            </AppText>
                            {log.error_message ? (
                              <AppText style={styles.expandedMobileError} variant="caption">
                                {log.error_message}
                              </AppText>
                            ) : null}
                          </View>
                        ) : null}
                        <View style={styles.jsonBlock}>
                          <AppText style={styles.fieldLabel} tone="muted" variant="caption">
                            {t('apiLogs.requestUrl', 'Request URL')}
                          </AppText>
                          <GlassPanel style={styles.jsonPanel}>
                            <ScrollView horizontal style={styles.jsonScroll}>
                              <AppText style={styles.jsonText}>
                                {log.http_method} {log.endpoint}
                              </AppText>
                            </ScrollView>
                          </GlassPanel>
                        </View>
                        {log.error_message ? (
                          <View style={styles.jsonBlock}>
                            <AppText style={styles.errorFieldLabel} variant="caption">
                              {t('apiLogs.error', 'Error')}
                            </AppText>
                            <GlassPanel style={styles.jsonPanel}>
                              <ScrollView horizontal style={styles.jsonScroll}>
                                <AppText style={styles.jsonErrorText}>
                                  {log.error_message}
                                </AppText>
                              </ScrollView>
                            </GlassPanel>
                          </View>
                        ) : null}
                        <View style={styles.bodyGrid}>
                          <JsonViewer data={log.request_body} label={t('apiLogs.requestBody', 'Request Body')} />
                          <JsonViewer data={log.response_body} label={t('apiLogs.responseBody', 'Response Body')} />
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}

          {/* Pagination */}
          {totalPages > 1 ? (
            <View style={styles.pagination}>
              <Pressable
                accessibilityRole="button"
                disabled={page === 0}
                onPress={() => setPage((p) => Math.max(0, p - 1))}
                style={({ pressed }) => [
                  styles.pageButton,
                  page === 0 && styles.pageButtonDisabled,
                  pressed && page !== 0 && styles.pageButtonPressed,
                ]}
              >
                <SemanticIcon decorative name="previous" size="sm" />
                <AppText tone="secondary" variant="caption" weight="semibold">
                  {t('apiLogs.previous', 'Previous')}
                </AppText>
              </Pressable>
              <AppText tone="muted" variant="caption">
                {t('apiLogs.pageOf', 'Page {{page}} of {{total}}', {
                  page: page + 1,
                  total: totalPages,
                })}
              </AppText>
              <Pressable
                accessibilityRole="button"
                disabled={page >= totalPages - 1}
                onPress={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                style={({ pressed }) => [
                  styles.pageButton,
                  page >= totalPages - 1 && styles.pageButtonDisabled,
                  pressed && page < totalPages - 1 && styles.pageButtonPressed,
                ]}
              >
                <AppText tone="secondary" variant="caption" weight="semibold">
                  {t('apiLogs.next', 'Next')}
                </AppText>
                <SemanticIcon decorative name="next" size="sm" />
              </Pressable>
            </View>
          ) : null}
        </GlassPanel>
      </FadeIn>
    </PageContainerView>
  );
}

ApiLogsPage.displayName = 'ApiLogsPage';

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

// rose-500 / cyan-500 channels for the danger banner + info badge, matching the
// sibling parity ports.
const ROSE_500 = '244, 63, 94';

const styles = StyleSheet.create({
  fadeIn: {
    gap: spacing.md,
  },

  // Page container
  pageRoot: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    gap: spacing.md,
  },
  pageHeaderCopy: {
    gap: spacing.xs,
  },
  pageActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  pageBody: {
    gap: spacing.lg,
  },

  // Stat cards
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statCard: {
    gap: spacing.xs,
    padding: spacing.md,
  },
  statCardFull: {
    flexBasis: '100%',
    flexGrow: 1,
  },
  statCardHalf: {
    flexBasis: '46%',
    flexGrow: 1,
  },
  statCardQuarter: {
    flexBasis: '22%',
    flexGrow: 1,
  },
  statCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  statTrendRow: {
    flexDirection: 'row',
  },
  trendPositive: {
    color: colors.success,
  },
  trendNegative: {
    color: colors.danger,
  },

  // By-service chips
  byServiceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  byServiceLabel: {
    marginRight: spacing.xs,
  },
  byServiceChip: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },

  // Badge
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },

  // Filters
  filterPanel: {
    gap: spacing.md,
    padding: spacing.md,
  },
  filterHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  filterHeaderLabel: {
    letterSpacing: 0.6,
  },
  clearButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginLeft: 'auto',
  },
  filterControls: {
    gap: spacing.md,
  },
  serviceCount: {
    marginTop: spacing.xs,
  },

  // Field (select trigger + search input)
  field: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  fieldPressed: {
    opacity: 0.82,
  },
  fieldText: {
    color: colors.textPrimary,
    flex: 1,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    paddingVertical: spacing.sm,
  },

  // Select modal
  modalBackdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    maxHeight: '70%',
    overflow: 'hidden',
  },
  optionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  optionRowActive: {
    backgroundColor: colors.surfaceSelected,
  },
  optionRowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionText: {
    color: colors.textPrimary,
  },
  optionTextActive: {
    color: colors.accent,
  },

  // Range picker
  rangeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  rangeChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  rangeChipActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  rangeChipPressed: {
    opacity: 0.82,
  },
  rangeChipText: {
    color: colors.textSecondary,
  },
  rangeChipTextActive: {
    color: colors.accent,
  },

  // Danger banner
  dangerBanner: {
    alignItems: 'center',
    backgroundColor: `rgba(${ROSE_500}, 0.05)`,
    borderColor: `rgba(${ROSE_500}, 0.3)`,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  dangerBannerText: {
    color: colors.danger,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },

  // Table
  tablePanel: {
    overflow: 'hidden',
  },
  tableHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  tableHeaderText: {
    flexShrink: 1,
    marginRight: spacing.sm,
  },
  exportButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  exportButtonDisabled: {
    opacity: 0.48,
  },
  exportButtonPressed: {
    opacity: 0.82,
  },

  loadingBlock: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  loadingText: {
    marginTop: spacing.xs,
  },
  emptyBlock: {
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.xl,
  },
  emptyText: {
    marginTop: spacing.sm,
  },

  // Log rows
  logList: {
    gap: 0,
  },
  logEntry: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  logRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  logRowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  logTimestamp: {
    color: colors.textMuted,
    fontFamily: MONO_FONT,
    width: 120,
  },
  logEndpoint: {
    flexBasis: 120,
    flexGrow: 1,
    fontFamily: MONO_FONT,
  },
  logDuration: {
    fontFamily: MONO_FONT,
    minWidth: 56,
    textAlign: 'right',
  },
  logErrorInline: {
    color: colors.danger,
    flexBasis: 120,
    flexShrink: 1,
  },

  mobileMeta: {
    gap: 2,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  mobileDate: {
    fontFamily: MONO_FONT,
  },
  mobileError: {
    color: colors.danger,
  },

  expandedDetail: {
    backgroundColor: colors.surfaceRaised,
    gap: spacing.md,
    padding: spacing.md,
  },
  expandedMobileMeta: {
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  expandedMobileError: {
    color: colors.danger,
  },

  // JSON viewer
  jsonBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  fieldLabel: {
    letterSpacing: 0.6,
  },
  errorFieldLabel: {
    color: colors.danger,
    letterSpacing: 0.6,
  },
  jsonPanel: {
    borderRadius: 12,
    maxHeight: 240,
    padding: spacing.md,
  },
  jsonScroll: {
    flexGrow: 0,
  },
  jsonText: {
    color: colors.textSecondary,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 18,
  },
  jsonErrorText: {
    color: colors.danger,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 18,
  },
  jsonEmpty: {
    fontStyle: 'italic',
  },
  bodyGrid: {
    gap: spacing.md,
  },

  // Pagination
  pagination: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  pageButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pageButtonDisabled: {
    opacity: 0.48,
  },
  pageButtonPressed: {
    opacity: 0.82,
  },
});

const badgeToneStyles = StyleSheet.create({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeTextStyles = StyleSheet.create({
  success: {
    color: colors.success,
  },
  info: {
    color: colors.accent,
  },
  warning: {
    color: colors.warning,
  },
  danger: {
    color: colors.danger,
  },
  neutral: {
    color: colors.textSecondary,
  },
});
