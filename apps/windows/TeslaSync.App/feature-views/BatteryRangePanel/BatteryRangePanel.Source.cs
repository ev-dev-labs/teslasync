using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="BatteryRangePanelViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of resolved <see cref="BatteryRangeData"/> snapshots — the native analogue of
/// the <c>useVehicleState(vehicleId)</c> query the web vehicle-detail page runs before handing the
/// <c>state</c> prop to <c>&lt;BatteryRangePanel /&gt;</c>
/// (web/src/features/vehicles/components/vehicle-detail/BatteryRangePanel.tsx). The view never performs HTTP
/// itself; the concrete <see cref="BatteryRangePanelSource"/> (or a test fake) drives this.
/// </summary>
public interface IBatteryRangePanelSource
{
    /// <summary>Stream the cache-then-network battery / range snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    /// <returns>The ordered cache-then-network emissions for one logical read.</returns>
    IAsyncEnumerable<RepositoryResult<BatteryRangeData>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical metadata for the Battery &amp; Range panel surface. The diagnostics <see cref="Slug"/> is the
/// stable surface identifier emitted with the <c>view.opened</c> event (P1/S11 diagnostics contract).
/// </summary>
public static class BatteryRangePanelRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BatteryRangePanel";
}

/// <summary>
/// PII-safe diagnostics for the Battery &amp; Range panel surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a state-of-charge, range, VIN or
/// location — so a diagnostics line can never leak vehicle data. Thread-safe.
/// </summary>
public sealed class BatteryRangePanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or <see langword="null"/>.</param>
    public BatteryRangePanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BatteryRangePanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BatteryRangePanelRegistration.Slug}");
    }
}

/// <summary>
/// The repository-backed <see cref="IBatteryRangePanelSource"/> — the native data adapter for the Battery &amp;
/// Range panel. One logical read resolves the primary (or explicit) vehicle from <c>GET /vehicles</c> (web
/// <c>useVehicles</c>, selecting <c>vehicleId ? find ?? [0] : [0]</c>), then reads that vehicle's live state
/// from <c>GET /vehicles/{vehicleID}/state</c> (web <c>useVehicleState</c>, a live 5-second poll). The parsed
/// <see cref="BatteryRangeData"/> is cached as JSON so the snapshot round-trips losslessly and the whole read
/// replays cache-then-network through the shared <see cref="CacheThenNetworkEngine"/>. When no vehicle resolves
/// the read short-circuits to <see cref="RepositoryResult{T}.Empty"/>, mirroring the web's selected-vehicle
/// gate. No HTTP touches the view.
/// </summary>
public sealed class BatteryRangePanelSource : IBatteryRangePanelSource
{
    private const string VehiclePathParam = "vehicleID";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;
    private readonly string _cacheKey;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary (first roster) vehicle is used.</param>
    public BatteryRangePanelSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options, long? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
        _vehicleId = vehicleId;
        _cacheKey = vehicleId is { } id
            ? string.Create(CultureInfo.InvariantCulture, $"vehicles:{id}:battery-range-panel")
            : "vehicles:primary:battery-range-panel";
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<BatteryRangeData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<BatteryRangeData>(
            _cacheKey,
            FetchAsync,
            static data => !data.HasVehicle,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return emission;
        }
    }

    private async Task<BatteryRangeData> FetchAsync(CancellationToken cancellationToken)
    {
        // 1. The vehicle roster resolves the panel's vehicle (web vehicles.find(...) ?? vehicles[0]).
        var vehicles = await _api.SendAsync<JsonElement>(new ApiRequest(Operations.Vehicles.List), cancellationToken)
            .ConfigureAwait(false);
        long? vehicleId = ResolveVehicleId(vehicles, _vehicleId);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useVehicleState query is disabled and `state` is undefined.
            return BatteryRangeData.Empty;
        }

        // 2. That vehicle's live state drives the gauge and the three cards (web useVehicleState). A stateless
        //    body parses to null telemetry — the empty surface — rather than failing the read.
        var stateJson = await _api.SendAsync<JsonElement>(StateRequest(vid), cancellationToken).ConfigureAwait(false);
        return new BatteryRangeData(true, BatteryRangeTelemetry.FromResponse(stateJson));
    }

    private static ApiRequest StateRequest(long vehicleId) => new(
        Operations.Vehicles.State,
        PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
        });

    private static long? ResolveVehicleId(JsonElement root, long? preferredId)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        long? first = null;
        foreach (var element in root.EnumerateArray())
        {
            long? id = IdOf(element);
            if (id is not { } value)
            {
                continue;
            }

            first ??= value;
            if (preferredId is { } pref && value == pref)
            {
                return value;
            }
        }

        return first;
    }

    private static long? IdOf(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object
            && element.TryGetProperty("id", out var idValue)
            && idValue.ValueKind == JsonValueKind.Number
            && idValue.TryGetInt64(out var id))
        {
            return id;
        }

        return null;
    }
}
