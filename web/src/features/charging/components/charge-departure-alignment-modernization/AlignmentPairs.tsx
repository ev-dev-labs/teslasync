import { useTranslation } from 'react-i18next';
import { Link2 } from 'lucide-react';
import { DataTable, type Column, Badge, GlassPanel, PanelTitle, HelpTooltip, Text } from '@/components/ui';
import { Skeleton, EmptyState } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatDurationSecondsAsMinutes } from '@/lib/dateFormat';
import type { AlignmentFlag, DeparturePair } from '../../lib/chargeDepartureAlignment';
import { pairDisplayValues } from './presentation';

const FLAG_DEFAULTS: Record<AlignmentFlag, string> = {
  tight_margin: 'Cut it close on departure',
  excess_buffer: 'Added far more than that trip used',
  early_full_dwell: 'Sat at full charge before leaving',
  long_dwell: 'Long gap before departure',
  soc_mismatch: 'SoC reading looks inconsistent',
};

interface Props {
  pairs: readonly DeparturePair[];
  loading: boolean;
  available: boolean;
  missingReason: string;
}

/** The same complete, newest-first rows and display accessors power desktop and mobile.
 * The former twelve-card preview becomes a twelve-row page, with all pairs reachable. */
export function AlignmentPairs({ pairs, loading, available, missingReason }: Props) {
  const { t, i18n } = useTranslation();
  const { fmtPercent } = useNumberFormatting();
  const date = (ms: number) => new Date(ms).toLocaleString(i18n.language);
  const flags = (pair: DeparturePair) => pair.flags.length > 0
    ? pair.flags.map(flag => t(`chargeDepartureAlignment.flag.${flag}`, FLAG_DEFAULTS[flag])).join(' · ')
    : t('chargeDepartureAlignment.wellMatched', 'Well matched');
  const display = (pair: DeparturePair) =>
    pairDisplayValues(pair, date, fmtPercent, formatDurationSecondsAsMinutes, flags);
  const column = (key: keyof DeparturePair, header: string): Column<DeparturePair> => ({
    key, header,
    render: pair => display(pair)[key],
    exportValue: pair => display(pair)[key],
  });
  const columns: Column<DeparturePair>[] = [
    column('chargeEndedMs', t('chargeDepartureAlignment.modernization.chargeEnded', 'Charge ended')),
    column('driveStartMs', t('chargeDepartureAlignment.modernization.driveStarted', 'Drive started')),
    column('dwellS', t('chargeDepartureAlignment.col.dwell', 'Dwell (min)')),
    column('readinessMarginPct', t('chargeDepartureAlignment.margin', 'Readiness margin')),
    column('socUsedPct', t('chargeDepartureAlignment.socUsed', 'SoC that drive used')),
    column('endSocPct', t('chargeDepartureAlignment.modernization.chargeEndSoc', 'Charge-end SoC')),
    column('driveStartSocPct', t('chargeDepartureAlignment.modernization.driveStartSoc', 'Drive-start SoC')),
    column('driveEndSocPct', t('chargeDepartureAlignment.modernization.driveEndSoc', 'Drive-end SoC')),
    column('socDriftPct', t('chargeDepartureAlignment.modernization.socDrift', 'SoC drift')),
    column('earlyFullDwellS', t('chargeDepartureAlignment.modernization.fullDwell', 'Already-full dwell (min)')),
    {
      key: 'flags', header: t('chargeDepartureAlignment.modernization.flags', 'Pairing signals'),
      render: pair => <div className="flex flex-wrap gap-1.5">
        {pair.flags.length > 0 ? pair.flags.map(flag => (
          <Badge key={flag} variant="neutral" size="sm">
            {t(`chargeDepartureAlignment.flag.${flag}`, FLAG_DEFAULTS[flag])}
          </Badge>
        )) : <Badge variant="success" size="sm">
          {t('chargeDepartureAlignment.wellMatched', 'Well matched')}
        </Badge>}
      </div>,
      exportValue: flags,
    },
    column('chargeId', t('chargeDepartureAlignment.modernization.chargeId', 'Charge ID')),
    column('driveId', t('chargeDepartureAlignment.modernization.driveId', 'Drive ID')),
  ];
  const rows = [...pairs].reverse();
  const emptyMessage = available
    ? t('chargeDepartureAlignment.noPairs', 'No paired sessions to show yet.')
    : missingReason;

  return (
    <GlassPanel className="w-full min-w-0 p-4 @sm:p-5">
      <PanelTitle className="mb-3 flex flex-wrap items-center gap-2">
        <Link2 className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
        {t('chargeDepartureAlignment.detail', 'Recent Pairs')}
        <HelpTooltip
          size="sm"
          i18nKey="help.chargeDepartureAlignment.detail"
          defaultValue="Pairing a charge with the next drive is a temporal adjacency, not a proof of intent — a charge could have been meant for a later trip. A small negative SoC drift between charge-end and drive-start is ordinary vampire drain, not a fault."
          ariaLabel={t('help.chargeDepartureAlignment.iconLabel', 'More info about how pairs are formed')}
        />
      </PanelTitle>
      <Text as="p" variant="caption" className="mb-3">
        {t(
          'chargeDepartureAlignment.modernization.detailsScope',
          'All loaded pairs, newest first. “Well matched” means no model flag was triggered, not proof of intent. Already-full dwell is inferred from charge-end SoC, not continuous parked measurements. Dates use your browser timezone.',
        )}
      </Text>
      {loading ? <Skeleton height={180} /> : rows.length === 0 ? (
        <EmptyState /* no-action: per-source recovery is shown above the persistent section shells. */
          icon={<Link2 className="h-8 w-8" />} message={emptyMessage} />
      ) : (
        <DataTable
          tableId="charge-departure-alignment-pairs"
          name="charge-departure-alignment-pairs"
          caption={t('chargeDepartureAlignment.detail', 'Recent Pairs')}
          variant="embedded"
          columns={columns}
          data={rows}
          keyExtractor={pair => `${pair.chargeId}-${pair.driveId}`}
          pagination={{ defaultPageSize: 12, pageSizeOptions: [12, 24, 48, 96] }}
          emptyMessage={emptyMessage}
          mobilePresentation={{
            variant: 'cards',
            roles: {
              chargeEndedMs: 'title', readinessMarginPct: 'primary',
              dwellS: 'meta', socUsedPct: 'meta', driveStartMs: 'meta', flags: 'badge',
            },
            displayValue: (pair, key) => display(pair)[key],
          }}
        />
      )}
    </GlassPanel>
  );
}
