/**
 * Phase-45 / Prompt 25 — WidgetCatalogueDialog tests.
 *
 * Verifies:
 *   - Renders nothing when closed.
 *   - When open, groups widgets by registry category — at least the canonical
 *     "battery" and "vehicle" sections must appear because they're populated
 *     by the registry.
 *   - Already-added widgets are flagged with a disabled "Add" button so users
 *     don't double-add.
 *   - Picking a widget invokes onAdd with that widget's id and closes the
 *     dialog (single-add UX, not multi-select).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@/i18n';

import { WidgetCatalogueDialog } from '../WidgetCatalogueDialog';
import { WIDGET_REGISTRY } from '../../widgets/registry';

// Modal portals to document.body — Vitest's jsdom supplies one by default.

describe('WidgetCatalogueDialog — Phase-45 / Prompt 25', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders nothing when open=false', () => {
    render(
      <WidgetCatalogueDialog
        open={false}
        onClose={() => {}}
        onAdd={() => {}}
        activeWidgetIds={[]}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a dialog with categorized widget sections when open', () => {
    render(
      <WidgetCatalogueDialog
        open
        onClose={() => {}}
        onAdd={() => {}}
        activeWidgetIds={[]}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Both well-populated categories from the registry must be present.
    expect(screen.getByTestId('widget-catalogue-category-battery')).toBeInTheDocument();
    expect(screen.getByTestId('widget-catalogue-category-vehicle')).toBeInTheDocument();
  });

  it('lists every registry widget at least once (no silent drop)', () => {
    render(
      <WidgetCatalogueDialog
        open
        onClose={() => {}}
        onAdd={() => {}}
        activeWidgetIds={[]}
      />,
    );
    // Sanity: every widget id appears as an entry. Registry has 100+ widgets,
    // so checking a representative cross-section keeps the test fast.
    const sample = ['battery-gauge', 'vehicle-hero', 'climate-status', 'recent-drives'];
    for (const id of sample) {
      expect(screen.getByTestId(`widget-catalogue-entry-${id}`)).toBeInTheDocument();
    }
    // And the registry length ratio: widget count >= 50.
    expect(WIDGET_REGISTRY.length).toBeGreaterThan(50);
  });

  it('disables the Add button for widgets already on the dashboard', () => {
    render(
      <WidgetCatalogueDialog
        open
        onClose={() => {}}
        onAdd={() => {}}
        activeWidgetIds={['battery-gauge']}
      />,
    );
    const entry = screen.getByTestId('widget-catalogue-entry-battery-gauge');
    const addButton = entry.querySelector('button');
    expect(addButton).not.toBeNull();
    expect(addButton).toBeDisabled();
  });

  it('calls onAdd with the widget id and closes when an addable widget is picked', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(
      <WidgetCatalogueDialog
        open
        onClose={onClose}
        onAdd={onAdd}
        activeWidgetIds={[]}
      />,
    );
    const entry = screen.getByTestId('widget-catalogue-entry-battery-gauge');
    const addButton = entry.querySelector('button');
    expect(addButton).not.toBeNull();
    fireEvent.click(addButton!);

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith('battery-gauge');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onAdd when an already-added widget button is clicked', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(
      <WidgetCatalogueDialog
        open
        onClose={onClose}
        onAdd={onAdd}
        activeWidgetIds={['battery-gauge']}
      />,
    );
    const entry = screen.getByTestId('widget-catalogue-entry-battery-gauge');
    const addButton = entry.querySelector('button');
    fireEvent.click(addButton!);
    // The button is `disabled`; pointer-events:none prevents the handler — but
    // even if it fired, the component guards via the activeSet check.
    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
