import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuditTrailPanel } from './AuditTrailPanel';
import { recordAuditEvent, __resetAuditTrailForTests } from '../lib/auditTrail';

describe('AuditTrailPanel', () => {
  beforeEach(() => {
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
});
