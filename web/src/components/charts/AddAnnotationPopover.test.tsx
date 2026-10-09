/**
 * Unit + behaviour coverage for <AddAnnotationPopover> and its two exported
 * date helpers.
 *
 * The component is pure UI over an `onAdd` / `onCancel` callback pair — there is
 * no network or query layer to mock (it only pulls `useTranslation`). We import
 * '@/i18n' so `t(key, default)` resolves the real English strings and the
 * assertions read like the rendered UI.
 *
 * Existing cases use `fireEvent`; the Escape regression uses awaited
 * `userEvent` interactions so the key bubbles from the real focused control.
 */
import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  AddAnnotationPopover,
  toDateInputValue,
  toIsoTimestamp,
} from './AddAnnotationPopover';

// A fixed, unambiguous timestamp used across the component tests.
const TS = '2025-06-01T10:30:00Z';

interface Spies {
  onAdd: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
}

function renderPopover(
  overrides: Partial<React.ComponentProps<typeof AddAnnotationPopover>> = {},
): Spies {
  const onAdd = vi.fn();
  const onCancel = vi.fn();
  render(
    <AddAnnotationPopover
      open
      timestamp={TS}
      onAdd={onAdd}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onAdd, onCancel };
}

// The <Modal> portals into document.body, so reach the <form> from a field.
function getForm(): HTMLFormElement {
  const form = screen.getByLabelText('Label').closest('form');
  if (!form) throw new Error('AddAnnotationPopover: <form> not found');
  return form;
}

function labelInput(): HTMLInputElement {
  return screen.getByLabelText('Label') as HTMLInputElement;
}

function descriptionInput(): HTMLInputElement {
  return screen.getByLabelText('Description') as HTMLInputElement;
}

// The date field is `required`, so its accessible name is "Date required".
function dateInput(): HTMLInputElement {
  return screen.getByLabelText(/date/i) as HTMLInputElement;
}

function catButton(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

function typeInto(el: HTMLInputElement, value: string) {
  fireEvent.change(el, { target: { value } });
}

beforeEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────
// toDateInputValue — normalise any ISO-ish string to YYYY-MM-DD
// ─────────────────────────────────────────────────────────────
describe('toDateInputValue', () => {
  it('returns an empty string for empty input', () => {
    expect(toDateInputValue('')).toBe('');
  });

  it('normalises a full ISO timestamp to a UTC YYYY-MM-DD value', () => {
    // 23:30Z stays on the same UTC calendar day — no local-tz drift.
    expect(toDateInputValue('2025-03-15T23:30:00Z')).toBe('2025-03-15');
  });

  it('zero-pads single-digit months and days', () => {
    expect(toDateInputValue('2025-01-05T00:00:00Z')).toBe('2025-01-05');
  });

  it('accepts a bare YYYY-MM-DD value verbatim', () => {
    expect(toDateInputValue('2025-03-15')).toBe('2025-03-15');
  });

  it('returns an empty string for unparseable garbage', () => {
    expect(toDateInputValue('not-a-date')).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────
// toIsoTimestamp — inverse: pin YYYY-MM-DD to UTC midnight
// ─────────────────────────────────────────────────────────────
describe('toIsoTimestamp', () => {
  it('returns an empty string for empty input', () => {
    expect(toIsoTimestamp('')).toBe('');
  });

  it('rejects strings that are not strictly YYYY-MM-DD', () => {
    expect(toIsoTimestamp('2025-3-5')).toBe('');
    expect(toIsoTimestamp('03/15/2025')).toBe('');
    expect(toIsoTimestamp('2025-03-15T10:00:00Z')).toBe('');
  });

  it('pins a valid date to UTC midnight', () => {
    expect(toIsoTimestamp('2025-03-15')).toBe('2025-03-15T00:00:00Z');
  });

  it('round-trips with toDateInputValue', () => {
    expect(toDateInputValue(toIsoTimestamp('2025-04-20'))).toBe('2025-04-20');
  });
});

// ─────────────────────────────────────────────────────────────
// Rendering + visibility
// ─────────────────────────────────────────────────────────────
describe('AddAnnotationPopover — rendering', () => {
  it('renders nothing and fires no callbacks while closed', () => {
    const { onAdd, onCancel } = renderPopover({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('renders an accessible dialog with every field, the category group and both actions', () => {
    renderPopover();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add Annotation' })).toBeInTheDocument();
    expect(labelInput()).toBeInTheDocument();
    expect(descriptionInput()).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Category' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Annotation' })).toBeInTheDocument();
  });

  it('shows the raw timestamp (no date input) when editableDate is off', () => {
    renderPopover({ editableDate: false });
    expect(screen.queryByLabelText(/date/i)).toBeNull();
    expect(screen.getByText(TS)).toBeInTheDocument();
  });

  it('renders an editable date input seeded from the timestamp when editableDate is on', () => {
    renderPopover({ editableDate: true, timestamp: '2025-03-15T23:30:00Z' });
    const date = dateInput();
    expect(date.type).toBe('date');
    expect(date.value).toBe('2025-03-15');
  });

  it('preserves draft field limits and required editable date validation', () => {
    renderPopover({ editableDate: true });
    expect(labelInput()).toHaveAttribute('maxlength', '50');
    expect(descriptionInput()).toHaveAttribute('maxlength', '200');
    expect(dateInput()).toBeRequired();
    expect(dateInput()).toHaveAttribute('max', toDateInputValue(new Date().toISOString()));
  });

  it('resyncs an edited date from a new timestamp without dropping the label draft', () => {
    const onAdd = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <AddAnnotationPopover open editableDate timestamp={TS} onAdd={onAdd} onCancel={onCancel} />,
    );
    typeInto(labelInput(), 'Draft label');
    typeInto(dateInput(), '2025-04-20');

    rerender(
      <AddAnnotationPopover open editableDate timestamp="2025-07-10T13:00:00Z" onAdd={onAdd} onCancel={onCancel} />,
    );

    expect(dateInput().value).toBe('2025-07-10');
    expect(labelInput().value).toBe('Draft label');
    expect(onAdd).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// Category toggle group — a11y + selection
// ─────────────────────────────────────────────────────────────
describe('AddAnnotationPopover — category selection', () => {
  it('renders all six categories with milestone pressed by default', () => {
    renderPopover();
    for (const name of ['Milestone', 'Maintenance', 'Trip', 'Issue', 'Upgrade', 'Custom']) {
      expect(catButton(name)).toBeInTheDocument();
    }
    expect(catButton('Milestone')).toHaveAttribute('aria-pressed', 'true');
    expect(catButton('Maintenance')).toHaveAttribute('aria-pressed', 'false');
  });

  it('moves the pressed state and neutral selected surface when another category is picked', () => {
    renderPopover();
    fireEvent.click(catButton('Maintenance'));

    expect(catButton('Maintenance')).toHaveAttribute('aria-pressed', 'true');
    expect(catButton('Milestone')).toHaveAttribute('aria-pressed', 'false');
    expect(catButton('Maintenance')).toHaveClass('bg-[var(--control-bg)]');
    expect(catButton('Milestone')).toHaveClass('bg-transparent');
    expect(catButton('Maintenance')).not.toHaveAttribute('style');
    expect(catButton('Milestone')).not.toHaveAttribute('style');
  });

  it('keeps category labels wrapping, touch targets reachable and icons decorative', () => {
    renderPopover();
    for (const name of ['Milestone', 'Maintenance', 'Trip', 'Issue', 'Upgrade', 'Custom']) {
      const button = catButton(name);
      expect(button).toHaveClass('min-h-11', 'whitespace-normal');
      expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(button.querySelector('svg')).toHaveAttribute('focusable', 'false');
    }
  });

  it('retains keyboard focus on the chosen category through draft updates', () => {
    renderPopover();
    const custom = catButton('Custom');
    custom.focus();
    fireEvent.click(custom);
    typeInto(descriptionInput(), 'Draft note');
    expect(custom).toHaveFocus();
    expect(custom).toHaveAttribute('aria-pressed', 'true');
  });
});

// ─────────────────────────────────────────────────────────────
// Submit path
// ─────────────────────────────────────────────────────────────
describe('AddAnnotationPopover — submit', () => {
  it('keeps the submit button disabled until a non-blank label is entered', () => {
    renderPopover();
    const add = screen.getByRole('button', { name: 'Add Annotation' });
    expect(add).toBeDisabled();

    typeInto(labelInput(), 'Battery replaced');
    expect(add).toBeEnabled();
  });

  it('submits a trimmed label, the default category, an undefined description and the fixed timestamp', () => {
    const { onAdd } = renderPopover({ editableDate: false });
    typeInto(labelInput(), '  Battery replaced  ');
    fireEvent.submit(getForm());

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith('Battery replaced', 'milestone', undefined, TS);
  });

  it('passes the chosen category and a trimmed description through', () => {
    const { onAdd } = renderPopover({ editableDate: false });
    typeInto(labelInput(), 'Road trip');
    fireEvent.click(catButton('Trip'));
    typeInto(descriptionInput(), '  Coast to coast  ');
    fireEvent.submit(getForm());

    expect(onAdd).toHaveBeenCalledWith('Road trip', 'trip', 'Coast to coast', TS);
  });

  it('uses the edited date (pinned to UTC midnight) as occurredAt when editableDate is on', () => {
    const { onAdd } = renderPopover({ editableDate: true, timestamp: '2025-03-15T10:00:00Z' });
    typeInto(labelInput(), 'Software upgrade');
    typeInto(dateInput(), '2025-04-20');
    fireEvent.submit(getForm());

    expect(onAdd).toHaveBeenCalledWith('Software upgrade', 'milestone', undefined, '2025-04-20T00:00:00Z');
  });

  it('does not submit when the label is only whitespace', () => {
    const { onAdd } = renderPopover();
    typeInto(labelInput(), '    ');
    fireEvent.submit(getForm());
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('does not submit when editableDate is on but the date has been cleared', () => {
    const { onAdd } = renderPopover({ editableDate: true, timestamp: '2025-03-15T10:00:00Z' });
    typeInto(labelInput(), 'Has label but no date');
    typeInto(dateInput(), '');
    fireEvent.submit(getForm());
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('resets the form fields after a successful add while the dialog stays mounted', () => {
    const { onAdd } = renderPopover({ editableDate: false });
    typeInto(labelInput(), 'Kept open');
    fireEvent.click(catButton('Issue'));
    typeInto(descriptionInput(), 'note');
    fireEvent.submit(getForm());

    expect(onAdd).toHaveBeenCalledWith('Kept open', 'issue', 'note', TS);
    // Parent owns closing; the popover itself clears its inputs for reuse.
    expect(labelInput().value).toBe('');
    expect(descriptionInput().value).toBe('');
    expect(catButton('Milestone')).toHaveAttribute('aria-pressed', 'true');
    expect(catButton('Issue')).toHaveAttribute('aria-pressed', 'false');
  });
});

// ─────────────────────────────────────────────────────────────
// Cancel / close path
// ─────────────────────────────────────────────────────────────
describe('AddAnnotationPopover — cancel', () => {
  it('invokes onCancel from the Cancel button without touching onAdd', () => {
    const { onAdd, onCancel } = renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });

  function deferred() {
    let resolve!: () => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<void>((fulfill, fail) => {
      resolve = fulfill;
      reject = fail;
    });
    return { promise, resolve, reject };
  }

  describe('AddAnnotationPopover — async lifecycle', () => {
    it('keeps the entire draft busy and unchanged, blocks duplicate click/Enter and every pending dismissal', async () => {
      const user = userEvent.setup();
      const request = deferred();
      const onAdd = vi.fn(() => request.promise);
      const onAdded = vi.fn();
      const onCancel = vi.fn();
      renderPopover({ editableDate: true, onAdd, onAdded, onCancel });
      await user.type(labelInput(), '  Draft label  ');
      typeInto(descriptionInput(), '  Draft description  ');
      typeInto(dateInput(), '2025-04-20');
      await user.click(catButton('Custom'));
      await user.click(labelInput());
      expect(labelInput()).toHaveFocus();
      fireEvent.click(screen.getByRole('button', { name: 'Add Annotation' }));
      await user.keyboard('{Enter}');
      fireEvent.submit(getForm());
      fireEvent.click(screen.getByRole('button', { name: 'Add Annotation' }));

      expect(onAdd).toHaveBeenCalledTimes(1);
      expect(onAdd).toHaveBeenCalledWith('Draft label', 'custom', 'Draft description', '2025-04-20T00:00:00Z');
      expect(onAdded).not.toHaveBeenCalled();
      expect(getForm()).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('status')).toHaveTextContent('Saving');
      expect(screen.getByRole('button', { name: 'Add Annotation' })).toHaveAttribute('aria-busy', 'true');
      expect(labelInput()).toBeDisabled();
      expect(descriptionInput()).toBeDisabled();
      expect(dateInput()).toBeDisabled();
      for (const name of ['Milestone', 'Maintenance', 'Trip', 'Issue', 'Upgrade', 'Custom']) {
        expect(catButton(name)).toBeDisabled();
      }
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      typeInto(labelInput(), 'Forbidden change');
      typeInto(descriptionInput(), 'Forbidden change');
      typeInto(dateInput(), '2025-01-01');
      fireEvent.click(catButton('Trip'));

      const outerEscape = vi.fn();
      document.addEventListener('keydown', outerEscape);
      try {
        expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
        await user.keyboard('{Escape}');
        expect(outerEscape).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Close' }));
        expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
        await user.keyboard('{Escape}');
        expect(outerEscape).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener('keydown', outerEscape);
      }
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      const backdrop = screen.getByRole('dialog').parentElement?.previousElementSibling;
      if (!backdrop) throw new Error('Modal backdrop not found');
      fireEvent.click(backdrop);
      expect(onCancel).not.toHaveBeenCalled();
      expect(labelInput().value).toBe('  Draft label  ');
      expect(descriptionInput().value).toBe('  Draft description  ');
      expect(dateInput().value).toBe('2025-04-20');
      expect(catButton('Custom')).toHaveAttribute('aria-pressed', 'true');

      await act(async () => { request.resolve(); await request.promise; });
      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(onCancel).not.toHaveBeenCalled();
      expect(labelInput().value).toBe('');
      expect(descriptionInput().value).toBe('');
      expect(catButton('Milestone')).toHaveAttribute('aria-pressed', 'true');
      expect(getForm()).not.toHaveAttribute('aria-busy');
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('retains a rejected draft and focused field, then submits edited normalized retry only once after fulfillment', async () => {
      const first = deferred();
      const retry = deferred();
      const onAdd = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
      const onAdded = vi.fn();
      renderPopover({ editableDate: true, onAdd, onAdded });
      typeInto(labelInput(), '  Original  ');
      typeInto(descriptionInput(), '  Original description  ');
      typeInto(dateInput(), '2025-04-20');
      fireEvent.click(catButton('Maintenance'));
      labelInput().focus();
      fireEvent.submit(getForm());
      await act(async () => { first.reject(new Error('Rejected POST')); await first.promise.catch(() => {}); });

      expect(labelInput().value).toBe('  Original  ');
      expect(descriptionInput().value).toBe('  Original description  ');
      expect(dateInput().value).toBe('2025-04-20');
      expect(catButton('Maintenance')).toHaveAttribute('aria-pressed', 'true');
      expect(labelInput()).toHaveFocus();
      expect(labelInput()).toBeEnabled();
      expect(descriptionInput()).toBeEnabled();
      expect(dateInput()).toBeEnabled();
      expect(catButton('Trip')).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to add annotation');
      expect(screen.getByRole('alert')).toHaveTextContent('Please try again');
      expect(getForm()).toHaveAttribute('aria-describedby', screen.getByRole('alert').id);
      expect(onAdded).not.toHaveBeenCalled();

      typeInto(labelInput(), '  Edited retry  ');
      typeInto(descriptionInput(), '  Edited note  ');
      typeInto(dateInput(), '2025-05-15');
      fireEvent.click(catButton('Trip'));
      fireEvent.submit(getForm());
      expect(onAdd).toHaveBeenCalledTimes(2);
      expect(onAdd).toHaveBeenLastCalledWith('Edited retry', 'trip', 'Edited note', '2025-05-15T00:00:00Z');
      expect(labelInput().value).toBe('  Edited retry  ');
      expect(dateInput().value).toBe('2025-05-15');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(onAdded).not.toHaveBeenCalled();
      await act(async () => { retry.resolve(); await retry.promise; });
      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(labelInput().value).toBe('');
      expect(descriptionInput().value).toBe('');
      expect(catButton('Milestone')).toHaveAttribute('aria-pressed', 'true');
    });

    it('latches synchronously before invoking even a reentrant callback', () => {
      const onAdd = vi.fn(() => {
        fireEvent.submit(getForm());
      });
      const onAdded = vi.fn();
      renderPopover({ onAdd, onAdded });
      typeInto(labelInput(), 'Legacy void');
      fireEvent.submit(getForm());
      expect(onAdd).toHaveBeenCalledTimes(1);
      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(labelInput().value).toBe('');
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('retains all fields on synchronous throw and keeps validation before retry', () => {
      const onAdd = vi.fn(() => { throw new Error('Missing capability'); });
      const onAdded = vi.fn();
      renderPopover({ editableDate: true, onAdd, onAdded });
      typeInto(labelInput(), '  Original  ');
      typeInto(descriptionInput(), '  Note  ');
      typeInto(dateInput(), '2025-04-20');
      fireEvent.click(catButton('Issue'));
      fireEvent.submit(getForm());
      expect(onAdd).toHaveBeenCalledTimes(1);
      expect(onAdded).not.toHaveBeenCalled();
      expect(labelInput().value).toBe('  Original  ');
      expect(descriptionInput().value).toBe('  Note  ');
      expect(dateInput().value).toBe('2025-04-20');
      expect(catButton('Issue')).toHaveAttribute('aria-pressed', 'true');
      expect(labelInput()).toBeEnabled();
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to add annotation');
      typeInto(labelInput(), '  ');
      fireEvent.submit(getForm());
      typeInto(labelInput(), 'Valid');
      typeInto(dateInput(), '');
      fireEvent.submit(getForm());
      expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it.each(['Cancel', 'Close', 'Escape'])('explicit idle %s discards rejected draft without success notification', async (dismissal) => {
      const request = deferred();
      const onAdded = vi.fn();
      const onCancel = vi.fn();
      const onAdd = vi.fn(() => request.promise);
      const user = userEvent.setup();
      renderPopover({ onAdd, onAdded, onCancel });
      typeInto(labelInput(), 'Discard this');
      typeInto(descriptionInput(), 'Discard note');
      fireEvent.click(catButton('Custom'));
      fireEvent.submit(getForm());
      await act(async () => { request.reject(new Error('Failure')); await request.promise.catch(() => {}); });
      if (dismissal === 'Escape') {
        await user.click(labelInput());
        expect(labelInput()).toHaveFocus();
        await user.keyboard('{Escape}');
      } else {
        fireEvent.click(screen.getByRole('button', { name: dismissal }));
      }
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onAdded).not.toHaveBeenCalled();
      expect(onAdd).toHaveBeenCalledTimes(1);
      expect(labelInput().value).toBe('');
      expect(descriptionInput().value).toBe('');
      expect(catButton('Milestone')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it.each(['void', 'promise'])('does not turn %s success notification failure into a rejected create or duplicate POST', async (kind) => {
      const request = deferred();
      const onAdd = vi.fn(() => kind === 'promise' ? request.promise : undefined);
      const onAdded = vi.fn(() => { throw new Error('Notification failed'); });
      renderPopover({ onAdd, onAdded });
      typeInto(labelInput(), 'Confirmed save');
      fireEvent.submit(getForm());
      if (kind === 'promise') {
        expect(onAdded).not.toHaveBeenCalled();
        await act(async () => { request.resolve(); await request.promise; });
      }
      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(labelInput().value).toBe('');
      expect(screen.getByRole('alert')).toHaveTextContent('Annotation added');
      expect(screen.getByRole('alert')).not.toHaveTextContent('Failed to add annotation');
      expect(screen.getByRole('alert')).not.toHaveTextContent('Please try again');
      expect(screen.getByRole('button', { name: 'Add Annotation' })).toBeDisabled();
      fireEvent.submit(getForm());
      expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it.each(['resolve', 'reject'])('disposes old %s settlement authority across unmount and a new mounted form', async (outcome) => {
      const request = deferred();
      const oldAdded = vi.fn();
      const oldCancel = vi.fn();
      const old = render(<AddAnnotationPopover open timestamp={TS} onAdd={() => request.promise} onAdded={oldAdded} onCancel={oldCancel} />);
      typeInto(labelInput(), 'Old attempt');
      fireEvent.submit(getForm());
      old.unmount();
      const current = deferred();
      const currentAdded = vi.fn();
      const currentAdd = vi.fn(() => current.promise);
      renderPopover({ onAdd: currentAdd, onAdded: currentAdded });
      typeInto(labelInput(), 'New attempt');
      labelInput().focus();
      fireEvent.submit(getForm());
      await act(async () => {
        if (outcome === 'resolve') request.resolve();
        else request.reject(new Error('Old rejection'));
        await request.promise.catch(() => {});
      });
      expect(oldAdded).not.toHaveBeenCalled();
      expect(oldCancel).not.toHaveBeenCalled();
      expect(currentAdded).not.toHaveBeenCalled();
      expect(labelInput().value).toBe('New attempt');
      expect(labelInput()).toHaveFocus();
      expect(getForm()).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByRole('alert')).toBeNull();
      fireEvent.submit(getForm());
      expect(currentAdd).toHaveBeenCalledTimes(1);
      await act(async () => { current.resolve(); await current.promise; });
      expect(currentAdded).toHaveBeenCalledTimes(1);
      expect(labelInput().value).toBe('');
    });

    it.each(['Cancel', 'Close', 'Escape'])('releases a failed manual date only after explicit %s and accepts a fresh opening timestamp', async (dismissal) => {
      const request = deferred();
      const onAdd = vi.fn(() => request.promise);
      const onCancel = vi.fn();
      const user = userEvent.setup();
      const { rerender } = render(
        <AddAnnotationPopover open editableDate timestamp={TS} onAdd={onAdd} onCancel={onCancel} />,
      );
      typeInto(labelInput(), '  Retained label  ');
      typeInto(descriptionInput(), '  Retained note  ');
      typeInto(dateInput(), '2025-04-20');
      fireEvent.click(catButton('Custom'));
      fireEvent.submit(getForm());
      await act(async () => { request.reject(new Error('Rejected')); await request.promise.catch(() => {}); });
      const nextTimestamp = '2025-05-15T12:00:00Z';
      rerender(<AddAnnotationPopover open editableDate timestamp={nextTimestamp} onAdd={onAdd} onCancel={onCancel} />);
      expect(dateInput().value).toBe('2025-04-20');
      expect(labelInput().value).toBe('  Retained label  ');
      expect(descriptionInput().value).toBe('  Retained note  ');
      expect(catButton('Custom')).toHaveAttribute('aria-pressed', 'true');
      if (dismissal === 'Escape') {
        await user.click(labelInput());
        await user.keyboard('{Escape}');
      } else {
        fireEvent.click(screen.getByRole('button', { name: dismissal }));
      }
      expect(onCancel).toHaveBeenCalledTimes(1);
      rerender(<AddAnnotationPopover open={false} editableDate timestamp={nextTimestamp} onAdd={onAdd} onCancel={onCancel} />);
      rerender(<AddAnnotationPopover open editableDate timestamp={nextTimestamp} onAdd={onAdd} onCancel={onCancel} />);
      expect(dateInput().value).toBe('2025-05-15');
      expect(labelInput().value).toBe('');
      expect(descriptionInput().value).toBe('');
      expect(catButton('Milestone')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('reports an asynchronous notification rejection as saved, never as a retryable create failure', async () => {
      const notification = deferred();
      const onAdd = vi.fn();
      const onAdded = vi.fn(() => notification.promise);
      renderPopover({ onAdd, onAdded });
      typeInto(labelInput(), 'Saved');
      fireEvent.submit(getForm());
      expect(labelInput().value).toBe('');
      expect(onAdded).toHaveBeenCalledTimes(1);
      await act(async () => { notification.reject(new Error('Notification failed')); await notification.promise.catch(() => {}); });
      expect(screen.getByRole('alert')).toHaveTextContent('Annotation added');
      expect(screen.getByRole('alert')).not.toHaveTextContent('Please try again');
      expect(screen.getByRole('alert')).not.toHaveTextContent('Failed to add annotation');
      expect(labelInput()).toBeDisabled();
      typeInto(labelInput(), 'Saved');
      fireEvent.submit(getForm());
      expect(onAdd).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(labelInput()).toBeEnabled();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('ignores notification rejection from a saved instance after explicit discard and reopening', async () => {
      const notification = deferred();
      const onAdd = vi.fn();
      const onAdded = vi.fn(() => notification.promise);
      const onCancel = vi.fn();
      const { rerender } = render(
        <AddAnnotationPopover open timestamp={TS} onAdd={onAdd} onAdded={onAdded} onCancel={onCancel} />,
      );
      typeInto(labelInput(), 'Saved');
      fireEvent.submit(getForm());
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      rerender(<AddAnnotationPopover open={false} timestamp={TS} onAdd={onAdd} onAdded={onAdded} onCancel={onCancel} />);
      rerender(<AddAnnotationPopover open timestamp={TS} onAdd={onAdd} onAdded={onAdded} onCancel={onCancel} />);
      typeInto(labelInput(), 'Fresh draft');
      await act(async () => { notification.reject(new Error('Old notification')); await notification.promise.catch(() => {}); });
      expect(labelInput().value).toBe('Fresh draft');
      expect(labelInput()).toBeEnabled();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onAdd).toHaveBeenCalledTimes(1);
    });
  });

  it('invokes onCancel from the modal Close (X) affordance', () => {
    const { onCancel } = renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('clears the typed label when cancelled', () => {
    const { onCancel } = renderPopover();
    typeInto(labelInput(), 'Draft entry');
    expect(labelInput().value).toBe('Draft entry');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    // open is still true (parent controls it), so the cleared field is visible.
    expect(labelInput().value).toBe('');
  });

  it('cancels on Escape and clears every draft field without submitting', async () => {
    const user = userEvent.setup();
    const { onAdd, onCancel } = renderPopover();
    await user.type(labelInput(), 'Draft entry');
    await user.type(descriptionInput(), 'Draft description');
    await user.click(catButton('Custom'));
    await user.click(labelInput());
    expect(labelInput()).toHaveFocus();
    expect(screen.getByRole('dialog')).toContainElement(labelInput());

    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
    expect(labelInput().value).toBe('');
    expect(descriptionInput().value).toBe('');
    expect(catButton('Milestone')).toHaveAttribute('aria-pressed', 'true');
    expect(labelInput()).toHaveFocus();
  });
});

function authorityRequest() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type CreateAuthority = NonNullable<React.ComponentProps<typeof AddAnnotationPopover>['createAuthority']>;
const TARGET = 'Battery — vehicle 7 — scope battery';

function currentAuthority(): CreateAuthority {
  return { targetLabel: TARGET, canSubmit: true, getSettlementAuthority: () => 'current' };
}

describe('AddAnnotationPopover — settlement authority', () => {
  it('seeds a fresh managed opening date while retaining the current form date through context changes', () => {
    const onAdd = vi.fn();
    const onCancel = vi.fn();
    const props = { editableDate: true, onAdd, onCancel, createAuthority: currentAuthority() };
    const { rerender } = render(<AddAnnotationPopover {...props} open timestamp={TS} />);
    typeInto(labelInput(), 'Current draft');
    typeInto(dateInput(), '2025-04-20');
    rerender(<AddAnnotationPopover {...props} open timestamp="2025-07-01T12:00:00Z" />);
    expect(dateInput().value).toBe('2025-04-20');
    expect(labelInput().value).toBe('Current draft');
    rerender(<AddAnnotationPopover {...props} open={false} timestamp="2025-08-01T12:00:00Z" />);
    rerender(<AddAnnotationPopover {...props} open timestamp="2025-08-01T12:00:00Z" />);
    expect(dateInput().value).toBe('2025-08-01');
    expect(labelInput().value).toBe('');
    expect(onAdd).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it.each(['void', 'async'])('keeps standalone legacy %s success reset and exactly-once notification without authority', async (kind) => {
    const request = authorityRequest();
    const onAdd = vi.fn(() => kind === 'async' ? request.promise : undefined);
    const onAdded = vi.fn();
    renderPopover({ onAdd, onAdded });
    typeInto(labelInput(), '  Legacy  ');
    typeInto(descriptionInput(), '  Note  ');
    fireEvent.click(catButton('Trip'));
    fireEvent.submit(getForm());
    if (kind === 'async') {
      expect(labelInput().value).toBe('  Legacy  ');
      expect(onAdded).not.toHaveBeenCalled();
      await act(async () => { request.resolve(); await request.promise; });
    }
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith('Legacy', 'trip', 'Note', TS);
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(labelInput().value).toBe('');
    expect(descriptionInput().value).toBe('');
    expect(catButton('Milestone')).toHaveAttribute('aria-pressed', 'true');
    expect(getForm()).not.toHaveAttribute('aria-busy');
  });

  it.each(['void', 'async'])('checks current authority before %s draft reset and notification', async (kind) => {
    const request = authorityRequest();
    const onAdded = vi.fn();
    const getSettlementAuthority = vi.fn((): 'current' => {
      expect(labelInput().value).toBe('  Current  ');
      expect(descriptionInput().value).toBe('  Note  ');
      expect(onAdded).not.toHaveBeenCalled();
      return 'current';
    });
    renderPopover({
      onAdd: () => kind === 'async' ? request.promise : undefined,
      onAdded,
      createAuthority: { ...currentAuthority(), getSettlementAuthority },
    });
    typeInto(labelInput(), '  Current  ');
    typeInto(descriptionInput(), '  Note  ');
    fireEvent.submit(getForm());
    if (kind === 'async') {
      expect(getSettlementAuthority).not.toHaveBeenCalled();
      await act(async () => { request.resolve(); await request.promise; });
    }
    expect(getSettlementAuthority).toHaveBeenCalledTimes(1);
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(getSettlementAuthority.mock.invocationCallOrder[0]).toBeLessThan(onAdded.mock.invocationCallOrder[0]);
    expect(onAdded.mock.results[0]?.type).toBe('return');
    expect(labelInput().value).toBe('');
    expect(descriptionInput().value).toBe('');
    expect(catButton('Milestone')).toHaveAttribute('aria-pressed', 'true');
    expect(getForm()).not.toHaveAttribute('aria-busy');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('uses latest semantic authority at settlement and keeps saved-stale terminal, retained and nonbusy without focus transfer', async () => {
    const request = authorityRequest();
    const onAdd = vi.fn(() => request.promise);
    const onAdded = vi.fn();
    const onCancel = vi.fn();
    const oldGetter = vi.fn((): 'current' => 'current');
    const latestGetter = vi.fn((): 'stale' => 'stale');
    const props = { open: true, editableDate: true, timestamp: TS, onAdd, onAdded, onCancel };
    const { rerender } = render(<AddAnnotationPopover {...props} createAuthority={{ ...currentAuthority(), getSettlementAuthority: oldGetter }} />);
    typeInto(labelInput(), '  Original  ');
    typeInto(descriptionInput(), '  Original note  ');
    typeInto(dateInput(), '2025-04-20');
    fireEvent.click(catButton('Custom'));
    labelInput().focus();
    fireEvent.submit(getForm());
    rerender(<AddAnnotationPopover {...props} timestamp="2025-08-01T00:00:00Z" createAuthority={{ ...currentAuthority(), canSubmit: false, getSettlementAuthority: latestGetter }} />);
    expect(getForm()).toHaveAttribute('aria-busy', 'true');
    expect(dateInput().value).toBe('2025-04-20');
    await act(async () => { request.resolve(); await request.promise; });
    expect(oldGetter).not.toHaveBeenCalled();
    expect(latestGetter).toHaveBeenCalledTimes(1);
    expect(labelInput().value).toBe('  Original  ');
    expect(descriptionInput().value).toBe('  Original note  ');
    expect(dateInput().value).toBe('2025-04-20');
    expect(catButton('Custom')).toHaveAttribute('aria-pressed', 'true');
    expect(labelInput()).toHaveFocus();
    expect(getForm()).not.toHaveAttribute('aria-busy');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(`Annotation saved for ${TARGET}. The chart context changed.`);
    expect(getForm()).toHaveAttribute('aria-describedby', screen.getByRole('status').id);
    expect(screen.queryByText(/Saving/)).toBeNull();
    expect(onAdded).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(labelInput()).toBeDisabled();
    expect(descriptionInput()).toBeDisabled();
    expect(dateInput()).toBeDisabled();
    expect(catButton('Trip')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Annotation' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    rerender(<AddAnnotationPopover {...props} createAuthority={currentAuthority()} />);
    typeInto(labelInput(), 'Duplicate');
    fireEvent.submit(getForm());
    fireEvent.click(screen.getByRole('button', { name: 'Add Annotation' }));
    fireEvent.keyDown(labelInput(), { key: 'Enter' });
    expect(labelInput().value).toBe('  Original  ');
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('retained for reference');
  });

  it('blocks actual submission before save when caller context changes, explaining the original target while leaving draft editable', () => {
    const onAdd = vi.fn();
    const onAdded = vi.fn();
    const getSettlementAuthority = vi.fn((): 'current' => 'current');
    renderPopover({
      onAdd, onAdded,
      createAuthority: { ...currentAuthority(), canSubmit: false, getSettlementAuthority },
    });
    typeInto(labelInput(), '  Unsaved  ');
    typeInto(descriptionInput(), 'Editable');
    expect(labelInput()).toBeEnabled();
    expect(descriptionInput()).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add Annotation' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(`This form belongs to ${TARGET}. Return to that context to save`);
    expect(getForm()).toHaveAttribute('aria-describedby', screen.getByRole('status').id);
    fireEvent.submit(getForm());
    expect(onAdd).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
    expect(getSettlementAuthority).not.toHaveBeenCalled();
    expect(labelInput().value).toBe('  Unsaved  ');
    expect(getForm()).not.toHaveAttribute('aria-busy');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a genuinely failed save editable and only retries after caller authorization returns', async () => {
    const first = authorityRequest();
    const retry = authorityRequest();
    const onAdd = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    const onAdded = vi.fn();
    const onCancel = vi.fn();
    const props = { open: true, timestamp: TS, onAdd, onAdded, onCancel };
    const { rerender } = render(<AddAnnotationPopover {...props} createAuthority={currentAuthority()} />);
    typeInto(labelInput(), '  Failed draft  ');
    typeInto(descriptionInput(), '  Kept note  ');
    fireEvent.click(catButton('Issue'));
    fireEvent.submit(getForm());
    rerender(<AddAnnotationPopover {...props} createAuthority={{ ...currentAuthority(), canSubmit: false }} />);
    await act(async () => { first.reject(new Error('Actual POST failure')); await first.promise.catch(() => {}); });
    expect(labelInput().value).toBe('  Failed draft  ');
    expect(descriptionInput().value).toBe('  Kept note  ');
    expect(catButton('Issue')).toHaveAttribute('aria-pressed', 'true');
    expect(labelInput()).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to add annotation');
    expect(screen.getByRole('status')).toHaveTextContent('Return to that context');
    expect(getForm().getAttribute('aria-describedby')?.split(' ')).toEqual([screen.getByRole('alert').id, screen.getByRole('status').id]);
    typeInto(labelInput(), '  Authorized retry  ');
    fireEvent.submit(getForm());
    expect(onAdd).toHaveBeenCalledTimes(1);
    rerender(<AddAnnotationPopover {...props} createAuthority={currentAuthority()} />);
    fireEvent.submit(getForm());
    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(onAdd).toHaveBeenLastCalledWith('Authorized retry', 'issue', 'Kept note', TS);
    expect(onAdded).not.toHaveBeenCalled();
    await act(async () => { retry.resolve(); await retry.promise; });
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(labelInput().value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('treats a thrown authority getter as confirmed saved reference, never failed, changed-context or retryable', async () => {
    const request = authorityRequest();
    const onAdd = vi.fn(() => request.promise);
    const onAdded = vi.fn();
    renderPopover({
      onAdd, onAdded,
      createAuthority: { ...currentAuthority(), getSettlementAuthority: () => { throw new Error('Authority unavailable'); } },
    });
    typeInto(labelInput(), '  Saved  ');
    fireEvent.submit(getForm());
    await act(async () => { request.resolve(); await request.promise; });
    expect(labelInput().value).toBe('  Saved  ');
    expect(screen.getByRole('status')).toHaveTextContent('Annotation added');
    expect(screen.getByRole('status')).not.toHaveTextContent('context changed');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(getForm()).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('button', { name: 'Add Annotation' })).toBeDisabled();
    fireEvent.submit(getForm());
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdded).not.toHaveBeenCalled();
  });

  it.each(['footer', 'Escape', 'backdrop'])('allows explicit saved-stale %s dismissal without another create or success notification', async (dismissal) => {
    const request = authorityRequest();
    const onAdd = vi.fn(() => request.promise);
    const onAdded = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderPopover({
      onAdd, onAdded, onCancel,
      createAuthority: { ...currentAuthority(), getSettlementAuthority: () => 'stale' },
    });
    typeInto(labelInput(), 'Saved reference');
    fireEvent.submit(getForm());
    await act(async () => { request.resolve(); await request.promise; });
    const close = screen.getAllByRole('button', { name: 'Close' }).find(button => button.getAttribute('type') === 'button' && button.closest('form'));
    if (!close) throw new Error('Saved-reference footer Close missing');
    expect(close).toBeEnabled();
    if (dismissal === 'Escape') {
      close.focus();
      expect(close).toHaveFocus();
      await user.keyboard('{Escape}');
    } else if (dismissal === 'backdrop') {
      const backdrop = screen.getByRole('dialog').parentElement?.previousElementSibling;
      if (!backdrop) throw new Error('Modal backdrop missing');
      fireEvent.click(backdrop);
    } else {
      fireEvent.click(close);
    }
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAdded).not.toHaveBeenCalled();
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(labelInput().value).toBe('');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reads the live getter without a rerender and keeps change-return success stale despite canSubmit returning true', async () => {
    const request = authorityRequest();
    let revision = 0;
    const capturedRevision = revision;
    const getSettlementAuthority = vi.fn((): 'current' | 'stale' => revision === capturedRevision ? 'current' : 'stale');
    const onAdded = vi.fn();
    const onAdd = vi.fn(() => request.promise);
    renderPopover({ onAdd, onAdded, createAuthority: { ...currentAuthority(), getSettlementAuthority } });
    typeInto(labelInput(), 'Original context');
    fireEvent.submit(getForm());
    revision += 1;
    revision += 1;
    await act(async () => { request.resolve(); await request.promise; });
    expect(getSettlementAuthority).toHaveBeenCalledTimes(1);
    expect(labelInput().value).toBe('Original context');
    expect(screen.getByRole('status')).toHaveTextContent('chart context changed');
    expect(screen.getByRole('button', { name: 'Add Annotation' })).toBeDisabled();
    fireEvent.submit(getForm());
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdded).not.toHaveBeenCalled();
  });

  it.each(['close', 'unmount'])('ignores disposed %s completion and does not release a new instance latch', async (disposal) => {
    const old = authorityRequest();
    const next = authorityRequest();
    const oldAdded = vi.fn();
    const oldGetter = vi.fn((): 'current' => 'current');
    const onCancel = vi.fn();
    const view = render(<AddAnnotationPopover open timestamp={TS} onAdd={() => old.promise} onAdded={oldAdded} onCancel={onCancel} createAuthority={{ ...currentAuthority(), getSettlementAuthority: oldGetter }} />);
    typeInto(labelInput(), 'Old');
    fireEvent.submit(getForm());
    const nextAdd = vi.fn(() => next.promise);
    const nextAdded = vi.fn();
    const nextForm = <AddAnnotationPopover open timestamp={TS} onAdd={nextAdd} onAdded={nextAdded} onCancel={onCancel} createAuthority={currentAuthority()} />;
    if (disposal === 'unmount') {
      view.unmount();
      render(nextForm);
    } else {
      view.rerender(<AddAnnotationPopover open={false} timestamp={TS} onAdd={() => old.promise} onAdded={oldAdded} onCancel={onCancel} />);
      view.rerender(nextForm);
    }
    typeInto(labelInput(), 'New');
    labelInput().focus();
    fireEvent.submit(getForm());
    await act(async () => { old.resolve(); await old.promise; });
    expect(oldGetter).not.toHaveBeenCalled();
    expect(oldAdded).not.toHaveBeenCalled();
    expect(nextAdded).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(labelInput().value).toBe('New');
    expect(labelInput()).toHaveFocus();
    expect(getForm()).toHaveAttribute('aria-busy', 'true');
    fireEvent.submit(getForm());
    expect(nextAdd).toHaveBeenCalledTimes(1);
    await act(async () => { next.resolve(); await next.promise; });
    expect(nextAdded).toHaveBeenCalledTimes(1);
    expect(labelInput().value).toBe('');
  });
});
