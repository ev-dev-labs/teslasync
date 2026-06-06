using System.Text.Json;
using TeslaSync.App.Core.Data.Cache;
using TeslaSync.App.Core.Live;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Core.Widgets;

/// <summary>
/// The default <see cref="IWidgetVehicleSource"/> (P2/W8-0003): it reads the vehicle list and per-vehicle
/// state straight from the W5 SQLite response cache (the same rows the repositories write) for instant
/// content, and folds in the W6 <see cref="LiveSignalStore"/> receive time so a foreground live session
/// makes the freshness marker read <c>Live</c>. It opens no network request and no SSE stream, honouring
/// the rule that widgets never hold a background connection (ADR-009): the freshness window does the rest,
/// so cached-only content correctly reads <c>Stale</c>/<c>Offline</c> once it ages out.
/// </summary>
public sealed class CacheWidgetVehicleSource : IWidgetVehicleSource
{
    private const string VehiclesListKey = "vehicles:list";

    private readonly ICacheStore _cache;
    private readonly JsonSerializerOptions _json;
    private readonly LiveSignalStore? _live;

    /// <summary>Creates the source over the response cache, the shared JSON settings and (optionally) the live store.</summary>
    public CacheWidgetVehicleSource(ICacheStore cache, JsonSerializerOptions json, LiveSignalStore? live = null)
    {
        ArgumentNullException.ThrowIfNull(cache);
        ArgumentNullException.ThrowIfNull(json);

        _cache = cache;
        _json = json;
        _live = live;
    }

    /// <inheritdoc />
    public async Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default)
    {
        var vehicles = await ReadVehiclesAsync(cancellationToken).ConfigureAwait(false);
        if (vehicles is null || vehicles.Count == 0)
        {
            return null;
        }

        var primary = vehicles.FirstOrDefault(v => v.ArchivedAt is null) ?? vehicles[0];
        return await GetAsync(primary.Id, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default)
    {
        var vehicles = await ReadVehiclesAsync(cancellationToken).ConfigureAwait(false);
        var vehicle = vehicles?.FirstOrDefault(v => v.Id == vehicleId);

        var (state, stateFetchedAt) = await ReadEntryAsync<GeneratedApi.VehicleState>(
            $"vehicles:{vehicleId}:state",
            cancellationToken).ConfigureAwait(false);

        if (vehicle is null && state is null)
        {
            return null;
        }

        var observedAt = ResolveObservedAt(vehicleId, stateFetchedAt);
        return WidgetSnapshotMapper.From(vehicle, state, observedAt);
    }

    private async Task<IReadOnlyList<GeneratedApi.Vehicle>?> ReadVehiclesAsync(CancellationToken cancellationToken)
    {
        var (vehicles, _) = await ReadEntryAsync<List<GeneratedApi.Vehicle>>(VehiclesListKey, cancellationToken)
            .ConfigureAwait(false);
        return vehicles;
    }

    private DateTimeOffset? ResolveObservedAt(long vehicleId, DateTimeOffset? cacheFetchedAt)
    {
        DateTimeOffset? liveAt = null;
        if (_live is not null)
        {
            foreach (var signal in _live.SignalsFor(vehicleId))
            {
                if (liveAt is null || signal.ReceivedAt > liveAt)
                {
                    liveAt = signal.ReceivedAt;
                }
            }
        }

        if (liveAt is null)
        {
            return cacheFetchedAt;
        }

        if (cacheFetchedAt is null)
        {
            return liveAt;
        }

        return liveAt > cacheFetchedAt ? liveAt : cacheFetchedAt;
    }

    private async Task<(T? Value, DateTimeOffset? FetchedAt)> ReadEntryAsync<T>(
        string key,
        CancellationToken cancellationToken)
    {
        var entry = await _cache.ReadAsync(key, cancellationToken).ConfigureAwait(false);
        if (entry is null)
        {
            return (default, null);
        }

        try
        {
            var value = JsonSerializer.Deserialize<T>(entry.Payload, _json);
            return (value, entry.FetchedAt);
        }
        catch (JsonException)
        {
            // A corrupt or schema-drifted cache row is treated as a miss, mirroring the read engine.
            return (default, null);
        }
    }
}
