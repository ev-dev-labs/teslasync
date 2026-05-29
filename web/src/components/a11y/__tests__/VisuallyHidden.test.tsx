/**
 * VisuallyHidden + AnnouncerRegion contract tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { VisuallyHidden } from '../VisuallyHidden';
import { AnnouncerRegion } from '../AnnouncerRegion';
import {
  announce,
  __resetAnnouncerForTests,
  __getAnnouncerListenerCountForTests,
} from '@/hooks/useAnnouncer';

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

describe('AnnouncerRegion', () => {
  beforeEach(() => {
    __resetAnnouncerForTests();
  });

  it('renders both polite and assertive live regions on mount', () => {
    render(<AnnouncerRegion />);
    const polite = screen.getByTestId('announcer-polite');
    const assertive = screen.getByTestId('announcer-assertive');
    expect(polite).toHaveAttribute('aria-live', 'polite');
    expect(polite).toHaveAttribute('role', 'status');
    expect(assertive).toHaveAttribute('aria-live', 'assertive');
    expect(assertive).toHaveAttribute('role', 'alert');
  });

  it('subscribes one listener while mounted and unsubscribes on unmount', () => {
    expect(__getAnnouncerListenerCountForTests()).toBe(0);
    const { unmount } = render(<AnnouncerRegion />);
    expect(__getAnnouncerListenerCountForTests()).toBe(1);
    unmount();
    expect(__getAnnouncerListenerCountForTests()).toBe(0);
  });

  it('routes polite announcements to the polite region', () => {
    render(<AnnouncerRegion />);
    act(() => {
      announce('Filter removed', 'polite');
    });
    const polite = screen.getByTestId('announcer-polite');
    expect(polite.textContent ?? '').toContain('Filter removed');
    const assertive = screen.getByTestId('announcer-assertive');
    expect(assertive.textContent ?? '').toBe('');
  });

  it('routes assertive announcements to the assertive region', () => {
    render(<AnnouncerRegion />);
    act(() => {
      announce('Session expired', 'assertive');
    });
    const assertive = screen.getByTestId('announcer-assertive');
    expect(assertive.textContent ?? '').toContain('Session expired');
    const polite = screen.getByTestId('announcer-polite');
    expect(polite.textContent ?? '').toBe('');
  });

  it('keeps polite as the default priority', () => {
    render(<AnnouncerRegion />);
    act(() => {
      announce('default priority');
    });
    expect(screen.getByTestId('announcer-polite').textContent ?? '').toContain(
      'default priority',
    );
  });
});
