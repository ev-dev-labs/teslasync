// Native parity port of web/src/features/settings/components/SettingField.tsx.
//
// SettingField is the settings-form field wrapper: a labelled row (an uppercase
// caption + an optional inline `<HelpIcon>`) stacked above its control
// `children`. It is a pure presentational layout primitive — no state, no data,
// no effects — so the native port is a faithful structural + visual translation.
//
// Web -> native mapping (conversion-contract rules 3-7):
//   - `import type { ReactNode }` (web L1) -> `React.ReactNode` (the GasPriceSettings
//     inline-SettingField precedent); the `children: ReactNode` prop is preserved.
//   - `@/components/ui` `HelpIcon` (web L2) -> the already-ported native parity
//     `HelpIcon` at ../../../components/ui/HelpIcon. The same three help props
//     (`i18nKey`, `content`, `for`) are forwarded, and the web "render the icon
//     only when `help` is supplied" gate (L29-31) is preserved. (The native
//     HelpIcon additionally renders nothing when an i18nKey-only help resolves to
//     no text — its own documented short-circuit, unchanged here.)
//   - The exported `SettingFieldHelp` interface (web L4-11, with its i18nKey /
//     content / for JSDoc) is ported verbatim so call-sites keep the same type.
//   - DOM `<div>` (web L24) -> `<View>`; the label-row `<div className="mb-1.5
//     flex items-center gap-1">` (L25) -> `<View style={styles.labelRow}>`
//     (marginBottom 6, row, items-center, gap 4); `<label className="block
//     text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">`
//     (L26) -> `<AppText tone="muted" style={styles.label}>` (fontSize 12,
//     fontWeight 500, uppercase, letterSpacing 0.5 for tracking-wider). These map
//     exactly to the GasPriceSettings inline-SettingField parity styles.
// No DOM/Recharts/Leaflet/react-i18next/lucide/old web-ui import reaches the
// native output. See the .parity.json sidecar for the line-by-line source map.

import React from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {HelpIcon} from '../../../components/ui/HelpIcon';

export interface SettingFieldHelp {
  /** i18n key for the inline `<HelpIcon>`. */
  i18nKey?: string;
  /** Plain-text fallback when the i18n key is missing. */
  content?: string;
  /** Field id surfaced in the HelpIcon's aria-label. */
  for?: string;
}

/**
 * Settings-form field wrapper: an uppercase label (with an optional inline help
 * icon) stacked above its control `children`. Pure layout — no state or data.
 */
export function SettingField({
  label,
  help,
  children,
}: {
  label: string;
  /** Optional inline help icon attached to the label. */
  help?: SettingFieldHelp;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View>
      <View style={styles.labelRow}>
        <AppText style={styles.label} tone="muted">
          {label}
        </AppText>
        {help ? (
          <HelpIcon
            content={help.content}
            for={help.for}
            i18nKey={help.i18nKey}
          />
        ) : null}
      </View>
      {children}
    </View>
  );
}

SettingField.displayName = 'SettingField';

const styles = StyleSheet.create({
  // web label row `mb-1.5 flex items-center gap-1` (src L25).
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginBottom: 6,
  },
  // web label `text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]`
  // (src L26): 12px, weight 500, uppercase, tracking-wider letter spacing.
  label: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.5,
    lineHeight: 16,
    textTransform: 'uppercase',
  },
});
