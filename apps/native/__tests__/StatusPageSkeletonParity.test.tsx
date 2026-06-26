import React from 'react';
import {StyleSheet, View} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import {GlassPanel} from '../src/components/ui/GlassPanel';
import {colors} from '../src/theme/tokens';
import {StatusPageSkeleton} from '../src/web-parity/features/system/components/status/StatusPageSkeleton';

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<StatusPageSkeleton />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

describe('StatusPageSkeleton (native parity)', () => {
  it('exposes the loading/busy accessibility contract (role=status, aria-busy, aria-label, data-testid)', async () => {
    const tree = await render();
    const root = tree.root.findByProps({testID: 'status-page-skeleton'});

    expect(root.props.accessibilityRole).toBe('progressbar');
    expect(root.props.accessibilityState).toEqual({busy: true});
    expect(root.props.accessibilityLabel).toBe('Loading system status');
  });

  it('renders every section so there is no layout shift once data loads', async () => {
    const tree = await render();

    // hero + health + action items + resources + 4 accordion stubs = 8 panels.
    expect(tree.root.findAllByType(GlassPanel)).toHaveLength(8);

    // Each Skeleton placeholder is the only View tinted with surfaceRaised:
    //   hero 4 + chips 8 + health (1 title + 6 rows) + actions (1 + 2) +
    //   resources (1 + 5) + accordions 4*(1+2+1) = 4+8+7+3+6+16 = 44.
    const skeletons = tree.root.findAllByType(View).filter(node => {
      const flat = StyleSheet.flatten(node.props.style) as
        | {backgroundColor?: string}
        | undefined;
      return flat?.backgroundColor === colors.surfaceRaised;
    });
    expect(skeletons).toHaveLength(44);
  });
});
