/**
 * GDPRArtifactDetails — artifact metadata detail panel contract.
 *
 * Exercises every branch of the panel and its two private sub-components
 * (`TimeValue`, `MetaRow`), which are only reachable through the exported
 * `GDPRArtifactDetails`:
 *   - the loading branch (aria-hidden skeleton grid + aria-busy panel) and
 *     its "keep stale data" guard (`Boolean(loading) && !artifact`),
 *   - all eleven canonical manifest fields and semantic dt/dd associations,
 *     with `TimeValue` delegating raw timestamps to shared date formatters,
 *   - absent downloaded timestamps staying unknown while measured zero
 *     counts remain zero; metadata terms never disappear,
 *   - the copy affordances (ID + SHA-256) writing the right value to the
 *     clipboard and toggling to the "Copied" state,
 *   - the empty state — the hardening fix that replaces the old blank-panel
 *     `null` branch so the panel is never left title-only,
 *   - defensive null-safety for the manifest's optional downloaded timestamp.
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` yields the English
 * default — assertions then read against the real copy. `@/lib/dateFormat`
 * is stubbed to deterministic `DT:`/`REL:` prefixes so the absolute /
 * relative labels don't depend on the host timezone and we can prove the
 * component threads the correct ISO string into each formatter. Interactions
 * use `fireEvent`, matching the original fixture. Everything else —
 * GlassPanel, CopyButton, Skeleton, EmptyState, Typography — renders for real.
 *
 * Original nine test identities are preserved. The old "optional row"
 * name now covers unknown row content rather than deleting metadata; User /
 * Completed were phantom fields, replaced by real job/vehicle identity and
 * Downloaded. The explicit scenario crosswalk is in the assignment receipt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

const dates = vi.hoisted(() => ({
  absolute: vi.fn<typeof import('@/lib/dateFormat')['formatDateTime']>(
    (iso) => iso == null || iso === '' ? '—' : `DT:${String(iso)}`,
  ),
  relative: vi.fn<typeof import('@/lib/dateFormat')['formatRelative']>(
    (iso) => iso == null || iso === '' ? '—' : `REL:${String(iso)}`,
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

// Deterministic, host-timezone-independent formatters that echo their input
// so we can assert the exact ISO string each row threads through.
vi.mock('@/lib/dateFormat', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/dateFormat')>('@/lib/dateFormat');
  return {
    ...actual,
    formatDateTime: dates.absolute,
    formatRelative: dates.relative,
  };
});

import { GDPRArtifactDetails } from './GDPRArtifactDetails';
import type { GDPRExportArtifact } from '@/types/admin-operator-confidence';

const writeText = vi.fn<(text: string) => Promise<void>>();
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

beforeEach(() => {
  dates.absolute.mockReset().mockImplementation(
    (iso) => iso == null || iso === '' ? '—' : `DT:${String(iso)}`,
  );
  dates.relative.mockReset().mockImplementation(
    (iso) => iso == null || iso === '' ? '—' : `REL:${String(iso)}`,
  );
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

function makeArtifact(
  overrides: Partial<GDPRExportArtifact> = {},
): GDPRExportArtifact {
  return {
    id: 'artifact-8f4c-01',
    export_job_id: 'qa-export-job-42',
    vehicle_id: 42,
    byte_count: 2048,
    sha256: 'abc123def456',
    storage_kind: 's3',
    storage_path: 'qa-only/bundle.zip',
    created_at: '2026-01-02T03:04:05Z',
    downloaded_at: '2026-01-02T03:10:00Z',
    expires_at: '2026-02-01T00:00:00Z',
    download_count: 3,
    ...overrides,
  };
}

/** The GlassPanel root carries a stable `data-print-card` hook. */
function panelEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-print-card]');
  if (!el) throw new Error('panel root not found');
  return el;
}

function definition(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: 'dt' });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement) || value.tagName !== 'DD') {
    throw new Error(`Missing definition for ${label}`);
  }
  return value;
}

describe('GDPRArtifactDetails — loading', () => {
  it('renders an aria-hidden skeleton grid and marks the panel busy', () => {
    const { container } = render(<GDPRArtifactDetails loading />);

    // Title always shows so the panel is never anonymous.
    expect(
      screen.getByRole('heading', { name: 'Artifact details' }),
    ).toBeInTheDocument();

    // Six KV placeholder rows × two static, decorative bars each.
    const placeholders = panelEl(container).querySelectorAll(
      '[aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]',
    );
    expect(placeholders).toHaveLength(12);
    placeholders.forEach((placeholder, index) => {
      expect(placeholder).toHaveAttribute('aria-hidden', 'true');
      expect(placeholder).toHaveClass('rounded', 'bg-[var(--skeleton-bg)]');
      expect(placeholder).toHaveStyle({
        width: index % 2 === 0 ? '40%' : '80%',
        height: index % 2 === 0 ? '12px' : '18px',
      });
      expect(placeholder).toBeEmptyDOMElement();
    });
    expect(panelEl(container).querySelectorAll('.animate-pulse')).toHaveLength(0);

    // The decorative grid is hidden from assistive tech, and the panel
    // advertises its busy state instead.
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(panelEl(container).getAttribute('aria-busy')).toBe('true');

    // No real metadata and no empty-state while loading.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('ID')).toBeNull();
    expect(panelEl(container).querySelector('dl')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
  });

  it('keeps rendering existing data (not a skeleton) when refetching over an artifact', () => {
    const artifact = makeArtifact();
    const { container } = render(
      <GDPRArtifactDetails loading artifact={artifact} />,
    );

    // `Boolean(loading) && !artifact` is false → the grid wins over the
    // skeleton so the panel updates progressively instead of flashing empty.
    expect(panelEl(container).querySelectorAll(
      '[aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]',
    )).toHaveLength(0);
    expect(screen.getByText(artifact.id)).toBeInTheDocument();
    expect(panelEl(container).getAttribute('aria-busy')).toBe('false');
    expect(panelEl(container).querySelectorAll('dt')).toHaveLength(11);
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('GDPRArtifactDetails — populated grid', () => {
  it('renders every row and threads each ISO through the shared formatters', async () => {
    const artifact = makeArtifact({
      id: '  Qa/Artifact?#  ',
      export_job_id: '  Job%2F:Case?#  ',
      sha256: '  AbCd:Hash  ',
      storage_kind: 'QA_CUSTOM_KIND',
      storage_path: '  qa-only/Case?bundle#  ',
    });
    const { container, rerender } = render(<GDPRArtifactDetails artifact={artifact} />);

    const labels = [
      'ID', 'Export job ID', 'Vehicle ID', 'Created', 'Downloaded', 'Expires',
      'Byte count', 'Storage kind', 'Storage path', 'Download count', 'SHA-256',
    ];
    for (const label of labels) {
      expect(screen.getByText(label, { selector: 'dt' })).toBeInTheDocument();
      expect(definition(label)).toBeInTheDocument();
    }
    expect(container.querySelectorAll('dt')).toHaveLength(11);
    expect(container.querySelectorAll('dd')).toHaveLength(11);

    // Opaque identity, paths, kinds and hashes must not be normalized.
    for (const [label, value] of [
      ['ID', artifact.id], ['Export job ID', artifact.export_job_id],
      ['SHA-256', artifact.sha256], ['Storage kind', artifact.storage_kind],
      ['Storage path', artifact.storage_path],
      ['Vehicle ID', String(artifact.vehicle_id)], ['Byte count', String(artifact.byte_count)],
      ['Download count', String(artifact.download_count)],
    ]) {
      expect(definition(label).querySelector('code')?.textContent).toBe(value);
    }

    // TimeValue wiring: absolute + relative label per timestamp, with the
    // exact ISO string forwarded to each formatter.
    expect(screen.getByText('DT:2026-01-02T03:04:05Z')).toBeInTheDocument();
    expect(screen.getByText('REL:2026-01-02T03:04:05Z')).toBeInTheDocument();
    expect(screen.getByText('DT:2026-01-02T03:10:00Z')).toBeInTheDocument();
    expect(screen.getByText('DT:2026-02-01T00:00:00Z')).toBeInTheDocument();
    for (const iso of [artifact.created_at, artifact.downloaded_at, artifact.expires_at]) {
      expect(dates.absolute).toHaveBeenCalledWith(iso);
      expect(dates.relative).toHaveBeenCalledWith(iso);
      expect(screen.getByText(`DT:${iso}`)).toHaveAttribute('title', iso);
      expect(screen.getByText(`REL:${iso}`)).toBeInTheDocument();
    }
    expect(dates.absolute.mock.calls).toEqual([
      [artifact.created_at], [artifact.downloaded_at], [artifact.expires_at],
    ]);

    // One copy affordance for the ID and one for the SHA-256 digest.
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);

    // Not loading and not empty.
    expect(screen.queryByRole('status')).toBeNull();

    // Preferences remain formatter-owned, not a feature-local date override.
    const sharedDates = await vi.importActual<typeof import('@/lib/dateFormat')>('@/lib/dateFormat');
    const preferences = { locale: 'de-DE', tz: 'America/Los_Angeles' };
    dates.absolute.mockImplementation((iso) => sharedDates.formatDateTime(iso, preferences));
    dates.relative.mockImplementation((iso) => sharedDates.formatRelative(iso, preferences));
    rerender(<GDPRArtifactDetails artifact={artifact} />);
    const timestampRows: ReadonlyArray<readonly [string, string | null | undefined]> = [
      ['Created', artifact.created_at],
      ['Downloaded', artifact.downloaded_at],
      ['Expires', artifact.expires_at],
    ];
    for (const [label, iso] of timestampRows) {
      const value = definition(label);
      expect(value).toHaveTextContent(sharedDates.formatDateTime(iso, preferences));
      expect(value).toHaveTextContent(sharedDates.formatRelative(iso, preferences));
      expect(value.querySelector('[title]')).toHaveAttribute('title', iso);
    }
  });

  it('collapses each optional row when its field is absent', () => {
    const artifact = makeArtifact({
      downloaded_at: null,
    });
    const { container } = render(<GDPRArtifactDetails artifact={artifact} />);

    // Required rows survive.
    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();

    // Only optional timestamp content collapses to unknown; terms survive.
    expect(definition('Downloaded').textContent).toBe('——');
    expect(dates.absolute).toHaveBeenCalledWith(null);
    expect(dates.relative).toHaveBeenCalledWith(null);
    expect(definition('Downloaded').querySelector('div')).not.toHaveAttribute('title');
    expect(container.querySelectorAll('dt')).toHaveLength(11);
    expect(screen.getByText('Expires', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText('SHA-256', { selector: 'dt' })).toBeInTheDocument();

    // Both required opaque values retain their copy actions.
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
  });

  it('forwards the className to the panel root', () => {
    const { container } = render(
      <GDPRArtifactDetails artifact={makeArtifact()} className="xl:col-span-2" />,
    );
    expect(panelEl(container).className).toContain('xl:col-span-2');
  });
});

describe('GDPRArtifactDetails — copy affordances', () => {
  it('copies the ID and the SHA-256 to the clipboard and toggles to "Copied"', async () => {
    const artifact = makeArtifact({
      id: '  copy-me-id/?#Case  ',
      sha256: '  copy-me-sha:AbCd  ',
    });
    render(<GDPRArtifactDetails artifact={artifact} />);

    const [idCopy, shaCopy] = screen.getAllByRole('button', { name: 'Copy' });

    fireEvent.click(idCopy);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(artifact.id);
    });
    // Success flips the affordance to its "Copied" confirmation state.
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();

    fireEvent.click(shaCopy);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(artifact.sha256);
    });
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(await within(definition('SHA-256')).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('exposes an accessible name on the icon-only copy control', () => {
    render(<GDPRArtifactDetails artifact={makeArtifact({ sha256: '' })} />);
    const copy = within(definition('ID')).getByRole('button', { name: 'Copy' });
    // Icon-only button still surfaces a label for screen readers.
    expect(copy).toHaveAttribute('aria-label', 'Copy');
    expect(copy).not.toHaveTextContent('Copy');
    expect(copy).toHaveAttribute('type', 'button');
    expect(copy).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9');
    expect(within(definition('SHA-256')).getByRole('button', { name: 'Copy' }))
      .toHaveAttribute('aria-label', 'Copy');
    expect(definition('SHA-256').querySelector('code')?.textContent).toBe('');
  });
});

describe('GDPRArtifactDetails — empty & null-safety', () => {
  it('renders an EmptyState (never a blank title-only panel) when idle with no artifact', () => {
    const { container } = render(<GDPRArtifactDetails />);

    // The hardening fix: role="status" empty state, not a bare panel.
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(
      within(status).getByText('Look up an export artifact to see its metadata here.'),
    ).toBeInTheDocument();

    // Panel chrome remains, but no data rows / skeletons and not busy.
    expect(screen.getByRole('heading', { name: 'Artifact details' })).toBeInTheDocument();
    expect(panelEl(container).querySelectorAll(
      '[aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]',
    )).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(panelEl(container).getAttribute('aria-busy')).toBe('false');
  });

  it('renders the metadata even when every nullable field is undefined', () => {
    // All manifest fields are required except downloaded_at.
    const artifact: GDPRExportArtifact = {
      id: 'minimal-id',
      export_job_id: 'qa-minimal-job',
      vehicle_id: 0,
      storage_kind: 'local_fs',
      storage_path: 'qa-only/minimal.zip',
      sha256: '',
      byte_count: 0,
      download_count: 0,
      created_at: '2026-03-03T03:03:03Z',
      expires_at: '2026-04-03T03:03:03Z',
    };
    render(<GDPRArtifactDetails artifact={artifact} />);

    expect(screen.getByText('minimal-id')).toBeInTheDocument();
    expect(screen.getByText('DT:2026-03-03T03:03:03Z')).toBeInTheDocument();
    // Absent optional fields must not throw or leak "undefined" rows.
    expect(screen.getByText('SHA-256', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.queryByText('undefined')).toBeNull();
    expect(definition('Downloaded').textContent).toBe('——');
    expect(dates.absolute).toHaveBeenCalledWith(undefined);
    expect(dates.relative).toHaveBeenCalledWith(undefined);
    for (const label of ['Vehicle ID', 'Byte count', 'Download count']) {
      expect(definition(label).textContent).toBe('0');
    }
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
  });
});
