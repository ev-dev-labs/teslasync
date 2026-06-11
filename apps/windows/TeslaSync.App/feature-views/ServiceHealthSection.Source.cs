using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="ServiceHealthViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the web component's single <c>useQuery({ queryFn: getTelemetryStatus, refetchInterval: 2_000 })</c>
/// (web/src/features/system/components/status/ServiceHealthSection.tsx → web/src/api/devtools.ts). It exposes
/// the one cache-then-network read of the Fleet Telemetry status feed. The view never performs HTTP itself;
/// the concrete <see cref="ServiceHealthSource"/> (or a test fake) drives this.
/// </summary>
public interface IServiceHealthSource
{
    /// <summary>Stream the cache-then-network telemetry-status snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<ServiceHealthSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IServiceHealthSource"/> — the native data adapter for the Service Health
/// surface. It runs one cache-then-network read through the shared <see cref="CacheThenNetworkEngine"/>,
/// caching the raw JSON so the snake_case wire shape round-trips losslessly, then maps each emission to a
/// typed snapshot via <see cref="ServiceHealthResultMapper"/>: <c>GET /telemetry</c> (generated operation
/// <c>get_api_v1_telemetry</c>, the web <c>getTelemetryStatus</c> call). No HTTP touches the view.
/// </summary>
public sealed class ServiceHealthSource : IServiceHealthSource
{
    /// <summary>The generated OpenAPI operation id for the Fleet Telemetry status feed (<c>GET /telemetry</c>).</summary>
    public const string TelemetryOperation = "get_api_v1_telemetry";

    private const string CacheKey = "telemetry:status";

    private static readonly ApiRequest TelemetryRequest = new(TelemetryOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public ServiceHealthSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<ServiceHealthSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(TelemetryRequest, ct),
            IsNonObject,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return ServiceHealthResultMapper.Map(emission);
        }
    }

    // The /telemetry endpoint returns a JSON object envelope; a null / non-object body carries no usable data
    // (web parity: the query resolves with undefined → the section renders its "No telemetry data" surface).
    private static bool IsNonObject(JsonElement element) => element.ValueKind != JsonValueKind.Object;
}
