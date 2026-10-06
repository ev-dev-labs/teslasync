import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InlineCallout } from '@/components/feedback';
import { Button, Checkbox, Text } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import type { DataState } from '@/api/dataState';
import type { BenchmarkPrivacyStatus } from '@/api/hooks/useBenchmarks';
import { BenchmarkStatusContent } from './BenchmarkStatusContent';

interface ConsentGateProps {
  optedIn: boolean;
  acknowledged: boolean;
  pending: boolean;
  error: Error | null;
  onAcknowledgedChange: (value: boolean) => void;
  onConsent: () => void;
  source?: DataState<BenchmarkPrivacyStatus>;
}

export function ConsentGate({
  optedIn,
  acknowledged,
  pending,
  error,
  onAcknowledgedChange,
  onConsent,
  source,
}: ConsentGateProps) {
  const { t } = useTranslation();
  return (
    <LayoutCard title={t('benchmarks.consent.title', 'Private participation')}>
      <BenchmarkStatusContent source={source} label={t('benchmarks.consent.title', 'Private participation')}>
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <Text as="p" variant="bodySm">
              {t(
                'benchmarks.consent.description',
                'TeslaSync derives bounded summaries locally. Raw trips, locations and VINs are never submitted to this endpoint.',
              )}
            </Text>
          </div>
          </BenchmarkStatusContent>
          {optedIn ? (
            <InlineCallout variant="success" icon={<CheckCircle2 />}>
              {t(
                'benchmarks.consent.active',
                'Opt-in is active for this vehicle. Refreshes reuse a stable release and do not spend more privacy budget.',
              )}
            </InlineCallout>
          ) : (
            <div className="space-y-3">
              <Checkbox
                checked={acknowledged}
                onChange={onAcknowledgedChange}
                label={t(
                  'benchmarks.consent.acknowledge',
                  'I opt in to bounded aggregate benchmarking and understand that released aggregates cannot be withdrawn.',
                )}
              />
              <Button
                type="button"
                onClick={onConsent}
                disabled={!acknowledged || pending}
                loading={pending}
              >
                {t('benchmarks.consent.action', 'Opt in')}
              </Button>
            </div>
          )}
          {error ? (
            <InlineCallout variant="danger">
              {t('benchmarks.consent.error', 'Could not update benchmark consent: {{message}}', {
                message: error.message,
              })}
            </InlineCallout>
          ) : null}
        </div>
      </div>
    </LayoutCard>
  );
}
