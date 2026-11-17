import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { matchesAppDesignCss } from '@/components/feedback/appDesignCss.test-utils';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { RootCauseInterpretationPanel } from './RootCauseInterpretationPanel';

const props = {
  summary: 'Incomplete temporal association is not a diagnosis.',
  limitations: ['Unknown histories are not evidence of an absent shift.', 'Temporal proximity alone does not establish an upstream signal.'],
  quality: {
    band: 'weak' as const, overallScore: 0, focalSampleCount: 0,
    candidatesWithEvidence: 0, candidatesConsidered: 2, windowMs: 3_600_000,
  },
  hasChosenSignal: true, isLoading: false, isError: false,
};

describe('interpretation limitations native insight', () => {
  it.each(PACK_IDS)('%s consumes the actual limitations box and full copy without adding an announcement or diagnosis', pack => {
    const { container } = render(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
      <RootCauseInterpretationPanel {...props} />
    </div>);
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      const insight = container.querySelector('[data-app-feedback-kind="insight"]')!;
      expect(insight).not.toBeNull();
      expect(matchesAppDesignCss(insight, `[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`)
        .some(match => match.declarations.padding != null && match.declarations.border != null)).toBe(true);
      expect(insight.querySelector('[data-app-part~="feedback-title"]')).toHaveTextContent('Limitations');
      const message = insight.querySelector('[data-app-part~="feedback-message"]')!;
      expect(matchesAppDesignCss(message, '[data-app-part~="feedback-message"]')
        .some(match => match.declarations['white-space'] === 'normal')).toBe(true);
      expect([...message.querySelectorAll('li')].map(node => node.textContent)).toEqual(props.limitations);
      expect(insight).not.toHaveAttribute('role');
      expect(insight).not.toHaveAttribute('aria-live');
      expect(insight).not.toHaveAttribute('data-app-tone', 'success');
      expect(screen.getByText(props.summary)).toBeInTheDocument();
      expect(screen.getByText('Overall evidence score 0.00 of 1.00')).toBeInTheDocument();
    } finally { release(); }
  });

  it('does not invent limitations or hide the panel when no focal signal is selected', () => {
    const view = render(<RootCauseInterpretationPanel {...props} hasChosenSignal={false} />);
    expect(screen.getByRole('heading', { name: 'Interpretation & limits' })).toBeInTheDocument();
    expect(screen.getByText('Choose a signal above to see how its evidence should be read.')).toBeInTheDocument();
    expect(screen.queryByText('Limitations')).toBeNull();
    view.rerender(<RootCauseInterpretationPanel {...props} limitations={[]} />);
    expect(screen.getByText(props.summary)).toBeInTheDocument();
    expect(screen.queryByText('Limitations')).toBeNull();
  });
});
