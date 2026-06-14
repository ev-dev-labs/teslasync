using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Forms;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The typed write payload for a guard-config save — the native mirror of the web
/// <c>useSetGuardConfig</c> body (web/src/api/hooks/useGuard.ts): <c>{ enabled, home_geofence_id,
/// sensitivity, auto_panic }</c>. Snake_case keys exactly as the Go handler expects (no camelCase). Pure data.
/// </summary>
public sealed record GuardConfigWrite(bool Enabled, long? HomeGeofenceId, string Sensitivity, bool AutoPanic)
{
    /// <summary>The snake_case JSON body the web POSTs (web <c>JSON.stringify(body)</c>).</summary>
    public IReadOnlyDictionary<string, object?> ToBody() => new Dictionary<string, object?>(StringComparer.Ordinal)
    {
        ["enabled"] = Enabled,
        ["home_geofence_id"] = HomeGeofenceId,
        ["sensitivity"] = Sensitivity,
        ["auto_panic"] = AutoPanic,
    };
}

/// <summary>
/// The data port the <see cref="GuardModePageViewModel"/> reads the guard state through and writes the
/// arm/disarm, settings, panic and acknowledge mutations back through — the native parity of the web hooks
/// the page binds (web/src/features/vehicle-systems/pages/GuardModePage.tsx): <c>useGuardConfig</c>,
/// <c>useGuardEvents</c>, <c>useVehicleState</c>, <c>useGeofences</c>, <c>useVehicles</c>,
/// <c>useSetGuardConfig</c>, <c>useGuardPanic</c> and <c>useAcknowledgeGuardEvent</c>. The view never performs
/// HTTP itself; the default <see cref="EmptyGuardModeFeed"/> resolves to the empty state and the
/// generated-client-backed <see cref="GuardModeClientFeed"/> binds to the guard endpoints (ADR-004).
/// </summary>
public interface IGuardModeFeed
{
    /// <summary>Resolve the guard configuration (web <c>useGuardConfig → GET /vehicles/{id}/guard</c>).</summary>
    Task<GuardConfig?> FetchConfigAsync(long vehicleId, CancellationToken cancellationToken);

    /// <summary>Resolve the guard events feed (web <c>useGuardEvents → GET /vehicles/{id}/guard/events</c>).</summary>
    Task<IReadOnlyList<GuardEvent>> FetchEventsAsync(long vehicleId, CancellationToken cancellationToken);

    /// <summary>Resolve the live vehicle state for the map + status card (web <c>useVehicleState → GET /vehicles/{id}/state</c>).</summary>
    Task<GuardVehicleState?> FetchVehicleStateAsync(long vehicleId, CancellationToken cancellationToken);

    /// <summary>Resolve the geofence list for the home-geofence picker + map circle (web <c>useGeofences → GET /geofences</c>).</summary>
    Task<IReadOnlyList<GuardGeofence>> FetchGeofencesAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the fleet for the scope picker (web <c>useSelectedVehicle</c>/<c>useVehicles → GET /vehicles</c>).</summary>
    Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Save the guard configuration (web <c>useSetGuardConfig → POST /vehicles/{id}/guard</c>).</summary>
    Task SetConfigAsync(long vehicleId, GuardConfigWrite write, CancellationToken cancellationToken);

    /// <summary>Trigger a panic alert (web <c>useGuardPanic → POST /vehicles/{id}/guard/panic</c>).</summary>
    Task PanicAsync(long vehicleId, CancellationToken cancellationToken);

    /// <summary>Acknowledge a guard event (web <c>useAcknowledgeGuardEvent → POST …/guard/events/{eventID}/acknowledge</c>).</summary>
    Task AcknowledgeAsync(long vehicleId, long eventId, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to no data and no-ops every mutation (the empty data state).</summary>
public sealed class EmptyGuardModeFeed : IGuardModeFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyGuardModeFeed Instance { get; } = new();

    private EmptyGuardModeFeed()
    {
    }

    /// <inheritdoc />
    public Task<GuardConfig?> FetchConfigAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<GuardConfig?>(null);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<GuardEvent>> FetchEventsAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<GuardEvent>>(Array.Empty<GuardEvent>());
    }

    /// <inheritdoc />
    public Task<GuardVehicleState?> FetchVehicleStateAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<GuardVehicleState?>(null);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<GuardGeofence>> FetchGeofencesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<GuardGeofence>>(Array.Empty<GuardGeofence>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<VehicleOption>>(Array.Empty<VehicleOption>());
    }

    /// <inheritdoc />
    public Task SetConfigAsync(long vehicleId, GuardConfigWrite write, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task PanicAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task AcknowledgeAsync(long vehicleId, long eventId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }
}

/// <summary>
/// The generated-client-backed <see cref="IGuardModeFeed"/> — the native data adapter for the guard surface.
/// It binds to the generated OpenAPI contract client (ADR-004) and composes the reads + writes the web page
/// issues: <c>GET /vehicles/{id}/guard</c>, <c>GET /vehicles/{id}/guard/events</c>,
/// <c>GET /vehicles/{id}/state</c>, <c>GET /geofences</c>, <c>GET /vehicles</c>,
/// <c>POST /vehicles/{id}/guard</c>, <c>POST /vehicles/{id}/guard/panic</c> and
/// <c>POST /vehicles/{id}/guard/events/{eventID}/acknowledge</c>. Each response round-trips through the
/// tolerant model parsers so the snake_case wire shape is preserved losslessly. No HTTP touches the view.
/// </summary>
public sealed class GuardModeClientFeed : IGuardModeFeed
{
    private const string VehiclePathParam = "vehicleID";
    private const string EventPathParam = "eventID";

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public GuardModeClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<GuardConfig?> FetchConfigAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(GuardModeRegistration.ConfigOperation, PathParams: VehiclePath(vehicleId));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return GuardConfig.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<GuardEvent>> FetchEventsAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(GuardModeRegistration.EventsOperation, PathParams: VehiclePath(vehicleId));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return GuardEvent.ParseEnvelope(json);
    }

    /// <inheritdoc />
    public async Task<GuardVehicleState?> FetchVehicleStateAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(GuardModeRegistration.StateOperation, PathParams: VehiclePath(vehicleId));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return GuardVehicleState.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<GuardGeofence>> FetchGeofencesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(GuardModeRegistration.GeofencesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return GuardGeofence.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(GuardModeRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ParseVehicles(json);
    }

    /// <inheritdoc />
    public async Task SetConfigAsync(long vehicleId, GuardConfigWrite write, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(write);
        var request = new ApiRequest(
            GuardModeRegistration.SetConfigOperation,
            PathParams: VehiclePath(vehicleId),
            Body: write.ToBody());
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task PanicAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(GuardModeRegistration.PanicOperation, PathParams: VehiclePath(vehicleId));
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task AcknowledgeAsync(long vehicleId, long eventId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            GuardModeRegistration.AcknowledgeOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
                [EventPathParam] = eventId.ToString(CultureInfo.InvariantCulture),
            });
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    private static Dictionary<string, string> VehiclePath(long vehicleId) => new(StringComparer.Ordinal)
    {
        [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
    };

    // web useVehicles select: a bare array, or { vehicles | data: [...] }. Map id + display_name + vin + model
    // into the picker-facing VehicleOption (the rest of the vehicle shape is unused by this page).
    private static List<VehicleOption> ParseVehicles(JsonElement element)
    {
        var rows = GuardModeJson.Array(element, "vehicles", "data", "items");
        var list = new List<VehicleOption>(rows.Count);
        foreach (var item in rows)
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            long id = GuardModeJson.GetLong(item, "id") ?? 0;
            if (id <= 0)
            {
                continue;
            }

            list.Add(new VehicleOption(
                Id: id,
                DisplayName: GuardModeJson.GetString(item, "display_name"),
                Vin: GuardModeJson.GetString(item, "vin"),
                Model: GuardModeJson.GetString(item, "model")));
        }

        return list;
    }
}
