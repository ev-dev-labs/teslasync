import { useTranslation } from 'react-i18next';
import { AboutPanel } from '@/components/layout/layout-reference';
import { Text } from '@/components/ui';

export function ReferenceMethodology() {
  const { t } = useTranslation();
  return (
    <AboutPanel>
      <div className="grid min-w-0 grid-cols-1 gap-4 @[640px]:grid-cols-2 @[1024px]:grid-cols-3">
        <Text as="p" variant="bodySm">{t('developerReference.layout.about.synthetic', 'All examples on this page are deterministic synthetic fixtures. They demonstrate containers, text wrapping, disclosure, source isolation, chart dimensions and the single stats-owned primitive. They do not represent a vehicle, a real analysis period, a fit result, telemetry or API availability. The complete daily series remains accessible through each chart’s data table even when its plotted display is sampled.')}</Text>
        <Text as="p" variant="bodySm">{t('developerReference.layout.about.layout', 'Cards retain their source order. Incomplete rows expand in place without a CSS dense ordering strategy. Plot heights are 200, 240 and 280 pixels according to the containing grid; gutters follow the same measured boundary. Existing PageContainer, Grid, Card, GlassPanel and chart/feedback primitives remain the substrate. Typography preferences, shell navigation, workspace controls, global padding and safe areas are not redesigned here.')}</Text>
        <Text as="p" variant="bodySm">{t('developerReference.layout.about.acceptance', 'This is source-authoring evidence, not Phase 0 or Phase 3 runtime acceptance. Route crawl, valid sample IDs, tab selectors, rendered section counts, geometry, before captures and visual rubric scores remain unknown until the parent’s serialized checks. The reference must be reviewed at 375, 768, 1280 and 1920 pixels and at breakpoint edges. Production moves, merges and methodology relocations require per-page human approval. No production page has been migrated.')}</Text>
      </div>
    </AboutPanel>
  );
}
