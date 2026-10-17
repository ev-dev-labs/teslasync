import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { completionCopy as c } from './completionCopy';
import { EvidenceFixtures } from './EvidenceFixtures';
import { SelectionFixtures } from './SelectionFixtures';
import { WidgetFixtures } from './WidgetFixtures';

afterEach(cleanup);

describe('prepared selection and evidence fixtures', () => {
  it('preserves explicit day callback order, disabled days and empty selection', () => {
    render(<SelectionFixtures />);
    const days = screen.getByRole('group', { name: c.days });
    expect(within(days).getAllByRole('button').map(button => button.getAttribute('aria-label')))
      .toEqual([c.monday, c.wednesday, c.friday, c.sunday]);
    fireEvent.click(within(days).getByRole('button', { name: c.sunday }));
    expect(screen.getByText(c.selectedDays.replace('{{ids}}', '3, 1, 0'))).toBeInTheDocument();
    expect(within(days).getByRole('button', { name: c.friday })).toBeDisabled();
    expect(within(screen.getByRole('group', { name: c.disabledDays })).getAllByRole('button')
      .every(button => button.hasAttribute('disabled'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: c.clearDays }));
    expect(screen.getByText(c.none)).toBeInTheDocument();
    expect(within(days).getAllByRole('button').every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('renders pressed filters separately from roving tabs and skips disabled tabs', () => {
    render(<SelectionFixtures />);
    const filters = screen.getByRole('group', { name: c.filters });
    const filter = within(filters).getByRole('button', { name: new RegExp(c.unresolved) });
    fireEvent.click(filter);
    expect(filter).toHaveAttribute('aria-pressed', 'true');
    expect(filter).not.toHaveAttribute('aria-selected');
    const tabs = screen.getByRole('tablist', { name: c.tabs });
    const selected = within(tabs).getByRole('tab', { selected: true });
    fireEvent.keyDown(selected, { key: 'ArrowRight' });
    expect(within(tabs).getByRole('tab', { selected: true })).toHaveTextContent(c.all);
    expect(within(tabs).getByRole('tab', { name: c.unavailable })).toBeDisabled();
  });

  it('keeps tiny and zero legend evidence and rich unknown/zero details', () => {
    const { container } = render(<EvidenceFixtures />);
    const rails = screen.getAllByRole('img');
    expect(rails.map(rail => rail.getAttribute('aria-label'))).toEqual([c.compositionSummary, c.zeroSummary]);
    expect(rails[0].querySelectorAll('span')).toHaveLength(3);
    expect(screen.getAllByText(c.tiny)).toHaveLength(2);
    expect(screen.getByText(c.count1)).toBeInTheDocument();
    expect(container.querySelectorAll('dl')).toHaveLength(2);
    expect(screen.getAllByText(c.unknown)).toHaveLength(2);
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.getAllByText(c.note)).toHaveLength(2);
  });

  it('renders real nullable gauges and source-ranked rich rows, then switches order', () => {
    render(<WidgetFixtures />);
    const unknown = screen.getByRole('group', { name: c.gaugeUnknown });
    expect(unknown).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByRole('meter', { name: c.gaugeZero })).toHaveAttribute('aria-valuenow', '0');
    const interval = screen.getByRole('meter', { name: c.gaugeInterval });
    expect(interval).toHaveAttribute('aria-valuemin', '20');
    expect(interval).toHaveAttribute('aria-valuemax', '80');
    const invalid = screen.getByRole('group', { name: c.gaugeInvalid });
    expect(invalid).not.toHaveAttribute('aria-valuenow');
    expect(within(invalid).getByText('40', { exact: true })).toBeInTheDocument();
    const ranked = screen.getAllByRole('list')[0];
    expect(within(ranked).getAllByRole('listitem')[0]).toHaveTextContent(c.rankUnknown);
    fireEvent.click(screen.getByRole('button', { name: c.magnitudeOrder }));
    expect(within(ranked).getAllByRole('listitem')[0]).toHaveTextContent(c.rankPositive);
    expect(within(ranked).getAllByRole('listitem')[3]).toHaveTextContent(c.rankUnknown);
  });
});
