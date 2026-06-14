using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// The typed write payload for a geofence create / update — the native mirror of the web <c>GeofencePayload</c>
/// (web/src/features/maps/schemas/geofence.ts <c>toGeofencePayload</c>) plus the page's <c>costPerKwh: null</c>
/// addition (web GeofencesPage <c>handleSubmit</c>). Coordinates / radius are SI numbers; the alert posture is
/// expanded back into the two wire booleans. Pure data.
/// </summary>
public sealed record GeofenceWrite(
    string Name,
    double Latitude,
    double Longitude,
    double Radius,
    bool AlertOnEntry,
    bool AlertOnExit,
    bool Enabled)
{
    /// <summary>Build a write payload from a validated form snapshot (web <c>toGeofencePayload(parsed.data)</c>).</summary>
    public static GeofenceWrite FromForm(GeofenceFormState form)
    {
        ArgumentNullException.ThrowIfNull(form);
        var kind = form.AlertType;
        return new GeofenceWrite(
            Name: form.Name.Trim(),
            Latitude: ParseDouble(form.Latitude),
            Longitude: ParseDouble(form.Longitude),
            Radius: ParseDouble(form.Radius),
            AlertOnEntry: kind is GeofenceAlertKind.Entry or GeofenceAlertKind.Both,
            AlertOnExit: kind is GeofenceAlertKind.Exit or GeofenceAlertKind.Both,
            Enabled: form.Enabled);
    }

    /// <summary>Build a full write payload from an existing geofence with a new name (web inline rename merge).</summary>
    public static GeofenceWrite FromRename(Geofence geofence, string name)
    {
        ArgumentNullException.ThrowIfNull(geofence);
        return new GeofenceWrite(
            Name: (name ?? string.Empty).Trim(),
            Latitude: geofence.Latitude,
            Longitude: geofence.Longitude,
            Radius: geofence.Radius,
            AlertOnEntry: geofence.AlertOnEntry,
            AlertOnExit: geofence.AlertOnExit,
            Enabled: geofence.Enabled);
    }

    /// <summary>
    /// The camelCase JSON body the web sends and the Go handler honours
    /// (internal/api/geofence/handler.go <c>geofenceCreateRequest</c>: camelCase wins). Mirrors the web body
    /// <c>{ ...toGeofencePayload(data), costPerKwh: null }</c>.
    /// </summary>
    public IReadOnlyDictionary<string, object?> ToBody() => new Dictionary<string, object?>(StringComparer.Ordinal)
    {
        ["name"] = Name,
        ["latitude"] = Latitude,
        ["longitude"] = Longitude,
        ["radius"] = Radius,
        ["alertOnEntry"] = AlertOnEntry,
        ["alertOnExit"] = AlertOnExit,
        ["enabled"] = Enabled,
        ["costPerKwh"] = null,
    };

    private static double ParseDouble(string value) =>
        double.TryParse((value ?? string.Empty).Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) ? n : 0;
}

/// <summary>
/// The data port the <see cref="GeofencesPageViewModel"/> reads the list / vehicles / pins through and writes
/// the create / update / toggle / delete / bulk-delete mutations back through — the native parity of the web
/// hooks the page binds (web/src/features/maps/pages/GeofencesPage.tsx): <c>useQuery(['geofences'])</c>,
/// <c>useVehicles</c>, <c>usePinned('geofence')</c>, the create / update / delete / toggle mutations and
/// <c>useBulkGeofencesDelete</c>. The view never performs HTTP itself; the default
/// <see cref="EmptyGeofencesFeed"/> resolves to the empty state and the generated-client-backed
/// <see cref="GeofencesClientFeed"/> binds to the <c>/geofences</c> endpoints (ADR-004).
/// </summary>
public interface IGeofencesFeed
{
    /// <summary>Resolve the current geofence list (web <c>useQuery(['geofences']) → GET /geofences</c>).</summary>
    Task<IReadOnlyList<Geofence>> FetchGeofencesAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the vehicle list for the location picker (web <c>useVehicles → GET /vehicles</c>).</summary>
    Task<IReadOnlyList<GeofenceVehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the geofence pins for list ordering (web <c>usePinned('geofence') → GET /pinned</c>).</summary>
    Task<IReadOnlyList<GeofencePin>> FetchPinnedAsync(CancellationToken cancellationToken);

    /// <summary>Resolve a vehicle's latest position to seed the form (web <c>GET /vehicles/{id}/positions?limit=1</c>).</summary>
    Task<GeofencePosition?> FetchLatestPositionAsync(long vehicleId, CancellationToken cancellationToken);

    /// <summary>Create a geofence (web <c>createMut → POST /geofences</c>).</summary>
    Task CreateAsync(GeofenceWrite write, CancellationToken cancellationToken);

    /// <summary>Update a geofence with a full payload (web <c>updateMut / renameMut → PUT /geofences/{id}</c>).</summary>
    Task UpdateAsync(long id, GeofenceWrite write, CancellationToken cancellationToken);

    /// <summary>Toggle a geofence's enabled flag with a partial body (web <c>toggleMut → PUT /geofences/{id}</c> with <c>{ enabled }</c>).</summary>
    Task ToggleAsync(long id, bool enabled, CancellationToken cancellationToken);

    /// <summary>Delete a single geofence (web <c>deleteMut → DELETE /geofences/{id}</c>).</summary>
    Task DeleteAsync(long id, CancellationToken cancellationToken);

    /// <summary>Bulk-delete geofences (web <c>useBulkGeofencesDelete → POST /geofences/bulk</c> with <c>{ ids, op: 'delete' }</c>).</summary>
    Task BulkDeleteAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to no data and no-ops every mutation (the empty data state).</summary>
public sealed class EmptyGeofencesFeed : IGeofencesFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyGeofencesFeed Instance { get; } = new();

    private EmptyGeofencesFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<Geofence>> FetchGeofencesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<Geofence>>(Array.Empty<Geofence>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<GeofenceVehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<GeofenceVehicleOption>>(Array.Empty<GeofenceVehicleOption>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<GeofencePin>> FetchPinnedAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<GeofencePin>>(Array.Empty<GeofencePin>());
    }

    /// <inheritdoc />
    public Task<GeofencePosition?> FetchLatestPositionAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<GeofencePosition?>(null);
    }

    /// <inheritdoc />
    public Task CreateAsync(GeofenceWrite write, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task UpdateAsync(long id, GeofenceWrite write, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task ToggleAsync(long id, bool enabled, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task DeleteAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task BulkDeleteAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }
}

/// <summary>
/// The generated-client-backed <see cref="IGeofencesFeed"/> — the native data adapter for the geofences surface.
/// It binds to the generated OpenAPI contract client (ADR-004): <c>GET /geofences</c> for the list (web
/// <c>useQuery(['geofences'])</c>), <c>GET /vehicles</c> + <c>GET /pinned?type=geofence</c> for the picker and
/// pin ordering, <c>GET /vehicles/{id}/positions?limit=1</c> for the "use current location" seed,
/// <c>POST /geofences</c> + <c>PUT /geofences/{id}</c> + <c>DELETE /geofences/{id}</c> for the single mutations
/// (sending the camelCase body the Go handler honours), and <c>POST /geofences/bulk</c> with
/// <c>{ ids, op: 'delete' }</c> for the bulk delete (web <c>useBulkGeofencesDelete</c>). No HTTP touches the
/// view; the list JSON round-trips through the tolerant <see cref="Geofence.ParseList"/> parser so the
/// snake_case wire shape is preserved losslessly.
/// </summary>
public sealed class GeofencesClientFeed : IGeofencesFeed
{
    private const string TypeQueryParam = "type";
    private const string LimitQueryParam = "limit";
    private const string GeofencePinType = "geofence";
    private const string VehicleIdPathParam = "vehicleID";
    private const string GeofenceIdPathParam = "geofenceID";

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public GeofencesClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<Geofence>> FetchGeofencesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(GeofencesRegistration.ListOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return Geofence.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<GeofenceVehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(GeofencesRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return GeofenceVehicleOption.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<GeofencePin>> FetchPinnedAsync(CancellationToken cancellationToken)
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal) { [TypeQueryParam] = GeofencePinType };
        var request = new ApiRequest(GeofencesRegistration.PinnedOperation, Query: query);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return GeofencePin.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<GeofencePosition?> FetchLatestPositionAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            GeofencesRegistration.PositionsOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehicleIdPathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            },
            Query: new Dictionary<string, object?>(StringComparer.Ordinal) { [LimitQueryParam] = 1 });

        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return GeofencePosition.FirstFrom(json);
    }

    /// <inheritdoc />
    public async Task CreateAsync(GeofenceWrite write, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(write);
        var request = new ApiRequest(GeofencesRegistration.CreateOperation, Body: write.ToBody());
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task UpdateAsync(long id, GeofenceWrite write, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(write);
        var request = new ApiRequest(
            GeofencesRegistration.UpdateOperation,
            PathParams: GeofencePath(id),
            Body: write.ToBody());
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task ToggleAsync(long id, bool enabled, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            GeofencesRegistration.UpdateOperation,
            PathParams: GeofencePath(id),
            Body: new Dictionary<string, object?>(StringComparer.Ordinal) { ["enabled"] = enabled });
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task DeleteAsync(long id, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(GeofencesRegistration.DeleteOperation, PathParams: GeofencePath(id));
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task BulkDeleteAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(ids);
        var request = new ApiRequest(
            GeofencesRegistration.BulkDeleteOperation,
            Body: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["ids"] = ids,
                ["op"] = "delete",
            });
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    private static Dictionary<string, string> GeofencePath(long id) => new(StringComparer.Ordinal)
    {
        [GeofenceIdPathParam] = id.ToString(CultureInfo.InvariantCulture),
    };
}
