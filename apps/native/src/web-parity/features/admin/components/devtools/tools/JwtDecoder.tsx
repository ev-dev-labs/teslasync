// Native parity port of web/src/features/admin/components/devtools/tools/JwtDecoder.tsx.
//
// The web module is a dev-tool that splits a pasted JWT on '.', base64-decodes
// the first two segments via the browser-only global `atob`, JSON.parses them
// into header/payload objects (any failure -> an "Invalid Jwt" message), and
// renders the results inside a purple ToolCard with two ResultPanels.
//
// Native-safe substitutions (rule 7), documented in the parity sidecar:
//   • Browser-only global `atob` -> a pure-JS `decodeBase64` helper. The native
//     bundle's TS lib set has no DOM lib (so `atob` isn't even typed) and older
//     RN engines don't guarantee it, so this mirrors atob semantics exactly
//     (standard base64 alphabet, ASCII-whitespace stripping, length%4===1 and
//     invalid-character throws) — keeping the same try/catch -> 'Invalid Jwt'
//     behaviour the web has, including atob's non-base64url limitation.
//   • react-i18next `useTranslation()` -> a local `useTranslation()` hook whose
//     `t(key, fallback?)` returns the English fallback (or the human-readable key
//     itself, which IS the web copy) while preserving every key at the call site.
//   • lucide `KeyRound` icon -> the parity SemanticIcon name 'keyRound' passed to
//     the already-ported native ToolCard (drawn via the colour box).
//   • `@/components/ui` `Textarea` (DOM <textarea>) -> a local multiline
//     <TextInput> wrapper mirroring the rows/placeholder/value contract (the same
//     inline Textarea precedent used by the sibling FleetApiSection port).
//   • sibling `../ResultPanel` (not yet ported as its own file) -> inlined here
//     verbatim from the web ResultPanel, matching the FleetApiSection precedent.
//   • DOM <div>/<span>/<p> + Tailwind classes -> RN <View>/<AppText> + StyleSheet
//     (space-y-3 -> gap, mb-1 -> marginBottom, text-rose-300 -> colors.danger).
// No DOM elements, lucide-react, Recharts, Leaflet, or web UI kit modules are
// imported into the native output.

import React, {useCallback, useMemo, useState} from 'react';
import {Platform, ScrollView, StyleSheet, TextInput, View} from 'react-native';

import {CopyButton} from '../../../../../components/ui/CopyButton';
import {AppText} from '../../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../../theme/tokens';
import {ToolCard} from '../ToolCard';

const MONO_FAMILY = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

/* ─── i18n fallback (web react-i18next useTranslation) ────────────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation: the native bundle ships no
// i18n runtime, so `t` returns the English fallback (or the human-readable key,
// which is itself the web copy) while preserving the key for a future native
// i18n layer. Stable identity keeps the decode useMemo dependency honest.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── native-safe `atob` replacement ──────────────────────────────────── */

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Pure-JS equivalent of the browser global `atob`: decodes a standard-base64
// string to a binary string, stripping ASCII whitespace and throwing on an
// invalid length or character so the caller's catch yields 'Invalid Jwt' exactly
// as the web does. Intentionally does NOT translate base64url (-,_) — matching
// the web's plain `atob` limitation rather than silently "fixing" it.
function decodeBase64(input: string): string {
  const clean = input.replace(/[\t\n\f\r ]/g, '');
  if (clean.length % 4 === 1) {
    throw new Error('Invalid base64 length');
  }
  let output = '';
  let accumulator = 0;
  let bitsCollected = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean.charAt(i);
    if (char === '=') {
      break;
    }
    const value = BASE64_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error('Invalid base64 character');
    }
    accumulator = (accumulator << 6) | value;
    bitsCollected += 6;
    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      output += String.fromCharCode((accumulator >>> bitsCollected) & 0xff);
    }
  }
  return output;
}

/* ─── inlined ./Textarea (web @/components/ui Textarea) ───────────────── */

interface TextareaProps {
  rows?: number;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
}

function Textarea({rows = 3, placeholder, value, onChangeText}: TextareaProps) {
  return (
    <TextInput
      multiline
      numberOfLines={rows}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      style={[styles.textarea, {minHeight: rows * 20 + 16}]}
      textAlignVertical="top"
      value={value}
    />
  );
}

/* ─── inlined ../ResultPanel ──────────────────────────────────────────── */

interface ResultPanelProps {
  title: string;
  data?: unknown;
  error?: string;
  idle?: boolean;
  idleMessage?: string;
}

function ResultPanel({title, data, error, idleMessage}: ResultPanelProps) {
  const hasData = data != null;
  const stringifiedData = hasData ? JSON.stringify(data, null, 2) : '';

  return (
    <View
      style={[
        styles.resultPanel,
        error
          ? styles.resultPanelError
          : hasData
          ? styles.resultPanelOk
          : styles.resultPanelIdle,
      ]}>
      <View style={styles.resultHeader}>
        <AppText
          style={styles.resultTitle}
          tone="secondary"
          variant="caption"
          weight="semibold">
          {title}
        </AppText>
        {hasData ? <CopyButton text={stringifiedData} /> : null}
      </View>
      {error ? (
        <AppText style={styles.resultErrorText}>{error}</AppText>
      ) : hasData ? (
        <ScrollView style={styles.codeScroll} nestedScrollEnabled>
          <AppText style={styles.codeText}>{stringifiedData}</AppText>
        </ScrollView>
      ) : (
        <AppText style={styles.resultIdleText}>
          {idleMessage ?? 'No result yet'}
        </AppText>
      )}
    </View>
  );
}

/* ─── JwtDecoderTool ──────────────────────────────────────────────────── */

interface JwtDecoded {
  header: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  error?: string;
}

export function JwtDecoderTool() {
  const {t} = useTranslation();
  const [jwt, setJwt] = useState('');
  const decoded = useMemo<JwtDecoded>(() => {
    if (!jwt.trim()) {
      return {header: null, payload: null};
    }
    try {
      const parts = jwt.split('.');
      if (parts.length < 2) {
        return {header: null, payload: null, error: t('Invalid Jwt')};
      }
      const header = JSON.parse(decodeBase64(parts[0] ?? '')) as Record<
        string,
        unknown
      >;
      const payload = JSON.parse(decodeBase64(parts[1] ?? '')) as Record<
        string,
        unknown
      >;
      return {header, payload};
    } catch {
      return {header: null, payload: null, error: t('Invalid Jwt')};
    }
  }, [jwt, t]);

  return (
    <ToolCard
      icon="keyRound"
      color="purple"
      title={t('Jwt Decoder')}
      description={t('Jwt Decoder Desc')}>
      <View style={styles.stack}>
        <View>
          <AppText
            style={styles.fieldLabel}
            tone="secondary"
            variant="caption"
            weight="semibold">
            {t('Jwt Input')}
          </AppText>
          <Textarea
            rows={3}
            placeholder="eyJhbGciOiJSUzI1NiIs..."
            value={jwt}
            onChangeText={setJwt}
          />
        </View>
        {decoded.error ? (
          <AppText style={styles.errorText}>{decoded.error}</AppText>
        ) : null}
        {decoded.header ? (
          <ResultPanel title={t('Jwt Header')} data={decoded.header} />
        ) : null}
        {decoded.payload ? (
          <ResultPanel title={t('Jwt Payload')} data={decoded.payload} />
        ) : null}
      </View>
    </ToolCard>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.md,
  },
  fieldLabel: {
    marginBottom: spacing.xs,
  },
  textarea: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  resultPanel: {
    borderRadius: 12,
    gap: spacing.xs,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  resultPanelError: {
    backgroundColor: colors.dangerSurface,
  },
  resultPanelOk: {
    backgroundColor: colors.successSurface,
  },
  resultPanelIdle: {
    backgroundColor: colors.surfaceRaised,
  },
  resultHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  resultTitle: {
    color: colors.textSecondary,
    flex: 1,
  },
  resultErrorText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  resultIdleText: {
    color: colors.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 18,
    marginTop: 2,
  },
  codeScroll: {
    backgroundColor: colors.surface,
    borderRadius: 6,
    maxHeight: 256,
    padding: spacing.sm,
  },
  codeText: {
    color: colors.textPrimary,
    fontFamily: MONO_FAMILY,
    fontSize: 12,
    lineHeight: 16,
  },
});
