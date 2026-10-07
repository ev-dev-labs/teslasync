/**
 * Stepper contract.
 *
 * Stepper renders the onboarding checklist as an accessible ordered list.
 * It derives each row's state purely from the `done` flags:
 *
 *   - every `done` row is "done" (green check, SR "Completed");
 *   - the FIRST not-done row is "current" (spinner, aria-current="step",
 *     SR "In progress") and is the ONLY row that renders a CTA;
 *   - every later not-done row is "pending" (1-based index, SR "Not started").
 *
 * These tests exercise the public surface — the `Stepper` component plus the
 * `OnboardingStep` / `StepperProps` types — across all three states, both CTA
 * render paths (default <Button> and the `renderCta` render-prop), the
 * all-done and empty branches, and the null-safety guard.
 *
 * react-i18next is stubbed so `t(key, fallback)` returns the fallback, making
 * the asserted copy (status labels, empty message, list label) deterministic
 * without booting the i18n runtime. Interactions go through `fireEvent`
 * (the repo does not depend on @testing-library/user-event).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Link, MemoryRouter } from 'react-router-dom';
import { Button } from '@/components/ui';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { Stepper, type OnboardingStep, type StepperProps } from './Stepper';

function mkStep(
  overrides: Partial<OnboardingStep> & Pick<OnboardingStep, 'key' | 'title'>,
): OnboardingStep {
  return {
    description: `${overrides.title} description`,
    done: false,
    ...overrides,
  };
}

/**
 * Canonical three-step fixture: step 1 done, step 2 the current (first
 * not-done) step, step 3 pending. Each carries a distinctly-labelled CTA so
 * tests can prove only the current step's CTA is rendered.
 */
function threeSteps(currentCta?: { onClick?: () => void; disabled?: boolean }): OnboardingStep[] {
  return [
    mkStep({ key: 'tesla', title: 'Connect account', done: true, cta: { label: 'Connect' } }),
    mkStep({
      key: 'vehicle',
      title: 'Sync vehicles',
      done: false,
      cta: { label: 'Refresh', onClick: currentCta?.onClick, disabled: currentCta?.disabled },
    }),
    mkStep({ key: 'telemetry', title: 'Await telemetry', done: false, cta: { label: 'Guide' } }),
  ];
}

function renderStepper(props: StepperProps) {
  return render(<Stepper {...props} />);
}

describe('Stepper', () => {
  it('renders an accessible ordered list with every step title and description', () => {
    renderStepper({ steps: threeSteps() });

    expect(screen.getByRole('list', { name: 'Onboarding steps' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('heading', { level: 3, name: 'Connect account' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Sync vehicles' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Await telemetry' })).toBeInTheDocument();
    expect(screen.getByText('Sync vehicles description')).toBeInTheDocument();
  });

  it('marks the first not-done row as current and announces per-state SR status', () => {
    const { container } = renderStepper({ steps: threeSteps() });

    // Exactly one current row, and it is the first not-done step (vehicle).
    const current = container.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0].id).toBe('onboarding-step-vehicle');

    // Screen-reader-only status label precedes each row's title.
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Not started')).toBeInTheDocument();
  });

  it('renders a CTA only for the current step', () => {
    renderStepper({ steps: threeSteps() });

    // Current step's CTA is present…
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    // …but the done and pending steps never render theirs.
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Guide' })).toBeNull();
  });

  it('invokes the current step onClick when its default CTA is activated', () => {
    const onClick = vi.fn();
    renderStepper({ steps: threeSteps({ onClick }) });

    const cta = screen.getByRole('button', { name: 'Refresh' });
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.click(cta);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables the default CTA when the step marks it disabled', () => {
    const onClick = vi.fn();
    renderStepper({ steps: threeSteps({ onClick, disabled: true }) });

    const cta = screen.getByRole('button', { name: 'Refresh' });
    expect(cta).toBeDisabled();
    fireEvent.click(cta);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('uses the renderCta render-prop for the current step and suppresses the default button', () => {
    const steps = threeSteps();
    const renderCta = vi.fn((step: OnboardingStep) => <a href="/go">Custom {step.title}</a>);

    renderStepper({ steps, renderCta });

    // Called exactly once, for the current (second) step only.
    expect(renderCta).toHaveBeenCalledTimes(1);
    expect(renderCta).toHaveBeenCalledWith(steps[1]);
    expect(screen.getByRole('link', { name: 'Custom Sync vehicles' })).toBeInTheDocument();
    // The default <Button> path must not run when renderCta is supplied.
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('shows no current row and no CTA once every step is done', () => {
    const steps = [
      mkStep({ key: 'a', title: 'Alpha', done: true, cta: { label: 'A' } }),
      mkStep({ key: 'b', title: 'Beta', done: true, cta: { label: 'B' } }),
    ];
    const { container } = renderStepper({ steps });

    expect(container.querySelector('[aria-current="step"]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByText('Completed')).toHaveLength(2);
  });

  it('renders an empty state instead of a list when there are no steps', () => {
    renderStepper({ steps: [] });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No setup steps to show right now.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('tolerates undefined steps without throwing (null-safety)', () => {
    expect(() =>
      renderStepper({ steps: undefined as unknown as OnboardingStep[] }),
    ).not.toThrow();
    expect(screen.getByText('No setup steps to show right now.')).toBeInTheDocument();
  });

  it('numbers only the pending rows and gives every row a stable id', () => {
    const { container } = renderStepper({ steps: threeSteps() });

    // done -> check glyph, current -> spinner, pending (3rd) -> its 1-based index.
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('1')).toBeNull();
    expect(screen.queryByText('2')).toBeNull();
    expect(container.querySelector('#onboarding-step-tesla')?.tagName).toBe('LI');
    expect(container.querySelector('#onboarding-step-telemetry')).not.toBeNull();
  });

  it('preserves completed rows after a missing anchor and moves only the first unfinished action', () => {
    const laterDone = mkStep({ key: 'later', title: 'Already configured', done: true });
    const first = mkStep({ key: 'first', title: 'First anchor', cta: { label: 'First action' } });
    const second = mkStep({ key: 'second', title: 'Second anchor', cta: { label: 'Second action' } });
    const { container, rerender } = renderStepper({ steps: [first, laterDone, second] });

    expect(container.querySelector('[aria-current="step"]')).toHaveAttribute('id', 'onboarding-step-first');
    expect(container.querySelector('#onboarding-step-later')).toHaveTextContent('Completed');
    expect(screen.getByRole('button', { name: 'First action' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Second action' })).toBeNull();

    rerender(<Stepper steps={[{ ...first, done: true }, laterDone, second]} />);
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(container.querySelector('[aria-current="step"]')).toHaveAttribute('id', 'onboarding-step-second');
    expect(screen.getAllByText('Completed')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'First action' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Second action' })).toBeInTheDocument();
  });

  it('keeps LI ids and distinct check, spinner and pending markers in a contained layout', () => {
    const { container } = renderStepper({ steps: threeSteps() });
    const list = screen.getByRole('list', { name: 'Onboarding steps' });
    expect(list).toHaveClass('min-w-0', 'max-w-full');
    const done = container.querySelector('#onboarding-step-tesla');
    const current = container.querySelector('#onboarding-step-vehicle');
    const pending = container.querySelector('#onboarding-step-telemetry');
    for (const row of [done, current, pending]) {
      expect(row?.tagName).toBe('LI');
      expect(row).toHaveClass('min-w-0', 'max-w-full');
    }
    expect(done?.querySelector('.lucide-check')).not.toBeNull();
    expect(done?.querySelector('.animate-spin')).toBeNull();
    expect(current?.querySelector('.animate-spin')).toHaveClass('motion-reduce:animate-none');
    expect(pending).toHaveTextContent('3');
    expect(pending?.querySelector('.animate-spin')).toBeNull();
    expect(pending?.querySelector('.lucide-check')).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveClass('whitespace-normal', 'max-w-full');
  });

  it('preserves caller-owned internal, external and custom actions only for the current row', () => {
    const customClick = vi.fn();
    const steps = [
      mkStep({ key: 'internal', title: 'Internal', cta: { label: 'Open settings', to: '/settings#workspace' } }),
      mkStep({ key: 'external', title: 'External', cta: { label: 'Read guide', href: '/docs/fleet-telemetry-setup' } }),
      mkStep({ key: 'custom', title: 'Custom', cta: { label: 'Recover', onClick: customClick } }),
    ];
    const renderCta = vi.fn((step: OnboardingStep) => {
      const action = step.cta;
      if (!action) return null;
      if (action.to) return <Link to={action.to}>{action.label}</Link>;
      if (action.href) return <a href={action.href} target="_blank" rel="noreferrer noopener">{action.label}</a>;
      return <Button onClick={action.onClick}>{action.label}</Button>;
    });
    const { rerender } = render(
      <MemoryRouter><Stepper steps={steps} renderCta={renderCta} /></MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Open settings' })).toHaveAttribute('href', '/settings#workspace');
    expect(screen.queryByRole('link', { name: 'Read guide' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recover' })).toBeNull();
    expect(renderCta).toHaveBeenCalledTimes(1);
    expect(renderCta).toHaveBeenLastCalledWith(steps[0]);

    rerender(<MemoryRouter><Stepper steps={steps.map((step, index) => ({ ...step, done: index === 0 }))} renderCta={renderCta} /></MemoryRouter>);
    const guide = screen.getByRole('link', { name: 'Read guide' });
    expect(guide).toHaveAttribute('href', '/docs/fleet-telemetry-setup');
    expect(guide).toHaveAttribute('target', '_blank');
    expect(guide).toHaveAttribute('rel', 'noreferrer noopener');
    expect(screen.queryByRole('link', { name: 'Open settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recover' })).toBeNull();

    rerender(<MemoryRouter><Stepper steps={steps.map((step, index) => ({ ...step, done: index < 2 }))} renderCta={renderCta} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Recover' }));
    expect(customClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link')).toBeNull();
    renderCta.mockClear();

    rerender(<MemoryRouter><Stepper steps={steps.map(step => ({ ...step, done: true }))} renderCta={renderCta} /></MemoryRouter>);
    expect(renderCta).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('does not invoke the action renderer when the current row has no action', () => {
    const renderCta = vi.fn(() => <Button>Unexpected action</Button>);
    renderStepper({
      steps: [
        mkStep({ key: 'wait', title: 'Wait for evidence' }),
        mkStep({ key: 'later', title: 'Later', cta: { label: 'Later action' } }),
      ],
      renderCta,
    });
    expect(renderCta).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
