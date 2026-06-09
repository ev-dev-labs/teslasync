using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="ExportStatusViewModel"/> binds to (P1/S8 state-holder seam). It exposes
/// the two cache-then-network sequences the web <c>ExportStatusWidget</c> composes — the legacy
/// <c>useExports</c> list and the admin <c>useExportJobs</c> list, both reading <c>GET /export/jobs</c>
/// (web/src/api/hooks/useExports.ts + useAdmin.ts) — plus the API origin used to build a finished job's
/// download URI. The view never performs HTTP itself; the concrete <see cref="ExportStatusSource"/> (or a
/// test fake) drives this.
/// </summary>
public interface IExportStatusSource
{
    /// <summary>The API origin a finished job's artifact is downloaded from, or <see langword="null"/> when unknown.</summary>
    Uri? DownloadBaseUri { get; }

    /// <summary>Stream the cache-then-network legacy export-job snapshots (web <c>useExports</c>).</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<ExportJobRecord>>> StreamPrimaryJobsAsync(CancellationToken cancellationToken = default);

    /// <summary>Stream the cache-then-network admin export-job snapshots (web <c>useExportJobs</c>).</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<ExportJobRecord>>> StreamAdminJobsAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IExportStatusSource"/> — the native data adapter for the Export
/// Status surface. It runs two independent cache-then-network reads through the shared
/// <see cref="CacheThenNetworkEngine"/> against the same generated operation
/// (<see cref="ExportStatusRegistration.JobsOperationId"/>, <c>GET /export/jobs</c>) under distinct cache
/// keys — exactly mirroring the web component's two TanStack queries (<c>['exports']</c> and
/// <c>['export-jobs']</c>). Each emission's raw JSON is parsed into the normalised job list with the
/// per-source status derivation (admin from <c>status</c>, legacy from <c>fsm_state ?? status</c>). No
/// HTTP touches the view.
/// </summary>
public sealed class ExportStatusSource : IExportStatusSource
{
    private const string PrimaryCacheKey = "export:jobs:legacy";
    private const string AdminCacheKey = "export:jobs:admin";

    private static readonly ApiRequest JobsRequest = new(ExportStatusRegistration.JobsOperationId);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly Uri? _downloadBase;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings and the download origin).</param>
    public ExportStatusSource(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
        _downloadBase = options.BaseAddress;
    }

    /// <inheritdoc />
    public Uri? DownloadBaseUri => _downloadBase;

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<IReadOnlyList<ExportJobRecord>>> StreamPrimaryJobsAsync(
        CancellationToken cancellationToken = default) =>
        StreamAsync(PrimaryCacheKey, fromAdmin: false, cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<IReadOnlyList<ExportJobRecord>>> StreamAdminJobsAsync(
        CancellationToken cancellationToken = default) =>
        StreamAsync(AdminCacheKey, fromAdmin: true, cancellationToken);

    private async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ExportJobRecord>>> StreamAsync(
        string cacheKey,
        bool fromAdmin,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(JobsRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return ExportStatusResultMapper.Map(emission, fromAdmin);
        }
    }

    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
