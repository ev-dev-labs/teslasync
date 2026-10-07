import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Button, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { PreservedPanelGrid } from './index';
import { installResizeHarness } from './resizeHarness';

afterEach(() => vi.unstubAllGlobals());

describe('live driving placement adapter', () => {
  it('keeps every panel, full fact and action mounted in source order across container bands', () => {
    const harness = installResizeHarness();
    const onExport = vi.fn();
    const { container } = render(
      <PreservedPanelGrid label="Driving evidence" items={[
        { id: 'journey', size: 'half', content: (
          <GlassPanel>
            <PanelTitle>Journey details</PanelTitle>
            <Text>Complete origin and destination metadata</Text>
            <Button onClick={onExport}>Export journey</Button>
          </GlassPanel>
        ) },
        { id: 'route', size: 'half', content: (
          <GlassPanel><PanelTitle>Route evidence</PanelTitle><Text>All route samples and legend</Text></GlassPanel>
        ) },
        { id: 'ledger', size: 'half', content: (
          <GlassPanel><PanelTitle>Energy ledger</PanelTitle><Text>Specialist explanation retained</Text></GlassPanel>
        ) },
      ]} />,
    );
    const panels = Array.from(container.querySelectorAll('[data-preserved-panel]'));
    const exportButton = screen.getByRole('button', { name: 'Export journey' });
    expect(harness.observerCount).toBe(1);
    for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920, 2560]) {
      harness.resize(width);
      expect(harness.observerCount).toBe(1);
      const band = width < 640 ? 'phone' : width < 1024 ? 'tablet' : width < 1600 ? 'desktop' : 'wide';
      expect(screen.getByRole('group', { name: 'Driving evidence' })).toHaveAttribute('data-container-band', band);
      expect(Array.from(container.querySelectorAll('[data-preserved-panel]'))).toEqual(panels);
      expect(panels.map(panel => panel.getAttribute('data-panel-span'))).toEqual(
        width < 640 ? ['1', '1', '1'] : width < 1024 ? ['6', '6', '6'] : ['6', '6', '12'],
      );
      expect(within(screen.getByRole('group', { name: 'Driving evidence' })).getAllByRole('heading').map(node => node.textContent))
        .toEqual(['Journey details', 'Route evidence', 'Energy ledger']);
      expect(screen.getByText('Complete origin and destination metadata')).toBeVisible();
      expect(screen.getByText('All route samples and legend')).toBeVisible();
      expect(screen.getByText('Specialist explanation retained')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Export journey' })).toBe(exportButton);
    }
    fireEvent.click(exportButton);
    expect(onExport).toHaveBeenCalledOnce();
    expect(container.querySelectorAll('[data-print-card]')).toHaveLength(3);
  });
});
