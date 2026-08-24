import { useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui';
import {
  StatusBarProvider,
  useStatusBarPopover,
} from './StatusBarContext';

function Probe({ id, label }: { id: string; label: string }) {
  const { open, toggle } = useStatusBarPopover(id);
  return (
    <div>
      <Button type="button" onClick={toggle}>
        {label}
      </Button>
      {open && <span>{label} open</span>}
    </div>
  );
}

function IdleCloser({ id }: { id: string }) {
  const { close } = useStatusBarPopover(id);
  useEffect(() => close(), [close]);
  return null;
}

describe('StatusBarProvider', () => {
  it('allows only one coordinated popover to remain open', () => {
    render(
      <StatusBarProvider announcementLabel="Status announcements">
        <Probe id="recent" label="Recent" />
        <Probe id="alerts" label="Alerts" />
      </StatusBarProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    expect(screen.getByText('Recent open')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Alerts' }));
    expect(screen.queryByText('Recent open')).toBeNull();
    expect(screen.getByText('Alerts open')).toBeInTheDocument();
  });

  it('falls back to local state when a segment is tested outside the provider', () => {
    render(<Probe id="recent" label="Recent" />);

    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    expect(screen.getByText('Recent open')).toBeInTheDocument();
  });

  it('does not let an inactive segment close a different open popover', () => {
    render(
      <StatusBarProvider announcementLabel="Status announcements">
        <Probe id="recent" label="Recent" />
        <IdleCloser id="alerts" />
      </StatusBarProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    expect(screen.getByText('Recent open')).toBeInTheDocument();
  });

  it('clears an active popover when its responsive branch unmounts', () => {
    const renderProvider = (showProbe: boolean) => (
      <StatusBarProvider announcementLabel="Status announcements">
        {showProbe && <Probe id="more" label="More" />}
      </StatusBarProvider>
    );
    const { rerender } = render(renderProvider(true));

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByText('More open')).toBeInTheDocument();

    rerender(renderProvider(false));
    rerender(renderProvider(true));

    expect(screen.queryByText('More open')).toBeNull();
  });
});
