/**
 * GDPRArtifactDetails — artifact metadata detail panel contract.
 *
 * Exercises every branch of the panel and its two private sub-components
 * (`TimeValue`, `MetaRow`), which are only reachable through the exported
 * `GDPRArtifactDetails`:
 *   - the loading branch (aria-hidden skeleton grid + aria-busy panel) and
 *     its "keep stale data" guard (`Boolean(loading) && !artifact`),
 *   - the fully-populated metadata grid (every optional row rendered) plus
 *     the `TimeValue` wiring into the shared date formatters,
 *   - the minimal artifact where each optional `&&` row collapses away,
 *   - the copy affordances (ID + SHA-256) writing the right value to the
 *     clipboard and toggling to the "Copied" state,
 *   - the empty state — the hardening fix that replaces the old blank-panel
 *     `null` branch so the panel is never left title-only,
 *   - defensive null-safety for the nullable optional fields.
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` yields the English
 * default — assertions then read against the real copy. `@/lib/dateFormat`
 * is stubbed to deterministic `DT:`/`REL:` prefixes so the absolute /
 * relative labels don't depend on the host timezone and we can prove the
 * component threads the correct ISO string into each formatter. Interactions
 * use `fireEvent` (the repo does not ship `@testing-library/user-event`;
 * see CopyButton.test.tsx / GasPriceControlPanel.test.tsx). Everything else —
 * GlassPanel, CopyButton, Skeleton, EmptyState, Typography — renders for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

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
    formatDateTime: (iso: unknown) => `DT:${String(iso)}`,
    formatRelative: (iso: unknown) => `REL:${String(iso)}`,
  };
});

import { GDPRArtifactDetails } from './GDPRArtifactDetails';
import type { GDPRExportArtifact } from '@/types/admin-operator-confidence';

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

function makeArtifact(
  overrides: Partial<GDPRExportArtifact> = {},
): GDPRExportArtifact {
  return {
    id: 'artifact-8f4c-01',
    user_id: 'user-42',
    status: 'complete',
    format: 'zip',
    bytes: 2048,
    sha256: 'abc123def456',
    storage: 's3',
    download_url: 'https://example.test/dl',
    created_at: '2026-01-02T03:04:05Z',
    completed_at: '2026-01-02T03:10:00Z',
    expires_at: '2026-02-01T00:00:00Z',
    error: null,
    ...overrides,
  };
}

/** The GlassPanel root carries a stable `data-print-card` hook. */
function panelEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-print-card]');
  if (!el) throw new Error('panel root not found');
  return el as HTMLElement;
}

describe('GDPRArtifactDetails — loading', () => {
  it('renders an aria-hidden skeleton grid and marks the panel busy', () => {
    const { container } = render(<GDPRArtifactDetails loading />);

    // Title always shows so the panel is never anonymous.
    expect(
      screen.getByRole('heading', { name: 'Artifact details' }),
    ).toBeInTheDocument();

    // Six KV placeholder rows × two bars each = twelve pulses.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(12);

    // The decorative grid is hidden from assistive tech, and the panel
    // advertises its busy state instead.
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(panelEl(container).getAttribute('aria-busy')).toBe('true');

    // No real metadata and no empty-state while loading.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('ID')).toBeNull();
  });

  it('keeps rendering existing data (not a skeleton) when refetching over an artifact', () => {
    const artifact = makeArtifact();
    const { container } = render(
      <GDPRArtifactDetails loading artifact={artifact} />,
    );

    // `Boolean(loading) && !artifact` is false → the grid wins over the
    // skeleton so the panel updates progressively instead of flashing empty.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
    expect(screen.getByText(artifact.id)).toBeInTheDocument();
    expect(panelEl(container).getAttribute('aria-busy')).toBe('false');
  });
});

describe('GDPRArtifactDetails — populated grid', () => {
  it('renders every row and threads each ISO through the shared formatters', () => {
    const artifact = makeArtifact();
    render(<GDPRArtifactDetails artifact={artifact} />);

    for (const label of ['ID', 'User', 'Created', 'Completed', 'Expires', 'SHA-256']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Scalar values.
    expect(screen.getByText(artifact.id)).toBeInTheDocument();
    expect(screen.getByText('user-42')).toBeInTheDocument();
    expect(screen.getByText('abc123def456')).toBeInTheDocument();

    // TimeValue wiring: absolute + relative label per timestamp, with the
    // exact ISO string forwarded to each formatter.
    expect(screen.getByText('DT:2026-01-02T03:04:05Z')).toBeInTheDocument();
    expect(screen.getByText('REL:2026-01-02T03:04:05Z')).toBeInTheDocument();
    expect(screen.getByText('DT:2026-01-02T03:10:00Z')).toBeInTheDocument();
    expect(screen.getByText('DT:2026-02-01T00:00:00Z')).toBeInTheDocument();

    // One copy affordance for the ID and one for the SHA-256 digest.
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);

    // Not loading and not empty.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('collapses each optional row when its field is absent', () => {
    const artifact = makeArtifact({
      user_id: null,
      completed_at: null,
      expires_at: null,
      sha256: null,
    });
    render(<GDPRArtifactDetails artifact={artifact} />);

    // Required rows survive.
    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();

    // Every guarded `&&` row falls away.
    expect(screen.queryByText('User')).toBeNull();
    expect(screen.queryByText('Completed')).toBeNull();
    expect(screen.queryByText('Expires')).toBeNull();
    expect(screen.queryByText('SHA-256')).toBeNull();

    // Only the ID keeps a copy button when the digest is gone.
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(1);
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
    const artifact = makeArtifact({ id: 'copy-me-id', sha256: 'copy-me-sha' });
    render(<GDPRArtifactDetails artifact={artifact} />);

    const [idCopy, shaCopy] = screen.getAllByRole('button', { name: 'Copy' });

    fireEvent.click(idCopy);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('copy-me-id');
    });
    // Success flips the affordance to its "Copied" confirmation state.
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();

    fireEvent.click(shaCopy);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('copy-me-sha');
    });
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('exposes an accessible name on the icon-only copy control', () => {
    render(<GDPRArtifactDetails artifact={makeArtifact({ sha256: null })} />);
    const copy = screen.getByRole('button', { name: 'Copy' });
    // Icon-only button still surfaces a label for screen readers.
    expect(copy).toHaveAttribute('aria-label', 'Copy');
    expect(copy).not.toHaveTextContent('Copy');
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
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(panelEl(container).getAttribute('aria-busy')).toBe('false');
  });

  it('renders the metadata even when every nullable field is undefined', () => {
    // A minimal artifact shaped like the required-only API contract.
    const artifact: GDPRExportArtifact = {
      id: 'minimal-id',
      status: 'queued',
      format: 'json',
      created_at: '2026-03-03T03:03:03Z',
    };
    render(<GDPRArtifactDetails artifact={artifact} />);

    expect(screen.getByText('minimal-id')).toBeInTheDocument();
    expect(screen.getByText('DT:2026-03-03T03:03:03Z')).toBeInTheDocument();
    // Absent optional fields must not throw or leak "undefined" rows.
    expect(screen.queryByText('SHA-256')).toBeNull();
    expect(screen.queryByText('undefined')).toBeNull();
  });
});
