import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationLog } from '@/api/types';
import { NotificationLatencyPanel } from './NotificationLatencyPanel';

const state = vi.hoisted(() => ({ logs: [] as NotificationLog[] }));
vi.mock('@/api/hooks/useNotifications', () => ({
  useNotificationDeliveryLogs: () => ({ data: state.logs, isLoading: false, isError: false }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values?.[key] ?? `{{${key}}}`)),
  }),
}));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

describe('NotificationLatencyPanel shared delivery table', () => {
  it('preserves notification text, provenance, status and latency without subset checklists', () => {
    state.logs = [{
      id: 1, channel_id: 1, alert_id: null, title: 'User TITLE unchanged', message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: 1250,
      created_at: '2026-08-04T12:00:00Z', sent_at: null,
    }];
    render(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
    const table = screen.getByRole('table', { name: 'Slowest delivery records' });
    expect(within(table).getByText('User TITLE unchanged')).toBeInTheDocument();
    expect(within(table).getByText('Measured')).toBeInTheDocument();
    expect(within(table).getByText(/warn · sent/)).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: /1,250\.00 ms/ })).toHaveClass('text-right');
    expect(within(table).queryByRole('button', { name: /Filter/ })).not.toBeInTheDocument();
  });
});
