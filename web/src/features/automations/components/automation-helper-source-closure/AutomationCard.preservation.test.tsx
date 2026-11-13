import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AutomationCard } from '../../pages/AutomationCard';
import type { Automation } from '@/api/types';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { matchesAppDesignCss } from '@/components/feedback/appDesignCss.test-utils';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { AutomationCardNotices } from './AutomationCardNotices';

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
  return { onToggle: vi.fn(), onReEnable: vi.fn(), onDelete: vi.fn(), onTestRun: vi.fn(), onDuplicate: vi.fn() };
}

// The actions trigger carries the per-automation accessible name.
const menuName = 'Actions for Long automation name with every word retained';

beforeEach(() => vi.clearAllMocks());

describe('AutomationCard extraction preservation (mock callbacks only)', () => {
  it.each(PACK_IDS)('%s paints source-derived notices with full ordered reasons and no new actions', pack => {
    const a = automation({ enabled: false, auto_disabled: true, auto_disabled_reason: 'Exact auto-disabled reason' });
    const callbacks = handlers();
    const view = render(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
      <AutomationCard automation={a} isFiring={false} {...callbacks} />
    </div>);
    const host = view.container.firstElementChild!;
    const release = observeAppDesignScopes(host);
    try {
      const notices = host.querySelectorAll('[data-app-feedback-kind="notice"]');
      expect(notices).toHaveLength(3);
      expect([...notices].map(notice => notice.getAttribute('data-app-tone'))).toEqual(['danger', 'warning', 'info']);
      expect([...notices].map(notice => notice.textContent)).toEqual([
        'Exact auto-disabled reason',
        'Conflict with "Warning peer" — Full warning reason',
        'Conflict with "Information peer" — Full information reason',
      ]);
      for (const notice of notices) {
        const matches = matchesAppDesignCss(notice, '[data-app-feedback-kind="notice"]')
          .filter(match => match.selector.includes('[data-app-feedback='));
        expect(matches.length).toBeGreaterThan(0);
        expect(matches.every(match => match.selector.includes(`[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`))).toBe(true);
        expect(matches.some(match => match.declarations.display === 'grid')).toBe(true);
        const content = notice.querySelector('[data-app-part~="feedback-content"]')!;
        expect(matchesAppDesignCss(content, '[data-app-part~="feedback-content"]').some(match => match.declarations['grid-column'] === '2')).toBe(true);
        expect(matchesAppDesignCss(content, '[data-app-part~="feedback-message"]').length).toBeGreaterThan(0);
        const icon = notice.querySelector('[data-app-part="feedback-icon"]')!;
        expect(icon).toHaveAttribute('aria-hidden', 'true');
        expect(matchesAppDesignCss(icon, '[data-app-part~="feedback-icon"]').length).toBeGreaterThan(0);
        expect(notice.querySelector('button, a')).toBeNull();
      }
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
      Object.values(callbacks).forEach(callback => expect(callback).not.toHaveBeenCalled());
    } finally { release(); }
  });

  it('keeps the original visibility conditions and default neutrality', () => {
    const a = automation({ auto_disabled: false, auto_disabled_reason: 'Do not show an inactive reason', conflicts: [] });
    const view = render(<AutomationCardNotices automation={a} />);
    expect(view.container).toBeEmptyDOMElement();
    view.rerender(<AutomationCardNotices automation={{ ...a, auto_disabled: true }} />);
    const notice = view.container.querySelector('[data-app-feedback-kind="notice"]')!;
    expect(notice).toHaveTextContent('Do not show an inactive reason');
    expect(notice).not.toHaveAttribute('data-app-design-owner');
    view.rerender(<AutomationCardNotices automation={{ ...a, auto_disabled: true, auto_disabled_reason: null }} />);
    expect(view.container).toBeEmptyDOMElement();
    view.rerender(<AutomationCardNotices automation={{ ...a, conflicts: [
      { automation_id: 0, automation_name: 'Unmodified peer', severity: 'info', reason: 'Unmodified information reason' },
    ] }} />);
    expect(view.container.querySelector('[data-app-feedback-kind="notice"]')).toHaveAttribute('data-app-tone', 'info');
    expect(view.container.textContent).toBe('Conflict with "Unmodified peer" — Unmodified information reason');
  });

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
    fireEvent.click(screen.getByRole('button', { name: menuName }));
    fireEvent.click(screen.getByRole('button', { name: 'Re-enable' }));
    expect(callbacks.onReEnable).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: menuName })).toHaveAttribute('aria-expanded', 'false');
  });

  it('retains permission reasons, blocks duplicate writes and hides unsafe export', () => {
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
    fireEvent.click(screen.getByRole('button', { name: menuName }));
    for (const label of ['Test run', 'Re-enable', 'Delete']) {
      const control = screen.getByRole('button', { name: label });
      expect(control).toBeDisabled();
      expect(control).toHaveAttribute('title', 'Read-only retained data');
      fireEvent.click(control);
    }
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeDisabled();
    fireEvent.keyDown(window, {key:'Escape'});
    expect(screen.getByRole('button', { name: menuName })).toHaveAttribute('aria-expanded', 'false');
    Object.values(callbacks).forEach(callback => expect(callback).not.toHaveBeenCalled());
  });

  it('closes the shared action surface on Escape and dispatches test run only on an explicit click', () => {
    const callbacks = handlers();
    render(<AutomationCard automation={automation()} isFiring={false} {...callbacks} />);
    const trigger = screen.getByRole('button', { name: menuName });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: menuName })).toBeInTheDocument();
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
      fireEvent.click(screen.getByRole('button', { name: menuName }));
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
