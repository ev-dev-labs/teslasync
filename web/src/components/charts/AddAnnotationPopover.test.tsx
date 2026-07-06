/**
 * Unit + behaviour coverage for <AddAnnotationPopover> and its two exported
 * date helpers.
 *
 * The component is pure UI over an `onAdd` / `onCancel` callback pair — there is
 * no network or query layer to mock (it only pulls `useTranslation`). We import
 * '@/i18n' so `t(key, default)` resolves the real English strings and the
 * assertions read like the rendered UI.
 *
 * Interactions use `fireEvent` (the repo convention — see IncidentForm /
 * ConfirmDialog / TagInput tests) because `@testing-library/user-event` is not a
 * dependency of this workspace.
 */
import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import {
  AddAnnotationPopover,
  toDateInputValue,
  toIsoTimestamp,
} from './AddAnnotationPopover';
import { ANNOTATION_COLORS } from '@/types/annotations';

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

  it('moves the pressed state and semantic colour when another category is picked', () => {
    renderPopover();
    fireEvent.click(catButton('Maintenance'));

    expect(catButton('Maintenance')).toHaveAttribute('aria-pressed', 'true');
    expect(catButton('Milestone')).toHaveAttribute('aria-pressed', 'false');
    expect(catButton('Maintenance')).toHaveStyle({ color: ANNOTATION_COLORS.maintenance });
    // The now-unselected pill no longer carries the milestone accent colour.
    expect(catButton('Milestone')).not.toHaveStyle({ color: ANNOTATION_COLORS.milestone });
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
});
