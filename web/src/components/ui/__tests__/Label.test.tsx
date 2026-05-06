/**
 * Phase-46 / Prompt 25 — Label primitive unit tests.
 *
 * Locks in the contract:
 *   1. Renders an HTML <label> with htmlFor wiring.
 *   2. When required, renders a visible aria-hidden "*" AND a
 *      sr-only "required" string so the accessible name of the
 *      paired control reads e.g. "Email required".
 *   3. When not required, renders neither marker.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

import { Label } from '../Label';

describe('Label', () => {
  it('renders an HTML <label> element with htmlFor', () => {
    render(<Label htmlFor="email">Email</Label>);
    const label = screen.getByText('Email').closest('label');
    expect(label).not.toBeNull();
    expect(label?.tagName).toBe('LABEL');
    expect(label?.getAttribute('for')).toBe('email');
  });

  it('does not render the asterisk when required is false/unset', () => {
    const { container } = render(<Label htmlFor="x">Name</Label>);
    expect(container.textContent).toBe('Name');
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('renders an aria-hidden "*" when required', () => {
    render(
      <Label htmlFor="email" required>
        Email
      </Label>,
    );
    const star = screen.getByText('*');
    expect(star).toBeInTheDocument();
    expect(star.getAttribute('aria-hidden')).toBe('true');
    expect(star.tagName).toBe('SPAN');
  });

  it('renders a screen-reader-only "required" via VisuallyHidden when required', () => {
    render(
      <Label htmlFor="email" required>
        Email
      </Label>,
    );
    // VisuallyHidden renders the "required" string inside the label so
    // the accessible name of the paired control reads "Email required".
    // Assert via the label's textContent rather than the visually-hidden
    // CSS class — the audit:sr-only gate forbids spelling the class name
    // outside the VisuallyHidden implementation.
    const label = screen.getByText('Email').closest('label');
    expect(label?.textContent ?? '').toMatch(/required/i);
  });

  it('label textContent contains "Name *" so getByLabelText pattern matchers work', () => {
    render(
      <Label htmlFor="x" required>
        Name
      </Label>,
    );
    const label = screen.getByText('Name').closest('label');
    // Whitespace-tolerant: getByLabelText(/name \*/i) requires "Name *"
    // to appear somewhere in the label's text content.
    expect(label?.textContent ?? '').toMatch(/name \*/i);
  });

  it('passes through arbitrary HTMLLabelElement attributes', () => {
    render(
      <Label htmlFor="x" data-testid="lbl" id="name-label">
        Name
      </Label>,
    );
    const label = screen.getByTestId('lbl');
    expect(label.id).toBe('name-label');
    expect(label.getAttribute('for')).toBe('x');
  });

  it('merges caller className with the base classes via cn()', () => {
    render(
      <Label htmlFor="x" className="text-sm font-bold">
        Name
      </Label>,
    );
    const label = screen.getByText('Name').closest('label');
    expect(label?.className).toMatch(/font-bold/);
    expect(label?.className).toMatch(/text-sm/);
  });
});
