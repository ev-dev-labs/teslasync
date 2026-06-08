using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The repository-backed <see cref="IChargingScheduleSource"/> — the native data adapter for the Charging
/// Schedule surface. It first resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/> (the
/// native analogue of the web component's <c>vehicleId ?? vehicles?.[0]?.id</c>), then composes the web's two
/// queries:
/// <list type="number">
///   <item>One best-effort cache-then-network read of <c>GET /vehicles/{vehicleID}/state</c> (generated operation
///         <c>get_api_v1_vehicles_vehicleID_state</c>) — the web <c>useVehicleState</c> query that supplies the
///         tall detail row's battery level + charging status. Any failure or empty result simply yields a
///         <see langword="null"/> state (the web <c>state</c> being undefined → no detail row), never failing the
///         surface.</item>
///   <item>The primary cache-then-network read of <c>GET /signals/{vehicleID}/live</c> (generated operation
///         <c>get_api_v1_signals_vehicleID_live</c>) — the web live-signals query that drives the schedule body
///         and the freshness/error chrome.</item>
/// </list>
/// Each live-signals emission is combined with the resolved state via <see cref="ChargingScheduleResultMapper"/>.
/// When no vehicle is available the read short-circuits to <see cref="RepositoryResult{T}.Empty"/>, mirroring the
/// web hooks' disabled queries (<c>enabled: id &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class ChargingScheduleSource : IChargingScheduleSource
{
    // Generated operation ids (TeslaSync.App.Core.Data.Net.Operations table); asserted by the source tests.
    private const string LiveSignalsOperation = "get_api_v1_signals_vehicleID_live";
    private const string StateOperation = "get_api_v1_vehicles_vehicleID_state";
    private const string VehiclePathParam = "vehicleID";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the reads to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public ChargingScheduleSource(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _vehicles = vehicles;
        _api = api;
        _engine = engine;
        _json = options.Json;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<ChargingScheduleSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the live-signals query is disabled and the schedule body is empty.
            yield return RepositoryResult<ChargingScheduleSnapshot>.Empty();
            yield break;
        }

        // Resolve the supplementary vehicle state first (best-effort; feeds the detail row, never fails the surface).
        var state = await ResolveStateAsync(vid, cancellationToken).ConfigureAwait(false);

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"signals:{vid}:charging-schedule");
        var request = new ApiRequest(
            LiveSignalsOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vid.ToString(CultureInfo.InvariantCulture),
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptySchedule,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return ChargingScheduleResultMapper.Map(emission, state);
        }
    }

    private async Task<long?> ResolveVehicleIdAsync(CancellationToken cancellationToken)
    {
        if (_vehicleId is { } explicitId)
        {
            return explicitId;
        }

        var primary = await _vehicles.GetPrimaryAsync(cancellationToken).ConfigureAwait(false);
        return primary?.VehicleId;
    }

    /// <summary>
    /// Drain a best-effort cache-then-network read of the vehicle state, returning the freshest parsed
    /// <see cref="VehicleScheduleState"/> or <see langword="null"/>. The state is supplementary (web
    /// <c>useVehicleState</c> feeding only the tall detail row), so any network/parse failure or empty result
    /// collapses to <see langword="null"/> rather than propagating — cancellation still propagates so a superseded
    /// load is dropped.
    /// </summary>
    private async Task<VehicleScheduleState?> ResolveStateAsync(long vid, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:charging-schedule-state");
        var request = new ApiRequest(
            StateOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vid.ToString(CultureInfo.InvariantCulture),
            });

        VehicleScheduleState? latest = null;
        try
        {
            var raw = _engine.StreamAsync<JsonElement>(
                cacheKey,
                ct => _api.SendAsync<JsonElement>(request, ct),
                IsEmptyState,
                _json,
                CacheFreshness.LiveStaleSeconds,
                cancellationToken);

            await foreach (var emission in raw.ConfigureAwait(false))
            {
                if (emission.HasValue && VehicleScheduleState.FromResponse(emission.Value) is { } parsed)
                {
                    latest = parsed;
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort: the state is supplementary, so a failure leaves the schedule body intact (web `state`
            // undefined → the tall detail row is simply hidden).
        }

        return latest;
    }

    // Web parity: an empty / schedule-less signals map collapses to the empty surface (web hasScheduleData false).
    private static bool IsEmptySchedule(JsonElement element) => !ScheduleReading.FromLiveResponse(element).HasScheduleData;

    // Web parity: an absent/stateless body yields no detail-row state (web `state` undefined).
    private static bool IsEmptyState(JsonElement element) => VehicleScheduleState.FromResponse(element) is null;
}
