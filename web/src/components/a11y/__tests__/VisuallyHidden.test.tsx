/**
 * VisuallyHidden contract tests.
 *
 * `AnnouncerRegion` — which is built on top of VisuallyHidden — has its own
 * dedicated suite in `./AnnouncerRegion.test.tsx` (one concern per file).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VisuallyHidden } from '../VisuallyHidden';

describe('VisuallyHidden', () => {
  it('renders a span with the sr-only class by default', () => {
    render(<VisuallyHidden>hello</VisuallyHidden>);
    const node = screen.getByText(/hello/);
    expect(node.tagName).toBe('SPAN');
    expect(node.className).toContain('sr-only');
  });

  it('forwards arbitrary span attributes', () => {
    render(
      <VisuallyHidden id="hidden-1" data-testid="vh">
        forwarded
      </VisuallyHidden>,
    );
    const node = screen.getByTestId('vh');
    expect(node).toHaveAttribute('id', 'hidden-1');
  });

  it('renders the polymorphic `as` element', () => {
    render(
      <VisuallyHidden as="label" htmlFor="x">
        label-text
      </VisuallyHidden>,
    );
    const node = screen.getByText('label-text');
    expect(node.tagName).toBe('LABEL');
    expect(node).toHaveAttribute('for', 'x');
  });

  it('does NOT add aria-live attributes by default', () => {
    render(
      <VisuallyHidden data-testid="vh">no live region</VisuallyHidden>,
    );
    const node = screen.getByTestId('vh');
    expect(node).not.toHaveAttribute('aria-live');
    expect(node).not.toHaveAttribute('aria-atomic');
    expect(node).not.toHaveAttribute('role');
  });

  it('liveRegion=true wires role/aria-live/aria-atomic for polite priority', () => {
    render(
      <VisuallyHidden liveRegion>polite message</VisuallyHidden>,
    );
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region).toHaveTextContent('polite message');
  });

  it('liveRegion + priority="assertive" uses role="alert" and aria-live="assertive"', () => {
    render(
      <VisuallyHidden liveRegion priority="assertive">
        assertive message
      </VisuallyHidden>,
    );
    const region = screen.getByRole('alert');
    expect(region).toHaveAttribute('aria-live', 'assertive');
    expect(region).toHaveAttribute('aria-atomic', 'true');
  });

  it('focusable=true adds focus:not-sr-only utility', () => {
    render(
      <VisuallyHidden as="a" focusable href="#main" data-testid="skip">
        skip
      </VisuallyHidden>,
    );
    const node = screen.getByTestId('skip');
    expect(node.className).toContain('focus:not-sr-only');
    expect(node.className).toContain('sr-only');
    expect(node).toHaveAttribute('href', '#main');
  });

  it('focusable=false does NOT add focus:not-sr-only', () => {
    render(
      <VisuallyHidden data-testid="vh">plain</VisuallyHidden>,
    );
    const node = screen.getByTestId('vh');
    expect(node.className).not.toContain('not-sr-only');
  });

  it('user className composes with sr-only without dropping it', () => {
    render(
      <VisuallyHidden className="custom-class" data-testid="vh">
        composed
      </VisuallyHidden>,
    );
    const node = screen.getByTestId('vh');
    expect(node.className).toContain('sr-only');
    expect(node.className).toContain('custom-class');
  });
});
