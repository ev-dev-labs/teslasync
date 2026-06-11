using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="TelemetryPipelineCardViewModel"/> binds to (P1/S8 state-holder seam). It
/// exposes the two independent cache-then-network reads the web component composes — the Fleet Telemetry
/// streaming status (web <c>useMQTTStatus</c> → <c>GET /telemetry/</c>) and the legacy REST polling-engine
/// status (web <c>useQuery(getPollingStatus)</c> → <c>GET /polling/status</c>). The view never performs HTTP
/// itself; the concrete <see cref="TelemetryPipelineCardSource"/> (or a test fake) drives this.
/// </summary>
public interface ITelemetryPipelineCardSource
{
    /// <summary>Stream the cache-then-network Fleet Telemetry streaming-status snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<TelemetryStreamSnapshot>> StreamStreamingStatusAsync(
        CancellationToken cancellationToken = default);

    /// <summary>Stream the cache-then-network polling-engine-status snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<PollingEngineSnapshot>> StreamPollingStatusAsync(
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ITelemetryPipelineCardSource"/> — the native data adapter for the
/// Telemetry Pipeline surface. It runs two independent cache-then-network reads through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the wire shape round-trips losslessly, then
/// maps each emission to a typed snapshot via <see cref="TelemetryPipelineResultMapper"/>:
/// <list type="bullet">
///   <item>
///     <c>GET /telemetry/</c> via the generated contract client (operation
///     <c>get_api_v1_telemetry</c>) — the Fleet Telemetry streaming status.
///   </item>
///   <item>
///     <c>GET /polling/status</c> via the shared, already-authenticated <see cref="HttpClient"/> pipeline.
///     This route post-dates — and is intentionally absent from — the OpenAPI contract (only
///     <c>/settings/polling-config</c> is generated), so it is reached the same way the Live (SSE) and Push
///     subsystems reach their non-contract routes: through the shared client whose pipeline already carries
///     the auth + resilience handlers. Polling is a secondary enrichment (battery, next-poll, the poll
///     liveness path); a failed read degrades to "polling unavailable / streaming-only", web parity for an
///     <c>undefined</c> polling query.
///   </item>
/// </list>
/// No HTTP touches the view.
/// </summary>
public sealed class TelemetryPipelineCardSource : ITelemetryPipelineCardSource
{
    private const string StreamingOperation = "get_api_v1_telemetry";
    private const string StreamingCacheKey = "telemetry-pipeline:streaming-status";
    private const string PollingCacheKey = "telemetry-pipeline:polling-status";
    private const string PollingPath = "polling/status";

    private static readonly ApiRequest StreamingRequest = new(StreamingOperation);

    private readonly IApiClient _api;
    private readonly HttpClient _http;
    private readonly CacheThenNetworkEngine _engine;
    private readonly ApiClientOptions _options;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, shared HTTP pipeline, engine and options.</summary>
    /// <param name="api">The generated contract client (drives the streaming read).</param>
    /// <param name="http">The shared, authenticated <see cref="HttpClient"/> (drives the non-contract polling read).</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (base address, version segment, JSON settings).</param>
    public TelemetryPipelineCardSource(
        IApiClient api,
        HttpClient http,
        CacheThenNetworkEngine engine,
        ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _http = http;
        _engine = engine;
        _options = options;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<TelemetryStreamSnapshot>> StreamStreamingStatusAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            StreamingCacheKey,
            ct => _api.SendAsync<JsonElement>(StreamingRequest, ct),
            IsAbsentBody,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return TelemetryPipelineResultMapper.MapStreaming(emission);
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<PollingEngineSnapshot>> StreamPollingStatusAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            PollingCacheKey,
            FetchPollingAsync,
            IsAbsentBody,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return TelemetryPipelineResultMapper.MapPolling(emission);
        }
    }

    private async Task<JsonElement> FetchPollingAsync(CancellationToken cancellationToken)
    {
        // Version the route exactly once (no double prefix), then resolve it against the client base address.
        string versioned = _options.VersionBasePath.TrimEnd('/') + "/" + PollingPath;
        var uri = new Uri(_options.BaseAddress, versioned);

        using var response = await _http
            .GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
            .ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        return await JsonSerializer.DeserializeAsync<JsonElement>(stream, _json, cancellationToken).ConfigureAwait(false);
    }

    // Only a null/undefined body carries no status; a disconnected stream or a disabled polling engine is a
    // meaningful, renderable object that must NOT collapse to the empty state.
    private static bool IsAbsentBody(JsonElement element) =>
        element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;
}
