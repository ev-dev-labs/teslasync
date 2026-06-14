using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// The data port the <see cref="VehicleListPageViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of resolved fleet rosters — the native analogue of the web Vehicle-list page's
/// data sources (<c>useVehicles</c> for the roster, the <c>fetchVehicleState</c> fan-out per vehicle, and
/// <c>usePinned('vehicle')</c> for the pinned ordering). The view never performs HTTP itself; the concrete
/// <see cref="VehicleListSource"/> (or a test fake) drives this.
/// </summary>
public interface IVehicleListSource
{
    /// <summary>Stream the cache-then-network fleet rosters, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the stream.</param>
    /// <returns>The cache-then-network sequence of roster snapshots.</returns>
    IAsyncEnumerable<RepositoryResult<VehicleListReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The write port the page's Sync / Remove affordances dispatch through — the native analogue of the web
/// <c>syncMut</c> (POST /vehicles/sync) and <c>deleteMut</c> (DELETE /vehicles/{id}) mutations. Kept off the
/// read source so the view-model can be exercised with a fake that records the calls without HTTP.
/// </summary>
public interface IVehicleListMutations
{
    /// <summary>Sync vehicles from Tesla (web <c>syncMut.mutate()</c>); returns the synced count.</summary>
    /// <param name="cancellationToken">Cancels the sync.</param>
    /// <returns>The number of vehicles synced (web <c>{ synced }</c>).</returns>
    Task<int> SyncAsync(CancellationToken cancellationToken = default);

    /// <summary>Remove a vehicle and its associated data (web <c>deleteMut.mutate(id)</c>).</summary>
    /// <param name="vehicleId">The id of the vehicle to remove.</param>
    /// <param name="cancellationToken">Cancels the delete.</param>
    /// <returns>A task that completes when the delete resolves.</returns>
    Task DeleteAsync(long vehicleId, CancellationToken cancellationToken = default);
}

/// <summary>
/// The inert <see cref="IVehicleListSource"/> the default page constructor binds — it yields a single
/// <see cref="RepositoryResult{T}.Empty"/> so the shell-registered page renders the friendly empty state until a
/// dependency-injection host wires the generated-client-backed <see cref="VehicleListSource"/> via
/// <c>VehicleListPage.Create</c>. Mirrors the empty-source pattern the sibling list pages use.
/// </summary>
public sealed class EmptyVehicleListSource : IVehicleListSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyVehicleListSource Instance { get; } = new();

    private EmptyVehicleListSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<VehicleListReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<VehicleListReading>.Empty(DateTimeOffset.UtcNow);
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>The no-op <see cref="IVehicleListMutations"/> the default page binds (no backend wired).</summary>
public sealed class NullVehicleListMutations : IVehicleListMutations
{
    /// <summary>The shared singleton instance.</summary>
    public static NullVehicleListMutations Instance { get; } = new();

    private NullVehicleListMutations()
    {
    }

    /// <inheritdoc />
    public Task<int> SyncAsync(CancellationToken cancellationToken = default) => Task.FromResult(0);

    /// <inheritdoc />
    public Task DeleteAsync(long vehicleId, CancellationToken cancellationToken = default) => Task.CompletedTask;
}

/// <summary>
/// The repository-backed <see cref="IVehicleListSource"/> — the native data adapter for the Vehicle-list page.
/// It mirrors the web page's three reads (web/src/features/vehicles/pages/VehicleListPage.tsx): a
/// cache-then-network read of the vehicle roster (<c>GET /vehicles</c>, generated operation
/// <see cref="Operations.Vehicles.List"/>, the web <c>useVehicles</c>) which is the load-bearing spine that
/// decides the surface state; a best-effort fan-out of one state read per vehicle (<c>GET
/// /vehicles/{vehicleID}/state</c>, <see cref="Operations.Vehicles.State"/>, the web <c>fetchVehicleState</c>)
/// whose resolved results pair with their vehicle (each read wrapped so a single failure contributes a null
/// state, exactly like the web <c>try/catch</c> returning null); and a best-effort read of the pinned items
/// (<c>GET /pinned?type=vehicle</c>, the web <c>usePinned('vehicle')</c>) used to float pinned vehicles to the
/// top. An empty roster short-circuits to <see cref="RepositoryResult{T}.Empty"/>, mirroring the web's
/// <c>vehicleList.length === 0</c> branch. No HTTP touches the view.
/// </summary>
public sealed class VehicleListSource : IVehicleListSource
{
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public VehicleListSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<VehicleListReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var listStream = _engine.StreamAsync<JsonElement>(
            VehicleListPageRegistration.VehiclesListCacheKey,
            ct => _api.SendAsync<JsonElement>(new ApiRequest(Operations.Vehicles.List), ct),
            IsEmptyArray,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var listResult in listStream.ConfigureAwait(false))
        {
            yield return await MapAsync(listResult, cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task<RepositoryResult<VehicleListReading>> MapAsync(
        RepositoryResult<JsonElement> listResult,
        CancellationToken cancellationToken)
    {
        switch (listResult.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<VehicleListReading>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<VehicleListReading>.Empty(listResult.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<VehicleListReading>.Failure(
                    listResult.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));

            case LoadStatus.Cached:
            case LoadStatus.Refreshing:
            case LoadStatus.Loaded:
            case LoadStatus.Offline:
                return await MapContentAsync(listResult, cancellationToken).ConfigureAwait(false);

            default:
                return RepositoryResult<VehicleListReading>.Failure(
                    listResult.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }
    }

    private async Task<RepositoryResult<VehicleListReading>> MapContentAsync(
        RepositoryResult<JsonElement> listResult,
        CancellationToken cancellationToken)
    {
        var vehicles = VehicleListVehicle.FromArray(listResult.Value);
        var fetchedAt = listResult.FetchedAt ?? DateTimeOffset.UtcNow;

        // Web parity: an empty roster classifies as Empty even on a cached / offline read (no fleet), except on
        // the network-failure path where the offline state must survive over the (zero) cards.
        if (vehicles.Count == 0 && listResult.Status != LoadStatus.Offline)
        {
            return RepositoryResult<VehicleListReading>.Empty(fetchedAt);
        }

        var entriesTask = FanOutEntriesAsync(vehicles, cancellationToken);
        var pinsTask = FetchPinsAsync(cancellationToken);
        await Task.WhenAll(entriesTask, pinsTask).ConfigureAwait(false);

        var reading = new VehicleListReading(entriesTask.Result, pinsTask.Result);

        return listResult.Status switch
        {
            LoadStatus.Cached => RepositoryResult<VehicleListReading>.Cached(reading, fetchedAt, listResult.IsStale),
            LoadStatus.Refreshing => RepositoryResult<VehicleListReading>.Refreshing(reading, fetchedAt, listResult.IsStale),
            LoadStatus.Offline => RepositoryResult<VehicleListReading>.OfflineCached(
                reading, fetchedAt, listResult.Error ?? new RepositoryError(RepositoryErrorKind.Network, "offline")),
            _ => RepositoryResult<VehicleListReading>.Loaded(reading, fetchedAt),
        };
    }

    private async Task<IReadOnlyList<VehicleListEntry>> FanOutEntriesAsync(
        IReadOnlyList<VehicleListVehicle> vehicles,
        CancellationToken cancellationToken)
    {
        if (vehicles.Count == 0)
        {
            return Array.Empty<VehicleListEntry>();
        }

        var reads = new List<Task<VehicleListEntry>>(vehicles.Count);
        foreach (var vehicle in vehicles)
        {
            reads.Add(FetchEntryAsync(vehicle, cancellationToken));
        }

        return await Task.WhenAll(reads).ConfigureAwait(false);
    }

    private async Task<VehicleListEntry> FetchEntryAsync(VehicleListVehicle vehicle, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            VehicleListPageRegistration.StateOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehicleListPageRegistration.VehicleIdPathParam] = vehicle.Id.ToString(CultureInfo.InvariantCulture),
            });

        try
        {
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return new VehicleListEntry(vehicle, VehicleListVehicleState.FromResponse(json));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Web parity: each fetchVehicleState is wrapped in try/catch returning null; the card stays asleep.
            return new VehicleListEntry(vehicle, null);
        }
    }

    private async Task<IReadOnlyList<VehicleListPin>> FetchPinsAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            VehicleListPageRegistration.PinnedOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["type"] = VehicleListPageRegistration.PinItemType,
            });

        try
        {
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return VehicleListPin.FromArray(json);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Web parity: usePinned defaults its data to [] — a failed pin read simply leaves the roster unsorted.
            return Array.Empty<VehicleListPin>();
        }
    }

    private static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}

/// <summary>
/// The generated-client-backed <see cref="IVehicleListMutations"/> — the native adapter for the page's sync +
/// remove mutations. <see cref="SyncAsync"/> posts <c>POST /vehicles/sync</c> and reads the <c>synced</c> count
/// from the response (web <c>syncMut</c>); <see cref="DeleteAsync"/> issues <c>DELETE /vehicles/{id}</c> (web
/// <c>deleteMut</c>). Exceptions propagate so the view-model surfaces the failure copy.
/// </summary>
public sealed class VehicleListMutationsClient : IVehicleListMutations
{
    private readonly IApiClient _api;

    /// <summary>Creates the client over the generated contract client.</summary>
    /// <param name="api">The generated contract client.</param>
    public VehicleListMutationsClient(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<int> SyncAsync(CancellationToken cancellationToken = default)
    {
        var json = await _api.SendAsync<JsonElement>(
            new ApiRequest(VehicleListPageRegistration.SyncOperation), cancellationToken).ConfigureAwait(false);
        return (int)(VehicleListJson.Long(json, "synced") ?? 0);
    }

    /// <inheritdoc />
    public Task DeleteAsync(long vehicleId, CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(
            VehicleListPageRegistration.DeleteOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehicleListPageRegistration.VehicleIdPathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            });
        return _api.SendAsync<JsonElement>(request, cancellationToken);
    }
}
