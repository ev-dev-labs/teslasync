import { describe, it, expect } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { renderWithProviders } from './testUtils';
import { AuditLogPanel } from '../AuditLogPanel';
import { createInMemoryPackRepository, type PackRepository } from '../../lib/packRepository';
import { buildAuditEntry } from '../../lib/auditLog';

describe('AuditLogPanel', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Filter Action' }));
    const filter = screen.getByRole('dialog', { name: 'Filter Action' });
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'install' }));
    fireEvent.click(within(filter).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('First install.')).not.toBeInTheDocument();
    expect(screen.getByText('Disabled locally.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Filter Action' }));
    const reopened = screen.getByRole('dialog', { name: 'Filter Action' });
    expect(within(reopened).getByRole('checkbox', { name: 'install' })).not.toBeChecked();
    fireEvent.click(within(reopened).getByRole('button', { name: 'Clear' }));
    fireEvent.click(within(reopened).getByRole('button', { name: 'Done' }));
    expect(screen.getByText('First install.')).toBeInTheDocument();
  });

  it('shows an empty state with no recorded actions', () => {
    renderWithProviders(<AuditLogPanel />);
    expect(screen.getByText(/No actions have been recorded yet/i)).toBeInTheDocument();
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
