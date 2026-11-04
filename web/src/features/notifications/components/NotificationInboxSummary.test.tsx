import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@/i18n';
import type { NotificationLog } from '@/api/types';
import { NotificationInboxSummary } from './NotificationInboxSummary';

const log: NotificationLog = {
  id: 1, channel_id: null, alert_id: null, title: 'Recorded battery notification',
  message: 'Battery charge is below the configured threshold.', severity: 'critical',
  status: 'triggered', event_type: 'alert.rule', created_at: '2026-10-28T15:00:00Z',
  sent_at: null, read_at: null, archived_at: null, error: '',
};

describe('NotificationInboxSummary', () => {
  it('keeps severity and message context next to an actionable title without opening details', () => {
    const onActivate = vi.fn();
    render(<NotificationInboxSummary log={log} eventLabel="Alert rule" onActivate={onActivate} />);
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText(log.message)).toBeInTheDocument();
    expect(screen.getByText(/Unread$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Open notification: ${log.title}` }));
    expect(onActivate).toHaveBeenCalledWith(log);
  });

  it.each(['warning', 'future-severity', null])('preserves unknown or missing severity honestly: %s', severity => {
    const row = { ...log, severity, message: '', created_at: '', read_at: '2026-10-28T16:00:00Z' };
    render(<NotificationInboxSummary log={row} eventLabel="Alert rule" onActivate={vi.fn()} />);
    if (severity) expect(screen.getByText(severity === 'warning' ? 'Warn' : severity)).toBeInTheDocument();
    expect(screen.getByText(/Read$/)).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
