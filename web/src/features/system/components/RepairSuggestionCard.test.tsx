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
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';

const H = vi.hoisted(() => ({
  preview: vi.fn(),
  reset: vi.fn(),
  canWrite: true,
  confirm: undefined as (() => void) | undefined,
}));

vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => ({
    canWrite: H.canWrite,
    writeBlockReason: H.canWrite ? null : 'Reconnect before making operational changes.',
  }),
}));

vi.mock('@/components/ui', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui')>('@/components/ui');
  return {
    ...actual,
    ConfirmDialog: (props: Parameters<typeof actual.ConfirmDialog>[0]) => {
      H.confirm = props.onConfirm;
      return <actual.ConfirmDialog {...props} />;
    },
  };
});

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
import type { ApplyRepairInput, RepairImpactPreview, RepairSuggestion } from '@/api/hooks/useDataRepair';

function buildPreview(input: ApplyRepairInput): RepairImpactPreview {
  return {
    kind: input.rule.startsWith('drive_') ? 'drive' : 'charging',
    session_id: input.id,
    rule: input.rule,
    source: 'suggestion',
    status: 'ready',
    started_at: '2026-03-29T06:00:00Z',
    current_ended_at: input.expected_stored_ended_at || null,
    proposed_ended_at: input.ended_at,
    current_duration_s: null,
    proposed_duration_s: 3600,
    fields_changed: [],
    fields_preserved: [],
    warnings: ['Original reviewed impact'],
  };
}

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
    H.canWrite = true;
    H.confirm = undefined;
    H.preview.mockImplementation(
      (input: ApplyRepairInput, options?: { onSuccess?: (impact: RepairImpactPreview) => void }) =>
        options?.onSuccess?.(buildPreview(input)),
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

  it('keeps causal evidence order and bounds the summary by the contradiction, not the earlier proposal', () => {
    render(<RepairSuggestionCard suggestion={buildSuggestion()} onApply={vi.fn()} />);
    const region = screen.getByRole('region', { name: 'Evidence timeline' });
    const list = within(region).getByRole('list', { name: 'Evidence timeline' });
    const entries = within(list).getAllByRole('listitem');
    expect(entries).toHaveLength(4);
    expect(entries[0]).toHaveTextContent('Session started');
    expect(entries[1]).toHaveTextContent('Last evidence the session was still running');
    expect(entries[2]).toHaveTextContent('Contradicting evidence');
    expect(entries[3]).toHaveTextContent('Proposed end');
    expect(entries[2]).toHaveTextContent('Charging record · charging_session.started_at = #900');
    expect(entries[3]).toHaveTextContent('Never later than the contradicting evidence');
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

  it('rejects changed same-ID evidence while retaining the original reviewed impact and message', () => {
    const onApply = vi.fn();
    const original = buildSuggestion({ stored_ended_at: '2026-03-29T09:00:00Z' });
    const { rerender } = render(<RepairSuggestionCard suggestion={original} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /Review & apply/i }));
    const message = screen.getByText(/This rewrites Drive #42 to end at/i).textContent;
    rerender(<RepairSuggestionCard suggestion={buildSuggestion({
      ...original,
      suggested_ended_at: '2026-03-29T07:30:00Z',
      stored_ended_at: '2026-03-29T08:30:00Z',
    })} onApply={onApply} />);
    expect(screen.getByText(/This rewrites Drive #42 to end at/i).textContent).toBe(message);
    expect(screen.getByText('Original reviewed impact')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply repair' })).toBeDisabled();
    act(() => H.confirm?.());
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    ['vehicle', { vehicle_id: 8 }],
    ['session', { session_id: 43 }],
    ['kind', { kind: 'charging', rule: 'charging_open_drive_started' }],
    ['evidence', { evidence_gap_s: 3599.001 }],
  ] satisfies [string, Partial<RepairSuggestion>][])('rejects obsolete reviewed %s identity or revision', (_name, change) => {
    const onApply = vi.fn();
    const original = buildSuggestion();
    const { rerender } = render(<RepairSuggestionCard suggestion={original} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /Review & apply/i }));
    rerender(<RepairSuggestionCard suggestion={{ ...original, ...change }} onApply={onApply} />);
    act(() => H.confirm?.());
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Apply repair' })).toBeDisabled();
  });

  it('does not renew an obsolete review after a scope change and return', () => {
    const onApply = vi.fn();
    const original = buildSuggestion();
    const { rerender } = render(<RepairSuggestionCard suggestion={original} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /Review & apply/i }));
    rerender(<RepairSuggestionCard suggestion={{ ...original, vehicle_id: 8 }} onApply={onApply} />);
    rerender(<RepairSuggestionCard suggestion={original} onApply={onApply} />);
    expect(screen.getByRole('button', { name: 'Apply repair' })).toBeDisabled();
    act(() => H.confirm?.());
    expect(onApply).not.toHaveBeenCalled();
  });

  it('preserves raw SI precision and the stored-boundary concurrency pin in an immutable reviewed payload', () => {
    const onApply = vi.fn();
    const original = buildSuggestion({
      stored_ended_at: '2026-03-29T09:00:00.123456Z',
      suggested_ended_at: '2026-03-29T07:00:00.123456Z',
      suggested_duration_s: 3600.123456,
      evidence_gap_s: 3599.876544,
    });
    const expected = structuredClone(original);
    render(<RepairSuggestionCard suggestion={original} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /Review & apply/i }));
    original.contradicting_evidence.value = 'new unreviewed observation';
    fireEvent.click(screen.getByRole('button', { name: 'Apply repair' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith(expected);
    expect(onApply.mock.calls[0][0]).not.toBe(original);
    expect(H.preview.mock.calls[0][0]).toEqual({
      id: 42,
      ended_at: expected.suggested_ended_at,
      rule: expected.rule,
      expected_stored_ended_at: expected.stored_ended_at,
    });
  });

  it.each([
    ['caller read-only', { disabled: true }],
    ['blocked', { suggestion: buildSuggestion({ applicable: false }) }],
    ['already applied', { isApplied: true }],
    ['applying', { isApplying: true }],
  ])('guards an already-open confirmation after %s eligibility changes', (_name, props) => {
    const onApply = vi.fn();
    const original = buildSuggestion();
    const { rerender } = render(<RepairSuggestionCard suggestion={original} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /Review & apply/i }));
    rerender(<RepairSuggestionCard suggestion={original} onApply={onApply} {...props} />);
    expect(screen.getByRole('button', { name: 'Apply repair' })).toBeDisabled();
    act(() => H.confirm?.());
    expect(onApply).not.toHaveBeenCalled();
  });

  it('uses the actual operational write guard and preserves Cancel and its reason', () => {
    const onApply = vi.fn();
    const original = buildSuggestion();
    const { rerender } = render(<RepairSuggestionCard suggestion={original} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /Review & apply/i }));
    H.canWrite = false;
    rerender(<RepairSuggestionCard suggestion={original} onApply={onApply} />);
    expect(screen.getByRole('button', { name: 'Apply repair' })).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent('Reconnect before making operational changes.');
    act(() => H.confirm?.());
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ignores late previews after revision changes and after disposal', () => {
    let complete: ((impact: RepairImpactPreview) => void) | undefined;
    H.preview.mockImplementation((_input: ApplyRepairInput, options: { onSuccess: typeof complete }) => {
      complete = options.onSuccess;
    });
    const original = buildSuggestion();
    const onApply = vi.fn();
    const { rerender, unmount } = render(<RepairSuggestionCard suggestion={original} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /Review & apply/i }));
    const impact = buildPreview(H.preview.mock.calls[0][0]);
    rerender(<RepairSuggestionCard suggestion={{ ...original, vehicle_id: 8 }} onApply={onApply} />);
    act(() => complete?.(impact));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();
    act(() => complete?.(impact));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('allows an unchanged cloned suggestion to confirm after an ordinary rerender', () => {
    const original = buildSuggestion();
    const onApply = vi.fn();
    const { rerender } = render(<RepairSuggestionCard suggestion={original} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /Review & apply/i }));
    rerender(<RepairSuggestionCard suggestion={structuredClone(original)} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply repair' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith(original);
  });
});
