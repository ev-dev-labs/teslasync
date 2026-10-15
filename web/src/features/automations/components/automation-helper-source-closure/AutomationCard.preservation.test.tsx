import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AutomationCard } from '../../pages/AutomationCard';
import type { Automation } from '@/api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') return options;
      let value = typeof options?.defaultValue === 'string' ? options.defaultValue : key;
      for (const [name, replacement] of Object.entries(options ?? {})) {
        value = value.replace(`{{${name}}}`, String(replacement));
      }
      return value;
    },
  }),
}));
vi.mock('@/components/ui', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui')>('@/components/ui');
  return {
    ...actual,
    PinButton: ({ itemType, itemId }: { itemType: string; itemId: number }) => (
      <span data-testid="pin-identity" data-item-type={itemType} data-item-id={itemId} />
    ),
  };
});
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatRelativeTime: (value: string) => `relative:${value}`,
    formatDateTime: (value: string) => `date:${value}`,
  }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtInt: (value: number) => String(value) }),
}));

const automation = (overrides: Partial<Automation> = {}): Automation => ({
  id: 79,
  name: 'Long automation name with every word retained',
  description: 'Detailed description with a second sentence retained in every allocated width.',
  enabled: true,
  vehicle_id: 28,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  stop_on_failure: false,
  notify_on_run: false,
  notify_on_failure: false,
  seasonal_start: null,
  seasonal_end: null,
  last_triggered_at: '2026-01-02T00:00:00Z',
  last_success_at: null,
  last_failure_at: null,
  execution_count: 12,
  failure_count: 3,
  consecutive_failures: 0,
  auto_disabled: false,
  auto_disabled_reason: null,
  preset_id: null,
  next_fire_time: '2026-01-03T00:00:00Z',
  conflicts: [
    { automation_id: 100, automation_name: 'Warning peer', reason: 'Full warning reason', severity: 'warning' },
    { automation_id: 101, automation_name: 'Information peer', reason: 'Full information reason', severity: 'info' },
  ],
  ...overrides,
} as unknown as Automation);

function handlers() {
  return { onToggle: vi.fn(), onReEnable: vi.fn(), onDelete: vi.fn(), onTestRun: vi.fn() };
}

beforeEach(() => vi.clearAllMocks());

describe('AutomationCard extraction preservation (mock callbacks only)', () => {
  it('retains complete identity, metadata, formatter inputs and every ordered conflict', () => {
    const a = automation();
    const callbacks = handlers();
    const { container } = render(
      <AutomationCard automation={a} isFiring vehicleName="Long vehicle display name" {...callbacks} />,
    );
    expect(screen.getByRole('heading', { name: a.name })).toHaveClass('break-words');
    expect(screen.getByText(a.description!)).not.toHaveClass('truncate');
    expect(screen.getByText('Long vehicle display name')).toBeInTheDocument();
    expect(screen.getByTestId('pin-identity')).toHaveAttribute('data-item-type', 'automation');
    expect(screen.getByTestId('pin-identity')).toHaveAttribute('data-item-id', '79');
    expect(container.textContent).toContain('Last: relative:2026-01-02T00:00:00Z');
    expect(container.textContent).toContain('Runs: 12');
    expect(container.textContent).toContain('Fails: 3');
    expect(container.textContent).toContain('Next: date:2026-01-03T00:00:00Z');
    expect(screen.getByText('Firing')).toHaveClass('motion-reduce:animate-none');
    const conflicts = screen.getAllByText(/Conflict with/);
    expect(conflicts[0].textContent).toContain('"Warning peer" — Full warning reason');
    expect(conflicts[1].textContent).toContain('"Information peer" — Full information reason');
    Object.values(callbacks).forEach(callback => expect(callback).not.toHaveBeenCalled());
  });

  it('keeps exact callback IDs, re-enable routing and auto-disabled precedence', () => {
    const callbacks = handlers();
    const a = automation({ enabled: false, auto_disabled: true, auto_disabled_reason: 'Retained source reason' });
    render(<AutomationCard automation={a} isFiring={false} {...callbacks} />);
    expect(screen.getByText('Auto-disabled')).toBeInTheDocument();
    expect(screen.getByText('Retained source reason')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('switch'));
    expect(callbacks.onReEnable).toHaveBeenCalledWith(79);
    expect(callbacks.onToggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Actions menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Re-enable' }));
    expect(callbacks.onReEnable).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Actions menu' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('retains permission reasons, blocks write controls and keeps inherited dismiss-only actions', () => {
    const callbacks = handlers();
    render(
      <AutomationCard
        automation={automation({ auto_disabled: true })}
        isFiring={false}
        actionsDisabled
        actionsDisabledReason="Read-only retained data"
        {...callbacks}
      />,
    );
    expect(screen.getByRole('switch')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Actions menu' }));
    for (const label of ['Test run', 'Re-enable', 'Delete']) {
      const control = screen.getByRole('button', { name: label });
      expect(control).toBeDisabled();
      expect(control).toHaveAttribute('title', 'Read-only retained data');
      fireEvent.click(control);
    }
    expect(screen.getByRole('button', { name: 'Export' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(screen.getByRole('button', { name: 'Actions menu' })).toHaveAttribute('aria-expanded', 'false');
    Object.values(callbacks).forEach(callback => expect(callback).not.toHaveBeenCalled());
  });

  it('closes the shared action surface on Escape and dispatches test run only on an explicit click', () => {
    const callbacks = handlers();
    render(<AutomationCard automation={automation()} isFiring={false} {...callbacks} />);
    const trigger = screen.getByRole('button', { name: 'Actions menu' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Actions menu' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Test run' })).not.toBeInTheDocument();
    expect(callbacks.onTestRun).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Test run' }));
    expect(callbacks.onTestRun).toHaveBeenCalledWith(79);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('retains delete confirmation, cancellation and permission-change dismissal without an implicit write', () => {
    const callbacks = handlers();
    const a = automation();
    const view = render(<AutomationCard automation={a} isFiring={false} {...callbacks} />);
    const requestDelete = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actions menu' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    };
    requestDelete();
    const dialog = screen.getByRole('dialog', { name: 'Delete automation' });
    expect(dialog.textContent).toContain(a.name);
    expect(callbacks.onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Delete automation' })).not.toBeInTheDocument();
    requestDelete();
    view.rerender(<AutomationCard automation={a} isFiring={false} actionsDisabled {...callbacks} />);
    expect(screen.queryByRole('dialog', { name: 'Delete automation' })).not.toBeInTheDocument();
    expect(callbacks.onDelete).not.toHaveBeenCalled();
    view.rerender(<AutomationCard automation={a} isFiring={false} {...callbacks} />);
    requestDelete();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete automation' })).getByRole('button', { name: 'Delete' }));
    expect(callbacks.onDelete).toHaveBeenCalledTimes(1);
    expect(callbacks.onDelete).toHaveBeenLastCalledWith(79);
  });
});
