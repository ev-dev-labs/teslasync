import { useState } from 'react';
import { WidgetGaugeHero, WidgetRankedList, type GaugeHeroConfig, type RankedItem } from '@/features/dashboard/widgets/shared';
import { Badge, Button, Text } from '@/components/ui';
import { FixtureSection } from './FixtureSection';
import { useCompletionLabels } from './useCompletionLabels';

export function WidgetFixtures() {
  const c = useCompletionLabels();
  const [order, setOrder] = useState<'source' | 'value-desc'>('source');
  const base: GaugeHeroConfig = {
    label: c.gaugeInterval, value: 40, min: 20, max: 80, unit: c.scoreUnit,
    color: 'var(--accent-primary)', tone: 'primary', preserveReadingAndScale: true,
    status: c.gaugeStatus, decimals: 0, marker: 60, markerLabel: c.gaugeMarker,
  };
  const gauges: GaugeHeroConfig[] = [
    { ...base, label: c.gaugeUnknown, ariaLabel: c.gaugeUnknown, value: null },
    { ...base, label: c.gaugeZero, ariaLabel: c.gaugeZero, value: 0, min: 0 },
    { ...base, ariaLabel: c.gaugeInterval },
    { ...base, label: c.gaugeInvalid, ariaLabel: c.gaugeInvalid, value: 40, max: 0 },
  ];
  const items: RankedItem[] = [
    { id: 'unknown', label: c.rankUnknown, value: null, formattedValue: c.unknown, badge: { text: c.unresolved, variant: 'warning' } },
    { id: 'zero', label: c.rankZero, value: 0, formattedValue: '0', labelContent: <span>{c.rankZero} <Badge variant="success">{c.readyBadge}</Badge></span> },
    { id: 'positive', label: c.rankPositive, value: 8, formattedValue: `8 ${c.scoreUnit}` },
    { id: 'negative', label: c.rankNegative, value: -2, formattedValue: `−2 ${c.scoreUnit}` },
  ];
  return (
    <FixtureSection id="widgets" title={c.widgetTitle} description={c.widgetDescription}>
      <div data-shared-contract="widget-gauge-hero" className="grid min-w-0 grid-cols-1 gap-5 @[640px]:grid-cols-2">
        {gauges.map(gauge => <div key={gauge.label} className="min-w-0">
          <WidgetGaugeHero gauge={gauge}><Text as="p" variant="caption">{c.note}</Text></WidgetGaugeHero>
        </div>)}
      </div>
      <div data-shared-contract="widget-ranked-list" className="min-w-0 space-y-4">
        <div role="group" aria-label={c.sourceOrder} className="flex flex-wrap gap-2">
          <Button wrapLabel type="button" aria-pressed={order === 'source'} onClick={() => setOrder('source')}>{c.sourceOrder}</Button>
          <Button wrapLabel type="button" aria-pressed={order === 'value-desc'} onClick={() => setOrder('value-desc')}>{c.magnitudeOrder}</Button>
        </div>
        <WidgetRankedList items={items} order={order} maxItems={4} wrapContent emptyMessage={c.rankEmpty} />
        <WidgetRankedList items={items} order="source" compact maxItems={4} wrapContent emptyMessage={c.rankEmpty} />
      </div>
    </FixtureSection>
  );
}
