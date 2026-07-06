/**
 * Unit + behaviour coverage for <AnnotationList>, the inline annotation footer
 * rendered under a chart by <ChartContainer>.
 *
 * The component is pure UI over an `annotations` array + `onRemove` callback —
 * there is no network or query layer to mock (it only pulls `useTranslation`).
 * We import '@/i18n' so `t(key, default, opts)` resolves the real English
 * strings (including the `{{label}}` interpolation used for the per-row remove
 * button) and the assertions read like the rendered UI.
 *
 * Interactions use `fireEvent` (the repo convention — see AddAnnotationPopover /
 * IncidentForm / ConfirmDialog tests) because `@testing-library/user-event` is
 * not a dependency of this workspace.
 */
import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

import { AnnotationList } from './AnnotationList';
import { ANNOTATION_COLORS } from '@/types/annotations';
import type { AnnotationCategory, DataAnnotation } from '@/types/annotations';

function makeAnnotation(overrides: Partial<DataAnnotation> = {}): DataAnnotation {
  return {
    id: 'a1',
    timestamp: '2026-04-30T12:00:00Z',
    label: 'Battery replaced',
    category: 'maintenance',
    context: 'battery',
    createdAt: '2026-04-30T12:00:00Z',
    ...overrides,
  };
}

// The colour swatch is an unlabeled dot; reach it from its row by class.
function dotForRow(labelText: string): HTMLElement {
  const row = screen.getByText(labelText).closest('div.group');
  if (!row) throw new Error(`AnnotationList: row for "${labelText}" not found`);
  const dot = row.querySelector('.rounded-full');
  if (!dot) throw new Error(`AnnotationList: colour dot for "${labelText}" not found`);
  return dot as HTMLElement;
}

beforeEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────
// Empty / nullish — must render nothing (its sole consumer relies
// on this by only mounting the list when length > 0).
// ─────────────────────────────────────────────────────────────
describe('AnnotationList — empty & nullish', () => {
  it('renders nothing for an empty array', () => {
    const { container } = render(<AnnotationList annotations={[]} onRemove={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Annotations')).toBeNull();
  });

  it('renders nothing (no throw) when annotations is undefined', () => {
    // The async annotations hook can hand us undefined before it resolves —
    // `.length`/`.map` on that would throw without the internal guard.
    const onRemove = vi.fn();
    expect(() =>
      render(
        <AnnotationList
          annotations={undefined as unknown as DataAnnotation[]}
          onRemove={onRemove}
        />,
      ),
    ).not.toThrow();
    expect(screen.queryByText('Annotations')).toBeNull();
  });

  it('renders nothing (no throw) when annotations is null', () => {
    expect(() =>
      render(
        <AnnotationList
          annotations={null as unknown as DataAnnotation[]}
          onRemove={vi.fn()}
        />,
      ),
    ).not.toThrow();
    expect(screen.queryByText('Annotations')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Rendering — title, rows, timestamp, description branch
// ─────────────────────────────────────────────────────────────
describe('AnnotationList — rendering', () => {
  it('shows the "Annotations" title and one row per annotation', () => {
    render(
      <AnnotationList
        annotations={[
          makeAnnotation({ id: 'a1', label: 'Battery replaced' }),
          makeAnnotation({ id: 'a2', label: 'Tire rotation', category: 'trip' }),
        ]}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByText('Annotations')).toBeInTheDocument();
    expect(screen.getByText('Battery replaced')).toBeInTheDocument();
    expect(screen.getByText('Tire rotation')).toBeInTheDocument();
    // One remove button per annotation.
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('renders the raw timestamp for each annotation', () => {
    render(
      <AnnotationList
        annotations={[makeAnnotation({ timestamp: '2026-04-30T12:00:00Z' })]}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('2026-04-30T12:00:00Z')).toBeInTheDocument();
  });

  it('renders the description (with the em-dash prefix) only when present', () => {
    const { rerender } = render(
      <AnnotationList
        annotations={[makeAnnotation({ description: 'Coast to coast' })]}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText(/Coast to coast/)).toBeInTheDocument();
    expect(screen.getByText(/^—\s*Coast to coast$/)).toBeInTheDocument();

    // Same row without a description → no dangling em-dash description node.
    rerender(
      <AnnotationList
        annotations={[makeAnnotation({ description: undefined })]}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Coast to coast/)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Category colour dot — known map + unknown fallback (bug fix)
// ─────────────────────────────────────────────────────────────
describe('AnnotationList — category colour', () => {
  it('paints the swatch with the category colour for every known category', () => {
    const categories: AnnotationCategory[] = [
      'milestone',
      'maintenance',
      'trip',
      'issue',
      'upgrade',
      'custom',
    ];

    for (const category of categories) {
      cleanup();
      render(
        <AnnotationList
          annotations={[makeAnnotation({ label: category, category })]}
          onRemove={vi.fn()}
        />,
      );
      expect(dotForRow(category)).toHaveStyle({
        backgroundColor: ANNOTATION_COLORS[category],
      });
    }
  });

  it('falls back to the neutral custom colour for an unknown category', () => {
    // Forward-compat backend data: a category the frontend union does not know
    // about must not produce backgroundColor={undefined} (an invisible dot).
    render(
      <AnnotationList
        annotations={[
          makeAnnotation({
            label: 'From the future',
            category: 'quantum-event' as AnnotationCategory,
          }),
        ]}
        onRemove={vi.fn()}
      />,
    );
    const dot = dotForRow('From the future');
    expect(dot).toHaveStyle({ backgroundColor: ANNOTATION_COLORS.custom });
    expect(dot.style.backgroundColor).not.toBe('');
  });
});

// ─────────────────────────────────────────────────────────────
// Null-safety — a missing label degrades to a visible placeholder
// ─────────────────────────────────────────────────────────────
describe('AnnotationList — label null-safety', () => {
  it('shows an em-dash placeholder when the label is missing', () => {
    render(
      <AnnotationList
        annotations={[
          makeAnnotation({ label: undefined as unknown as string, description: undefined }),
        ]}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────
// Accessibility — icon-only remove buttons must be distinguishable
// ─────────────────────────────────────────────────────────────
describe('AnnotationList — remove button a11y', () => {
  it('gives each remove button an accessible name that includes its label', () => {
    render(
      <AnnotationList
        annotations={[
          makeAnnotation({ id: 'a1', label: 'Battery replaced' }),
          makeAnnotation({ id: 'a2', label: 'Tire rotation' }),
        ]}
        onRemove={vi.fn()}
      />,
    );

    const first = screen.getByRole('button', { name: 'Remove annotation: Battery replaced' });
    const second = screen.getByRole('button', { name: 'Remove annotation: Tire rotation' });
    expect(first).toBeInTheDocument();
    expect(second).toBeInTheDocument();
    // The two icon-only controls are genuinely distinct to a screen reader.
    expect(first).not.toBe(second);
  });

  it('interpolates the placeholder into the remove label when the annotation has no label', () => {
    render(
      <AnnotationList
        annotations={[makeAnnotation({ label: undefined as unknown as string })]}
        onRemove={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Remove annotation: —' }),
    ).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────
// Interaction — remove wiring
// ─────────────────────────────────────────────────────────────
describe('AnnotationList — remove interaction', () => {
  it('calls onRemove with the clicked annotation id and nothing else', () => {
    const onRemove = vi.fn();
    render(
      <AnnotationList
        annotations={[
          makeAnnotation({ id: 'keep-a', label: 'Kept A' }),
          makeAnnotation({ id: 'remove-b', label: 'Remove B' }),
        ]}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove annotation: Remove B' }));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('remove-b');
  });

  it('routes each row\'s button to its own id across multiple clicks', () => {
    const onRemove = vi.fn();
    render(
      <AnnotationList
        annotations={[
          makeAnnotation({ id: 'first', label: 'First' }),
          makeAnnotation({ id: 'second', label: 'Second' }),
        ]}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove annotation: First' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove annotation: Second' }));

    expect(onRemove).toHaveBeenNthCalledWith(1, 'first');
    expect(onRemove).toHaveBeenNthCalledWith(2, 'second');
  });

  it('does not invoke onRemove during a passive render', () => {
    const onRemove = vi.fn();
    render(
      <AnnotationList
        annotations={[makeAnnotation()]}
        onRemove={onRemove}
      />,
    );
    // Clicking the row (not the button) must not trigger a removal.
    const row = screen.getByText('Battery replaced').closest('div.group') as HTMLElement;
    fireEvent.click(within(row).getByText('Battery replaced'));
    expect(onRemove).not.toHaveBeenCalled();
  });
});
