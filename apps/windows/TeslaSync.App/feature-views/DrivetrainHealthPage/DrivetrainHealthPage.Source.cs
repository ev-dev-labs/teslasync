using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The five-source data port the <see cref="DrivetrainHealthPageViewModel"/> binds to (P1/S8 state-holder
/// seam). It yields one combined <see cref="DrivetrainHealthPageData"/> — the parsed drivetrain-health body
/// (the gating read, web <c>useDrivetrainHealth</c>) plus the recent-drives (web <c>useDrives</c>), lifetime
/// driving stats (web <c>useDrivingStats</c>), motor-history (web <c>useMotorHistory</c>) and latest live-motor
/// (web <c>useMotorLatest</c>) reads the page's child props are derived from. The view never performs HTTP
/// itself; the concrete <see cref="DrivetrainHealthClientFeed"/> (or a test fake) drives this.
/// </summary>
public interface IDrivetrainHealthFeed
{
    /// <summary>Fetch the combined five-source drivetrain-health snapshot for the active vehicle.</summary>
    /// <param name="cancellationToken">Cancels the in-flight reads.</param>
    /// <returns>The combined, fully parsed snapshot.</returns>
    Task<DrivetrainHealthPageData> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The empty <see cref="IDrivetrainHealthFeed"/> — the default with no selected vehicle (web disabled query).
/// Always yields <see cref="DrivetrainHealthPageData.Empty"/> so the page renders its friendly empty surface
/// without HTTP. This is the feed the shell registration uses until a DI host supplies the client-backed feed.
/// </summary>
public sealed class EmptyDrivetrainHealthFeed : IDrivetrainHealthFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyDrivetrainHealthFeed Instance { get; } = new();

    private EmptyDrivetrainHealthFeed()
    {
    }

    /// <inheritdoc />
    public Task<DrivetrainHealthPageData> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(DrivetrainHealthPageData.Empty);
}

/// <summary>
/// The generated-client-backed <see cref="IDrivetrainHealthFeed"/> — the native data adapter for the
/// Drivetrain-Health page (ADR-004). It binds to the generated OpenAPI contract client for the five reads the
/// web page performs, all scoped to the active vehicle by the snake_case <c>vehicle_id</c> query parameter:
/// <c>GET /drivetrain/health</c> (<see cref="DrivetrainHealthRegistration.DrivetrainHealthOperation"/>, web
/// <c>useDrivetrainHealth</c>) is the gating read whose failure surfaces the page error, while the four
/// supplementary reads — <c>GET /drives</c>, <c>GET /drives/stats</c>, <c>GET /motor</c> and
/// <c>GET /motor/latest</c> — are best-effort: a transport failure degrades each to its empty default (the web
/// children simply render the em-dash) and never sinks the page. The raw JSON round-trips through the tolerant
/// parsers so the snake_case wire shape is preserved losslessly; no HTTP touches the view.
/// </summary>
public sealed class DrivetrainHealthClientFeed : IDrivetrainHealthFeed
{
    private const string VehicleQueryParam = "vehicle_id";
    private const string LimitQueryParam = "limit";

    private readonly IApiClient _api;
    private readonly long _vehicleId;

    /// <summary>Creates the feed over the generated contract client and the active vehicle id.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    public DrivetrainHealthClientFeed(IApiClient api, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async Task<DrivetrainHealthPageData> FetchAsync(CancellationToken cancellationToken)
    {
        // The gating read (web useDrivetrainHealth): a failure here propagates to the page error surface.
        var healthRequest = new ApiRequest(DrivetrainHealthRegistration.DrivetrainHealthOperation, Query: VehicleQuery());
        JsonElement health = await _api.SendAsync<JsonElement>(healthRequest, cancellationToken).ConfigureAwait(false);

        // The four supplementary reads (web useDrives / useDrivingStats / useMotorHistory / useMotorLatest) are
        // best-effort: a failure degrades to the empty default exactly like the web children's em-dash fallback.
        JsonElement drives = await TryFetchAsync(
            new ApiRequest(DrivetrainHealthRegistration.DrivesOperation, Query: VehicleQuery()),
            cancellationToken).ConfigureAwait(false);
        JsonElement stats = await TryFetchAsync(
            new ApiRequest(DrivetrainHealthRegistration.DrivingStatsOperation, Query: VehicleQuery()),
            cancellationToken).ConfigureAwait(false);
        JsonElement motorHistory = await TryFetchAsync(
            new ApiRequest(DrivetrainHealthRegistration.MotorHistoryOperation, Query: MotorHistoryQuery()),
            cancellationToken).ConfigureAwait(false);
        JsonElement motorLatest = await TryFetchAsync(
            new ApiRequest(DrivetrainHealthRegistration.MotorLatestOperation, Query: VehicleQuery()),
            cancellationToken).ConfigureAwait(false);

        return DrivetrainHealthPageData.Compose(health, drives, stats, motorHistory, motorLatest);
    }

    private async Task<JsonElement> TryFetchAsync(ApiRequest request, CancellationToken cancellationToken)
    {
        try
        {
            return await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        }
        catch (ApiException)
        {
            // Best-effort supplementary read — degrade to the empty default (web child em-dash fallback).
            return default;
        }
    }

    private Dictionary<string, object?> VehicleQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
    };

    private Dictionary<string, object?> MotorHistoryQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
        [LimitQueryParam] = DrivetrainHealthRegistration.MotorHistoryLimit,
    };
}

/// <summary>
/// A page-owned <see cref="ILiveMotorStatusSource"/> that replays the single motor reading the page already
/// fetched (web parity: the page fetches <c>useMotorLatest</c> once and passes <c>motorLatest</c> down as a
/// prop). It yields one cache-then-network emission — <see cref="RepositoryResult{T}.Loaded"/> when a reading
/// is present, else <see cref="RepositoryResult{T}.Empty"/> — so the child renders from the page's snapshot
/// without a second HTTP round-trip.
/// </summary>
internal sealed class StaticLiveMotorStatusSource : TeslaSync.App.FeatureViews.ILiveMotorStatusSource
{
    private readonly RepositoryResult<TeslaSync.App.FeatureViews.MotorLiveReading> _result;

    public StaticLiveMotorStatusSource(TeslaSync.App.FeatureViews.MotorLiveReading? reading, DateTimeOffset fetchedAt) =>
        _result = reading is null
            ? RepositoryResult<TeslaSync.App.FeatureViews.MotorLiveReading>.Empty(fetchedAt)
            : RepositoryResult<TeslaSync.App.FeatureViews.MotorLiveReading>.Loaded(reading, fetchedAt);

    public async IAsyncEnumerable<RepositoryResult<TeslaSync.App.FeatureViews.MotorLiveReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask.ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        yield return _result;
    }
}

/// <summary>
/// A page-owned <see cref="ITorqueHistoryChartSource"/> that replays the motor-history torque samples the page
/// already fetched (web parity: the page's <c>motorChartData</c> memo feeds <c>TorqueHistoryChart</c>). It
/// yields one cache-then-network emission so the child renders from the page snapshot without a second read.
/// </summary>
internal sealed class StaticTorqueHistoryChartSource : ITorqueHistoryChartSource
{
    private readonly RepositoryResult<IReadOnlyList<MotorTorqueSample>> _result;

    public StaticTorqueHistoryChartSource(IReadOnlyList<MotorTorqueSample> samples, DateTimeOffset fetchedAt) =>
        _result = samples.Count == 0
            ? RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Empty(fetchedAt)
            : RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Loaded(samples, fetchedAt);

    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<MotorTorqueSample>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask.ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        yield return _result;
    }
}

/// <summary>
/// A page-owned <see cref="ITemperatureMetricCardsSource"/> that replays the drivetrain-health snapshot (with
/// the resolved peak power) the page already fetched, so the six metric tiles render from the page snapshot
/// without a second HTTP round-trip (web parity: the page passes <c>sensors</c> / <c>peakPower</c> as props).
/// </summary>
internal sealed class StaticTemperatureMetricCardsSource : ITemperatureMetricCardsSource
{
    private readonly RepositoryResult<TemperatureMetricCardsSnapshot> _result;

    public StaticTemperatureMetricCardsSource(TemperatureMetricCardsSnapshot snapshot, DateTimeOffset fetchedAt) =>
        _result = RepositoryResult<TemperatureMetricCardsSnapshot>.Loaded(snapshot, fetchedAt);

    public async IAsyncEnumerable<RepositoryResult<TemperatureMetricCardsSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask.ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        yield return _result;
    }
}

/// <summary>
/// A page-owned <see cref="IDetailCardsSource"/> that replays the drivetrain detail snapshot (health temps plus
/// the resolved power summary and lifetime stats) the page already fetched, so the two cards render from the
/// page snapshot without a second HTTP round-trip (web parity: the page passes <c>health</c> / <c>peakPower</c>
/// / <c>avgPowerMax</c> / <c>minRegenPower</c> / <c>stats</c> as props).
/// </summary>
internal sealed class StaticDetailCardsSource : IDetailCardsSource
{
    private readonly RepositoryResult<DetailCardsSnapshot> _result;

    public StaticDetailCardsSource(DetailCardsSnapshot snapshot, DateTimeOffset fetchedAt) =>
        _result = RepositoryResult<DetailCardsSnapshot>.Loaded(snapshot, fetchedAt);

    public async IAsyncEnumerable<RepositoryResult<DetailCardsSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask.ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        yield return _result;
    }
}

/// <summary>
/// A page-owned <see cref="IHealthRecommendationsSource"/> that replays the drivetrain-health level the page
/// already fetched, so the recommendations list renders from the page snapshot without a second HTTP round-trip
/// (web parity: the page passes <c>overallHealth</c> as a prop). An empty snapshot (no level) yields the
/// child's empty state, mirroring the web page's gate.
/// </summary>
internal sealed class StaticHealthRecommendationsSource : IHealthRecommendationsSource
{
    private readonly RepositoryResult<DrivetrainHealthSnapshot> _result;

    public StaticHealthRecommendationsSource(DrivetrainHealthSnapshot snapshot, DateTimeOffset fetchedAt) =>
        _result = snapshot.HasData
            ? RepositoryResult<DrivetrainHealthSnapshot>.Loaded(snapshot, fetchedAt)
            : RepositoryResult<DrivetrainHealthSnapshot>.Empty(fetchedAt);

    public async IAsyncEnumerable<RepositoryResult<DrivetrainHealthSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask.ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        yield return _result;
    }
}
