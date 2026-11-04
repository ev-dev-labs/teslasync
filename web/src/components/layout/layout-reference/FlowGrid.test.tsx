import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FlowGrid } from './FlowGrid';

const allocation = vi.hoisted(() => ({ width: 842 }));
vi.mock('./useContainerWidth', () => ({
  useContainerWidth: () => ({ ref: vi.fn(), width: allocation.width }),
}));

describe('shared readable sequence allocation', () => {
  it('keeps all nodes and connectors ordered while switching only when every cell fits the shared 200px floor', () => {
    const view = <FlowGrid>{['Grid', 'Charging', 'Battery', 'Driving', 'Motor'].map(label => <div key={label}>{label}</div>)}</FlowGrid>;
    const { container, rerender } = render(view);
    expect(container.firstElementChild).toHaveAttribute('data-flow-axis', 'column');
    expect([...container.firstElementChild!.children].map(cell => cell.textContent))
      .toEqual(['Grid', 'Charging', 'Battery', 'Driving', 'Motor']);
    allocation.width = 1047;
    rerender(<FlowGrid>{view.props.children}</FlowGrid>);
    expect(container.firstElementChild).toHaveAttribute('data-flow-axis', 'column');
    allocation.width = 1048;
    rerender(<FlowGrid>{view.props.children}</FlowGrid>);
    expect(container.firstElementChild).toHaveAttribute('data-flow-axis', 'row');
    expect(screen.getByText('Battery')).toBeVisible();
  });
});
