/**
 * Input required-indicator integration tests. Locks down the visible marker,
 * screen-reader text, native required attribute, and accessible name.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

import { Input } from '../Input';

describe('Input — required indicator', () => {
  it('renders a paired <label> when label= is provided', () => {
    render(<Input label="Email" />);
    const input = screen.getByRole('textbox');
    expect(input.id).toBe('email');
    const label = document.querySelector('label[for="email"]');
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe('Email');
  });

  it('forwards required to the underlying <input> element', () => {
    render(<Input label="Email" required />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.required).toBe(true);
  });

  it('sets aria-required="true" on the underlying <input> when required', () => {
    render(<Input label="Email" required />);
    const input = screen.getByRole('textbox');
    expect(input.getAttribute('aria-required')).toBe('true');
  });

  it('does NOT set aria-required when required is unset', () => {
    render(<Input label="Email" />);
    const input = screen.getByRole('textbox');
    expect(input.getAttribute('aria-required')).toBeNull();
  });

  it('renders the visible "*" inside the auto-paired Label when required', () => {
    render(<Input label="Email" required />);
    const star = screen.getByText('*');
    expect(star.getAttribute('aria-hidden')).toBe('true');
    // The asterisk must live inside the Label so it visually pairs.
    const label = document.querySelector('label[for="email"]');
    expect(label?.contains(star)).toBe(true);
  });

  it('renders the screen-reader-only "required" string inside the label', () => {
    render(<Input label="Email" required />);
    // Asserted via label textContent rather than the visually-hidden CSS
    // class — the audit:sr-only gate forbids spelling the class name
    // outside the VisuallyHidden implementation.
    const label = document.querySelector('label[for="email"]');
    expect(label?.textContent ?? '').toMatch(/required/i);
  });

  it('getByLabelText(/email \\*/i) resolves to the input', () => {
    render(<Input label="Email" required />);
    const input = screen.getByLabelText(/email \*/i);
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('aria-required')).toBe('true');
  });

  it('getByRole textbox name matches /email/i (visible label is part of accname; asterisk is not)', () => {
    render(<Input label="Email" required />);
    // /email/i is a substring match — this proves the accessible name
    // includes the visible label text. NVDA will read "Email, required".
    const input = screen.getByRole('textbox', { name: /email/i });
    expect(input.getAttribute('aria-required')).toBe('true');
  });

  it('does NOT render the asterisk or visually-hidden "required" when required is unset', () => {
    render(<Input label="Email" />);
    expect(screen.queryByText('*')).toBeNull();
    const label = document.querySelector('label[for="email"]');
    expect(label?.textContent ?? '').toBe('Email');
  });

  it('preserves the existing label styling via className passthrough', () => {
    render(<Input label="Email" required />);
    const label = document.querySelector('label[for="email"]');
    expect(label?.className).toMatch(/text-sm/);
    expect(label?.className).toMatch(/font-medium/);
  });
});

describe('Input — readable disabled state', () => {
  it('uses semantic surface and text tokens without fading the whole control', () => {
    render(<Input aria-label="Disabled input" disabled />);
    const input = screen.getByRole('textbox', { name: 'Disabled input' });
    expect(input).toBeDisabled();
    expect(input.className).toContain('disabled:bg-[var(--surface-2)]');
    expect(input.className).toContain('disabled:text-[var(--text-secondary)]');
    expect(input.className).toContain('disabled:opacity-100');
    expect(input.className).not.toContain('disabled:opacity-50');
  });
});

describe('Input — feedback association', () => {
  it('generates a stable id for an unlabelled error field', () => {
    render(<Input aria-label="Threshold" error="Enter a value" />);
    const input = screen.getByRole('textbox', { name: 'Threshold' });
    expect(input.id).toMatch(/^input-/);
    expect(input).toHaveAttribute('aria-describedby', `${input.id}-error`);
    expect(document.getElementById(`${input.id}-error`)).toHaveTextContent(
      'Enter a value',
    );
  });

  it('preserves caller descriptions while adding field feedback', () => {
    render(
      <>
        <span id="external-help">External help</span>
        <Input
          label="Threshold"
          aria-describedby="external-help"
          hint="Use a whole number"
        />
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'Threshold' })).toHaveAttribute(
      'aria-describedby',
      'external-help threshold-hint',
    );
  });

  it('announces validation errors through an alert role', () => {
    render(<Input label="Threshold" error="Out of range" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Out of range');
  });
});
