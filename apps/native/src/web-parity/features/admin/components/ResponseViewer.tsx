/**
 * Native parity port of
 * web/src/features/admin/components/ResponseViewer.tsx.
 *
 * The web file is the API-Playground response surface that sits under the
 * RequestBuilder. It exposes the `ApiResponse` / `HistoryEntry` types, the
 * `SnippetPanel` (a collapsible cURL/JavaScript/Python/Go code-snippet generator
 * with a copy button), an internal `ResponseHeaders` toggle, an internal
 * `RequestHistory` strip of replayable recent-request chips, and the default
 * `ResponseViewer` (a Response GlassPanel that shows a skeleton while loading, an
 * empty state before the first request, or a status bar + pretty-printed body +
 * response headers once a response arrives, followed by the history strip). This
 * native port preserves that contract 1:1 — the exported type/`SnippetPanel`
 * surface, the `formatBytes` / `statusColor` / `statusBg` helpers, the
 * `generateSnippet` switch (ported verbatim), the per-panel `open` / `format`
 * state, and the conditional loading / empty / response rendering — using React
 * Native primitives + the existing native AppText / GlassPanel / design tokens.
 *
 * Browser-only / unconverted dependencies are reduced explicitly and documented
 * in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L2): replaced by a native-safe
 *     `t(key, fallback?)` fallback (the established EndpointSidebar / RequestBuilder
 *     precedent) returning the English default (else the key); every web key is
 *     preserved verbatim.
 *   - lucide-react `ChevronDown` (web L3): rendered as a decorative AppText glyph
 *     (CHEVRON_DOWN \u2304 — the same stand-in EndpointSidebar uses) that rotates
 *     180deg when its section is open, matching the web `open && 'rotate-180'`.
 *   - `@/lib/cn` (web L4): dropped — Tailwind class merging is meaningless on RN.
 *   - `@/components/ui` `GlassPanel` (web L5): the existing native GlassPanel.
 *     `Button` -> a local native-safe Pressable link/tab button. `CopyButton`
 *     (web clipboard write + toast) -> a native-safe `CopyButton` that is present
 *     and labelled but whose clipboard write is UNAVAILABLE on native (no
 *     @react-native-clipboard dependency); the unavailability is surfaced via
 *     `nativeResponseViewerCapabilities.clipboardAvailable = false` (the
 *     useWatch `sessionStorageAvailable: false` precedent).
 *   - `@/components/feedback` `Skeleton` / `EmptyState` (web L6): no shared native
 *     parity ports exist yet, so minimal native-safe equivalents are reproduced
 *     locally (a token-backed Skeleton box + an AppText empty state).
 *   - `@/components/motion` `FadeIn` (web L7): framer-motion entrance animation ->
 *     a static passthrough View (the Layout framer-motion -> static precedent).
 *   - Tailwind status colours (green/amber/red-400 + the *-500/10 + *-500/20 bg /
 *     border) and the history method colours cannot apply on native, so they are
 *     reproduced as literal palette hex/rgba constants (the EndpointSidebar
 *     method-colour precedent). The web `<pre>` (overflow-auto/-x-auto) becomes a
 *     ScrollView wrapping a monospace AppText.
 */
import React, {useMemo, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';

/* ── types (ported verbatim) ─────────────────────────────────────────────── */

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  bodyText: string;
  duration: number;
  size: number;
  contentType: string;
}

export interface HistoryEntry {
  method: string;
  path: string;
  status: number;
  duration: number;
  timestamp: string;
}

interface ResponseViewerProps {
  response: ApiResponse | null;
  loading: boolean;
  history: HistoryEntry[];
  onReplay: (entry: HistoryEntry) => void;
}

/* ── native capability flags (explicit unavailable browser behaviour) ────── */

export const nativeResponseViewerCapabilities = {
  /** Web `CopyButton` writes to navigator.clipboard; RN has no clipboard
   * module wired here, so the snippet copy button is a documented no-op. */
  clipboardAvailable: false,
} as const;

/* ── native translation fallback (native-safe port of react-i18next) ─────── */

type NativeTFunction = (key: string, fallback?: string) => string;

/** Mirrors `t(key, default?)`: returns the English default, else the key. */
function useNativeTranslationFallback(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key: string, fallback?: string) => fallback ?? key,
    [],
  );
}

/* ── decorative glyph stand-in for the lucide-react icon ─────────────────── */

const CHEVRON_DOWN = '\u2304';

/* ── Tailwind palette literals that cannot apply on native ───────────────── */

const GREEN_400 = '#4ade80';
const GREEN_500_10 = 'rgba(34, 197, 94, 0.1)';
const GREEN_500_20 = 'rgba(34, 197, 94, 0.2)';
const AMBER_400 = '#fbbf24';
const AMBER_500_10 = 'rgba(245, 158, 11, 0.1)';
const AMBER_500_20 = 'rgba(245, 158, 11, 0.2)';
const RED_400 = '#f87171';
const RED_500_10 = 'rgba(239, 68, 68, 0.1)';
const RED_500_20 = 'rgba(239, 68, 68, 0.2)';
const BLUE_400 = '#60a5fa';
const BLUE_500_20 = 'rgba(59, 130, 246, 0.2)';
const GREEN_500_20_BG = 'rgba(34, 197, 94, 0.2)';

const BORDER_SUBTLE = 'rgba(255, 255, 255, 0.06)';
const BORDER_FAINT = 'rgba(255, 255, 255, 0.04)';
const SURFACE_OVERLAY = 'rgba(255, 255, 255, 0.03)';
const SURFACE_2 = 'rgba(255, 255, 255, 0.07)';

/* ── helpers (ported verbatim) ───────────────────────────────────────────── */

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** web `text-green-400` / `text-amber-400` / `text-red-400`. */
function statusColor(status: number): string {
  if (status < 300) {
    return GREEN_400;
  }
  if (status < 400) {
    return AMBER_400;
  }
  return RED_400;
}

interface StatusBgStyle {
  backgroundColor: string;
  borderColor: string;
}

/** web `bg-{c}-500/10 border-{c}-500/20`. */
function statusBg(status: number): StatusBgStyle {
  if (status < 300) {
    return {backgroundColor: GREEN_500_10, borderColor: GREEN_500_20};
  }
  if (status < 400) {
    return {backgroundColor: AMBER_500_10, borderColor: AMBER_500_20};
  }
  return {backgroundColor: RED_500_10, borderColor: RED_500_20};
}

/* ─── code snippet generator (ported verbatim) ────────────────────────────── */

function generateSnippet(
  method: string,
  url: string,
  format: 'curl' | 'javascript' | 'python' | 'go',
  body?: string,
): string {
  const authNote = '# Add auth: -H "X-API-Key: YOUR_KEY" or use session cookies';

  switch (format) {
    case 'curl': {
      const parts = [`curl -X ${method} '${url}'`];
      if (body && method !== 'GET') {
        parts.push(`  -H 'Content-Type: application/json'`);
        parts.push(`  -d '${body}'`);
      }
      return `${authNote}\n${parts.join(' \\\n')}`;
    }
    case 'javascript':
      return `// Auth: include credentials or X-API-Key header
const response = await fetch('${url}', {
  method: '${method}',${
        body && method !== 'GET'
          ? `\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify(${body}),`
          : ''
      }
});
const data = await response.json();`;
    case 'python':
      return `# Auth: pass headers={"X-API-Key": "YOUR_KEY"}
import requests

response = requests.${method.toLowerCase()}('${url}'${
        body && method !== 'GET' ? `, json=${body}` : ''
      })
data = response.json()`;
    case 'go':
      if (method === 'GET') {
        return `// Auth: add X-API-Key header to the request
resp, err := http.Get("${url}")
if err != nil { log.Fatal(err) }
defer resp.Body.Close()`;
      }
      return `// Auth: add X-API-Key header to the request
body := strings.NewReader(\`${body ?? '{}'}\`)
req, _ := http.NewRequest("${method}", "${url}", body)
req.Header.Set("Content-Type", "application/json")
resp, err := http.DefaultClient.Do(req)
if err != nil { log.Fatal(err) }
defer resp.Body.Close()`;
    default:
      return '';
  }
}

/* ── native-safe link/tab button (web ghost Button) ──────────────────────── */

interface LinkButtonProps {
  label: string;
  glyph?: string;
  glyphOpen?: boolean;
  onPress: () => void;
  expanded?: boolean;
  pressed?: boolean;
  active?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

function LinkButton({
  label,
  glyph,
  glyphOpen,
  onPress,
  expanded,
  active,
  testID,
  style,
}: LinkButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{expanded, selected: active}}
      onPress={onPress}
      style={({pressed}) => [styles.linkButton, style, pressed && styles.linkButtonPressed]}
      testID={testID}>
      {glyph != null ? (
        <AppText
          style={[styles.linkGlyph, glyphOpen && styles.linkGlyphOpen]}
          tone="muted">
          {glyph}
        </AppText>
      ) : null}
      <AppText
        style={[styles.linkLabel, active && styles.linkLabelActive]}
        tone={active ? 'primary' : 'muted'}>
        {label}
      </AppText>
    </Pressable>
  );
}

/* ── native-safe copy button (web CopyButton — clipboard unavailable) ────── */

function CopyButton({label, testID}: {label: string; testID?: string}) {
  // The web CopyButton writes `text` to navigator.clipboard and flashes a
  // toast. React Native has no clipboard module wired here, so the press is a
  // documented no-op; see nativeResponseViewerCapabilities.clipboardAvailable.
  const handlePress = () => {
    /* clipboard write unavailable on native */
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: !nativeResponseViewerCapabilities.clipboardAvailable}}
      onPress={handlePress}
      style={({pressed}) => [styles.copyButton, pressed && styles.linkButtonPressed]}
      testID={testID}>
      <AppText style={styles.copyButtonText}>{label}</AppText>
    </Pressable>
  );
}

/* ── native-safe Skeleton + EmptyState (web feedback primitives) ─────────── */

function Skeleton({style, testID}: {style?: StyleProp<ViewStyle>; testID?: string}) {
  return <View style={[styles.skeleton, style]} testID={testID} />;
}

function EmptyState({message, testID}: {message: string; testID?: string}) {
  return (
    <View style={styles.emptyState} testID={testID}>
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ── static FadeIn (web framer-motion entrance -> static native) ─────────── */

function FadeIn({children}: {children: React.ReactNode}) {
  return <View>{children}</View>;
}

/* ── snippet panel ───────────────────────────────────────────────────────── */

export function SnippetPanel({
  method,
  url,
  body,
}: {
  method: string;
  url: string;
  body?: string;
}) {
  const t = useNativeTranslationFallback();
  const [format, setFormat] = useState<'curl' | 'javascript' | 'python' | 'go'>('curl');
  const [open, setOpen] = useState(false);

  const snippet = generateSnippet(method, url, format, body);

  const formats: Array<{value: typeof format; label: string}> = [
    {value: 'curl', label: 'cURL'},
    {value: 'javascript', label: 'JavaScript'},
    {value: 'python', label: 'Python'},
    {value: 'go', label: 'Go'},
  ];

  return (
    <View style={styles.snippetRoot} testID="snippet-panel">
      <LinkButton
        expanded={open}
        glyph={CHEVRON_DOWN}
        glyphOpen={open}
        label={t('playground.codeSnippet', 'Code Snippet')}
        onPress={() => setOpen(o => !o)}
        testID="snippet-panel-toggle"
      />
      {open ? (
        <View style={styles.snippetBody} testID="snippet-panel-body">
          <View style={styles.snippetTabs}>
            {formats.map(f => (
              <LinkButton
                active={format === f.value}
                key={f.value}
                label={f.label}
                onPress={() => setFormat(f.value)}
                style={styles.snippetTab}
                testID={`snippet-format-${f.value}`}
              />
            ))}
            <View style={styles.snippetSpacer} />
            <CopyButton label={t('playground.copy', 'Copy')} testID="snippet-copy" />
          </View>
          <ScrollView horizontal style={styles.snippetPre}>
            <AppText style={styles.snippetText} testID="snippet-pre" tone="secondary">
              {snippet}
            </AppText>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/* ── response headers toggle ─────────────────────────────────────────────── */

function ResponseHeaders({headers}: {headers: Record<string, string>}) {
  const t = useNativeTranslationFallback();
  const [open, setOpen] = useState(false);

  const entries = Object.entries(headers);
  if (entries.length === 0) {
    return null;
  }

  return (
    <View style={styles.headersRoot} testID="response-headers">
      <LinkButton
        expanded={open}
        glyph={CHEVRON_DOWN}
        glyphOpen={open}
        label={`${t('playground.responseHeaders', 'Response Headers')} (${entries.length})`}
        onPress={() => setOpen(o => !o)}
        testID="response-headers-toggle"
      />
      {open ? (
        <ScrollView style={styles.headersList} testID="response-headers-list">
          {entries.map(([k, v]) => (
            <AppText key={k} style={styles.headerLine} tone="muted">
              <AppText style={styles.headerKey} tone="secondary">
                {k}:
              </AppText>{' '}
              {v}
            </AppText>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

/* ── history strip ───────────────────────────────────────────────────────── */

function historyMethodStyle(method: string): StatusBgStyle & {color: string} {
  if (method === 'GET') {
    return {backgroundColor: GREEN_500_20_BG, borderColor: 'transparent', color: GREEN_400};
  }
  if (method === 'POST') {
    return {backgroundColor: BLUE_500_20, borderColor: 'transparent', color: BLUE_400};
  }
  if (method === 'DELETE') {
    return {backgroundColor: RED_500_20, borderColor: 'transparent', color: RED_400};
  }
  return {backgroundColor: AMBER_500_20, borderColor: 'transparent', color: AMBER_400};
}

function RequestHistory({
  history,
  onReplay,
}: {
  history: HistoryEntry[];
  onReplay: (e: HistoryEntry) => void;
}) {
  const t = useNativeTranslationFallback();

  if (history.length === 0) {
    return null;
  }

  return (
    <GlassPanel style={styles.historyPanel} testID="request-history">
      <AppText style={styles.historyTitle} tone="muted" weight="semibold">
        {t('playground.history', 'Recent Requests')}
      </AppText>
      <ScrollView contentContainerStyle={styles.historyRow} horizontal>
        {history.map((h, i) => {
          const m = historyMethodStyle(h.method);
          return (
            <Pressable
              accessibilityHint={`${h.method} ${h.path} → ${h.status} (${h.duration}ms)`}
              accessibilityRole="button"
              key={i}
              onPress={() => onReplay(h)}
              style={({pressed}) => [styles.historyChip, pressed && styles.linkButtonPressed]}
              testID={`request-history-item-${i}`}>
              <View style={[styles.historyMethod, {backgroundColor: m.backgroundColor}]}>
                <AppText style={[styles.historyMethodText, {color: m.color}]}>
                  {h.method}
                </AppText>
              </View>
              <AppText numberOfLines={1} style={styles.historyPath} tone="muted">
                {h.path}
              </AppText>
              <AppText style={[styles.historyStatus, {color: statusColor(h.status)}]}>
                {h.status}
              </AppText>
              <AppText style={styles.historyDuration} tone="muted">
                {h.duration}ms
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </GlassPanel>
  );
}

/* ── main component ──────────────────────────────────────────────────────── */

export default function ResponseViewer({
  response,
  loading,
  history,
  onReplay,
}: ResponseViewerProps) {
  const t = useNativeTranslationFallback();

  return (
    <View style={styles.root} testID="response-viewer">
      {/* Response */}
      <GlassPanel style={styles.responsePanel} testID="response-viewer-panel">
        <AppText style={styles.responseTitle} tone="secondary" weight="semibold">
          {t('playground.response', 'Response')}
        </AppText>

        {loading ? <Skeleton style={styles.responseSkeleton} testID="response-viewer-loading" /> : null}

        {!loading && !response ? (
          <EmptyState
            message={t('playground.noResponse', 'Send a request to see the response')}
            testID="response-viewer-empty"
          />
        ) : null}

        {!loading && response ? (
          <FadeIn>
            {/* Status bar */}
            <View
              style={[styles.statusBar, statusBg(response.status)]}
              testID="response-viewer-status">
              <AppText style={[styles.statusText, {color: statusColor(response.status)}]}>
                {response.status} {response.statusText}
              </AppText>
              <AppText style={styles.statusMeta} tone="muted">
                {response.duration}ms · {formatBytes(response.size)}
              </AppText>
            </View>

            {/* Body */}
            <ScrollView horizontal style={styles.bodyPre}>
              <AppText style={styles.bodyText} testID="response-viewer-body" tone="secondary">
                {(response.contentType ?? '').includes('json') &&
                typeof response.body !== 'string'
                  ? JSON.stringify(response.body, null, 2)
                  : response.bodyText}
              </AppText>
            </ScrollView>

            {/* Response headers */}
            <ResponseHeaders headers={response.headers} />
          </FadeIn>
        ) : null}
      </GlassPanel>

      {/* History */}
      <RequestHistory history={history} onReplay={onReplay} />
    </View>
  );
}

/* Mirror the web's bottom re-export: `export { SnippetPanel, type ApiResponse
 * as ApiResponseType };` — SnippetPanel + ApiResponse are exported inline above,
 * so only the alias is re-stated here. */
export type {ApiResponse as ApiResponseType};

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
  },
  responsePanel: {
    padding: spacing.md,
  },
  responseTitle: {
    fontSize: typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  responseSkeleton: {
    height: 192,
    borderRadius: 12,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  statusText: {
    fontFamily: 'monospace',
    fontSize: typography.body,
    fontWeight: '700',
  },
  statusMeta: {
    fontSize: typography.caption,
  },
  bodyPre: {
    maxHeight: 500,
    backgroundColor: SURFACE_OVERLAY,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER_FAINT,
    padding: spacing.md,
  },
  bodyText: {
    fontFamily: 'monospace',
    fontSize: typography.caption,
  },
  snippetRoot: {
    marginTop: spacing.md,
  },
  snippetBody: {
    marginTop: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER_SUBTLE,
    backgroundColor: SURFACE_OVERLAY,
    overflow: 'hidden',
  },
  snippetTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_FAINT,
  },
  snippetTab: {
    borderRadius: 6,
  },
  snippetSpacer: {
    flex: 1,
  },
  snippetPre: {
    padding: spacing.md,
  },
  snippetText: {
    fontFamily: 'monospace',
    fontSize: 11,
  },
  headersRoot: {
    marginTop: spacing.sm,
  },
  headersList: {
    marginTop: spacing.xs,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER_FAINT,
    backgroundColor: SURFACE_OVERLAY,
    padding: spacing.sm,
    maxHeight: 160,
  },
  headerLine: {
    fontFamily: 'monospace',
    fontSize: 10,
    marginBottom: 2,
  },
  headerKey: {
    fontFamily: 'monospace',
    fontSize: 10,
  },
  historyPanel: {
    padding: spacing.md,
  },
  historyTitle: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  historyRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingBottom: spacing.xs,
  },
  historyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER_FAINT,
    backgroundColor: SURFACE_OVERLAY,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  historyMethod: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  historyMethodText: {
    fontSize: 8,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  historyPath: {
    maxWidth: 120,
    fontFamily: 'monospace',
    fontSize: 10,
  },
  historyStatus: {
    fontWeight: '700',
    fontFamily: 'monospace',
    fontSize: 10,
  },
  historyDuration: {
    fontFamily: 'monospace',
    fontSize: 10,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  linkButtonPressed: {
    opacity: 0.7,
  },
  linkGlyph: {
    fontSize: 12,
    lineHeight: 14,
  },
  linkGlyphOpen: {
    transform: [{rotate: '180deg'}],
  },
  linkLabel: {
    fontSize: 11,
  },
  linkLabelActive: {
    color: colors.textPrimary,
  },
  copyButton: {
    borderRadius: 6,
    backgroundColor: SURFACE_2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  copyButtonText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.accent,
  },
  skeleton: {
    backgroundColor: SURFACE_2,
    borderRadius: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  emptyMessage: {
    fontSize: typography.caption,
    textAlign: 'center',
  },
});
