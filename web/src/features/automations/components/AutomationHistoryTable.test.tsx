import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationHistory } from '@/api/types';
import '../../../i18n';
import { AutomationHistoryTable } from './AutomationHistoryTable';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: { locale: 'en-US', timezone: 'UTC' } }),
}));
vi.mock('@/lib/timezone', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/timezone')>(),
  useTimezone: () => 'UTC',
}));

const rows: AutomationHistory[] = [12, 13].map(id => ({
  id, automation_id: 7, automation_name: 'Home arrival', vehicle_id: 2,
  triggered_at: '2026-09-05T12:00:00Z', completed_at: '2026-09-05T12:00:01Z',
  duration_ms: 1000, trigger_type: 'geofence', trigger_snapshot: null,
  conditions_met: true, conditions_snapshot: null, actions_executed: null,
  actions_total: 2, actions_succeeded: 1, actions_failed: 1,
  status: 'failed', error: 'Action timed out', fsm_state: null,
  created_at: '2026-09-05T12:00:00Z',
}));
const observers: { target: Element; callback: ResizeObserverCallback }[] = [];
function resize(width: number) {
  act(() => observers.forEach(({ target, callback }) => callback(
    [{ target, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
  )));
}

beforeEach(() => {
  localStorage.clear();
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) { observers.push({ target, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-mode');
});

describe.each(['light', 'dark'])('AutomationHistoryTable in %s mode', mode => {
  it('retains distinct mobile execution targets, every field and the detail action through desktop resizing', async () => {
    document.documentElement.setAttribute('data-mode', mode);
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const view = render(<AutomationHistoryTable rows={rows} onOpen={onOpen} />);
    resize(375);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const first = screen.getByRole('button', { name: 'Home arrival #12' });
    const second = screen.getByRole('button', { name: 'Home arrival #13' });
    first.focus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenLastCalledWith(12);
    second.focus();
    await user.keyboard(' ');
    expect(onOpen).toHaveBeenLastCalledWith(13);
    const quickView = screen.getAllByRole('button', { name: 'Quick view' })[0];
    expect(quickView).toHaveClass('min-h-11', 'min-w-11');
    quickView.focus();
    await user.keyboard('{Enter}');
    const detail = screen.getByRole('dialog', { name: 'Home arrival #12' });
    for (const field of ['Triggered', 'Automation', 'Outcome', 'Trigger', 'Actions', 'Duration', 'Error']) {
      expect(within(detail).getByText(field)).toBeInTheDocument();
    }
    expect(within(detail).getByText('geofence')).toBeInTheDocument();
    expect(within(detail).getByText('1/2')).toBeInTheDocument();
    expect(within(detail).getByText('Action timed out')).toBeInTheDocument();
    expect(detail.querySelector('[title="2026-09-05T12:00:00.000Z (UTC)"]')).toBeInTheDocument();
    const action = within(detail).getByRole('button', { name: 'Home arrival' });
    expect(action).toHaveClass('min-h-11', 'min-w-11');
    await user.click(action);
    expect(onOpen).toHaveBeenLastCalledWith(12);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(quickView).toHaveFocus();
    resize(1440);
    const table = screen.getByRole('table', { name: 'Automation history' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(7);
    const desktopAction = within(table).getAllByRole('button', { name: 'Home arrival' })[1];
    desktopAction.focus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenLastCalledWith(13);
    expect(view.container.querySelector('[data-mobile-table]')).toBeNull();
  });

  it('uses the rule fallback while still identifying the execution', () => {
    render(<AutomationHistoryTable rows={[{ ...rows[0], automation_name: '' }]} onOpen={vi.fn()} />);
    resize(375);
    expect(screen.getByRole('button', { name: 'Rule #7 #12' })).toBeInTheDocument();
  });
});
