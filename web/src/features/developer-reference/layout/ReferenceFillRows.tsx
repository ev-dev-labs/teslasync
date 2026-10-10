import { useTranslation } from 'react-i18next';
import { CardGrid, LayoutCard, Section } from '@/components/layout/layout-reference';
import { Text } from '@/components/ui';

export function ReferenceFillRows() {
  const { t } = useTranslation();
  const heading = t('developerReference.layout.fill.longHeading', 'A deliberately long heading that must remain fully readable inside the same narrow container as the neighboring short reference card');
  const details = t('developerReference.layout.fill.details', 'The fill strategy is content-driven: the brief card uses the complete explanatory content region, not an empty spacer, a duplicate fact or a fabricated metric. Both cards stretch, while meaningful content remains at the end of the card. Height and the 48-pixel dead-space limit still require real browser measurements.');
  return (
    <Section id="layout-fill" title={t('developerReference.layout.fill.title', 'Short and tall content with an explicit fill strategy')}>
      <CardGrid label={t('developerReference.layout.fill.grid', 'Source-ordered content fill examples')} items={[
        { id: 'short', size: 'half', content: <LayoutCard title={t('developerReference.layout.fill.shortTitle', 'Brief reference')}>
          <Text as="p" variant="bodySm">{t('developerReference.layout.fill.brief', 'A short summary does not justify discarding its neighboring details.')}</Text>
          <Text as="p" variant="bodySm" className="mt-auto">{details}</Text>
        </LayoutCard> },
        { id: 'tall', size: 'half', content: <LayoutCard title={heading} description={details}>
          <Text as="p" variant="bodySm">{details}</Text>
          <Text as="p" variant="bodySm">{t('developerReference.layout.fill.tallDetail', 'Unbalanced production rows are not automatically repaired by stretching. Pairing unlike content or moving details remains a page-specific decision with a no-information-loss map and human approval.')}</Text>
        </LayoutCard> },
      ]} />
      <CardGrid label={t('developerReference.layout.fill.oddGrid', 'Odd card count without source reordering')} items={[
        { id: 'odd-a', size: 'half', content: <LayoutCard title={t('developerReference.layout.fill.oddFirst', 'First card')}><Text as="p" variant="bodySm">{t('developerReference.layout.fill.firstBody', 'This card keeps the first source position.')}</Text></LayoutCard> },
        { id: 'odd-b', size: 'half', content: <LayoutCard title={t('developerReference.layout.fill.oddSecond', 'Second card')}><Text as="p" variant="bodySm">{t('developerReference.layout.fill.secondBody', 'This card keeps the second source position.')}</Text></LayoutCard> },
        { id: 'odd-c', size: 'half', content: <LayoutCard title={t('developerReference.layout.fill.oddThird', 'Third card expands to fill its row')}><Text as="p" variant="bodySm">{t('developerReference.layout.fill.thirdBody', 'Only the final row span changes; the card is not moved, merged or removed.')}</Text></LayoutCard> },
      ]} />
    </Section>
  );
}
