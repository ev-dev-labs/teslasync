using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.FeatureViews;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The data port the <see cref="TripReplayPageViewModel"/> reads through — the native parity of the web page's
/// single hook (web/src/features/trips/pages/TripReplayPage.tsx): <c>useDrive(id)</c>, the required
/// <c>GET /drives/{id}</c> read whose <c>positions</c> / <c>telemetry</c> arrays the page merges into the replay
/// samples. The view never performs HTTP itself; the default <see cref="EmptyTripReplayPageFeed"/> resolves to the
/// empty state and the generated-client-backed <see cref="TripReplayPageClientFeed"/> binds the OpenAPI contract
/// client (ADR-004). A failing read throws so the view-model can surface the never-blank error branch.
/// </summary>
public interface ITripReplayPageFeed
{
    /// <summary>Resolve the drive snapshot for a drive id (web's <c>useDrive(id)</c>).</summary>
    /// <param name="driveId">The drive id from the <c>drives/:id/replay</c> route.</param>
    /// <param name="cancellationToken">Cancels the read.</param>
    Task<TripReplayPageSnapshot> FetchAsync(long driveId, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to the empty snapshot (the loading/empty state the shell shows by default).</summary>
public sealed class EmptyTripReplayPageFeed : ITripReplayPageFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyTripReplayPageFeed Instance { get; } = new();

    private EmptyTripReplayPageFeed()
    {
    }

    /// <inheritdoc />
    public Task<TripReplayPageSnapshot> FetchAsync(long driveId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(TripReplayPageSnapshot.Empty);
    }
}

/// <summary>
/// The generated-client-backed <see cref="ITripReplayPageFeed"/> — the native data adapter for the Trip-Replay
/// page (ADR-004). It binds to the generated OpenAPI contract client for the single read the web page performs
/// (<see cref="TripReplayPageRegistration.DriveOperation"/> — <c>GET /drives/{driveID}</c>); its failure surfaces
/// the page error. The response round-trips through the tolerant <see cref="TripReplayDrive"/> parser so the
/// snake_case wire shape (positions + telemetry) is preserved losslessly; no HTTP touches the view.
/// </summary>
public sealed class TripReplayPageClientFeed : ITripReplayPageFeed
{
    private const string DriveIdParam = "driveID";

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public TripReplayPageClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<TripReplayPageSnapshot> FetchAsync(long driveId, CancellationToken cancellationToken)
    {
        var request = ApiRequest.WithPath(
            TripReplayPageRegistration.DriveOperation,
            DriveIdParam,
            driveId.ToString(CultureInfo.InvariantCulture));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return new TripReplayPageSnapshot(TripReplayDrive.FromJson(json));
    }
}

/// <summary>
/// The no-data <see cref="ITripReplayMapSource"/> the page mounts its <see cref="TripReplayMap"/> child over when
/// it has no live data layer wired (the shell's default registration). It streams a single
/// <see cref="RepositoryResult{T}.Empty()"/> so the map renders its "no position data" empty surface rather than a
/// blank box — the same never-blank contract the live source honours.
/// </summary>
public sealed class EmptyTripReplayMapSource : ITripReplayMapSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyTripReplayMapSource Instance { get; } = new();

    private EmptyTripReplayMapSource()
    {
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<TripReplayMapData>> StreamAsync(CancellationToken cancellationToken = default) =>
        Stream(cancellationToken);

    private static async IAsyncEnumerable<RepositoryResult<TripReplayMapData>> Stream(
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<TripReplayMapData>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>
/// The no-data <see cref="ITripReplayChartsSource"/> the page mounts its <see cref="TripReplayCharts"/> child over
/// when it has no live data layer wired (the shell's default registration). It streams a single
/// <see cref="RepositoryResult{T}.Empty()"/> so the timeline renders its "no telemetry data available" empty
/// surface rather than a blank box.
/// </summary>
public sealed class EmptyTripReplayChartsSource : ITripReplayChartsSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyTripReplayChartsSource Instance { get; } = new();

    private EmptyTripReplayChartsSource()
    {
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<IReadOnlyList<TripReplaySample>>> StreamAsync(
        CancellationToken cancellationToken = default) => Stream(cancellationToken);

    private static async IAsyncEnumerable<RepositoryResult<IReadOnlyList<TripReplaySample>>> Stream(
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<IReadOnlyList<TripReplaySample>>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}
