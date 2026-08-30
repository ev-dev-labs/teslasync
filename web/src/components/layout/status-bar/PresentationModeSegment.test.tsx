import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  enterReport: vi.fn(),
  enterKiosk: vi.fn().mockResolvedValue(undefined),
  copyPresentationLink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/hooks/usePresentationMode', () => ({
  usePresentationMode: () => ({
    enterReport: actions.enterReport,
    enterKiosk: actions.enterKiosk,
  }),
  copyPresentationLink: actions.copyPresentationLink,
}));

import { PresentationModeSegment } from './PresentationModeSegment';

beforeEach(() => {
  actions.enterReport.mockReset();
  actions.enterKiosk.mockReset();
  actions.enterKiosk.mockResolvedValue(undefined);
  actions.copyPresentationLink.mockReset();
  actions.copyPresentationLink.mockResolvedValue(undefined);
});

describe('PresentationModeSegment', () => {
  it('offers report, share, and kiosk actions in the embedded status menu', async () => {
    const onAction = vi.fn();
    render(<PresentationModeSegment embedded onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', { name: /Open report view/i }));
    expect(actions.enterReport).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Copy report link/i }));
    await waitFor(() =>
      expect(actions.copyPresentationLink).toHaveBeenCalledWith('report'),
    );

    fireEvent.click(screen.getByRole('button', { name: /Open kiosk view/i }));
    expect(actions.enterKiosk).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledTimes(3);
  });

  it('collapses the direct status-line trigger to an icon', () => {
    render(<PresentationModeSegment iconOnly />);

    expect(
      screen.getByRole('button', { name: 'Open presentation options' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Present')).toBeNull();
  });
});
