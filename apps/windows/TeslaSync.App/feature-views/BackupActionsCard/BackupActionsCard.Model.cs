using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Tolerant <see cref="JsonElement"/> readers for the backup-runs payload. Each getter returns a fallback
/// (null / zero) for an absent or wrong-kind property so a partial or schema-drifted body from
/// <c>GET /backup/runs</c> never aborts the parse — mirroring the web hook's defensive <c>?? 0</c> /
/// <c>?? null</c> reads (web/src/api/types.ts <c>BackupRun</c>). Numeric strings are accepted because the Go
/// API occasionally serializes ids / sizes as strings. Kept private to the surface and free of WinUI types so
/// the parse is unit-tested without a UI host.
/// </summary>
internal static class BackupActionsJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    internal static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var v)
        && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    /// <summary>The numeric value of <paramref name="name"/> as a double (number or numeric string), or null.</summary>
    internal static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(
                v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }
}

/// <summary>
/// The derived backup-status summary backing the <c>BackupActionsCard</c> surface — the native projection of
/// the backup-section <c>DefList</c> the web component wraps
/// (web/src/features/system/pages/SystemStatusPage.tsx, rows fed into
/// <c>web/src/features/system/components/status/BackupActionsCard.tsx</c>). It carries the run-derived rows the
/// quick-backup action affects (and that the web card invalidates via the <c>backup-runs</c> query): the total
/// run count, the most-recent successful run's completion time and size (web
/// <c>backupRuns.find(r =&gt; r.status === 'completed')</c>), and the recent-failure count
/// (<c>filter(r =&gt; r.status === 'failed')</c>). <see cref="HasData"/> distinguishes a fetched payload (even
/// one with no runs) from the absent-body fallback used for the first projection, so an empty list renders the
/// "no backups yet" empty surface rather than the engine's generic empty. Pure data — unit-tested without a UI
/// host.
/// </summary>
public sealed record BackupActionsSnapshot(
    int TotalRuns,
    string? LastSuccessfulCompletedAt,
    double? LastSuccessfulSizeBytes,
    int RecentFailures)
{
    /// <summary>Wire <c>status</c> value for a completed (successful) backup run (web <c>'completed'</c>).</summary>
    public const string CompletedStatus = "completed";

    /// <summary>Wire <c>status</c> value for a failed backup run (web <c>'failed'</c>).</summary>
    public const string FailedStatus = "failed";

    /// <summary>The absent-body fallback (no payload yet) — flagged <see cref="HasData"/> = false.</summary>
    public static BackupActionsSnapshot Empty { get; } =
        new(0, null, null, 0) { HasData = false };

    /// <summary>True once a payload has been fetched (web <c>data</c> truthiness). False only for <see cref="Empty"/>.</summary>
    public bool HasData { get; init; } = true;

    /// <summary>True when at least one backup run is present.</summary>
    public bool HasRuns => TotalRuns > 0;

    /// <summary>The parsed completion instant of the last successful run, or null when absent / unparseable.</summary>
    public DateTimeOffset? LastSuccessfulCompletedAtInstant => TryParseTimestamp(LastSuccessfulCompletedAt);

    /// <summary>
    /// Project a <c>GET /backup/runs</c> JSON array into the derived summary. A non-array body yields
    /// <see cref="Empty"/> (web parity: the query has no usable data). The most-recent successful run mirrors
    /// the web <c>find(r =&gt; r.status === 'completed')</c> over the API's newest-first order, so the array
    /// order is preserved rather than re-sorted.
    /// </summary>
    public static BackupActionsSnapshot FromJson(JsonElement runs)
    {
        if (runs.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        int total = 0;
        int failures = 0;
        string? lastSuccessfulCompletedAt = null;
        double? lastSuccessfulSize = null;
        bool foundSuccessful = false;

        foreach (var item in runs.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            total++;
            string? status = BackupActionsJson.GetString(item, "status");

            if (string.Equals(status, FailedStatus, StringComparison.Ordinal))
            {
                failures++;
            }

            // Web parity: the FIRST completed run in the API's newest-first order is the last successful one.
            if (!foundSuccessful && string.Equals(status, CompletedStatus, StringComparison.Ordinal))
            {
                foundSuccessful = true;
                lastSuccessfulCompletedAt = BackupActionsJson.GetString(item, "completed_at");
                lastSuccessfulSize = BackupActionsJson.GetDouble(item, "file_size");
            }
        }

        return new BackupActionsSnapshot(total, lastSuccessfulCompletedAt, lastSuccessfulSize, failures);
    }

    private static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind | DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>One label/value row in the backup-status summary (the native analogue of a web <c>DefList</c> row).</summary>
public sealed record BackupActionsRow(string Label, string Value);

/// <summary>
/// The fully projected, render-ready view of the backup-status summary — everything the WinUI view draws for
/// the content region: the four run-derived rows (web backup-section <c>DefList</c>), an
/// <see cref="HasRuns"/> flag selecting the rows-vs-empty body, the localized empty message, and a composed
/// Narrator summary. Pure data so the projection is unit-tested directly.
/// </summary>
public sealed record BackupActionsDisplay(
    bool HasData,
    bool HasRuns,
    IReadOnlyList<BackupActionsRow> Rows,
    string EmptyMessage,
    string AccessibilitySummary);

/// <summary>
/// Pure projection from a parsed <see cref="BackupActionsSnapshot"/> to the render-ready
/// <see cref="BackupActionsDisplay"/> — the native port of the backup-section <c>DefList</c> row construction in
/// web/src/features/system/pages/SystemStatusPage.tsx plus the <c>formatBytes</c> / <c>formatDateTime</c>
/// helpers. Byte sizes are dimensionless (no SI conversion needed); every label resolves through the i18n
/// facade and <c>now</c> is injected so the absolute date format is deterministic in tests.
/// </summary>
public static class BackupActionsProjection
{
    private static readonly string[] ByteUnits = { "B", "KB", "MB", "GB", "TB" };

    /// <summary>
    /// Format a byte count into a human-readable size exactly as the web <c>formatBytes</c> helper does: "0 B"
    /// for non-positive input; otherwise the largest fitting unit (B/KB/MB/GB/TB) with one decimal below 10
    /// (e.g. "1.5 GB") and a rounded integer at or above 10 (e.g. "450 MB"). Invariant-culture so the output
    /// matches the web's locale-independent <c>toFixed</c> / <c>Math.round</c>.
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

    /// <summary>Project <paramref name="snapshot"/> at <paramref name="now"/> using the i18n facade.</summary>
    public static BackupActionsDisplay Project(
        BackupActionsSnapshot snapshot,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        string totalRunsLabel = BackupActionsCardRegistration.TotalRunsLabel(localizer);
        string lastSuccessfulLabel = BackupActionsCardRegistration.LastSuccessfulLabel(localizer);
        string lastSuccessfulSizeLabel = BackupActionsCardRegistration.LastSuccessfulSizeLabel(localizer);
        string failuresLabel = BackupActionsCardRegistration.FailuresLabel(localizer);

        string totalRunsValue = snapshot.TotalRuns.ToString(CultureInfo.InvariantCulture);
        string lastSuccessfulValue = DateTimeFormatting.Format(
            snapshot.LastSuccessfulCompletedAtInstant, DateTimeVariant.Full, now);

        // Web parity: a missing / zero file size renders the em-dash (`fileSize ? formatBytes(...) : '—'`).
        string lastSuccessfulSizeValue = snapshot.LastSuccessfulSizeBytes is { } size && size > 0
            ? FormatBytes(size)
            : DateTimeFormatting.DefaultEmptyDisplay;

        string failuresValue = snapshot.RecentFailures.ToString(CultureInfo.InvariantCulture);

        var rows = new List<BackupActionsRow>(4)
        {
            new(totalRunsLabel, totalRunsValue),
            new(lastSuccessfulLabel, lastSuccessfulValue),
            new(lastSuccessfulSizeLabel, lastSuccessfulSizeValue),
            new(failuresLabel, failuresValue),
        };

        string accessibilitySummary = string.Join(
            ", ",
            rows.Select(r => string.Format(CultureInfo.CurrentCulture, "{0}: {1}", r.Label, r.Value)));

        return new BackupActionsDisplay(
            HasData: snapshot.HasData,
            HasRuns: snapshot.HasRuns,
            Rows: rows,
            EmptyMessage: BackupActionsCardRegistration.EmptyLabel(localizer),
            AccessibilitySummary: accessibilitySummary);
    }
}

/// <summary>
/// The top-level state the backup-status content region renders — the native union of the
/// loading / loaded / empty / error / stale / offline branches a standalone Windows surface must show. The
/// action footer (the quick-backup button + the manage-backups link) is always visible regardless of this
/// state (web parity: the card always renders its action row). The generic data states are driven by the
/// cache-then-network backup-runs read the native surface adds for completeness (the web component itself has
/// no data query — it composes <c>useMutation</c> + <c>useQueryClient</c> + <c>useToast</c> only).
/// </summary>
public enum BackupActionsState
{
    /// <summary>The first backup-runs read is in flight and no cached value exists yet.</summary>
    Loading,

    /// <summary>The status is known and at least one backup run is available — render the summary rows.</summary>
    Ready,

    /// <summary>The read succeeded but there are no backup runs — render the "no backups yet" empty surface.</summary>
    Empty,

    /// <summary>The read failed with no cached value — render an inline error with a retry affordance.</summary>
    Error,

    /// <summary>A cached value is shown but is past the freshness window — render rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network is unreachable; a cached value may be shown plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The lifecycle of the quick-backup action — the native analogue of the web component's <c>useMutation</c>
/// status (web/src/features/system/components/status/BackupActionsCard.tsx <c>mutation.isPending</c> + the
/// success / error toast outcomes).
/// </summary>
public enum BackupActionPhase
{
    /// <summary>No action in progress (button shows "Run quick backup now").</summary>
    Idle,

    /// <summary>The quick-backup mutation is in flight (button shows the busy "Starting…" label, disabled).</summary>
    Running,

    /// <summary>The mutation succeeded (web <c>toast.success('Quick backup started')</c>).</summary>
    Succeeded,

    /// <summary>The mutation failed (web <c>toast.error(...)</c> — permission or generic failure).</summary>
    Failed,
}

/// <summary>The semantic tone of the inline action feedback the surface announces after a quick-backup settles.</summary>
public enum BackupActionFeedbackTone
{
    /// <summary>No feedback to show (idle / running).</summary>
    None,

    /// <summary>A success confirmation (web <c>toast.success</c>).</summary>
    Success,

    /// <summary>A failure message (web <c>toast.error</c>).</summary>
    Error,
}

/// <summary>
/// The outcome of a quick-backup mutation (<c>POST /backup/quick</c>). On success it carries nothing beyond the
/// success flag (web parity: the mutation result only primes a query invalidation + a success toast); on
/// failure it carries the classified, privacy-safe <see cref="RepositoryError"/> so the view-model can pick the
/// permission-specific message for a 401/403 (web <c>status === 401 || status === 403</c>).
/// </summary>
public sealed record QuickBackupOutcome(bool Success, RepositoryError? Error)
{
    /// <summary>A successful quick-backup trigger.</summary>
    public static QuickBackupOutcome Ok() => new(true, null);

    /// <summary>A failed quick-backup trigger carrying the classified error.</summary>
    public static QuickBackupOutcome Fail(RepositoryError error) => new(false, error);
}

/// <summary>
/// The navigation port the "Manage backups &amp; restore" link drives — the native analogue of the web
/// <c>&lt;Link to="/backup"&gt;</c> (web/src/features/system/components/status/BackupActionsCard.tsx). A shell
/// adapter performs the actual navigation to the <c>BackupRestore</c> route (path <c>backup</c>); a test fake
/// records the request. Keeping navigation behind this seam keeps the view free of any router dependency and
/// lets the logic be asserted headlessly.
/// </summary>
public interface IBackupActionsNavigator
{
    /// <summary>Navigate to the Backup &amp; Restore page (web target <c>/backup</c>).</summary>
    void NavigateToBackups();
}

/// <summary>A null <see cref="IBackupActionsNavigator"/> that accepts and discards navigation (headless / test default).</summary>
public sealed class NullBackupActionsNavigator : IBackupActionsNavigator
{
    /// <summary>The shared singleton instance.</summary>
    public static NullBackupActionsNavigator Instance { get; } = new();

    private NullBackupActionsNavigator()
    {
    }

    /// <inheritdoc />
    public void NavigateToBackups()
    {
    }
}

/// <summary>
/// Canonical registry metadata for the <c>BackupActionsCard</c> surface — the native mirror of the web
/// component (web/src/features/system/components/status/BackupActionsCard.tsx). Centralises the stable id, the
/// diagnostics slug, the generated OpenAPI operation ids and every localized string (with the same English
/// copy the web renders) so the view, view-model and projection stay free of literal copy. The web component is
/// anonymous (no <c>t(...)</c> calls of its own — its copy is hard-coded English and its rows come from the
/// parent page), so these keys are introduced by the native surface and resolve through the i18n facade with
/// the English fallback when a catalog entry is absent.
/// </summary>
public static class BackupActionsCardRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "backup-actions-card";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "BackupActionsCard";

    /// <summary>The native target route path for the manage-backups link (web <c>/backup</c>; route <c>BackupRestore</c>).</summary>
    public const string BackupRoutePath = "backup";

    /// <summary>Generated operation id for the backup-runs list read (web <c>getBackupRuns</c>).</summary>
    public const string RunsOperationId = "get_api_v1_backup_runs";

    /// <summary>Generated operation id for the quick-backup mutation (web <c>triggerQuickBackup</c>).</summary>
    public const string QuickBackupOperationId = "post_api_v1_backup_quick";

    /// <summary>Accessible surface name (web accordion section "Backups").</summary>
    public static string SurfaceLabel(ILocalizer localizer) =>
        Require(localizer).GetString("system.backupActions.surfaceLabel", "Backups");

    /// <summary>Idle quick-backup button label (web <c>'Run quick backup now'</c>).</summary>
    public static string RunLabel(ILocalizer localizer) =>
        Require(localizer).GetString("system.backupActions.run", "Run quick backup now");

    /// <summary>Busy quick-backup button label (web <c>'Starting…'</c>).</summary>
    public static string StartingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("system.backupActions.starting", "Starting\u2026");

    /// <summary>Manage-backups link label (web <c>'Manage backups &amp; restore'</c>).</summary>
    public static string ManageLabel(ILocalizer localizer) =>
        Require(localizer).GetString("system.backupActions.manage", "Manage backups & restore");

    /// <summary>Success feedback (web <c>toast.success('Quick backup started')</c>).</summary>
    public static string StartedLabel(ILocalizer localizer) =>
        Require(localizer).GetString("system.backupActions.started", "Quick backup started");

    /// <summary>Permission-failure feedback for a 401/403 (web <c>'Quick backup requires admin permission.'</c>).</summary>
    public static string PermissionErrorLabel(ILocalizer localizer) =>
        Require(localizer).GetString(
            "system.backupActions.permissionError", "Quick backup requires admin permission.");

    /// <summary>
    /// Generic-failure feedback with the underlying message interpolated (web
    /// <c>`Backup failed: ${msg}`</c>).
    /// </summary>
    public static string FailedLabel(ILocalizer localizer, string message) =>
        Format(Require(localizer).GetString("system.backupActions.failed", "Backup failed: {0}"), message);

    /// <summary>Fallback failure detail when the error carries no message (web <c>'Unknown error'</c>).</summary>
    public static string UnknownErrorLabel(ILocalizer localizer) =>
        Require(localizer).GetString("system.backupActions.unknownError", "Unknown error");

    // ── Backup-status content rows (web backup-section DefList) ─────────────────────────────────────────

    /// <summary>"Total runs" row label (web <c>t('Total runs')</c>).</summary>
    public static string TotalRunsLabel(ILocalizer localizer) =>
        Require(localizer).GetString("system.backupActions.totalRuns", "Total runs");

    /// <summary>"Last successful" row label (web <c>t('Last successful')</c>).</summary>
    public static string LastSuccessfulLabel(ILocalizer localizer) =>
        Require(localizer).GetString("system.backupActions.lastSuccessful", "Last successful");

    /// <summary>"Last successful size" row label (web <c>t('Last successful size')</c>).</summary>
    public static string LastSuccessfulSizeLabel(ILocalizer localizer) =>
        Require(localizer).GetString("system.backupActions.lastSuccessfulSize", "Last successful size");

    /// <summary>"Failures (recent)" row label (web <c>t('Failures (recent)')</c>).</summary>
    public static string FailuresLabel(ILocalizer localizer) =>
        Require(localizer).GetString("system.backupActions.failures", "Failures (recent)");

    // ── State chrome ────────────────────────────────────────────────────────────────────────────────

    /// <summary>Loading caption while the backup-status read is in flight.</summary>
    public static string LoadingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("system.backupActions.loading", "Loading backup status");

    /// <summary>Empty-state message when no backup runs exist yet.</summary>
    public static string EmptyLabel(ILocalizer localizer) =>
        Require(localizer).GetString("system.backupActions.empty", "No backups have run yet");

    /// <summary>Generic read-failure message.</summary>
    public static string ErrorLabel(ILocalizer localizer) =>
        Require(localizer).GetString("system.backupActions.error", "Couldn't load backup status");

    /// <summary>Read-failure message for an authentication fault (401/403).</summary>
    public static string AuthErrorLabel(ILocalizer localizer) =>
        Require(localizer).GetString("system.backupActions.error.auth", "Sign in to view backup status");

    /// <summary>Read-failure message for an offline / network fault (with a cached value shown).</summary>
    public static string OfflineErrorLabel(ILocalizer localizer) =>
        Require(localizer).GetString(
            "system.backupActions.error.offline", "You're offline — showing the last cached backup status");

    /// <summary>Stale-status hint (the cached rows stay visible).</summary>
    public static string StaleLabel(ILocalizer localizer) =>
        Require(localizer).GetString("system.backupActions.stale", "Backup status may be out of date");

    /// <summary>Retry affordance label for the error surface.</summary>
    public static string RetryLabel(ILocalizer localizer) =>
        Require(localizer).GetString("system.backupActions.retry", "Retry");

    /// <summary>Resolve the localized read-failure message for a classified <paramref name="error"/>.</summary>
    public static string ReadErrorFor(ILocalizer localizer, RepositoryError? error) => error?.Kind switch
    {
        RepositoryErrorKind.Unauthorized => AuthErrorLabel(localizer),
        RepositoryErrorKind.Offline or RepositoryErrorKind.Network => OfflineErrorLabel(localizer),
        _ => ErrorLabel(localizer),
    };

    private static string Format(string template, string value) =>
        template.Contains("{0}", StringComparison.Ordinal)
            ? string.Format(CultureInfo.CurrentCulture, template, value)
            : template;

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>BackupActionsCard</c> surface (P1/S11 diagnostics contract). Records only the
/// operational counters with the surface slug — never a backup file name, size or timestamp — so a diagnostics
/// line can never leak an operator's backup schedule or storage footprint. Thread-safe.
/// </summary>
public sealed class BackupActionsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _runsRequested;
    private long _runsSucceeded;
    private long _runsFailed;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BackupActionsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of quick-backup actions requested.</summary>
    public long RunsRequested => Interlocked.Read(ref _runsRequested);

    /// <summary>Number of quick-backup actions that succeeded.</summary>
    public long RunsSucceeded => Interlocked.Read(ref _runsSucceeded);

    /// <summary>Number of quick-backup actions that failed.</summary>
    public long RunsFailed => Interlocked.Read(ref _runsFailed);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BackupActionsCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BackupActionsCardRegistration.Slug}");
    }

    /// <summary>Record that a quick-backup action was requested.</summary>
    public void RecordRunRequested()
    {
        Interlocked.Increment(ref _runsRequested);
        _sink?.Invoke($"backup.quick.requested slug={BackupActionsCardRegistration.Slug}");
    }

    /// <summary>Record the resolution of a quick-backup action (success/failure only — never backup details).</summary>
    public void RecordRunResolved(bool success)
    {
        if (success)
        {
            Interlocked.Increment(ref _runsSucceeded);
        }
        else
        {
            Interlocked.Increment(ref _runsFailed);
        }

        _sink?.Invoke(
            $"backup.quick.resolved slug={BackupActionsCardRegistration.Slug} success={(success ? "true" : "false")}");
    }
}
