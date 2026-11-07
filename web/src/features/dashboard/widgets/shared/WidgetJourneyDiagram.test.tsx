import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WidgetJourneyDiagram } from './WidgetJourneyDiagram';

describe('shared journey schematic', () => {
  it('preserves actual endpoints without pretending the connection is recorded geometry', () => {
    const { container } = render(<WidgetJourneyDiagram start="Fixture home" end="Fixture charger" />);
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Fixture home → Fixture charger. Schematic connection, not recorded route geometry.',
    );
    expect(screen.getByText('Fixture home')).toBeVisible();
    expect(screen.getByText('Fixture charger')).toBeVisible();
    expect(container.querySelectorAll('[data-flow-edge]')).toHaveLength(1);
    expect(container.querySelector('.flow-active')).toBeNull();
  });

  it('leaves a missing destination unresolved without fabricating a round trip', () => {
    const { container } = render(<WidgetJourneyDiagram start="Fixture departure" end={null} />);
    expect(screen.getByText('—')).toBeVisible();
    expect(container.querySelector('[data-flow-edge]')).toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Fixture departure → —. Schematic connection, not recorded route geometry.',
    );
  });
});
