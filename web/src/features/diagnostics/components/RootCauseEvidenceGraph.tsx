import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Network } from 'lucide-react';
import { GlassPanel, PanelTitle, Text, Caption } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { chartTokens } from '@/lib/tokens';
import type { EvidenceGraph, EvidenceRelation } from '../lib/rootCauseIntelligence';

const GRAPH_SIZE = 320;
const CENTER = GRAPH_SIZE / 2;
const CANDIDATE_ORBIT_R = 120;
const FOCAL_NODE_R = 30;
const CANDIDATE_NODE_R = 16;
const CANDIDATE_NODE_R_NO_EVIDENCE = 10;

/** Solid = leads, dashed = lags, dotted = concurrent — an accessibility-
 *  minded encoding that doesn't rely on hue alone to convey `relation`. */
function relationDashArray(relation: EvidenceRelation): string | undefined {
  if (relation === 'lags') return '7 5';
  if (relation === 'concurrent') return '2 4';
  return undefined;
}

interface CandidateLayout {
  id: string;
  x: number;
  y: number;
  color: string;
  hasEvidence: boolean;
  sampleCount: number;
  relation: EvidenceRelation | null;
  strength: number;
}

export interface RootCauseEvidenceGraphProps {
  graph: EvidenceGraph;
  hasChosenSignal: boolean;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}

/**
 * Hand-rolled radial evidence graph: the focal signal at the center, its
 * bounded set of related candidates arranged around it. Candidates that
 * cleared the evidence bar for a ranked hypothesis get a solid node plus an
 * edge (styled by `relation`); candidates that were considered but did not
 * corroborate render as a hollow, unconnected node so "we looked and found
 * nothing" stays visually distinct from "we didn't look".
 *
 * The SVG itself is `aria-hidden` (a graphic can't be usefully read node by
 * node by a screen reader) — the adjacent `<ul>` legend carries the exact
 * same information in accessible, visible text, not just for assistive
 * tech but for any reader who prefers words over a diagram.
 */
export function RootCauseEvidenceGraph({
  graph,
  hasChosenSignal,
  isLoading,
  isError,
  error,
  onRetry,
  className,
}: RootCauseEvidenceGraphProps) {
  const { t } = useTranslation();
  const focal = graph.nodes.find((n) => n.kind === 'focal') ?? null;
  const candidates = graph.nodes.filter((n) => n.kind === 'candidate');
  const edgeByTarget = useMemo(() => new Map(graph.edges.map((e) => [e.target, e] as const)), [graph.edges]);

  const layout: CandidateLayout[] = useMemo(() => {
    const n = candidates.length;
    return candidates.map((c, i) => {
      const angle = -Math.PI / 2 + (n === 0 ? 0 : (2 * Math.PI * i) / n);
      const edge = edgeByTarget.get(c.id);
      return {
        id: c.id,
        x: CENTER + CANDIDATE_ORBIT_R * Math.cos(angle),
        y: CENTER + CANDIDATE_ORBIT_R * Math.sin(angle),
        color: chartTokens.series[i % chartTokens.series.length]!,
        hasEvidence: c.hasEvidence,
        sampleCount: c.sampleCount,
        relation: edge?.relation ?? null,
        strength: edge?.strength ?? 0,
      };
    });
  }, [candidates, edgeByTarget]);

  const isEmpty = focal == null || candidates.length === 0;

  return (
    <GlassPanel className={className ?? 'p-4 sm:p-5'}>
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Network className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('rootCauseIntelligence.graph.title', 'Evidence Graph')}
      </PanelTitle>
      {isError ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <Skeleton height={96} />
      ) : isEmpty ? (
        <EmptyState /* no-action: the graph appears once a focal signal with a bounded related-signal set is analyzed. */
          icon={<Network className="h-8 w-8" />}
          message={
            hasChosenSignal
              ? t('rootCauseIntelligence.graph.noRelated', 'No related signals were identified in the catalog for this focal signal.')
              : t('rootCauseIntelligence.graph.pickOne', 'Choose a signal above to see its evidence graph.')
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[auto_1fr] lg:items-center">
          <svg
            viewBox={`0 0 ${GRAPH_SIZE} ${GRAPH_SIZE}`}
            width={GRAPH_SIZE}
            height={GRAPH_SIZE}
            className="mx-auto w-full max-w-xs"
            aria-hidden="true"
          >
            {layout.map((c) => (
              <line
                key={`edge-${c.id}`}
                x1={CENTER}
                y1={CENTER}
                x2={c.x}
                y2={c.y}
                stroke={c.relation != null ? c.color : 'var(--border-subtle)'}
                strokeWidth={c.relation != null ? Math.min(4, 1 + c.strength * 3) : 1}
                strokeDasharray={c.relation != null ? relationDashArray(c.relation) : '2 3'}
                strokeOpacity={c.relation != null ? 0.85 : 0.4}
              />
            ))}
            {layout.map((c) => (
              <circle
                key={`node-${c.id}`}
                cx={c.x}
                cy={c.y}
                r={c.hasEvidence ? CANDIDATE_NODE_R : CANDIDATE_NODE_R_NO_EVIDENCE}
                fill={c.hasEvidence ? c.color : 'none'}
                fillOpacity={0.85}
                stroke={c.color}
                strokeWidth={c.hasEvidence ? 0 : 1.5}
              />
            ))}
            <circle cx={CENTER} cy={CENTER} r={FOCAL_NODE_R} fill="var(--theme-primary)" />
            <text x={CENTER} y={CENTER + 4} textAnchor="middle" fontSize={10} fill="var(--text-on-accent)">
              {t('rootCauseIntelligence.graph.focalNodeLabel', 'Focal')}
            </text>
          </svg>
          <ul className="space-y-2">
            <li className="flex items-center gap-2">
              <svg width={10} height={10} aria-hidden="true">
                <circle cx={5} cy={5} r={5} fill="var(--theme-primary)" />
              </svg>
              <Text variant="body" weight="semibold" className="break-all">
                {focal?.id}
              </Text>
              <Caption>{t('rootCauseIntelligence.graph.focalTag', '(focal signal)')}</Caption>
            </li>
            {layout.map((c) => {
              const relationText =
                c.relation === 'leads'
                  ? t('rootCauseIntelligence.graph.leads', 'leads')
                  : c.relation === 'lags'
                    ? t('rootCauseIntelligence.graph.lags', 'lags')
                    : c.relation === 'concurrent'
                      ? t('rootCauseIntelligence.graph.concurrent', 'concurrent')
                      : '';
              return (
                <li key={c.id} className="flex items-start gap-2">
                  <svg width={10} height={10} className="mt-1 shrink-0" aria-hidden="true">
                    <circle cx={5} cy={5} r={5} fill={c.hasEvidence ? c.color : 'none'} stroke={c.color} strokeWidth={c.hasEvidence ? 0 : 1.5} />
                  </svg>
                  <div className="min-w-0">
                    <Text variant="body" className="break-all">
                      {c.id}
                    </Text>
                    <Caption>
                      {c.relation != null
                        ? t('rootCauseIntelligence.graph.relationSamples', '{{relation}} · {{n}} samples', { relation: relationText, n: c.sampleCount })
                        : t('rootCauseIntelligence.graph.consideredOnly', 'considered, no corroborating shift · {{n}} samples', { n: c.sampleCount })}
                    </Caption>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </GlassPanel>
  );
}
