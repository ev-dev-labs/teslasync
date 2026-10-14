import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InlineCallout } from '@/components/feedback';
import { Button, ConfirmDialog, Text } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import type { DataState } from '@/api/dataState';
import type { BenchmarkPrivacyStatus } from '@/api/hooks/useBenchmarks';
import { BenchmarkStatusContent } from './BenchmarkStatusContent';

interface PrivacyControlsProps {
  optedIn: boolean | undefined;
  pending: boolean;
  error: Error | null;
  onRevoke: () => void | Promise<void>;
  source?: DataState<BenchmarkPrivacyStatus>;
  vehicleId?: number;
  canAct?: boolean;
}

export function PrivacyControls({
  optedIn,
  pending,
  error,
  onRevoke,
  source,
  vehicleId,
  canAct = true,
}: PrivacyControlsProps) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState<{
    vehicleId: number | undefined;
    revoke: () => void | Promise<void>;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [attemptError, setAttemptError] = useState<Error | null>(null);
  const dispatching = useRef(false);
  const open = attempt != null;
  const targetValid = attempt?.vehicleId === vehicleId && canAct && optedIn === true;
  const failure = attemptError ?? error;
  useEffect(() => {
    if (!submitting && !pending && (!canAct || attempt?.vehicleId !== vehicleId)) {
      setAttempt(null);
      setAttemptError(null);
    }
  }, [vehicleId, canAct, attempt?.vehicleId, pending, submitting]);
  const confirmRevoke = async () => {
    if (!attempt || !targetValid || pending || dispatching.current) return;
    dispatching.current = true;
    setSubmitting(true);
    setAttemptError(null);
    try {
      await attempt.revoke();
      setAttempt(null);
    } catch (cause) {
      setAttemptError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      dispatching.current = false;
      setSubmitting(false);
    }
  };
  const revokeWord = t('benchmarks.controls.revokeWord', 'REVOKE');
  return (
    <LayoutCard title={t('benchmarks.controls.title', 'Privacy controls')}>
      <BenchmarkStatusContent source={source} label={t('benchmarks.controls.title', 'Privacy controls')}>
      <Text as="p" variant="bodySm">
        {t(
          'benchmarks.controls.description',
          'Revocation stops future participation and deletes clipped contribution rows. Already released DP aggregates and minimal accounting metadata remain.',
        )}
      </Text>
      <Button
        type="button"
        variant="danger"
        className="mt-4 min-h-11 md:min-h-10"
        disabled={optedIn !== true || pending || submitting || !canAct}
        onClick={() => {
          setAttemptError(null);
          setAttempt({ vehicleId, revoke: onRevoke });
        }}
        wrapLabel
      >
        <Trash2 className="h-4 w-4" aria-hidden />
        {t('benchmarks.controls.revoke', 'Revoke & delete contribution data')}
      </Button>
      {failure ? (
        <InlineCallout variant="danger" className="mt-3">
          {t('benchmarks.controls.error', 'Could not revoke participation: {{message}}', {
            message: failure.message,
          })}
        </InlineCallout>
      ) : null}
      </BenchmarkStatusContent>
      <ConfirmDialog
        open={open}
        title={t('benchmarks.controls.confirmTitle', 'Revoke private benchmarks?')}
        message={t(
          'benchmarks.controls.confirmMessage',
          'Future use stops immediately and clipped contribution rows are deleted. Published noisy cohort releases cannot be withdrawn.',
        )}
        confirmLabel={t('benchmarks.controls.confirm', 'Revoke & delete')}
        cancelLabel={t('benchmarks.controls.cancel', 'Keep participation')}
        loading={pending || submitting}
        confirmDisabled={!targetValid}
        details={
          <>
            {attempt?.vehicleId != null && <Text variant="bodySm">{t('common.vehicle', 'Vehicle')}: {attempt.vehicleId}</Text>}
            {failure && (
              <InlineCallout variant="danger">
                {t('benchmarks.controls.error', 'Could not revoke participation: {{message}}', { message: failure.message })}
              </InlineCallout>
            )}
          </>
        }
        requireTypedConfirmation={revokeWord}
        typedConfirmationLabel={t(
          'benchmarks.controls.typed',
          'Type {{word}} to confirm',
          { word: revokeWord },
        )}
        onCancel={() => { if (!pending && !submitting) setAttempt(null); }}
        onConfirm={() => { void confirmRevoke(); }}
      />
    </LayoutCard>
  );
}
