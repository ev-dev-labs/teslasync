import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RbacMatrixSessionResponse } from '@/api/hooks/useRbacMatrix';
import { RbacMatrixGrid } from './RbacMatrixGrid';
import { snapshotToDraft } from './rbacPresentation';

const payload: RbacMatrixSessionResponse = {
  mode: 'session',
  roles: [{ id: 'user', name: 'Complete multilingual role identity 用户' }],
  permissions: [
    { id: 'fleet.read', name: 'View vehicles', category: 'fleet' },
    { id: 'admin.audit', name: 'View audit ledger', category: 'admin' },
  ],
  categories: ['admin', 'fleet'],
  matrix: { user: { 'fleet.read': true, 'admin.audit': false } },
  effective_for_me: { 'fleet.read': true }, my_roles: ['user'], groups_header_name: 'X-Forwarded-Groups',
};

describe('RbacMatrixGrid', () => {
  it('retains declared category order, full role identity, and exact cell callback IDs', () => {
    const onToggle = vi.fn();
    render(<MemoryRouter><RbacMatrixGrid payload={payload} draft={snapshotToDraft(payload.matrix)}
      editing onToggle={onToggle} /></MemoryRouter>);
    const table = screen.getByRole('table', { name: 'Role permission matrix' });
    expect(within(table).getByText(payload.roles[0]!.name)).toBeInTheDocument();
    const categoryHeaders = within(table).getAllByRole('rowheader').filter((node) => node.getAttribute('scope') === 'rowgroup');
    expect(categoryHeaders.map((node) => node.textContent)).toEqual(['admin', 'fleet']);
    const checkbox = within(table).getByRole('checkbox', { name: 'Toggle user / admin.audit' });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith('user', 'admin.audit', true);
    expect(payload.matrix.user!['admin.audit']).toBe(false);
  });
});
