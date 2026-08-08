import { BookOpenCheck, Clock3, Database, FlaskConical, Fuel, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { CarbonSectionProps } from './types';

export function CarbonMethodology({
  analysis,
}: CarbonSectionProps) {
  const { t } = useTranslation();
  const items = [
    {
      icon: <Database className="h-4 w-4" aria-hidden="true" />,
      title: t('carbon.method.sourceTitle', 'Source model'),
      body: t(
        'carbon.method.sourceBody',
        'Grid intensity is a seeded, admin-editable, built-in 24-hour static diurnal model. It is not live, location-aware, utility-specific, renewable-share, or marginal grid data.',
      ),
    },
    {
      icon: <Clock3 className="h-4 w-4" aria-hidden="true" />,
      title: t('carbon.method.clockTitle', 'Clock-hour attribution'),
      body: t(
        'carbon.method.clockBody',
        'The backend groups charging with EXTRACT(HOUR FROM started_at), but the API does not expose that operation’s timezone. Hours are therefore labeled backend/model clock-hour, never vehicle-local.',
      ),
    },
    {
      icon: <FlaskConical className="h-4 w-4" aria-hidden="true" />,
      title: t('carbon.method.formulaTitle', 'Charging attribution'),
      body: t(
        'carbon.method.formulaBody',
        'Session CO₂ equals positive charging energy multiplied by the matching model intensity and converted from grams to kilograms. The frontend independently derives average intensity from returned CO₂ and canonical Wh.',
      ),
    },
    {
      icon: <Fuel className="h-4 w-4" aria-hidden="true" />,
      title: t('carbon.method.gasTitle', 'Gas comparison'),
      body: t(
        'carbon.method.gasBody',
        'The comparison is distance × 0.192 kg CO₂/km. It is a fixed generic baseline, not the user’s prior vehicle. Gas less charging may be negative and is shown as excess rather than clipped.',
      ),
    },
    {
      icon: <BookOpenCheck className="h-4 w-4" aria-hidden="true" />,
      title: t('carbon.method.rangeTitle', 'Selected range'),
      body: t(
        'carbon.method.rangeBody',
        'URL calendar labels {{start}} through {{end}} are interpreted in {{timezone}} and sent as RFC3339 instants using an exclusive upper bound. Period charts never substitute lifetime rows.',
        {
          start: analysis.window.startLabel,
          end: analysis.window.endLabel,
          timezone: analysis.window.timezone,
        },
      ),
    },
    {
      icon: <ShieldAlert className="h-4 w-4" aria-hidden="true" />,
      title: t('carbon.method.scenarioTitle', 'Recommendation boundary'),
      body: t(
        'carbon.method.scenarioBody',
        'The recommendation is full-history only and shifts all observed lifetime charging energy into the fixed greenest three-hour model window. It is a counterfactual estimate, not selected-period evidence or a schedule guarantee.',
      ),
    },
  ];

  return (
    <section
      data-testid="carbon-methodology"
      aria-label={t(
        'carbon.method.aria',
        'Carbon methodology assumptions and limitations',
      )}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-2 flex items-center gap-2">
          <BookOpenCheck
            className="h-4 w-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          {t(
            'carbon.method.title',
            'Methodology, source assumptions, and limitations',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'carbon.method.normalization',
            'Existing legacy wire energy fields are converted from kWh to canonical Wh exactly once at the analytical model boundary. All analysis remains in Wh; display conversion occurs only at render boundaries.',
          )}
        </Text>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
            >
              <div className="mb-2 flex items-center gap-2 text-[var(--text-muted)]">
                {item.icon}
                <Text as="h3" variant="label">{item.title}</Text>
              </div>
              <Text as="p" variant="bodySm">{item.body}</Text>
            </div>
          ))}
        </div>
      </GlassPanel>
    </section>
  );
}
