/**
 * DLQ Inspector — entry drawer (native parity port of
 * web/src/features/admin/components/dlq-inspector/EntryDrawer.tsx).
 *
 * Slide-in side panel that lazy-loads the FULL DLQ entry (summary + base64 raw
 * + inner payloads). Footer hosts the Replay CTA which is disabled when:
 *   - The server's `replay_enabled` flag is false (warning banner above the
 *     page already explains why)
 *   - The entry's own `replayable` flag is false (no source topic to publish to)
 *   - A replay is in flight
 *
 * Heavy payload viewer renders the base64 of the inner payload (decoded as
 * UTF-8 best-effort) — operators rarely need the raw envelope.
 *
 * Native adaptations vs. the web source (behavior/state/keys/API intent kept):
 *   - web `@/components/ui` `Drawer` (framer-motion + react-dom createPortal,
 *     right slide-in) -> a self-contained RN `Modal` panel anchored to the
 *     right edge; the spring slide becomes the Modal fade (no Animated dep
 *     added), backdrop press + hardware-back both call `onClose`, and the
 *     title/close-button/scroll-body/footer slots are reproduced 1:1.
 *   - web `Tabs` (WAI-ARIA roving-tabindex `<button>` strip) -> a Pressable row
 *     keeping the same TabItem contract, active underline + `onChange(key)`;
 *     the keyboard arrow/Home/End navigation has no RN touch equivalent and is
 *     dropped (tap selection is preserved).
 *   - web `data-display` `TimeStamp` (hover Tooltip showing the alt format) ->
 *     an inline absolute formatter; native has no hover tooltip so only the
 *     absolute body is rendered, with the same "—" null/unparseable fallback.
 *   - web `CopyButton` (navigator.clipboard) is browser-only and no clipboard
 *     package is wired into the parity tree -> dropped; the payload text is
 *     rendered `selectable` so it can still be long-pressed to copy. The
 *     base64 download affordance the i18n string mentions is unavailable
 *     natively (documented in the sidecar).
 *   - web `Spinner` -> RN `ActivityIndicator`.
 *   - web `GlassPanel` -> the canonical native `GlassPanel`; `KVList` -> the
 *     native parity `KVList`.
 *   - web `@/lib/numberFormat` `fmtInt` -> ported inline (locale-aware integer,
 *     same `safeNumber` guard, 0 decimals).
 *   - `decodeBase64Utf8` (`atob` + `TextDecoder('utf-8',{fatal:true})`) ->
 *     a self-contained forgiving-base64 + strict-UTF-8 decoder so binary
 *     protobuf bodies cleanly yield '' on any host (Hermes/JSC/Node) without
 *     depending on browser globals.
 *   - lucide-react `Send` icon -> a small send glyph; react-i18next
 *     `useTranslation` -> a native-safe t(key, fallback, options?) fallback
 *     preserving every key, English default, and {{id}}/{{n}} interpolation.
 */

import React, {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, shadows, spacing} from '../../../../../theme/tokens';
import {KVList} from '../../../../components/data-display/KVList';
import type {DLQEntryFull, DLQEntrySummary} from '../../../../api/hooks/useDLQ';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type InterpolationValues = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: InterpolationValues,
) => string;

function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key, fallback, options) =>
      options ? interpolate(fallback, options) : fallback,
    [],
  );
}

// ---- Ported integer formatting (web/src/lib/numberFormat.ts: fmtInt) --------

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Locale-aware integer (web `fmtInt` = `fmtNumber(v, 0)`). */
function fmtInt(value: unknown): string {
  try {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    });
  } catch {
    return String(Math.round(safeNumber(value)));
  }
}

// ---- Native-safe base64 -> UTF-8 (web atob + TextDecoder fatal) -------------

const BASE64_LOOKUP: Record<string, number> = (() => {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const table: Record<string, number> = {};
  for (let i = 0; i < alphabet.length; i++) {
    table[alphabet.charAt(i)] = i;
  }
  return table;
})();

/**
 * Forgiving-base64 decode (matches the browser `atob` the web component used):
 * ASCII whitespace is stripped, up to two trailing `=` are tolerated, and any
 * other invalid input throws so the caller's catch yields '' — identical to the
 * web pipeline where a bad/binary body fell through to the binary marker.
 */
function base64ToBytes(b64: string): Uint8Array {
  let data = b64.replace(/[\t\n\f\r ]/g, '');
  if (data.endsWith('==')) {
    data = data.slice(0, -2);
  } else if (data.endsWith('=')) {
    data = data.slice(0, -1);
  }
  if (data.length % 4 === 1) {
    throw new Error('invalid base64 length');
  }
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < data.length; i++) {
    const value = BASE64_LOOKUP[data.charAt(i)];
    if (value === undefined) {
      throw new Error('invalid base64 character');
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

/**
 * Strict UTF-8 decode mirroring `TextDecoder('utf-8', { fatal: true })`:
 * rejects invalid lead/continuation bytes, overlong encodings, surrogates and
 * out-of-range code points by throwing, so binary protobuf payloads hit the
 * caller's catch and render the "(non-UTF-8 binary …)" marker instead.
 */
function decodeUtf8Strict(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  const length = bytes.length;
  while (i < length) {
    const b0 = bytes[i++];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      continue;
    }
    let codepoint: number;
    let extra: number;
    let min: number;
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      codepoint = b0 & 0x1f;
      extra = 1;
      min = 0x80;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      codepoint = b0 & 0x0f;
      extra = 2;
      min = 0x800;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      codepoint = b0 & 0x07;
      extra = 3;
      min = 0x10000;
    } else {
      throw new Error('invalid utf-8 lead byte');
    }
    for (let k = 0; k < extra; k++) {
      if (i >= length) {
        throw new Error('truncated utf-8 sequence');
      }
      const next = bytes[i++];
      if ((next & 0xc0) !== 0x80) {
        throw new Error('invalid utf-8 continuation byte');
      }
      codepoint = (codepoint << 6) | (next & 0x3f);
    }
    if (
      codepoint < min ||
      codepoint > 0x10ffff ||
      (codepoint >= 0xd800 && codepoint <= 0xdfff)
    ) {
      throw new Error('invalid utf-8 code point');
    }
    if (codepoint > 0xffff) {
      const astral = codepoint - 0x10000;
      out += String.fromCharCode(
        0xd800 + (astral >> 10),
        0xdc00 + (astral & 0x3ff),
      );
    } else {
      out += String.fromCharCode(codepoint);
    }
  }
  return out;
}

/**
 * Decodes base64 → UTF-8 string when possible; falls back to '' for opaque
 * payloads so we never crash the drawer on a binary protobuf body. The render
 * layer turns '' into the "(non-UTF-8 binary, {{n}} bytes)" marker.
 */
function decodeBase64Utf8(b64: string): string {
  if (!b64) {
    return '';
  }
  try {
    return decodeUtf8Strict(base64ToBytes(b64));
  } catch {
    return '';
  }
}

// ---- Inline TimeStamp (web data-display TimeStamp, format="absolute") --------

/** Renders an ISO/epoch/Date as an absolute label, "—" for null/unparseable. */
function formatAbsolute(value: string | number | Date | null | undefined): string {
  if (value == null) {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ---- Inline Tabs (web ui Tabs — roving-tabindex strip dropped natively) ------

interface TabItem {
  key: string;
  label: string;
  disabled?: boolean;
}

function DrawerTabs({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: TabItem[];
  activeTab: string;
  onChange: (key: string) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.tabsRow}>
      {tabs.map(tab => {
        const selected = tab.key === activeTab;
        return (
          <Pressable
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
            accessibilityState={{disabled: tab.disabled, selected}}
            disabled={tab.disabled}
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={({pressed}) => [
              styles.tab,
              selected && styles.tabActive,
              tab.disabled && styles.tabDisabled,
              pressed && !tab.disabled && styles.pressed,
            ]}>
            <AppText
              style={[styles.tabLabel, selected && styles.tabLabelActive]}
              weight="semibold">
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---- Inline Drawer (web ui Drawer — right slide-in side panel) ---------------

function Drawer({
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
  const {width} = useWindowDimensions();
  const panelWidth = Math.min(448, width);

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
        <View
          accessibilityLabel={title || 'Panel'}
          accessibilityViewIsModal
          accessible
          style={[styles.panel, {width: panelWidth}]}
          testID="dlq-entry-drawer">
          <View style={styles.header}>
            <AppText numberOfLines={1} style={styles.headerTitle} weight="semibold">
              {title}
            </AppText>
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({pressed}) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}>
              <AppText style={styles.closeGlyph} weight="bold">
                ✕
              </AppText>
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.bodyContent}
            style={styles.body}>
            {children}
          </ScrollView>
          <View style={styles.footer}>{footer}</View>
        </View>
      </View>
    </Modal>
  );
}

export interface EntryDrawerProps {
  open: boolean;
  summary: DLQEntrySummary | null;
  full: DLQEntryFull | undefined;
  loading: boolean;
  replayEnabled: boolean;
  replayInFlight: boolean;
  onClose: () => void;
  onReplay: () => void;
}

export function EntryDrawer({
  open,
  summary,
  full,
  loading,
  replayEnabled,
  replayInFlight,
  onClose,
  onReplay,
}: EntryDrawerProps): React.ReactElement {
  const t = useNativeTranslationFallback();
  const [activeTab, setActiveTab] = useState<string>('inner');

  const innerText = useMemo(
    () => (full ? decodeBase64Utf8(full.inner_payload_b64) : ''),
    [full],
  );
  const rawText = useMemo(
    () => (full ? decodeBase64Utf8(full.raw_payload_b64) : ''),
    [full],
  );

  // Summary fields used when the full payload is still loading — pulled from
  // the summary row that was already in cache.
  const head: DLQEntryFull | DLQEntrySummary | null = full ?? summary;

  const tabs: TabItem[] = [
    {key: 'inner', label: t('admin.dlq.drawer.tabs.inner', 'Inner payload')},
    {key: 'raw', label: t('admin.dlq.drawer.tabs.raw', 'Raw envelope')},
  ];

  const replayDisabled =
    !replayEnabled || !head?.replayable || replayInFlight || loading;

  const title = head
    ? t('admin.dlq.drawer.title', 'DLQ entry #{{id}}', {id: head.id})
    : t('admin.dlq.drawer.titleFallback', 'DLQ entry');

  const payloadText =
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

  const footer = (
    <View style={styles.footerRow}>
      <Pressable
        accessibilityLabel={t('common.close', 'Close')}
        accessibilityRole="button"
        onPress={onClose}
        style={({pressed}) => [
          styles.button,
          styles.secondaryButton,
          pressed && styles.pressed,
        ]}>
        <AppText style={styles.secondaryButtonText} weight="semibold">
          {t('common.close', 'Close')}
        </AppText>
      </Pressable>
      <Pressable
        accessibilityLabel={t('admin.dlq.drawer.replay', 'Replay')}
        accessibilityRole="button"
        accessibilityState={{busy: replayInFlight, disabled: replayDisabled}}
        disabled={replayDisabled}
        onPress={onReplay}
        style={({pressed}) => [
          styles.button,
          styles.primaryButton,
          replayDisabled && styles.disabled,
          pressed && !replayDisabled && styles.pressed,
        ]}>
        {replayInFlight ? (
          <ActivityIndicator color={colors.background} size="small" />
        ) : (
          <AppText style={styles.sendGlyph} weight="bold">
            ➤
          </AppText>
        )}
        <AppText style={styles.primaryButtonText} weight="semibold">
          {t('admin.dlq.drawer.replay', 'Replay')}
        </AppText>
      </Pressable>
    </View>
  );

  return (
    <Drawer footer={footer} onClose={onClose} open={open} title={title}>
      {loading && !full ? (
        <View style={styles.spinnerWrap}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : head ? (
        <View style={styles.bodyStack}>
          <GlassPanel style={styles.glassPanel}>
            <KVList
              items={[
                {
                  label: t('admin.dlq.drawer.id', 'ID'),
                  value: <AppText style={styles.kvMono}>{head.id}</AppText>,
                },
                {
                  label: t('admin.dlq.drawer.arrivedAt', 'Arrived'),
                  value: (
                    <AppText style={styles.kvValue}>
                      {formatAbsolute(head.arrived_at)}
                    </AppText>
                  ),
                },
                {
                  label: t('admin.dlq.drawer.dlqTopic', 'DLQ topic'),
                  value: (
                    <AppText style={styles.kvMonoXs}>
                      {head.dlq_topic || '—'}
                    </AppText>
                  ),
                },
                {
                  label: t('admin.dlq.drawer.reason', 'Reason'),
                  value: (
                    <AppText style={styles.kvMonoXs}>
                      {head.parsed_reason || '—'}
                    </AppText>
                  ),
                },
                {
                  label: t('admin.dlq.drawer.vin', 'VIN'),
                  value: (
                    <AppText style={styles.kvMonoXs}>
                      {head.parsed_vin ?? '—'}
                    </AppText>
                  ),
                },
                {
                  label: t('admin.dlq.drawer.sourceTopic', 'Source topic'),
                  value: (
                    <AppText style={styles.kvMonoXs}>
                      {head.parsed_source_topic ?? '—'}
                    </AppText>
                  ),
                },
                {
                  label: t('admin.dlq.drawer.redeliveries', 'Redeliveries'),
                  value:
                    head.parsed_redeliveries != null
                      ? fmtInt(head.parsed_redeliveries)
                      : '—',
                },
                {
                  label: t('admin.dlq.drawer.parseError', 'Parse error'),
                  value: (
                    <AppText style={styles.kvParseError}>
                      {head.parse_error || '—'}
                    </AppText>
                  ),
                },
              ]}
            />
          </GlassPanel>

          <GlassPanel style={styles.glassPanel}>
            <DrawerTabs
              activeTab={activeTab}
              onChange={setActiveTab}
              tabs={tabs}
            />
            <View style={styles.tabBody}>
              <View style={styles.preWrap}>
                <ScrollView
                  contentContainerStyle={styles.preContent}
                  nestedScrollEnabled
                  style={styles.preScroll}>
                  <AppText selectable style={styles.preText}>
                    {payloadText}
                  </AppText>
                </ScrollView>
              </View>
            </View>
          </GlassPanel>
        </View>
      ) : null}
    </Drawer>
  );
}

EntryDrawer.displayName = 'EntryDrawer';

const GLASS_BORDER = 'rgba(255, 255, 255, 0.06)';

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 6, 14, 0.62)',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: spacing.lg,
  },
  bodyStack: {
    gap: spacing.md,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 10,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  closeGlyph: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 18,
  },
  disabled: {
    opacity: 0.48,
  },
  footer: {
    backgroundColor: colors.surface,
    borderTopColor: GLASS_BORDER,
    borderTopWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  footerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  glassPanel: {
    gap: spacing.md,
    padding: 16,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: GLASS_BORDER,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 18,
    lineHeight: 26,
  },
  kvMono: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 14,
    textAlign: 'right',
  },
  kvMonoXs: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 12,
    textAlign: 'right',
  },
  kvParseError: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'right',
  },
  kvValue: {
    color: colors.textPrimary,
    fontSize: 14,
    textAlign: 'right',
  },
  overlay: {
    backgroundColor: 'transparent',
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  panel: {
    backgroundColor: colors.surface,
    borderLeftColor: GLASS_BORDER,
    borderLeftWidth: 1,
    flexDirection: 'column',
    height: '100%',
    ...shadows.panel,
  },
  preContent: {
    padding: spacing.md,
  },
  preScroll: {
    flexGrow: 0,
  },
  preText: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  preWrap: {
    backgroundColor: colors.surfaceRaised,
    borderColor: GLASS_BORDER,
    borderRadius: 8,
    borderWidth: 1,
    maxHeight: 320,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.82,
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  primaryButtonText: {
    color: colors.background,
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
  },
  sendGlyph: {
    color: colors.background,
    fontSize: 14,
    lineHeight: 16,
  },
  spinnerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tabActive: {
    borderBottomColor: colors.accent,
    borderBottomWidth: 2,
  },
  tabBody: {
    gap: spacing.sm,
  },
  tabDisabled: {
    opacity: 0.5,
  },
  tabLabel: {
    color: colors.textMuted,
    fontSize: 14,
  },
  tabLabelActive: {
    color: colors.accent,
  },
  tabsRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
  },
});

export default EntryDrawer;
