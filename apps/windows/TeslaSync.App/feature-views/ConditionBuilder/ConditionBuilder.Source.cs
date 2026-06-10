using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.Repositories;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The state-holder seam the <see cref="ConditionBuilderViewModel"/> binds to (P1/S8) — the native analogue
/// of the web <c>useGeofences</c> hook the builder composes
/// (web/src/features/automations/pages/ConditionBuilder.tsx). It exposes the single cache-then-network read
/// the surface needs: the geofence list that populates the geofence-condition dropdown. The view never
/// performs HTTP itself; the canonical <see cref="ConditionBuilderSource"/> (or a test fake) drives this.
/// </summary>
public interface IConditionBuilderSource
{
    /// <summary>
    /// Stream the cache-then-network geofence snapshots, cached first, each already mapped to the
    /// <see cref="GeofenceOption"/> read-model (web <c>useGeofences().data</c>).
    /// </summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeofenceOption>>> StreamGeofencesAsync(
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IConditionBuilderSource"/> — the native data adapter for the geofence
/// dropdown. It runs the shared <see cref="ILocationRepository.GetGeofencesAsync"/> cache-then-network read
/// (<c>GET /geofences</c>) and maps each raw-JSON emission to a typed geofence-option list via
/// <see cref="GeofenceOption.ParseList"/>, preserving the cache-then-network status so the view-model can
/// reflect loading / cached / stale / offline / error faithfully. No HTTP touches the view.
/// </summary>
public sealed class ConditionBuilderSource : IConditionBuilderSource
{
    private readonly ILocationRepository _locations;

    /// <summary>Creates the source over the shared location repository.</summary>
    /// <param name="locations">The cache-then-network location/geofence repository.</param>
    public ConditionBuilderSource(ILocationRepository locations)
    {
        ArgumentNullException.ThrowIfNull(locations);
        _locations = locations;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeofenceOption>>> StreamGeofencesAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await foreach (var result in _locations.GetGeofencesAsync(cancellationToken).ConfigureAwait(false))
        {
            yield return Map(result);
        }
    }

    /// <summary>
    /// Map a raw-JSON geofence emission to the typed option list while preserving its cache-then-network
    /// status, fetch time, staleness and error. Only the value-bearing states (cached / refreshing / loaded /
    /// offline) parse the payload; the loading / empty / error states carry no value. The status is the
    /// authority here — a <see cref="JsonElement"/> is a value type, so a "no value" emission still surfaces a
    /// defaulted (<see cref="JsonValueKind.Undefined"/>) element rather than null.
    /// </summary>
    public static RepositoryResult<IReadOnlyList<GeofenceOption>> Map(RepositoryResult<JsonElement> result)
    {
        ArgumentNullException.ThrowIfNull(result);

        IReadOnlyList<GeofenceOption>? value = result.Status switch
        {
            LoadStatus.Cached or LoadStatus.Refreshing or LoadStatus.Loaded or LoadStatus.Offline =>
                GeofenceOption.ParseList(result.Value),
            _ => null,
        };

        return new RepositoryResult<IReadOnlyList<GeofenceOption>>(
            result.Status, value, result.FetchedAt, result.IsStale, result.Error);
    }
}
