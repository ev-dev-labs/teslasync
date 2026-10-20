import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as auditTrail from '../lib/auditTrail';
import { AuditTrailPanel } from './AuditTrailPanel';
import { recordAuditEvent, __resetAuditTrailForTests } from '../lib/auditTrail';

describe('AuditTrailPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetAuditTrailForTests();
  });

  it('shows an empty state when there is no activity yet', async () => {
    render(<AuditTrailPanel />);
    expect(await screen.findByText(/no activity yet/i)).toBeInTheDocument();
  });

  it('lists recorded audit events newest first with action badges and detail text', async () => {
    await recordAuditEvent('key_generated', 'Generated signing key key_abc.');
    await recordAuditEvent('report_signed', 'Signed report report_xyz.');

    render(<AuditTrailPanel />);

    expect(await screen.findByText(/signed report report_xyz/i)).toBeInTheDocument();
    expect(screen.getByText(/generated signing key key_abc/i)).toBeInTheDocument();
    expect(screen.getByText('Key generated')).toBeInTheDocument();
    expect(screen.getByText('Report signed')).toBeInTheDocument();

    // Newest-first ordering: "Report signed" entry should appear before "Key generated" in the list.
    const items = screen.getAllByRole('listitem');
    expect(items[0]?.textContent).toMatch(/signed report report_xyz/i);
    expect(items[1]?.textContent).toMatch(/generated signing key key_abc/i);
  });

  it('reloads the log when refreshToken changes', async () => {
    const { rerender } = render(<AuditTrailPanel refreshToken={1} />);
    expect(await screen.findByText(/no activity yet/i)).toBeInTheDocument();

    await recordAuditEvent('key_revoked', 'Revoked signing key key_old.');
    rerender(<AuditTrailPanel refreshToken={2} />);

    expect(await screen.findByText(/revoked signing key key_old/i)).toBeInTheDocument();
  });

  it('supports a manual refresh via the refresh button', async () => {
    render(<AuditTrailPanel />);
    expect(await screen.findByText(/no activity yet/i)).toBeInTheDocument();

    await recordAuditEvent('key_rotated', 'Rotated signing key.');
    screen.getByRole('button', { name: /refresh/i }).click();

    expect(await screen.findByText(/rotated signing key/i)).toBeInTheDocument();
  });

  it('retains local events through a rejected refresh and retries without reordering them', async () => {
    await recordAuditEvent('key_generated', 'Older key event.');
    await recordAuditEvent('report_exported', 'Newer export event.');
    const list = vi.spyOn(auditTrail, 'listAuditEvents');
    render(<MemoryRouter><AuditTrailPanel /></MemoryRouter>);
    expect(await screen.findByText('Newer export event.')).toBeInTheDocument();

    list.mockRejectedValueOnce(new Error('local storage refresh failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument());
    expect(screen.getByText('Older key event.')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Newer export event.');
    expect(rows[1]).toHaveTextContent('Older key event.');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText(/Previously loaded data remains visible/)).not.toBeInTheDocument());
    expect(screen.getByText('Newer export event.')).toBeInTheDocument();
  });
});
