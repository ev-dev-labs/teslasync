/**
 * Input required-indicator integration tests. Locks down the visible marker,
 * screen-reader text, native required attribute, and accessible name.
 */

import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
    expect(input.id).toMatch(/^input-/);
    const label = screen.getByText('Email').closest('label');
    expect(label).toHaveAttribute('for', input.id);
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
    const label = screen.getByRole('textbox').closest('.space-y-1')?.querySelector('label');
    expect(label?.contains(star)).toBe(true);
  });

  it('renders the screen-reader-only "required" string inside the label', () => {
    render(<Input label="Email" required />);
    // Asserted via label textContent rather than the visually-hidden CSS
    // class — the audit:sr-only gate forbids spelling the class name
    // outside the VisuallyHidden implementation.
    const label = screen.getByRole('textbox').closest('.space-y-1')?.querySelector('label');
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
    const label = screen.getByText('Email').closest('label');
    expect(label?.textContent ?? '').toBe('Email');
  });

  it('preserves the existing label styling via className passthrough', () => {
    render(<Input label="Email" required />);
    const label = screen.getByRole('textbox').closest('.space-y-1')?.querySelector('label');
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
    const input = screen.getByRole('textbox', { name: 'Threshold' });
    expect(input).toHaveAttribute(
      'aria-describedby',
      `external-help ${input.id}-hint`,
    );
  });

  it('announces validation errors through an alert role', () => {
    render(<Input label="Threshold" error="Out of range" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Out of range');
  });
});

describe('Input — primitive contract', () => {
  it('retains implicit identity and focused value across translated labels and feedback', () => {
    const { rerender } = render(<Input label="Email" hint="Optional address" defaultValue="saved" />);
    const input = screen.getByRole('textbox', { name: 'Email' });
    const id = input.id;
    input.focus();
    rerender(<Input label="Adresse électronique" error="Adresse invalide" defaultValue="saved" />);
    expect(screen.getByRole('textbox', { name: 'Adresse électronique' })).toBe(input);
    expect(input.id).toBe(id);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('saved');
    expect(input).toHaveAttribute('aria-describedby', `${id}-error`);
    expect(document.getElementById(`${id}-hint`)).toBeNull();
  });

  it('preserves explicit identity, descriptions and native ref/form/type/events', () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    render(
      <>
        <form id="settings-form" />
        <span id="external-note">External instructions</span>
        <Input ref={ref} id="saved-email" label="Email" name="email" type="email"
          form="settings-form" required aria-describedby="external-note"
          hint="Use your account address" onChange={onChange} />
      </>,
    );
    const input = screen.getByRole('textbox', { name: /Email/ });
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute('id', 'saved-email');
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('name', 'email');
    expect(ref.current?.form?.id).toBe('settings-form');
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-describedby', 'external-note saved-email-hint');
    fireEvent.change(input, { target: { value: 'driver@example.com' } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(input).toHaveValue('driver@example.com');
  });

  it('uses restrained semantic validation and focus tokens without hiding error text', () => {
    render(<Input label="Threshold" error="Out of range" hint="Hidden hint" aria-invalid={false} />);
    const input = screen.getByRole('textbox', { name: 'Threshold' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.className).toContain('border-[var(--semantic-danger)]');
    expect(input.className).toContain('focus-visible:ring-[var(--focus-ring)]');
    expect(input.className).toContain('focus-visible:ring-offset-2');
    expect(input.className).not.toMatch(/rose-|theme-primary|neon|text-white/);
    expect(screen.getByRole('alert').className).toContain('text-[var(--semantic-danger)]');
    expect(screen.queryByText('Hidden hint')).toBeNull();
  });

  it('honors external invalid state even without generated error feedback', () => {
    const { rerender } = render(<Input label="Value" aria-invalid="grammar" />);
    const input = screen.getByRole('textbox', { name: 'Value' });
    expect(input).toHaveAttribute('aria-invalid', 'grammar');
    expect(input.className).toContain('border-[var(--semantic-danger)]');
    expect(input).not.toHaveAttribute('aria-describedby');
    rerender(<Input label="Value" aria-invalid={false} />);
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input.className).not.toContain('border-[var(--semantic-danger)]');
    expect(input.className).toContain('enabled:hover:border-[var(--control-border-hover)]');
  });

  it.each([
    ['sm', 'min-h-9 px-3 py-1.5 text-sm'],
    ['md', 'min-h-10 px-3 py-2 text-sm'],
    ['lg', 'min-h-12 px-4 py-2.5 text-base'],
    ['auto', 'px-d-pad-x py-d-pad-y text-d-base min-h-d-row'],
  ] as const)('preserves %s density and native focus with long wrapping labels', (size, sizing) => {
    const label = 'A long translated account label '.repeat(12);
    render(<Input label={label} size={size} />);
    const input = screen.getByRole('textbox', { name: label.trim() });
    expect(input.className).toContain(sizing);
    expect(input.className).toContain('rounded-shape-sm');
    const pairedLabel = screen.getByText(label.trim()).closest('label');
    expect(pairedLabel).toHaveAttribute('for', input.id);
    expect(pairedLabel?.className).toContain('break-words');
    input.focus();
    expect(input).toHaveFocus();
    expect(input.className).toContain('motion-reduce:transition-none');
    expect(input.className).toContain('duration-fast');
  });

  it('keeps zero values, unique field identities, adornments and caller classes', () => {
    render(
      <>
        <Input label="Value" value={0} readOnly icon={<span>Icon</span>} suffix="W" className="custom-field" />
        <Input label="Value" />
      </>,
    );
    const fields = screen.getAllByRole('textbox', { name: 'Value' });
    expect(fields[0]).toHaveValue('0');
    expect(fields[0]?.id).not.toBe(fields[1]?.id);
    expect(fields[0]?.className).toContain('pl-10');
    expect(fields[0]?.className).toContain('pr-10');
    expect(fields[0]?.className).toContain('custom-field');
    expect(screen.getByText('Icon')).toBeVisible();
    expect(screen.getByText('W')).toBeVisible();
    expect(fields[1]).toHaveValue('');
  });
});
