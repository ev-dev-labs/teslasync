import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SignatureKeyPanel } from './SignatureKeyPanel';
import { useSigningVault } from '../hooks/useSigningVault';
import { __resetKeyRepositoryForTests } from '../lib/signingKeyRepository';
import { __resetAuditTrailForTests } from '../lib/auditTrail';

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
});
