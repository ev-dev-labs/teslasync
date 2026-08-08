import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ExportReportPanel } from './ExportReportPanel';
import { makeMinimalReport } from '../lib/testFixtures';
import { __resetKeyRepositoryForTests } from '../lib/signingKeyRepository';
import { __resetAuditTrailForTests } from '../lib/auditTrail';

describe('ExportReportPanel', () => {
  beforeEach(() => {
    __resetKeyRepositoryForTests();
    __resetAuditTrailForTests();
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:mock-url');
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
  });

  it('signs the report and shows digest/key-id/signed-at summary', async () => {
    const onSigned = vi.fn();
    render(<ExportReportPanel report={makeMinimalReport()} onSigned={onSigned} />);

    fireEvent.click(screen.getByRole('button', { name: /sign report/i }));

    await waitFor(() => expect(screen.getByText(/SHA-256 digest:/i)).toBeInTheDocument());
    expect(onSigned).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /download json/i })).not.toBeDisabled();
  });

  it('disables the download button until a report has been signed', () => {
    render(<ExportReportPanel report={makeMinimalReport()} />);
    expect(screen.getByRole('button', { name: /download json/i })).toBeDisabled();
  });

  it('triggers a download after signing', async () => {
    render(<ExportReportPanel report={makeMinimalReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /sign report/i }));
    await waitFor(() => expect(screen.getByText(/SHA-256 digest:/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /download json/i }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it('always renders the digest-is-not-a-signature disclaimer', () => {
    render(<ExportReportPanel report={makeMinimalReport()} />);
    expect(screen.getByText(/does not prove who created the report/i)).toBeInTheDocument();
  });
});
