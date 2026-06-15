using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The typed write payload for a backup-config create / update — the native mirror of the web
/// <c>ConfigFormData</c> (web/src/features/admin/pages/BackupRestorePage.tsx). It carries the same snake_case
/// fields the Go handler reads; <see cref="ToBody"/> emits the wire object exactly as the web's
/// <c>JSON.stringify(body)</c> does. Pure data.
/// </summary>
public sealed record BackupConfigWrite(
    string Name,
    bool Enabled,
    string BackupType,
    int FrequencyDays,
    int MaxRetention,
    string Provider,
    IReadOnlyDictionary<string, string> ProviderConfig,
    bool Compress,
    bool Encrypt)
{
    /// <summary>The default new-config form values (web <c>EMPTY_FORM</c>).</summary>
    public static BackupConfigWrite Empty { get; } = new(
        Name: string.Empty,
        Enabled: true,
        BackupType: "full",
        FrequencyDays: 1,
        MaxRetention: 7,
        Provider: "local",
        ProviderConfig: new Dictionary<string, string>(StringComparer.Ordinal) { ["path"] = "/backups" },
        Compress: true,
        Encrypt: false);

    /// <summary>Seed a write payload from an existing config (web <c>openEdit</c>).</summary>
    public static BackupConfigWrite FromConfig(BackupConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);
        return new BackupConfigWrite(
            Name: config.Name,
            Enabled: config.Enabled,
            BackupType: config.BackupType,
            FrequencyDays: config.FrequencyDays,
            MaxRetention: config.MaxRetention,
            Provider: config.Provider,
            ProviderConfig: new Dictionary<string, string>(config.ProviderConfig, StringComparer.Ordinal),
            Compress: config.Compress,
            Encrypt: config.Encrypt);
    }

    /// <summary>The snake_case JSON body the Go handler reads (web <c>JSON.stringify(body)</c>).</summary>
    public IReadOnlyDictionary<string, object?> ToBody() => new Dictionary<string, object?>(StringComparer.Ordinal)
    {
        ["name"] = Name,
        ["enabled"] = Enabled,
        ["backup_type"] = BackupType,
        ["frequency_days"] = FrequencyDays,
        ["max_retention"] = MaxRetention,
        ["provider"] = Provider,
        ["provider_config"] = ProviderConfig,
        ["compress"] = Compress,
        ["encrypt"] = Encrypt,
    };
}

/// <summary>
/// The data port the <see cref="BackupRestorePageViewModel"/> reads the configs / runs list through and writes
/// the create / update / delete / trigger / quick-backup / verify mutations back through — the native parity of
/// the web hooks the page binds (web/src/features/admin/pages/BackupRestorePage.tsx): <c>useQuery(['backup-configs'])</c>,
/// <c>useQuery(['backup-runs'])</c>, the create / update / delete / trigger / quick-backup mutations and the
/// verify / preview reads. The view never performs HTTP itself; the default <see cref="EmptyBackupFeed"/> resolves
/// to the empty state and the generated-client-backed <see cref="BackupClientFeed"/> binds to the <c>/backup</c>
/// endpoints (ADR-004).
/// </summary>
public interface IBackupFeed
{
    /// <summary>Resolve the config list (web <c>useQuery(['backup-configs']) → GET /backup/configs</c>).</summary>
    Task<IReadOnlyList<BackupConfig>> FetchConfigsAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the run history (web <c>useQuery(['backup-runs']) → GET /backup/runs</c>).</summary>
    Task<IReadOnlyList<BackupRun>> FetchRunsAsync(CancellationToken cancellationToken);

    /// <summary>Create a config (web <c>createMutation → POST /backup/configs</c>).</summary>
    Task CreateConfigAsync(BackupConfigWrite write, CancellationToken cancellationToken);

    /// <summary>Update a config (web <c>updateMutation → PUT /backup/configs/{id}</c>).</summary>
    Task UpdateConfigAsync(long id, BackupConfigWrite write, CancellationToken cancellationToken);

    /// <summary>Delete a config (web <c>deleteMutation → DELETE /backup/configs/{id}</c>).</summary>
    Task DeleteConfigAsync(long id, CancellationToken cancellationToken);

    /// <summary>Trigger a config's backup (web <c>triggerMutation → POST /backup/configs/{id}/trigger</c>).</summary>
    Task TriggerConfigAsync(long id, CancellationToken cancellationToken);

    /// <summary>Run a quick backup (web <c>quickBackupMutation → POST /backup/quick</c>).</summary>
    Task QuickBackupAsync(CancellationToken cancellationToken);

    /// <summary>Verify a run's checksum (web <c>verifyMutation → POST /backup/runs/{id}/verify</c>); returns true when intact.</summary>
    Task<bool> VerifyRunAsync(long id, CancellationToken cancellationToken);

    /// <summary>Load a restore preview (web <c>handlePreview → GET /backup/runs/{id}/preview</c>).</summary>
    Task<RestorePreview> PreviewRunAsync(long id, CancellationToken cancellationToken);

    /// <summary>
    /// The absolute download URL for a completed run (web <c>handleDownload → window.open(`${apiBase}/api/v1/backup/runs/{id}/download`)</c>),
    /// or null when no backend base is configured (the default empty feed). The view launches it via the OS.
    /// </summary>
    Uri? GetDownloadUri(long runId);
}

/// <summary>The default feed — resolves to no data and no-ops every mutation (the empty data state).</summary>
public sealed class EmptyBackupFeed : IBackupFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyBackupFeed Instance { get; } = new();

    private EmptyBackupFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<BackupConfig>> FetchConfigsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<BackupConfig>>(Array.Empty<BackupConfig>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<BackupRun>> FetchRunsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<BackupRun>>(Array.Empty<BackupRun>());
    }

    /// <inheritdoc />
    public Task CreateConfigAsync(BackupConfigWrite write, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task UpdateConfigAsync(long id, BackupConfigWrite write, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task DeleteConfigAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task TriggerConfigAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task QuickBackupAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task<bool> VerifyRunAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(false);
    }

    /// <inheritdoc />
    public Task<RestorePreview> PreviewRunAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new RestorePreview(Array.Empty<RestorePreviewTable>(), false));
    }

    /// <inheritdoc />
    public Uri? GetDownloadUri(long runId) => null;
}

/// <summary>
/// The generated-client-backed <see cref="IBackupFeed"/> — the native data adapter for the backup surface. It
/// binds to the generated OpenAPI contract client (ADR-004): <c>GET /backup/configs</c> + <c>GET /backup/runs</c>
/// for the two lists, <c>POST /backup/configs</c> + <c>PUT /backup/configs/{id}</c> + <c>DELETE /backup/configs/{id}</c>
/// + <c>POST /backup/configs/{id}/trigger</c> for the config mutations, <c>POST /backup/quick</c> for the quick
/// backup, and <c>POST /backup/runs/{id}/verify</c> + <c>GET /backup/runs/{id}/preview</c> for a run's verify /
/// restore-preview. No HTTP touches the view; the list JSON round-trips through the tolerant
/// <see cref="BackupConfig.ParseList"/> / <see cref="BackupRun.ParseList"/> parsers so the snake_case wire shape
/// is preserved losslessly.
/// </summary>
public sealed class BackupClientFeed : IBackupFeed
{
    private readonly IApiClient _api;
    private readonly Uri? _baseAddress;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="options">Optional client options used to resolve the absolute download URL.</param>
    public BackupClientFeed(IApiClient api, ApiClientOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _baseAddress = options?.BaseAddress;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<BackupConfig>> FetchConfigsAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(BackupRestoreRegistration.ConfigsListOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return BackupConfig.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<BackupRun>> FetchRunsAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(BackupRestoreRegistration.RunsListOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return BackupRun.ParseList(json);
    }

    /// <inheritdoc />
    public async Task CreateConfigAsync(BackupConfigWrite write, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(write);
        var request = new ApiRequest(BackupRestoreRegistration.ConfigCreateOperation, Body: write.ToBody());
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task UpdateConfigAsync(long id, BackupConfigWrite write, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(write);
        var request = new ApiRequest(
            BackupRestoreRegistration.ConfigUpdateOperation,
            PathParams: ConfigPath(id),
            Body: write.ToBody());
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task DeleteConfigAsync(long id, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(BackupRestoreRegistration.ConfigDeleteOperation, PathParams: ConfigPath(id));
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task TriggerConfigAsync(long id, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(BackupRestoreRegistration.ConfigTriggerOperation, PathParams: ConfigPath(id));
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task QuickBackupAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(BackupRestoreRegistration.QuickBackupOperation);
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<bool> VerifyRunAsync(long id, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(BackupRestoreRegistration.RunVerifyOperation, PathParams: RunPath(id));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return json.ValueKind == JsonValueKind.Object
            && json.TryGetProperty("verified", out var v)
            && v.ValueKind == JsonValueKind.True;
    }

    /// <inheritdoc />
    public async Task<RestorePreview> PreviewRunAsync(long id, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(BackupRestoreRegistration.RunPreviewOperation, PathParams: RunPath(id));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return RestorePreview.FromJson(json);
    }

    /// <inheritdoc />
    public Uri? GetDownloadUri(long runId)
    {
        if (_baseAddress is null)
        {
            return null;
        }

        // web handleDownload: `${getApiBase()}/api/v1/backup/runs/${runId}/download` (the download op is Versioned).
        return new Uri(_baseAddress, $"/api/v1/backup/runs/{runId.ToString(CultureInfo.InvariantCulture)}/download");
    }

    private static Dictionary<string, string> ConfigPath(long id) => new(StringComparer.Ordinal)
    {
        [BackupRestoreRegistration.ConfigIdPathParam] = id.ToString(CultureInfo.InvariantCulture),
    };

    private static Dictionary<string, string> RunPath(long id) => new(StringComparer.Ordinal)
    {
        [BackupRestoreRegistration.RunIdPathParam] = id.ToString(CultureInfo.InvariantCulture),
    };
}
