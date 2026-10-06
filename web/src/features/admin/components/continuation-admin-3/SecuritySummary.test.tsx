import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SecuritySummary } from './SecuritySummary';

vi.mock('react-i18next', async () => {
  const { testTranslation } = await import('./testTranslation');
  return {
    ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
    useTranslation: () => ({ t: testTranslation, i18n: { language: 'en', changeLanguage: vi.fn() } }),
  };
});

describe('SecuritySummary independent sources', () => {
  it('does not claim Secure, zero history or zero uptime before either source resolves', () => {
    render(<SecuritySummary isSecure={null} lastLockChange={undefined} sentryUptime={null}
      totalEvents={null} latestLoading={false} historyLoading={false} />);
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText('Secure')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('preserves true zero, real status and existing integer-percent formatting', () => {
    render(<SecuritySummary isSecure={false} lastLockChange={undefined} sentryUptime={0}
      totalEvents={0} latestLoading={false} historyLoading={false} />);
    expect(screen.getByText('Unsecure')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('Last lock change')).toBeInTheDocument();
  });

  it('keeps known history metrics while latest state is still loading', () => {
    render(<SecuritySummary isSecure={null} lastLockChange={undefined} sentryUptime={25}
      totalEvents={4} latestLoading historyLoading={false} />);
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.queryByText('Current status')).not.toBeInTheDocument();
  });
});
