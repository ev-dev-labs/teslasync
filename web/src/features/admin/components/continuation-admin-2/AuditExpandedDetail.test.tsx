import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuditExpandedDetail } from './AuditExpandedDetail';
import type { AuditLogRow } from '@/types/admin-operator-confidence';

const ROW: AuditLogRow = {
  id: 17, ts: '2026-10-05T18:00:00Z', actor: 'operator', action: 'lock', entity_type: 'vehicle',
  ip: '192.0.2.9', user_agent: '完整客户端身份 — long identity', trace_id: 'full-trace-identity',
  row_hash: 'complete-row-hash', before: '{"locked":false}', after: 'unparseable raw after payload',
};

describe('AuditExpandedDetail', () => {
  it('copies exact pretty JSON and the complete raw parse-fallback payload', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<MemoryRouter><AuditExpandedDetail row={ROW} /></MemoryRouter>);
    expect(screen.getByText(ROW.user_agent ?? '')).toBeInTheDocument();
    expect(screen.getByText(ROW.trace_id ?? '')).toBeInTheDocument();
    expect(screen.getByText(ROW.row_hash ?? '')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: 'Before' })).getByRole('button'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('{\n  "locked": false\n}'));
    fireEvent.click(within(screen.getByRole('group', { name: 'After' })).getByRole('button'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ROW.after));
  });
});
