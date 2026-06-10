using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="BackupActionsCardViewModel"/> binds to (P1/S8 state-holder seam). It exposes
/// the two operations the web component composes through its hooks: a cache-then-network read of the backup
/// runs (web <c>useQuery(['backup-runs'])</c> via <c>getBackupRuns</c> → <c>GET /backup/runs</c>) which the
/// native standalone surface adds to render its status content + every load state, and the fire-once quick
/// backup mutation (web <c>useMutation(triggerQuickBackup)</c> → <c>POST /backup/quick</c>). The view never
/// performs HTTP itself; the concrete <see cref="BackupActionsSource"/> (or a test fake) drives this.
/// </summary>
public interface IBackupActionsSource
{
    /// <summary>Stream the cache-then-network backup-status snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<BackupActionsSnapshot>> StreamStatusAsync(
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Trigger a quick backup (<c>POST /backup/quick</c>). Returns success or a classified error — it never
    /// throws for an HTTP fault (web parity: the mutation resolves to a toast, not an unhandled rejection).
    /// </summary>
    Task<QuickBackupOutcome> RunQuickBackupAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IBackupActionsSource"/> — the native data adapter for the backup-actions
/// card. The status read runs one cache-then-network stream of <c>GET /backup/runs</c> (generated operation
/// <see cref="BackupActionsCardRegistration.RunsOperationId"/>) through the shared
/// <see cref="CacheThenNetworkEngine"/>, parsing each emission into a derived
/// <see cref="BackupActionsSnapshot"/> so the whole surface restores instantly from cache. The quick-backup
/// mutation posts to <c>POST /backup/quick</c> (generated operation
/// <see cref="BackupActionsCardRegistration.QuickBackupOperationId"/>) and classifies any fault through the
/// shared <see cref="ApiErrorMapper"/> (so a 401/403 surfaces as <see cref="RepositoryErrorKind.Unauthorized"/>
/// for the permission message, web <c>status === 401 || status === 403</c>). No HTTP ever touches the view.
/// </summary>
public sealed class BackupActionsSource : IBackupActionsSource
{
    private const string CacheKey = "system:backup-actions:runs";

    private static readonly ApiRequest RunsRequest = new(BackupActionsCardRegistration.RunsOperationId);
    private static readonly ApiRequest QuickBackupRequest = new(BackupActionsCardRegistration.QuickBackupOperationId);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public BackupActionsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<BackupActionsSnapshot>> StreamStatusAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var stream = _engine.StreamAsync(
            CacheKey,
            FetchAsync,
            static _ => false,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in stream.ConfigureAwait(false))
        {
            yield return emission;
        }
    }

    /// <inheritdoc />
    public async Task<QuickBackupOutcome> RunQuickBackupAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            // The web card ignores the BackupRun body — it only invalidates queries and toasts on settle.
            _ = await _api.SendAsync<JsonElement>(QuickBackupRequest, cancellationToken).ConfigureAwait(false);
            return QuickBackupOutcome.Ok();
        }
        catch (ApiException ex)
        {
            return QuickBackupOutcome.Fail(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return QuickBackupOutcome.Fail(ApiErrorMapper.Map(ex));
        }
    }

    private async Task<BackupActionsSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var runs = await _api.SendAsync<JsonElement>(RunsRequest, cancellationToken).ConfigureAwait(false);
        return BackupActionsSnapshot.FromJson(runs);
    }
}
