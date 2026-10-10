import { Info } from 'lucide-react';
import { CompositionRail, KVList, type CompositionRailSegment } from '@/components/data-display';
import { Badge, Text } from '@/components/ui';
import { FixtureSection } from './FixtureSection';
import { useCompletionLabels } from './useCompletionLabels';

export function EvidenceFixtures() {
  const c = useCompletionLabels();
  const segments: CompositionRailSegment[] = [
    { id: 'verified', label: c.verified, widthPercent: 75, detail: c.count750, fillClassName: 'bg-emerald-500' },
    { id: 'pending', label: c.pending, widthPercent: 24.9, detail: c.count249, fillClassName: 'bg-amber-500' },
    { id: 'tiny', label: c.tiny, widthPercent: 0.1, detail: c.count1, fillClassName: 'bg-indigo-500', hideFromTrack: true },
    { id: 'zero', label: c.zero, widthPercent: 0, detail: c.count0, fillClassName: 'bg-slate-500' },
  ];
  const details = [
    { id: 'identity', label: c.identity, leading: <Info aria-hidden="true" className="h-4 w-4" />, value: c.identityValue },
    { id: 'provenance', label: c.readiness, value: <div className="space-y-2"><Badge variant="info">{c.readyBadge}</Badge><Text as="p" variant="bodySm">{c.note}</Text></div> },
    { id: 'unknown', label: c.unknownLabel, value: c.unknown },
    { id: 'zero', label: c.zeroLabel, value: '0' },
  ];
  return (
    <FixtureSection id="evidence" title={c.evidenceTitle} description={c.evidenceDescription}>
      <div data-shared-contract="composition-rail" className="min-w-0 space-y-4">
        <CompositionRail segments={segments} summary={c.compositionSummary} size="lg" />
        <CompositionRail segments={segments.map(segment => ({ ...segment, widthPercent: 0, detail: c.count0 }))}
          summary={c.zeroSummary} size="sm" />
      </div>
      <div data-shared-contract="kv-list" className="min-w-0 space-y-4">
        <KVList items={details} layout="responsive" wrap />
        <div className="max-w-[320px]"><KVList items={details} layout="stacked" wrap /></div>
      </div>
    </FixtureSection>
  );
}
