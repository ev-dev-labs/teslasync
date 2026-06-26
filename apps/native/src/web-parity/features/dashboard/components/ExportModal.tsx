// Native parity port of web/src/features/dashboard/components/ExportModal.tsx.
//
// The web source is the dashboard "Export Dashboard" modal. It renders the shared
// surface <Modal> (open/onClose/title/size="md") whose body is a 5-gap stack of:
//   1. A summary row: a `w-32` <MiniGridPreview> tile on the left, and on the
//      right the dashboard name (truncated), two neutral <Badge>es (a lucide
//      <Package/> + "{{count}} widgets", and the JSON byte size), and an
//      "Updated {{date}}" caption formatted via useDateFormat().formatDate.
//   2. An options column: a primary <Button> "Download JSON File" (lucide
//      <Download/>) wired to onDownload()+onClose(), a ghost <CopyButton> "Copy
//      to Clipboard" of the pretty-printed dashboard JSON, and a ghost
//      <CopyButton> "Copy Shareable URL" that is disabled when the encoded
//      share URL exceeds 2000 chars.
//   3. A conditional warning <AlertBanner> (lucide <AlertTriangle/>) shown only
//      when the share URL is too long.
// jsonSize is `new Blob([json]).size` formatted B/KB; the share URL is
// `${window.location.origin}/dashboard#import=${toUrlSafeBase64(buildMinimalExport(dashboard))}`.
//
// None of those web modules are native-safe: react-i18next is not wired; lucide,
// the DOM/Tailwind/CSS-var layout, `window.location`, `Blob`, `btoa`/`TextEncoder`
// and `navigator.clipboard` are browser-only; and the shared web UI (Modal port
// aside), `@/components/feedback` AlertBanner, `@/hooks/useDateFormat`, the sibling
// `./MiniGridPreview`, `../hooks/validateImport`, and `../widgets/types` ports do
// not exist yet in this file-by-file conversion loop. So — mirroring the sibling
// DraftRecoveryBanner / ChargerTypeBreakdown / UrlEncoder ports — this self-
// contained port rebuilds each piece with React Native primitives, the existing
// native Modal parity, AppText, SemanticIcon glyphs, and the design tokens:
//   * <Modal> -> the existing native Modal parity (web-parity/components/ui/Modal),
//     same open/onClose/title/size contract; the web `className` dark-surface
//     override (#0f1218 / white-8 border) is reproduced via the native `style`
//     prop the Modal port exposes for exactly this.
//   * <MiniGridPreview> -> an inlined native tile preview that reproduces the
//     web grid math verbatim (lg layout, GRID_COLS.lg = 4, maxY = max(y+h),
//     safeMaxY zero/NaN guard, aspect ratio, and per-tile percent left/top/
//     width/height). The per-tile lucide widget glyph (resolved from the
//     browser-only widget registry) is decorative and is dropped; the tile block
//     it sat inside — the dominant visual — is preserved.
//   * <Badge variant="neutral"> -> an inlined neutral chip; the lucide <Package/>
//     becomes the repo `package` SemanticIcon glyph ('PK').
//   * The primary <Button> + lucide <Download/> -> an inlined accent Pressable
//     (the native primary affordance, matching AppButton) with the `download`
//     glyph ('DW'); wired to the same handleDownload (onDownload + onClose).
//   * <CopyButton withToast> -> an inlined ghost Pressable gated behind a
//     clipboard-writer registry (no clipboard module ships in this native build,
//     mirroring the UrlEncoder port) with the same Copy->Copied affordance
//     (the `copy` 'CP' -> `confirm` 'OK' glyph toggle), the same `disabled`
//     handling, and an optional toast registry that mirrors the web
//     useOptionalToast()'s graceful no-op-when-absent semantics. Both i18n keys
//     for the success/error toasts are preserved.
//   * <AlertBanner variant="warning"> + lucide <AlertTriangle/> -> an inlined
//     warning banner using the warning tokens and the `warning` glyph ('W!').
//   * useDateFormat().formatDate -> an inlined native port of web
//     `lib/dateFormat.formatDate` (nullish/NaN -> '—', else toLocaleDateString
//     with { year:'numeric', month:'short', day:'numeric' }); the browser-default
//     locale/timezone is used since no native settings store is wired (matching
//     the sibling DraftRecoveryBanner formatter approach).
//   * `new Blob([json]).size` -> an inlined UTF-8 byte counter; `btoa`/`TextEncoder`
//     -> an inlined UTF-8 + base64 encoder, so `toUrlSafeBase64` produces the same
//     URL-safe output without browser globals. `buildMinimalExport` is ported
//     verbatim.
//   * `window.location.origin` -> resolveShareOrigin(): reads an optional
//     `globalThis.TESLASYNC_WEB_ORIGIN` injection point (empty string fallback,
//     yielding a valid relative `/dashboard#import=...` deep link); the >2000-char
//     length guard is preserved either way.
//   * react-i18next -> a self-contained fallback that preserves every i18n key,
//     English fallback string, and `{{var}}` interpolation.
//
// No DOM, no lucide-react, no framer-motion, no Recharts/Leaflet, `Blob`,
// `btoa`/`TextEncoder`, `window`, or web UI components are imported.

import {useCallback, useMemo, useState, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';

import {getSemanticIconDefinition} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {Modal} from '../../../components/ui/Modal';

declare global {
  // Optional native injection point for the web app origin used to build
  // shareable dashboard deep links (the RN analog of `window.location.origin`).
  // eslint-disable-next-line no-var
  var TESLASYNC_WEB_ORIGIN: string | undefined;
}

// --- Local mirrors of `../widgets/types` -----------------------------------
// The native `../widgets/types` port does not exist yet in this file-by-file
// loop, so the (subset of the) `SavedDashboard` shape ExportModal consumes is
// reproduced here field-for-field to keep the port self-contained and typed.
interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

interface WidgetInstance {
  id: string;
  widgetId: string;
  config?: WidgetConfig;
}

interface RGLLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
  isDraggable?: boolean;
  isResizable?: boolean;
  moved?: boolean;
}

interface RGLLayouts {
  [breakpoint: string]: RGLLayout[];
}

interface DashboardSettings {
  refreshInterval: number;
  vehicleId?: number;
  showWidgetBorders: boolean;
  compactMode: boolean;
}

export interface SavedDashboard {
  id: string;
  name: string;
  icon?: string;
  vehicleId?: number | null;
  widgets: WidgetInstance[];
  layouts: RGLLayouts;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
  settings?: DashboardSettings;
}

// Mirrors the web `ExportModalProps` exactly.
export interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  dashboard: SavedDashboard;
  onDownload: () => void;
}

// --- i18n fallback ----------------------------------------------------------
type TranslationVars = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: TranslationVars,
) => string;

function interpolate(template: string, vars: TranslationVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined ? '' : String(value);
  });
}

// The web component read `t` from react-i18next ('dashboard' namespace). Native
// parity has no i18n runtime wired yet, so this returns the English fallback and
// applies the same `{{var}}` interpolation react-i18next would.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, vars) => {
    if (!vars) {
      return fallback;
    }
    return interpolate(fallback, vars);
  }, []);
}

// --- Native-safe ports of the web helpers ----------------------------------
// Faithful port of `lib/dateFormat.formatDate`: nullish/invalid -> '—', else the
// long date. The web hook threaded the user's locale/tz; native has no settings
// store wired, so the browser-default locale/zone is used (matching how the
// sibling DraftRecoveryBanner port handles its date helper).
function formatDate(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Encode a JS string to its UTF-8 byte sequence — the native-safe replacement
// for `new TextEncoder().encode(str)` (not guaranteed in the RN/Hermes runtime).
function utf8Bytes(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i += 1) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate — combine with the following low surrogate.
      const hi = code;
      i += 1;
      const lo = str.charCodeAt(i);
      code = 0x10000 + ((hi & 0x3ff) << 10) + (lo & 0x3ff);
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

// `new Blob([json]).size` is the UTF-8 byte length of the JSON string.
function utf8ByteLength(str: string): number {
  return utf8Bytes(str).length;
}

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64FromBytes(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b0 = bytes[i];
    const b1 = hasB1 ? bytes[i + 1] : 0;
    const b2 = hasB2 ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64_CHARS[(triple >> 18) & 0x3f];
    out += BASE64_CHARS[(triple >> 12) & 0x3f];
    out += hasB1 ? BASE64_CHARS[(triple >> 6) & 0x3f] : '=';
    out += hasB2 ? BASE64_CHARS[triple & 0x3f] : '=';
  }
  return out;
}

// Verbatim port of `validateImport.toUrlSafeBase64` — UTF-8 -> base64 -> URL-safe
// alphabet with trailing padding stripped — without `btoa`/`TextEncoder`.
function toUrlSafeBase64(str: string): string {
  return base64FromBytes(utf8Bytes(str))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Verbatim port of `validateImport.buildMinimalExport`.
function buildMinimalExport(dashboard: SavedDashboard): string {
  const minimal = {
    name: dashboard.name,
    widgets: dashboard.widgets.map(w => ({
      id: w.id,
      widgetId: w.widgetId,
      ...(w.config ? {config: w.config} : {}),
    })),
    layouts: dashboard.layouts,
  };
  return JSON.stringify(minimal);
}

// `window.location.origin` has no RN analog. Read an optional configured web
// origin; an empty string still yields a valid relative `/dashboard#import=...`
// deep link, and the >2000-char share-URL guard works regardless.
function resolveShareOrigin(): string {
  const configured = globalThis.TESLASYNC_WEB_ORIGIN;
  if (typeof configured === 'string' && configured.trim() !== '') {
    return configured.replace(/\/+$/, '');
  }
  return '';
}

// --- Clipboard + toast registries (native-safe injection points) -----------
// The native build ships no clipboard module, so copy is a no-op until a host
// registers a writer (mirrors the UrlEncoder devtools port). The toast registry
// mirrors the web `useOptionalToast()` — absent by default, degrading copy
// feedback to a silent no-op exactly as the web does outside a ToastProvider.
type ClipboardWriter = (text: string) => Promise<void> | void;
let clipboardWriter: ClipboardWriter | null = null;

export function registerExportClipboardWriter(
  writer: ClipboardWriter | null,
): () => void {
  clipboardWriter = writer;
  return () => {
    if (clipboardWriter === writer) {
      clipboardWriter = null;
    }
  };
}

interface ExportToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}
let toastApi: ExportToastApi | null = null;

export function registerExportToast(api: ExportToastApi | null): () => void {
  toastApi = api;
  return () => {
    if (toastApi === api) {
      toastApi = null;
    }
  };
}

// Repo-canonical native stand-ins for the lucide glyphs, resolved once.
const PACKAGE_GLYPH = getSemanticIconDefinition('package').glyph;
const DOWNLOAD_GLYPH = getSemanticIconDefinition('download').glyph;
const WARNING_GLYPH = getSemanticIconDefinition('warning').glyph;
const COPY_GLYPH = getSemanticIconDefinition('copy').glyph;
const CONFIRM_GLYPH = getSemanticIconDefinition('confirm').glyph;

// web `GRID_COLS.lg` (4) from `../hooks/useDashboardLayout`.
const GRID_COLS_LG = 4;
// web share-URL hard cap.
const SHARE_URL_MAX = 2000;

// --- Inlined native MiniGridPreview ----------------------------------------
// Native rebuild of `./MiniGridPreview`. Reproduces the web grid math verbatim:
// the `lg` layout, 4 columns, maxY = max(y + h) (default 2 when empty), the
// zero/NaN safeMaxY guard, the `cols / safeMaxY` aspect ratio, and per-tile
// percent left/top/width/height. The decorative per-tile widget icon (resolved
// from the browser-only widget registry) is omitted; the tile block is kept.
function MiniGridPreview({dashboard}: {dashboard: SavedDashboard}) {
  const lgLayout = dashboard.layouts.lg ?? [];
  const cols = GRID_COLS_LG;

  const maxY =
    lgLayout.length > 0 ? Math.max(...lgLayout.map(l => l.y + l.h)) : 2;
  const safeMaxY = maxY > 0 && Number.isFinite(maxY) ? maxY : 2;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={dashboard.name}
      style={[styles.preview, {aspectRatio: cols / safeMaxY}]}>
      {lgLayout.map(item => (
        <View
          key={item.i}
          style={[
            styles.previewTile,
            {
              left: `${(item.x / cols) * 100}%` as DimensionValue,
              top: `${(item.y / safeMaxY) * 100}%` as DimensionValue,
              width: `${(item.w / cols) * 100}%` as DimensionValue,
              height: `${(item.h / safeMaxY) * 100}%` as DimensionValue,
            },
          ]}
        />
      ))}
    </View>
  );
}

// --- Inlined neutral Badge --------------------------------------------------
function Badge({glyph, children}: {glyph?: string; children: ReactNode}) {
  return (
    <View style={styles.badge}>
      {glyph ? (
        <AppText style={styles.badgeGlyph} weight="bold">
          {glyph}
        </AppText>
      ) : null}
      <AppText style={styles.badgeText} variant="caption" weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

// --- Inlined primary action button (web Button variant="primary") ----------
function PrimaryActionButton({
  glyph,
  label,
  onPress,
  testID,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({pressed}) => [
        styles.actionButton,
        styles.actionPrimary,
        pressed && styles.actionPressed,
      ]}>
      <AppText style={styles.actionGlyphPrimary} weight="bold">
        {glyph}
      </AppText>
      <AppText style={styles.actionLabelPrimary} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// --- Inlined ghost CopyButton (web shared CopyButton, withToast) -----------
function CopyButton({
  text,
  label,
  withToast = false,
  disabled = false,
  t,
  testID,
}: {
  text: string;
  label: string;
  withToast?: boolean;
  disabled?: boolean;
  t: NativeTFunction;
  testID?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onPress = useCallback(() => {
    if (disabled) {
      return;
    }
    const writer = clipboardWriter;
    if (writer == null) {
      // No clipboard host registered — graceful no-op (the web try/catch
      // failure path is likewise silent beyond the optional toast).
      return;
    }
    void (async () => {
      try {
        await writer(text);
        setCopied(true);
        if (withToast) {
          toastApi?.success(
            t('common.copyButton.successToast', 'Copied to clipboard'),
          );
        }
        setTimeout(() => setCopied(false), 2000);
      } catch {
        if (withToast) {
          toastApi?.error(t('common.copyButton.errorToast', 'Failed to copy'));
        }
      }
    })();
  }, [text, withToast, disabled, t]);

  // The web CopyButton keeps the provided `label` constant and only toggles the
  // leading icon (Copy -> CheckCircle) on success.
  const glyph = copied ? CONFIRM_GLYPH : COPY_GLYPH;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({pressed}) => [
        styles.actionButton,
        styles.actionGhost,
        disabled && styles.actionDisabled,
        pressed && !disabled && styles.actionPressed,
      ]}>
      <AppText style={styles.actionGlyphGhost} weight="bold">
        {glyph}
      </AppText>
      <AppText style={styles.actionLabelGhost} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// --- Inlined warning AlertBanner -------------------------------------------
function WarningBanner({glyph, children}: {glyph: string; children: ReactNode}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.banner}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.bannerIcon}
        weight="bold">
        {glyph}
      </AppText>
      <View style={styles.bannerBody}>
        <AppText style={styles.bannerText} variant="caption">
          {children}
        </AppText>
      </View>
    </View>
  );
}

/**
 * ExportModal — dashboard export surface (download JSON, copy JSON, copy share
 * URL). Mirrors the web component's open/onClose/dashboard/onDownload contract,
 * its computed `dashboardJson` / `jsonSize` / `shareUrl` / `shareUrlTooLong` /
 * `shareError` values, and its handleDownload (onDownload then onClose).
 */
export function ExportModal({
  open,
  onClose,
  dashboard,
  onDownload,
}: ExportModalProps) {
  const t = useNativeTranslationFallback();

  const dashboardJson = useMemo(
    () => JSON.stringify(dashboard, null, 2),
    [dashboard],
  );

  const jsonSize = useMemo(() => {
    const bytes = utf8ByteLength(dashboardJson);
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
  }, [dashboardJson]);

  // Compute the shareable URL eagerly so we can validate length and disable the
  // copy button up-front (instead of letting users tap through to a silent
  // failure or a delayed inline error).
  const shareUrl = useMemo(() => {
    const minimal = buildMinimalExport(dashboard);
    const encoded = toUrlSafeBase64(minimal);
    return `${resolveShareOrigin()}/dashboard#import=${encoded}`;
  }, [dashboard]);

  const shareUrlTooLong = shareUrl.length > SHARE_URL_MAX;
  const shareError = shareUrlTooLong
    ? t(
        'export.urlTooLong',
        'Layout too large for URL sharing ({{size}} chars). Use clipboard or file export instead.',
        {size: shareUrl.length},
      )
    : null;

  const handleDownload = () => {
    onDownload();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('export.title', 'Export Dashboard')}
      size="md"
      style={styles.dialogCard}
      testID="export-modal">
      <View style={styles.root}>
        {/* Dashboard summary */}
        <View style={styles.summaryRow}>
          <View style={styles.previewCol}>
            <MiniGridPreview dashboard={dashboard} />
          </View>
          <View style={styles.summaryInfo}>
            <AppText
              numberOfLines={1}
              style={styles.dashboardName}
              weight="semibold">
              {dashboard.name}
            </AppText>
            <View style={styles.badgeRow}>
              <Badge glyph={PACKAGE_GLYPH}>
                {t('export.widgetCount', '{{count}} widgets', {
                  count: dashboard.widgets.length,
                })}
              </Badge>
              <Badge>{jsonSize}</Badge>
            </View>
            <AppText style={styles.updated} tone="muted" variant="caption">
              {t('export.updated', 'Updated {{date}}', {
                date: formatDate(dashboard.updatedAt),
              })}
            </AppText>
          </View>
        </View>

        {/* Export options */}
        <View style={styles.optionsCol}>
          <PrimaryActionButton
            glyph={DOWNLOAD_GLYPH}
            label={t('export.downloadFile', 'Download JSON File')}
            onPress={handleDownload}
            testID="export-download"
          />

          <CopyButton
            label={t('export.copyClipboard', 'Copy to Clipboard')}
            t={t}
            testID="export-copy-json"
            text={dashboardJson}
            withToast
          />

          <CopyButton
            disabled={shareUrlTooLong}
            label={t('export.copyShareUrl', 'Copy Shareable URL')}
            t={t}
            testID="export-copy-share"
            text={shareUrl}
            withToast
          />
        </View>

        {shareError ? (
          <WarningBanner glyph={WARNING_GLYPH}>{shareError}</WarningBanner>
        ) : null}
      </View>
    </Modal>
  );
}

ExportModal.displayName = 'ExportModal';

// Web tones, mapped to RN values. The neon-amber AlertBanner "warning" hue is
// reproduced from the warning token (#fbbf24) at the web alpha stops
// (border /20, bg /5, text /80).
const WARNING_RGB = '251, 191, 36';

const styles = StyleSheet.create({
  // Modal `className="bg-[#0f1218] border border-white/[0.08]"` override.
  dialogCard: {
    backgroundColor: '#0f1218',
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  // space-y-5 == 20px between sections.
  root: {
    gap: spacing.lg,
  },
  // flex gap-4 == 16px.
  summaryRow: {
    flexDirection: 'row',
    gap: 16,
  },
  // w-32 shrink-0 == 128px fixed.
  previewCol: {
    width: 128,
    flexShrink: 0,
  },
  // min-w-0 space-y-1.5 (6px).
  summaryInfo: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  // h3 text-base font-semibold text-[var(--text-primary)] truncate.
  dashboardName: {
    fontSize: 16,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  // flex flex-wrap gap-2 (8px).
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  // p-xs text-xs text-[var(--text-muted)].
  updated: {
    lineHeight: 16,
  },
  // MiniGridPreview: relative w-full bg-white/[0.02] rounded-lg border
  // border-white/[0.06] overflow-hidden.
  preview: {
    width: '100%',
    position: 'relative',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
  },
  // absolute rounded-sm bg-white/[0.06] border border-white/[0.08].
  previewTile: {
    position: 'absolute',
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  // Badge neutral chip: inline-flex items-center gap-1 rounded-full.
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeGlyph: {
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.4,
    color: colors.textSecondary,
  },
  badgeText: {
    color: colors.textSecondary,
    lineHeight: 16,
  },
  // space-y-2 (8px) options column.
  optionsCol: {
    gap: spacing.sm,
  },
  // Button: full width, justify-start, gap, rounded, min-height 40 (web h-10).
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.sm,
    width: '100%',
    minHeight: 44,
    borderRadius: 6,
    paddingHorizontal: spacing.md,
  },
  actionPrimary: {
    backgroundColor: colors.accent,
  },
  actionGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionDisabled: {
    opacity: 0.5,
  },
  actionPressed: {
    opacity: 0.82,
  },
  actionGlyphPrimary: {
    fontSize: 11,
    letterSpacing: 0.4,
    color: colors.background,
  },
  actionLabelPrimary: {
    color: colors.background,
  },
  actionGlyphGhost: {
    fontSize: 11,
    letterSpacing: 0.4,
    color: colors.textSecondary,
  },
  actionLabelGhost: {
    color: colors.textPrimary,
  },
  // AlertBanner warning: flex items-start gap-3 rounded-xl border p-4.
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `rgba(${WARNING_RGB}, 0.2)`,
    backgroundColor: `rgba(${WARNING_RGB}, 0.05)`,
    padding: 16,
  },
  bannerIcon: {
    marginTop: 1,
    fontSize: 13,
    letterSpacing: 0.4,
    color: colors.warning,
  },
  bannerBody: {
    flex: 1,
    minWidth: 0,
  },
  bannerText: {
    color: `rgba(${WARNING_RGB}, 0.8)`,
    lineHeight: 16,
  },
});
