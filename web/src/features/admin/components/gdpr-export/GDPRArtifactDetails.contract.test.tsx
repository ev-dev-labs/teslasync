import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { GDPRExportArtifact } from '@/types/admin-operator-confidence';

const dates = vi.hoisted(() => ({
  absolute: vi.fn((iso: unknown) => iso == null || iso === '' ? '—' : `DT:${String(iso)}`),
  relative: vi.fn((iso: unknown) => iso == null || iso === '' ? '—' : `REL:${String(iso)}`),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => {
      if (typeof fallback === 'string') return fallback;
      if (fallback && typeof fallback === 'object' && 'defaultValue' in fallback) {
        return fallback.defaultValue;
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/dateFormat', async () => ({
  ...await vi.importActual<typeof import('@/lib/dateFormat')>('@/lib/dateFormat'),
  formatDateTime: dates.absolute,
  formatRelative: dates.relative,
}));

import { GDPRArtifactDetails } from './GDPRArtifactDetails';

const writeText = vi.fn<(text: string) => Promise<void>>();
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function manifest(overrides: Partial<GDPRExportArtifact> = {}): GDPRExportArtifact {
  return {
    id: 'qa-artifact?opaque#RAW',
    export_job_id: 'qa-job/Case Sensitive',
    vehicle_id: 42,
    created_at: '2026-01-02T03:04:05Z',
    downloaded_at: '2026-01-02T04:05:06Z',
    expires_at: '2026-02-01T00:00:00Z',
    byte_count: 2048,
    storage_kind: 's3',
    storage_path: 'qa-only/preserved path',
    sha256: 'QA-Hash:AbCd',
    download_count: 3,
    ...overrides,
  };
}

function definition(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: 'dt' });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement) || value.tagName !== 'DD') {
    throw new Error(`Missing definition for ${label}`);
  }
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

describe('GDPRArtifactDetails canonical manifest contract', () => {
  it('associates all eleven actual metadata terms with their definitions', () => {
    const artifact = manifest();
    const { container } = render(<GDPRArtifactDetails artifact={artifact} />);
    const expected = [
      ['ID', artifact.id],
      ['Export job ID', artifact.export_job_id],
      ['Vehicle ID', '42'],
      ['Created', `DT:${artifact.created_at}`],
      ['Downloaded', `DT:${artifact.downloaded_at}`],
      ['Expires', `DT:${artifact.expires_at}`],
      ['Byte count', '2048'],
      ['Storage kind', artifact.storage_kind],
      ['Storage path', artifact.storage_path],
      ['Download count', '3'],
      ['SHA-256', artifact.sha256],
    ];
    expect(container.querySelectorAll('dl > div')).toHaveLength(11);
    expect(container.querySelectorAll('dt')).toHaveLength(11);
    expect(container.querySelectorAll('dd')).toHaveLength(11);
    for (const [label, value] of expected) {
      expect(definition(label)).toHaveTextContent(value);
    }
    for (const label of ['User', 'Completed', 'Status', 'Format']) {
      expect(screen.queryByText(label, { selector: 'dt' })).not.toBeInTheDocument();
    }
  });

  it('passes original timestamps unchanged through both shared formatters', () => {
    const artifact = manifest();
    render(<GDPRArtifactDetails artifact={artifact} />);
    for (const iso of [artifact.created_at, artifact.downloaded_at, artifact.expires_at]) {
      expect(dates.absolute).toHaveBeenCalledWith(iso);
      expect(dates.relative).toHaveBeenCalledWith(iso);
      expect(screen.getByText(`DT:${iso}`)).toHaveAttribute('title', iso);
    }
  });

  it.each([undefined, null])('retains an unknown downloaded timestamp (%s) without inventing an event', (downloaded_at) => {
    render(<GDPRArtifactDetails artifact={manifest({ downloaded_at })} />);
    expect(definition('Downloaded').textContent).toBe('——');
    expect(dates.absolute).toHaveBeenCalledWith(downloaded_at);
    expect(dates.relative).toHaveBeenCalledWith(downloaded_at);
    expect(screen.queryByText(/not downloaded|completed|failed/i)).not.toBeInTheDocument();
  });

  it('preserves zero counts and vehicle identity instead of treating them as missing', () => {
    render(<GDPRArtifactDetails artifact={manifest({ vehicle_id: 0, byte_count: 0, download_count: 0 })} />);
    for (const label of ['Vehicle ID', 'Byte count', 'Download count']) {
      expect(definition(label).textContent).toBe('0');
    }
  });

  it('retains opaque whitespace, case, reserved characters and unknown storage kinds', () => {
    const artifact = manifest({
      id: '  Qa/ID?#  ',
      export_job_id: ' Job%2F:RAW ',
      sha256: '  AbCd:QA_HASH  ',
      storage_kind: 'QA_CUSTOM_KIND',
      storage_path: '  qa/preserved?#path  ',
      vehicle_id: Number.MAX_SAFE_INTEGER,
      byte_count: Number.MAX_SAFE_INTEGER,
    });
    render(<GDPRArtifactDetails artifact={artifact} />);
    for (const [label, value] of [
      ['ID', artifact.id], ['Export job ID', artifact.export_job_id],
      ['SHA-256', artifact.sha256], ['Storage kind', artifact.storage_kind],
      ['Storage path', artifact.storage_path],
      ['Vehicle ID', String(artifact.vehicle_id)], ['Byte count', String(artifact.byte_count)],
    ]) {
      expect(definition(label).querySelector('code')?.textContent).toBe(value);
    }
    expect(definition('SHA-256').querySelector('code')).toHaveClass('select-text', 'break-all');
  });

  it('retains the initial loading shell and its twelve decorative skeletons', () => {
    const { container } = render(<GDPRArtifactDetails loading />);
    expect(screen.getByRole('heading', { name: 'Artifact details' })).toBeInTheDocument();
    expect(container.querySelector('[data-print-card]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[aria-hidden="true"][class*="skeleton-bg"]')).toHaveLength(12);
    expect(container.querySelector('dl')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('retains every metadata field and both copy actions while refreshing', () => {
    const { container } = render(<GDPRArtifactDetails artifact={manifest()} loading />);
    expect(container.querySelector('[data-print-card]')).toHaveAttribute('aria-busy', 'false');
    expect(container.querySelectorAll('dt')).toHaveLength(11);
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
    expect(container.querySelectorAll('[class*="skeleton-bg"]')).toHaveLength(0);
  });

  it('preserves the actionable empty explanation and caller panel classes', () => {
    const { container } = render(<GDPRArtifactDetails className="xl:col-span-2" />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Look up an export artifact to see its metadata here.',
    );
    expect(container.querySelector('[data-print-card]')).toHaveClass('xl:col-span-2');
    expect(screen.getByRole('heading', { name: 'Artifact details' })).toBeInTheDocument();
  });

  it.each(['ID', 'SHA-256'])('copies the exact %s and retains shared success feedback', async (label) => {
    const artifact = manifest();
    render(<GDPRArtifactDetails artifact={artifact} />);
    fireEvent.click(within(definition(label)).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(label === 'ID' ? artifact.id : artifact.sha256));
    expect(await within(definition(label)).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['ID', 'SHA-256'])('shows %s rejection and manual recovery, then clears it only on successful retry', async (label) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    writeText.mockRejectedValueOnce(new Error('Synthetic clipboard denial'));
    render(<GDPRArtifactDetails artifact={manifest()} />);
    const value = definition(label);
    fireEvent.click(within(value).getByRole('button', { name: 'Copy' }));
    expect(await within(value).findByRole('alert')).toHaveTextContent('Failed to copy');
    expect(within(value).getByText(
      'Clipboard unavailable. Select the displayed text and copy it manually.',
    )).toBeInTheDocument();
    expect(within(value).queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
    expect(value.querySelector('code')).toHaveClass('select-text');
    fireEvent.click(within(value).getByRole('button', { name: 'Copy' }));
    expect(await within(value).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(within(value).queryByRole('alert')).not.toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('does not carry clipboard rejection into a different opaque identity', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    writeText.mockRejectedValueOnce(new Error('Synthetic clipboard denial'));
    const { rerender } = render(<GDPRArtifactDetails artifact={manifest()} />);
    fireEvent.click(within(definition('ID')).getByRole('button', { name: 'Copy' }));
    await screen.findByRole('alert');
    rerender(<GDPRArtifactDetails artifact={manifest({ id: 'qa-next-id' })} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(definition('ID')).toHaveTextContent('qa-next-id');
  });

  it('keeps empty raw IDs and hashes copyable instead of silently substituting unknown', async () => {
    render(<GDPRArtifactDetails artifact={manifest({ id: '', sha256: '' })} />);
    expect(definition('ID').querySelector('code')?.textContent).toBe('');
    expect(definition('SHA-256').querySelector('code')?.textContent).toBe('');
    for (const label of ['ID', 'SHA-256']) {
      fireEvent.click(within(definition(label)).getByRole('button', { name: 'Copy' }));
      await within(definition(label)).findByRole('button', { name: 'Copied' });
    }
    expect(writeText.mock.calls).toEqual([[''], ['']]);
  });
});
