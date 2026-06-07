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
/// The data port the <see cref="ChargingSessionDetailViewModel"/> binds to (P1/S8 state-holder seam). It
/// yields the cache-then-network sequence of the latest charging session's detail + telemetry for the
/// primary (or explicit) vehicle — the native analogue of the web <c>useVehicles</c> +
/// <c>useChargingSessions</c> + <c>useChargingSessionDetail</c> + <c>useChargeTelemetry</c> hook
/// composition (web/src/features/dashboard/widgets/ChargingSessionDetailWidget.tsx). The view never
/// performs HTTP itself; the concrete <see cref="ChargingSessionDetailSource"/> (or a test fake) drives this.
/// </summary>
public interface IChargingSessionDetailSource
{
    /// <summary>Stream the cache-then-network session detail snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<ChargingSessionDetailSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IChargingSessionDetailSource"/> — the native data adapter for the
/// Charging Session Detail surface. It resolves the primary (or explicit) vehicle from the shared
/// <see cref="IWidgetVehicleSource"/> (the native analogue of the web <c>vehicleId ?? vehicles?.[0]?.id</c>),
/// then composes the web's hook chain:
/// <list type="number">
///   <item>One cache-then-network read of the charging-sessions list (generated operation
///         <c>get_api_v1_charging_sessions</c>, scoped by <c>vehicle_id</c>) to resolve the newest session
///         id — the web <c>useChargingSessions</c> + <c>latestSessionId</c> reduce by <c>startedAt</c>.
///         No session id → <see cref="RepositoryResult{T}.Empty"/> (the web <c>!detail</c> gate).</item>
///   <item>A best-effort cache-then-network read of that session's telemetry (generated operation
///         <c>get_api_v1_charging_sessionID_telemetry</c>) — the web <c>useChargeTelemetry</c>. It feeds
///         the power curve and the peak-power figure; any failure simply yields an empty curve.</item>
///   <item>The primary cache-then-network read of that session's detail (generated operation
///         <c>get_api_v1_charging_sessions_sessionID</c>) — the web <c>useChargingSessionDetail</c>, which
///         drives the summary stats and the freshness / error / empty chrome.</item>
/// </list>
/// Each detail emission is combined with the resolved telemetry via
/// <see cref="ChargingSessionDetailResultMapper"/>. When no vehicle is available the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty"/>, mirroring the web hooks' disabled queries
/// (<c>enabled: id &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class ChargingSessionDetailSource : IChargingSessionDetailSource
{
    private const string SessionPathParam = "sessionID";
    private const string VehicleQueryParam = "vehicle_id";

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
    public ChargingSessionDetailSource(
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
    public async IAsyncEnumerable<RepositoryResult<ChargingSessionDetailSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the charging queries are disabled and `detail` is undefined.
            yield return RepositoryResult<ChargingSessionDetailSnapshot>.Empty();
            yield break;
        }

        long? sessionId = await ResolveLatestSessionIdAsync(vid, cancellationToken).ConfigureAwait(false);
        if (sessionId is not { } sid)
        {
            // Web parity: latestSessionId === null disables the detail query — `!detail` → empty surface.
            yield return RepositoryResult<ChargingSessionDetailSnapshot>.Empty();
            yield break;
        }

        // Resolve the telemetry first (best-effort; supplementary, never fails the surface) so each detail
        // emission can carry the same curve — the web `useChargeTelemetry` query.
        var telemetry = await ResolveTelemetryAsync(sid, cancellationToken).ConfigureAwait(false);

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"charging:{sid}:session-detail");
        var request = new ApiRequest(
            Operations.Charging.SessionDetail,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [SessionPathParam] = sid.ToString(CultureInfo.InvariantCulture),
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            element => !ChargingSessionDetailRow.HasDetail(element),
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return ChargingSessionDetailResultMapper.Map(emission, telemetry);
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
    /// Drain a cache-then-network read of the charging-sessions list and resolve the newest session's id by
    /// <c>started_at</c> (web <c>useChargingSessions</c> + the <c>latestSessionId</c> reduce). Returns
    /// <see langword="null"/> when there is no session (web <c>latestSessionId === null</c>); a transport
    /// failure also collapses to <see langword="null"/> so the surface shows the friendly empty state rather
    /// than an error, mirroring the web's disabled detail query. Cancellation still propagates.
    /// </summary>
    private async Task<long?> ResolveLatestSessionIdAsync(long vid, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"charging:{vid}:session-detail-list");
        var request = new ApiRequest(
            Operations.Charging.Sessions,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
            });

        long? latest = null;
        try
        {
            var raw = _engine.StreamAsync<JsonElement>(
                cacheKey,
                ct => _api.SendAsync<JsonElement>(request, ct),
                IsEmptyArray,
                _json,
                CacheFreshness.LiveStaleSeconds,
                cancellationToken);

            await foreach (var emission in raw.ConfigureAwait(false))
            {
                if (emission.HasValue && LatestSessionId(emission.Value) is { } id)
                {
                    latest = id;
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort: a sessions-list failure leaves the surface empty (web latestSessionId === null).
        }

        return latest;
    }

    /// <summary>
    /// Drain a best-effort cache-then-network read of the session telemetry, returning the freshest parsed
    /// samples or an empty list. The telemetry is supplementary (web <c>useChargeTelemetry</c>), so any
    /// network / parse failure or empty result collapses to an empty curve rather than propagating —
    /// cancellation still propagates so a superseded load is dropped.
    /// </summary>
    private async Task<IReadOnlyList<ChargeTelemetrySample>> ResolveTelemetryAsync(long sessionId, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"charging:{sessionId}:session-detail-telemetry");
        var request = new ApiRequest(
            Operations.Charging.SessionTelemetry,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [SessionPathParam] = sessionId.ToString(CultureInfo.InvariantCulture),
            });

        IReadOnlyList<ChargeTelemetrySample> telemetry = Array.Empty<ChargeTelemetrySample>();
        try
        {
            var raw = _engine.StreamAsync<JsonElement>(
                cacheKey,
                ct => _api.SendAsync<JsonElement>(request, ct),
                IsEmptyArray,
                _json,
                CacheFreshness.LiveStaleSeconds,
                cancellationToken);

            await foreach (var emission in raw.ConfigureAwait(false))
            {
                if (emission.HasValue)
                {
                    telemetry = ChargeTelemetrySample.ParseList(emission.Value);
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort: telemetry is supplementary (web chartData empty → no curve, peak power 0).
        }

        return telemetry;
    }

    /// <summary>Resolve the newest session's id by <c>started_at</c> (web <c>latestSessionId</c> reduce).</summary>
    private static long? LatestSessionId(JsonElement array)
    {
        if (array.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        long? bestId = null;
        DateTimeOffset bestStarted = DateTimeOffset.MinValue;
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object || !TryGetId(item, out long id))
            {
                continue;
            }

            var started = WidgetJson.GetDateTime(item, "started_at") ?? DateTimeOffset.MinValue;
            if (bestId is null || started >= bestStarted)
            {
                bestId = id;
                bestStarted = started;
            }
        }

        return bestId;
    }

    private static bool TryGetId(JsonElement obj, out long id)
    {
        id = 0;
        if (!obj.TryGetProperty("id", out var v))
        {
            return false;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out id) => true,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out id) => true,
            _ => false,
        };
    }

    private static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
