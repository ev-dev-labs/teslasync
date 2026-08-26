import { describe, expect, it } from 'vitest';
import { getWorkspaceRouteScope } from '../workspaceScope';

describe('getWorkspaceRouteScope', () => {
  it('enables both canonical controls on vehicle history pages', () => {
    expect(getWorkspaceRouteScope('/driving-dynamics')).toEqual({
      range: true,
      vehicle: true,
    });
    expect(getWorkspaceRouteScope('/charging?tab=sessions')).toEqual({
      range: true,
      vehicle: true,
    });
    expect(getWorkspaceRouteScope('/media-player')).toEqual({
      range: true,
      vehicle: true,
    });
  });

  it('shows only controls that affect the active page', () => {
    expect(getWorkspaceRouteScope('/battery')).toEqual({
      range: false,
      vehicle: true,
    });
    expect(getWorkspaceRouteScope('/api-logs')).toEqual({
      range: true,
      vehicle: false,
    });
    expect(getWorkspaceRouteScope('/power-flow')).toEqual({
      range: true,
      vehicle: false,
    });
  });

  it('keeps workflow and settings routes free of misleading global filters', () => {
    expect(getWorkspaceRouteScope('/settings/')).toEqual({
      range: false,
      vehicle: false,
    });
    expect(getWorkspaceRouteScope('/notifications/rules')).toEqual({
      range: false,
      vehicle: false,
    });
    expect(getWorkspaceRouteScope('/action-center')).toEqual({
      range: false,
      vehicle: false,
    });
    expect(getWorkspaceRouteScope('/signal-diff')).toEqual({
      range: false,
      vehicle: false,
    });
    expect(getWorkspaceRouteScope('/tesla-charging-history')).toEqual({
      range: true,
      vehicle: false,
    });
    expect(getWorkspaceRouteScope('/tesla-charging-sessions')).toEqual({
      range: true,
      vehicle: false,
    });
  });

  it('keeps detail-route vehicle context while hiding the global range', () => {
    expect(getWorkspaceRouteScope('/vehicles/42')).toEqual({
      range: false,
      vehicle: true,
    });
  });
});
