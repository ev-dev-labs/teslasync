import { describe, expect, it } from 'vitest';
import { PageLayout, Section, CardGrid, LayoutCard, ChartCard, SourceContent } from './layout';
import { StatStrip, StatGroup, CompositionRail, KVList } from './data-display';
import { WeekdaySelect, PillFilterBar } from './forms';
import { CodeBlock, CopyButton } from './ui';
import { PageLayout as ExistingPageLayout } from './layout/layout-reference/PageLayout';
import { Section as ExistingSection } from './layout/layout-reference/Section';
import { CardGrid as ExistingCardGrid } from './layout/layout-reference/CardGrid';
import { LayoutCard as ExistingLayoutCard } from './layout/layout-reference/LayoutCard';
import { ChartCard as ExistingChartCard } from './layout/layout-reference/ChartCard';
import { SourceContent as ExistingSourceContent } from './layout/layout-reference/SourceContent';
import { StatStrip as ExistingStatStrip } from './data-display/stat-reference/StatStrip';
import { StatGroup as ExistingStatGroup } from './data-display/stat-reference/StatGroup';
import { CompositionRail as ExistingCompositionRail } from './data-display/CompositionRail';
import { KVList as ExistingKVList } from './data-display/KVList';
import { WeekdaySelect as ExistingWeekdaySelect } from './forms/WeekdaySelect';
import { PillFilterBar as ExistingPillFilterBar } from './forms/PillFilterBar';
import { CodeBlock as ExistingCodeBlock } from './ui/CodeBlock';
import { CopyButton as ExistingCopyButton } from './ui/CopyButton';

describe('canonical modernization component exports', () => {
  it.each([
    ['PageLayout', PageLayout, ExistingPageLayout],
    ['Section', Section, ExistingSection],
    ['CardGrid', CardGrid, ExistingCardGrid],
    ['LayoutCard', LayoutCard, ExistingLayoutCard],
    ['ChartCard', ChartCard, ExistingChartCard],
    ['SourceContent', SourceContent, ExistingSourceContent],
    ['StatStrip', StatStrip, ExistingStatStrip],
    ['StatGroup', StatGroup, ExistingStatGroup],
    ['CompositionRail', CompositionRail, ExistingCompositionRail],
    ['KVList', KVList, ExistingKVList],
    ['WeekdaySelect', WeekdaySelect, ExistingWeekdaySelect],
    ['PillFilterBar', PillFilterBar, ExistingPillFilterBar],
    ['CodeBlock', CodeBlock, ExistingCodeBlock],
    ['CopyButton', CopyButton, ExistingCopyButton],
  ])('exports the existing %s implementation without a competing wrapper', (_name, component, existing) => {
    expect(component).toBe(existing);
  });
});
