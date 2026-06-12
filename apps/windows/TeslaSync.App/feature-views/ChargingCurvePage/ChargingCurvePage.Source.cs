using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The data port the <see cref="ChargingCurvePageViewModel"/> binds to (P1/S8 state-holder seam, ADR-004). It
/// yields the parsed charging-sessions snapshot the web Charging-Curve page reads through its
/// <c>useChargingSessionsPaginated</c> query (web/src/features/charging/pages/ChargingCurvePage.tsx). The view
/// never performs HTTP itself; the concrete <see cref="ChargingCurveClientFeed"/> (or a test fake / the
/// <see cref="EmptyChargingCurveFeed"/> default) drives this.
/// </summary>
public interface IChargingCurveFeed
{
    /// <summary>Fetch the current charging-sessions snapshot for the scoped vehicle.</summary>
    Task<ChargingCurveSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The no-op <see cref="IChargingCurveFeed"/> the page's parameterless constructor binds to before a host
/// wires the generated client — it always resolves the empty snapshot, so the page renders its page-level
/// empty surface rather than a blank region. Shared singleton; immutable and thread-safe.
/// </summary>
public sealed class EmptyChargingCurveFeed : IChargingCurveFeed
{
    /// <summary>The shared instance.</summary>
    public static EmptyChargingCurveFeed Instance { get; } = new();

    private EmptyChargingCurveFeed()
    {
    }

    /// <inheritdoc />
    public Task<ChargingCurveSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(ChargingCurveSnapshot.Empty);
}

/// <summary>
/// The generated-client-backed <see cref="IChargingCurveFeed"/> — the native data adapter for the
/// Charging-Curve page (ADR-004). It runs one read of <c>GET /charging-sessions</c> (generated operation
/// <see cref="ChargingCurveRegistration.Operation"/>) scoped to the active vehicle by the snake_case
/// <c>vehicle_id</c> query parameter — the native analogue of the web page's
/// <c>useSelectedVehicle()</c>-scoped <c>useChargingSessionsPaginated</c> read. The raw JSON round-trips
/// through <see cref="ChargingCurveSnapshot.FromJson"/> so the snake_case wire shape is preserved losslessly;
/// no HTTP touches the view.
/// </summary>
public sealed class ChargingCurveClientFeed : IChargingCurveFeed
{
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IApiClient _api;
    private readonly long _vehicleId;

    /// <summary>Creates the feed over the generated contract client and the active vehicle id.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    public ChargingCurveClientFeed(IApiClient api, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async Task<ChargingCurveSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            ChargingCurveRegistration.Operation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal) { [VehicleQueryParam] = _vehicleId });

        JsonElement json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ChargingCurveSnapshot.FromJson(json);
    }
}

/// <summary>
/// The host dependencies the page threads down to its self-fetching child sections (Summary-stats grid,
/// Session-comparison chart, Speed-trend chart, Time-to-charge section). When supplied (a wired host), each
/// section runs its own cache-then-network charging-sessions read scoped to <see cref="VehicleId"/> through
/// the shared engine; when absent (the page's default / test construction), the sections fall back to their
/// empty surfaces. Mirrors the web page handing its single query result down to those child components.
/// </summary>
/// <param name="Api">The generated contract client.</param>
/// <param name="Engine">The shared cache-then-network read engine.</param>
/// <param name="Options">The shared API client options (JSON settings).</param>
/// <param name="Vehicles">Resolves the primary (or scoped) vehicle for the comparison section.</param>
/// <param name="VehicleId">The active vehicle id the sections scope their reads to.</param>
public sealed record ChargingCurveChildServices(
    IApiClient Api,
    TeslaSync.App.Core.Data.CacheThenNetworkEngine Engine,
    ApiClientOptions Options,
    TeslaSync.App.Core.Widgets.IWidgetVehicleSource Vehicles,
    long VehicleId);

/// <summary>
/// The empty <see cref="ISummaryStatsSource"/> the page hosts the Summary-stats grid over when no host
/// services are wired — it streams a single empty snapshot so the grid renders its zeroed cards rather than a
/// blank region. WinUI-free.
/// </summary>
internal sealed class EmptySummaryStatsSource : ISummaryStatsSource
{
    public static EmptySummaryStatsSource Instance { get; } = new();

    public async IAsyncEnumerable<RepositoryResult<ChargingSummary>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask.ConfigureAwait(false);
        yield return RepositoryResult<ChargingSummary>.Empty();
    }
}

/// <summary>
/// The empty <see cref="ISessionComparisonSource"/> the page hosts the Session-comparison chart over when no
/// host services are wired — it streams a single empty snapshot so the chart renders its friendly empty
/// surface. WinUI-free.
/// </summary>
internal sealed class EmptySessionComparisonSource : ISessionComparisonSource
{
    public static EmptySessionComparisonSource Instance { get; } = new();

    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SessionComparisonSession>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask.ConfigureAwait(false);
        yield return RepositoryResult<IReadOnlyList<SessionComparisonSession>>.Empty();
    }
}

/// <summary>
/// The empty <see cref="ISpeedTrendChartSource"/> the page hosts the Speed-trend chart over when no host
/// services are wired — it streams a single empty snapshot so the chart renders its friendly empty surface.
/// WinUI-free.
/// </summary>
internal sealed class EmptySpeedTrendChartSource : ISpeedTrendChartSource
{
    public static EmptySpeedTrendChartSource Instance { get; } = new();

    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SpeedTrendSession>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask.ConfigureAwait(false);
        yield return RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Empty();
    }
}

/// <summary>
/// The empty <see cref="ITimeToChargeSource"/> the page hosts the Time-to-charge section over when no host
/// services are wired — it streams a single empty snapshot so the section renders its friendly empty surface.
/// WinUI-free.
/// </summary>
internal sealed class EmptyTimeToChargeSource : ITimeToChargeSource
{
    public static EmptyTimeToChargeSource Instance { get; } = new();

    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask.ConfigureAwait(false);
        yield return RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.Empty();
    }
}
