/**
 * Native parity barrel for web/src/features/settings/components/index.ts.
 *
 * The web module is a pure re-export barrel that forwards twelve named settings
 * building blocks (TeslaAccountSection, FeatureToggles, RegionSettings,
 * ActiveOrdersSection, GeneralSettings, GasPriceSettings, NotificationSettings,
 * QuietHoursPanel, AppearanceSettings, SettingsSearch, AdvancedSettings,
 * AISettings). This barrel preserves that identical public export surface — all
 * twelve identifiers, in source order.
 *
 * None of the twelve siblings have a dedicated native port yet (only the
 * AISettings-owned sub-component AIProviderSection — which the web barrel
 * deliberately keeps un-exported — exists natively in this directory). Each
 * web sibling is a Tailwind/web-UI panel, a DOM form, or a settings-search
 * combobox, so this barrel exposes native-safe placeholder components that
 * render an explicit "native port pending" state through the shared GlassPanel +
 * AppText primitives instead of importing any browser-only module (no DOM,
 * Recharts, Leaflet, or web UI). When a sibling gains a dedicated native port,
 * replace its placeholder below with a re-export of that file.
 *
 * Built with React.createElement because the output path must stay `index.ts`,
 * which cannot contain JSX (mirrors the sibling cost-analysis/index.ts and
 * driving-dynamics/index.ts native barrels).
 */

import React, {type ReactElement} from 'react';
import {StyleSheet} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {spacing} from '../../../../theme/tokens';

/**
 * Permissive structural stand-ins for the two web sibling prop types. The real
 * domain type behind `seedDraft` (QuietHoursWindowInput) lives in the
 * not-yet-ported quiet-hours module; `ObjectLike` keeps the same prop names so
 * future native call sites compile unchanged, and the placeholder bodies ignore
 * the values until each section is fully ported. No `any` is used. `ObjectLike`
 * is `object` (not `Record<string, unknown>`) so the real interface-typed
 * payload, which lacks an implicit string index signature, stays assignable.
 * The other ten siblings export prop-less components, mirrored verbatim.
 */
type ObjectLike = object;

interface QuietHoursPanelProps {
  seedDraft?: ObjectLike | null;
  onSeedConsumed?: () => void;
}

interface SettingsSearchProps {
  // `className` is a DOM layout escape hatch with no native analogue; the name
  // is preserved so web call sites compile, and the placeholder ignores it.
  className?: string;
}

type PlaceholderComponent<P> = (props: P) => ReactElement;

const KICKER_LABEL = 'Settings';
const UNAVAILABLE_HINT = 'Native port pending';

function renderPlaceholder(section: string): ReactElement {
  return React.createElement(GlassPanel, {
    style: styles.panel,
    children: [
      React.createElement(
        AppText,
        {key: 'kicker', variant: 'caption', tone: 'muted', style: styles.kicker},
        KICKER_LABEL,
      ),
      React.createElement(AppText, {key: 'section', weight: 'semibold'}, section),
      React.createElement(
        AppText,
        {key: 'hint', variant: 'caption', tone: 'muted'},
        UNAVAILABLE_HINT,
      ),
    ],
  });
}

export const TeslaAccountSection = (): ReactElement =>
  renderPlaceholder('Tesla account');

export const FeatureToggles = (): ReactElement =>
  renderPlaceholder('Feature toggles');

export const RegionSettings = (): ReactElement =>
  renderPlaceholder('Region settings');

export const ActiveOrdersSection = (): ReactElement =>
  renderPlaceholder('Active orders');

export const GeneralSettings = (): ReactElement =>
  renderPlaceholder('General settings');

export const GasPriceSettings = (): ReactElement =>
  renderPlaceholder('Gas price settings');

export const NotificationSettings = (): ReactElement =>
  renderPlaceholder('Notification settings');

export const QuietHoursPanel: PlaceholderComponent<QuietHoursPanelProps> = () =>
  renderPlaceholder('Quiet hours');

export const AppearanceSettings = (): ReactElement =>
  renderPlaceholder('Appearance settings');

export const SettingsSearch: PlaceholderComponent<SettingsSearchProps> = () =>
  renderPlaceholder('Settings search');

export const AdvancedSettings = (): ReactElement =>
  renderPlaceholder('Advanced settings');

// AISettings is the only place AI can be enabled (ADR-015 §I7 / §I9).
// Sub-components (AIProviderSection, AIFeatureToggleList, AIRestorePanel,
// AIUsageCard) stay un-exported because they are owned by AISettings — this
// barrel preserves that boundary by exporting only AISettings here.
export const AISettings = (): ReactElement => renderPlaceholder('AI settings');

const styles = StyleSheet.create({
  panel: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  kicker: {
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
