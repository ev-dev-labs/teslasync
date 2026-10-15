/**
 * Label primitive unit tests.
 *
 * Locks in the contract:
 *   1. Renders an HTML <label> with htmlFor wiring.
 *   2. When required, renders a visible aria-hidden "*" AND a
 *      sr-only "required" string so the accessible name of the
 *      paired control reads e.g. "Email required".
 *   3. When not required, renders neither marker.
 */

import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

const requiredTranslation = vi.hoisted(() => ({ value: 'required' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      key === 'form.required' ? requiredTranslation.value : fallback ?? key,
  }),
}));

import { Label } from '../Label';

describe('Label', () => {
  afterEach(() => {
    requiredTranslation.value = 'required';
  });

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

  it('uses theme-aware restrained label and required status roles', () => {
    render(<Label required>Name</Label>);
    const label = screen.getByText('Name').closest('label');
    expect(label).toHaveClass('text-xs', 'font-medium', 'text-[var(--text-muted)]', 'break-words');
    expect(screen.getByText('*')).toHaveClass('text-[var(--semantic-danger)]');
    expect(label?.className).not.toMatch(/text-white|text-neon|animate-|shadow-/);
  });

  it('forwards object and callback refs to the native label', () => {
    const ref = createRef<HTMLLabelElement>();
    const callback = vi.fn();
    const { rerender, unmount } = render(<Label ref={ref}>Name</Label>);
    expect(ref.current).toBe(screen.getByText('Name'));
    rerender(<Label ref={callback}>Name</Label>);
    expect(callback).toHaveBeenLastCalledWith(screen.getByText('Name'));
    expect(ref.current).toBeNull();
    unmount();
    expect(callback).toHaveBeenLastCalledWith(null);
  });

  it('preserves a localized required accessible name and external helper association', () => {
    requiredTranslation.value = 'obligatoire';
    render(
      <>
        <Label htmlFor="email" required>Email</Label>
        <input id="email" aria-describedby="email-helper" required />
        <span id="email-helper">Contact address</span>
      </>,
    );
    expect(screen.getByRole('textbox')).toHaveAccessibleName('Email obligatoire');
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription('Contact address');
    expect(screen.getByRole('textbox')).toBeRequired();
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps explicit identity and helper children when long translated labels rerender', () => {
    const text = 'A long localized field label '.repeat(20);
    const { rerender } = render(
      <Label id="fixed-label" htmlFor="fixed-control" required>
        <span>{text}</span><span>Helper context</span>
      </Label>,
    );
    const label = screen.getByText(text.trim()).closest('label');
    requiredTranslation.value = 'obligatoire';
    rerender(
      <Label id="fixed-label" htmlFor="fixed-control" required>
        <span>Nom traduit</span><span>Helper context</span>
      </Label>,
    );
    expect(screen.getByText('Nom traduit').closest('label')).toBe(label);
    expect(label).toHaveAttribute('id', 'fixed-label');
    expect(label).toHaveAttribute('for', 'fixed-control');
    expect(label).toHaveTextContent('Helper context');
    expect(label).toHaveTextContent('obligatoire');
  });

  it('retains native label activation and caller event handlers', () => {
    const onClick = vi.fn();
    render(
      <>
        <Label htmlFor="enabled" onClick={onClick}>Enabled</Label>
        <input id="enabled" type="checkbox" />
      </>,
    );
    fireEvent.click(screen.getByText('Enabled'));
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('removes both required indicators when required becomes false and accepts missing children', () => {
    const { container, rerender } = render(<Label required>Name</Label>);
    rerender(<Label required={false}>Name</Label>);
    expect(container.textContent).toBe('Name');
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    rerender(<Label htmlFor="empty" />);
    expect(container.querySelector('label')).toHaveAttribute('for', 'empty');
    expect(container.textContent).toBe('');
  });
});
