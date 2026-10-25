import { appSettingsPayload } from '@/test/fixtures/appSettings'
// AI-off contract tests.
//
// Unit tests for `withAiFeature`. Verifies:
//
//   - Off mode renders nothing (ADR-015 §I5).
//   - Mode + per-feature on renders the inner component INSIDE a
//     wrapper that carries the data-ai-feature attribute and the
//     registered uiTestIds, so the off-mode invariant Playwright
//     walk has a stable selector.
//   - Unknown feature IDs throw at module-load (the wrapping call),
//     not silently render nothing forever.
//   - The wrapped component's displayName surfaces both the feature
//     and the inner component name for React DevTools.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';


vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { withAiFeature } from './withAiFeature';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

function Inner({ label }: { label: string }) {
  return <span>chat-{label}</span>;
}
Inner.displayName = 'Inner';

beforeEach(() => {
  mockUseSettings.mockReset();
});

describe('withAiFeature — render-gate behaviour', () => {
  it('renders null when settings have ai_mode=off', () => {
    mockUseSettings.mockReturnValue(
      appSettingsPayload({ ai_mode: 'off', ai_features: { 'chatbot-llm': true } }),
    );
    const Wrapped = withAiFeature('chatbot-llm', Inner);
    const { container } = render(<Wrapped label="hi" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('ai-feature-chatbot-llm-root')).not.toBeInTheDocument();
  });

  it('renders null when the per-feature flag is false even with mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      appSettingsPayload({ ai_mode: 'cloud', ai_features: { 'chatbot-llm': false } }),
    );
    const Wrapped = withAiFeature('chatbot-llm', Inner);
    const { container } = render(<Wrapped label="hi" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the inner component inside the marker wrapper when fully enabled', () => {
    mockUseSettings.mockReturnValue(
      appSettingsPayload({ ai_mode: 'local', ai_features: { 'chatbot-llm': true } }),
    );
    const Wrapped = withAiFeature('chatbot-llm', Inner);
    render(<Wrapped label="hi" />);

    const host = screen.getByTestId('ai-feature-chatbot-llm-root');
    expect(host).toBeInTheDocument();
    expect(host).toHaveAttribute('data-ai-feature', 'chatbot-llm');
    expect(host).toHaveTextContent('chat-hi');
  });

  it('throws when wrapping an unknown feature ID at construction time', () => {
    expect(() =>
      // @ts-expect-error — verifying the runtime guard backs up the compile check
      withAiFeature('not-a-real-feature', Inner),
    ).toThrow(/unknown AI feature id/i);
  });

  it('exposes a useful displayName for React DevTools', () => {
    const Wrapped = withAiFeature('chatbot-llm', Inner);
    expect(Wrapped.displayName).toBe('withAiFeature(chatbot-llm, Inner)');
  });
});
