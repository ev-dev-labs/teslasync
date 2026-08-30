/**
 * RepairSuggestionCard contract tests.
 *
 * The card is the review surface for a proposed — NOT applied — session
 * boundary repair. These tests pin the properties that make it safe:
 *
 *   - the evidence is visible (stored boundary, last in-session observation,
 *     the contradiction, the proposal),
 *   - the risk language about un-recomputed measured totals is always present,
 *   - Apply NEVER fires without an explicit confirmation,
 *   - a blocked suggestion is still shown, with its reason, and cannot be
 *     applied,
 *   - per-row pending / error / success states render inline.
 *
 * i18n is stubbed to return the English defaultValue with `{{var}}`
 * interpolation so visible copy is deterministic. `user-event` is not
 * installed in this repo, so interactions go through `fireEvent`.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';

const H = vi.hoisted(() => ({
  preview: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('@/api/hooks/useDataRepair', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useDataRepair')>(
    '@/api/hooks/useDataRepair',
  );
  return {
    ...actual,
    useRepairImpactPreview: () => ({
      mutate: H.preview,
      reset: H.reset,
      isPending: false,
      error: null,
      data: undefined,
    }),
  };
});

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tpl: string, vars?: Record<string, unknown>): string =>
    vars
      ? tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) =>
          k in vars ? String(vars[k]) : `{{${k}}}`,
        )
      : tpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, dflt?: unknown, opts?: unknown) => {
        if (typeof dflt === 'string') {
          const vars = opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : undefined;
          return interpolate(dflt, vars);
        }
        if (dflt && typeof dflt === 'object') {
          const o = dflt as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return interpolate(o.defaultValue, o);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { RepairSuggestionCard } from './RepairSuggestionCard';
import type { RepairSuggestion } from '@/api/hooks/useDataRepair';

function buildSuggestion(overrides?: Partial<RepairSuggestion>): RepairSuggestion {
  return {
    kind: 'drive',
    session_id: 42,
    vehicle_id: 7,
    rule: 'drive_open_charging_started',
    confidence: 'high',
    started_at: '2026-03-29T06:00:00Z',
    stored_ended_at: null,
    stored_duration_s: null,
    last_in_session_evidence: {
      ts: '2026-03-29T07:00:00Z',
      source: 'drive_telemetry',
      field: 'Gear',
      value: 'D',
    },
    contradicting_evidence: {
      ts: '2026-03-29T08:00:00Z',
      source: 'charging_sessions',
      field: 'charging_session.started_at',
      value: '#900',
    },
    suggested_ended_at: '2026-03-29T07:00:00Z',
    suggested_duration_s: 3600,
    evidence_gap_s: 3600,
    applicable: true,
    ...overrides,
  };
}

describe('RepairSuggestionCard', () => {
  beforeEach(() => {
    H.preview.mockReset();
    H.reset.mockReset();
    H.preview.mockImplementation(
      (_input: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.(),
    );
  });

  it('renders the rule, the explanation, and the full evidence timeline', () => {
    render(<RepairSuggestionCard suggestion={buildSuggestion()} onApply={vi.fn()} />);

    expect(screen.getByText('Drive left open, then charging started')).toBeInTheDocument();
    expect(
      screen.getByText(/A car cannot drive and charge at once/i),
    ).toBeInTheDocument();

    const timeline = screen.getByRole('region', { name: 'Evidence timeline' });
    expect(within(timeline).getByText('Session started')).toBeInTheDocument();
    expect(
      within(timeline).getByText('Last evidence the session was still running'),
    ).toBeInTheDocument();
    expect(within(timeline).getByText('Contradicting evidence')).toBeInTheDocument();
    expect(within(timeline).getByText('Proposed end')).toBeInTheDocument();

    // Evidence carries its durable source + field/value so an operator can go
    // verify it, rather than trusting an opaque verdict.
    expect(within(timeline).getByText('Drive telemetry · Gear = D')).toBeInTheDocument();
    expect(
      within(timeline).getByText('Charging record · charging_session.started_at = #900'),
    ).toBeInTheDocument();
  });

  it('always states which fields are NOT recomputed', () => {
    render(<RepairSuggestionCard suggestion={buildSuggestion()} onApply={vi.fn()} />);
    expect(
      screen.getByText(/Measured totals such as distance, energy and speed are left untouched/i),
    ).toBeInTheDocument();
  });

  it('marks an open session and shows "Still open" as the stored end', () => {
    render(<RepairSuggestionCard suggestion={buildSuggestion()} onApply={vi.fn()} />);
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Still open')).toBeInTheDocument();
  });

  it('never applies without an explicit confirmation', () => {
    const onApply = vi.fn();
    render(<RepairSuggestionCard suggestion={buildSuggestion()} onApply={onApply} />);

    fireEvent.click(screen.getByRole('button', { name: /Review & apply/i }));
    // The dialog is open; nothing has been applied yet.
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/This rewrites Drive #42 to end at/i)).toBeInTheDocument();

    // Cancelling leaves the data untouched.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('applies exactly once, with the reviewed suggestion, after confirming', () => {
    const onApply = vi.fn();
    const suggestion = buildSuggestion();
    render(<RepairSuggestionCard suggestion={suggestion} onApply={onApply} />);

    fireEvent.click(screen.getByRole('button', { name: /Review & apply/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply repair' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(suggestion);
  });

  it('shows a blocked suggestion with its reason and disables Apply', () => {
    const onApply = vi.fn();
    render(
      <RepairSuggestionCard
        suggestion={buildSuggestion({ applicable: false, blocked_reason: 'overlaps_next_session' })}
        onApply={onApply}
      />,
    );

    expect(
      screen.getByText(/would still leave the session overlapping the next one/i),
    ).toBeInTheDocument();
    const apply = screen.getByRole('button', { name: /Review & apply/i });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('disables Apply in read-only operational mode', () => {
    render(
      <RepairSuggestionCard
        suggestion={buildSuggestion()}
        onApply={vi.fn()}
        disabled
        disabledReason="Read-only mode"
      />,
    );
    expect(screen.getByRole('button', { name: /Review & apply/i })).toBeDisabled();
  });

  it('renders per-row error text inline', () => {
    render(
      <RepairSuggestionCard
        suggestion={buildSuggestion()}
        onApply={vi.fn()}
        errorMessage="the proposed end overlaps the next session for this vehicle"
      />,
    );
    expect(
      screen.getByText('the proposed end overlaps the next session for this vehicle'),
    ).toBeInTheDocument();
  });

  it('keeps the card visible after a successful apply and marks it applied', () => {
    render(
      <RepairSuggestionCard suggestion={buildSuggestion()} onApply={vi.fn()} isApplied />,
    );
    expect(screen.getByText(/Applied\. Refresh to re-check/i)).toBeInTheDocument();
    // Still on screen — a suggestion must not vanish before a fresh diagnosis.
    expect(screen.getByTestId('repair-suggestion-drive-42')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review & apply/i })).toBeDisabled();
  });

  it('renders the charging variant with the stored boundary of a closed session', () => {
    render(
      <RepairSuggestionCard
        suggestion={buildSuggestion({
          kind: 'charging',
          session_id: 9,
          rule: 'charging_end_after_contradiction',
          confidence: 'medium',
          stored_ended_at: '2026-03-30T02:00:00Z',
        })}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByText('Charging ends long after it really finished')).toBeInTheDocument();
    expect(screen.getByText('Medium confidence')).toBeInTheDocument();
    // A closed session is not badged "Open".
    expect(screen.queryByText('Open')).not.toBeInTheDocument();
    expect(screen.getByTestId('repair-suggestion-charging-9')).toBeInTheDocument();
  });

  it('is null-safe when there is no in-session evidence', () => {
    render(
      <RepairSuggestionCard
        suggestion={buildSuggestion({ last_in_session_evidence: null })}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText('No in-session evidence recorded')).toBeInTheDocument();
    expect(
      screen.queryByText('Last evidence the session was still running'),
    ).not.toBeInTheDocument();
  });
});
