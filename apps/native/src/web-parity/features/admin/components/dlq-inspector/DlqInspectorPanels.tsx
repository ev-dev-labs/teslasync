// Native parity implementation backing
// web/src/features/admin/components/dlq-inspector/index.ts.
//
// The web source is a 4-line barrel that re-exports four sibling components
// (StatusHeader, EntriesTable, AuditPanel, EntryDrawer). Those siblings are not
// yet present as native conversion targets, and the web tsconfig type-checks the
// whole tree, so a barrel that re-exported not-yet-ported `./StatusHeader` etc.
// would not compile. The required native output (index.ts) therefore re-exports
// the four components from this single self-contained module — index.ts stays a
// clean, JSX-free re-export barrel (JSX is illegal in a .ts file) while this
// .tsx file holds the actual native ports in ONE place (no per-file duplication
// of the shared helpers / primitives).
//
// Behaviour, state names (activeTab, sortKey, sortDir), the snake_case API field
// names (arrived_at, parsed_reason, parsed_vin, parsed_source_topic,
// parsed_redeliveries, raw_payload_size, inner_payload_size, replay_enabled,
// replayable, raw_payload_b64, inner_payload_b64, replayed_at, dlq_id, dst_topic,
// trace_id, …), and every i18n key + English default are preserved verbatim.
//
// Native-safe adaptations (documented in index.ts.parity.json):
//   - The shared web `@/types/admin-diagnostics` DLQ types are inlined here as
//     the native types module does not exist yet (kept structurally identical to
//     the Go-DTO mirror so a future shared native module is a drop-in).
//   - `fmtInt` reproduces web `fmtNumber(v, 0)` (safeNumber → 0 for nullish/NaN,
//     locale-grouped, rounded) without depending on Intl/locale wiring.
//   - `<TimeStamp format="absolute">` (locale + timezone + hover tooltip aware on
//     web) becomes a native-safe absolute formatter; the tooltip/relative/locale
//     settings are not wired on native yet, so it renders a fixed absolute label
//     and the universal "—" placeholder for null/invalid timestamps.
//   - `atob` + `TextDecoder('utf-8', { fatal: true })` (browser-only) are replaced
//     by a pure-JS base64 decoder + strict UTF-8 decoder that returns '' on any
//     invalid sequence — preserving the web "binary payload → fallback marker"
//     behaviour exactly.
//   - lucide-react icons (Inbox / ShieldCheck / AlertOctagon / Send) have no
//     native SVG analog, so the StatCards drop the decorative icon (MetricCard has
//     no icon slot) and the Replay button carries a "\u27A4" send glyph.
//   - The shared web ui (StatCard / AlertBanner / Grid / DataTable / Badge /
//     Button / Drawer / Tabs / KVList / Spinner / CopyButton / GlassPanel) and DOM
//     elements (div / span / pre / table / button) are replaced by the shared
//     native GlassPanel + MetricCard + EmptyState + AppText and RN View /
//     ScrollView / Pressable / Modal / ActivityIndicator against the theme tokens.
//     The DataTable becomes a sortable, scrollable single-column card list (the
//     mobile rendering of the source table); pagination/column-menu chrome folds
//     into native scrolling.
//   - The web CopyButton's navigator.clipboard.writeText is reproduced with a
//     native-safe writeClipboard that uses navigator.clipboard when present
//     (react-native-web) and degrades to an explicit "Unavailable" state on
//     iOS/Android where no clipboard module is bundled — never flipping to
//     "Copied" on failure.
//
// No DOM, Recharts, Leaflet, lucide-react, or old web ui components are imported.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {MetricCard} from '../../../../../components/ui/MetricCard';
import {colors, spacing} from '../../../../../theme/tokens';

/* ─── i18n fallback ───────────────────────────────────────────────────── */

type TFunc = (
  key: string,
  fallback?: string,
  vars?: Record<string, string | number>,
) => string;

// react-i18next is not wired in native. i18next returns the key itself when a
// translation is missing, so the fallback returns the supplied English default
// (or the key) and applies {{var}} interpolation just like the web `t`, which
// preserves every i18n key + default verbatim.
function useT(): TFunc {
  return useCallback(
    (key: string, fallback?: string, vars?: Record<string, string | number>) => {
      let out = fallback ?? key;
      if (vars) {
        for (const varKey of Object.keys(vars)) {
          out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
        }
      }
      return out;
    },
    [],
  );
}

/* ─── Inlined DLQ types (mirror web @/types/admin-diagnostics) ─────────── */

export type DLQReplayResult =
  | 'ok'
  | 'publish_failed'
  | 'rate_limited'
  | 'disabled'
  | 'not_found'
  | 'unparseable';

export interface DLQEntrySummary {
  id: number;
  arrived_at: string;
  dlq_topic: string;
  parsed_reason: string;
  parsed_vehicle_id: number | null;
  parsed_vin: string | null;
  parsed_source_topic: string | null;
  parsed_redeliveries: number | null;
  parsed_timestamp: string | null;
  parse_error: string | null;
  replayable: boolean;
  raw_payload_size: number;
  inner_payload_size: number;
}

export interface DLQEntryFull extends DLQEntrySummary {
  raw_payload_b64: string;
  inner_payload_b64: string;
}

export interface DLQListResponse {
  count: number;
  replay_enabled: boolean;
  entries: DLQEntrySummary[];
}

export interface DLQReplayAuditRecord {
  id: number;
  replayed_at: string;
  actor: string;
  actor_ip: string;
  dlq_id: number;
  src_topic: string;
  dst_topic: string;
  payload: string;
  reason: string;
  result: DLQReplayResult;
  error: string;
  trace_id: string;
}

/* ─── Pure helpers ─────────────────────────────────────────────────────── */

// Mirrors web fmtInt → fmtNumber(v, 0): safeNumber (0 for nullish / non-finite),
// rounded to an integer, with en-US thousands grouping. Locale-independent so it
// never depends on Hermes Intl support.
function fmtInt(v: unknown): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  const rounded = Math.round(n);
  const negative = rounded < 0;
  const digits = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return negative ? `-${digits}` : digits;
}

// Ported verbatim from web EntriesTable.formatBytes.
function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return '—';
  }
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Native-safe replacement for <TimeStamp format="absolute">. Renders the
// universal "—" placeholder for null / undefined / unparseable timestamps, just
// like the web component.
function formatAbsolute(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  if (Number.isNaN(ms)) {
    return '—';
  }
  const month = MONTHS[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours %= 12;
  if (hours === 0) {
    hours = 12;
  }
  const mm = minutes < 10 ? `0${minutes}` : String(minutes);
  return `${month} ${day}, ${year}, ${hours}:${mm} ${ampm}`;
}

const B64_LOOKUP: Record<string, number> = (() => {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const map: Record<string, number> = {};
  for (let i = 0; i < chars.length; i += 1) {
    map[chars[i]] = i;
  }
  return map;
})();

function base64ToBytes(input: string): Uint8Array | null {
  const stripped = input.replace(/[\r\n\t ]/g, '');
  let body = stripped;
  let pad = 0;
  while (body.endsWith('=')) {
    body = body.slice(0, -1);
    pad += 1;
  }
  if (pad > 2) {
    return null;
  }
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < body.length; i += 1) {
    const value = B64_LOOKUP[body[i]];
    if (value === undefined) {
      return null;
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

// Strict UTF-8 decode mirroring TextDecoder('utf-8', { fatal: true }): returns
// null on any malformed / overlong / surrogate sequence so a binary protobuf
// body cleanly falls through to the "(non-UTF-8 binary …)" marker.
function utf8DecodeStrict(bytes: Uint8Array): string | null {
  let result = '';
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      result += String.fromCharCode(b0);
      i += 1;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      if (i + 1 >= n) {
        return null;
      }
      const b1 = bytes[i + 1];
      if ((b1 & 0xc0) !== 0x80) {
        return null;
      }
      result += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
      i += 2;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      if (i + 2 >= n) {
        return null;
      }
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) {
        return null;
      }
      const cp = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
      if (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff)) {
        return null;
      }
      result += String.fromCharCode(cp);
      i += 3;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      if (i + 3 >= n) {
        return null;
      }
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      const b3 = bytes[i + 3];
      if (
        (b1 & 0xc0) !== 0x80 ||
        (b2 & 0xc0) !== 0x80 ||
        (b3 & 0xc0) !== 0x80
      ) {
        return null;
      }
      const cp =
        ((b0 & 0x07) << 18) |
        ((b1 & 0x3f) << 12) |
        ((b2 & 0x3f) << 6) |
        (b3 & 0x3f);
      if (cp < 0x10000 || cp > 0x10ffff) {
        return null;
      }
      const u = cp - 0x10000;
      result += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
      i += 4;
    } else {
      return null;
    }
  }
  return result;
}

// Native-safe port of web EntryDrawer.decodeBase64Utf8: base64 → UTF-8 string
// when possible, '' otherwise (which triggers the binary-payload fallback copy).
function decodeBase64Utf8(b64: string): string {
  if (!b64) {
    return '';
  }
  const bytes = base64ToBytes(b64);
  if (!bytes) {
    return '';
  }
  return utf8DecodeStrict(bytes) ?? '';
}

type ClipboardGlobal = {
  navigator?: {clipboard?: {writeText?: (text: string) => Promise<void>}};
};

// Native-safe clipboard: uses navigator.clipboard when present (react-native-web)
// and reports an explicit unavailable state where no clipboard module is bundled.
async function writeClipboard(text: string): Promise<boolean> {
  const clip = (globalThis as ClipboardGlobal).navigator?.clipboard;
  if (clip && typeof clip.writeText === 'function') {
    try {
      await clip.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

/* ─── Shared native primitives ─────────────────────────────────────────── */

type BadgeVariant = 'success' | 'danger' | 'warning' | 'neutral';

function Badge({variant, label}: {variant: BadgeVariant; label: string}) {
  return (
    <View style={[styles.badge, badgeStyles[variant]]}>
      <AppText variant="caption" weight="semibold" style={badgeTextStyles[variant]}>
        {label}
      </AppText>
    </View>
  );
}

function MonoText({
  children,
  tone = 'muted',
}: {
  children: string;
  tone?: 'primary' | 'secondary' | 'muted';
}) {
  return (
    <AppText variant="caption" tone={tone} style={styles.mono}>
      {children}
    </AppText>
  );
}

function Field({label, children}: {label: string; children: ReactNode}) {
  return (
    <View style={styles.field}>
      <AppText variant="caption" tone="muted" style={styles.fieldLabel}>
        {label}
      </AppText>
      <View style={styles.fieldValue}>{children}</View>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  glyph,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  size?: 'md' | 'sm';
  disabled?: boolean;
  loading?: boolean;
  glyph?: string;
}) {
  const blocked = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{disabled: blocked, busy: loading}}
      disabled={blocked}
      onPress={onPress}
      style={({pressed}) => [
        styles.btn,
        size === 'sm' ? styles.btnSm : styles.btnMd,
        variant === 'primary' ? styles.btnPrimary : styles.btnSecondary,
        blocked && styles.btnDisabled,
        pressed && !blocked && styles.btnPressed,
      ]}>
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colors.background : colors.textPrimary}
        />
      ) : glyph ? (
        <AppText
          variant="caption"
          weight="semibold"
          style={
            variant === 'primary' ? styles.btnPrimaryText : styles.btnSecondaryText
          }>
          {glyph}
        </AppText>
      ) : null}
      <AppText
        variant="caption"
        weight="semibold"
        style={
          variant === 'primary' ? styles.btnPrimaryText : styles.btnSecondaryText
        }>
        {label}
      </AppText>
    </Pressable>
  );
}

function TabBar({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: {key: string; label: string}[];
  activeTab: string;
  onChange: (key: string) => void;
}) {
  return (
    <View style={styles.tabBar}>
      {tabs.map(tab => {
        const active = tab.key === activeTab;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{selected: active}}
            onPress={() => onChange(tab.key)}
            style={[styles.tab, active && styles.tabActive]}>
            <AppText
              variant="caption"
              weight="semibold"
              tone={active ? 'accent' : 'muted'}>
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function WarningBanner({title, message}: {title: string; message: string}) {
  return (
    <View style={styles.warnBanner}>
      <AppText weight="semibold" style={styles.warnTitle}>
        {title}
      </AppText>
      <AppText variant="caption" tone="secondary">
        {message}
      </AppText>
    </View>
  );
}

function CopyButton({text}: {text: string}) {
  const t = useT();
  const [status, setStatus] = useState<'idle' | 'copied' | 'unavailable'>('idle');

  const onPress = useCallback(() => {
    void writeClipboard(text).then(ok =>
      setStatus(ok ? 'copied' : 'unavailable'),
    );
  }, [text]);

  useEffect(() => {
    if (status !== 'copied') {
      return undefined;
    }
    const id = setTimeout(() => setStatus('idle'), 1500);
    return () => clearTimeout(id);
  }, [status]);

  const label =
    status === 'copied'
      ? t('common.copyButton.copied', 'Copied')
      : status === 'unavailable'
        ? t('common.copyButton.unavailable', 'Unavailable')
        : t('common.copyButton.copy', 'Copy');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.copyBtn}>
      <AppText
        variant="caption"
        weight="semibold"
        tone={status === 'unavailable' ? 'danger' : 'accent'}>
        {label}
      </AppText>
    </Pressable>
  );
}

function DrawerShell({
  open,
  onClose,
  title,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <View style={styles.drawerOverlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          style={styles.drawerScrim}
          onPress={onClose}
        />
        <View style={styles.drawerPanel}>
          <View style={styles.drawerHeader}>
            <AppText variant="title" weight="bold">
              {title}
            </AppText>
          </View>
          <ScrollView
            style={styles.drawerBody}
            contentContainerStyle={styles.drawerBodyContent}>
            {children}
          </ScrollView>
          <View style={styles.drawerFooter}>{footer}</View>
        </View>
      </View>
    </Modal>
  );
}

/* ─── StatusHeader (web StatusHeader.tsx) ──────────────────────────────── */

export function StatusHeader({
  data,
  loading,
}: {
  data: DLQListResponse | undefined;
  loading: boolean;
}) {
  const t = useT();
  const count = data?.count ?? 0;
  const replayable = (data?.entries ?? []).filter(e => e.replayable).length;
  const enabled = data?.replay_enabled ?? false;

  return (
    <View style={styles.stack}>
      <View style={styles.statGrid}>
        <MetricCard
          label={t('admin.dlq.stats.total', 'Total entries')}
          value={loading ? '—' : fmtInt(count)}
          helper={t('admin.dlq.stats.totalSub', 'in dead-letter queue')}
        />
        <MetricCard
          label={t('admin.dlq.stats.replayable', 'Replayable')}
          value={loading ? '—' : fmtInt(replayable)}
          helper={t('admin.dlq.stats.replayableSub', 'parsed with source topic')}
        />
        <MetricCard
          label={t('admin.dlq.stats.replayMode', 'Replay mode')}
          value={
            loading
              ? '—'
              : enabled
                ? t('admin.dlq.stats.enabled', 'Enabled')
                : t('admin.dlq.stats.disabled', 'Disabled')
          }
          helper={t('admin.dlq.stats.replayModeSub', 'DLQ_REPLAY_ENABLED env')}
        />
      </View>

      {!loading && !enabled ? (
        <WarningBanner
          title={t('admin.dlq.banners.disabledTitle', 'DLQ replay is disabled')}
          message={t(
            'admin.dlq.banners.disabledMessage',
            'The DLQ_REPLAY_ENABLED env flag is not set on this server. Replay attempts will return HTTP 403 and be logged as result="disabled".',
          )}
        />
      ) : null}
    </View>
  );
}

/* ─── EntriesTable (web EntriesTable.tsx) ──────────────────────────────── */

type SortDir = 'asc' | 'desc';

function useSortToggle(initialKey: string, initialDir: SortDir) {
  const [sortKey, setSortKey] = useState(initialKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);
  const onSort = useCallback((key: string) => {
    setSortKey(prevKey => {
      if (prevKey === key) {
        setSortDir(prevDir => (prevDir === 'asc' ? 'desc' : 'asc'));
        return prevKey;
      }
      setSortDir('asc');
      return key;
    });
  }, []);
  return {sortKey, sortDir, onSort};
}

export function EntriesTable({
  rows,
  loading,
  onInspect,
}: {
  rows: DLQEntrySummary[];
  loading: boolean;
  onInspect: (entry: DLQEntrySummary) => void;
}) {
  const t = useT();
  const {sortKey, sortDir, onSort} = useSortToggle('arrived_at', 'desc');

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortKey) {
      case 'arrived_at':
        return (Date.parse(a.arrived_at) - Date.parse(b.arrived_at)) * dir;
      case 'parsed_reason':
        return a.parsed_reason.localeCompare(b.parsed_reason) * dir;
      case 'parsed_vin':
        return (a.parsed_vin ?? '').localeCompare(b.parsed_vin ?? '') * dir;
      case 'raw_payload_size':
        return (a.raw_payload_size - b.raw_payload_size) * dir;
      default:
        return 0;
    }
  });

  const sortable: {key: string; label: string}[] = [
    {key: 'arrived_at', label: t('admin.dlq.cols.arrived', 'Arrived')},
    {key: 'parsed_reason', label: t('admin.dlq.cols.reason', 'Reason')},
    {key: 'parsed_vin', label: t('admin.dlq.cols.vin', 'VIN')},
    {key: 'raw_payload_size', label: t('admin.dlq.cols.size', 'Payload')},
  ];

  return (
    <View style={styles.stack}>
      <View style={styles.sortBar}>
        {sortable.map(col => {
          const active = sortKey === col.key;
          const arrow = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
          return (
            <Pressable
              key={col.key}
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              onPress={() => onSort(col.key)}
              style={[styles.sortChip, active && styles.sortChipActive]}>
              <AppText
                variant="caption"
                weight="semibold"
                tone={active ? 'accent' : 'muted'}>
                {`${col.label}${arrow}`}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {sorted.length === 0 ? (
        <View style={styles.emptyBox}>
          <AppText tone="muted">
            {loading
              ? t('admin.dlq.table.loading', 'Loading…')
              : t(
                  'admin.dlq.table.empty',
                  'No DLQ entries — the pipeline is clean.',
                )}
          </AppText>
        </View>
      ) : (
        sorted.map(row => (
          <GlassPanel key={row.id} style={styles.rowCard}>
            <Field label={t('admin.dlq.cols.arrived', 'Arrived')}>
              <AppText variant="caption">{formatAbsolute(row.arrived_at)}</AppText>
            </Field>
            <Field label={t('admin.dlq.cols.reason', 'Reason')}>
              <MonoText tone="primary">{row.parsed_reason || '—'}</MonoText>
            </Field>
            <Field label={t('admin.dlq.cols.vin', 'VIN')}>
              <MonoText>{row.parsed_vin ?? '—'}</MonoText>
            </Field>
            <Field label={t('admin.dlq.cols.topic', 'Source topic')}>
              <MonoText>{row.parsed_source_topic ?? '—'}</MonoText>
            </Field>
            <Field label={t('admin.dlq.cols.redeliveries', 'Redel.')}>
              <AppText variant="caption">
                {row.parsed_redeliveries !== null
                  ? fmtInt(row.parsed_redeliveries)
                  : '—'}
              </AppText>
            </Field>
            <Field label={t('admin.dlq.cols.size', 'Payload')}>
              <AppText variant="caption" tone="secondary">
                {formatBytes(row.raw_payload_size)}
              </AppText>
            </Field>
            <Field label={t('admin.dlq.cols.replayable', 'Replayable')}>
              {row.replayable ? (
                <Badge variant="success" label={t('common.yes', 'Yes')} />
              ) : (
                <Badge variant="neutral" label={t('common.no', 'No')} />
              )}
            </Field>
            <View style={styles.rowActions}>
              <ActionButton
                label={t('admin.dlq.actions.inspect', 'Inspect')}
                variant="secondary"
                size="sm"
                onPress={() => onInspect(row)}
              />
            </View>
          </GlassPanel>
        ))
      )}
    </View>
  );
}

/* ─── AuditPanel (web AuditPanel.tsx) ──────────────────────────────────── */

const RESULT_VARIANT: Record<DLQReplayResult, BadgeVariant> = {
  ok: 'success',
  publish_failed: 'danger',
  rate_limited: 'warning',
  disabled: 'warning',
  not_found: 'neutral',
  unparseable: 'danger',
};

export function AuditPanel({
  rows,
  loading,
  scopedDlqId,
}: {
  rows: DLQReplayAuditRecord[];
  loading: boolean;
  scopedDlqId?: number | null;
}) {
  const t = useT();

  if (!loading && rows.length === 0) {
    return (
      <EmptyState
        title={t('admin.dlq.audit.empty.title', 'No replay attempts yet')}
        message={
          scopedDlqId
            ? t(
                'admin.dlq.audit.empty.scopedMessage',
                'This entry has not been replayed. Use the Replay action above to send it back to its source topic.',
              )
            : t(
                'admin.dlq.audit.empty.globalMessage',
                'Replay attempts will appear here once an operator triggers one.',
              )
        }
      />
    );
  }

  return (
    <View style={styles.stack}>
      {rows.length === 0 ? (
        <View style={styles.emptyBox}>
          <AppText tone="muted">
            {loading
              ? t('admin.dlq.audit.loading', 'Loading audit log…')
              : t('admin.dlq.audit.empty.title', 'No replay attempts yet')}
          </AppText>
        </View>
      ) : (
        rows.map(row => (
          <GlassPanel key={row.id} style={styles.rowCard}>
            <Field label={t('admin.dlq.audit.cols.replayedAt', 'Replayed at')}>
              <AppText variant="caption">
                {formatAbsolute(row.replayed_at)}
              </AppText>
            </Field>
            <Field label={t('admin.dlq.audit.cols.actor', 'Actor')}>
              <MonoText>{row.actor || '—'}</MonoText>
            </Field>
            <Field label={t('admin.dlq.audit.cols.dlqId', 'DLQ ID')}>
              <MonoText tone="secondary">{String(row.dlq_id)}</MonoText>
            </Field>
            <Field label={t('admin.dlq.audit.cols.result', 'Result')}>
              <Badge
                variant={RESULT_VARIANT[row.result] ?? 'neutral'}
                label={row.result}
              />
            </Field>
            <Field label={t('admin.dlq.audit.cols.dstTopic', 'Destination')}>
              <MonoText>{row.dst_topic || '—'}</MonoText>
            </Field>
            <Field label={t('admin.dlq.audit.cols.error', 'Error')}>
              <AppText variant="caption" tone="muted">
                {row.error || '—'}
              </AppText>
            </Field>
            <Field label={t('admin.dlq.audit.cols.traceId', 'Trace ID')}>
              <MonoText>{row.trace_id || '—'}</MonoText>
            </Field>
          </GlassPanel>
        ))
      )}
    </View>
  );
}

/* ─── EntryDrawer (web EntryDrawer.tsx) ────────────────────────────────── */

export function EntryDrawer({
  open,
  summary,
  full,
  loading,
  replayEnabled,
  replayInFlight,
  onClose,
  onReplay,
}: {
  open: boolean;
  summary: DLQEntrySummary | null;
  full: DLQEntryFull | undefined;
  loading: boolean;
  replayEnabled: boolean;
  replayInFlight: boolean;
  onClose: () => void;
  onReplay: () => void;
}) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<string>('inner');

  const innerText = useMemo(
    () => (full ? decodeBase64Utf8(full.inner_payload_b64) : ''),
    [full],
  );
  const rawText = useMemo(
    () => (full ? decodeBase64Utf8(full.raw_payload_b64) : ''),
    [full],
  );

  const head: DLQEntryFull | DLQEntrySummary | null = full ?? summary;

  const tabs: {key: string; label: string}[] = [
    {key: 'inner', label: t('admin.dlq.drawer.tabs.inner', 'Inner payload')},
    {key: 'raw', label: t('admin.dlq.drawer.tabs.raw', 'Raw envelope')},
  ];

  const replayDisabled =
    !replayEnabled || !head?.replayable || replayInFlight || loading;

  const viewerText =
    activeTab === 'inner'
      ? innerText ||
        (head
          ? t(
              'admin.dlq.drawer.binaryPayload',
              '(non-UTF-8 binary, {{n}} bytes — use the copy button to download base64)',
              {n: head.inner_payload_size},
            )
          : '')
      : rawText ||
        (head
          ? t(
              'admin.dlq.drawer.binaryEnvelope',
              '(non-UTF-8 envelope, {{n}} bytes — use the copy button to download base64)',
              {n: head.raw_payload_size},
            )
          : '');

  const copyText =
    activeTab === 'inner'
      ? innerText || full?.inner_payload_b64 || ''
      : rawText || full?.raw_payload_b64 || '';

  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title={
        head
          ? t('admin.dlq.drawer.title', 'DLQ entry #{{id}}', {id: head.id})
          : t('admin.dlq.drawer.titleFallback', 'DLQ entry')
      }
      footer={
        <View style={styles.drawerFooterRow}>
          <ActionButton
            label={t('common.close', 'Close')}
            variant="secondary"
            onPress={onClose}
          />
          <ActionButton
            label={t('admin.dlq.drawer.replay', 'Replay')}
            variant="primary"
            glyph="➤"
            disabled={replayDisabled}
            loading={replayInFlight}
            onPress={onReplay}
          />
        </View>
      }>
      {loading && !full ? (
        <View style={styles.drawerLoading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : head ? (
        <View style={styles.stack}>
          <GlassPanel style={styles.rowCard}>
            <Field label={t('admin.dlq.drawer.id', 'ID')}>
              <MonoText tone="primary">{String(head.id)}</MonoText>
            </Field>
            <Field label={t('admin.dlq.drawer.arrivedAt', 'Arrived')}>
              <AppText variant="caption">{formatAbsolute(head.arrived_at)}</AppText>
            </Field>
            <Field label={t('admin.dlq.drawer.dlqTopic', 'DLQ topic')}>
              <MonoText>{head.dlq_topic || '—'}</MonoText>
            </Field>
            <Field label={t('admin.dlq.drawer.reason', 'Reason')}>
              <MonoText>{head.parsed_reason || '—'}</MonoText>
            </Field>
            <Field label={t('admin.dlq.drawer.vin', 'VIN')}>
              <MonoText>{head.parsed_vin ?? '—'}</MonoText>
            </Field>
            <Field label={t('admin.dlq.drawer.sourceTopic', 'Source topic')}>
              <MonoText>{head.parsed_source_topic ?? '—'}</MonoText>
            </Field>
            <Field label={t('admin.dlq.drawer.redeliveries', 'Redeliveries')}>
              <AppText variant="caption">
                {head.parsed_redeliveries !== null
                  ? fmtInt(head.parsed_redeliveries)
                  : '—'}
              </AppText>
            </Field>
            <Field label={t('admin.dlq.drawer.parseError', 'Parse error')}>
              <AppText variant="caption" tone="muted">
                {head.parse_error || '—'}
              </AppText>
            </Field>
          </GlassPanel>

          <GlassPanel style={styles.rowCard}>
            <TabBar tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
            <View style={styles.payloadHeader}>
              <CopyButton text={copyText} />
            </View>
            <ScrollView
              style={styles.payloadBox}
              contentContainerStyle={styles.payloadContent}
              nestedScrollEnabled>
              <AppText variant="caption" style={styles.mono} selectable>
                {viewerText}
              </AppText>
            </ScrollView>
          </GlassPanel>
        </View>
      ) : null}
    </DrawerShell>
  );
}

/* ─── Styles ───────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  stack: {
    gap: spacing.md,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  warnBanner: {
    borderWidth: 1,
    borderRadius: 16,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
    padding: spacing.md,
    gap: spacing.xs,
  },
  warnTitle: {
    color: colors.warning,
  },
  sortBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sortChip: {
    borderWidth: 1,
    borderRadius: 999,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  sortChipActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  rowCard: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  field: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 4,
  },
  fieldLabel: {
    flexShrink: 0,
  },
  fieldValue: {
    flexShrink: 1,
    alignItems: 'flex-end',
  },
  mono: {
    fontFamily: MONO_FONT,
  },
  rowActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: spacing.xs,
  },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: 12,
  },
  btnMd: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  btnSm: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
  btnPrimary: {
    backgroundColor: colors.accent,
  },
  btnSecondary: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  btnDisabled: {
    opacity: 0.48,
  },
  btnPressed: {
    opacity: 0.82,
  },
  btnPrimaryText: {
    color: colors.background,
  },
  btnSecondaryText: {
    color: colors.textPrimary,
  },
  tabBar: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tab: {
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tabActive: {
    borderBottomColor: colors.accent,
  },
  copyBtn: {
    alignSelf: 'flex-end',
    borderWidth: 1,
    borderRadius: 999,
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  payloadHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  payloadBox: {
    maxHeight: 320,
    borderWidth: 1,
    borderRadius: 12,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  payloadContent: {
    padding: spacing.md,
  },
  drawerOverlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(2, 4, 9, 0.62)',
  },
  drawerScrim: {
    flex: 1,
  },
  drawerPanel: {
    width: '88%',
    maxWidth: 460,
    flex: 0,
    height: '100%',
    backgroundColor: colors.background,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  drawerHeader: {
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  drawerBody: {
    flex: 1,
  },
  drawerBodyContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  drawerFooter: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  drawerFooterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  drawerLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
});

const badgeStyles = StyleSheet.create({
  success: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  danger: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
  warning: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
  neutral: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
});

const badgeTextStyles = StyleSheet.create({
  success: {
    color: colors.success,
  },
  danger: {
    color: colors.danger,
  },
  warning: {
    color: colors.warning,
  },
  neutral: {
    color: colors.textMuted,
  },
});
