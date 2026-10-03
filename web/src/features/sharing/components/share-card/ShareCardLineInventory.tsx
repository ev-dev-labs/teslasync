import { ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, GlassPanel, PanelTitle, Table, Text } from '@/components/ui';
import type { ShareCardLineKey } from '../../lib/shareCard';
import { ShareCardSectionBody } from './ShareCardSectionBody';
import type { ShareCardCompositionProps } from './types';

export function ShareCardLineInventory({
  analysis,
  state,
  lines,
}: ShareCardCompositionProps) {
  const { t } = useTranslation();
  const labels: Record<ShareCardLineKey, string> = {
    distance: t('shareCard.lines.distance', 'Distance'),
    driveCount: t('shareCard.lines.driveCount', 'Eligible drives'),
    energy: t('shareCard.lines.energy', 'Drive energy'),
    regen: t('shareCard.lines.regen', 'Regen recovered'),
    longest: t('shareCard.lines.longest', 'Longest measured drive'),
    topSpeed: t('shareCard.lines.topSpeed', 'Top measured speed'),
  };

  return (
    <section
      data-testid="share-card-line-inventory"
      aria-label={t('shareCard.lines.aria', 'Share card six-line content inventory')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-2 flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('shareCard.lines.title', 'Card content and line inventory')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'shareCard.lines.subtitle',
            'All six slots render deterministically. Missing measurements remain an em dash and are disclosed, never converted to zero.',
          )}
        </Text>
        <ShareCardSectionBody state={state}>
          <Table aria-label={t('shareCard.lines.title', 'Card content and line inventory')}>

            <tbody>
            {analysis.card.lineInventory.map((evidence, index) => (
              <tr
                key={evidence.key}
              >
                <th scope="row">
                  <Text as="p" variant="label">
                    {t('shareCard.lines.slot', 'Line {{slot}} · {{label}}', {
                      slot: index + 1,
                      label: labels[evidence.key],
                    })}
                  </Text>
                </th>
                <td>
                  <Badge variant={evidence.available ? 'success' : 'neutral'}>
                    {evidence.available
                      ? t('shareCard.lines.measured', 'Measured')
                      : t('shareCard.lines.missing', 'Missing')}
                  </Badge>
                </td>
                <td className="text-right">
                <Text as="p" variant="bodySm" className="mt-2">
                  {lines[index]?.value ?? '—'}
                </Text>
                </td>
                <td className="text-right">
                <Text as="p" variant="caption" className="mt-1">
                  {t('shareCard.lines.support', '{{count}} supporting rows', {
                    count: evidence.supportRows,
                  })}
                </Text>
                </td>
              </tr>
            ))}
            </tbody>
          </Table>
        </ShareCardSectionBody>
      </GlassPanel>
    </section>
  );
}
