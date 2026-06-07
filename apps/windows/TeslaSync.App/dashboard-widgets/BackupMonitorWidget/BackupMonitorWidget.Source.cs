using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="BackupMonitorViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed <see cref="BackupMonitorSnapshot"/> values — the native analogue
/// of the web component's <c>useBackupRuns</c> hook. The view never performs HTTP itself; the concrete
/// <see cref="BackupMonitorSource"/> (or a test fake) drives this.
/// </summary>
public interface IBackupMonitorSource
{
    /// <summary>Stream the cache-then-network backup-runs snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<BackupMonitorSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IBackupMonitorSource"/> — the native data adapter for the Backup
/// Monitor surface. It is the native analogue of the web component's single <c>useBackupRuns</c> hook: one
/// cache-then-network read of <c>GET /backup/runs</c> (generated operation
/// <see cref="BackupMonitorRegistration.RunsOperationId"/>) through the shared
/// <see cref="CacheThenNetworkEngine"/>, parsing each emission into a <see cref="BackupMonitorSnapshot"/>.
/// The snapshot is cached so the whole surface restores instantly, and no HTTP ever touches the view. An
/// empty runs list is a meaningful value (rendered as its own "no backup data" empty surface, not the
/// engine's generic empty), so the read never treats anything as empty — the view-model derives the
/// Empty / Loaded distinction from the snapshot's content.
/// </summary>
public sealed class BackupMonitorSource : IBackupMonitorSource
{
    private const string CacheKey = "admin:backup-runs";

    private static readonly ApiRequest RunsRequest = new(BackupMonitorRegistration.RunsOperationId);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public BackupMonitorSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<BackupMonitorSnapshot>> StreamAsync(
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

    private async Task<BackupMonitorSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var runs = await _api.SendAsync<JsonElement>(RunsRequest, cancellationToken).ConfigureAwait(false);
        return BackupMonitorSnapshot.FromJson(runs);
    }
}
