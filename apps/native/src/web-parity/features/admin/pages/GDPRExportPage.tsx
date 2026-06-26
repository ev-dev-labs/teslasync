// Native parity port of web/src/features/admin/pages/GDPRExportPage.tsx.
//
// `GDPRExportPage` is an admin observability surface: it polls a single GDPR
// export artifact by id (via `useGDPRExport`) and renders its status, metadata,
// and a Download affordance. The artifact id can be supplied via the `?id=`
// query string so deep links to a specific export work. State names
// (`idInput`/`setIdInput`, `activeId`/`setActiveId`, `searchParams`/
// `setSearchParams`), the API path (`/admin/gdpr/exports/{id}` through the hook,
// plus the `/api/v1/admin/gdpr/exports/{id}/download` binary-stream URL), the
// 503/404 branch logic, the STATUS_VARIANT map, and every i18n key are preserved
// verbatim from the web source.
//
// Web-only dependencies with no native-parity surface are mapped per the
// conversion contract (rules 4/5/6/7):
//   - react-i18next `useTranslation` (L15) -> the standard web-parity i18n shim
//     returning the inline English fallback (apps/native lacks react-i18next), so
//     every `t('key', 'English')` call in the body is unchanged.
//   - react-router-dom `useSearchParams` (L16) -> a local useState-backed shim
//     with the SAME `[searchParams, setSearchParams]` shape: `searchParams.get`
//     and `setSearchParams(next, { replace })`. Native has no DOM URL/history, so
//     there is no `?id=` to read on first mount (initial id is '') and URL
//     persistence / deep-link sharing is UNAVAILABLE (documented in the sidecar).
//     The id still flows through component state exactly as on web.
//   - lucide-react `HardDriveDownload` / `Search` (L17, SVG) have no native
//     analog -> decorative emoji glyphs ('\u{1F4BE}' / '\u{1F50D}'); the visible
//     label always carries the meaning, so each glyph is decorative for a11y. The
//     HardDriveDownload empty-state icon is dropped because the shared native
//     EmptyState exposes no icon slot.
//   - `PageContainer` from @/components/layout (L19) -> the web-parity layout
//     PageContainer (reused). Its `query` prop drives ONLY the header freshness
//     chip on both web and native (loading/error are NOT derived from it — the
//     web source never passes `loading`), so behaviour matches: while the query
//     loads, `artifact` is undefined and nothing below the lookup panel renders.
//   - `GlassPanel` from @/components/ui (L20) -> the shared native GlassPanel.
//   - `Badge` from @/components/ui (L20) -> the web-parity Badge (reused).
//   - `Button` from @/components/ui (L20) is not ported -> a local `Button`
//     (glyph + label primary Pressable), the "own the unported sibling locally"
//     approach the RegexTester/DevToolsPage ports use.
//   - `Input` from @/components/ui (L20) is not ported -> a local labelled
//     single-line `TextInput` (the RegexTester Input precedent), reusing the
//     ported `Label`. The web DOM `onChange={(e)=>setIdInput(e.target.value)}`
//     becomes RN `onChangeText={setIdInput}`; the web `onKeyDown` Enter ->
//     handleLookup becomes `onSubmitEditing` + `returnKeyType="search"`.
//   - `CopyButton` from @/components/ui (L20) copies via `navigator.clipboard`,
//     which has no binding in this native runtime (no clipboard module bundled)
//     -> a local icon-only `CopyButton` that keeps the affordance + i18n keys but
//     surfaces an explicit "copy unavailable on this device" state on press
//     (the PageContainer CopyLinkButton precedent). Clipboard write is UNAVAILABLE.
//   - `PanelTitle` / `Caption` / `Text` from @/components/ui/Typography (L21) ->
//     local AppText-based helpers carrying the web typography-role styling
//     (panelTitle = text-base/600/--text-primary, caption = text-xs/--text-muted,
//     Text variant="bodySm" = text-xs/--text-secondary, from @/lib/tokens roles).
//   - `StatCard` from @/components/data-display (L22) -> a local StatCard (the
//     web Card + label/value layout: text-sm/500/--text-muted label over a
//     text-2xl/bold value), since no parity StatCard exists.
//   - `FadeIn` from @/components/motion (L23) -> the web-parity motion FadeIn
//     (reused).
//   - `EmptyState` from @/components/feedback (L24) -> the shared native
//     EmptyState (reused; title + message, no icon slot).
//   - `AlertBanner` from @/components/feedback (L24) is not ported -> a local
//     AlertBanner (variant border/bg/title/body), mapping the web neon tints to
//     the toned-down SI palette (info->accent/cyan-300, warning->warning/amber-300,
//     danger->danger/rose-300, success->success/emerald-300).
//   - `SectionErrorBoundary` from @/components/feedback (L24) is not ported -> a
//     local class error boundary mirroring the PageContainer PageErrorBoundary
//     `section:{name}` log-correlation + inline retry fallback.
//   - `usePageTitle` from @/hooks/usePageTitle (L25) writes `document.title`;
//     native has no DOM document, so it is a documented native-safe no-op (the
//     translated title is still computed and PageContainer renders it as the
//     on-screen header).
//   - `formatBytes` from @/lib/numberFormat (L26) and `formatDateTime` /
//     `formatRelative` (+ its `formatDate` >7d fallback) from @/lib/dateFormat
//     (L27) are inlined verbatim (the TimeStamp port precedent) so the rendered
//     strings are byte-identical; the native lib/format.ts variants diverge
//     (no year, '-' vs '—', no relative helper) so they are intentionally NOT used.
//   - `useGDPRExport` from @/api/hooks/useOperatorConfidence (L28) -> the
//     web-parity hook (reused; same `/admin/gdpr/exports/{id}` path + polling).
//   - `isApiError` from @/lib/resilience (L29) -> the web-parity api/client
//     `isApiError` (reused; narrows to ApiError with `.status`).
//   - `GDPRArtifactStatus` from @/types/admin-operator-confidence (L30) -> the
//     same type re-exported by the web-parity useOperatorConfidence hook.
//
// The web `<a href={downloadUrl} download><Button/></a>` (L238-243) streams a
// binary through the browser using the page's auth cookies. A native runtime has
// no DOM anchor download and the relative `/api/v1/...` stream needs the app's
// authenticated session (an external `Linking.openURL` would not carry it), so
// the Download affordance is kept (same i18n keys) as a local `DownloadButton`
// that surfaces an explicit "download unavailable on this device" state on press.
// Binary bundle download is UNAVAILABLE on native (documented in the sidecar).
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported — only React + react-native primitives (View / TextInput
// / Pressable / StyleSheet), the web-parity PageContainer / FadeIn / Badge / Label,
// the shared native GlassPanel / AppText / EmptyState, the web-parity hook +
// client, and theme tokens. Tailwind maps to StyleSheet: space-y-6 -> gap 24,
// gap-4 -> 16, gap-3 -> 12, gap-2 -> 8, p-6 -> 24, p-4 -> 16, rounded-xl -> 12,
// mb-4 -> 16, mt-2 -> 8; the responsive grids resolve mobile-first
// (status `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` -> a wrapping 2-up row,
// details `grid-cols-1 md:grid-cols-2` -> a single-column stack); --text-primary/
// -secondary/-muted -> colors.text*.

import React, {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {EmptyState} from '../../../../components/feedback/EmptyState';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {isApiError} from '../../../api/client';
import {
  useGDPRExport,
  type GDPRArtifactStatus,
} from '../../../api/hooks/useOperatorConfidence';
import {Badge, type BadgeVariant} from '../../../components/ui/Badge';
import {Label} from '../../../components/ui/Label';
import {PageContainer} from '../../../components/layout/PageContainer';
import {FadeIn} from '../../../components/motion';

// ── i18n shim ────────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. The hook shape mirrors the web
// `const { t } = useTranslation()` so the component body is unchanged.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((_key, fallback) => fallback, []);
  return {t};
}

// ── usePageTitle shim ────────────────────────────────────────────────────────
// The web hook writes `document.title`. Native has no DOM document and the
// browser-tab title has no analog, so this is a documented native-safe no-op; the
// translated title is still computed and PageContainer renders it as the header.
function usePageTitle(title: string): void {
  useEffect(() => {
    return undefined;
  }, [title]);
}

// ── useSearchParams shim ─────────────────────────────────────────────────────
// The web hook reads/writes the `?id=` query string via react-router-dom. Native
// has no DOM URL/history, so this is a useState-backed shim with the SAME
// `[searchParams, setSearchParams]` shape: `searchParams.get(key)` returns the
// current value (or null), and `setSearchParams(next, opts)` replaces the params
// (matching react-router's object form). URL persistence / deep-link sharing is
// unavailable on native, so the initial params are empty (initial id === '').
interface SearchParamsShim {
  get(key: string): string | null;
}

type SetSearchParams = (
  next: Record<string, string>,
  opts?: {replace?: boolean},
) => void;

function useSearchParams(): [SearchParamsShim, SetSearchParams] {
  const [params, setParams] = useState<Record<string, string>>({});
  const accessor = useMemo<SearchParamsShim>(
    () => ({
      get: key => (key in params ? params[key] : null),
    }),
    [params],
  );
  const setSearchParams = useCallback<SetSearchParams>((next, _opts) => {
    // react-router's object form replaces the whole query; the `replace`
    // history option has no analog without a DOM history stack, so it is ignored.
    setParams({...next});
  }, []);
  return [accessor, setSearchParams];
}

// ── inlined formatters (web @/lib/numberFormat + @/lib/dateFormat) ────────────
// Inlined verbatim so the rendered strings are byte-identical to the web. The
// native lib/format.ts variants diverge (no year, '-' vs '—', no relative
// helper), so they are intentionally not reused.

/** web formatBytes(bytes) with default options (empty '—', gbDecimals 1). */
function formatBytes(bytes: number | null | undefined): string {
  const empty = '—';
  if (bytes == null || !Number.isFinite(bytes)) {
    return empty;
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** web formatDate: "Apr 4, 2026" — the formatRelative >7d fallback target. */
function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** web formatDateTime: "Apr 4, 2026, 2:30 AM". */
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** web formatRelative: "just now", "5m ago", "2h ago", "3d ago", else date. */
function formatRelative(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  const now = Date.now();
  const diff = now - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return formatDate(iso);
}

// Decorative emoji glyphs standing in for the lucide SVG icons (label-backed).
const HARD_DRIVE_DOWNLOAD_GLYPH = '\u{1F4BE}'; // 💾 HardDriveDownload
const SEARCH_GLYPH = '\u{1F50D}'; // 🔍 Search
const COPY_GLYPH = '\u{1F4CB}'; // 📋 Copy

// ── Typography helpers (web @/components/ui/Typography roles) ─────────────────
interface TypographyProps {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}

// web role panelTitle: text-base font-semibold text-[var(--text-primary)].
function PanelTitle({children, style}: TypographyProps) {
  return <AppText style={[styles.panelTitle, style]}>{children}</AppText>;
}

// web role caption: text-xs text-[var(--text-muted)].
function Caption({children, style}: TypographyProps) {
  return <AppText style={[styles.caption, style]}>{children}</AppText>;
}

// ── StatCard (web @/components/data-display StatCard, label + value subset) ────
interface StatCardProps {
  label: string;
  value: string | number;
}

function StatCard({label, value}: StatCardProps) {
  return (
    <GlassPanel style={styles.gridCard}>
      <AppText style={styles.statLabel}>{label}</AppText>
      <AppText style={styles.statValue}>{value}</AppText>
    </GlassPanel>
  );
}

// ── Button (web @/components/ui Button, primary + leading icon) ───────────────
interface ButtonProps {
  glyph: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

function Button({glyph, label, onPress, disabled}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: Boolean(disabled)}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        disabled ? styles.buttonDisabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.buttonGlyph}>
        {glyph}
      </AppText>
      <AppText style={styles.buttonLabel}>{label}</AppText>
    </Pressable>
  );
}

// ── CopyButton (web @/components/ui CopyButton; clipboard unavailable) ─────────
// The web component copies `text` via `navigator.clipboard.writeText`. No
// clipboard binding exists in this native runtime, so the icon-only affordance is
// kept (same i18n keys) but pressing surfaces an explicit unavailable hint.
interface CopyButtonProps {
  text: string;
}

function CopyButton({text}: CopyButtonProps) {
  const {t} = useTranslation();
  const [notified, setNotified] = useState(false);
  const canCopy = text.trim().length > 0;

  const handlePress = useCallback(() => {
    if (canCopy) {
      setNotified(true);
    }
  }, [canCopy]);

  const hint = t(
    'common.copyButton.unavailable',
    'Copying is unavailable on this device',
  );

  return (
    <Pressable
      accessibilityHint={notified ? hint : undefined}
      accessibilityLabel={t('common.copyButton.copy', 'Copy')}
      accessibilityRole="button"
      accessibilityState={{disabled: !canCopy}}
      disabled={!canCopy}
      hitSlop={8}
      onPress={handlePress}
      style={({pressed}) => [
        styles.copyButton,
        pressed ? styles.pressed : null,
      ]}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.copyGlyph}>
        {COPY_GLYPH}
      </AppText>
    </Pressable>
  );
}

// ── DownloadButton (web `<a href download><Button/>`; download unavailable) ────
// The web anchor streams the bundle through the browser using the page's auth
// session. Native has no DOM anchor download and the relative stream URL needs
// the app's authenticated session, so the affordance is kept (same i18n keys)
// but pressing surfaces an explicit unavailable hint.
interface DownloadButtonProps {
  url: string;
  label: string;
}

function DownloadButton({url, label}: DownloadButtonProps) {
  const {t} = useTranslation();
  const [notified, setNotified] = useState(false);
  const ready = url.length > 0;

  const handlePress = useCallback(() => {
    if (ready) {
      setNotified(true);
    }
  }, [ready]);

  const hint = t(
    'admin.gdprExport.downloadUnavailable',
    'Bundle download is unavailable on this device.',
  );

  return (
    <View style={styles.downloadButtonWrap}>
      <Button
        glyph={HARD_DRIVE_DOWNLOAD_GLYPH}
        label={label}
        onPress={handlePress}
        disabled={!ready}
      />
      {notified ? (
        <Caption style={styles.downloadHint}>{hint}</Caption>
      ) : null}
    </View>
  );
}

// ── AlertBanner (web @/components/feedback AlertBanner) ───────────────────────
type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

interface AlertTone {
  border: string;
  bg: string;
  title: string;
  body: string;
}

// web neon tints -> toned-down SI palette (title = semantic token, body = the
// toned-down -300 hue: cyan-300 / emerald-300 / amber-300 / rose-300).
const ALERT_TONES: Record<AlertVariant, AlertTone> = {
  info: {
    border: colors.borderAccent,
    bg: colors.accentSoft,
    title: colors.accent,
    body: '#7dd3fc',
  },
  success: {
    border: colors.successBorder,
    bg: colors.successSurface,
    title: colors.success,
    body: '#6ee7b7',
  },
  warning: {
    border: colors.warningBorder,
    bg: colors.warningSurface,
    title: colors.warning,
    body: '#fcd34d',
  },
  danger: {
    border: colors.dangerBorder,
    bg: colors.dangerSurface,
    title: colors.danger,
    body: '#fda4af',
  },
};

interface AlertBannerProps {
  variant: AlertVariant;
  title?: string;
  children: ReactNode;
}

function AlertBanner({variant, title, children}: AlertBannerProps) {
  const tone = ALERT_TONES[variant];
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.alert,
        {backgroundColor: tone.bg, borderColor: tone.border},
      ]}>
      <View style={styles.alertBody}>
        {title ? (
          <AppText style={[styles.alertTitle, {color: tone.title}]}>
            {title}
          </AppText>
        ) : null}
        <AppText
          style={[
            styles.alertText,
            {color: tone.body},
            title ? styles.alertTextSpaced : null,
          ]}>
          {children}
        </AppText>
      </View>
    </View>
  );
}

// ── SectionErrorBoundary (web @/components/feedback SectionErrorBoundary) ──────
// Wraps the artifact section so a render failure inside it doesn't blank the
// whole page. Mirrors the PageContainer PageErrorBoundary `section:{name}`
// log-correlation channel + inline retry fallback.
interface SectionErrorBoundaryProps {
  name: string;
  children: ReactNode;
}

interface SectionErrorBoundaryState {
  error: Error | null;
}

class SectionErrorBoundary extends Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  state: SectionErrorBoundaryState = {error: null};

  static getDerivedStateFromError(error: Error): SectionErrorBoundaryState {
    return {error};
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `section:${this.props.name} render failed`,
      error,
      info.componentStack,
    );
  }

  handleRetry = (): void => {
    this.setState({error: null});
  };

  render(): ReactNode {
    if (this.state.error) {
      return <SectionErrorFallback onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

function SectionErrorFallback({onRetry}: {onRetry: () => void}) {
  const {t} = useTranslation();
  return (
    <View accessibilityRole="alert" style={styles.sectionError}>
      <AppText style={styles.sectionErrorTitle}>
        {t('errors.section.title', 'Something went wrong')}
      </AppText>
      <AppText style={styles.sectionErrorSubtitle} tone="muted">
        {t('errors.section.subtitle', 'Other parts of the page should still work.')}
      </AppText>
      <Pressable
        accessibilityLabel={t('errors.section.retry', 'Try again')}
        accessibilityRole="button"
        onPress={onRetry}
        style={({pressed}) => [
          styles.retry,
          pressed ? styles.pressed : null,
        ]}>
        <AppText style={styles.retryText}>
          {t('errors.section.retry', 'Try again')}
        </AppText>
      </Pressable>
    </View>
  );
}

// ── Input (web @/components/ui Input, label + single-line text field) ─────────
interface InputProps {
  label: string;
  placeholder?: string;
  value: string;
  onChangeText: (value: string) => void;
  onSubmitEditing: () => void;
}

function Input({label, placeholder, value, onChangeText, onSubmitEditing}: InputProps) {
  const [focused, setFocused] = useState(false);
  // web L36: id || label?.toLowerCase().replace(/\s+/g, '-').
  const inputId = label.toLowerCase().replace(/\s+/g, '-');
  return (
    <View style={styles.fieldBlock}>
      <Label htmlFor={inputId} style={styles.fieldLabel}>
        {label}
      </Label>
      <View
        style={[
          styles.control,
          {borderColor: focused ? colors.borderAccent : colors.border},
        ]}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          nativeID={inputId}
          onBlur={() => setFocused(false)}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onSubmitEditing={onSubmitEditing}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          returnKeyType="search"
          style={styles.controlInput}
          value={value}
        />
      </View>
    </View>
  );
}

// web STATUS_VARIANT: maps the artifact status to a Badge variant.
const STATUS_VARIANT: Record<GDPRArtifactStatus, BadgeVariant> = {
  queued: 'info',
  running: 'info',
  complete: 'success',
  failed: 'danger',
  expired: 'warning',
};

export default function GDPRExportPage() {
  const {t} = useTranslation();
  usePageTitle(t('admin.gdprExport.pageTitle', 'GDPR Export'));

  const [searchParams, setSearchParams] = useSearchParams();
  const initialId = searchParams.get('id') ?? '';
  const [idInput, setIdInput] = useState(initialId);
  const [activeId, setActiveId] = useState(initialId);

  // Keep the (shimmed) params in sync when activeId changes so refresh + share
  // works on web; on native this only updates local state (no DOM URL).
  useEffect(() => {
    if (activeId && searchParams.get('id') !== activeId) {
      setSearchParams({id: activeId}, {replace: true});
    }
  }, [activeId, searchParams, setSearchParams]);

  const query = useGDPRExport(activeId);
  const subsystemMissing = isApiError(query.error) && query.error.status === 503;
  const notFound = isApiError(query.error) && query.error.status === 404;
  const artifact = query.data;

  const handleLookup = () => {
    setActiveId(idInput.trim());
  };

  const downloadUrl =
    artifact && artifact.status === 'complete'
      ? `/api/v1/admin/gdpr/exports/${encodeURIComponent(artifact.id)}/download`
      : null;

  return (
    <PageContainer
      title={t('admin.gdprExport.pageTitle', 'GDPR Export')}
      subtitle={t(
        'admin.gdprExport.subtitle',
        'Look up the status of a GDPR data export by artifact id and download the bundle when it completes. Bundles expire after the configured retention window.',
      )}
      query={activeId ? query : undefined}>
      <FadeIn>
        <View style={styles.page}>
          {subsystemMissing ? (
            <AlertBanner
              variant="warning"
              title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}>
              {t(
                'admin.gdprExport.notConfigured',
                'GDPR export subsystem is not configured on this deployment.',
              )}
            </AlertBanner>
          ) : null}

          <GlassPanel style={styles.panel}>
            <PanelTitle style={styles.mb4}>
              {t('admin.gdprExport.lookupTitle', 'Lookup artifact')}
            </PanelTitle>
            <View style={styles.lookupRow}>
              <View style={styles.lookupField}>
                <Input
                  label={t('admin.gdprExport.idLabel', 'Artifact ID')}
                  placeholder={t('admin.gdprExport.idPlaceholder', 'e.g. 8f4c…')}
                  value={idInput}
                  onChangeText={setIdInput}
                  onSubmitEditing={handleLookup}
                />
              </View>
              <Button
                glyph={SEARCH_GLYPH}
                label={t('admin.gdprExport.lookupButton', 'Look up')}
                onPress={handleLookup}
                disabled={!idInput.trim()}
              />
            </View>
            <Caption style={styles.mt2}>
              {t(
                'admin.gdprExport.lookupHint',
                'IDs come from the GDPR export queue email or the request response. The artifact polls while queued/running.',
              )}
            </Caption>
          </GlassPanel>

          {!activeId ? (
            <GlassPanel style={styles.panel}>
              {/* no-action: the artifact-ID lookup input is immediately above this panel; this empty state only renders before submission */}
              <EmptyState
                title={t('admin.gdprExport.emptyTitle', 'No artifact selected')}
                message={t(
                  'admin.gdprExport.emptyMessage',
                  'Enter an artifact ID above to look up its status. The page will keep refreshing until the export completes.',
                )}
              />
            </GlassPanel>
          ) : null}

          {activeId && notFound ? (
            <AlertBanner
              variant="danger"
              title={t('admin.gdprExport.notFoundTitle', 'Artifact not found')}>
              {t(
                'admin.gdprExport.notFoundMessage',
                'No artifact with that id exists, or it has been purged. Check the id and try again.',
              )}
            </AlertBanner>
          ) : null}

          {artifact ? (
            <SectionErrorBoundary name="gdpr-export-artifact">
              <View style={styles.page}>
                <View style={styles.statGrid}>
                  <GlassPanel style={styles.gridCard}>
                    <Caption>{t('admin.gdprExport.statusLabel', 'Status')}</Caption>
                    <View style={styles.statusBadgeWrap}>
                      <Badge
                        variant={STATUS_VARIANT[artifact.status] ?? 'neutral'}
                        size="lg">
                        {artifact.status}
                      </Badge>
                    </View>
                  </GlassPanel>
                  <StatCard
                    label={t('admin.gdprExport.formatLabel', 'Format')}
                    value={artifact.format || '—'}
                  />
                  <StatCard
                    label={t('admin.gdprExport.bytesLabel', 'Size')}
                    value={artifact.bytes != null ? formatBytes(artifact.bytes) : '—'}
                  />
                  <StatCard
                    label={t('admin.gdprExport.storageLabel', 'Storage')}
                    value={artifact.storage || '—'}
                  />
                </View>

                <GlassPanel style={styles.panel}>
                  <PanelTitle style={styles.mb4}>
                    {t('admin.gdprExport.metaTitle', 'Artifact details')}
                  </PanelTitle>
                  <View style={styles.metaList}>
                    <MetaRow
                      label={t('admin.gdprExport.metaId', 'ID')}
                      value={
                        <View style={styles.copyRow}>
                          <AppText style={styles.monoPrimary}>{artifact.id}</AppText>
                          <CopyButton text={artifact.id} />
                        </View>
                      }
                    />
                    {artifact.user_id ? (
                      <MetaRow
                        label={t('admin.gdprExport.metaUser', 'User')}
                        value={artifact.user_id}
                      />
                    ) : null}
                    <MetaRow
                      label={t('admin.gdprExport.metaCreated', 'Created')}
                      value={
                        <>
                          <AppText style={styles.metaValueText}>
                            {formatDateTime(artifact.created_at)}
                          </AppText>
                          <Caption>{formatRelative(artifact.created_at)}</Caption>
                        </>
                      }
                    />
                    {artifact.completed_at ? (
                      <MetaRow
                        label={t('admin.gdprExport.metaCompleted', 'Completed')}
                        value={
                          <>
                            <AppText style={styles.metaValueText}>
                              {formatDateTime(artifact.completed_at)}
                            </AppText>
                            <Caption>{formatRelative(artifact.completed_at)}</Caption>
                          </>
                        }
                      />
                    ) : null}
                    {artifact.expires_at ? (
                      <MetaRow
                        label={t('admin.gdprExport.metaExpires', 'Expires')}
                        value={
                          <>
                            <AppText style={styles.metaValueText}>
                              {formatDateTime(artifact.expires_at)}
                            </AppText>
                            <Caption>{formatRelative(artifact.expires_at)}</Caption>
                          </>
                        }
                      />
                    ) : null}
                    {artifact.sha256 ? (
                      <MetaRow
                        label={t('admin.gdprExport.metaSha256', 'SHA-256')}
                        value={
                          <View style={styles.copyRow}>
                            <AppText style={styles.monoSecondary}>
                              {artifact.sha256}
                            </AppText>
                            <CopyButton text={artifact.sha256} />
                          </View>
                        }
                      />
                    ) : null}
                  </View>
                </GlassPanel>

                {artifact.error ? (
                  <AlertBanner
                    variant="danger"
                    title={t('admin.gdprExport.errorTitle', 'Export failed')}>
                    {artifact.error}
                  </AlertBanner>
                ) : null}

                <GlassPanel style={styles.panel}>
                  <PanelTitle style={styles.mb4}>
                    {t('admin.gdprExport.downloadTitle', 'Download')}
                  </PanelTitle>
                  {downloadUrl ? (
                    <View style={styles.downloadBlock}>
                      <AppText style={styles.bodySm}>
                        {t(
                          'admin.gdprExport.downloadHint',
                          'The bundle streams from the backend through this browser. The download counter is logged to the audit ledger.',
                        )}
                      </AppText>
                      <DownloadButton
                        url={downloadUrl}
                        label={t('admin.gdprExport.downloadButton', 'Download bundle')}
                      />
                    </View>
                  ) : (
                    <Caption>
                      {artifact.status === 'queued' || artifact.status === 'running'
                        ? t(
                            'admin.gdprExport.downloadWait',
                            'Download becomes available once the export completes.',
                          )
                        : artifact.status === 'expired'
                          ? t(
                              'admin.gdprExport.downloadExpired',
                              'This artifact has expired and is no longer downloadable.',
                            )
                          : t(
                              'admin.gdprExport.downloadFailed',
                              'No bundle available — see the error above.',
                            )}
                    </Caption>
                  )}
                </GlassPanel>
              </View>
            </SectionErrorBoundary>
          ) : null}
        </View>
      </FadeIn>
    </PageContainer>
  );
}

function MetaRow({label, value}: {label: string; value: ReactNode}) {
  return (
    <View>
      <Caption>{label}</Caption>
      {typeof value === 'string' ? (
        <AppText style={styles.metaValueText}>{value}</AppText>
      ) : (
        <View style={styles.metaValue}>{value}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    gap: 24, // space-y-6
  },
  panel: {
    padding: 24, // p-6
  },
  mb4: {
    marginBottom: 16, // mb-4
  },
  mt2: {
    marginTop: 8, // mt-2
  },
  // Typography roles ---------------------------------------------------------
  panelTitle: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    fontSize: 16, // text-base
    fontWeight: '600', // font-semibold
    lineHeight: 22,
  },
  caption: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  bodySm: {
    color: colors.textSecondary, // Text variant="bodySm": text-xs --text-secondary
    fontSize: 12,
    lineHeight: 18,
  },
  // Lookup row ---------------------------------------------------------------
  lookupRow: {
    // web: flex-col items-stretch gap-3 sm:flex-row -> mobile-first stacked column.
    gap: 12, // gap-3
  },
  lookupField: {
    flex: 1,
  },
  fieldBlock: {
    gap: 4, // space-y-1
  },
  fieldLabel: {
    color: colors.textSecondary, // text-sm font-medium text-[var(--text-secondary)]
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  control: {
    alignItems: 'center',
    backgroundColor: colors.surface, // bg-[var(--surface-1)]
    borderRadius: 6, // rounded-md
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 12, // px-3
  },
  controlInput: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    flex: 1,
    fontSize: 14, // text-sm
    lineHeight: 20,
    paddingVertical: 8, // py-2
  },
  // Button -------------------------------------------------------------------
  button: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.accent,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  buttonGlyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  buttonLabel: {
    color: colors.background, // dark foreground on the accent fill
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.82,
  },
  // CopyButton ---------------------------------------------------------------
  copyButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  copyGlyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  // DownloadButton -----------------------------------------------------------
  downloadButtonWrap: {
    alignItems: 'flex-start',
    gap: 8,
  },
  downloadHint: {
    maxWidth: 320,
  },
  downloadBlock: {
    alignItems: 'flex-start',
    gap: 12, // gap-3
  },
  // AlertBanner --------------------------------------------------------------
  alert: {
    borderRadius: 12, // rounded-xl
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12, // gap-3
    padding: 16, // p-4
  },
  alertBody: {
    flex: 1,
  },
  alertTitle: {
    fontSize: 14, // text-sm
    fontWeight: '500', // font-medium
    lineHeight: 20,
  },
  alertText: {
    fontSize: 12, // text-xs
    lineHeight: 18,
  },
  alertTextSpaced: {
    marginTop: 2, // mt-0.5
  },
  // SectionErrorBoundary fallback -------------------------------------------
  sectionError: {
    alignItems: 'flex-start',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  sectionErrorTitle: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  sectionErrorSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  retry: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 16,
  },
  retryText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  // Stat grid ----------------------------------------------------------------
  statGrid: {
    // web grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 -> wrapping 2-up row.
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16, // gap-4
  },
  gridCard: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: 4, // gap-1
    minWidth: 140,
    padding: 16, // p-4
  },
  statLabel: {
    color: colors.textMuted, // text-sm font-medium text-[var(--text-muted)]
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  statValue: {
    color: colors.textPrimary, // text-2xl font-bold
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  statusBadgeWrap: {
    alignItems: 'flex-start',
    marginTop: 8, // mt-2
  },
  // Artifact details ---------------------------------------------------------
  metaList: {
    // web dl grid-cols-1 md:grid-cols-2 -> mobile-first single-column stack.
    gap: 16, // gap-4
  },
  metaValue: {
    marginTop: 2,
  },
  metaValueText: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    fontSize: 14,
    lineHeight: 20,
  },
  copyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8, // gap-2
    marginTop: 2,
  },
  monoPrimary: {
    color: colors.textPrimary, // break-all font-mono text-sm text-[var(--text-primary)]
    flexShrink: 1,
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 20,
  },
  monoSecondary: {
    color: colors.textSecondary, // break-all font-mono text-xs text-[var(--text-secondary)]
    flexShrink: 1,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 16,
  },
});
