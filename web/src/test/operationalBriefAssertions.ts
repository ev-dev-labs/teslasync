import { fireEvent, screen, within } from '@testing-library/react';
import { expect } from 'vitest';

/** Assert the actual disclosure, keeping card values available for separate checks. */
export function assertOperationalBriefDisclosure(
  target: Element | null,
  expected: string,
  options: { absent?: boolean; contains?: boolean } = {},
) {
  if (!(target instanceof HTMLElement)) throw new Error('Expected an evidence-card assertion target');
  const briefs = target.matches('[data-operational-brief]')
    ? [target] : [...target.querySelectorAll<HTMLElement>('[data-operational-brief]')];
  expect(briefs, 'Scope the disclosure assertion to exactly one evidence card').toHaveLength(1);
  expect(screen.queryByRole('dialog'), 'Finish any open interaction before inspecting evidence').not.toBeInTheDocument();
  fireEvent.click(within(briefs[0]).getByRole('button', { name: 'Review details' }));
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
