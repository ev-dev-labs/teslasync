/**
 * Native parity port of
 * web/src/features/admin/components/RequestBuilder.tsx.
 *
 * The web file is the API-Playground request builder: the right-hand panel that
 * accompanies the EndpointSidebar. It shows a method-badge + live `/api/v1{url}`
 * bar with a Send button, a destructive-action confirmation strip (any non-GET
 * method requires a second tap), the endpoint summary/description, and a stack
 * of GlassPanels for editing path parameters, query parameters, the request
 * body, and an optional `X-API-Key` auth header. This native port preserves that
 * contract 1:1 — the same `params` / `body` / `apiKey` / `confirmOpen` state, the
 * same endpoint-change `useEffect` reset (parameter defaults + body example /
 * `{\n  \n}` template / empty), the same `buildUrl` useCallback (path-param
 * substitution + query-string assembly with encodeURIComponent), the same
 * `isDestructive = method !== 'GET'` two-step confirm, the same header assembly
 * (`X-API-Key` only when `apiKey.trim()` is non-empty) and `onSend(buildUrl(),
 * method, body || undefined, headers)` call, and the same conditional panels —
 * using React Native primitives + the existing native GlassPanel / AppText /
 * design tokens.
 *
 * Browser-only / unconverted dependencies are reduced explicitly and documented
 * in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L2/L14): replaced by a native-safe
 *     `t(key, fallback?, vars?)` fallback (the established sibling
 *     EndpointSidebar / MaintenanceBanner precedent) that returns the English
 *     default (else the key) and interpolates i18next-style `{{token}}`
 *     placeholders, so the `playground.confirmDestructive` `{{method}}` message
 *     keeps its i18n intent. Every web key is preserved verbatim.
 *   - lucide-react `Send` / `AlertTriangle` (web L3): rendered as decorative
 *     AppText glyphs (SEND_GLYPH \u27A4, ALERT_GLYPH \u26A0 — the same warning
 *     glyph the sibling ConfirmDialog / MaintenanceBanner ports use) marked
 *     importantForAccessibility="no-hide-descendants" (the aria-hidden analog).
 *   - `@/components/ui` `Button` / `Input` / `Textarea` (web L4): no native
 *     parity port exists yet, so minimal native-safe equivalents are reproduced
 *     locally (the established "reproduce locally when no native parity port
 *     exists" precedent) — an `ActionButton` (Pressable + AppText, primary uses
 *     the native accent token, ghost is a transparent muted link button), a
 *     `NativeInput` (TextInput, `type="password"` -> secureTextEntry), and a
 *     `NativeTextarea` (multiline TextInput, `rows={8}` -> numberOfLines + a
 *     min-height). The web `onChange={e => ...e.target.value}` becomes
 *     `onChangeText`. The web Button's blue-600 primary maps to the native
 *     design-system primary (colors.accent), matching the native AppButton.
 *   - `@/components/ui` `GlassPanel` (web L4): the existing native GlassPanel.
 *   - `MethodBadge` / `ParsedEndpoint` (web L5): imported from the already-ported
 *     native `./EndpointSidebar`. The web `<MethodBadge className="!w-14 ..."/>`
 *     override (a web-only concept) maps to the native badge's `style` prop
 *     (width 56 == w-14).
 *   - The web `<code>` URL bar (overflow-x-auto whitespace-nowrap) becomes a
 *     horizontal ScrollView wrapping a monospace AppText so a long URL still
 *     scrolls horizontally.
 *   - Tailwind colour utilities that cannot apply on native (amber-500/30 etc.,
 *     red-400) are reproduced as literal palette hex/rgba constants, matching the
 *     EndpointSidebar method-colour precedent. Other Tailwind layout classes map
 *     to StyleSheet spacing/typography tokens.
 */
import React, {useCallback, useEffect, useMemo, useState, type ReactNode} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {MethodBadge, type ParsedEndpoint} from './EndpointSidebar';

/* ── props (ported verbatim) ─────────────────────────────────────────────── */

interface RequestBuilderProps {
  endpoint: ParsedEndpoint;
  onSend: (
    url: string,
    method: string,
    body?: string,
    headers?: Record<string, string>,
  ) => void;
  loading: boolean;
}

/* ── native translation fallback (native-safe port of react-i18next) ─────── */

type NativeTFunction = (
  key: string,
  fallback?: string,
  vars?: Record<string, string | number>,
) => string;

/**
 * Mirrors `t(key, default?, vars?)`: returns the English default (else the key)
 * and interpolates i18next-style `{{token}}` placeholders, preserving i18n
 * intent for the `{{method}}` confirmation message.
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key, fallback, vars) => {
      const template = fallback ?? key;
      if (!vars) {
        return template;
      }
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        Object.prototype.hasOwnProperty.call(vars, name)
          ? String(vars[name])
          : `{{${name}}}`,
      );
    },
    [],
  );
}

/* ── decorative glyph stand-ins for the lucide-react icons ───────────────── */

const SEND_GLYPH = '\u27A4'; // ➤ (lucide Send)
const ALERT_GLYPH = '\u26A0'; // ⚠ (lucide AlertTriangle)

/* ── Tailwind palette literals that cannot apply on native ───────────────── */

const RED_400 = '#f87171';
const AMBER_400 = '#fbbf24';
const AMBER_300 = '#fcd34d';
const AMBER_BORDER = 'rgba(245, 158, 11, 0.3)'; // amber-500/30
const AMBER_SURFACE = 'rgba(245, 158, 11, 0.1)'; // amber-500/10
const SURFACE_CODE = 'rgba(255, 255, 255, 0.05)'; // --surface-2 analog
const INPUT_BG = 'rgba(255, 255, 255, 0.04)'; // --surface-1 analog
const METHOD_BADGE_WIDTH = 56; // web `!w-14`

/* ── native Button stand-in (`@/components/ui` Button) ───────────────────── */

interface ActionButtonProps {
  label: string;
  onPress: () => void;
  glyph?: string;
  variant?: 'primary' | 'ghost';
  size?: 'md' | 'sm';
  disabled?: boolean;
  testID?: string;
}

function ActionButton({
  label,
  onPress,
  glyph,
  variant = 'primary',
  size = 'md',
  disabled = false,
  testID,
}: ActionButtonProps) {
  const isGhost = variant === 'ghost';
  const textStyle = isGhost ? styles.actionGhostText : styles.actionPrimaryText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.actionBase,
        size === 'sm' ? styles.actionSm : styles.actionMd,
        isGhost ? styles.actionGhost : styles.actionPrimary,
        disabled && styles.actionDisabled,
        pressed && !disabled && styles.actionPressed,
      ]}
      testID={testID}>
      {glyph ? (
        <AppText
          importantForAccessibility="no-hide-descendants"
          style={[styles.actionGlyph, textStyle]}>
          {glyph}
        </AppText>
      ) : null}
      <AppText
        style={[size === 'sm' ? styles.actionTextSm : styles.actionTextMd, textStyle]}
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ── native Input stand-in (`@/components/ui` Input) ─────────────────────── */

interface NativeInputProps {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  testID?: string;
}

function NativeInput({
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  testID,
}: NativeInputProps) {
  return (
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      secureTextEntry={secureTextEntry}
      style={styles.input}
      testID={testID}
      value={value}
    />
  );
}

/* ── native Textarea stand-in (`@/components/ui` Textarea) ───────────────── */

interface NativeTextareaProps {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  rows?: number;
  testID?: string;
}

function NativeTextarea({
  value,
  onChangeText,
  placeholder,
  rows = 8,
  testID,
}: NativeTextareaProps) {
  return (
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      multiline
      numberOfLines={rows}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      style={styles.textarea}
      testID={testID}
      textAlignVertical="top"
      value={value}
    />
  );
}

/* ── shared field label (web `label` w-28 font-mono text-xs text-muted) ──── */

function FieldLabel({children}: {children: ReactNode}) {
  return (
    <AppText style={styles.fieldLabel} tone="muted">
      {children}
    </AppText>
  );
}

/* ── shared panel heading (web `h4` uppercase tracking-wider text-muted) ──── */

function SectionHeading({children}: {children: ReactNode}) {
  return (
    <AppText style={styles.sectionHeading} tone="muted" weight="semibold">
      {children}
    </AppText>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   RequestBuilder — endpoint request editor + sender
   ═══════════════════════════════════════════════════════════════════════ */

export default function RequestBuilder({
  endpoint,
  onSend,
  loading,
}: RequestBuilderProps) {
  const t = useNativeTranslationFallback();
  const [params, setParams] = useState<Record<string, string>>({});
  const [body, setBody] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Reset state when endpoint changes
  useEffect(() => {
    const defaults: Record<string, string> = {};
    endpoint.parameters.forEach(p => {
      if (p.default != null) {
        defaults[p.name] = String(p.default);
      }
    });
    setParams(defaults);
    setConfirmOpen(false);

    if (endpoint.requestBody?.example) {
      setBody(JSON.stringify(endpoint.requestBody.example, null, 2));
    } else if (endpoint.requestBody) {
      setBody('{\n  \n}');
    } else {
      setBody('');
    }
  }, [endpoint]);

  // Build final URL with path and query params
  const buildUrl = useCallback(() => {
    let url = endpoint.path;
    endpoint.parameters
      .filter(p => p.in === 'path')
      .forEach(p => {
        url = url.replace(`{${p.name}}`, params[p.name] || `{${p.name}}`);
      });

    const queryParts = endpoint.parameters
      .filter(p => p.in === 'query' && params[p.name])
      .map(p => `${p.name}=${encodeURIComponent(params[p.name])}`);

    return queryParts.length > 0 ? `${url}?${queryParts.join('&')}` : url;
  }, [endpoint, params]);

  const isDestructive = endpoint.method !== 'GET';

  const handleSend = () => {
    if (isDestructive && !confirmOpen) {
      setConfirmOpen(true);
      return;
    }
    setConfirmOpen(false);
    const headers: Record<string, string> = {};
    if (apiKey.trim()) {
      headers['X-API-Key'] = apiKey.trim();
    }
    onSend(buildUrl(), endpoint.method, body || undefined, headers);
  };

  const handleCancel = () => setConfirmOpen(false);

  const pathParams = endpoint.parameters.filter(p => p.in === 'path');
  const queryParams = endpoint.parameters.filter(p => p.in === 'query');

  return (
    <View style={styles.container} testID="request-builder">
      {/* URL bar */}
      <View style={styles.urlBar}>
        <MethodBadge method={endpoint.method} style={styles.urlMethodBadge} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.urlCode}
          contentContainerStyle={styles.urlCodeContent}>
          <AppText style={styles.urlCodeText} testID="request-builder-url">
            /api/v1{buildUrl()}
          </AppText>
        </ScrollView>
        <ActionButton
          glyph={SEND_GLYPH}
          disabled={loading}
          label={
            loading
              ? t('playground.sending', 'Sending...')
              : t('playground.send', 'Send')
          }
          onPress={handleSend}
          testID="request-builder-send"
        />
      </View>

      {/* Destructive action confirmation */}
      {confirmOpen ? (
        <View style={styles.confirmBar} testID="request-builder-confirm">
          <AppText
            importantForAccessibility="no-hide-descendants"
            style={styles.confirmIcon}>
            {ALERT_GLYPH}
          </AppText>
          <AppText style={styles.confirmText}>
            {t(
              'playground.confirmDestructive',
              'This is a {{method}} request. Are you sure you want to send it?',
              {method: endpoint.method},
            )}
          </AppText>
          <ActionButton
            label={t('playground.confirmYes', 'Yes, send')}
            onPress={handleSend}
            size="sm"
            testID="request-builder-confirm-yes"
          />
          <ActionButton
            label={t('playground.cancel', 'Cancel')}
            onPress={handleCancel}
            size="sm"
            testID="request-builder-confirm-cancel"
            variant="ghost"
          />
        </View>
      ) : null}

      {/* Summary & description */}
      {endpoint.summary ? (
        <AppText
          style={styles.summary}
          testID="request-builder-summary"
          tone="secondary">
          {endpoint.summary}
        </AppText>
      ) : null}
      {endpoint.description && endpoint.description !== endpoint.summary ? (
        <AppText
          style={styles.description}
          testID="request-builder-description"
          tone="muted">
          {endpoint.description}
        </AppText>
      ) : null}

      {/* Path parameters */}
      {pathParams.length > 0 ? (
        <GlassPanel style={styles.panel} testID="request-builder-path-params">
          <SectionHeading>
            {t('playground.pathParams', 'Path Parameters')}
          </SectionHeading>
          {pathParams.map(p => (
            <View key={p.name} style={styles.fieldRow}>
              <FieldLabel>
                {p.name} <AppText style={styles.requiredStar}>*</AppText>
              </FieldLabel>
              <NativeInput
                onChangeText={next =>
                  setParams(prev => ({...prev, [p.name]: next}))
                }
                placeholder={p.description || p.type}
                testID={`request-builder-path-input-${p.name}`}
                value={params[p.name] ?? ''}
              />
            </View>
          ))}
        </GlassPanel>
      ) : null}

      {/* Query parameters */}
      {queryParams.length > 0 ? (
        <GlassPanel style={styles.panel} testID="request-builder-query-params">
          <SectionHeading>
            {t('playground.queryParams', 'Query Parameters')}
          </SectionHeading>
          {queryParams.map(p => (
            <View key={p.name} style={styles.fieldRow}>
              <FieldLabel>
                {p.name}
                {p.required ? (
                  <AppText style={styles.requiredStarSpaced}>*</AppText>
                ) : null}
              </FieldLabel>
              <NativeInput
                onChangeText={next =>
                  setParams(prev => ({...prev, [p.name]: next}))
                }
                placeholder={
                  p.description ||
                  `${p.type}${p.default != null ? ` (default: ${p.default})` : ''}`
                }
                testID={`request-builder-query-input-${p.name}`}
                value={params[p.name] ?? ''}
              />
            </View>
          ))}
        </GlassPanel>
      ) : null}

      {/* Request body */}
      {endpoint.requestBody ? (
        <GlassPanel style={styles.panel} testID="request-builder-body">
          <SectionHeading>
            {t('playground.requestBody', 'Request Body')}
            <AppText style={styles.contentType} tone="muted">
              {'  '}
              {endpoint.requestBody.contentType}
            </AppText>
          </SectionHeading>
          <NativeTextarea
            onChangeText={setBody}
            placeholder={'{ "key": "value" }'}
            rows={8}
            testID="request-builder-body-input"
            value={body}
          />
        </GlassPanel>
      ) : null}

      {/* API Key header (optional) */}
      <GlassPanel style={styles.panel} testID="request-builder-auth">
        <SectionHeading>
          {t('playground.authHeader', 'Authentication (Optional)')}
        </SectionHeading>
        <View style={styles.fieldRow}>
          <FieldLabel>X-API-Key</FieldLabel>
          <NativeInput
            onChangeText={setApiKey}
            placeholder={t(
              'playground.apiKeyPlaceholder',
              'Leave empty to use session auth',
            )}
            secureTextEntry
            testID="request-builder-apikey"
            value={apiKey}
          />
        </View>
        <AppText
          style={styles.authHint}
          testID="request-builder-auth-hint"
          tone="muted">
          {t(
            'playground.authHint',
            'Requests use your browser session by default. Enter an API key to test key-based auth.',
          )}
        </AppText>
      </GlassPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16, // web space-y-4
  },
  urlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm, // gap-2
  },
  urlMethodBadge: {
    width: METHOD_BADGE_WIDTH,
    paddingVertical: 4,
  },
  urlCode: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: SURFACE_CODE,
  },
  urlCodeContent: {
    alignItems: 'center',
    paddingHorizontal: spacing.md, // px-3
    paddingVertical: spacing.sm, // py-2
  },
  urlCodeText: {
    fontFamily: 'monospace',
    fontSize: 14, // text-sm
    color: colors.textPrimary,
  },
  actionBase: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    flexShrink: 0,
  },
  actionMd: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  actionSm: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  actionPrimary: {
    backgroundColor: colors.accent,
  },
  actionGhost: {
    backgroundColor: 'transparent',
  },
  actionDisabled: {
    opacity: 0.5,
  },
  actionPressed: {
    opacity: 0.82,
  },
  actionGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
  actionTextMd: {
    fontSize: 14,
  },
  actionTextSm: {
    fontSize: typography.caption,
  },
  actionPrimaryText: {
    color: colors.background,
  },
  actionGhostText: {
    color: colors.textMuted,
  },
  confirmBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md, // gap-3
    borderRadius: 10,
    borderWidth: 1,
    borderColor: AMBER_BORDER,
    backgroundColor: AMBER_SURFACE,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  confirmIcon: {
    fontSize: 16,
    lineHeight: 20,
    color: AMBER_400,
  },
  confirmText: {
    flex: 1,
    fontSize: typography.caption,
    lineHeight: 18,
    color: AMBER_300,
  },
  summary: {
    fontSize: 14, // text-sm
    lineHeight: 20,
  },
  description: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  panel: {
    padding: 16, // p-4
    gap: spacing.md, // space-y-3
  },
  sectionHeading: {
    fontSize: typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  contentType: {
    fontSize: typography.caption,
    fontWeight: '400',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md, // gap-3
  },
  fieldLabel: {
    width: 112, // w-28
    fontFamily: 'monospace',
    fontSize: typography.caption,
  },
  requiredStar: {
    color: RED_400,
  },
  requiredStarSpaced: {
    color: RED_400,
    marginLeft: 2,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: INPUT_BG,
    paddingHorizontal: spacing.md,
    paddingVertical: 6, // py-1.5
    fontFamily: 'monospace',
    fontSize: typography.caption,
    color: colors.textPrimary,
  },
  textarea: {
    minHeight: 160, // rows={8}
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: INPUT_BG,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: 'monospace',
    fontSize: typography.caption,
    color: colors.textPrimary,
  },
  authHint: {
    fontSize: 10, // text-[10px]
    lineHeight: 14,
  },
});
