import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SignatureKeyPanel } from './SignatureKeyPanel';
import { useSigningVault } from '../hooks/useSigningVault';
import { __resetKeyRepositoryForTests } from '../lib/signingKeyRepository';
import { __resetAuditTrailForTests } from '../lib/auditTrail';
import type { UseSigningVaultResult } from '../hooks/useSigningVault';
import type { SigningKeyRecord } from '../lib/types';

function Harness() {
  const vault = useSigningVault();
  return <SignatureKeyPanel vault={vault} />;
}

describe('SignatureKeyPanel', () => {
  beforeEach(() => {
    __resetKeyRepositoryForTests();
    __resetAuditTrailForTests();
  });

  it('shows the session-only capability warning (no IndexedDB in jsdom test env)', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByText(/no signing keys yet/i)).toBeInTheDocument());
    expect(screen.getByText(/IndexedDB is not available/i)).toBeInTheDocument();
  });

  it('generates a new key and lists it as active', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByText(/no signing keys yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /generate new key/i }));
    await waitFor(() => expect(screen.getAllByText('Active').length).toBeGreaterThan(0));
  });

  it('rotates the active key and shows the old one as revoked with rotated-from linkage', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByText(/no signing keys yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /generate new key/i }));
    await waitFor(() => expect(screen.getAllByText('Active').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /rotate active key/i }));
    await waitFor(() => expect(screen.getAllByText('Revoked').length).toBeGreaterThan(0));
    expect(screen.getByText(/Rotated from/i)).toBeInTheDocument();
  });

  it('revokes a key after confirmation', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByText(/no signing keys yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /generate new key/i }));
    await waitFor(() => expect(screen.getAllByText('Active').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm revoke/i }));
    await waitFor(() => expect(screen.getAllByText('Revoked').length).toBeGreaterThan(0));
  });

  it('always renders the local-attestation disclaimer', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByText(/no signing keys yet/i)).toBeInTheDocument());
    expect(screen.getByText(/does NOT verify the identity/i)).toBeInTheDocument();
  });

  it('requires the selected key confirmation, supports cancellation and retains the key history through denial and recovery', () => {
    const active: SigningKeyRecord = {
      key_id: 'key_current',
      public_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      created_at: '2024-02-01T00:00:00Z', revoked_at: null, revoked_reason: null,
      rotated_from: 'key_old', persisted: false,
    };
    const old: SigningKeyRecord = {
      ...active, key_id: 'key_old', created_at: '2024-01-01T00:00:00Z',
      revoked_at: '2024-02-01T00:00:00Z', revoked_reason: 'rotation', rotated_from: null,
    };
    const revokeKey = vi.fn<UseSigningVaultResult['revokeKey']>().mockResolvedValue(undefined);
    const vault: UseSigningVaultResult = {
      capability: { supported: false, reason: 'Key storage permission denied; keys are session-only.' },
      keys: [active, old], activeKey: active, auditLog: [], isLoading: false, isMutating: false, error: null,
      generateKey: vi.fn().mockResolvedValue(undefined), rotateKey: vi.fn().mockResolvedValue(undefined),
      revokeKey, refresh: vi.fn().mockResolvedValue(undefined),
    };
    const { rerender } = render(<SignatureKeyPanel vault={vault} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(revokeKey).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Confirm revoke' })).not.toBeInTheDocument();
    expect(revokeKey).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Generate new key' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    expect(revokeKey).toHaveBeenCalledExactlyOnceWith('key_current', 'manual_revocation');
    rerender(<SignatureKeyPanel vault={{ ...vault, error: 'Key access denied' }} />);
    expect(screen.getByText('Key access denied')).toBeInTheDocument();
    expect(screen.getByText('Key storage permission denied; keys are session-only.')).toBeInTheDocument();
    expect(screen.getByText(/Rotated from key_old/)).toBeInTheDocument();
    expect(screen.getByText(/Revoked at 2024-02-01T00:00:00Z \(rotation\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    expect(revokeKey).toHaveBeenCalledTimes(2);
    const revoked = { ...active, revoked_at: '2024-03-01T00:00:00Z', revoked_reason: 'manual_revocation' };
    rerender(<SignatureKeyPanel vault={{ ...vault, keys: [revoked, old], activeKey: null }} />);
    expect(screen.queryByText('Key access denied')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rotate active key' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Generate new key' })).toBeEnabled();
  });

  it('blocks destructive confirmation and duplicate actions during loading or another key mutation, then restores the controls', () => {
    const key: SigningKeyRecord = {
      key_id: 'key_guarded', public_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      created_at: '2024-01-01T00:00:00Z', revoked_at: null, revoked_reason: null,
      rotated_from: null, persisted: true,
    };
    const vault: UseSigningVaultResult = {
      capability: null, keys: [key], activeKey: key, auditLog: [], isLoading: true, isMutating: false, error: null,
      generateKey: vi.fn().mockResolvedValue(undefined), rotateKey: vi.fn().mockResolvedValue(undefined),
      revokeKey: vi.fn().mockResolvedValue(undefined), refresh: vi.fn().mockResolvedValue(undefined),
    };
    const { rerender } = render(<SignatureKeyPanel vault={vault} />);
    expect(screen.getByRole('button', { name: 'Generate new key' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rotate active key' })).toBeDisabled();
    rerender(<SignatureKeyPanel vault={{ ...vault, isLoading: false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    rerender(<SignatureKeyPanel vault={{ ...vault, isLoading: false, isMutating: true }} />);
    expect(screen.getByRole('button', { name: 'Generate new key' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rotate active key' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm revoke' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    expect(vault.revokeKey).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(screen.queryByRole('button', { name: 'Confirm revoke' })).not.toBeInTheDocument();
    rerender(<SignatureKeyPanel vault={{ ...vault, isLoading: false }} />);
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Generate new key' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Rotate active key' })).toBeEnabled();
  });
});
