/**
 * ValidationSummary contract (A11Y-04).
 *
 * Asserts the live-region role, the focus-on-new-errors rule (and its
 * corollary: no re-focus for an unchanged error set), and the
 * message → field focus link.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { ValidationSummary, type ValidationError } from '@/components/forms/ValidationSummary';

const TWO_ERRORS: ValidationError[] = [
  { fieldId: 'vin', message: 'VIN is required', label: 'VIN' },
  { fieldId: 'name', message: 'Name is too long' },
];

describe('ValidationSummary', () => {
  it('renders nothing when there are no errors', () => {
    const { container } = render(<ValidationSummary errors={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an assertive live region listing every error', () => {
    render(<ValidationSummary errors={TWO_ERRORS} />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText('VIN: VIN is required')).toBeInTheDocument();
    expect(screen.getByText('Name is too long')).toBeInTheDocument();
  });

  it('takes focus when errors first appear', () => {
    render(<ValidationSummary errors={TWO_ERRORS} />);
    expect(document.activeElement).toBe(screen.getByRole('alert'));
  });

  it('does not re-steal focus when the same errors re-render', () => {
    const { rerender } = render(<ValidationSummary errors={TWO_ERRORS} />);
    const other = document.createElement('button');
    document.body.appendChild(other);
    other.focus();

    rerender(<ValidationSummary errors={[...TWO_ERRORS]} />);

    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it('re-focuses when the error set actually changes', () => {
    const { rerender } = render(<ValidationSummary errors={TWO_ERRORS} />);
    const other = document.createElement('button');
    document.body.appendChild(other);
    other.focus();

    rerender(
      <ValidationSummary
        errors={[{ fieldId: 'vin', message: 'VIN must be 17 characters' }]}
      />,
    );

    expect(document.activeElement).toBe(screen.getByRole('alert'));
    other.remove();
  });

  it('respects focusOnError={false}', () => {
    const other = document.createElement('button');
    document.body.appendChild(other);
    other.focus();

    render(<ValidationSummary errors={TWO_ERRORS} focusOnError={false} />);

    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it('moves focus to the offending field when a message is activated', () => {
    function Form() {
      const [errors] = useState<ValidationError[]>(TWO_ERRORS);
      return (
        <form>
          <ValidationSummary errors={errors} />
          <input id="vin" aria-label="VIN" />
          <input id="name" aria-label="Name" />
        </form>
      );
    }
    render(<Form />);

    fireEvent.click(screen.getByRole('button', { name: 'VIN: VIN is required' }));

    expect(document.activeElement).toBe(screen.getByLabelText('VIN'));
  });

  it('renders form-level errors as plain text, not links', () => {
    render(<ValidationSummary errors={[{ message: 'Server rejected the form' }]} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Server rejected the form')).toBeInTheDocument();
  });

  it('uses the translated count-aware title as its accessible name', () => {
    const { rerender } = render(<ValidationSummary errors={TWO_ERRORS} />);
    expect(screen.getByRole('alert')).toHaveAccessibleName('Fix 2 problems before continuing');
    rerender(<ValidationSummary errors={[{ message: 'Required' }]} />);
    expect(screen.getByRole('alert')).toHaveAccessibleName('Fix 1 problem before continuing');
    rerender(<ValidationSummary errors={TWO_ERRORS} title="Check vehicle details" />);
    expect(screen.getByRole('alert')).toHaveAccessibleName('Check vehicle details');
  });

  it('keeps multiple summary heading identities distinct and caller classes', () => {
    render(
      <>
        <ValidationSummary errors={TWO_ERRORS} title="Vehicle" className="custom-summary" />
        <ValidationSummary errors={TWO_ERRORS} title="Account" focusOnError={false} />
      </>,
    );
    const vehicle = screen.getByRole('alert', { name: 'Vehicle' });
    const account = screen.getByRole('alert', { name: 'Account' });
    expect(vehicle.getAttribute('aria-labelledby')).not.toBe(account.getAttribute('aria-labelledby'));
    expect(vehicle).toHaveClass('custom-summary', 'bg-[var(--semantic-danger-bg)]');
    expect(vehicle).toHaveClass('focus:outline-2', 'forced-colors:focus:outline-[Highlight]');
  });

  it('retains every long RTL label and form-level error without truncation', () => {
    const message = 'خطأ في بيانات السيارة '.repeat(80);
    render(
      <div dir="rtl">
        <ValidationSummary errors={[{ fieldId: 'missing', label: 'السيارة', message }, { message: 'Form failure' }]} />
      </div>,
    );
    const action = screen.getByRole('button');
    expect(action.textContent).toBe(`السيارة: ${message}`);
    expect(action).toHaveAttribute('type', 'button');
    expect(action).toHaveClass('text-start', 'whitespace-normal', 'min-h-11');
    expect(action.querySelector('span')).toHaveClass('break-words');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Form failure')).toBeInTheDocument();
    expect(() => fireEvent.click(action)).not.toThrow();
    expect(document.activeElement).toBe(screen.getByRole('alert'));
  });

  it('focuses and scrolls the field without submitting the form or animated scrolling', () => {
    const onSubmit = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <ValidationSummary errors={TWO_ERRORS} />
        <input id="vin" aria-label="VIN" />
      </form>,
    );
    const field = screen.getByLabelText('VIN');
    const scroll = vi.fn();
    field.scrollIntoView = scroll;
    const action = screen.getByRole('button', { name: 'VIN: VIN is required' });
    action.focus();
    expect(action).toHaveFocus();
    fireEvent.click(action);
    expect(field).toHaveFocus();
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('clears the summary and focuses a returning error set', () => {
    const { rerender } = render(<ValidationSummary errors={TWO_ERRORS} />);
    rerender(<ValidationSummary />);
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<ValidationSummary errors={TWO_ERRORS} />);
    expect(screen.getByRole('alert')).toHaveFocus();
  });
});
