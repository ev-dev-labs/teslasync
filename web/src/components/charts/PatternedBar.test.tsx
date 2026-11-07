import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PatternedBar } from './PatternedBar';

it('keeps independently coloured bars bound to their own patterns across updates', () => {
  const tree = (fill: string) => <svg>
    <PatternedBar x={10} y={5} width={20} height={40} fill={fill} />
    <PatternedBar x={40} y={15} width={20} height={30} fill="var(--semantic-info)" />
  </svg>;
  const view = render(tree('var(--theme-primary)'));
  const ids = [...view.container.querySelectorAll('pattern')].map(pattern => pattern.id);
  expect(new Set(ids).size).toBe(2);
  expect([...view.container.querySelectorAll('.recharts-rectangle')].map(bar => bar.getAttribute('fill')))
    .toEqual(ids.map(id => `url(#${id})`));
  view.rerender(tree('var(--theme-accent)'));
  const patterns = view.container.querySelectorAll('pattern');
  expect(patterns[0].id).toBe(ids[0]);
  expect(patterns[0].querySelector('rect')).toHaveAttribute('fill', 'var(--theme-accent)');
  expect(patterns[1].querySelector('rect')).toHaveAttribute('fill', 'var(--semantic-info)');
});
