import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ComponentProps } from 'react';

import { OnboardingRuntimeHealthNotice } from './OnboardingRuntimeHealthNotice';

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDateTime: (value: string) => `formatted ${value}` }),
}));

type NoticeProps = ComponentProps<typeof OnboardingRuntimeHealthNotice>;
const defaults: NoticeProps = {
  setupComplete: true,
  teslaConnected: false,
  telemetryHealth: 'stale',
  lastTelemetryAt: null,
};

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="recovery-destination">{pathname}</div>;
}

function renderNotice(overrides: Partial<NoticeProps> = {}) {
  return render(
    <MemoryRouter initialEntries={['/onboarding']}>
      <OnboardingRuntimeHealthNotice {...defaults} {...overrides} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('OnboardingRuntimeHealthNotice recovery targets', () => {
  it('keeps all three wrapping mobile targets and original recovery destinations', async () => {
    const user = userEvent.setup();
    renderNotice();
    const notice = screen.getByRole('status');

    expect(notice).toHaveAttribute('aria-live', 'polite');
    expect(within(notice).getByText(
      'Setup is complete, but a live service needs attention',
    )).toBeInTheDocument();
    expect(within(notice).getByText(
      'You can keep using TeslaSync and viewing stored history while live services recover.',
    )).toBeInTheDocument();
    expect(within(notice).getAllByRole('button')).toHaveLength(3);

    for (const [label, destination] of [
      ['Reconnect Tesla account', '/tesla-account'],
      ['View system status', '/system-status'],
      ['Configure health alerts', '/notifications/channels'],
    ]) {
      const action = within(notice).getByRole('button', { name: label });
      expect(action).toBeEnabled();
      expect(action).toHaveClass(
        'h-auto', 'min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-0',
        'max-w-full', 'whitespace-normal',
      );
      expect(action).not.toHaveClass('h-9');
      expect(within(action).getByText(label)).toHaveClass('min-w-0', 'break-words');
      expect(action.parentElement).toHaveClass(
        'flex-col', 'gap-2', 'sm:flex-row', 'sm:flex-wrap',
      );

      await user.click(action);
      expect(screen.getByTestId('recovery-destination')).toHaveTextContent(destination);
    }
  });

  it('retains a stale observation and only telemetry recovery when authorization is available', () => {
    renderNotice({ teslaConnected: true, lastTelemetryAt: '2026-10-06T20:00:00Z' });

    expect(screen.getByText(
      'Fleet Telemetry is stale. The last signal arrived formatted 2026-10-06T20:00:00Z.',
    )).toBeInTheDocument();
    expect(screen.queryByText(
      'Your Tesla account authorization is unavailable and may need to be renewed.',
    )).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconnect Tesla account' })).toBeNull();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'View system status',
      'Configure health alerts',
    ]);
  });

  it('retains authorization recovery without asserting unknown telemetry is stale', () => {
    renderNotice({ telemetryHealth: 'unknown' });

    expect(screen.getByText(
      'Your Tesla account authorization is unavailable and may need to be renewed.',
    )).toBeInTheDocument();
    expect(screen.queryByText(/Fleet Telemetry is stale/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View system status' })).toBeNull();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Reconnect Tesla account',
      'Configure health alerts',
    ]);
  });

  it('retains the stale warning without inventing an observation time', () => {
    renderNotice();

    expect(screen.getByText(
      'Fleet Telemetry is stale and live values may be out of date.',
    )).toBeInTheDocument();
    expect(screen.queryByText(/The last signal arrived/)).not.toBeInTheDocument();
  });

  it.each([
    { name: 'incomplete setup', setupComplete: false, teslaConnected: false, telemetryHealth: 'stale' },
    { name: 'healthy services', setupComplete: true, teslaConnected: true, telemetryHealth: 'healthy' },
    { name: 'unknown telemetry without an authorization outage', setupComplete: true, teslaConnected: true, telemetryHealth: 'unknown' },
  ] satisfies Array<Pick<NoticeProps, 'setupComplete' | 'teslaConnected' | 'telemetryHealth'> & { name: string }>)(
    'does not introduce recovery actions for $name',
    ({ setupComplete, teslaConnected, telemetryHealth }) => {
      renderNotice({ setupComplete, teslaConnected, telemetryHealth });

      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.getByTestId('recovery-destination')).toHaveTextContent('/onboarding');
    },
  );
});
