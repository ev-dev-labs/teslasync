import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui';
import { PageActions } from './PageActions';

describe('PageActions', () => {
  it('renders semantic action groups in the canonical DOM order', () => {
    const { container } = render(
      <>
        <PageActions
          metadata={<span>Fresh</span>}
          context={<Button variant="ghost">Vehicle</Button>}
          secondary={<Button variant="secondary">Compare</Button>}
          destructive={<Button variant="danger">Remove</Button>}
          overflow={<Button variant="ghost">More</Button>}
          primary={<Button>Sync</Button>}
        />
      </>,
    );

    const rail = container.querySelector('[data-role="page-actions"]');
    expect(rail).toHaveAccessibleName('Actions');
    expect(
      Array.from(rail?.querySelectorAll('[data-action-group]') ?? [])
        .map((group) => group.getAttribute('data-action-group')),
    ).toEqual([
      'metadata',
      'context',
      'secondary',
      'destructive',
      'overflow',
      'primary',
    ]);
    expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument();
  });

  it('omits empty zones instead of reserving action-bar space', () => {
    const { container } = render(
      <PageActions context={<span>Range</span>} />,
    );

    expect(container.querySelector('[data-action-zone="context"]')).toBeInTheDocument();
    expect(container.querySelector('[data-action-zone="commands"]')).not.toBeInTheDocument();
  });

  it('renders nothing when no action group has content', () => {
    const { container } = render(<PageActions />);
    expect(container).toBeEmptyDOMElement();
  });
});
