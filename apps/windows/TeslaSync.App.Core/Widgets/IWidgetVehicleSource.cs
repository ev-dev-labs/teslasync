namespace TeslaSync.App.Core.Widgets;

/// <summary>
/// Supplies the widget surface (P2/W8-0003) with a vehicle snapshot to project. Implementations read
/// already-fetched state — the W5 response cache and the W6 in-process live store — and never open a
/// network request or an SSE stream, so a widget refresh is instant and holds no background connection.
/// </summary>
public interface IWidgetVehicleSource
{
    /// <summary>The snapshot for the primary (first non-archived) vehicle, or null when none is cached.</summary>
    Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default);

    /// <summary>The snapshot for a specific vehicle, or null when nothing is cached for it.</summary>
    Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default);
}
