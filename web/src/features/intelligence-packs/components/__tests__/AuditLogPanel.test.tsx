import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from './testUtils';
import { AuditLogPanel } from '../AuditLogPanel';
import { createInMemoryPackRepository, type PackRepository } from '../../lib/packRepository';
import { buildAuditEntry } from '../../lib/auditLog';

describe('AuditLogPanel', () => {
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
