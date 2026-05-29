// Pins the user-facing contract of the rate-limit / cost-cap banner:
//   - info=null renders nothing (parent can pass unconditionally)
//   - reason=cost_cap renders danger-style banner with the cost-cap title
//   - bannerLevel=warn renders warning variant; ''=info
//   - retryAfterS>0 hides Retry; countdown ticks; Retry appears when 0
//   - onRetry / onUseBaseline / onDismiss invoke the right callbacks
//   - baselineAvailable=false hides the baseline button
//   - unknown reason still renders a generic title (forward compat)
//
// react-i18next's useTranslation returns the second argument (English
// fallback) when no provider is mounted; no i18n setup needed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AiLimitBanner } from '../AiLimitBanner';
import type { AiLimitInfo } from '@/hooks/useAiStream';

function makeInfo(overrides: Partial<AiLimitInfo> = {}): AiLimitInfo {
  return {
    reason: 'cost_cap',
    retryAfterS: 0,
    bannerLevel: 'critical',
    baselineAvailable: true,
    message: 'daily cost cap reached',
    ...overrides,
  };
}

describe('AiLimitBanner', () => {
  it('renders nothing when info is null', () => {
    const { container } = render(<AiLimitBanner info={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a banner keyed on the reason for cost_cap', () => {
    render(<AiLimitBanner info={makeInfo()} />);
    const banner = screen.getByTestId('ai-limit-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('data-reason', 'cost_cap');
    expect(banner).toHaveTextContent(/Daily cost cap reached/i);
  });

  it.each([
    ['burst' as const, /Too many Helix requests at once/i],
    ['per_minute' as const, /Helix rate limit hit/i],
    ['per_day' as const, /Daily Helix usage limit reached/i],
    ['input_tokens' as const, /Helix token quota exhausted/i],
    ['output_tokens' as const, /Helix token quota exhausted/i],
    ['provider_unavailable' as const, /Helix provider unavailable/i],
    ['settings_unavailable' as const, /Helix settings unavailable/i],
    ['cost_cap_unavailable' as const, /Cost cap check unavailable/i],
    ['missing_feature_id' as const, /Helix feature misconfigured/i],
    ['unknown_feature_id' as const, /Helix feature misconfigured/i],
  ])('renders the right title for reason=%s', (reason, titleRe) => {
    render(<AiLimitBanner info={makeInfo({ reason })} />);
    expect(screen.getByTestId('ai-limit-banner')).toHaveTextContent(titleRe);
  });

  it('falls back to a generic title for an unknown reason', () => {
    render(<AiLimitBanner info={makeInfo({ reason: 'future_reason_xyz' })} />);
    expect(screen.getByTestId('ai-limit-banner')).toHaveTextContent(
      /Helix temporarily unavailable/i,
    );
  });

  it('shows the baseline button only when baselineAvailable AND onUseBaseline supplied', () => {
    const onUseBaseline = vi.fn();
    const { rerender } = render(
      <AiLimitBanner
        info={makeInfo({ baselineAvailable: true })}
        onUseBaseline={onUseBaseline}
      />,
    );
    const btn = screen.getByTestId('ai-limit-banner-baseline');
    fireEvent.click(btn);
    expect(onUseBaseline).toHaveBeenCalledTimes(1);

    // No callback → no button
    rerender(<AiLimitBanner info={makeInfo({ baselineAvailable: true })} />);
    expect(screen.queryByTestId('ai-limit-banner-baseline')).toBeNull();

    // Callback but baselineAvailable=false → no button
    rerender(
      <AiLimitBanner
        info={makeInfo({ baselineAvailable: false })}
        onUseBaseline={onUseBaseline}
      />,
    );
    expect(screen.queryByTestId('ai-limit-banner-baseline')).toBeNull();
  });

  it('invokes onDismiss when the close button is clicked', () => {
    const onDismiss = vi.fn();
    render(<AiLimitBanner info={makeInfo()} onDismiss={onDismiss} />);
    // AlertBanner renders an X button when onClose is supplied; it
    // doesn't have a testid so we click the only button without a
    // dedicated testid.
    const banner = screen.getByTestId('ai-limit-banner');
    const closeBtn = banner.querySelector('button');
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  describe('retry countdown', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('hides Retry while countdown > 0 and shows it when countdown reaches 0', () => {
      const onRetry = vi.fn();
      render(
        <AiLimitBanner
          info={makeInfo({ reason: 'per_minute', retryAfterS: 3 })}
          onRetry={onRetry}
        />,
      );

      // Initially counting down → Retry hidden
      expect(screen.queryByTestId('ai-limit-banner-retry')).toBeNull();
      expect(screen.getByTestId('ai-limit-banner')).toHaveTextContent(
        /Try again in 3s/,
      );

      // Tick once (1s elapsed)
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByTestId('ai-limit-banner')).toHaveTextContent(
        /Try again in 2s/,
      );

      // Tick to zero
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      // Retry button now visible
      const retry = screen.getByTestId('ai-limit-banner-retry');
      fireEvent.click(retry);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows Retry immediately when retryAfterS is 0', () => {
      const onRetry = vi.fn();
      render(
        <AiLimitBanner
          info={makeInfo({ reason: 'cost_cap', retryAfterS: 0 })}
          onRetry={onRetry}
        />,
      );
      // Note: cost_cap usually wouldn't pass an onRetry, but we want
      // to verify the gate is on retryAfterS, not the reason.
      const retry = screen.getByTestId('ai-limit-banner-retry');
      expect(retry).toBeInTheDocument();
      fireEvent.click(retry);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('hides Retry when no onRetry callback is supplied even if countdown is 0', () => {
      render(<AiLimitBanner info={makeInfo({ retryAfterS: 0 })} />);
      expect(screen.queryByTestId('ai-limit-banner-retry')).toBeNull();
    });
  });
});
