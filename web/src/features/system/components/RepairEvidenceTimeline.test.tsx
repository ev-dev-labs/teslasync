import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { RepairSuggestion } from '@/api/hooks/useDataRepair';
import { RepairEvidenceTimeline } from './RepairEvidenceTimeline';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`)),
  }),
}));
vi.mock('@/lib/dateFormat', () => ({
  formatDateTime: (value: string) => {
    const labels: Record<string, string> = {
      '2026-01-01T06:00:00Z': 'Zulu start',
      '2026-01-01T07:00:00Z': 'Mike observation',
      '2026-01-01T08:00:00Z': 'Alpha contradiction',
      '2026-01-01T07:30:00Z': 'Bravo proposed boundary',
    };
    return labels[value] ?? '—';
  },
}));

const suggestion: RepairSuggestion = {
  kind: 'drive',
  session_id: 42,
  vehicle_id: 7,
  rule: 'drive_open_charging_started',
  confidence: 'high',
  applicable: true,
  started_at: '2026-01-01T06:00:00Z',
  stored_ended_at: null,
  stored_duration_s: null,
  suggested_ended_at: '2026-01-01T07:30:00Z',
  suggested_duration_s: 5400,
  evidence_gap_s: 1800,
  last_in_session_evidence: { ts: '2026-01-01T07:00:00Z', source: 'signal_log', field: 'gear', value: 'D' },
  contradicting_evidence: { ts: '2026-01-01T08:00:00Z', source: 'charging_sessions', field: 'started_at', value: '#9' },
};

describe('RepairEvidenceTimeline chronology', () => {
  it('preserves causal row order even when localized labels sort differently', () => {
    render(<RepairEvidenceTimeline suggestion={suggestion} />);
    const list = screen.getByRole('list', { name: 'Evidence timeline' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Session started'),
      expect.stringContaining('Last evidence the session was still running'),
      expect.stringContaining('Contradicting evidence'),
      expect.stringContaining('Proposed end'),
    ]);
    expect(within(rows[0]!).getByText('Zulu start')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Alpha contradiction')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Bravo proposed boundary')).toBeInTheDocument();
    expect(screen.getByText(/From Zulu start to Alpha contradiction/)).toBeInTheDocument();
    expect(screen.queryByText(/From Zulu start to Bravo proposed boundary/)).toBeNull();
  });

  it('keeps missing in-session observations visible and omits an unknown time span', () => {
    render(<RepairEvidenceTimeline suggestion={{
      ...suggestion, started_at: '', last_in_session_evidence: null,
    }} />);
    expect(screen.getByText('No in-session evidence recorded')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByText(/From .* to /)).toBeNull();
  });
});
