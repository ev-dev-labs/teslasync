import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui';
import { WorkspaceScopeProvider } from '@/hooks/useWorkspaceScope';
import {
  WORKSPACE_SCOPED_CONTROL,
  type WorkspaceScopedComponent,
} from '@/lib/workspaceScope';
import { PageActions } from './PageActions';

function VehicleScopeProbe() {
  return <button type="button">Duplicate vehicle</button>;
}

(VehicleScopeProbe as typeof VehicleScopeProbe & WorkspaceScopedComponent)[
  WORKSPACE_SCOPED_CONTROL
] = 'vehicle';

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

  it('removes nested page controls owned by the managed workspace', () => {
    const { container } = render(
      <WorkspaceScopeProvider scope={{ range: false, vehicle: true }}>
        <PageActions
          secondary={(
            <div>
              <VehicleScopeProbe />
            </div>
          )}
        />
      </WorkspaceScopeProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('preserves neighboring commands when pruning a duplicate scope control', () => {
    render(
      <WorkspaceScopeProvider scope={{ range: false, vehicle: true }}>
        <PageActions
          secondary={(
            <div>
              <VehicleScopeProbe />
              <Button>Refresh</Button>
            </div>
          )}
        />
      </WorkspaceScopeProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Duplicate vehicle' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});
