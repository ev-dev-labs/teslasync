import { fireEvent, render, screen } from '@testing-library/react';
import { createRef, type KeyboardEventHandler } from 'react';
import { describe, expect, it, vi } from 'vitest';
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
  it('opts into an unboxed scope row without changing the default rail', () => {
    const { container, rerender } = render(
      <PageActions layout="scope-first" metadata={<span>Fresh</span>}
        context={<Button>Day</Button>} overflow={<Button>Copy</Button>} />,
    );
    expect(container.querySelector('[data-role="page-actions"]')).toHaveClass('grid', 'border-0', 'bg-transparent');
    expect(container.querySelector('[data-action-group="context"]')).toHaveClass('sm:col-span-2', 'order-1');
    expect(container.querySelector('[data-action-group="metadata"]')).toHaveClass('order-2');
    expect(container.querySelector('[data-action-zone="commands"]')).toHaveClass('order-3');
    rerender(<PageActions context={<Button>Day</Button>} />);
    expect(container.querySelector('[data-role="page-actions"]')).not.toHaveClass('grid', 'border-0');
  });

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

  it('contains long content without hiding any mobile action group and uses logical alignment', () => {
    const { container } = render(
      <div dir="rtl">
        <PageActions
          layout="scope-first"
          metadata={<span>{'Long localized metadata '.repeat(12)}</span>}
          context={<Button wrapLabel>Independent context</Button>}
          secondary={<Button wrapLabel>Compare long localized records</Button>}
          destructive={<Button variant="danger">Remove</Button>}
          overflow={<Button>More</Button>}
          primary={<Button wrapLabel>Synchronize all selected records</Button>}
        />
      </div>,
    );
    expect(container.querySelector('[data-role="page-actions"]')).toHaveClass('grid-cols-1');
    expect(container.querySelector('[data-action-zone="commands"]')).toHaveClass('ms-auto', 'max-w-full');
    expect(container.querySelector('[data-action-zone="commands"]')).not.toHaveClass('ml-auto');
    for (const group of container.querySelectorAll('[data-action-group]')) {
      expect(group).toHaveClass('min-w-0', 'max-w-full', 'flex-wrap');
      expect(group).not.toHaveClass('hidden');
    }
    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(screen.getByText('Long localized metadata '.repeat(12).trim())).toBeInTheDocument();
  });

  it('preserves child refs, native attributes, links and keyboard callbacks while pruning', () => {
    const onRefresh = vi.fn();
    const onKeyDown = vi.fn<KeyboardEventHandler<HTMLButtonElement>>();
    const ref = createRef<HTMLButtonElement>();
    render(
      <WorkspaceScopeProvider scope={{ range: false, vehicle: true }}>
        <PageActions
          secondary={(
            <div>
              <VehicleScopeProbe />
              <Button ref={ref} type="button" name="refresh" onClick={onRefresh} onKeyDown={onKeyDown}>Refresh</Button>
              <a href="/drives" target="_blank" rel="noopener noreferrer">Drive details</a>
            </div>
          )}
          primary={<Button disabled>Sync</Button>}
        />
      </WorkspaceScopeProvider>,
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Refresh' }));
    expect(ref.current).toHaveAttribute('type', 'button');
    expect(ref.current).toHaveAttribute('name', 'refresh');
    ref.current?.focus();
    expect(ref.current).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Refresh' }), { key: 'Enter' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown.mock.calls[0]?.[0].key).toBe('Enter');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    const link = screen.getByRole('link', { name: 'Drive details' });
    link.focus();
    expect(link).toHaveFocus();
    expect(link).toHaveAttribute('href', '/drives');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: 'Sync' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Duplicate vehicle' })).toBeNull();
  });

  it('uses the named scope grid only at sm and preserves caller grid overrides', () => {
    const { container, rerender } = render(
      <PageActions layout="scope-first" context={<Button>Day</Button>} />,
    );
    const rail = container.querySelector('[data-role="page-actions"]');
    expect(rail).toHaveClass('grid', 'grid-cols-1', 'sm:grid-cols-page-actions-scope', 'xl:flex');
    expect(rail).not.toHaveClass('sm:grid-cols-[minmax(0,1fr)_auto]');
    rerender(
      <PageActions layout="scope-first" context={<Button>Day</Button>} className="sm:grid-cols-2" />,
    );
    expect(rail).toHaveClass('grid-cols-1', 'sm:grid-cols-2', 'xl:flex');
    expect(rail).not.toHaveClass('sm:grid-cols-page-actions-scope');
    rerender(
      <PageActions layout="scope-first" context={<Button>Day</Button>} className="sm:grid-cols-[1fr_2fr]" />,
    );
    expect(rail).toHaveClass('grid-cols-1', 'sm:grid-cols-[1fr_2fr]', 'xl:flex');
    expect(rail).not.toHaveClass('sm:grid-cols-page-actions-scope');
    rerender(<PageActions context={<Button>Day</Button>} />);
    expect(rail).not.toHaveClass('grid-cols-1', 'sm:grid-cols-page-actions-scope');
  });
});
