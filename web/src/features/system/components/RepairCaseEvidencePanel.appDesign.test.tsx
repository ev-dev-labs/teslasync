import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import type { RepairCase, RepairImpactPreview, RepairSuggestion } from '@/api/hooks/useDataRepair';
import { matchesAppDesignCss } from '@/components/feedback/appDesignCss.test-utils';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { RepairCaseEvidencePanel } from './RepairCaseEvidencePanel';
import { RepairEvidenceTimeline } from './RepairEvidenceTimeline';
import { RepairImpactSummary } from './RepairImpactSummary';

const finding: RepairCase = {
  id: 7, fingerprint: 'drive:42:duration_mismatch', kind: 'drive', session_id: 42, vehicle_id: 3,
  rule: 'duration_mismatch', confidence: 'high', status: 'open', applicable: false,
  blocked_reason: 'structural_anomaly_requires_manual_correction',
  evidence_started_at: '2026-08-25T09:00:00Z', evidence_contradiction_ts: '2026-08-25T10:00:00Z',
  evidence_contradiction_src: 'drives', evidence_contradiction_field: 'duration_s',
  evidence_contradiction_value: 'stored=0 computed=3600',
  evidence_gap_s: 0, first_seen_at: '2026-08-25T10:01:00Z', last_seen_at: '2026-08-25T10:02:00Z',
  created_at: '2026-08-25T10:01:00Z', updated_at: '2026-08-25T10:02:00Z',
};
const suggestion: RepairSuggestion = {
  kind: 'drive', session_id: 42, vehicle_id: 3, rule: 'drive_open_charging_started',
  confidence: 'high', applicable: true, started_at: '2026-08-25T09:00:00Z',
  stored_ended_at: null, stored_duration_s: null, suggested_ended_at: '2026-08-25T10:00:00Z',
  suggested_duration_s: 3600, evidence_gap_s: 0, last_in_session_evidence: null,
  contradicting_evidence: { ts: '2026-08-25T10:00:00Z', source: 'charging_sessions', field: 'started_at', value: '#9' },
};
const preview: RepairImpactPreview = {
  kind: 'drive', session_id: 42, rule: 'drive_open_charging_started', source: 'suggestion', status: 'ready',
  started_at: suggestion.started_at, current_ended_at: null, proposed_ended_at: suggestion.suggested_ended_at,
  current_duration_s: null, proposed_duration_s: 3600,
  fields_changed: [{
    field: 'duration_s', before: { type: 'float64', float64: -0 }, after: { type: 'float64', float64: 0.000123456789 },
  }],
  fields_preserved: [{ field: 'distance_m', value: { type: 'null', null: true }, reason: 'measured' }],
  warnings: ['Original server warning'],
};

describe('Repair evidence source frames', () => {
  it.each(PACK_IDS)('%s composes real observation, timeline and preserved-field frames without rewriting evidence or SI source values', pack => {
    const original = structuredClone({ finding, suggestion, preview });
    const view = render(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
      <RepairCaseEvidencePanel repairCase={finding} />
      <RepairEvidenceTimeline suggestion={suggestion} />
      <RepairImpactSummary preview={preview} />
    </div>);
    const release = observeAppDesignScopes(view.container);
    try {
      const contract = `[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`;
      const contradiction = screen.getByText('Contradicting observation').closest('[data-app-feedback-kind="notice"]')!;
      expect(contradiction).toHaveAttribute('data-app-tone', 'warning');
      expect(matchesAppDesignCss(contradiction, contract).length).toBeGreaterThan(0);
      expect(contradiction.querySelector(':scope > [data-app-part="feedback-content"]')).not.toBeNull();
      expect(within(contradiction as HTMLElement).getByText('Stored duration')).toBeInTheDocument();
      expect(within(contradiction as HTMLElement).getByText('Duration from start and end')).toBeInTheDocument();
      const technical = within(contradiction as HTMLElement).getByText('Technical details');
      fireEvent.click(technical);
      expect(contradiction.querySelector('[data-app-part="feedback-detail"]')?.textContent)
        .toBe('drives · duration_s · stored=0 computed=3600');
      expect(screen.queryByText('Last in-session observation')).toBeNull();
      const timeline = screen.getByRole('region', { name: 'Evidence timeline' });
      expect(timeline).toHaveAttribute('data-app-part', 'panel');
      const identity = postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'packs', `${pack}.css`), 'utf8'));
      const rules: string[] = [];
      identity.walkRules(rule => {
        rules.push(...rule.selectors.filter(selector =>
          selector.includes('[data-app-part~="panel"]') && timeline.matches(selector)));
      });
      expect(rules.length).toBeGreaterThan(0);
      const rows = within(timeline).getAllByRole('listitem');
      expect(rows).toHaveLength(4);
      expect(rows[1]).toHaveTextContent('No in-session evidence recorded');
      expect(rows[2]).toHaveTextContent('started_at = #9');
      expect(rows[3]).toHaveTextContent('Proposed end');
      const preserved = screen.getByText('1 measured fields stay unchanged').closest('[data-app-feedback-kind="notice"]')!;
      expect(matchesAppDesignCss(preserved, contract).length).toBeGreaterThan(0);
      expect(preserved.querySelector('[data-app-part="feedback-message"]')).toHaveTextContent('Distance m');
      expect(screen.getByText('duration_s: -0 → 0.000123456789')).toBeInTheDocument();
      expect(screen.getByText('Original server warning')).toBeInTheDocument();
      expect(screen.getByText(/The server revalidated the current row/)).toBeInTheDocument();
      expect({ finding, suggestion, preview }).toEqual(original);
    } finally {
      release();
      view.unmount();
    }
  });

  it('keeps unknown observation provenance and exact contradictory source strings without coercing blanks or zero', () => {
    render(<RepairCaseEvidencePanel repairCase={{
      ...finding, rule: 'drive_open_charging_started', applicable: true,
      evidence_last_in_session_ts: '2026-08-25T09:58:00Z',
      evidence_last_in_session_src: null, evidence_last_in_session_field: '', evidence_last_in_session_value: '0',
      evidence_contradiction_value: '-0.000000001e-12',
    }} />);
    expect(screen.getByText('— · · 0')).toBeInTheDocument();
    expect(screen.getByText('drives · duration_s · -0.000000001e-12')).toBeInTheDocument();
  });
});
