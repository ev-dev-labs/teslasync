using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The data port the <see cref="JobProgressDrawerViewModel"/> binds to (P1/S8 state-holder seam). It
/// exposes the single cache-then-network sequence the web <c>JobProgressDrawer</c> composes — the
/// <c>useExportJobs</c> list reading <c>GET /export/jobs</c> (web/src/api/hooks/useExports.ts) — plus the
/// API origin used to build a finished job's download URI (web <c>exportDownloadUrl</c>). The view never
/// performs HTTP itself; the concrete <see cref="JobProgressDrawerSource"/> (or a test fake) drives this.
/// </summary>
public interface IJobProgressDrawerSource
{
    /// <summary>The API origin a finished job's artifact is downloaded from, or <see langword="null"/> when unknown.</summary>
    Uri? DownloadBaseUri { get; }

    /// <summary>Stream the cache-then-network export-job snapshots (web <c>useExportJobs</c>).</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<ExportJobRecord>>> StreamJobsAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IJobProgressDrawerSource"/> — the native data adapter for the Job
/// Progress drawer. It runs one cache-then-network read through the shared
/// <see cref="CacheThenNetworkEngine"/> against the generated export-jobs operation
/// (<see cref="JobProgressDrawerRegistration.JobsOperationId"/>, <c>GET /export/jobs</c>), mirroring the
/// web component's single TanStack query (<c>['export-jobs']</c>). Each emission's raw JSON is parsed into
/// the normalised job list via <see cref="JobProgressDrawerResultMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class JobProgressDrawerSource : IJobProgressDrawerSource
{
    private const string CacheKey = "export:jobs:drawer";

    private static readonly ApiRequest JobsRequest = new(JobProgressDrawerRegistration.JobsOperationId);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly Uri? _downloadBase;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings and the download origin).</param>
    public JobProgressDrawerSource(
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
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ExportJobRecord>>> StreamJobsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(JobsRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return JobProgressDrawerResultMapper.Map(emission);
        }
    }

    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
