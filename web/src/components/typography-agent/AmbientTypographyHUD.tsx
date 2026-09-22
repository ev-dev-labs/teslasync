import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, Type, X } from 'lucide-react';
import {
  Badge,
  Button,
  GlassPanel,
  Heading,
  HelperText,
  Select,
  Slider,
  Text,
  type SelectOption,
} from '@/components/ui';
import { RATIO_VALUES } from '@/lib/typography-agent/harmonizer';
import { DEFAULT_TYPOGRAPHY_SPEC } from '@/lib/typography-agent/orchestrator';
import type { DensityMode, ModularRatio } from '@/lib/typography-agent/types';
import { useTypographyAgent } from './TypographyAgentProvider';

// ─────────────────────────────────────────────────────────────────────────────
// AmbientTypographyHUD — in-situ controller for the connected-typography
// OHAV loop. Mounted globally by TypographyAgentProvider (toggled with
// Cmd/Ctrl+Shift+T) so scale, size, and density can be tuned while looking
// at real workflows instead of an isolated settings route. Every control
// dispatches through the shared agent: harmonize → actuate → verify →
// heal, with the live verification score shown inline. A specimen preview
// renders sample text through the compiled tokens as visible proof.
// ─────────────────────────────────────────────────────────────────────────────

const RATIO_IDS: ModularRatio[] = [
  'minorSecond',
  'majorSecond',
  'minorThird',
  'majorThird',
  'perfectFourth',
  'goldenRatio',
];

const DENSITY_IDS: DensityMode[] = ['compact', 'comfortable', 'relaxed'];

export function AmbientTypographyHUD() {
  const { t } = useTranslation();
  const { spec, verification, setHudOpen, dispatch } = useTypographyAgent();

  const ratioNames: Record<ModularRatio, string> = {
    minorSecond: t('settings.typographyAgent.ratio_minorSecond', 'Minor Second'),
    majorSecond: t('settings.typographyAgent.ratio_majorSecond', 'Major Second'),
    minorThird: t('settings.typographyAgent.ratio_minorThird', 'Minor Third'),
    majorThird: t('settings.typographyAgent.ratio_majorThird', 'Major Third'),
    perfectFourth: t('settings.typographyAgent.ratio_perfectFourth', 'Perfect Fourth'),
    goldenRatio: t('settings.typographyAgent.ratio_goldenRatio', 'Golden Ratio'),
  };
  const densityNames: Record<DensityMode, string> = {
    compact: t('settings.typographyAgent.density_compact', 'Compact'),
    comfortable: t('settings.typographyAgent.density_comfortable', 'Comfortable'),
    relaxed: t('settings.typographyAgent.density_relaxed', 'Relaxed'),
  };

  const ratioOptions: SelectOption[] = RATIO_IDS.map((id) => ({
    value: id,
    label: `${ratioNames[id]} (${RATIO_VALUES[id].toFixed(3)})`,
  }));

  const passed = verification?.passed ?? true;
  const score = verification?.score ?? 100;
  const anomalies = verification?.anomalies ?? [];

  // Move keyboard focus into the panel on open (the provider returns it to
  // the opener on close).
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      id="typography-hud-root"
      aria-label={t('settings.typographyAgent.hudLabel', 'Typography agent controller')}
      className="fixed bottom-6 right-6 z-[9999] w-[22rem] max-w-[calc(100vw-3rem)]"
    >
      <GlassPanel className="p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Type className="h-4 w-4 text-[var(--theme-primary)]" aria-hidden />
            <div>
              <Heading level="sub">{t('settings.typographyAgent.title', 'Typography Agent')}</Heading>
              <Text variant="caption" className="text-[var(--text-secondary)]">
                {t('settings.typographyAgent.subtitle', 'Connected harmonic runtime')}
              </Text>
            </div>
          </div>
          <Button
            variant="ghost"
            onClick={() => setHudOpen(false)}
            aria-label={t('common.close', 'Close')}
            className="h-8 w-8 shrink-0 p-0"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="mb-4 flex items-center justify-between gap-2">
          <Badge variant={passed ? 'success' : 'danger'} dot>
            {passed
              ? t('settings.typographyAgent.verified', 'Harmony verified')
              : t('settings.typographyAgent.healing', 'Self-healing engaged')}
          </Badge>
          <Text variant="caption" className="text-[var(--text-secondary)]">
            {t('settings.typographyAgent.score', 'Score: {{score}}/100', { score })}
          </Text>
        </div>

        <div className="space-y-4">
          <Select
            label={t('settings.typographyAgent.ratio', 'Harmonic ratio')}
            value={spec.ratio}
            options={ratioOptions}
            onChange={(e) => void dispatch({ ratio: e.target.value as ModularRatio })}
          />

          <Slider
            label={t('settings.typographyAgent.baseSize', 'Base text size ({{size}}px)', {
              size: spec.baseSizeMaxPx,
            })}
            value={spec.baseSizeMaxPx}
            min={13}
            max={19}
            step={0.5}
            onChange={(value) => void dispatch({ baseSizeMaxPx: value })}
          />

          <div>
            <Text as="div" variant="label" className="mb-2">
              {t('settings.typographyAgent.density', 'Density')}
            </Text>
            <div role="group" aria-label={t('settings.typographyAgent.density', 'Density')} className="grid grid-cols-3 gap-2">
              {DENSITY_IDS.map((mode) => {
                const active = spec.density === mode;
                return (
                  <Button
                    key={mode}
                    variant={active ? 'primary' : 'ghost'}
                    aria-pressed={active}
                    onClick={() => void dispatch({ density: mode })}
                    className="justify-center capitalize"
                  >
                    {densityNames[mode]}
                  </Button>
                );
              })}
            </div>
            <HelperText>
              {t(
                'settings.typographyAgent.densityHint',
                'Density tunes type leading only; workspace spacing stays in Display settings.',
              )}
            </HelperText>
          </div>

          <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-3">
            <Text as="div" variant="label" className="mb-2">
              {t('settings.typographyAgent.specimen', 'Live specimen')}
            </Text>
            {/* Rendered through the live agent tokens (audit- and observer-approved). */}
            <p className="text-[var(--text-primary)] text-[var(--type-size-xl,1.25rem)] font-semibold leading-[var(--type-lh-xl,1.4)] tracking-[var(--type-track-xl,0em)]">
              {t('settings.typographyAgent.specimenHeading', 'Harmonized headings scale fluidly')}
            </p>
            <p className="mt-1 text-[var(--text-secondary)] text-[var(--type-size-base,1rem)] leading-[var(--type-lh-base,1.5)]">
              {t(
                'settings.typographyAgent.specimenBody',
                'Body copy follows the modular ratio across viewports.',
              )}
            </p>
          </div>

          {anomalies.length > 0 && (
            <div>
              <Text as="div" variant="label" className="mb-2">
                {t('settings.typographyAgent.findings', 'Loop findings ({{count}})', {
                  count: anomalies.length,
                })}
              </Text>
              <ul className="max-h-28 space-y-1 overflow-y-auto">
                {anomalies.slice(0, 6).map((finding, i) => (
                  <li key={`${finding.selector}-${i}`} className="flex items-start gap-2">
                    <Badge
                      variant={finding.severity === 'critical' ? 'danger' : finding.severity === 'warning' ? 'warning' : 'neutral'}
                      size="sm"
                    >
                      {finding.type}
                    </Badge>
                    <Text variant="caption" className="text-[var(--text-secondary)]">
                      {finding.details}
                    </Text>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="pt-1">
            <Button
              variant="ghost"
              onClick={() => void dispatch({ ...DEFAULT_TYPOGRAPHY_SPEC })}
              className="w-full justify-center"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t('settings.typographyAgent.reset', 'Reset to defaults')}
            </Button>
          </div>
        </div>
      </GlassPanel>
    </aside>
  );
}
