import { ClipboardList, FileOutput, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner, EmptyState } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { BatteryPassportSectionBody } from './BatteryPassportSectionBody';
import type { BatteryPassportQueryState } from './types';

interface BatteryPassportRecommendationsProps {
  state: BatteryPassportQueryState;
}

export function BatteryPassportRecommendations({
  state,
}: BatteryPassportRecommendationsProps) {
  const { t } = useTranslation();
  const recommendations = Array.isArray(state.passport?.recommendations)
    ? state.passport.recommendations
    : [];

  return (
    <section data-testid="battery-passport-recommendations">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ClipboardList
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'batteryPassport.recommendations.title',
            'Server-generated recommendation directory',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'batteryPassport.recommendations.subtitle',
            'Verbatim outputs from deterministic server rules, retained as certificate evidence rather than presented as prescriptions.',
          )}
        </Text>
        <BatteryPassportSectionBody state={state}>
          <AlertBanner
            className="mb-4"
            variant="info"
            icon={<Info className="h-4 w-4" aria-hidden="true" />}
          >
            <Text as="p" variant="caption">
              {t(
                'batteryPassport.recommendations.notice',
                'These strings are server rule outputs. They do not establish cause, safety, warranty eligibility, remaining life, or an action a user should take.',
              )}
            </Text>
          </AlertBanner>
          {recommendations.length > 0 ? (
            <ol className="space-y-2.5">
              {recommendations.map((recommendation, index) => (
                <li
                  key={`${index}:${recommendation}`}
                  className="flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <FileOutput
                    className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300"
                    aria-hidden="true"
                  />
                  <div>
                    <Text as="p" variant="caption">
                      {t(
                        'batteryPassport.recommendations.ruleLabel',
                        'Server rule output {{index}}',
                        { index: index + 1 },
                      )}
                    </Text>
                    <Text as="p" variant="bodySm" className="mt-1">
                      {t(
                        'batteryPassport.recommendations.ruleValue',
                        '{{output}}',
                        { output: recommendation },
                      )}
                    </Text>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              className="py-7"
              icon={
                <ClipboardList
                  className="h-7 w-7"
                  aria-hidden="true"
                />
              }
              message={t(
                'batteryPassport.recommendations.empty',
                'The server returned no recommendation rule outputs. This is an empty rule-result state, not a health or safety assessment.',
              )}
            />
          )}
        </BatteryPassportSectionBody>
      </GlassPanel>
    </section>
  );
}
