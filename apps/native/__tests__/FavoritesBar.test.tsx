import React from 'react';
import {Text} from 'react-native';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import {
  FavoritesBar,
  type CommandDef,
} from '../src/web-parity/features/system/components/FavoritesBar';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function makeCommand(id: string, label: string): CommandDef {
  return {
    id,
    command: `${id}_cmd`,
    labelKey: `commands.${id}.label`,
    labelFallback: label,
    icon: '\u2605',
    category: 'vehicle',
    type: 'action',
  };
}

const HONK = makeCommand('honk', 'Honk Horn');
const FLASH = makeCommand('flash', 'Flash Lights');
const VENT = makeCommand('vent', 'Vent Windows');

let currentTree: Renderer | null = null;

function countTestID(tree: Renderer, testID: string): number {
  return tree.root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' && node.props.testID === testID,
  ).length;
}

function hasText(tree: Renderer, text: string): boolean {
  return JSON.stringify(tree.toJSON()).includes(text);
}

function render(props: React.ComponentProps<typeof FavoritesBar>): Renderer {
  let tree!: Renderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<FavoritesBar {...props} />);
  });
  currentTree = tree;
  return tree;
}

afterEach(() => {
  if (currentTree) {
    ReactTestRenderer.act(() => {
      currentTree?.unmount();
    });
    currentTree = null;
  }
});

describe('FavoritesBar (native parity)', () => {
  it('renders nothing when no favorites match', () => {
    const renderTile = jest.fn((cmd: CommandDef) => (
      <Text key={cmd.id} testID={`tile-${cmd.id}`}>
        {cmd.labelFallback}
      </Text>
    ));
    const tree = render({
      favorites: [],
      commands: [HONK, FLASH],
      renderTile,
    });

    expect(tree.toJSON()).toBeNull();
    expect(countTestID(tree, 'favorites-bar-root')).toBe(0);
    expect(renderTile).not.toHaveBeenCalled();
  });

  it('renders nothing when favorites reference no known commands', () => {
    const renderTile = jest.fn((cmd: CommandDef) => (
      <Text key={cmd.id}>{cmd.labelFallback}</Text>
    ));
    const tree = render({
      favorites: ['does-not-exist'],
      commands: [HONK, FLASH],
      renderTile,
    });

    expect(tree.toJSON()).toBeNull();
    expect(renderTile).not.toHaveBeenCalled();
  });

  it('renders the Quick Actions header with the favorite count', () => {
    const renderTile = (cmd: CommandDef) => (
      <Text key={cmd.id} testID={`tile-${cmd.id}`}>
        {cmd.labelFallback}
      </Text>
    );
    const tree = render({
      favorites: ['honk', 'vent'],
      commands: [HONK, FLASH, VENT],
      renderTile,
    });

    expect(countTestID(tree, 'favorites-bar-root')).toBe(1);
    expect(hasText(tree, 'Quick Actions')).toBe(true);
    // parenthesized count reflects only the matched favorites (2 of 3).
    // The "(" {n} ")" children render as discrete text segments, so assert on
    // the live count node's children rather than a contiguous "(2)" substring.
    const countNode = tree.root.find(
      (node: ReactTestInstance) =>
        node.props.testID === 'favorites-bar-count',
    );
    expect(countNode.props.children).toEqual(['(', 2, ')']);
    // decorative filled-star glyph
    expect(hasText(tree, '\u2605')).toBe(true);
  });

  it('renders a tile for each matched favorite (filtered + order preserved)', () => {
    const seen: string[] = [];
    const renderTile = (cmd: CommandDef) => {
      seen.push(cmd.id);
      return (
        <Text key={cmd.id} testID={`tile-${cmd.id}`}>
          {cmd.labelFallback}
        </Text>
      );
    };
    const tree = render({
      favorites: ['vent', 'honk'],
      commands: [HONK, FLASH, VENT],
      renderTile,
    });

    // only favorited commands render, in the order they appear in `commands`
    expect(seen).toEqual(['honk', 'vent']);
    expect(countTestID(tree, 'tile-honk')).toBe(1);
    expect(countTestID(tree, 'tile-vent')).toBe(1);
    expect(countTestID(tree, 'tile-flash')).toBe(0);
  });
});
