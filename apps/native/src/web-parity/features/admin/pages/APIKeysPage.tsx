// Native parity port of web/src/features/admin/pages/APIKeysPage.tsx.
//
// ApiKeysPage — manage API keys for programmatic access to TeslaSync: create,
// revoke, and delete keys with read / read-write / admin permission levels.
//
// The web original composes the shared DOM page kit (PageContainer, GlassPanel,
// Badge, Button, CopyButton, MaskedValue, Input, Select, Modal, ConfirmDialog,
// EmptyState, Skeleton, StaggerContainer/StaggerItem), lucide SVG icons, the
// `@/lib/cn` Tailwind merge, `usePageTitle`, `@/lib/dateFormat.formatDate`,
// react-i18next, and the admin TanStack-Query hooks. React Native has no DOM,
// no Tailwind, no lucide SVGs, no framer-motion, no wired react-i18next, and no
// browser `document.title`, so this port reproduces the same behaviour with RN
// primitives + the established native parity building blocks:
//
//   - PageContainer (title/subtitle/actions + a loading gate that swaps the body
//     for a centered spinner) -> an inline scaffold: a persistent header row
//     (title, subtitle, "Create Key" action) plus a body that, exactly like the
//     web PageContainer, only renders the children (modal + list + confirm) when
//     `loading` is false; while loading it shows a centered ActivityIndicator.
//   - usePageTitle(t('API Keys')) sets the browser tab title, which has no native
//     analogue; the same translated string is surfaced as the on-screen page
//     header instead (documented in the sidecar).
//   - GlassPanel -> the shared native GlassPanel.
//   - Badge variant="danger" (Expired) -> an inline danger pill.
//   - Button (primary/secondary/ghost, sm/md, lucide icon, loading, disabled) ->
//     native Pressable buttons preserving every variant/size/disabled/loading
//     state; the lucide Plus/XCircle/Trash2 icons become text glyphs.
//   - CopyButton (secondary, iconOnly, withToast) -> an inline copy Pressable
//     that uses the same native-safe clipboard strategy as MaskedValue; the
//     withToast confirmation is reproduced inline by a "copied" glyph swap.
//   - MaskedValue (token, copyable, auditOnReveal) -> the shared native
//     MaskedValue parity component, props preserved verbatim.
//   - Input -> a labelled TextInput; Select -> a labelled segmented pill group
//     (the established native single-choice control from FeedbackModal), both
//     preserving the value/onChange contract.
//   - Modal -> RN Modal (transparent fade) with a backdrop + dialog, matching the
//     native ConfirmDialog/FeedbackModal overlay treatment.
//   - ConfirmDialog (danger) -> an inline RN Modal confirm dialog preserving the
//     "{{name}}" interpolation and confirm/cancel gating.
//   - EmptyState -> the shared native EmptyState, with a leading SemanticIcon
//     "key" reproducing the web Key icon (the native EmptyState has no icon slot).
//   - Skeleton x3 -> inline placeholder bars (only reachable in the web's dead
//     inner `isLoading ?` branch; preserved verbatim under the same loading gate).
//   - StaggerContainer/StaggerItem (framer-motion) -> a plain gapped View list.
//   - lib/cn opacity-50 on expired rows -> a static opacity style.
//   - formatDate is inlined faithfully from @/lib/dateFormat (— fallback +
//     toLocaleDateString year/short-month/day) since native has no dateFormat.
//   - react-i18next useTranslation -> a native key/English-default `t` fallback
//     that preserves every t('English string') key verbatim and applies the same
//     {{name}} interpolation as the web `t`.
//
// State names (showCreate, newName, newPerm, generatedKey, deleteTarget), the
// isExpired predicate, every API path (via the unchanged useAdmin hooks), and the
// data.key / k.id / k.permissions / k.keyPrefix / k.createdAt / k.lastUsedAt /
// k.expiresAt field reads are preserved verbatim. No DOM, Recharts, Leaflet,
// framer-motion, lucide-react, or old web UI components are imported.

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, shadows, spacing} from '../../../../theme/tokens';
import {
  useApiKeys,
  useCreateApiKey,
  useDeleteApiKey,
  useRevokeApiKey,
  type APIKey,
} from '../../../api/hooks/useAdmin';
import {MaskedValue} from '../../../components/ui/MaskedValue';

/* ─── i18n fallback ───────────────────────────────────────────────────── */

type TVars = Record<string, string | number | null | undefined>;
type TFunc = (key: string, vars?: TVars) => string;

// react-i18next is not wired in native. The web page uses the English copy as
// the i18n key (e.g. t('API Keys')), and i18next echoes a missing key back, so
// this fallback returns the key and applies the same {{var}} interpolation the
// web `t` performs (used by the delete-confirmation "{{name}}" message).
function useT(): TFunc {
  return useCallback((key: string, vars?: TVars) => {
    if (!vars) {
      return key;
    }
    let out = key;
    for (const varKey of Object.keys(vars)) {
      const value = vars[varKey];
      out = out.split(`{{${varKey}}}`).join(value == null ? '' : String(value));
    }
    return out;
  }, []);
}

/* ─── Inlined formatter (web @/lib/dateFormat.formatDate) ─────────────── */

const FALLBACK = '\u2014'; // — universal missing-value placeholder

// web formatDate — "Apr 4, 2026" in the browser locale/timezone, — on nullish
// or unparseable input. Native has no @/lib/dateFormat module yet.
function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/* ─── Constants ───────────────────────────────────────────────────────── */

const MONO_FONT = Platform.select({ios: 'Menlo', default: 'monospace'});

const PLUS_GLYPH = '+'; // lucide Plus
const REVOKE_GLYPH = '\u2298'; // ⊘ — lucide XCircle (revoke)
const DELETE_GLYPH = '\u2715'; // ✕ — lucide Trash2 (delete)
const EXPIRED_GLYPH = '\u2715'; // ✕ — lucide XCircle inside the Expired badge
const COPY_GLYPH = '\u29C9'; // ⧉ — lucide Copy
const COPIED_GLYPH = '\u2713'; // ✓ — copied confirmation (withToast parity)

// Permission -> {glyph, colour, labelKey}, preserving the web PermissionBadge
// hex map verbatim (read #10b981 Shield / read-write #f59e0b ShieldAlert /
// admin #a855f7 Crown). Glyphs follow the SemanticIcon 2-letter vocabulary.
const PERMISSION_CONFIG: Record<
  string,
  {glyph: string; color: string; labelKey: string}
> = {
  read: {glyph: 'SH', color: '#10b981', labelKey: 'Read'},
  'read-write': {glyph: 'SA', color: '#f59e0b', labelKey: 'Read-Write'},
  admin: {glyph: 'CR', color: '#a855f7', labelKey: 'Admin'},
};

// bg-neon-cyan/5 + text-neon-cyan boxed Key icon on each row.
const KEY_ICON_COLOR = colors.accent;

/* ─── Native-safe clipboard (shared with MaskedValue's strategy) ──────── */

type CopyState = 'idle' | 'copied' | 'unavailable';

// Uses navigator.clipboard.writeText when present (react-native-web); on
// iOS/Android (no bundled clipboard module yet) reports "unavailable" so the
// CopyButton surfaces an explicit degraded state rather than silently succeeding.
async function writeClipboard(text: string): Promise<CopyState> {
  const nav = (
    globalThis as unknown as {
      navigator?: {clipboard?: {writeText?: (value: string) => Promise<void>}};
    }
  ).navigator;
  const clipboard = nav?.clipboard;
  if (clipboard == null || typeof clipboard.writeText !== 'function') {
    return 'unavailable';
  }
  try {
    await clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'idle';
  }
}

/* ─── PermissionBadge ─────────────────────────────────────────────────── */

function PermissionBadge({perm, t}: {perm: string; t: TFunc}) {
  const c = PERMISSION_CONFIG[perm] ?? PERMISSION_CONFIG.read;
  return (
    <View
      style={[
        styles.permBadge,
        {backgroundColor: `${c.color}15`},
      ]}
      testID={`api-key-permission-${perm}`}>
      <AppText style={[styles.permGlyph, {color: c.color}]}>{c.glyph}</AppText>
      <AppText style={[styles.permLabel, {color: c.color}]}>
        {t(c.labelKey)}
      </AppText>
    </View>
  );
}

/* ─── ExpiredBadge (web Badge variant="danger") ───────────────────────── */

function ExpiredBadge({t}: {t: TFunc}) {
  return (
    <View style={styles.expiredBadge} testID="api-key-expired-badge">
      <AppText style={styles.expiredGlyph}>{EXPIRED_GLYPH}</AppText>
      <AppText style={styles.expiredLabel}>{t('Expired')}</AppText>
    </View>
  );
}

/* ─── TextButton (web Button primary/secondary) ───────────────────────── */

interface TextButtonProps {
  label: string;
  onPress: () => void;
  variant: 'primary' | 'secondary';
  glyph?: string;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}

function TextButton({
  label,
  onPress,
  variant,
  glyph,
  disabled = false,
  loading = false,
  testID,
}: TextButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{busy: loading, disabled: isDisabled}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.textButton,
        variant === 'primary' ? styles.primaryButton : styles.secondaryButton,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colors.background : colors.textPrimary}
        />
      ) : (
        <>
          {glyph ? (
            <AppText
              style={[
                styles.textButtonGlyph,
                variant === 'primary'
                  ? styles.primaryButtonText
                  : styles.secondaryButtonText,
              ]}>
              {glyph}
            </AppText>
          ) : null}
          <AppText
            weight="semibold"
            style={
              variant === 'primary'
                ? styles.primaryButtonText
                : styles.secondaryButtonText
            }>
            {label}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

/* ─── IconGhostButton (web Button variant="ghost" iconOnly) ───────────── */

function IconGhostButton({
  glyph,
  label,
  onPress,
  tone,
  testID,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  tone: 'warning' | 'danger';
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [styles.iconGhost, pressed && styles.buttonPressed]}
      testID={testID}>
      <AppText
        style={[
          styles.iconGhostGlyph,
          tone === 'warning' ? styles.iconGhostWarning : styles.iconGhostDanger,
        ]}>
        {glyph}
      </AppText>
    </Pressable>
  );
}

/* ─── CopyKeyButton (web CopyButton secondary iconOnly withToast) ─────── */

function CopyKeyButton({value, label}: {value: string; label: string}) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const handleCopy = useCallback(async () => {
    const outcome = await writeClipboard(value);
    setCopyState(outcome);
    clearTimer();
    timerRef.current = setTimeout(() => {
      setCopyState('idle');
      timerRef.current = null;
    }, 2_000);
  }, [value, clearTimer]);

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityRole="button"
      onPress={handleCopy}
      style={({pressed}) => [
        styles.copyButton,
        pressed && styles.buttonPressed,
      ]}
      testID="api-key-copy-button">
      <AppText
        style={[
          styles.copyGlyph,
          copyState === 'copied' && styles.copyGlyphCopied,
          copyState === 'unavailable' && styles.copyGlyphUnavailable,
        ]}>
        {copyState === 'copied' ? COPIED_GLYPH : COPY_GLYPH}
      </AppText>
    </Pressable>
  );
}

/* ─── LabelledField + PermissionSelect (web Input / Select) ───────────── */

function FieldLabel({children}: {children: string}) {
  return (
    <AppText style={styles.fieldLabel} variant="caption" weight="semibold">
      {children}
    </AppText>
  );
}

function PermissionSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: {value: string; label: string}[];
}) {
  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      <View
        accessibilityLabel={label}
        accessibilityRole="radiogroup"
        style={styles.segmented}>
        {options.map(opt => {
          const selected = value === opt.value;
          return (
            <Pressable
              accessibilityLabel={opt.label}
              accessibilityRole="radio"
              accessibilityState={{selected}}
              key={opt.value}
              onPress={() => onChange(opt.value)}
              style={({pressed}) => [
                styles.segmentOption,
                selected && styles.segmentOptionSelected,
                pressed && styles.buttonPressed,
              ]}
              testID={`api-key-perm-option-${opt.value}`}>
              <AppText
                style={
                  selected
                    ? styles.segmentOptionTextSelected
                    : styles.segmentOptionText
                }
                weight="semibold">
                {opt.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ─── KeyRow ──────────────────────────────────────────────────────────── */

function KeyRow({
  apiKey,
  expired,
  t,
  onRevoke,
  onDelete,
}: {
  apiKey: APIKey;
  expired: boolean;
  t: TFunc;
  onRevoke: () => void;
  onDelete: () => void;
}) {
  return (
    <GlassPanel
      style={[styles.keyRow, expired && styles.keyRowExpired]}
      testID={`api-key-row-${apiKey.id}`}>
      <View style={styles.keyRowInner}>
        <View style={styles.keyIconBox}>
          <AppText style={styles.keyIconGlyph}>KY</AppText>
        </View>
        <View style={styles.keyRowMain}>
          <View style={styles.keyTitleRow}>
            <AppText
              numberOfLines={1}
              style={styles.keyName}
              weight="semibold">
              {apiKey.name}
            </AppText>
            <PermissionBadge perm={apiKey.permissions} t={t} />
            {expired ? <ExpiredBadge t={t} /> : null}
          </View>
          <View style={styles.keyMetaRow}>
            <AppText style={styles.keyPrefix}>{apiKey.keyPrefix}</AppText>
            <AppText style={styles.keyMeta} tone="muted">
              {t('Created')} {formatDate(apiKey.createdAt)}
            </AppText>
            {apiKey.lastUsedAt ? (
              <AppText style={styles.keyMeta} tone="muted">
                {t('Last used')} {formatDate(apiKey.lastUsedAt)}
              </AppText>
            ) : null}
          </View>
        </View>
        <View style={styles.keyActions}>
          {!expired ? (
            <IconGhostButton
              glyph={REVOKE_GLYPH}
              label={t('Revoke')}
              onPress={onRevoke}
              testID={`api-key-revoke-${apiKey.id}`}
              tone="warning"
            />
          ) : null}
          <IconGhostButton
            glyph={DELETE_GLYPH}
            label={t('Delete')}
            onPress={onDelete}
            testID={`api-key-delete-${apiKey.id}`}
            tone="danger"
          />
        </View>
      </View>
    </GlassPanel>
  );
}

/* ─── Modal shell ─────────────────────────────────────────────────────── */

function ModalShell({
  open,
  onClose,
  title,
  children,
  testID,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View style={styles.dialog} testID={testID}>
          <AppText style={styles.dialogTitle} variant="title" weight="bold">
            {title}
          </AppText>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/* ─── Page component ──────────────────────────────────────────────────── */

export default function APIKeysPage() {
  const t = useT();

  const {data: keys, isLoading} = useApiKeys();
  const createMut = useCreateApiKey();
  const deleteMut = useDeleteApiKey();
  const revokeMut = useRevokeApiKey();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPerm, setNewPerm] = useState('read');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<APIKey | null>(null);

  const isExpired = useCallback(
    (k: APIKey) => Boolean(k.expiresAt && new Date(k.expiresAt) < new Date()),
    [],
  );

  const closeCreate = useCallback(() => {
    setShowCreate(false);
    setGeneratedKey(null);
  }, []);

  const openCreate = useCallback(() => {
    setShowCreate(true);
    setGeneratedKey(null);
  }, []);

  const permissionOptions = useMemo(
    () => [
      {value: 'read', label: t('Read')},
      {value: 'read-write', label: t('Read-Write')},
      {value: 'admin', label: t('Admin')},
    ],
    [t],
  );

  const keyList = keys ?? [];

  return (
    <View style={styles.page} testID="api-keys-page">
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        style={styles.scroll}>
        {/* ── Header (PageContainer title/subtitle/actions) ── */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <AppText accessibilityRole="header" style={styles.pageTitle}>
              {t('API Keys')}
            </AppText>
            <AppText style={styles.pageSubtitle} tone="muted">
              {t('Manage programmatic access to TeslaSync')}
            </AppText>
          </View>
          <TextButton
            glyph={PLUS_GLYPH}
            label={t('Create Key')}
            onPress={openCreate}
            testID="api-keys-create-button"
            variant="primary"
          />
        </View>

        {/* ── Body: PageContainer renders children only when not loading ── */}
        {isLoading ? (
          <View style={styles.loading} testID="api-keys-loading">
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : (
          <View style={styles.body}>
            {/* ── Keys list / skeleton / empty ── */}
            {isLoading ? (
              <View style={styles.list}>
                {[1, 2, 3].map(i => (
                  <View key={i} style={styles.skeleton} />
                ))}
              </View>
            ) : keyList.length > 0 ? (
              <View style={styles.list} testID="api-keys-list">
                {keyList.map(k => (
                  <KeyRow
                    apiKey={k}
                    expired={isExpired(k)}
                    key={k.id}
                    onDelete={() => setDeleteTarget(k)}
                    onRevoke={() => revokeMut.mutate(k.id)}
                    t={t}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.emptyWrap} testID="api-keys-empty">
                {/* no-action: transient empty state — surfaces when source data
                    is missing; no specific recovery action available. */}
                <SemanticIcon decorative name="key" size="lg" />
                <EmptyState
                  message={t(
                    'Create an API key to enable programmatic access to TeslaSync data and controls.',
                  )}
                  title={t('No API keys')}
                />
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* ── Create Modal ── */}
      <ModalShell
        onClose={closeCreate}
        open={showCreate}
        testID="api-key-create-modal"
        title={generatedKey ? t('API Key Created') : t('New API Key')}>
        {generatedKey ? (
          <View style={styles.modalSection} testID="api-key-generated">
            <AppText style={styles.generatedHint} tone="muted">
              {t("Copy this key now — it won't be shown again.")}
            </AppText>
            <View style={styles.generatedRow}>
              <GlassPanel style={styles.generatedPanel}>
                <MaskedValue
                  ariaLabel={t('API key, click to reveal')}
                  auditOnReveal
                  copyable
                  value={generatedKey}
                  variant="token"
                />
              </GlassPanel>
              <CopyKeyButton label={t('Copy API key')} value={generatedKey} />
            </View>
            <View style={styles.modalActions}>
              <TextButton
                label={t('Done')}
                onPress={closeCreate}
                testID="api-key-done-button"
                variant="secondary"
              />
            </View>
          </View>
        ) : (
          <View style={styles.modalSection}>
            <View style={styles.field}>
              <FieldLabel>{t('Name')}</FieldLabel>
              <TextInput
                accessibilityLabel={t('Name')}
                onChangeText={setNewName}
                placeholder={t('My Application')}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                testID="api-key-name-input"
                value={newName}
              />
            </View>
            <PermissionSelect
              label={t('Permissions')}
              onChange={setNewPerm}
              options={permissionOptions}
              value={newPerm}
            />
            <View style={styles.modalActions}>
              <TextButton
                disabled={!newName.trim()}
                glyph={PLUS_GLYPH}
                label={t('Generate Key')}
                loading={createMut.isPending}
                onPress={() =>
                  createMut.mutate(
                    {name: newName, permissions: newPerm},
                    {
                      onSuccess: data => {
                        setGeneratedKey(data.key);
                        setNewName('');
                      },
                    },
                  )
                }
                testID="api-key-generate-button"
                variant="primary"
              />
              <TextButton
                label={t('Cancel')}
                onPress={() => setShowCreate(false)}
                testID="api-key-cancel-button"
                variant="secondary"
              />
            </View>
          </View>
        )}
      </ModalShell>

      {/* ── Delete confirmation ── */}
      <ModalShell
        onClose={() => setDeleteTarget(null)}
        open={deleteTarget !== null}
        testID="api-key-delete-dialog"
        title={t('Delete API Key')}>
        <View style={styles.modalSection}>
          <AppText style={styles.confirmMessage} tone="secondary">
            {t('Are you sure you want to permanently delete the key "{{name}}"?', {
              name: deleteTarget?.name,
            })}
          </AppText>
          <View style={styles.modalActions}>
            <Pressable
              accessibilityLabel={t('Delete')}
              accessibilityRole="button"
              onPress={() =>
                deleteTarget &&
                deleteMut.mutate(deleteTarget.id, {
                  onSuccess: () => setDeleteTarget(null),
                })
              }
              style={({pressed}) => [
                styles.textButton,
                styles.dangerButton,
                pressed && styles.buttonPressed,
              ]}
              testID="api-key-confirm-delete-button">
              <AppText style={styles.dangerButtonText} weight="semibold">
                {t('Delete')}
              </AppText>
            </Pressable>
            <TextButton
              label={t('Cancel')}
              onPress={() => setDeleteTarget(null)}
              testID="api-key-cancel-delete-button"
              variant="secondary"
            />
          </View>
        </View>
      </ModalShell>
    </View>
  );
}

APIKeysPage.displayName = 'APIKeysPage';

/* ─── Styles ──────────────────────────────────────────────────────────── */

const dialogShadow = shadows.panel as StyleProp<ViewStyle>;

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    rowGap: spacing.xl,
  },
  header: {
    alignItems: 'flex-start',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 200,
    rowGap: spacing.xs,
  },
  pageTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  pageSubtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  body: {
    rowGap: spacing.md,
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl + spacing.xl,
  },
  list: {
    rowGap: spacing.md,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
    height: 80,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    rowGap: spacing.sm,
  },
  /* ── Key row ── */
  keyRow: {
    padding: spacing.md + 2,
  },
  keyRowExpired: {
    opacity: 0.5,
  },
  keyRowInner: {
    alignItems: 'center',
    columnGap: spacing.md,
    flexDirection: 'row',
  },
  keyIconBox: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 14,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  keyIconGlyph: {
    color: KEY_ICON_COLOR,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  keyRowMain: {
    flex: 1,
    rowGap: spacing.xs,
  },
  keyTitleRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
  keyName: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  keyMetaRow: {
    alignItems: 'center',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 2,
  },
  keyPrefix: {
    color: colors.textMuted,
    fontFamily: MONO_FONT,
    fontSize: 11,
    lineHeight: 15,
  },
  keyMeta: {
    fontSize: 11,
    lineHeight: 15,
  },
  keyActions: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  /* ── Permission badge ── */
  permBadge: {
    alignItems: 'center',
    borderRadius: 999,
    columnGap: 4,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  permGlyph: {
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 12,
  },
  permLabel: {
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 13,
  },
  /* ── Expired badge ── */
  expiredBadge: {
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 999,
    borderWidth: 1,
    columnGap: 3,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  expiredGlyph: {
    color: colors.danger,
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 12,
  },
  expiredLabel: {
    color: colors.danger,
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 13,
  },
  /* ── Buttons ── */
  textButton: {
    alignItems: 'center',
    borderRadius: 12,
    columnGap: spacing.xs,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  secondaryButton: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderWidth: 1,
  },
  dangerButton: {
    backgroundColor: colors.danger,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  textButtonGlyph: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 18,
  },
  primaryButtonText: {
    color: colors.background,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
  },
  dangerButtonText: {
    color: colors.background,
  },
  iconGhost: {
    alignItems: 'center',
    borderRadius: 10,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  iconGhostGlyph: {
    fontSize: 16,
    lineHeight: 20,
  },
  iconGhostWarning: {
    color: colors.warning,
  },
  iconGhostDanger: {
    color: colors.danger,
  },
  copyButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  copyGlyph: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 22,
  },
  copyGlyphCopied: {
    color: colors.accent,
  },
  copyGlyphUnavailable: {
    color: colors.textMuted,
  },
  /* ── Fields ── */
  field: {
    rowGap: spacing.xs,
  },
  fieldLabel: {
    color: colors.textMuted,
    letterSpacing: 0.4,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  segmented: {
    columnGap: spacing.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
  segmentOption: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 38,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  segmentOptionSelected: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  segmentOptionText: {
    color: colors.textSecondary,
    textAlign: 'center',
  },
  segmentOptionTextSelected: {
    color: colors.accent,
    textAlign: 'center',
  },
  /* ── Modal ── */
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    margin: spacing.lg,
    maxWidth: 520,
    padding: spacing.lg,
    rowGap: spacing.lg,
    width: '92%',
    ...(dialogShadow as object),
  },
  dialogTitle: {
    color: colors.textPrimary,
  },
  modalSection: {
    rowGap: spacing.md,
  },
  modalActions: {
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  generatedHint: {
    fontSize: 12,
    lineHeight: 16,
  },
  generatedRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  generatedPanel: {
    flex: 1,
    padding: spacing.md,
  },
  confirmMessage: {
    fontSize: 14,
    lineHeight: 20,
  },
});
