using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Trips;

/// <summary>
/// The data port the <see cref="TripDetailPageViewModel"/> reads through — the native parity of the web page's
/// single hook (web/src/features/trips/pages/TripDetailPage.tsx): <c>useTrip</c> (the required
/// <c>GET /trips/{id}</c> read). The view never performs HTTP itself; the default
/// <see cref="EmptyTripDetailPageFeed"/> resolves to the empty state and the generated-client-backed
/// <see cref="TripDetailPageClientFeed"/> binds the OpenAPI contract client (ADR-004). A failing read throws so
/// the view-model can surface the never-blank error branch — which is the web page's normal behaviour here, since
/// the Go router currently registers only <c>GET /trips</c> (the <c>useTrip</c> hook is documented as deprecated /
/// 404-bound and its consumer renders the error gracefully).
/// </summary>
public interface ITripDetailPageFeed
{
    /// <summary>Resolve the single-source snapshot for a trip id (web's <c>useTrip</c>).</summary>
    Task<TripDetailSnapshot> FetchAsync(long tripId, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to the empty snapshot (the loading/empty state the shell shows by default).</summary>
public sealed class EmptyTripDetailPageFeed : ITripDetailPageFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyTripDetailPageFeed Instance { get; } = new();

    private EmptyTripDetailPageFeed()
    {
    }

    /// <inheritdoc />
    public Task<TripDetailSnapshot> FetchAsync(long tripId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(TripDetailSnapshot.Empty);
    }
}

/// <summary>
/// The generated-client-backed <see cref="ITripDetailPageFeed"/> — the native data adapter for the Trip-detail
/// page (ADR-004). It binds to the generated OpenAPI contract client for the single read the web page performs.
/// The trip read (<see cref="TripDetailPageRegistration.DetailOperation"/>) is the primary query whose failure
/// surfaces the page error. The response round-trips through the tolerant <see cref="TripData"/> parser so the
/// snake_case wire shape is preserved losslessly; no HTTP touches the view.
/// </summary>
public sealed class TripDetailPageClientFeed : ITripDetailPageFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public TripDetailPageClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<TripDetailSnapshot> FetchAsync(long tripId, CancellationToken cancellationToken)
    {
        var request = ApiRequest.WithPath(
            TripDetailPageRegistration.DetailOperation,
            TripDetailPageRegistration.TripIdParam,
            tripId.ToString(CultureInfo.InvariantCulture));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        TripData? trip = TripData.FromJson(json);

        return new TripDetailSnapshot(trip);
    }
}
