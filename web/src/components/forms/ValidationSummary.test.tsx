/**
 * ValidationSummary contract (A11Y-04).
 *
 * Asserts the live-region role, the focus-on-new-errors rule (and its
 * corollary: no re-focus for an unchanged error set), and the
 * message → field focus link.
 */

import { describe, it, expect } from 'vitest';
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
});
