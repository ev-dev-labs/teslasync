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
  it('shows only the actionable title, with other evidence owned by separate columns', () => {
    const onActivate = vi.fn();
    const { container } = render(<NotificationInboxSummary log={log} onActivate={onActivate} />);
    expect(container.textContent).toBe(log.title);
    expect(screen.queryByText('Critical')).not.toBeInTheDocument();
    expect(screen.queryByText(log.message)).not.toBeInTheDocument();
    expect(screen.queryByText('alert.rule')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Open notification: ${log.title}` }));
    expect(onActivate).toHaveBeenCalledWith(log);
  });

  it.each(['warning', 'future-severity', null])('does not add secondary metadata or filler for severity %s', severity => {
    const row = { ...log, severity, message: '', created_at: '', read_at: '2026-10-28T16:00:00Z' };
    const { container } = render(<NotificationInboxSummary log={row} onActivate={vi.fn()} />);
    expect(container.textContent).toBe(row.title);
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });
});
