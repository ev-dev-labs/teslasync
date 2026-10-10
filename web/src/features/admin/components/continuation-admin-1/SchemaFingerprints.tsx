import { useTranslation } from 'react-i18next';
import { Fingerprint } from 'lucide-react';
import { LayoutCard, SourceContent } from '@/components/layout';
import { Card, CopyButton, PanelTitle, Caption, Code, Text } from '@/components/ui';
import { Skeleton, QueryError, EmptyState } from '@/components/feedback';
import { formatDateTime } from '@/lib/dateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { SchemaFingerprint } from '@/types/admin-operator-confidence';
import type { SchemaSectionState } from './schemaPresentation';

export function SchemaFingerprints({ state }: { state: SchemaSectionState }) {
  const { t } = useTranslation();
  const { drift, isLoading, error, onRetry } = state;
  return (
    <LayoutCard title={t('admin.schemaDrift.fingerprintTitle', 'Schema fingerprints')}
      actions={<Fingerprint className="h-4 w-4 text-cyan-300" aria-hidden />}>
      <Caption>{t('admin.schemaDrift.fingerprintSub', 'SHA-256 of the live schema versus the captured seed')}</Caption>
      {error ? <QueryError error={error} onRetry={onRetry} /> : (
        <SourceContent
          state={isLoading ? 'loading' : !drift ? 'empty' : 'ready'}
          label={t('admin.schemaDrift.fingerprintTitle', 'Schema fingerprints')}
          emptyMessage={t('admin.schemaDrift.emptyMessage', 'The schema fingerprint has not been computed yet. Restart the API to capture a seed fingerprint.')}
          errorMessage=""
          loadingContent={
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Skeleton height={150} />
              <Skeleton height={150} />
            </div>
          }
          emptyContent={
            <EmptyState
              icon={<Fingerprint className="h-8 w-8" aria-hidden />}
              title={t('admin.schemaDrift.emptyTitle', 'No fingerprint available')}
              message={t('admin.schemaDrift.emptyMessage', 'The schema fingerprint has not been computed yet. Restart the API to capture a seed fingerprint.')}
              action={{ label: t('common.refresh', 'Refresh'), onClick: onRetry }}
            />
          }
        >
          {drift && (
            <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
              <FingerprintDetails
                title={t('admin.schemaDrift.fingerprintCurrent', 'Current')}
                fp={drift.current}
              />
              <FingerprintDetails
                title={t('admin.schemaDrift.fingerprintExpected', 'Expected (seed)')}
                fp={drift.expected}
                generatedAt={drift.expected_generated_at}
              />
            </div>
          )}
        </SourceContent>
      )}
    </LayoutCard>
  );
}

function FingerprintDetails({ title, fp, generatedAt }: {
  title: string; fp: SchemaFingerprint; generatedAt?: string | null;
}) {
  const { t } = useTranslation();
  const sha = fp?.sha256 ?? '';
  return (
    <Card className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <PanelTitle>{title}</PanelTitle>
        <CopyButton text={sha} iconOnly disabled={!sha}
          ariaLabel={t('admin.schemaDrift.copyHash', 'Copy fingerprint hash')} />
      </div>
      <Code className="mb-3 block break-all">{sha || '—'}</Code>
      <div className="grid grid-cols-3 gap-2">
        <FingerprintStat label={t('admin.schemaDrift.tables', 'Tables')} value={fp?.table_count} />
        <FingerprintStat label={t('admin.schemaDrift.columns', 'Columns')} value={fp?.column_count} />
        <FingerprintStat label={t('admin.schemaDrift.indexes', 'Indexes')} value={fp?.index_count} />
      </div>
      {generatedAt && <Caption className="mt-3 block">{t('admin.schemaDrift.generatedAt', 'Captured {{when}}', {
        when: formatDateTime(generatedAt),
      })}</Caption>}
    </Card>
  );
}

function FingerprintStat({ label, value }: { label: string; value: number | null | undefined }) {
  const { fmtInt } = useNumberFormatting();
  return (
    <div className="min-w-0 rounded-md bg-[var(--surface-2)] px-2 py-2 text-center">
      <Text as="div" size="lg" weight="bold" color="primary" className="break-words tabular-nums">{value != null ? fmtInt(value) : '—'}</Text>
      <Caption className="mt-0.5 block break-words">{label}</Caption>
    </div>
  );
}
