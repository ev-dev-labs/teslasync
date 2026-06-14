using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The data port the <see cref="DrivesListPageViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed drive lists — the native analogue of the web page's
/// <c>useDrives(vehicleId)</c> hook (web/src/api/hooks/useDriving.ts). The view never performs HTTP itself; the
/// concrete <see cref="DrivesListSource"/> (or a test fake) drives this.
/// </summary>
public interface IDrivesListSource
{
    /// <summary>Stream the cache-then-network drive snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    /// <returns>The ordered cache-then-network emissions for one logical read.</returns>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<DriveListItem>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The default <see cref="IDrivesListSource"/> — resolves every read to the empty list (the empty data state). The
/// shell registration uses this until a host wires the generated-client-backed <see cref="DrivesListSource"/> via
/// <see cref="DrivesListPage.Create"/>.
/// </summary>
public sealed class EmptyDrivesListSource : IDrivesListSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyDrivesListSource Instance { get; } = new();

    private EmptyDrivesListSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<DriveListItem>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<IReadOnlyList<DriveListItem>>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>
/// The repository-backed <see cref="IDrivesListSource"/> — the native data adapter for the Drives-list page's drive
/// list and the C# port of the web <c>useDrives(vehicleId)</c> hook (web/src/api/hooks/useDriving.ts +
/// web/src/hooks/useSelectedVehicle.ts). It first resolves the in-scope vehicle from the shared
/// <see cref="IWidgetVehicleSource"/>, then runs one cache-then-network read of the drive list (generated operation
/// <c>get_api_v1_drives</c>) through the shared <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the
/// snake_case wire shape round-trips losslessly, and parses each emission into <see cref="DriveListItem"/> rows.
/// Faithful to the web hook, the query is disabled when no vehicle is selected (it short-circuits to
/// <see cref="RepositoryResult{T}.Empty"/>); a resolved vehicle scopes the read by <c>vehicle_id</c>. No HTTP touches
/// the view (the page applies the date range, collection, search and sort client-side, exactly like the web page).
/// </summary>
public sealed class DrivesListSource : IDrivesListSource
{
    /// <summary>Generated operation id for <c>GET /drives</c>.</summary>
    public const string OperationId = DrivesListRegistration.DrivesOperation;

    private const string VehicleQueryParam = "vehicle_id";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the read to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle (if any) is used.</param>
    public DrivesListSource(
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
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<DriveListItem>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the query is disabled (enabled: vehicleId !== null).
            yield return RepositoryResult<IReadOnlyList<DriveListItem>>.Empty();
            yield break;
        }

        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [VehicleQueryParam] = vid,
        };

        string cacheKey = string.Create(
            CultureInfo.InvariantCulture,
            $"{DrivesListRegistration.CacheKeyPrefix}:{vid}");
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
            yield return DrivesListResultMapper.Map(emission);
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
        JsonValueKind.Object when element.TryGetProperty("drives", out var inner) && inner.ValueKind == JsonValueKind.Array => inner.GetArrayLength() == 0,
        _ => false,
    };
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;DriveListItem&gt;&gt;</c>, preserving every freshness flag so the
/// view-model can fold them into the loading / success / empty / error states. Kept pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class DrivesListResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission.</param>
    /// <returns>The parsed emission with the same lifecycle status.</returns>
    public static RepositoryResult<IReadOnlyList<DriveListItem>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<DriveListItem> Parse() =>
            raw.HasValue ? DriveListItem.ParseList(raw.Value) : Array.Empty<DriveListItem>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<DriveListItem>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<DriveListItem>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<DriveListItem>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<DriveListItem>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<DriveListItem>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<DriveListItem>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<DriveListItem>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// The bulk-delete port the page invokes for the selection toolbar — the native analogue of the web
/// <c>useBulkDeleteDrives()</c> mutation (<c>DELETE /drives/bulk</c> with an <c>{ ids }</c> body). Returns the number
/// of deleted drives so the view-model can clear the selection and refresh.
/// </summary>
public interface IDriveBulkDeleteService
{
    /// <summary>Delete the supplied drive ids; returns the deleted count.</summary>
    /// <param name="ids">The drive ids to delete.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    Task<int> DeleteAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default);
}

/// <summary>The default no-op bulk-delete service (used by the empty-source page registration); deletes nothing.</summary>
public sealed class NullDriveBulkDeleteService : IDriveBulkDeleteService
{
    /// <summary>The shared singleton instance.</summary>
    public static NullDriveBulkDeleteService Instance { get; } = new();

    private NullDriveBulkDeleteService()
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
/// The generated-client-backed <see cref="IDriveBulkDeleteService"/> — the native data adapter for the bulk delete
/// (operation <c>delete_api_v1_drives_bulk</c>). It sends the selected ids in the request body and reads the
/// standardized <c>{ deleted }</c> envelope, returning the deleted count.
/// </summary>
public sealed class DriveBulkDeleteClient : IDriveBulkDeleteService
{
    /// <summary>Generated operation id for <c>DELETE /drives/bulk</c>.</summary>
    public const string OperationId = DrivesListRegistration.BulkDeleteOperation;

    private readonly IApiClient _api;

    /// <summary>Creates the client over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public DriveBulkDeleteClient(IApiClient api)
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
