using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The data port the <c>DataRepairPage</c> reads and writes through — the native analogue of the web page's
/// <c>useQuery(['stale-sessions'])</c> read plus the six inline mutations (<c>updateMut</c> / <c>closeMut</c> /
/// <c>discardMut</c> for each of charging and drives). The view-model is the only consumer; implementations never touch
/// a WinUI type.
/// </summary>
public interface IDataRepairFeed
{
    /// <summary>Fetch the stale inventory (web <c>GET /data-repair/stale-sessions</c>).</summary>
    Task<StaleSessionsSnapshot> FetchStaleAsync(CancellationToken cancellationToken);

    /// <summary>Apply a partial update to a charging session (web <c>updateMut</c> PUT /data-repair/charging/{id}).</summary>
    Task UpdateChargingAsync(long id, ChargingRepairPayload payload, CancellationToken cancellationToken);

    /// <summary>Close a charging session (web <c>closeMut</c> POST /data-repair/charging/{id}/close).</summary>
    Task CloseChargingAsync(long id, CancellationToken cancellationToken);

    /// <summary>Discard a charging session (web <c>discardMut</c> DELETE /data-repair/charging/{id}).</summary>
    Task DiscardChargingAsync(long id, CancellationToken cancellationToken);

    /// <summary>Apply a partial update to a drive (web <c>updateMut</c> PUT /data-repair/drives/{id}).</summary>
    Task UpdateDriveAsync(long id, DriveRepairPayload payload, CancellationToken cancellationToken);

    /// <summary>Close a drive (web <c>closeMut</c> POST /data-repair/drives/{id}/close).</summary>
    Task CloseDriveAsync(long id, CancellationToken cancellationToken);

    /// <summary>Discard a drive (web <c>discardMut</c> DELETE /data-repair/drives/{id}).</summary>
    Task DiscardDriveAsync(long id, CancellationToken cancellationToken);
}

/// <summary>
/// The default no-backend repair feed the parameterless (shell-registered) <see cref="DataRepairPage"/> hosts itself
/// against — the local-state default, mirroring the other W7 pages' empty feeds. The inventory resolves to the empty
/// snapshot (driving the friendly "All sessions are complete" state) and the six mutations are inert. The
/// generated-client-backed source (<see cref="DataRepairClientFeed"/>) is wired separately from the shared data layer
/// (web's TanStack hooks); this feed keeps the page mountable without a backend.
/// </summary>
public sealed class EmptyDataRepairFeed : IDataRepairFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyDataRepairFeed Instance { get; } = new();

    private EmptyDataRepairFeed()
    {
    }

    /// <inheritdoc />
    public Task<StaleSessionsSnapshot> FetchStaleAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(StaleSessionsSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task UpdateChargingAsync(long id, ChargingRepairPayload payload, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(payload);
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task CloseChargingAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task DiscardChargingAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task UpdateDriveAsync(long id, DriveRepairPayload payload, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(payload);
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task CloseDriveAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task DiscardDriveAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }
}

/// <summary>
/// The generated-client-backed <see cref="IDataRepairFeed"/> — the native data adapter for the data-repair surface. It
/// binds to the generated OpenAPI contract client (ADR-004): <c>GET /data-repair/stale-sessions</c> for the inventory
/// (web <c>useQuery(['stale-sessions'])</c>), <c>PUT/POST/DELETE /data-repair/charging/{id}…</c> for the three charging
/// mutations and <c>PUT/POST/DELETE /data-repair/drive/{id}…</c> for the three drive mutations (web <c>updateMut</c> /
/// <c>closeMut</c> / <c>discardMut</c>). No HTTP touches the view; the inventory round-trips through the tolerant
/// <see cref="StaleSessionsSnapshot"/> parser, and each partial update posts the exact snake_case body the web hook
/// sends (only non-empty fields, so the backend preserves untouched columns). A non-success response surfaces as the
/// client's <see cref="ApiException"/> so the view-model can render the failure surface / error toast.
/// </summary>
public sealed class DataRepairClientFeed : IDataRepairFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public DataRepairClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<StaleSessionsSnapshot> FetchStaleAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(DataRepairRegistration.StaleSessionsOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return StaleSessionsSnapshot.FromJson(json);
    }

    /// <inheritdoc />
    public Task UpdateChargingAsync(long id, ChargingRepairPayload payload, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(payload);

        var body = new Dictionary<string, object?>(StringComparer.Ordinal);
        AddString(body, "end_ts", payload.EndTs);
        AddNumber(body, "total_energy_added_wh", payload.TotalEnergyAddedWh);
        AddNumber(body, "end_battery_pct", payload.EndBatteryPct);
        AddNumber(body, "peak_power_w", payload.PeakPowerW);
        AddNumber(body, "duration_min", payload.DurationMin);
        AddNumber(body, "cost", payload.Cost);

        return SendWithIdAsync(DataRepairRegistration.ChargingUpdateOperation, id, body, cancellationToken);
    }

    /// <inheritdoc />
    public Task CloseChargingAsync(long id, CancellationToken cancellationToken) =>
        SendWithIdAsync(DataRepairRegistration.ChargingCloseOperation, id, null, cancellationToken);

    /// <inheritdoc />
    public Task DiscardChargingAsync(long id, CancellationToken cancellationToken) =>
        SendWithIdAsync(DataRepairRegistration.ChargingDiscardOperation, id, null, cancellationToken);

    /// <inheritdoc />
    public Task UpdateDriveAsync(long id, DriveRepairPayload payload, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(payload);

        var body = new Dictionary<string, object?>(StringComparer.Ordinal);
        AddString(body, "end_ts", payload.EndTs);
        AddNumber(body, "distance_m", payload.DistanceM);
        AddNumber(body, "duration_s", payload.DurationS);
        AddNumber(body, "end_battery_pct", payload.EndBatteryPct);
        AddNumber(body, "max_speed_mps", payload.MaxSpeedMps);

        return SendWithIdAsync(DataRepairRegistration.DriveUpdateOperation, id, body, cancellationToken);
    }

    /// <inheritdoc />
    public Task CloseDriveAsync(long id, CancellationToken cancellationToken) =>
        SendWithIdAsync(DataRepairRegistration.DriveCloseOperation, id, null, cancellationToken);

    /// <inheritdoc />
    public Task DiscardDriveAsync(long id, CancellationToken cancellationToken) =>
        SendWithIdAsync(DataRepairRegistration.DriveDiscardOperation, id, null, cancellationToken);

    private async Task SendWithIdAsync(string operationId, long id, IReadOnlyDictionary<string, object?>? body, CancellationToken cancellationToken)
    {
        var pathParams = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["id"] = id.ToString(System.Globalization.CultureInfo.InvariantCulture),
        };
        var request = new ApiRequest(operationId, pathParams, Query: null, Body: body);
        _ = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    private static void AddString(Dictionary<string, object?> body, string key, string? value)
    {
        if (!string.IsNullOrEmpty(value))
        {
            body[key] = value;
        }
    }

    private static void AddNumber(Dictionary<string, object?> body, string key, double? value)
    {
        if (value is { } v)
        {
            body[key] = v;
        }
    }
}
