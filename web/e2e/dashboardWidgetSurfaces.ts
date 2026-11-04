import { expect, type Locator } from '@playwright/test';

export async function expectFlatWidgetSurfaces(panel: Locator) {
  const issues = await panel.locator([
    '.widget-stat-rail', '.widget-status-tile', '.widget-tip-card',
    '.widget-chart-well', '.widget-flow-frame',
    '.widget-gauge-hero > [role="meter"]',
    '[data-vehicle-studio]', '[data-climate-airflow]',
  ].join(',')).evaluateAll(nodes => nodes.flatMap(node => {
    const style = getComputedStyle(node);
    const extraSurface = style.backgroundColor !== 'rgba(0, 0, 0, 0)'
      || style.backgroundImage !== 'none' || style.boxShadow !== 'none'
      || style.borderLeftWidth !== '0px' || style.borderRightWidth !== '0px'
      || style.borderTopWidth !== '0px' || style.borderTopLeftRadius !== '0px';
    return extraSurface ? [{
      className: node.getAttribute('class'), background: style.backgroundColor,
      image: style.backgroundImage, shadow: style.boxShadow,
      border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      radius: style.borderTopLeftRadius,
    }] : [];
  }));
  expect(issues, 'Display instruments must share the widget surface; separators and semantic controls remain independent').toEqual([]);
}
