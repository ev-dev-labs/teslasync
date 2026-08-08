import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InlineCallout } from '@/components/feedback';
import { Button, Checkbox, GlassPanel } from '@/components/ui';

interface ConsentGateProps {
  optedIn: boolean;
  acknowledged: boolean;
  pending: boolean;
  error: Error | null;
  onAcknowledgedChange: (value: boolean) => void;
  onConsent: () => void;
}

export function ConsentGate({
  optedIn,
  acknowledged,
  pending,
  error,
  onAcknowledgedChange,
  onConsent,
}: ConsentGateProps) {
  const { t } = useTranslation();
  return (
    <GlassPanel className="p-5 md:p-6">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" aria-hidden />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              {t('benchmarks.consent.title', 'Private participation')}
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {t(
                'benchmarks.consent.description',
                'TeslaSync derives bounded summaries locally. Raw trips, locations and VINs are never submitted to this endpoint.',
              )}
            </p>
          </div>
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
    </GlassPanel>
  );
}

