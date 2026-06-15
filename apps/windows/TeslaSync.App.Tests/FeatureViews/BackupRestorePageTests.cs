using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>BackupRestorePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/admin/pages/BackupRestorePage.tsx), the tolerant config / run / preview parsers, the
/// generated-client feed's request shaping (web <c>useQuery(['backup-configs'])</c> / <c>useQuery(['backup-runs'])</c>
/// / create / update / delete / trigger / quick-backup / verify / preview) and the view-model's four-state matrix
/// (loading / empty / error / success) plus its mutations + toasts. The WinUI view is exercised by the app build;
/// its per-region visibility is driven entirely by the <see cref="BackupRestoreDisplay"/> flags asserted here.
/// </summary>
public sealed class BackupRestorePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 15, 12, 0, 0, TimeSpan.Zero);

    // The 81 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "backup.backupType", "backup.checksumFailed", "backup.checksumMismatch", "backup.checksumVerified",
        "backup.compress", "backup.configCreateFailed", "backup.configCreated", "backup.configDeleteFailed",
        "backup.configDeleted", "backup.configName", "backup.configNamePlaceholder", "backup.configUpdateFailed",
        "backup.configUpdated", "backup.configurations", "backup.create", "backup.daily", "backup.delete",
        "backup.deleteConfig", "backup.deleteConfigMessage", "backup.disabled", "backup.download", "backup.duration",
        "backup.edit", "backup.editConfig", "backup.enabled", "backup.encrypt", "backup.everyNDays", "backup.file",
        "backup.frequency", "backup.frequencyDays", "backup.full", "backup.history", "backup.incremental",
        "backup.lastBackup", "backup.lastRun", "backup.loadingPreview", "backup.maxRetention", "backup.metadata",
        "backup.name", "backup.newConfig", "backup.nextRun", "backup.noConfigs", "backup.noConfigsMessage",
        "backup.noRuns", "backup.noRunsMessage", "backup.noTables", "backup.options", "backup.preview",
        "backup.previewFailed", "backup.provider", "backup.providerSettings", "backup.quickBackup",
        "backup.quickFailed", "backup.quickStarted", "backup.recentErrors", "backup.records", "backup.refresh",
        "backup.restorePreview", "backup.rows", "backup.runType", "backup.saveChanges", "backup.schedule",
        "backup.size", "backup.status", "backup.subtitle", "backup.table", "backup.tables", "backup.time",
        "backup.title", "backup.totalBackups", "backup.totalConfigs", "backup.totalSize", "backup.triggerFailed",
        "backup.triggerNow", "backup.triggered", "backup.type", "backup.verify", "backup.verifyFailed",
        "common.cancel", "common.close", "error.loadFailed",
    ];

    // Every operation the feed binds that must resolve against the generated endpoint table (ADR-004).
    public static IEnumerable<object[]> ResolvableOperationIds() =>
    [
        [BackupRestoreRegistration.ConfigsListOperation],
        [BackupRestoreRegistration.ConfigCreateOperation],
        [BackupRestoreRegistration.ConfigUpdateOperation],
        [BackupRestoreRegistration.ConfigDeleteOperation],
        [BackupRestoreRegistration.ConfigTriggerOperation],
        [BackupRestoreRegistration.RunsListOperation],
        [BackupRestoreRegistration.QuickBackupOperation],
        [BackupRestoreRegistration.RunVerifyOperation],
        [BackupRestoreRegistration.RunPreviewOperation],
    ];

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement.Clone();

    private static BackupConfig SampleConfig(
        long id = 1,
        string name = "Daily full",
        bool enabled = true,
        string type = "full",
        int frequencyDays = 1,
        string provider = "local",
        bool compress = true,
        bool encrypt = false) =>
        new(id, name, enabled, type, frequencyDays, 7, provider,
            new Dictionary<string, string> { ["path"] = "/backups" }, Array.Empty<string>(),
            compress, encrypt, LastRunAt: null, NextRunAt: null, CreatedAt: "2026-06-15T10:00:00Z",
            UpdatedAt: "2026-06-15T10:00:00Z");

    private static BackupRun SampleRun(
        long id = 5,
        string status = "completed",
        string runType = "backup",
        double fileSize = 2048,
        int records = 1234,
        double durationMs = 4500,
        string? error = null,
        string? fileName = "backup-2026.sql.gz",
        string? completedAt = "2026-06-15T11:30:00Z") =>
        new(id, ConfigId: 1, runType, "full", status, "local", fileName, fileSize, records, TableCount: 12,
            Checksum: "abc", durationMs, error, StartedAt: "2026-06-15T11:29:00Z", completedAt,
            CreatedAt: "2026-06-15T11:29:00Z");

    private static BackupRestoreModel Model(
        IReadOnlyList<BackupConfig>? configs = null,
        IReadOnlyList<BackupRun>? runs = null,
        bool loading = false,
        bool error = false) =>
        new(configs ?? Array.Empty<BackupConfig>(), runs ?? Array.Empty<BackupRun>(),
            LoadingConfigs: loading, LoadingRuns: loading, HasError: error, ErrorDetail: error ? "boom" : null);

    // ── i18n key coverage (all 81 manifest strings) ─────────────────────────────────────────────

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = BackupRestoreProjection.Project(Model(configs: [SampleConfig()], runs: [SampleRun()]), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = BackupRestoreProjection.Project(BackupRestoreModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ── Four data states ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void State_loading_when_initial_with_no_data()
    {
        var display = BackupRestoreProjection.Project(BackupRestoreModel.Initial, Localizer, Now);

        Assert.Equal(BackupRestoreState.Loading, display.State);
        Assert.True(display.IsLoading);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_empty_when_loaded_with_no_configs_and_no_runs()
    {
        var display = BackupRestoreProjection.Project(Model(), Localizer, Now);

        Assert.Equal(BackupRestoreState.Empty, display.State);
        Assert.False(display.IsLoading);
        Assert.False(display.ShowError);
        Assert.True(display.ShowConfigsEmpty);
        Assert.True(display.ShowRunsEmpty);
    }

    [Fact]
    public void State_error_when_configs_read_failed()
    {
        var display = BackupRestoreProjection.Project(Model(error: true), Localizer, Now);

        Assert.Equal(BackupRestoreState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(string.IsNullOrEmpty(display.ErrorMessage));
        Assert.Contains("boom", display.ErrorMessage);
    }

    [Fact]
    public void State_success_when_configs_or_runs_present()
    {
        var withConfigs = BackupRestoreProjection.Project(Model(configs: [SampleConfig()]), Localizer, Now);
        Assert.Equal(BackupRestoreState.Success, withConfigs.State);

        var withRuns = BackupRestoreProjection.Project(Model(runs: [SampleRun()]), Localizer, Now);
        Assert.Equal(BackupRestoreState.Success, withRuns.State);
    }

    // ── Stats / derived values ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Stats_count_configs_runs_and_total_size()
    {
        var model = Model(
            configs: [SampleConfig(1), SampleConfig(2)],
            runs: [SampleRun(5, fileSize: 1024), SampleRun(6, fileSize: 1024)]);

        var display = BackupRestoreProjection.Project(model, Localizer, Now);

        Assert.Equal(4, display.Stats.Count);
        Assert.Equal("2", display.Stats[0].Value);  // total configs
        Assert.Equal("2", display.Stats[1].Value);  // total backups
        Assert.Equal("2.0 KB", display.Stats[3].Value); // 2048 bytes total
    }

    [Fact]
    public void Last_backup_uses_first_completed_run()
    {
        var model = Model(runs:
        [
            SampleRun(7, status: "running", completedAt: null),
            SampleRun(6, status: "completed", completedAt: "2026-06-15T11:59:00Z"),
        ]);

        var display = BackupRestoreProjection.Project(model, Localizer, Now);

        Assert.Equal("1m ago", display.Stats[2].Value);
    }

    [Fact]
    public void Recent_errors_collect_failed_runs_with_messages()
    {
        var model = Model(runs:
        [
            SampleRun(1, status: "failed", error: "disk full", fileName: "run-1.sql"),
            SampleRun(2, status: "completed", error: null),
            SampleRun(3, status: "failed", error: null),
        ]);

        var display = BackupRestoreProjection.Project(model, Localizer, Now);

        Assert.Single(display.RecentErrors);
        Assert.Equal("run-1.sql", display.RecentErrors[0].Title);
        Assert.Equal("disk full", display.RecentErrors[0].Message);
    }

    [Fact]
    public void Config_row_projects_badges_frequency_and_options()
    {
        var model = Model(configs: [SampleConfig(type: "incremental", frequencyDays: 3, provider: "s3", encrypt: true)]);

        var row = BackupRestoreProjection.Project(model, Localizer, Now).ConfigRows.Single();

        Assert.Equal("Incremental", row.TypeLabel);
        Assert.Equal(TeslaSync.App.Core.StatusKind.Warning, row.TypeStatus);
        Assert.Equal("Amazon S3", row.ProviderLabel);
        Assert.Equal("Every 3d", row.FrequencyText);
        Assert.True(row.ShowCompress);
        Assert.True(row.ShowEncrypt);
    }

    [Fact]
    public void Run_row_projects_size_records_duration_and_actions()
    {
        var model = Model(runs: [SampleRun(status: "completed", fileSize: 2048, records: 1234, durationMs: 4500)]);

        var row = BackupRestoreProjection.Project(model, Localizer, Now).RunRows.Single();

        Assert.Equal("2.0 KB", row.SizeText);
        Assert.Equal("1,234", row.RecordsText);
        Assert.Equal("4.5s", row.DurationText);
        Assert.True(row.IsCompleted);
    }

    // ── Formatters (web parity) ─────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(0, "0 B")]
    [InlineData(512, "512 B")]
    [InlineData(1536, "1.5 KB")]
    [InlineData(15728640, "15 MB")]
    public void FormatBytes_matches_web(double bytes, string expected) =>
        Assert.Equal(expected, BackupRestoreProjection.FormatBytes(bytes));

    [Theory]
    [InlineData(500, "500ms")]
    [InlineData(4500, "4.5s")]
    [InlineData(90000, "1.5m")]
    public void FormatDurationMsCompact_matches_web(double ms, string expected) =>
        Assert.Equal(expected, BackupRestoreProjection.FormatDurationMsCompact(ms));

    [Fact]
    public void FormatRelative_tiers_match_web()
    {
        Assert.Equal("\u2014", BackupRestoreProjection.FormatRelative(null, Now));
        Assert.Equal("just now", BackupRestoreProjection.FormatRelative("2026-06-15T11:59:30Z", Now));
        Assert.Equal("5m ago", BackupRestoreProjection.FormatRelative("2026-06-15T11:55:00Z", Now));
        Assert.Equal("3h ago", BackupRestoreProjection.FormatRelative("2026-06-15T09:00:00Z", Now));
        Assert.Equal("2d ago", BackupRestoreProjection.FormatRelative("2026-06-13T12:00:00Z", Now));
    }

    [Fact]
    public void FormatInt_groups_thousands() =>
        Assert.Equal("1,234,567", BackupRestoreProjection.FormatInt(1234567));

    // ── Parsers (null-tolerant) ─────────────────────────────────────────────────────────────────

    [Fact]
    public void BackupConfig_parses_snake_case_fields()
    {
        var config = BackupConfig.FromJson(Json(
            """{ "id": 9, "name": "Nightly", "enabled": true, "backup_type": "full", "frequency_days": 2, "max_retention": 14, "provider": "s3", "provider_config": { "bucket": "b" }, "include_tables": ["drives"], "compress": true, "encrypt": true }"""));

        Assert.Equal(9, config.Id);
        Assert.Equal("Nightly", config.Name);
        Assert.Equal("s3", config.Provider);
        Assert.Equal("b", config.ProviderConfig["bucket"]);
        Assert.Equal(2, config.FrequencyDays);
        Assert.True(config.Encrypt);
    }

    [Fact]
    public void BackupRun_parses_and_tolerates_missing_fields()
    {
        var run = BackupRun.FromJson(Json("""{ "id": 3, "status": "failed", "error_message": "nope" }"""));

        Assert.Equal(3, run.Id);
        Assert.Equal("failed", run.Status);
        Assert.Equal("nope", run.ErrorMessage);
        Assert.Equal(0, run.FileSize);
        Assert.Null(run.FileName);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        Assert.Empty(BackupConfig.ParseList(Json("""{ "error": "x" }""")));
        Assert.Empty(BackupRun.ParseList(Json("null")));
    }

    [Fact]
    public void RestorePreview_parses_tables_and_checksum()
    {
        var preview = RestorePreview.FromJson(Json(
            """{ "tables": [ { "name": "drives", "rows": 42 } ], "checksum_verified": true }"""));

        Assert.True(preview.ChecksumVerified);
        Assert.Single(preview.Tables);
        Assert.Equal("drives", preview.Tables[0].Name);
        Assert.Equal(42, preview.Tables[0].Rows);
    }

    // ── Generated-client feed request shaping (ADR-004) ─────────────────────────────────────────

    [Theory]
    [MemberData(nameof(ResolvableOperationIds))]
    public void Every_bound_operation_resolves_against_the_generated_table(string operationId)
    {
        var match = GeneratedApi.ApiEndpoints.All.FirstOrDefault(e => e.OperationId == operationId);
        Assert.NotNull(match);
    }

    [Fact]
    public async Task FetchConfigs_calls_configs_list_operation()
    {
        var api = new FakeApiClient().ReturnsValue(Json("""[ { "id": 1, "name": "A" } ]"""));
        var feed = new BackupClientFeed(api);

        var configs = await feed.FetchConfigsAsync(default);

        Assert.Equal(BackupRestoreRegistration.ConfigsListOperation, api.Requests[0].OperationId);
        Assert.Single(configs);
    }

    [Fact]
    public async Task CreateConfig_posts_snake_case_body()
    {
        var api = new FakeApiClient().ReturnsValue(Json("{}"));
        var feed = new BackupClientFeed(api);

        await feed.CreateConfigAsync(BackupConfigWrite.Empty, default);

        var request = api.Requests[0];
        Assert.Equal(BackupRestoreRegistration.ConfigCreateOperation, request.OperationId);
        Assert.NotNull(request.Body);
        var body = Assert.IsAssignableFrom<IReadOnlyDictionary<string, object?>>(request.Body);
        Assert.True(body.ContainsKey("backup_type"));
        Assert.True(body.ContainsKey("frequency_days"));
        Assert.Equal("local", body["provider"]);
    }

    [Fact]
    public async Task UpdateConfig_targets_the_config_id_path_param()
    {
        var api = new FakeApiClient().ReturnsValue(Json("{}"));
        var feed = new BackupClientFeed(api);

        await feed.UpdateConfigAsync(42, BackupConfigWrite.Empty, default);

        var request = api.Requests[0];
        Assert.Equal(BackupRestoreRegistration.ConfigUpdateOperation, request.OperationId);
        Assert.NotNull(request.PathParams);
        Assert.Equal("42", request.PathParams![BackupRestoreRegistration.ConfigIdPathParam]);
    }

    [Fact]
    public async Task TriggerConfig_uses_the_trigger_operation()
    {
        var api = new FakeApiClient().ReturnsValue(Json("{}"));
        var feed = new BackupClientFeed(api);

        await feed.TriggerConfigAsync(7, default);

        Assert.Equal(BackupRestoreRegistration.ConfigTriggerOperation, api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].PathParams![BackupRestoreRegistration.ConfigIdPathParam]);
    }

    [Fact]
    public async Task VerifyRun_reads_the_verified_flag()
    {
        var verified = new BackupClientFeed(new FakeApiClient().ReturnsValue(Json("""{ "verified": true }""")));
        Assert.True(await verified.VerifyRunAsync(1, default));

        var mismatch = new BackupClientFeed(new FakeApiClient().ReturnsValue(Json("""{ "verified": false }""")));
        Assert.False(await mismatch.VerifyRunAsync(1, default));
    }

    [Fact]
    public async Task PreviewRun_parses_the_preview_payload()
    {
        var api = new FakeApiClient().ReturnsValue(Json("""{ "tables": [ { "name": "t", "rows": 1 } ], "checksum_verified": false }"""));
        var feed = new BackupClientFeed(api);

        var preview = await feed.PreviewRunAsync(3, default);

        Assert.Equal(BackupRestoreRegistration.RunPreviewOperation, api.Requests[0].OperationId);
        Assert.Equal("3", api.Requests[0].PathParams![BackupRestoreRegistration.RunIdPathParam]);
        Assert.Single(preview.Tables);
    }

    // ── View-model state machine + mutations ────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loads_configs_and_runs_into_success()
    {
        var feed = new FakeBackupFeed
        {
            Configs = [SampleConfig()],
            Runs = [SampleRun()],
        };
        var vm = new BackupRestorePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(BackupRestoreState.Success, vm.State);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_surfaces_error_when_configs_fail()
    {
        var feed = new FakeBackupFeed { ConfigsThrow = true };
        var vm = new BackupRestorePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(BackupRestoreState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_create_toasts_success_and_reloads()
    {
        var feed = new FakeBackupFeed();
        var vm = new BackupRestorePageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        bool ok = await vm.CreateConfigAsync(BackupConfigWrite.Empty);

        Assert.True(ok);
        Assert.Equal(1, feed.CreateCalls);
        Assert.Equal("Config created", vm.ToastMessage);
        Assert.False(vm.ToastIsError);
    }

    [Fact]
    public async Task ViewModel_delete_failure_toasts_error()
    {
        var feed = new FakeBackupFeed { MutationsThrow = true };
        var vm = new BackupRestorePageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        bool ok = await vm.DeleteConfigAsync(1);

        Assert.False(ok);
        Assert.Equal("Failed to delete config", vm.ToastMessage);
        Assert.True(vm.ToastIsError);
    }

    [Fact]
    public async Task ViewModel_verify_toasts_mismatch_when_not_verified()
    {
        var feed = new FakeBackupFeed { VerifyResult = false };
        var vm = new BackupRestorePageViewModel(feed, Localizer, () => Now);

        await vm.VerifyRunAsync(5);

        Assert.Equal("Checksum mismatch", vm.ToastMessage);
        Assert.True(vm.ToastIsError);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeBackupFeed : IBackupFeed
    {
        public IReadOnlyList<BackupConfig> Configs { get; set; } = Array.Empty<BackupConfig>();

        public IReadOnlyList<BackupRun> Runs { get; set; } = Array.Empty<BackupRun>();

        public bool ConfigsThrow { get; set; }

        public bool MutationsThrow { get; set; }

        public bool VerifyResult { get; set; } = true;

        public int CreateCalls { get; private set; }

        public Task<IReadOnlyList<BackupConfig>> FetchConfigsAsync(CancellationToken cancellationToken)
        {
            if (ConfigsThrow)
            {
                throw new InvalidOperationException("configs failed");
            }

            return Task.FromResult(Configs);
        }

        public Task<IReadOnlyList<BackupRun>> FetchRunsAsync(CancellationToken cancellationToken) =>
            Task.FromResult(Runs);

        public Task CreateConfigAsync(BackupConfigWrite write, CancellationToken cancellationToken)
        {
            if (MutationsThrow)
            {
                throw new InvalidOperationException("create failed");
            }

            CreateCalls++;
            return Task.CompletedTask;
        }

        public Task UpdateConfigAsync(long id, BackupConfigWrite write, CancellationToken cancellationToken) =>
            MutationsThrow ? throw new InvalidOperationException("update failed") : Task.CompletedTask;

        public Task DeleteConfigAsync(long id, CancellationToken cancellationToken) =>
            MutationsThrow ? throw new InvalidOperationException("delete failed") : Task.CompletedTask;

        public Task TriggerConfigAsync(long id, CancellationToken cancellationToken) =>
            MutationsThrow ? throw new InvalidOperationException("trigger failed") : Task.CompletedTask;

        public Task QuickBackupAsync(CancellationToken cancellationToken) =>
            MutationsThrow ? throw new InvalidOperationException("quick failed") : Task.CompletedTask;

        public Task<bool> VerifyRunAsync(long id, CancellationToken cancellationToken) =>
            Task.FromResult(VerifyResult);

        public Task<RestorePreview> PreviewRunAsync(long id, CancellationToken cancellationToken) =>
            Task.FromResult(new RestorePreview(Array.Empty<RestorePreviewTable>(), false));

        public Uri? GetDownloadUri(long runId) => null;
    }
}
