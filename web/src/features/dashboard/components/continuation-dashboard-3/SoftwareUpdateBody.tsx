import { useTranslation } from 'react-i18next';
import { Download, CheckCircle2, Clock } from 'lucide-react';
import { Caption, Text } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';
import { WidgetBigNumber } from '../../widgets/shared';
import { SoftwareUpdateBadge, type UpdateStatus } from './SoftwareUpdateBadge';

interface SoftwareUpdateBodyProps {
  version: string;
  updateVersion: string | null;
  downloadPct: number | null;
  installPct: number | null;
  expectedDuration: number | null;
  scheduledStart: string | null;
  updateStatus: UpdateStatus;
  isTall: boolean;
}

export function SoftwareUpdateBody({
  version, updateVersion, downloadPct, installPct, expectedDuration,
  scheduledStart, updateStatus, isTall,
}: SoftwareUpdateBodyProps) {
  const { t } = useTranslation('dashboard');
  const { fmtNumber } = useNumberFormatting();
  return (
    <div className="h-full min-w-0 flex flex-col justify-center gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <WidgetBigNumber
            label={t('widget.currentVersion', 'Current version')}
            value={version || '—'}
            size="secondary"
          />
        </div>
        <SoftwareUpdateBadge status={updateStatus} />
      </div>

      {updateVersion && updateStatus !== 'up-to-date' && (
        <div className="space-y-2">
          <div className="flex min-w-0 flex-wrap items-start gap-1.5">
            <Download className="h-3 w-3 text-cyan-300 shrink-0" aria-hidden="true" />
            <Caption>{t('widget.updateAvailable', 'Update')}:</Caption>
            <Text variant="bodySm" className="min-w-0 text-cyan-300 [overflow-wrap:anywhere]">{updateVersion}</Text>
          </div>

          {updateStatus === 'downloading' && downloadPct != null && (
            <MetricBar
              value={downloadPct}
              max={100}
              color="#22d3ee"
              label={t('widget.downloading', 'Downloading')}
              sublabel={`${fmtNumber(downloadPct)}%`}
            />
          )}
          {updateStatus === 'installing' && installPct != null && (
            <MetricBar
              value={installPct}
              max={100}
              color="#a78bfa"
              label={t('widget.installing', 'Installing')}
              sublabel={`${fmtNumber(installPct)}%`}
            />
          )}
          {updateStatus === 'ready' && (
            <div className="flex min-w-0 items-start gap-1.5">
              <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-300" aria-hidden="true" />
              <Text variant="bodySm" className="text-emerald-300 [overflow-wrap:anywhere]">{t('widget.readyToInstall', 'Ready to install')}</Text>
            </div>
          )}

          {isTall && isFiniteNumber(expectedDuration) && expectedDuration > 0 && (
            <div className="flex min-w-0 items-start gap-1.5 pt-0.5 border-t border-[var(--border-subtle)]">
              <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
              <Caption className="min-w-0 [overflow-wrap:anywhere]">
                {t('widget.estimatedTime', 'Est. time')}: ~{fmtNumber(expectedDuration)}{' '}
                {t('widget.minutes', 'min')}
              </Caption>
            </div>
          )}
          {isTall && scheduledStart && (
            <div className="flex min-w-0 items-start gap-1.5 pt-0.5 border-t border-[var(--border-subtle)]">
              <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
              <Caption className="min-w-0 [overflow-wrap:anywhere]">
                {t('widget.scheduledStart', 'Scheduled')}: {scheduledStart}
              </Caption>
            </div>
          )}
        </div>
      )}

      {updateStatus === 'up-to-date' && (
        <div className="flex min-w-0 items-start gap-1.5">
          <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-300" aria-hidden="true" />
          <Text variant="bodySm" className="text-emerald-300 [overflow-wrap:anywhere]">{t('widget.upToDate', 'Up to date')}</Text>
        </div>
      )}
    </div>
  );
}
