using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="DataPipelineSectionViewModel"/> binds to (P1/S8 state-holder seam). It
/// exposes the two independent cache-then-network reads the web component composes — the compression-savings
/// rollup (web <c>useQuery(getCompressionStats)</c> → <c>GET /system/compression-stats</c>) and the
/// export-job queue (web <c>useQuery(getExportJobs())</c> → <c>GET /export/jobs?limit=50&amp;offset=0</c>).
/// The view never performs HTTP itself; the concrete <see cref="DataPipelineSectionSource"/> (or a test fake)
/// drives this.
/// </summary>
public interface IDataPipelineSectionSource
{
    /// <summary>Stream the cache-then-network compression-savings snapshots, cached first.</summary>
    /// <param name="cancellationToken">Cancels the stream.</param>
    IAsyncEnumerable<RepositoryResult<CompressionStatsSnapshot>> StreamCompressionAsync(
        CancellationToken cancellationToken = default);

    /// <summary>Stream the cache-then-network export-job-queue snapshots, cached first.</summary>
    /// <param name="cancellationToken">Cancels the stream.</param>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<ExportJobSnapshot>>> StreamExportJobsAsync(
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IDataPipelineSectionSource"/> — the native data adapter for the Data
/// Pipeline surface. It runs two independent cache-then-network reads through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips
/// losslessly, then maps each emission to a typed snapshot via <see cref="DataPipelineSectionResultMapper"/>:
/// <list type="bullet">
///   <item>
///     <c>GET /system/compression-stats</c> via the generated contract client (operation
///     <c>get_api_v1_system_compression_stats</c>) — the compression-savings rollup.
///   </item>
///   <item>
///     <c>GET /export/jobs?limit=50&amp;offset=0</c> via the generated contract client (operation
///     <see cref="Operations.Exports.Jobs"/>, the web <c>getExportJobs()</c> default page) — the export-job
///     queue.
///   </item>
/// </list>
/// Neither endpoint is vehicle-scoped, so no vehicle resolution is required. No HTTP touches the view.
/// </summary>
public sealed class DataPipelineSectionSource : IDataPipelineSectionSource
{
    /// <summary>The export-jobs page size (web <c>getExportJobs()</c> defaults <c>limit || 50</c>).</summary>
    public const int ExportJobsLimit = 50;

    // The compression-stats route post-dates the centralized Operations catalog, so its operation id is held
    // locally (the TelemetryPipelineCard pattern) rather than added to the shared Operations table; it still
    // resolves against the generated endpoint table.
    private const string CompressionOperation = "get_api_v1_system_compression_stats";

    private const string CompressionCacheKey = "system:compression-stats";
    private const string ExportJobsCacheKey = "data-pipeline:export-jobs:50";

    private static readonly ApiRequest CompressionRequest = new(CompressionOperation);

    private static readonly ApiRequest ExportJobsRequest = new(
        Operations.Exports.Jobs,
        Query: new Dictionary<string, object?> { ["limit"] = ExportJobsLimit, ["offset"] = 0 });

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public DataPipelineSectionSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<CompressionStatsSnapshot>> StreamCompressionAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = Stream(CompressionCacheKey, CompressionRequest, IsNullBody, cancellationToken);
        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return DataPipelineSectionResultMapper.MapCompression(emission);
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ExportJobSnapshot>>> StreamExportJobsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = Stream(ExportJobsCacheKey, ExportJobsRequest, IsEmptyArray, cancellationToken);
        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return DataPipelineSectionResultMapper.MapExportJobs(emission);
        }
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> Stream(
        string cacheKey,
        ApiRequest request,
        Func<JsonElement, bool> isEmpty,
        CancellationToken cancellationToken) =>
        _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            isEmpty,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

    // Compression: the backend returns a populated object (a fresh install renders as zeros), so only a
    // null / absent body counts as empty — mirroring the web outer `compression && …` gate.
    private static bool IsNullBody(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        _ => false,
    };

    // Export jobs are a JSON array; a null body or an empty array carries no rows (web `exportJobs.length`).
    private static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
