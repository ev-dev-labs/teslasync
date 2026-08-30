import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRESENTATION_DISPLAY_CONFIG,
} from '@/hooks/usePresentationMode';
import { PresentationOverlay } from './PresentationOverlay';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatTime: () => '12:00',
    formatDateWithDay: () => 'Monday, January 1',
  }),
}));

vi.mock('@/components/layout/CopyLinkButton', () => ({
  CopyLinkButton: () => <button type="button">Copy link</button>,
}));

const baseProps = {
  config: DEFAULT_PRESENTATION_DISPLAY_CONFIG,
  isDimmed: false,
  isCursorHidden: false,
  onExit: vi.fn(),
};

describe('PresentationOverlay', () => {
  it('renders no chrome in standard mode', () => {
    const { container } = render(
      <PresentationOverlay mode="standard" {...baseProps} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a print-excluded report toolbar with exit control', () => {
    const onExit = vi.fn();
    render(
      <PresentationOverlay
        mode="report"
        {...baseProps}
        onExit={onExit}
      />,
    );

    const toolbar = screen.getByText('Report view').closest(
      '[data-role="presentation-toolbar"]',
    );
    expect(toolbar).toHaveAttribute('data-print-hide');
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Exit presentation mode' }),
    );
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
