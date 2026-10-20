import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { request } from '@/api/client';
import type { SecretRotationStatus } from '@/types/admin-operator-confidence';
import { useSecretRotationPage } from '../../../hooks/useSecretRotationPage';
import { SecretRotationOutlook } from './SecretRotationOutlook';

vi.mock('@/api/client', () => ({
  request: vi.fn(),
  isApiError: () => false,
}));

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

type TransportStatus = Omit<SecretRotationStatus, 'age_days' | 'critical_days'> & {
  age_days: number | null | undefined;
  critical_days: number | null | undefined;
};

function status(overrides: Partial<TransportStatus> = {}): TransportStatus {
  return {
    kind: 'session_jwk',
    target_id: 'synthetic-target',
    last_rotated: '2026-01-01T00:00:00Z',
    age_days: 80,
    warn_days: 60,
    critical_days: 120,
    expires_at: null,
    days_to_expiry: null,
    severity: 'warn',
    ...overrides,
  };
}

function OutlookHarness() {
  return <SecretRotationOutlook controller={useSecretRotationPage()} />;
}

function renderOutlook() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  const rendered = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <OutlookHarness />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...rendered, client };
}

beforeEach(() => {
  vi.mocked(request).mockReset();
});

describe('SecretRotationOutlook', () => {
  it.each([
    { name: 'null threshold', critical_days: null, age_days: 80, readout: '80.00d / —' },
    { name: 'absent threshold', critical_days: undefined, age_days: 80, readout: '80.00d / —' },
    { name: 'zero threshold', critical_days: 0, age_days: 80, readout: '80.00d / 0.00d' },
    { name: 'negative threshold', critical_days: -1, age_days: 80, readout: '80.00d / -1.00d' },
    { name: 'nonfinite threshold', critical_days: Infinity, age_days: 80, readout: '80.00d / —' },
    { name: 'null age', critical_days: 120, age_days: null, readout: '— / 120.00d' },
    { name: 'absent age', critical_days: 120, age_days: undefined, readout: '— / 120.00d' },
    { name: 'nonfinite age', critical_days: 120, age_days: NaN, readout: '— / 120.00d' },
    { name: 'negative age', critical_days: 120, age_days: -1, readout: '-1.00d / 120.00d' },
    { name: 'zero age and threshold', critical_days: 0, age_days: 0, readout: '0.00d / 0.00d' },
  ])('keeps $name unknown without a numeric urgency or fill', async ({ critical_days, age_days, readout }) => {
    vi.mocked(request).mockResolvedValue({ items: [status({ critical_days, age_days, severity: 'unknown' })] });
    renderOutlook();

    const bar = await screen.findByRole('progressbar', { name: 'Session JWK · synthetic-target' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('aria-valuetext', 'No reading');
    expect(bar.querySelector('[data-metric-fill]')).toBeNull();
    expect(within(bar).getByText(readout)).toBeInTheDocument();
    expect(within(bar.parentElement!).getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('OK')).toBeNull();
    expect(screen.queryByText('Overdue')).toBeNull();
  });

  it.each([
    { name: 'measured zero', age_days: 0, critical_days: 120, severity: 'ok', now: '0', tone: 'success', scaled: true },
    { name: 'before threshold', age_days: 119, critical_days: 120, severity: 'warn', now: '119', tone: 'warning', scaled: true },
    { name: 'at threshold', age_days: 120, critical_days: 120, severity: 'critical', now: '120', tone: 'danger', scaled: true },
    { name: 'after threshold', age_days: 121, critical_days: 120, severity: 'critical', now: '120', tone: 'danger', scaled: false },
    { name: 'unknown severity with known operands', age_days: 80, critical_days: 120, severity: 'unknown', now: '80', tone: 'neutral', scaled: true },
  ] satisfies Array<{
    name: string; age_days: number; critical_days: number; severity: SecretRotationStatus['severity']; now: string; tone: string; scaled: boolean;
  }>)('preserves $name operands and uses a restrained solid fill', async ({ age_days, critical_days, severity, now, tone, scaled }) => {
    vi.mocked(request).mockResolvedValue({ items: [status({ age_days, critical_days, severity })] });
    renderOutlook();

    const bar = await screen.findByRole(scaled ? 'progressbar' : 'group', { name: 'Session JWK · synthetic-target' });
    if (scaled) {
      expect(bar).toHaveAttribute('aria-valuemax', '120');
      expect(bar).toHaveAttribute('aria-valuenow', now);
      expect(bar).not.toHaveAttribute('aria-valuetext');
    } else {
      // Out-of-range readings use a described group instead of reporting a fabricated progress value.
      expect(bar).not.toHaveAttribute('aria-valuemax');
      expect(bar).not.toHaveAttribute('aria-valuenow');
      expect(bar).not.toHaveAttribute('aria-valuetext');
      expect(bar).toHaveAttribute('aria-describedby');
      expect(within(bar).getByText(age_days.toFixed(2))).toBeInTheDocument();
    }
    expect(within(bar).getByText(`${age_days.toFixed(2)}d / 120.00d`)).toBeInTheDocument();
    const fill = bar.querySelector<HTMLElement>('[data-metric-fill]');
    expect(fill).not.toBeNull();
    expect(fill?.style.background).toBe(tone === 'neutral' ? 'var(--text-secondary)' : `var(--semantic-${tone})`);
    expect(fill?.style.background).not.toContain('gradient');
    expect(screen.queryByText('Unknown')).toBeNull();
  });

  it('retains complete row identities and raw readings through a refresh failure', async () => {
    const items = [
      status({ target_id: 'synthetic-unknown', critical_days: null, severity: 'unknown' }),
      status({ target_id: 'synthetic-known', age_days: 200, critical_days: 180, severity: 'critical' }),
    ];
    vi.mocked(request).mockResolvedValue({ items });
    const { client } = renderOutlook();
    await screen.findByRole('group', { name: 'Session JWK · synthetic-known' });
    vi.mocked(request).mockRejectedValue(new Error('synthetic refresh failure'));
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(() => expect(client.getQueryCache().getAll().some(query => query.state.error !== null)).toBe(true));

    // Both rows keep their identities: the unknown-threshold row stays a
    // valueless progressbar while the past-threshold row is a described group.
    expect(screen.getByRole('progressbar', { name: 'Session JWK · synthetic-unknown' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Session JWK · synthetic-known' })).toBeInTheDocument();
    expect(screen.getByText('200.00d / 180.00d')).toBeInTheDocument();
    expect(screen.getByText('80.00d / —')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(client.getQueryCache().getAll()[0].state.data).toEqual({ items });
  });

  it('keeps nullable expiry readings unknown and preserves signed and measured-zero expiry', async () => {
    vi.mocked(request).mockResolvedValue({
      items: [
        status({ target_id: 'synthetic-expired', expires_at: '2026-01-01T00:00:00Z', days_to_expiry: -3, severity: 'critical' }),
        status({ target_id: 'synthetic-zero', expires_at: '2026-01-04T00:00:00Z', days_to_expiry: 0, severity: 'warn' }),
        status({ target_id: 'synthetic-no-expiry', days_to_expiry: null }),
        status({ target_id: 'synthetic-invalid-expiry', expires_at: '2026-01-05T00:00:00Z', days_to_expiry: NaN, severity: 'unknown' }),
      ],
    });
    renderOutlook();

    await screen.findByRole('progressbar', { name: 'Session JWK · synthetic-zero' });
    const expired = screen.getAllByText('Session JWK · synthetic-expired').find(node => node.closest('li'));
    expect(expired).toBeDefined();
    expect(within(expired!.closest('li')!).getByText('-3.00 d')).toHaveClass('text-[var(--semantic-danger)]');
    expect(within(expired!.closest('li')!).getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('0.00 d')).toBeInTheDocument();
    const expiryList = screen.getByRole('list');
    expect(within(expiryList).getAllByRole('listitem')).toHaveLength(3);
    expect(within(expiryList).queryByText('Session JWK · synthetic-no-expiry')).toBeNull();
    const invalidExpiry = within(expiryList).getByText('Session JWK · synthetic-invalid-expiry').closest('li')!;
    expect(within(invalidExpiry).getAllByText('—')).toHaveLength(2);
    expect(within(invalidExpiry).queryByText('0.00 d')).toBeNull();
    expect(within(invalidExpiry).queryByText('Overdue')).toBeNull();
  });

  it('keeps both panel shells and original empty explanations', async () => {
    vi.mocked(request).mockResolvedValue({ items: [] });
    renderOutlook();

    expect(await screen.findByText('No rotation ages to rank yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rotation urgency' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Expiry watch' })).toBeInTheDocument();
    expect(screen.getByText('No expiring credentials')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('retains both error recovery actions without fabricated urgency', async () => {
    vi.mocked(request).mockRejectedValue(new Error('synthetic initial failure'));
    renderOutlook();

    await screen.findAllByRole('alert');
    expect(screen.queryByRole('progressbar')).toBeNull();
    const buttons = screen.getAllByRole('button', { name: /retry/i });
    expect(buttons).toHaveLength(2);
    vi.mocked(request).mockResolvedValue({ items: [status()] });
    fireEvent.click(buttons[0]);
    expect(await screen.findByRole('progressbar', { name: 'Session JWK · synthetic-target' })).toHaveAttribute('aria-valuenow', '80');
  });
});
