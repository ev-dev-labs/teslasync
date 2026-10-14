import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from './testUtils';
import { AuditLogPanel } from '../AuditLogPanel';
import { createInMemoryPackRepository, type PackRepository } from '../../lib/packRepository';
import { buildAuditEntry } from '../../lib/auditLog';

describe('AuditLogPanel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows complete audit fields through keyboard-operated mobile details', async () => {
    vi.stubGlobal('ResizeObserver', class implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width: 375 } } as ResizeObserverEntry], this);
      }
      unobserve() {}
      disconnect() {}
    });
    const repository = createInMemoryPackRepository();
    await repository.appendAuditLog(buildAuditEntry({
      packId: 'pack-a', packName: 'Pack A', action: 'install',
      detail: 'Installed version 1.0.0 with the complete capability grant.',
    }));
    const user = userEvent.setup();
    const view = renderWithProviders(<AuditLogPanel />, { repository });
    await screen.findByText('Pack A');
    expect(view.container.querySelector('[data-mobile-table]')).not.toBeNull();
    expect(view.container.querySelector('table')).toBeNull();
    const quickView = screen.getByRole('button', { name: 'Quick view' });
    quickView.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Pack A' });
    for (const field of ['When', 'Action', 'Pack', 'Detail']) {
      expect(within(dialog).getByText(field)).toBeInTheDocument();
    }
    expect(within(dialog).getByText('Installed version 1.0.0 with the complete capability grant.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(quickView).toHaveFocus());
  });

  it('filters the complete local audit log and keeps excluded values available for reset', async () => {
    const repository = createInMemoryPackRepository();
    await repository.appendAuditLog(buildAuditEntry({
      packId: 'pack-a', packName: 'Pack A', action: 'install', detail: 'First install.',
    }));
    await repository.appendAuditLog(buildAuditEntry({
      packId: 'pack-b', packName: 'Pack B', action: 'disable', detail: 'Disabled locally.',
    }));
    renderWithProviders(<AuditLogPanel />, { repository });
    await screen.findByText('Pack A');

    fireEvent.click(screen.getByRole('button', { name: 'Action filter' }));
    const filter = screen.getByRole('dialog', { name: 'Action filter' });
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'install' }));
    fireEvent.click(within(filter).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('First install.')).not.toBeInTheDocument();
    expect(screen.getByText('Disabled locally.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Action filter' }));
    const reopened = screen.getByRole('dialog', { name: 'Action filter' });
    expect(within(reopened).getByRole('checkbox', { name: 'install' })).not.toBeChecked();
    fireEvent.click(within(reopened).getByRole('button', { name: 'Clear' }));
    fireEvent.click(within(reopened).getByRole('button', { name: 'Done' }));
    expect(screen.getByText('First install.')).toBeInTheDocument();
  });

  it('shows an empty state with no recorded actions', async () => {
    renderWithProviders(<AuditLogPanel />);
    expect(await screen.findByText(/No actions have been recorded yet/i)).toBeInTheDocument();
  });

  it('renders entries appended to the repository', async () => {
    const repository: PackRepository = createInMemoryPackRepository();
    await repository.appendAuditLog(
      buildAuditEntry({ packId: 'pack-a', packName: 'Pack A', action: 'install', detail: 'Installed version 1.0.0.' }),
    );

    renderWithProviders(<AuditLogPanel />, { repository });

    await waitFor(() => {
      expect(screen.getByText('Pack A')).toBeInTheDocument();
    });
    expect(screen.getByText('install')).toBeInTheDocument();
    expect(screen.getByText(/Installed version 1\.0\.0/)).toBeInTheDocument();
  });
});
