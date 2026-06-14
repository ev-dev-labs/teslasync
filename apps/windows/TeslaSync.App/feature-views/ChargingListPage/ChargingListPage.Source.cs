using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The data port the <see cref="ChargingListPageViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed charging-session lists — the native analogue of the web page's
/// <c>useChargingSessionsPaginated(vehicleId, { limit, offset, start, end })</c> hook
/// (web/src/api/hooks/useCharging.ts). The view never performs HTTP itself; the concrete
/// <see cref="ChargingListSource"/> (or a test fake) drives this.
/// </summary>
public interface IChargingListSource
{
    /// <summary>Stream the cache-then-network charging-session snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    /// <returns>The ordered cache-then-network emissions for one logical read.</returns>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<ChargingListSession>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The default <see cref="IChargingListSource"/> — resolves every read to the empty list (the empty data state).
/// The shell registration uses this until a host wires the generated-client-backed <see cref="ChargingListSource"/>
/// via <see cref="ChargingListPage.Create"/>.
/// </summary>
public sealed class EmptyChargingListSource : IChargingListSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyChargingListSource Instance { get; } = new();

    private EmptyChargingListSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ChargingListSession>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<IReadOnlyList<ChargingListSession>>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>
/// The repository-backed <see cref="IChargingListSource"/> — the native data adapter for the Charging-list page's
/// session list and the C# port of the web <c>useChargingSessionsPaginated(...)</c> hook
/// (web/src/api/hooks/useCharging.ts + web/src/hooks/useSelectedVehicle.ts). It first resolves the in-scope
/// vehicle from the shared <see cref="IWidgetVehicleSource"/>, then runs one cache-then-network read of the
/// session list (generated operation <c>get_api_v1_charging</c>) through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips losslessly,
/// and parses each emission into <see cref="ChargingListSession"/> rows. Faithful to the web hook, the query is
/// disabled when no vehicle is selected (it short-circuits to <see cref="RepositoryResult{T}.Empty"/>); a resolved
/// vehicle scopes the read with the wide page-side <c>limit</c> + date range. No HTTP touches the view.
/// </summary>
public sealed class ChargingListSource : IChargingListSource
{
    /// <summary>Generated operation id for <c>GET /charging</c>.</summary>
    public const string OperationId = "get_api_v1_charging";

    private const string VehicleQueryParam = "vehicle_id";
    private const string LimitQueryParam = "limit";
    private const string OffsetQueryParam = "offset";
    private const string StartQueryParam = "start";
    private const string EndQueryParam = "end";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;
    private readonly string? _startDate;
    private readonly string? _endDate;

    /// <summary>Creates the source over the vehicle source, contract client, engine, JSON settings and range.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the read to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle (if any) is used.</param>
    /// <param name="startDate">The inclusive range start day sent to the API (web <c>start</c>), or null.</param>
    /// <param name="endDate">The inclusive range end day sent to the API (web <c>end</c>), or null.</param>
    public ChargingListSource(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long? vehicleId = null,
        string? startDate = null,
        string? endDate = null)
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
        _startDate = startDate;
        _endDate = endDate;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ChargingListSession>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the query is disabled (enabled: vehicleId !== null).
            yield return RepositoryResult<IReadOnlyList<ChargingListSession>>.Empty();
            yield break;
        }

        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [VehicleQueryParam] = vid,
            [LimitQueryParam] = ChargingListProjection.FetchLimit,
            [OffsetQueryParam] = 0,
        };
        if (!string.IsNullOrEmpty(_startDate))
        {
            query[StartQueryParam] = _startDate;
        }

        if (!string.IsNullOrEmpty(_endDate))
        {
            query[EndQueryParam] = _endDate;
        }

        string cacheKey = string.Create(
            CultureInfo.InvariantCulture,
            $"{ChargingListRegistration.CacheKeyPrefix}:{vid}:{_startDate}:{_endDate}");
        var request = new ApiRequest(OperationId, Query: query);

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return ChargingListResultMapper.Map(emission);
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

    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;ChargingListSession&gt;&gt;</c>, preserving every freshness flag so the
/// view-model can fold them into the loading / success / empty / error states. Kept pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class ChargingListResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission.</param>
    /// <returns>The parsed emission with the same lifecycle status.</returns>
    public static RepositoryResult<IReadOnlyList<ChargingListSession>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<ChargingListSession> Parse() =>
            raw.HasValue ? ChargingListSession.ParseList(raw.Value) : Array.Empty<ChargingListSession>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<ChargingListSession>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<ChargingListSession>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<ChargingListSession>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<ChargingListSession>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<ChargingListSession>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<ChargingListSession>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<ChargingListSession>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// The bulk-delete port the page invokes for the selection toolbar — the native analogue of the web
/// <c>useBulkDeleteCharging()</c> mutation (<c>DELETE /charging/bulk</c> with an <c>{ ids }</c> body). Returns the
/// number of deleted sessions so the view-model can clear the selection and refresh.
/// </summary>
public interface IChargingBulkDeleteService
{
    /// <summary>Delete the supplied session ids; returns the deleted count.</summary>
    /// <param name="ids">The session ids to delete.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    Task<int> DeleteAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default);
}

/// <summary>The default no-op bulk-delete service (used by the empty-source page registration); deletes nothing.</summary>
public sealed class NullChargingBulkDeleteService : IChargingBulkDeleteService
{
    /// <summary>The shared singleton instance.</summary>
    public static NullChargingBulkDeleteService Instance { get; } = new();

    private NullChargingBulkDeleteService()
    {
    }

    /// <inheritdoc />
    public Task<int> DeleteAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(0);
    }
}

/// <summary>
/// The generated-client-backed <see cref="IChargingBulkDeleteService"/> — the native data adapter for the bulk
/// delete (operation <c>delete_api_v1_charging_bulk</c>). It sends the selected ids in the request body and reads
/// the standardized <c>{ deleted }</c> envelope, returning the deleted count.
/// </summary>
public sealed class ChargingBulkDeleteClient : IChargingBulkDeleteService
{
    /// <summary>Generated operation id for <c>DELETE /charging/bulk</c>.</summary>
    public const string OperationId = "delete_api_v1_charging_bulk";

    private readonly IApiClient _api;

    /// <summary>Creates the client over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public ChargingBulkDeleteClient(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<int> DeleteAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(ids);
        if (ids.Count == 0)
        {
            return 0;
        }

        var request = new ApiRequest(OperationId, Body: new BulkDeleteBody(ids));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        if (json.ValueKind == JsonValueKind.Object &&
            json.TryGetProperty("deleted", out var deleted) &&
            deleted.ValueKind == JsonValueKind.Number &&
            deleted.TryGetInt32(out var count))
        {
            return count;
        }

        return ids.Count;
    }

    private sealed record BulkDeleteBody(
        [property: System.Text.Json.Serialization.JsonPropertyName("ids")] IReadOnlyList<long> Ids);
}

/// <summary>Static identity + cache-key helpers for the Charging-list page (route <c>/charging</c>, nav name <c>Charging</c>).</summary>
public static class ChargingListRegistration
{
    /// <summary>The navigation route name the shell page factory registers this page under.</summary>
    public const string RouteName = "Charging";

    /// <summary>The web route path (web <c>/charging</c>).</summary>
    public const string Route = "charging";

    /// <summary>The diagnostics slug (web component family).</summary>
    public const string Slug = "ChargingListPage";

    /// <summary>The cache-key prefix for the cache-then-network charging-session read.</summary>
    public const string CacheKeyPrefix = "charging:list";

    /// <summary>The Fluent route glyph (web charging bolt; empty-state icon).</summary>
    public const string RouteGlyph = "\uE945";

    /// <summary>The Fluent glyph for the export affordances (web Download icon).</summary>
    public const string ExportGlyph = "\uE74E";

    /// <summary>The Fluent glyph for the bulk-delete affordance (web Trash icon).</summary>
    public const string DeleteGlyph = "\uE74D";
}

/// <summary>
/// PII-safe diagnostics sink for the Charging-list page — records only the <c>view.opened</c> event (no places,
/// costs, energies or ids), mirroring the established W7 page diagnostics contract.
/// </summary>
public sealed class ChargingListDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the diagnostics sink over an optional line writer (null = count only).</summary>
    /// <param name="sink">Receives each PII-safe diagnostic line; null counts without emitting.</param>
    public ChargingListDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={ChargingListRegistration.Slug}"));
    }
}
