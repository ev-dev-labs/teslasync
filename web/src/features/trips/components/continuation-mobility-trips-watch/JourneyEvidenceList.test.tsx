import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { JourneyEvidenceList } from './JourneyEvidenceList';

describe('JourneyEvidenceList', () => {
  it('preserves every evidence line in supplied order and retains wrap-safe typography', () => {
    const evidence = ['first source fact', 'a-long-unbroken-source-reference', 'last source fact'];
    render(<JourneyEvidenceList evidence={evidence} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(evidence.length);
    items.forEach((item, index) => {
      expect(item).toHaveTextContent(`· ${evidence[index]}`);
      expect(item).toHaveClass('break-words');
    });
  });

  it('does not fabricate evidence when there are no source facts', () => {
    render(<JourneyEvidenceList evidence={[]} />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
