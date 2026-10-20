import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReferenceTabs } from './ReferenceTabs';

describe('reference tabs', () => {
  it('provides six real topics with matching panel IDs and one selected panel', () => {
    render(<ReferenceTabs />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(6);
    tabs.forEach(tab => {
      const id = tab.getAttribute('aria-controls')!;
      const panel = document.getElementById(id)!;
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
      expect(panel.textContent?.length).toBeGreaterThan(20);
    });
    fireEvent.click(tabs[5]);
    expect(tabs[5]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Human reference and per-page plan approvals remain required.');
  });
});
