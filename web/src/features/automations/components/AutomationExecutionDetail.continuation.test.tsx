import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '@/components/ui/app-designs/designs';
import { expectAppDesignDataMode } from '@/components/feedback/appDesignCss.test-utils';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { formatDateTime } from '@/lib/dateFormat';
import type { AutomationExecutionDetail as Detail } from '@/api/types';
import { AutomationExecutionDetail } from './AutomationExecutionDetail';

const source = vi.hoisted(() => ({
  data: undefined as (Detail & {
    action_results_availability?: { status: string; complete: boolean; truncated: boolean; total: number };
    fsm_transitions_availability?: { status: string; complete: boolean; truncated: boolean; total: number };
  }) | null | undefined,
  error: null as Error | null,
  retry: vi.fn(),
  isLoading: false,
}));
vi.mock('@/api/hooks/useAutomations', () => ({
  useAutomationExecutionDetail: () => ({
    data: source.data, error: source.error, isError: source.error != null,
    isLoading: source.isLoading, refetch: source.retry,
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? '')),
    i18n: { language: 'en' },
  }),
}));

function detail(): Detail {
  return {
    id: 91, automation_id: 12, automation_name: 'Full retained execution name',
    vehicle_id: 3, triggered_at: '2026-10-05T23:00:00Z', completed_at: null,
    duration_ms: null, trigger_type: 'signal', trigger_snapshot: null,
    conditions_met: true, conditions_snapshot: null, actions_total: 1,
    actions_succeeded: 0, actions_failed: 1, status: 'failed',
    error: 'Complete retained execution failure', fsm_state: 'parked',
    created_at: '2026-10-05T23:00:00Z', success_rate: 0,
    actions_executed: [{ action: 'notification', diagnostic: 'Complete action diagnostic without truncation' }],
    fsm_transitions: [{
      id: 18, vehicle_id: 3, ts: '2026-10-05T23:00:00Z', fsm_name: 'vehicle',
      from_state: 'charging', to_state: 'parked', trigger: 'charge-ended',
    }],
  };
}

function renderDetail() {
  const onClose = vi.fn();
  render(<MemoryRouter><AutomationExecutionDetail id={91} onClose={onClose} /></MemoryRouter>);
  return onClose;
}

describe('Execution detail continuation retention', () => {
  beforeEach(() => {
    source.data = detail();
    source.error = null;
    source.retry.mockClear();
    source.isLoading = false;
  });

  it.each(PACK_IDS)('%s composes real detail surfaces and ordered full records without changing their evidence', pack => {
    const original = detail();
    original.actions_executed = [
      { action: 'notification', success: false, diagnostic: 'Complete action diagnostic without truncation', value: 0 },
      { action: 'notification', success: true, source: null, message: '<script>not executable</script>' },
    ];
    original.fsm_transitions = [
      ...original.fsm_transitions,
      { ...original.fsm_transitions[0], id: 19, ts: '2026-10-05T23:01:00Z', from_state: 'parked', to_state: 'asleep' },
    ];
    source.data = original;
    const before = JSON.stringify(source.data);
    const root = document.documentElement;
    for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) root.setAttribute(name, value);
    const onClose = renderDetail();
    const release = observeAppDesignScopes(root);
    try {
      const dialog = screen.getByRole('dialog', { name: 'Execution details' });
      const sections = dialog.querySelectorAll('section[data-app-part="panel"][data-surface-variant="standalone"]');
      expect(sections).toHaveLength(2);
      const identity = postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'packs', APP_DESIGN_PACK_FILES[pack]), 'utf8'));
      for (const section of sections) {
        const matches: string[] = [];
        identity.walkRules(rule => {
          if (rule.selector.includes('[data-app-part~="panel"]')) {
            matches.push(...rule.selectors.filter(selector => [...document.querySelectorAll(selector)].includes(section)));
          }
        });
        expect(matches, `${pack} independent section paint`).not.toHaveLength(0);
      }
      const lists = dialog.querySelectorAll('ul[data-app-list="records"]');
      expect(lists).toHaveLength(2);
      const mode = APPLICATION_DESIGNS[pack].data;
      for (const list of lists) {
        expectAppDesignDataMode(list, mode, '[data-app-list="records"]');
        expect(list.children).toHaveLength(2);
        for (const record of list.children) {
          expect(record.tagName).toBe('LI');
          expectAppDesignDataMode(record, mode, '[data-app-card-kind="record"]');
          expectAppDesignDataMode(record.querySelector('[data-app-part="record-body"]')!, mode, '[data-app-part~="record-body"]');
        }
      }
      [...lists[0].children].forEach((record, index) => {
        expect(record.querySelector('[data-app-part="record-body"]')?.textContent)
          .toBe(JSON.stringify(original.actions_executed?.[index], null, 2));
      });
      expect(dialog.querySelector('script')).toBeNull();
      expect([...lists[1].children].map(record => record.querySelector('[data-app-part="record-body"]')?.textContent))
        .toEqual(['vehicle: charging → parked', 'vehicle: parked → asleep']);
      expect([...lists[1].querySelectorAll('[data-app-part="record-header"]')].map(header => header.textContent))
        .toEqual(original.fsm_transitions.map(transition => formatDateTime(transition.ts, { tz: 'UTC', locale: 'en-US' })));
      expect(dialog).toHaveTextContent('Complete retained execution failure');
      expect(dialog).toHaveTextContent('0/1');
      expect(JSON.stringify(source.data)).toBe(before);
      expect(source.retry).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole('button', { name: /close/i }));
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      release();
      for (const name of Object.keys(getAppDesignAttributes(pack))) root.removeAttribute(name);
    }
  });

  it('keeps native evidence neutral without an app profile and preserves loading and fatal recovery', () => {
    source.data = undefined;
    source.isLoading = true;
    const onClose = vi.fn();
    const view = render(<MemoryRouter><AutomationExecutionDetail id={91} onClose={onClose} /></MemoryRouter>);
    expect(screen.getByRole('dialog').querySelector('[data-app-part~="skeleton"]')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Action results' })).not.toBeInTheDocument();
    source.isLoading = false;
    source.error = new Error('initial detail failed');
    view.rerender(<MemoryRouter><AutomationExecutionDetail id={91} onClose={onClose} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(source.retry).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    source.data = detail();
    source.error = null;
    view.rerender(<MemoryRouter><AutomationExecutionDetail id={91} onClose={onClose} /></MemoryRouter>);
    const sections = screen.getByRole('dialog').querySelectorAll('section[data-app-part="panel"]');
    expect(sections).toHaveLength(2);
    for (const section of sections) expect(section).not.toHaveAttribute('data-app-design-owner');
    expect(screen.getByText('vehicle: charging → parked')).toBeInTheDocument();
  });

  it('retains every detail section on refresh failure and retries without closing', () => {
    source.error = new Error('detail refresh unavailable');
    const onClose = renderDetail();
    expect(screen.getByText('Full retained execution name')).toBeInTheDocument();
    expect(screen.getByText('Complete retained execution failure')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Action results' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vehicle state transitions' })).toBeInTheDocument();
    expect(screen.getByText(/Complete action diagnostic without truncation/)).toHaveClass('whitespace-pre-wrap', 'break-words');
    expect(screen.getByText('vehicle: charging → parked')).toBeInTheDocument();
    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(source.retry).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows explicit unavailable recovery instead of fabricating a record for a null response', () => {
    source.data = null;
    const onClose = renderDetail();
    expect(screen.getByText('Execution details are unavailable.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Action results' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(source.retry).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(['failed', 'unavailable', 'not_applicable'])('keeps empty subsection shells without claiming no transitions when %s', (status) => {
    source.data = {
      ...detail(), actions_executed: [], fsm_transitions: [],
      action_results_availability: { status: 'unavailable', complete: false, truncated: false, total: 0 },
      fsm_transitions_availability: { status, complete: false, truncated: false, total: 0 },
    };
    renderDetail();
    expect(screen.getByRole('heading', { name: 'Action results' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vehicle state transitions' })).toBeInTheDocument();
    expect(screen.queryByText('No vehicle state transitions were recorded during this execution window.')).not.toBeInTheDocument();
    expect(screen.queryByText('No action results are recorded for this execution.')).not.toBeInTheDocument();
    const message = status === 'failed' ? 'This history section could not be loaded.'
      : status === 'not_applicable' ? 'No vehicle is associated with this execution.' : 'History availability is unknown.';
    expect(screen.getAllByText(message).length).toBeGreaterThan(0);
  });

  it('claims empty transitions only for a successfully loaded complete window', () => {
    source.data = {
      ...detail(), fsm_transitions: [],
      fsm_transitions_availability: { status: 'available', complete: true, truncated: false, total: 0 },
    };
    renderDetail();
    expect(screen.getByText('No vehicle state transitions were recorded during this execution window.')).toBeInTheDocument();
  });

  it.each([true, false])('preserves populated transitions while warning about incomplete coverage (truncated=%s)', (truncated) => {
    source.data = {
      ...detail(),
      fsm_transitions_availability: { status: 'available', complete: false, truncated, total: truncated ? 101 : 1 },
    };
    renderDetail();
    expect(screen.getByText('vehicle: charging → parked')).toBeInTheDocument();
    expect(screen.getByText(truncated ? 'Only part of this history is shown.' : 'This execution window is still open; history may be incomplete.')).toBeInTheDocument();
  });
});
