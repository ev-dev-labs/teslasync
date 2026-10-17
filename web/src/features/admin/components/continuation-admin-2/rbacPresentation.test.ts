import { describe, expect, it } from 'vitest';
import { countGrants, permsByCategory, snapshotToDraft } from './rbacPresentation';

describe('RBAC presentation preparation', () => {
  it('clones role rows so checkbox drafts never mutate the query snapshot', () => {
    const matrix = { user: { 'fleet.read': true }, admin: { 'fleet.read': true, 'admin.audit': false } };
    const draft = snapshotToDraft(matrix);
    draft.cells.admin!['admin.audit'] = true;
    expect(matrix.admin['admin.audit']).toBe(false);
    expect(countGrants(matrix)).toBe(2);
    expect(countGrants(draft.cells)).toBe(3);
  });

  it('preserves the category and permission encounter order', () => {
    const permissions = [
      { id: 'admin.audit', name: 'Audit', category: 'admin' },
      { id: 'fleet.read', name: 'Fleet', category: 'fleet' },
      { id: 'admin.write', name: 'Write', category: 'admin' },
    ];
    const groups = permsByCategory(permissions);
    expect([...groups.keys()]).toEqual(['admin', 'fleet']);
    expect(groups.get('admin')?.map((permission) => permission.id)).toEqual(['admin.audit', 'admin.write']);
    expect(permissions.map((permission) => permission.id)).toEqual(['admin.audit', 'fleet.read', 'admin.write']);
  });
});
