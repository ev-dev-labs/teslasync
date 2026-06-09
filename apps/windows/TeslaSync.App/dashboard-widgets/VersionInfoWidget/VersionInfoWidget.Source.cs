using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading.Channels;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The repository-backed <see cref="IVersionInfoSource"/> — the native data adapter for the Version Info
/// surface. It runs two concurrent cache-then-network reads — the server version rollup
/// (<c>GET /system/version</c>, generated operation <c>get_api_v1_system_version</c>, the web
/// <c>useVersionInfo</c> query, load-bearing) and the telemetry-capture statistics
/// (<c>GET /dev-tools/telemetry-capture/stats</c>, generated operation
/// <c>get_api_v1_dev_tools_telemetry_capture_stats</c>, the web <c>useCaptureStats</c> query) — caching each
/// raw JSON body so the snake_case wire shape round-trips losslessly. Their emissions are combine-latest merged
/// through <see cref="VersionInfoResultMapper.Combine"/> as each settles, so the version read decides
/// loaded/empty/error and a slow / failed capture read only enriches (or silently omits) the stat grid —
/// mirroring the web's version-driven render gate. None of the endpoints are vehicle-scoped, so no vehicle
/// resolution is required. No HTTP touches the view.
/// </summary>
public sealed class VersionInfoSource : IVersionInfoSource
{
    // The web useCaptureStats read hits /dev-tools/telemetry-capture/stats; the generated endpoint table exposes
    // this id but Operations only carries SystemAdmin.Version as a named constant, so the capture-stats id is
    // referenced verbatim here (scoped to this surface). It resolves against
    // TeslaSync.Windows.Generated.Api.ApiEndpoints.
    private const string CaptureStatsOperation = "get_api_v1_dev_tools_telemetry_capture_stats";

    private const string VersionCacheKey = "system:version";
    private const string CaptureCacheKey = "system:capture-stats";

    private static readonly ApiRequest VersionRequest = new(Operations.SystemAdmin.Version);
    private static readonly ApiRequest CaptureRequest = new(CaptureStatsOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public VersionInfoSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    private enum VersionPart
    {
        Version,
        Capture,
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<VersionInfoReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        yield return RepositoryResult<VersionInfoReading>.Loading();

        var channel = Channel.CreateUnbounded<MergeItem>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        var pumpAll = Task.WhenAll(
            PumpAsync(VersionPart.Version, VersionStream(cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(VersionPart.Capture, CaptureStream(cancellationToken), channel.Writer, cancellationToken));

        // Complete the channel once both pumps finish; accessing t.Exception observes any pump fault so the
        // reader surfaces it (and no task goes unobserved). Cancellation is delivered cleanly via ReadAllAsync.
        _ = pumpAll.ContinueWith(
            static (t, writer) => ((ChannelWriter<MergeItem>)writer!).TryComplete(t.Exception),
            channel.Writer,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        var version = RepositoryResult<JsonElement>.Loading();
        var capture = RepositoryResult<JsonElement>.Loading();

        await foreach (var item in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            if (item.Part == VersionPart.Version)
            {
                version = item.Result;
            }
            else
            {
                capture = item.Result;
            }

            // Web parity: the stat grid is an enrichment of the version read, so the capture read never gates
            // content. Hold the skeleton (the Loading already emitted) until the load-bearing version read
            // settles, then fold every emission with whatever the capture read has so far.
            if (version.Status == LoadStatus.Loading)
            {
                continue;
            }

            var captureArg = capture.Status != LoadStatus.Loading ? (RepositoryResult<JsonElement>?)capture : null;
            yield return VersionInfoResultMapper.Combine(version, captureArg);
        }
    }

    private static async Task PumpAsync(
        VersionPart part,
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream,
        ChannelWriter<MergeItem> writer,
        CancellationToken cancellationToken)
    {
        await foreach (var result in stream.ConfigureAwait(false))
        {
            await writer.WriteAsync(new MergeItem(part, result), cancellationToken).ConfigureAwait(false);
        }
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> VersionStream(CancellationToken cancellationToken) =>
        Stream(VersionCacheKey, VersionRequest, cancellationToken);

    private IAsyncEnumerable<RepositoryResult<JsonElement>> CaptureStream(CancellationToken cancellationToken) =>
        Stream(CaptureCacheKey, CaptureRequest, cancellationToken);

    private IAsyncEnumerable<RepositoryResult<JsonElement>> Stream(
        string cacheKey,
        ApiRequest request,
        CancellationToken cancellationToken) =>
        _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyBody,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

    // Web parity: only an absent / null body counts as empty. Each backend always returns a populated object
    // (an idle system renders as zeros / em dashes, not as the empty surface).
    private static bool IsEmptyBody(JsonElement element) =>
        element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;

    private readonly record struct MergeItem(VersionPart Part, RepositoryResult<JsonElement> Result);
}
