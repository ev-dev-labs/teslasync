// Native parity port of
// web/src/features/admin/components/devtools/tools/TimestampTool.tsx.
//
// The web tool is one of the 15 admin "Developer Tools" client utilities: it
// shows a live "now" clock (current Unix epoch seconds + ISO 8601 string,
// refreshed every second) with a "Now" button that seeds both inputs, plus two
// converters — a Unix-epoch input that derives ISO / local / relative labels,
// and an ISO input that derives Unix / local / relative labels. All computation
// is client-side, so the behavior ports faithfully to React Native.
//
// Native adaptations vs. the web source:
//   - react-i18next `useTranslation().t` -> a native-safe `t(key, fallback?)`
//     shim. The web calls `t('Timestamp')` / `t('Timestamp Desc')` / `t('Now')`
//     / `t('Unix Timestamp')` / `t('Iso')` / `t('Local')` / `t('Relative')` /
//     `t('Iso Timestamp')` / `t('Unix')` with the English string AS the key (no
//     fallback), so the shim returns the key verbatim, preserving the rendered
//     text + i18n keys exactly.
//   - lucide-react `Clock` / `Hash` icons (ToolCard `icon`, the live-row clock,
//     and the in-Input adornments) are browser-only; ToolCard's accent chip
//     stands in (green accent), so the icon props are dropped.
//   - `@/components/ui` `Input` -> a labelled React Native `TextInput`.
//   - `@/components/ui` `Button` (the ghost "Now" button) -> a React Native
//     `Pressable` firing the same setUnix/setIso seeding logic.
//   - `../ToolCard` -> the canonical native `ToolCard` re-exported from the
//     devtools barrel ('..').
//   - `../helpers` `getRelativeTime` -> inlined verbatim below (no native
//     helpers module exists yet, and this is its only parity-tree consumer).
//   - `@/lib/dateFormat` `formatDateTime` -> inlined native-safe port of the
//     Date-input path (same Intl options + "—" fallback). `toLocaleString` with
//     options is available in the RN engine, so no behavior is lost.
//   - `window.setInterval` / `window.clearInterval` -> the global
//     `setInterval` / `clearInterval` (there is no `window` in React Native).
//   - `<div>` wrappers map to `<View>`; `<p>`/`<span>` map to nested `<AppText>`
//     spans (so per-segment colors are preserved on a single inline line);
//     Tailwind classes map to StyleSheet token styles; `font-mono` ->
//     fontFamily 'monospace'; `text-cyan-300` value text -> the cyan theme
//     accent (tone="accent"). `var(--surface-overlay)` -> colors.surfaceRaised.

import {useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, TextInput, View} from 'react-native';

import {AppText} from '../../../../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../../../../theme/tokens';
import {ToolCard} from '..';

/* ─── native-safe i18n shim ───────────────────────────────────────────────
   The web tool's keys ARE the English strings, so returning the key (or an
   explicit fallback when provided) preserves both the keys and the output. */

function t(key: string, fallback?: string): string {
  return fallback ?? key;
}

/* ─── getRelativeTime (faithful port of ../helpers getRelativeTime) ───────── */

function getRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = Math.abs(now - date.getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) {
    return `${s}s ago`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/* ─── formatDateTime (native-safe port of @/lib/dateFormat formatDateTime) ──
   Mirrors the Date-input / no-options branch: "—" for unrenderable input, else
   a localized "Apr 4, 2026, 2:30 AM"-style string via toLocaleString. */

function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = new Date(value);
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

/* ─── derived-value line (web <p>{label}: <span mono cyan>{value}</span></p>) ── */

function ResultLine({label, value}: {label: string; value: string}) {
  return (
    <AppText variant="caption" tone="secondary">
      {label}:{' '}
      <AppText variant="caption" tone="accent" style={styles.mono}>
        {value}
      </AppText>
    </AppText>
  );
}

export function TimestampTool() {
  const [unix, setUnix] = useState('');
  const [iso, setIso] = useState('');
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fromUnix = useMemo(() => {
    if (!unix) {
      return null;
    }
    const ms = unix.length > 10 ? parseInt(unix, 10) : parseInt(unix, 10) * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }, [unix]);

  const fromIso = useMemo(() => {
    if (!iso) {
      return null;
    }
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }, [iso]);

  return (
    <ToolCard
      color="green"
      title={t('Timestamp')}
      description={t('Timestamp Desc')}>
      <View style={styles.body}>
        <View style={styles.liveRow}>
          <View style={styles.liveValues}>
            <AppText variant="caption">
              <AppText variant="caption" tone="primary" style={styles.mono}>
                {Math.floor(now.getTime() / 1000)}
              </AppText>
              <AppText variant="caption" tone="muted">
                {'   |   '}
              </AppText>
              <AppText variant="caption" tone="secondary" style={styles.mono}>
                {now.toISOString()}
              </AppText>
            </AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Now')}
            onPress={() => {
              setUnix(String(Math.floor(Date.now() / 1000)));
              setIso(new Date().toISOString());
            }}
            style={styles.nowButton}>
            <AppText variant="caption" tone="accent" weight="semibold">
              {t('Now')}
            </AppText>
          </Pressable>
        </View>
        <View style={styles.fieldStack}>
          <View style={styles.field}>
            <AppText variant="caption" tone="secondary">
              {t('Unix Timestamp')}
            </AppText>
            <TextInput
              value={unix}
              onChangeText={setUnix}
              placeholder="1700000000"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              accessibilityLabel={t('Unix Timestamp')}
            />
            {fromUnix ? (
              <View style={styles.resultLines}>
                <ResultLine label={t('Iso')} value={fromUnix.toISOString()} />
                <ResultLine
                  label={t('Local')}
                  value={formatDateTime(fromUnix)}
                />
                <ResultLine
                  label={t('Relative')}
                  value={getRelativeTime(fromUnix)}
                />
              </View>
            ) : null}
          </View>
          <View style={styles.field}>
            <AppText variant="caption" tone="secondary">
              {t('Iso Timestamp')}
            </AppText>
            <TextInput
              value={iso}
              onChangeText={setIso}
              placeholder="2024-01-01T00:00:00Z"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              accessibilityLabel={t('Iso Timestamp')}
            />
            {fromIso ? (
              <View style={styles.resultLines}>
                <ResultLine
                  label={t('Unix')}
                  value={String(Math.floor(fromIso.getTime() / 1000))}
                />
                <ResultLine label={t('Local')} value={formatDateTime(fromIso)} />
                <ResultLine
                  label={t('Relative')}
                  value={getRelativeTime(fromIso)}
                />
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </ToolCard>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  liveValues: {
    flex: 1,
    minWidth: 180,
  },
  nowButton: {
    borderRadius: 8,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceHover,
  },
  fieldStack: {
    gap: spacing.md,
  },
  field: {
    gap: spacing.xs,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    fontSize: typography.body,
  },
  resultLines: {
    gap: spacing.xs,
  },
  mono: {
    fontFamily: 'monospace',
  },
});
