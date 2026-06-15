using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// Tolerant <see cref="JsonElement"/> readers for the backup configs / runs / preview payloads. Each getter
/// returns a fallback (null / zero / empty) for an absent or wrong-kind property so a partial or schema-drifted
/// body from <c>GET /backup/configs</c>, <c>GET /backup/runs</c> or <c>GET /backup/runs/{id}/preview</c> never
/// aborts the parse — mirroring the web hook's defensive <c>?? 0</c> / <c>?? null</c> reads
/// (web/src/features/admin/pages/BackupRestorePage.tsx interfaces). Numeric strings are accepted because the Go
/// API occasionally serializes ids / sizes as strings. UI-free so the parse is unit-tested without a UI host.
/// </summary>
internal static class BackupJson
{
    internal static string? Str(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var v)
        && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    internal static double Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(
                v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }

    internal static long Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(
                v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }

    internal static int Int(JsonElement obj, string name) => (int)Long(obj, name);

    internal static bool Bool(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var v)
        && v.ValueKind == JsonValueKind.True;

    internal static long? NullableLong(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object
            || !obj.TryGetProperty(name, out var v)
            || v.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(
                v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }
}

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>BackupRestorePage</c> surface — the native mirror of the
/// four data states the web page renders (web/src/features/admin/pages/BackupRestorePage.tsx). The web page runs
/// the <c>backup-configs</c> + <c>backup-runs</c> queries through <c>PageContainer</c>, which shows the loading
/// skeletons (web <c>loading</c>), the page error surface (web <c>error={configsError}</c>), the populated
/// configs/runs panels (web data present) and otherwise the per-panel empty states (web <c>configs.length === 0
/// &amp;&amp; runs.length === 0</c>). This enum is the top-level summary the ledger / Narrator key off; per-region
/// visibility is still driven by the projected flags so each branch renders exactly as the web composes them.
/// </summary>
public enum BackupRestoreState
{
    /// <summary>The initial list load is in flight with no data yet (web <c>loading</c>) — skeletons show.</summary>
    Loading,

    /// <summary>The reads resolved with no configs and no runs (web per-panel empty states).</summary>
    Empty,

    /// <summary>The configs read failed (web <c>PageContainer error</c>) — the failure surface shows.</summary>
    Error,

    /// <summary>The reads produced configs and/or runs — the populated panels render.</summary>
    Success,
}

/// <summary>
/// One backup configuration — the native mirror of the web <c>BackupConfig</c>
/// (web/src/features/admin/pages/BackupRestorePage.tsx). Field names mirror the Go API's snake_case JSON tags;
/// parsing is null-tolerant so a partial object never throws. Pure data — no WinUI types.
/// </summary>
public sealed record BackupConfig(
    long Id,
    string Name,
    bool Enabled,
    string BackupType,
    int FrequencyDays,
    int MaxRetention,
    string Provider,
    IReadOnlyDictionary<string, string> ProviderConfig,
    IReadOnlyList<string> IncludeTables,
    bool Compress,
    bool Encrypt,
    string? LastRunAt,
    string? NextRunAt,
    string CreatedAt,
    string UpdatedAt)
{
    /// <summary>Read one config from a JSON object, tolerating missing / null fields.</summary>
    public static BackupConfig FromJson(JsonElement o)
    {
        var providerConfig = new Dictionary<string, string>(StringComparer.Ordinal);
        if (o.ValueKind == JsonValueKind.Object
            && o.TryGetProperty("provider_config", out var pc)
            && pc.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in pc.EnumerateObject())
            {
                providerConfig[prop.Name] = prop.Value.ValueKind == JsonValueKind.String
                    ? prop.Value.GetString() ?? string.Empty
                    : prop.Value.ToString();
            }
        }

        var includeTables = new List<string>();
        if (o.ValueKind == JsonValueKind.Object
            && o.TryGetProperty("include_tables", out var it)
            && it.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in it.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String)
                {
                    includeTables.Add(item.GetString() ?? string.Empty);
                }
            }
        }

        return new BackupConfig(
            Id: BackupJson.Long(o, "id"),
            Name: BackupJson.Str(o, "name") ?? string.Empty,
            Enabled: BackupJson.Bool(o, "enabled"),
            BackupType: BackupJson.Str(o, "backup_type") ?? "full",
            FrequencyDays: BackupJson.Int(o, "frequency_days"),
            MaxRetention: BackupJson.Int(o, "max_retention"),
            Provider: BackupJson.Str(o, "provider") ?? "local",
            ProviderConfig: providerConfig,
            IncludeTables: includeTables,
            Compress: BackupJson.Bool(o, "compress"),
            Encrypt: BackupJson.Bool(o, "encrypt"),
            LastRunAt: BackupJson.Str(o, "last_run_at"),
            NextRunAt: BackupJson.Str(o, "next_run_at"),
            CreatedAt: BackupJson.Str(o, "created_at") ?? string.Empty,
            UpdatedAt: BackupJson.Str(o, "updated_at") ?? string.Empty);
    }

    /// <summary>Parse a <c>GET /backup/configs</c> JSON array; a non-array body yields an empty list.</summary>
    public static IReadOnlyList<BackupConfig> ParseList(JsonElement json)
    {
        if (json.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<BackupConfig>();
        }

        var list = new List<BackupConfig>();
        foreach (var item in json.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }
}

/// <summary>
/// One backup run (history row) — the native mirror of the web <c>BackupRun</c>
/// (web/src/features/admin/pages/BackupRestorePage.tsx). Field names mirror the Go API's snake_case JSON tags;
/// parsing is null-tolerant. Pure data — no WinUI types.
/// </summary>
public sealed record BackupRun(
    long Id,
    long? ConfigId,
    string RunType,
    string BackupType,
    string Status,
    string Provider,
    string? FileName,
    double FileSize,
    int RecordCount,
    int TableCount,
    string? Checksum,
    double DurationMs,
    string? ErrorMessage,
    string? StartedAt,
    string? CompletedAt,
    string CreatedAt)
{
    /// <summary>Read one run from a JSON object, tolerating missing / null fields.</summary>
    public static BackupRun FromJson(JsonElement o) => new(
        Id: BackupJson.Long(o, "id"),
        ConfigId: BackupJson.NullableLong(o, "config_id"),
        RunType: BackupJson.Str(o, "run_type") ?? string.Empty,
        BackupType: BackupJson.Str(o, "backup_type") ?? string.Empty,
        Status: BackupJson.Str(o, "status") ?? "queued",
        Provider: BackupJson.Str(o, "provider") ?? "local",
        FileName: BackupJson.Str(o, "file_name"),
        FileSize: BackupJson.Double(o, "file_size"),
        RecordCount: BackupJson.Int(o, "record_count"),
        TableCount: BackupJson.Int(o, "table_count"),
        Checksum: BackupJson.Str(o, "checksum"),
        DurationMs: BackupJson.Double(o, "duration_ms"),
        ErrorMessage: BackupJson.Str(o, "error_message"),
        StartedAt: BackupJson.Str(o, "started_at"),
        CompletedAt: BackupJson.Str(o, "completed_at"),
        CreatedAt: BackupJson.Str(o, "created_at") ?? string.Empty);

    /// <summary>Parse a <c>GET /backup/runs</c> JSON array; a non-array body yields an empty list.</summary>
    public static IReadOnlyList<BackupRun> ParseList(JsonElement json)
    {
        if (json.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<BackupRun>();
        }

        var list = new List<BackupRun>();
        foreach (var item in json.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }
}

/// <summary>One table row in a restore preview (web <c>RestorePreview.tables[]</c>).</summary>
public sealed record RestorePreviewTable(string Name, long Rows);

/// <summary>
/// The restore-preview payload — the native mirror of the web <c>RestorePreview</c>
/// (web/src/features/admin/pages/BackupRestorePage.tsx). Parsing is null-tolerant. Pure data.
/// </summary>
public sealed record RestorePreview(
    IReadOnlyList<RestorePreviewTable> Tables,
    bool ChecksumVerified)
{
    /// <summary>Read a preview from a <c>GET /backup/runs/{id}/preview</c> JSON object.</summary>
    public static RestorePreview FromJson(JsonElement o)
    {
        var tables = new List<RestorePreviewTable>();
        if (o.ValueKind == JsonValueKind.Object
            && o.TryGetProperty("tables", out var t)
            && t.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in t.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.Object)
                {
                    tables.Add(new RestorePreviewTable(
                        BackupJson.Str(item, "name") ?? string.Empty,
                        BackupJson.Long(item, "rows")));
                }
            }
        }

        return new RestorePreview(tables, BackupJson.Bool(o, "checksum_verified"));
    }
}

/// <summary>
/// The render-time data model the <c>BackupRestorePage</c> projects from — the native analogue of the web page's
/// resolved query state (web/src/features/admin/pages/BackupRestorePage.tsx). It carries the configs / runs list
/// results plus the loading / error flags the four data states derive from. Pure data.
/// </summary>
public sealed record BackupRestoreModel(
    IReadOnlyList<BackupConfig> Configs,
    IReadOnlyList<BackupRun> Runs,
    bool LoadingConfigs,
    bool LoadingRuns,
    bool HasError,
    string? ErrorDetail)
{
    /// <summary>The first projection's empty model (initial load, no data yet).</summary>
    public static BackupRestoreModel Initial { get; } = new(
        Array.Empty<BackupConfig>(),
        Array.Empty<BackupRun>(),
        LoadingConfigs: true,
        LoadingRuns: true,
        HasError: false,
        ErrorDetail: null);
}

/// <summary>One stat tile in the metrics row (the native analogue of a web <c>MetricCard</c>).</summary>
public sealed record BackupStatDisplay(string Label, string Value, string Glyph, string AccentBrushKey);

/// <summary>One projected backup-config row (web configs <c>DataTable</c> row).</summary>
public sealed record BackupConfigRowDisplay(
    long Id,
    string Name,
    bool Enabled,
    string DisabledLabel,
    string TypeLabel,
    StatusKind TypeStatus,
    string ProviderLabel,
    string ProviderGlyph,
    StatusKind ProviderStatus,
    string FrequencyText,
    string LastRunText,
    string NextRunText,
    bool ShowCompress,
    bool ShowEncrypt);

/// <summary>One projected backup-run row (web runs <c>DataTable</c> row).</summary>
public sealed record BackupRunRowDisplay(
    long Id,
    string TimeText,
    string RunTypeLabel,
    StatusKind RunTypeStatus,
    string StatusLabel,
    StatusKind StatusStatus,
    string StatusGlyph,
    bool StatusSpins,
    string ProviderLabel,
    StatusKind ProviderStatus,
    string FileName,
    string SizeText,
    string RecordsText,
    string DurationText,
    bool IsCompleted);

/// <summary>One projected recent-error entry (web <c>failedRuns</c> list).</summary>
public sealed record BackupErrorDisplay(long Id, string Title, string Message);

/// <summary>
/// Every visible literal the surface resolves, in one bundle so the projection touches each i18n key exactly
/// once and the view binds them directly (web key names preserved, English fallbacks identical to the catalog).
/// </summary>
public sealed class BackupRestoreText
{
    public required string Title { get; init; }
    public required string Subtitle { get; init; }
    public required string QuickBackup { get; init; }
    public required string NewConfig { get; init; }
    public required string TotalConfigs { get; init; }
    public required string TotalBackups { get; init; }
    public required string LastBackup { get; init; }
    public required string TotalSize { get; init; }
    public required string Configurations { get; init; }
    public required string History { get; init; }
    public required string Refresh { get; init; }
    public required string RecentErrors { get; init; }
    public required string NoConfigs { get; init; }
    public required string NoConfigsMessage { get; init; }
    public required string NoRuns { get; init; }
    public required string NoRunsMessage { get; init; }
    public required string Name { get; init; }
    public required string Type { get; init; }
    public required string Provider { get; init; }
    public required string Frequency { get; init; }
    public required string Schedule { get; init; }
    public required string Options { get; init; }
    public required string Disabled { get; init; }
    public required string Full { get; init; }
    public required string Incremental { get; init; }
    public required string Daily { get; init; }
    public required string EveryNDays { get; init; }
    public required string LastRun { get; init; }
    public required string NextRun { get; init; }
    public required string Compress { get; init; }
    public required string Encrypt { get; init; }
    public required string TriggerNow { get; init; }
    public required string Edit { get; init; }
    public required string Delete { get; init; }
    public required string Time { get; init; }
    public required string RunType { get; init; }
    public required string Status { get; init; }
    public required string File { get; init; }
    public required string Size { get; init; }
    public required string Records { get; init; }
    public required string Duration { get; init; }
    public required string Download { get; init; }
    public required string Verify { get; init; }
    public required string Preview { get; init; }
    public required string Table { get; init; }
    public required string Tables { get; init; }
    public required string Rows { get; init; }
    public required string NoTables { get; init; }
    public required string Metadata { get; init; }
    public required string RestorePreview { get; init; }
    public required string LoadingPreview { get; init; }
    public required string Close { get; init; }
    public required string Cancel { get; init; }
    public required string Create { get; init; }
    public required string SaveChanges { get; init; }
    public required string NewConfigTitle { get; init; }
    public required string EditConfig { get; init; }
    public required string DeleteConfig { get; init; }
    public required string DeleteConfigMessage { get; init; }
    public required string ConfigName { get; init; }
    public required string ConfigNameHint { get; init; }
    public required string Enabled { get; init; }
    public required string BackupType { get; init; }
    public required string FrequencyDays { get; init; }
    public required string MaxRetention { get; init; }
    public required string ProviderSettings { get; init; }
    public required string ConfigCreated { get; init; }
    public required string ConfigCreateFailed { get; init; }
    public required string ConfigUpdated { get; init; }
    public required string ConfigUpdateFailed { get; init; }
    public required string ConfigDeleted { get; init; }
    public required string ConfigDeleteFailed { get; init; }
    public required string Triggered { get; init; }
    public required string TriggerFailed { get; init; }
    public required string QuickStarted { get; init; }
    public required string QuickFailed { get; init; }
    public required string ChecksumVerified { get; init; }
    public required string ChecksumMismatch { get; init; }
    public required string ChecksumFailed { get; init; }
    public required string VerifyFailed { get; init; }
    public required string PreviewFailed { get; init; }
    public required string LoadFailed { get; init; }

    /// <summary>Resolve every label through the i18n facade (touches all 81 manifest keys exactly here).</summary>
    public static BackupRestoreText Resolve(ILocalizer l)
    {
        ArgumentNullException.ThrowIfNull(l);
        string G(string key, string fallback) => l.GetString(key, fallback);

        return new BackupRestoreText
        {
            Title = G("backup.title", "Backup & Restore"),
            Subtitle = G("backup.subtitle", "Manage automated backups and restore points"),
            QuickBackup = G("backup.quickBackup", "Quick Backup"),
            NewConfig = G("backup.newConfig", "New Config"),
            TotalConfigs = G("backup.totalConfigs", "Total Configs"),
            TotalBackups = G("backup.totalBackups", "Total Backups"),
            LastBackup = G("backup.lastBackup", "Last Backup"),
            TotalSize = G("backup.totalSize", "Total Size"),
            Configurations = G("backup.configurations", "Backup Configurations"),
            History = G("backup.history", "Backup History"),
            Refresh = G("backup.refresh", "Refresh"),
            RecentErrors = G("backup.recentErrors", "Recent Errors"),
            NoConfigs = G("backup.noConfigs", "No backup configurations"),
            NoConfigsMessage = G("backup.noConfigsMessage", "Create a backup configuration to start protecting your data."),
            NoRuns = G("backup.noRuns", "No backup runs yet"),
            NoRunsMessage = G("backup.noRunsMessage", "Trigger a backup or wait for the scheduled run."),
            Name = G("backup.name", "Name"),
            Type = G("backup.type", "Type"),
            Provider = G("backup.provider", "Provider"),
            Frequency = G("backup.frequency", "Frequency"),
            Schedule = G("backup.schedule", "Schedule"),
            Options = G("backup.options", "Options"),
            Disabled = G("backup.disabled", "Disabled"),
            Full = G("backup.full", "Full"),
            Incremental = G("backup.incremental", "Incremental"),
            Daily = G("backup.daily", "Daily"),
            EveryNDays = G("backup.everyNDays", "Every {0}d"),
            LastRun = G("backup.lastRun", "Last"),
            NextRun = G("backup.nextRun", "Next"),
            Compress = G("backup.compress", "Compress"),
            Encrypt = G("backup.encrypt", "Encrypt"),
            TriggerNow = G("backup.triggerNow", "Trigger now"),
            Edit = G("backup.edit", "Edit"),
            Delete = G("backup.delete", "Delete"),
            Time = G("backup.time", "Time"),
            RunType = G("backup.runType", "Run Type"),
            Status = G("backup.status", "Status"),
            File = G("backup.file", "File"),
            Size = G("backup.size", "Size"),
            Records = G("backup.records", "Records"),
            Duration = G("backup.duration", "Duration"),
            Download = G("backup.download", "Download"),
            Verify = G("backup.verify", "Verify"),
            Preview = G("backup.preview", "Preview"),
            Table = G("backup.table", "Table"),
            Tables = G("backup.tables", "Tables"),
            Rows = G("backup.rows", "Rows"),
            NoTables = G("backup.noTables", "No tables found in backup"),
            Metadata = G("backup.metadata", "Backup Metadata"),
            RestorePreview = G("backup.restorePreview", "Restore Preview"),
            LoadingPreview = G("backup.loadingPreview", "Loading preview\u2026"),
            Close = G("common.close", "Close"),
            Cancel = G("common.cancel", "Cancel"),
            Create = G("backup.create", "Create"),
            SaveChanges = G("backup.saveChanges", "Save Changes"),
            NewConfigTitle = G("backup.newConfig", "New Configuration"),
            EditConfig = G("backup.editConfig", "Edit Configuration"),
            DeleteConfig = G("backup.deleteConfig", "Delete Configuration"),
            DeleteConfigMessage = G("backup.deleteConfigMessage", "Are you sure you want to delete \"{0}\"? This cannot be undone."),
            ConfigName = G("backup.configName", "Name"),
            ConfigNameHint = G("backup.configNamePlaceholder", "Daily full backup"), // parity:allow web i18n key name configNamePlaceholder
            Enabled = G("backup.enabled", "Enabled"),
            BackupType = G("backup.backupType", "Backup Type"),
            FrequencyDays = G("backup.frequencyDays", "Frequency (days)"),
            MaxRetention = G("backup.maxRetention", "Max Retention"),
            ProviderSettings = G("backup.providerSettings", "Provider Settings"),
            ConfigCreated = G("backup.configCreated", "Config created"),
            ConfigCreateFailed = G("backup.configCreateFailed", "Failed to create config"),
            ConfigUpdated = G("backup.configUpdated", "Config updated"),
            ConfigUpdateFailed = G("backup.configUpdateFailed", "Failed to update config"),
            ConfigDeleted = G("backup.configDeleted", "Config deleted"),
            ConfigDeleteFailed = G("backup.configDeleteFailed", "Failed to delete config"),
            Triggered = G("backup.triggered", "Backup triggered"),
            TriggerFailed = G("backup.triggerFailed", "Failed to trigger backup"),
            QuickStarted = G("backup.quickStarted", "Quick backup started"),
            QuickFailed = G("backup.quickFailed", "Quick backup failed"),
            ChecksumVerified = G("backup.checksumVerified", "Checksum verified"),
            ChecksumMismatch = G("backup.checksumMismatch", "Checksum mismatch"),
            ChecksumFailed = G("backup.checksumFailed", "Checksum verification failed"),
            VerifyFailed = G("backup.verifyFailed", "Verification failed"),
            PreviewFailed = G("backup.previewFailed", "Failed to load preview"),
            LoadFailed = G("error.loadFailed", "Failed to load data"),
        };
    }
}

/// <summary>
/// The fully projected, render-ready view of the backup surface — the native port of the render logic in
/// web/src/features/admin/pages/BackupRestorePage.tsx. It carries the top-level <see cref="State"/>, the four
/// stat tiles, the per-panel rows + empty flags, the recent-error entries and the resolved <see cref="Text"/>
/// bundle. Pure data so the projection is unit-tested directly.
/// </summary>
public sealed record BackupRestoreDisplay(
    BackupRestoreState State,
    bool IsLoading,
    bool ShowError,
    string ErrorMessage,
    IReadOnlyList<BackupStatDisplay> Stats,
    IReadOnlyList<BackupConfigRowDisplay> ConfigRows,
    bool ShowConfigsEmpty,
    IReadOnlyList<BackupRunRowDisplay> RunRows,
    bool ShowRunsEmpty,
    IReadOnlyList<BackupErrorDisplay> RecentErrors,
    BackupRestoreText Text);

/// <summary>
/// Pure projection from a parsed <see cref="BackupRestoreModel"/> to the render-ready
/// <see cref="BackupRestoreDisplay"/> — the native port of the derived stats, the two <c>DataTable</c> column
/// renderers and the recent-errors list in web/src/features/admin/pages/BackupRestorePage.tsx, plus the
/// <c>formatBytes</c> / <c>fmtInt</c> / <c>formatRelative</c> / <c>formatDurationMsCompact</c> helpers. Byte
/// sizes are dimensionless (no SI conversion needed); <c>now</c> is injected so relative times are deterministic
/// in tests. Every label resolves through the i18n facade.
/// </summary>
public static class BackupRestoreProjection
{
    private const string CompletedStatus = "completed";
    private const string FailedStatus = "failed";
    private const string RunningStatus = "running";

    private const string DatabaseGlyph = "\uE950";   // Database
    private const string ArchiveGlyph = "\uE7B8";    // Archive
    private const string ClockGlyph = "\uE823";      // Clock / Recent
    private const string DriveGlyph = "\uEDA2";      // HardDrive
    private const string CloudGlyph = "\uE753";      // Cloud
    private const string FolderGlyph = "\uE8B7";     // FolderOpen
    private const string CompletedGlyph = "\uE73E";  // Completed
    private const string ErrorGlyph = "\uEA39";      // ErrorBadge
    private const string SyncGlyph = "\uE895";       // Sync (running)
    private const string TimerGlyph = "\uE916";      // Timer (queued)

    private static readonly string[] ByteUnits = { "B", "KB", "MB", "GB", "TB" };

    /// <summary>Project <paramref name="model"/> at <paramref name="now"/> using the i18n facade.</summary>
    public static BackupRestoreDisplay Project(BackupRestoreModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var text = BackupRestoreText.Resolve(localizer);

        bool loading = model.LoadingConfigs || model.LoadingRuns;
        bool initialLoading = loading && model.Configs.Count == 0 && model.Runs.Count == 0 && !model.HasError;

        BackupRestoreState state;
        if (initialLoading)
        {
            state = BackupRestoreState.Loading;
        }
        else if (model.HasError)
        {
            state = BackupRestoreState.Error;
        }
        else if (model.Configs.Count == 0 && model.Runs.Count == 0)
        {
            state = BackupRestoreState.Empty;
        }
        else
        {
            state = BackupRestoreState.Success;
        }

        var stats = BuildStats(model, text, now);
        var configRows = model.Configs.Select(c => ProjectConfig(c, text, now)).ToArray();
        var runRows = model.Runs.Select(ProjectRun).ToArray();
        var recentErrors = model.Runs
            .Where(r => string.Equals(r.Status, FailedStatus, StringComparison.Ordinal)
                && !string.IsNullOrWhiteSpace(r.ErrorMessage))
            .Take(5)
            .Select(r => new BackupErrorDisplay(
                r.Id,
                !string.IsNullOrEmpty(r.FileName)
                    ? r.FileName!
                    : Interpolate(localizer.GetString("backup.runLabel", "Run #{0}"), r.Id.ToString(CultureInfo.InvariantCulture)),
                r.ErrorMessage ?? string.Empty))
            .ToArray();

        string errorMessage = model.HasError
            ? string.IsNullOrWhiteSpace(model.ErrorDetail)
                ? text.LoadFailed
                : $"{text.LoadFailed}: {model.ErrorDetail}"
            : string.Empty;

        return new BackupRestoreDisplay(
            State: state,
            IsLoading: initialLoading,
            ShowError: state == BackupRestoreState.Error,
            ErrorMessage: errorMessage,
            Stats: stats,
            ConfigRows: configRows,
            ShowConfigsEmpty: !model.LoadingConfigs && model.Configs.Count == 0,
            RunRows: runRows,
            ShowRunsEmpty: !model.LoadingRuns && model.Runs.Count == 0,
            RecentErrors: recentErrors,
            Text: text);
    }

    /// <summary>
    /// Format a byte count exactly as the web <c>formatBytes</c> helper: "0 B" for non-positive input; otherwise
    /// the largest fitting unit (B/KB/MB/GB/TB) with one decimal below 10 and a rounded integer at or above 10.
    /// Invariant-culture so the output matches the web's locale-independent <c>toFixed</c> / <c>Math.round</c>.
    /// </summary>
    public static string FormatBytes(double bytes)
    {
        if (double.IsNaN(bytes) || bytes <= 0)
        {
            return "0 B";
        }

        int i = (int)Math.Floor(Math.Log(bytes) / Math.Log(1024));
        i = Math.Clamp(i, 0, ByteUnits.Length - 1);
        double val = bytes / Math.Pow(1024, i);
        string num = val < 10
            ? val.ToString("0.0", CultureInfo.InvariantCulture)
            : Math.Round(val, MidpointRounding.AwayFromZero).ToString(CultureInfo.InvariantCulture);
        return string.Create(CultureInfo.InvariantCulture, $"{num} {ByteUnits[i]}");
    }

    /// <summary>Format an integer with grouping separators (web <c>fmtInt</c> → <c>Intl.NumberFormat</c>).</summary>
    public static string FormatInt(long value) => value.ToString("#,##0", CultureInfo.InvariantCulture);

    /// <summary>
    /// Relative-age label exactly as the web <c>formatRelative</c>: "—" for absent/unparseable; "just now" under
    /// a minute; "{n}m ago" / "{n}h ago" / "{n}d ago" for the minute/hour/day tiers; an absolute date past a week.
    /// </summary>
    public static string FormatRelative(string? iso, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(iso)
            || !DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind | DateTimeStyles.AssumeUniversal, out var d))
        {
            return "\u2014";
        }

        double seconds = Math.Floor((now - d).TotalSeconds);
        if (seconds < 60)
        {
            return "just now";
        }

        long minutes = (long)Math.Floor(seconds / 60);
        if (minutes < 60)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{minutes}m ago");
        }

        long hours = minutes / 60;
        if (hours < 24)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{hours}h ago");
        }

        long days = hours / 24;
        if (days < 7)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{days}d ago");
        }

        return d.ToLocalTime().ToString("MMM d, yyyy", CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Compact duration exactly as the web <c>formatDurationMsCompact</c>: "—" for non-finite; "{ms}ms" under a
    /// second; "{s}s" (1 decimal) under a minute; "{m}m" (1 decimal) otherwise.
    /// </summary>
    public static string FormatDurationMsCompact(double ms)
    {
        if (double.IsNaN(ms) || double.IsInfinity(ms))
        {
            return "\u2014";
        }

        if (ms < 1000)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{(long)ms}ms");
        }

        if (ms < 60_000)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{(ms / 1000).ToString("0.0", CultureInfo.InvariantCulture)}s");
        }

        return string.Create(CultureInfo.InvariantCulture, $"{(ms / 60_000).ToString("0.0", CultureInfo.InvariantCulture)}m");
    }

    /// <summary>Replace the first <c>{0}</c> token in <paramref name="template"/> with <paramref name="value"/>.</summary>
    public static string Interpolate(string template, string value)
    {
        if (string.IsNullOrEmpty(template))
        {
            return value;
        }

        return template.Contains("{0}", StringComparison.Ordinal)
            ? template.Replace("{0}", value, StringComparison.Ordinal)
            : template;
    }

    /// <summary>Status-token mapping for a provider chip (web <c>PROVIDER_BADGE_VARIANT</c>).</summary>
    public static StatusKind ProviderStatus(string provider) => provider switch
    {
        "s3" => StatusKind.Warning,
        "azure" => StatusKind.Info,
        "gcs" => StatusKind.Success,
        _ => StatusKind.Neutral,
    };

    private static BackupStatDisplay[] BuildStats(BackupRestoreModel model, BackupRestoreText text, DateTimeOffset now)
    {
        var lastBackup = model.Runs.FirstOrDefault(r => string.Equals(r.Status, CompletedStatus, StringComparison.Ordinal));
        double totalSize = model.Runs.Sum(r => r.FileSize);

        string lastValue = lastBackup is null
            ? "\u2014"
            : FormatRelative(
                !string.IsNullOrWhiteSpace(lastBackup.CompletedAt) ? lastBackup.CompletedAt : lastBackup.CreatedAt,
                now);

        return new[]
        {
            new BackupStatDisplay(text.TotalConfigs, FormatInt(model.Configs.Count), DatabaseGlyph, "TsColorInfoBrush"),
            new BackupStatDisplay(text.TotalBackups, FormatInt(model.Runs.Count), ArchiveGlyph, "TsColorSuccessBrush"),
            new BackupStatDisplay(text.LastBackup, lastValue, ClockGlyph, "TsChartPowerBrush"),
            new BackupStatDisplay(text.TotalSize, FormatBytes(totalSize), DriveGlyph, "TsColorAccentBrush"),
        };
    }

    private static BackupConfigRowDisplay ProjectConfig(BackupConfig c, BackupRestoreText text, DateTimeOffset now)
    {
        bool isFull = string.Equals(c.BackupType, "full", StringComparison.Ordinal);
        string frequency = c.FrequencyDays == 1
            ? text.Daily
            : Interpolate(text.EveryNDays, c.FrequencyDays.ToString(CultureInfo.InvariantCulture));

        return new BackupConfigRowDisplay(
            Id: c.Id,
            Name: c.Name,
            Enabled: c.Enabled,
            DisabledLabel: text.Disabled,
            TypeLabel: isFull ? text.Full : text.Incremental,
            TypeStatus: isFull ? StatusKind.Info : StatusKind.Warning,
            ProviderLabel: ProviderLabel(c.Provider),
            ProviderGlyph: string.Equals(c.Provider, "local", StringComparison.Ordinal) ? FolderGlyph : CloudGlyph,
            ProviderStatus: ProviderStatus(c.Provider),
            FrequencyText: frequency,
            LastRunText: string.IsNullOrWhiteSpace(c.LastRunAt) ? "\u2014" : FormatRelative(c.LastRunAt, now),
            NextRunText: string.IsNullOrWhiteSpace(c.NextRunAt) ? "\u2014" : FormatRelative(c.NextRunAt, now),
            ShowCompress: c.Compress,
            ShowEncrypt: c.Encrypt);
    }

    private static BackupRunRowDisplay ProjectRun(BackupRun r)
    {
        (StatusKind status, string glyph, bool spins) = r.Status switch
        {
            CompletedStatus => (StatusKind.Success, CompletedGlyph, false),
            FailedStatus => (StatusKind.Danger, ErrorGlyph, false),
            RunningStatus => (StatusKind.Info, SyncGlyph, true),
            _ => (StatusKind.Neutral, TimerGlyph, false),
        };

        StatusKind runTypeStatus = r.RunType switch
        {
            "backup" => StatusKind.Info,
            "restore" => StatusKind.Success,
            "quick" => StatusKind.Warning,
            _ => StatusKind.Neutral,
        };

        return new BackupRunRowDisplay(
            Id: r.Id,
            TimeText: r.CreatedAt,
            RunTypeLabel: string.IsNullOrEmpty(r.RunType) ? "\u2014" : r.RunType,
            RunTypeStatus: runTypeStatus,
            StatusLabel: StatusLabel(r.Status),
            StatusStatus: status,
            StatusGlyph: glyph,
            StatusSpins: spins,
            ProviderLabel: ProviderLabel(r.Provider),
            ProviderStatus: ProviderStatus(r.Provider),
            FileName: string.IsNullOrEmpty(r.FileName) ? "\u2014" : r.FileName!,
            SizeText: r.FileSize > 0 ? FormatBytes(r.FileSize) : "\u2014",
            RecordsText: r.RecordCount > 0 ? FormatInt(r.RecordCount) : "\u2014",
            DurationText: r.DurationMs > 0 ? FormatDurationMsCompact(r.DurationMs) : "\u2014",
            IsCompleted: string.Equals(r.Status, CompletedStatus, StringComparison.Ordinal));
    }

    private static string StatusLabel(string status) =>
        string.IsNullOrEmpty(status) ? "\u2014" : char.ToUpperInvariant(status[0]) + status[1..];

    private static string ProviderLabel(string provider) => provider switch
    {
        "local" => "Local",
        "s3" => "Amazon S3",
        "azure" => "Azure Blob",
        "gcs" => "Google Cloud",
        _ => provider,
    };
}

/// <summary>
/// Canonical metadata for the <c>BackupRestorePage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/admin/pages/BackupRestorePage.tsx</c> (route <c>/backup</c>, nav name <c>BackupRestore</c>).
/// Carries the diagnostics slug, the navigation route name and the generated OpenAPI operation ids the feed binds
/// (ADR-004), all of which resolve against the generated endpoint table.
/// </summary>
public static class BackupRestoreRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "BackupRestorePage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>BackupRestore</c>).</summary>
    public const string RouteName = "BackupRestore";

    /// <summary>Generated operation id for the configs list read (web <c>GET /backup/configs</c>).</summary>
    public const string ConfigsListOperation = "get_api_v1_backup_configs";

    /// <summary>Generated operation id for the config create mutation (web <c>POST /backup/configs</c>).</summary>
    public const string ConfigCreateOperation = "post_api_v1_backup_configs";

    /// <summary>Generated operation id for the config update mutation (web <c>PUT /backup/configs/{id}</c>).</summary>
    public const string ConfigUpdateOperation = "put_api_v1_backup_configs_configID";

    /// <summary>Generated operation id for the config delete mutation (web <c>DELETE /backup/configs/{id}</c>).</summary>
    public const string ConfigDeleteOperation = "delete_api_v1_backup_configs_configID";

    /// <summary>Generated operation id for the config trigger mutation (web <c>POST /backup/configs/{id}/trigger</c>).</summary>
    public const string ConfigTriggerOperation = "post_api_v1_backup_configs_configID_trigger";

    /// <summary>Generated operation id for the runs list read (web <c>GET /backup/runs</c>).</summary>
    public const string RunsListOperation = "get_api_v1_backup_runs";

    /// <summary>Generated operation id for the quick-backup mutation (web <c>POST /backup/quick</c>).</summary>
    public const string QuickBackupOperation = "post_api_v1_backup_quick";

    /// <summary>Generated operation id for the run verify mutation (web <c>POST /backup/runs/{id}/verify</c>).</summary>
    public const string RunVerifyOperation = "post_api_v1_backup_runs_runID_verify";

    /// <summary>Generated operation id for the restore preview read (web <c>GET /backup/runs/{id}/preview</c>).</summary>
    public const string RunPreviewOperation = "get_api_v1_backup_runs_runID_preview";

    /// <summary>The path-parameter name for a config id in the generated config routes.</summary>
    public const string ConfigIdPathParam = "configID";

    /// <summary>The path-parameter name for a run id in the generated run routes.</summary>
    public const string RunIdPathParam = "runID";

    /// <summary>The localized page title (web <c>backup.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("backup.title", "Backup & Restore");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>BackupRestorePage</c> surface (P1/S11 diagnostics contract). Records only the
/// surface slug with the <c>view.opened</c> event — never a backup file name, size or schedule — so a diagnostics
/// line can never leak an operator's backup footprint. Thread-safe.
/// </summary>
public sealed class BackupRestoreDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BackupRestoreDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BackupRestorePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BackupRestoreRegistration.Slug}");
    }
}
