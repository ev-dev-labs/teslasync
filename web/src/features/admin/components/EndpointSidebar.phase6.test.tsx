import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EndpointSidebar, { type ParsedEndpoint } from './EndpointSidebar';

function endpoint(overrides: Partial<ParsedEndpoint> = {}): ParsedEndpoint {
  return {
    method: 'GET',
    path: '/vehicles',
    tag: 'Vehicles',
    summary: 'List vehicles',
    description: '',
    operationId: 'listVehicles',
    parameters: [],
    responses: {},
    ...overrides,
  };
}

const getVehicles = endpoint();
const postVehicles = endpoint({
  method: 'POST',
  summary: 'Create vehicle',
  operationId: 'createVehicle',
});
const endpoints = [getVehicles, postVehicles];
const fetchRequest = vi.fn();

beforeEach(() => {
  fetchRequest.mockReset();
  vi.stubGlobal('fetch', fetchRequest);
});

afterEach(() => {
  cleanup();
  try {
    expect(fetchRequest).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

describe('EndpointSidebar phase6 selected semantics', () => {
  it('exposes exactly the current method/path without changing names or button roles', () => {
    render(
      <EndpointSidebar endpoints={endpoints} selected={{ ...postVehicles }} onSelect={vi.fn()} />,
    );

    expect(screen.getAllByRole('button', { current: true })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'POST /vehicles', current: true }))
      .toHaveAttribute('aria-current', 'true');
    const other = screen.getByRole('button', { name: 'GET /vehicles' });
    expect(other).not.toHaveAttribute('aria-current');
    expect(other).not.toHaveAttribute('aria-selected');
    expect(other).not.toHaveAttribute('aria-pressed');
    const group = screen.getByRole('button', { name: 'Vehicles 2' });
    expect(group).toHaveAttribute('aria-expanded', 'true');
    expect(group).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('follows controlled selection changes and clears current state for null or unmatched selection', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <EndpointSidebar endpoints={endpoints} selected={null} onSelect={onSelect} />,
    );
    expect(screen.queryAllByRole('button', { current: true })).toHaveLength(0);

    for (const selected of [getVehicles, postVehicles]) {
      rerender(<EndpointSidebar endpoints={endpoints} selected={selected} onSelect={onSelect} />);
      expect(screen.getAllByRole('button', { current: true })).toHaveLength(1);
      expect(screen.getByRole('button', { name: `${selected.method} ${selected.path}`, current: true }))
        .toBeInTheDocument();
    }

    for (const selected of [null, endpoint({ path: '/unknown' })]) {
      rerender(<EndpointSidebar endpoints={endpoints} selected={selected} onSelect={onSelect} />);
      expect(screen.queryAllByRole('button', { current: true })).toHaveLength(0);
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps pointer selection callback-only until the parent supplies selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(
      <EndpointSidebar endpoints={endpoints} selected={getVehicles} onSelect={onSelect} />,
    );
    const post = screen.getByRole('button', { name: 'POST /vehicles' });
    await user.click(post);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(postVehicles);
    expect(post).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'GET /vehicles', current: true })).toBeInTheDocument();

    rerender(<EndpointSidebar endpoints={endpoints} selected={postVehicles} onSelect={onSelect} />);
    expect(post).toHaveAttribute('aria-current', 'true');
    expect(post).toHaveFocus();
    await user.click(post);
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith(postVehicles);
    expect(post).toHaveAttribute('aria-current', 'true');
  });

  it.each([['Enter', '{Enter}'], ['Space', ' ']])(
    'retains Tab reachability and %s selection without sending requests',
    async (_name, key) => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      function ControlledSidebar() {
        const [selected, setSelected] = useState<ParsedEndpoint | null>(getVehicles);
        return (
          <EndpointSidebar
            endpoints={endpoints}
            selected={selected}
            onSelect={ep => { onSelect(ep); setSelected(ep); }}
          />
        );
      }
      render(<ControlledSidebar />);
      await user.tab();
      expect(screen.getByRole('textbox', { name: 'Search endpoints...' })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Vehicles 2' })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'GET /vehicles' })).toHaveFocus();
      await user.tab();
      const post = screen.getByRole('button', { name: 'POST /vehicles' });
      expect(post).toHaveFocus();
      await user.keyboard(key);
      expect(onSelect).toHaveBeenCalledExactlyOnceWith(postVehicles);
      expect(post).toHaveAttribute('aria-current', 'true');
      expect(post).toHaveFocus();
    },
  );

  it('retains keyboard group disclosure and current state after reopening', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<EndpointSidebar endpoints={endpoints} selected={postVehicles} onSelect={onSelect} />);
    await user.tab();
    await user.tab();
    const group = screen.getByRole('button', { name: 'Vehicles 2' });
    await user.keyboard('{Enter}');
    expect(group).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'POST /vehicles' })).not.toBeInTheDocument();
    await user.keyboard(' ');
    expect(group).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'POST /vehicles', current: true })).toBeInTheDocument();
    expect(group).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('reveals a newly selected endpoint in a collapsed group without selecting or sending again', () => {
    const many = Array.from({ length: 6 }, (_, i) => endpoint({ tag: `Tag${i}`, path: `/p${i}` }));
    const onSelect = vi.fn();
    const { rerender } = render(
      <EndpointSidebar endpoints={many} selected={null} onSelect={onSelect} />,
    );
    expect(screen.getByRole('button', { name: 'Tag3 1' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'GET /p3' })).not.toBeInTheDocument();
    rerender(<EndpointSidebar endpoints={many} selected={many[3]} onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'Tag3 1' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'GET /p3', current: true })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('retains filtering, counts and the empty state without losing the controlled selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<EndpointSidebar endpoints={endpoints} selected={postVehicles} onSelect={onSelect} />);
    const search = screen.getByRole('textbox', { name: 'Search endpoints...' });
    await user.type(search, 'listVehicles');
    expect(screen.getByText('1 endpoints')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { current: true })).toHaveLength(0);
    await user.clear(search);
    expect(screen.getByText('2 endpoints')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'POST /vehicles', current: true })).toBeInTheDocument();
    await user.type(search, 'no-such-endpoint');
    expect(screen.getByText('0 endpoints')).toBeInTheDocument();
    expect(screen.getByText('No matching endpoints')).toBeInTheDocument();
    await user.clear(search);
    expect(screen.getByRole('button', { name: 'POST /vehicles', current: true })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
