/**
 * ApiKeyCard contract.
 *
 * Covers every facet of the single API-key surface:
 *   1. Identity render — name, key prefix, permission label, created date.
 *   2. Unnamed-key fallback flows through to BOTH action aria-labels
 *      (regression guard: an empty `name` must not yield "Revoke key ").
 *   3. Missing key prefix renders the em-dash placeholder.
 *   4. Revoke action calls onRevoke with the key id.
 *   5. Delete action calls onDelete with the full key object.
 *   6. Expired keys show the Expired badge and hide the revoke action.
 *   7. `revoking` puts the revoke action in a busy, disabled state.
 *   8. Last-used vs. never-used lifecycle copy.
 *   9. Icon-only actions expose descriptive aria-labels (a11y).
 *
 * i18n is mocked (mirroring the sibling UserImpersonateButton test) so the
 * `{{name}}` interpolation is deterministic and independent of locale files.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined;
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined);
        const interpolate = (str: string) => {
          if (!opts) return str;
          return Object.entries(opts).reduce<string>((acc, [k, v]) => {
            if (k === 'defaultValue') return acc;
            return acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
          }, str);
        };
        if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue);
        if (fallback != null) return interpolate(fallback);
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { formatDate } from '@/lib/dateFormat';
import type { APIKey } from '@/types/admin';
import { ApiKeyCard } from './ApiKeyCard';

function makeKey(overrides: Partial<APIKey> = {}): APIKey {
  return {
    id: 'key-1',
    name: 'CI Bot',
    keyPrefix: 'tsk_live_ab12',
    permissions: 'read',
    createdAt: '2026-01-15T12:00:00Z',
    lastUsedAt: '2026-02-20T12:00:00Z',
    expiresAt: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('ApiKeyCard', () => {
  it('renders identity: name, key prefix, permission label, and created date', () => {
    const key = makeKey();
    const { container } = render(
      <ApiKeyCard apiKey={key} onRevoke={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByText('CI Bot')).toBeInTheDocument();
    expect(screen.getByText('tsk_live_ab12')).toBeInTheDocument();
    // ApiKeyPermissionBadge resolves the 'read' fallback label.
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(container).toHaveTextContent(`Created ${formatDate(key.createdAt)}`);
  });

  it('falls back to "Unnamed key" and threads that name into both action aria-labels', () => {
    render(<ApiKeyCard apiKey={makeKey({ name: '' })} onRevoke={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Unnamed key')).toBeInTheDocument();
    // Regression guard: raw `name` would produce "Revoke key" with no subject.
    expect(
      screen.getByRole('button', { name: 'Revoke key Unnamed key' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete key Unnamed key' }),
    ).toBeInTheDocument();
  });

  it('renders an em-dash placeholder when the key prefix is missing', () => {
    render(<ApiKeyCard apiKey={makeKey({ keyPrefix: '' })} onRevoke={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('invokes onRevoke with the key id when the revoke action is clicked', () => {
    const onRevoke = vi.fn();
    render(
      <ApiKeyCard apiKey={makeKey({ id: 'abc-123' })} onRevoke={onRevoke} onDelete={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Revoke key CI Bot' }));
    expect(onRevoke).toHaveBeenCalledTimes(1);
    expect(onRevoke).toHaveBeenCalledWith('abc-123');
  });

  it('invokes onDelete with the full key object when the delete action is clicked', () => {
    const onDelete = vi.fn();
    const key = makeKey();
    render(<ApiKeyCard apiKey={key} onRevoke={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete key CI Bot' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(key);
  });

  it('marks expired keys: shows the Expired badge and hides the revoke action', () => {
    render(
      <ApiKeyCard
        apiKey={makeKey({ expiresAt: '2020-01-01T00:00:00Z' })}
        onRevoke={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Revoke key/ })).toBeNull();
    // Delete remains available even for expired keys.
    expect(screen.getByRole('button', { name: 'Delete key CI Bot' })).toBeInTheDocument();
  });

  it('puts the revoke action in a busy, disabled state while revoking', () => {
    render(<ApiKeyCard apiKey={makeKey()} onRevoke={vi.fn()} onDelete={vi.fn()} revoking />);
    const revoke = screen.getByRole('button', { name: 'Revoke key CI Bot' });
    expect(revoke).toBeDisabled();
    expect(revoke).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the last-used date when the key has been used', () => {
    const lastUsedAt = '2026-02-20T12:00:00Z';
    const { container } = render(
      <ApiKeyCard apiKey={makeKey({ lastUsedAt })} onRevoke={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container).toHaveTextContent(`Last used ${formatDate(lastUsedAt)}`);
    expect(screen.queryByText('Never used')).toBeNull();
  });

  it('renders "Never used" when the key has never been used', () => {
    render(<ApiKeyCard apiKey={makeKey({ lastUsedAt: null })} onRevoke={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Never used')).toBeInTheDocument();
    expect(screen.queryByText(/Last used/)).toBeNull();
  });

  it('exposes descriptive aria-labels on the icon-only action buttons', () => {
    render(<ApiKeyCard apiKey={makeKey({ name: 'Grafana' })} onRevoke={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Revoke key Grafana' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete key Grafana' })).toBeInTheDocument();
  });
});
