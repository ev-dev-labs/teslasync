import type { RbacPermission } from '@/api/hooks/useRbacMatrix';

export interface MatrixDraft {
  cells: Record<string, Record<string, boolean>>;
}

export function snapshotToDraft(matrix: Record<string, Record<string, boolean>>): MatrixDraft {
  const cells: Record<string, Record<string, boolean>> = {};
  for (const [roleID, row] of Object.entries(matrix)) {
    cells[roleID] = { ...row };
  }
  return { cells };
}

export function permsByCategory(permissions: RbacPermission[]): Map<string, RbacPermission[]> {
  const out = new Map<string, RbacPermission[]>();
  for (const p of permissions) {
    const bucket = out.get(p.category) ?? [];
    bucket.push(p);
    out.set(p.category, bucket);
  }
  return out;
}

export function countGrants(matrix: Record<string, Record<string, boolean>>): number {
  let total = 0;
  for (const row of Object.values(matrix ?? {})) {
    for (const allowed of Object.values(row ?? {})) {
      if (allowed) total += 1;
    }
  }
  return total;
}
