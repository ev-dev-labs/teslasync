import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InlineCallout } from '@/components/feedback';
import { Button, ConfirmDialog, Text } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import type { DataState } from '@/api/dataState';
import type { BenchmarkPrivacyStatus } from '@/api/hooks/useBenchmarks';
import { BenchmarkStatusContent } from './BenchmarkStatusContent';

interface PrivacyControlsProps {
  optedIn: boolean;
  pending: boolean;
  error: Error | null;
  onRevoke: () => void;
  source?: DataState<BenchmarkPrivacyStatus>;
}

export function PrivacyControls({
  optedIn,
  pending,
  error,
  onRevoke,
  source,
}: PrivacyControlsProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
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
        className="mt-4"
        disabled={!optedIn || pending}
        onClick={() => setOpen(true)}
        wrapLabel
      >
        <Trash2 className="h-4 w-4" aria-hidden />
        {t('benchmarks.controls.revoke', 'Revoke & delete contribution data')}
      </Button>
      {error ? (
        <InlineCallout variant="danger" className="mt-3">
          {t('benchmarks.controls.error', 'Could not revoke participation: {{message}}', {
            message: error.message,
          })}
        </InlineCallout>
      ) : null}
      <ConfirmDialog
        open={open}
        title={t('benchmarks.controls.confirmTitle', 'Revoke private benchmarks?')}
        message={t(
          'benchmarks.controls.confirmMessage',
          'Future use stops immediately and clipped contribution rows are deleted. Published noisy cohort releases cannot be withdrawn.',
        )}
        confirmLabel={t('benchmarks.controls.confirm', 'Revoke & delete')}
        cancelLabel={t('benchmarks.controls.cancel', 'Keep participation')}
        loading={pending}
        requireTypedConfirmation={revokeWord}
        typedConfirmationLabel={t(
          'benchmarks.controls.typed',
          'Type {{word}} to confirm',
          { word: revokeWord },
        )}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          onRevoke();
          setOpen(false);
        }}
      />
      </BenchmarkStatusContent>
    </LayoutCard>
  );
}
