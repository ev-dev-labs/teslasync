import { fireEvent, screen, within } from '@testing-library/react';
import { expect } from 'vitest';

function oneBrief(target: Element | null) {
  if (!(target instanceof HTMLElement)) throw new Error('Expected an evidence-card assertion target');
  const briefs = target.matches('[data-operational-brief]')
    ? [target] : [...target.querySelectorAll<HTMLElement>('[data-operational-brief]')];
  expect(briefs, 'Scope the assertion to exactly one evidence card').toHaveLength(1);
  return briefs[0];
}

/** Assert the actual disclosure, keeping card values available for separate checks. */
export function assertOperationalBriefDisclosure(
  target: Element | null,
  expected: string,
  options: { absent?: boolean; contains?: boolean } = {},
) {
  const brief = oneBrief(target);
  expect(screen.queryByRole('dialog'), 'Finish any open interaction before inspecting evidence').not.toBeInTheDocument();
  fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
  const dialog = screen.getByRole('dialog');
  try {
    const header = dialog.querySelector<HTMLElement>('[data-drawer-header]');
    if (!header) throw new Error('The real evidence drawer must expose its header');
    if (options.contains) {
      if (options.absent) expect(header).not.toHaveTextContent(expected);
      else expect(header).toHaveTextContent(expected);
    } else if (options.absent) {
      expect(within(header).queryByText(expected)).not.toBeInTheDocument();
    } else {
      expect(within(header).getByText(expected)).toBeInTheDocument();
    }
  } finally {
    fireEvent.keyDown(dialog, { key: 'Escape' });
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}

/** Missing fields are omitted; this asserts their absence without fabricating a value. */
export function assertOperationalMetricUnavailable(target: Element | null, label: string) {
  const brief = oneBrief(target);
  expect(within(brief).queryByText(label, { selector: '[data-operational-metric] > :first-child' })).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
  const dialog = screen.getByRole('dialog');
  try {
    expect(within(dialog).queryByRole('group', { name: label })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/^\d+ empty fields? (?:is|are) hidden\.$/)).toBeInTheDocument();
  } finally {
    fireEvent.keyDown(dialog, { key: 'Escape' });
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}
