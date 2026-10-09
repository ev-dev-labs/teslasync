/**
 * BridgeStatus contract.
 *
 * The GitHub-bridge footer is a small but load-bearing status surface: it is
 * the ONLY place an operator learns whether Forward-to-GitHub is wired up. The
 * suite pins every branch and the a11y contract:
 *   1. Loading — shows the skeleton, marks the live region busy, and hides the
 *      resolved copy.
 *   2. Loading precedence — `loading` wins even when `enabled` is true.
 *   3. Connected + repo — success copy, the repo in a <code>, and the " · "
 *      separator between them.
 *   4. Connected + no repo — success copy with NO <code> and NO separator
 *      (branch guard for the `repo ? … : …` split).
 *   5. Disabled — the "Not configured" copy plus the env-var remediation hint.
 *   6. a11y — the dynamic portion is a `role="status"` region whose accessible
 *      name is the visible "GitHub bridge" heading, and the decorative icons
 *      are `aria-hidden` (kept out of the a11y tree).
 *
 * react-i18next is mocked (mirroring the sibling ApiKeyCard test) so the
 * fallback strings render deterministically without locale files.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { BridgeStatus } from './BridgeStatus';

const REPO = 'ev-dev-labs/teslasync';

afterEach(() => {
  cleanup();
});

describe('BridgeStatus', () => {
  it('renders the always-visible heading regardless of state', () => {
    render(<BridgeStatus enabled={false} repo="" loading={false} />);
    expect(screen.getByText('GitHub bridge')).toBeInTheDocument();
  });

  it('loading: shows a skeleton, marks the live region busy, and hides resolved copy', () => {
    render(<BridgeStatus enabled={false} repo="" loading />);

    const region = screen.getByRole('status', { name: 'GitHub bridge' });
    expect(region).toHaveAttribute('aria-busy', 'true');
    // The busy region owns one static decorative placeholder.
    const placeholders = region.querySelectorAll(':scope > div[aria-hidden="true"]');
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]).toHaveClass('h-4', 'rounded', 'bg-[var(--skeleton-bg)]');
    expect(placeholders[0]).toHaveStyle({ height: '16px', width: '60%' });
    expect(placeholders[0]).not.toHaveClass('animate-pulse');
    // Neither resolved branch should be present while loading.
    expect(screen.queryByText(/Connected/)).toBeNull();
    expect(screen.queryByText('Not configured')).toBeNull();
  });

  it('loading precedence: stays in the skeleton even when enabled is true', () => {
    render(<BridgeStatus enabled repo={REPO} loading />);

    const region = screen.getByRole('status', { name: 'GitHub bridge' });
    expect(region).toHaveAttribute('aria-busy', 'true');
    const placeholders = region.querySelectorAll(':scope > div[aria-hidden="true"]');
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]).toHaveClass('h-4', 'rounded', 'bg-[var(--skeleton-bg)]');
    expect(placeholders[0]).toHaveStyle({ height: '16px', width: '60%' });
    expect(placeholders[0]).not.toHaveClass('animate-pulse');
    expect(screen.queryByText(/Connected/)).toBeNull();
    expect(screen.queryByText(REPO)).toBeNull();
  });

  it('connected + repo: shows success copy, the repo in a <code>, and the separator', () => {
    render(<BridgeStatus enabled repo={REPO} loading={false} />);

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'false');

    // Success label carries the middot separator when a repo is present.
    expect(screen.getByText(/Connected/)).toHaveTextContent('·');

    // Repo is rendered through the monospace Code primitive.
    const repo = screen.getByText(REPO);
    expect(repo.tagName).toBe('CODE');

    // Decorative status icon stays out of the a11y tree.
    expect(region.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('connected + no repo: shows success copy with no <code> and no separator', () => {
    const { container } = render(<BridgeStatus enabled repo="" loading={false} />);

    expect(screen.getByText('Connected')).toBeInTheDocument();
    // Branch guard: without a repo there is neither a code element nor a middot.
    expect(container.querySelector('code')).toBeNull();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it('disabled: shows the "Not configured" copy plus the env-var remediation hint', () => {
    render(<BridgeStatus enabled={false} repo="" loading={false} />);

    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.getByText(/Set TESLASYNC_GITHUB_REPO \+ TESLASYNC_GITHUB_TOKEN/)).toBeInTheDocument();
    // The info icon is decorative.
    expect(screen.getByRole('status').querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    // Never surfaces the connected copy in the disabled branch.
    expect(screen.queryByText(/Connected/)).toBeNull();
  });

  it('a11y: the status region is labelled by the visible heading', () => {
    render(<BridgeStatus enabled repo={REPO} loading={false} />);

    const region = screen.getByRole('status');
    const heading = screen.getByText('GitHub bridge');

    // The region borrows the visible heading as its accessible name via
    // aria-labelledby → no duplicated/aria-only label.
    expect(region.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(heading.id).not.toBe('');
    expect(region).toHaveAccessibleName('GitHub bridge');
  });

  it('unknown: does not claim the bridge is unconfigured when its source could not be read', () => {
    const { container } = render(<BridgeStatus enabled={false} repo="" loading={false} unknown />);
    expect(screen.getByRole('status', { name: 'GitHub bridge' })).toHaveTextContent('Unknown');
    expect(screen.queryByText('Not configured')).toBeNull();
    expect(screen.queryByText(/Set TESLASYNC_GITHUB_REPO/)).toBeNull();
    expect(screen.queryByText(/Connected/)).toBeNull();
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });
});
