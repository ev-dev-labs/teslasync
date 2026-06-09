using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The data port the <see cref="OverviewTabViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed fleet-analytics snapshots — the native analogue of the web
/// component's data source, the <c>useFleetAnalytics({ start, end })</c> query whose <c>data</c> is passed
/// into <c>features/analytics/components/analytics/OverviewTab.tsx</c>. The view never performs HTTP itself;
/// the concrete <see cref="OverviewTabSource"/> (or a test fake) drives this.
/// </summary>
public interface IOverviewTabSource
{
    /// <summary>Stream the cache-then-network OverviewTab snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<OverviewData>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registration metadata for the OverviewTab surface. The diagnostics <see cref="Slug"/> is the
/// surface identifier emitted with the <c>view.opened</c> event (P1/S11 diagnostics contract).
/// </summary>
public static class OverviewTabRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "OverviewTab";

    /// <summary>Cache key for the fleet-analytics read backing this surface.</summary>
    public const string CacheKey = "analytics:overview-tab:fleet";
}

/// <summary>
/// PII-safe diagnostics for the OverviewTab surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a fleet metric, VIN or location — so a
/// diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class OverviewTabDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public OverviewTabDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=OverviewTab</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={OverviewTabRegistration.Slug}");
    }
}

/// <summary>
/// The repository-backed <see cref="IOverviewTabSource"/> — the native data adapter for the OverviewTab
/// surface. It runs one cache-then-network read of the fleet analytics rollup (<c>GET /analytics/fleet</c>,
/// generated operation <c>get_api_v1_analytics_fleet</c>, full history — matching the web
/// <c>useFleetAnalytics({ start, end })</c> default that sends no bounds), parsing each raw JSON emission
/// into an <see cref="OverviewData"/> through <see cref="OverviewTabResultMapper"/> so cached content
/// surfaces fast and the header freshness tracks the read. No HTTP touches the view.
/// </summary>
public sealed class OverviewTabSource : IOverviewTabSource
{
    private static readonly ApiRequest FleetRequest = new(Operations.Analytics.Fleet);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public OverviewTabSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<OverviewData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var stream = _engine.StreamAsync<JsonElement>(
            OverviewTabRegistration.CacheKey,
            ct => _api.SendAsync<JsonElement>(FleetRequest, ct),
            IsEmpty,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var raw in stream.ConfigureAwait(false))
        {
            yield return OverviewTabResultMapper.Map(raw);
        }
    }

    // Web parity: in JS any resolved analytics object is truthy (even {}), so only a null/non-object body is
    // treated as "no analytics" — an object with empty arrays still renders the tab (with per-section empties).
    private static bool IsEmpty(JsonElement element) => element.ValueKind != JsonValueKind.Object;
}
