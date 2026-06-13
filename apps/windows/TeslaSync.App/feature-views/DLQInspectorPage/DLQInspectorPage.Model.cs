using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.DlqInspector;
using TeslaSync.App.ModalsDialogs;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The top-level data state the <c>DLQInspectorPage</c> surfaces for its primary (DLQ list) query — the native
/// discriminator for the three web data states the page exposes through its <c>PageContainer query={list}</c>
/// freshness chip and the child surfaces (web/src/features/admin/pages/DLQInspectorPage.tsx). The web page never
/// blanks the body — the children always render (the StatusHeader em-dash tiles, the EntriesTable "Loading…" /
/// empty body) — so this enum drives only the page-tier indicator + the optional retryable error surface, never a
/// hidden region.
/// </summary>
public enum DlqInspectorState
{
    /// <summary>The list query is in flight with no data yet (web <c>list.isLoading</c>).</summary>
    Loading,

    /// <summary>The list query failed (web <c>list.isError</c>) — show the InfoBar + Retry while the children stay visible.</summary>
    Error,

    /// <summary>The list query resolved (web <c>list.data</c>) — tiles, entries and audit render their content.</summary>
    Ready,
}

/// <summary>
/// Stable replay-result codes returned by <c>POST /system/dlq/{id}/replay</c> — the native mirror of the web
/// <c>DLQReplayResult</c> union (web/src/types/admin-diagnostics.ts). The page branches on <see cref="Ok"/> (close
/// the drawer) and <see cref="Disabled"/> (raise the replay-blocked banner); every other code is a logged failure the
/// web surfaces through its mutation toast.
/// </summary>
public enum DlqReplayResultCode
{
    /// <summary>Replay published successfully (web <c>ok</c>).</summary>
    Ok,

    /// <summary>MQTT publish errored (web <c>publish_failed</c>).</summary>
    PublishFailed,

    /// <summary>Replay rejected by the per-actor rate limit (web <c>rate_limited</c>).</summary>
    RateLimited,

    /// <summary>Replay disabled at server boot, <c>DLQ_REPLAY_ENABLED=false</c> (web <c>disabled</c>).</summary>
    Disabled,

    /// <summary>Entry id no longer exists (web <c>not_found</c>).</summary>
    NotFound,

    /// <summary>DLQ row was missing its source topic / unparseable (web <c>unparseable</c>).</summary>
    Unparseable,

    /// <summary>An unrecognised / absent code — treated as a generic failure.</summary>
    Unknown,
}

/// <summary>Maps the wire replay-result string to its <see cref="DlqReplayResultCode"/> (tolerant of unknown codes).</summary>
public static class DlqReplayResultCodes
{
    /// <summary>Resolve a wire result string to its enum, defaulting to <see cref="DlqReplayResultCode.Unknown"/>.</summary>
    public static DlqReplayResultCode Parse(string? result) => result switch
    {
        "ok" => DlqReplayResultCode.Ok,
        "publish_failed" => DlqReplayResultCode.PublishFailed,
        "rate_limited" => DlqReplayResultCode.RateLimited,
        "disabled" => DlqReplayResultCode.Disabled,
        "not_found" => DlqReplayResultCode.NotFound,
        "unparseable" => DlqReplayResultCode.Unparseable,
        _ => DlqReplayResultCode.Unknown,
    };
}

/// <summary>
/// The replay outcome — the native mirror of the web <c>DLQReplayResponse</c> (web/src/types/admin-diagnostics.ts):
/// the success flag, the replayed entry id, the destination topic and the stable <see cref="Result"/> code the page
/// branches on. Pure data — no WinUI types.
/// </summary>
/// <param name="Ok">Whether the replay published (web <c>ok</c>).</param>
/// <param name="ReplayedId">The replayed entry id (web <c>replayed_id</c>).</param>
/// <param name="DstTopic">The destination topic the entry was republished to (web <c>dst_topic</c>).</param>
/// <param name="Result">The stable replay-result code (web <c>result</c>).</param>
/// <param name="Error">The replay error message, when one occurred (web <c>error</c>).</param>
public sealed record DlqReplayOutcome(
    bool Ok,
    long ReplayedId,
    string DstTopic,
    DlqReplayResultCode Result,
    string? Error = null);

// ── Data ports (the four web hooks) ───────────────────────────────────────────────────────────────────────────────

/// <summary>
/// The DLQ list data port — the native parity of the web <c>useDLQList</c> hook (<c>GET /system/dlq</c>). The view
/// never performs HTTP itself; the default <see cref="EmptyDlqListFeed"/> resolves to an empty queue and the
/// generated-client-backed <c>DlqListClientFeed</c> binds to the generated OpenAPI contract client (ADR-004). A
/// failing fetch throws (carrying the HTTP status via <c>ApiException</c>) so the view-model surfaces the
/// retryable error state.
/// </summary>
public interface IDlqListFeed
{
    /// <summary>Resolve the DLQ list snapshot (web <c>useDLQList</c>).</summary>
    Task<DlqListSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The single-entry data port — the native parity of the web <c>useDLQEntry</c> hook (<c>GET /system/dlq/{id}</c>),
/// lazily invoked when the operator opens an entry's drawer (web <c>enabled: !!selected</c>).
/// </summary>
public interface IDlqEntryFeed
{
    /// <summary>Resolve the full DLQ entry for <paramref name="id"/> (web <c>useDLQEntry</c>).</summary>
    Task<DlqEntryFull> FetchAsync(long id, CancellationToken cancellationToken);
}

/// <summary>
/// The replay-audit data port — the native parity of the web <c>useDLQAudit</c> hook
/// (<c>GET /system/dlq/audit</c>, or <c>GET /system/dlq/{id}/audit</c> when scoped). The page mounts the global feed
/// (<c>scopedDlqId == null</c>, <c>limit = 50</c>).
/// </summary>
public interface IDlqAuditFeed
{
    /// <summary>Resolve the recent replay-audit rows (web <c>useDLQAudit</c>); <paramref name="dlqId"/> scopes to one entry.</summary>
    Task<IReadOnlyList<AuditRecord>> FetchAsync(long? dlqId, int limit, CancellationToken cancellationToken);
}

/// <summary>
/// The replay command port — the native parity of the web <c>useDLQReplay</c> mutation
/// (<c>POST /system/dlq/{id}/replay</c>). The replay is sudo-gated transparently by the shared client; a hard
/// <c>DLQ_REPLAY_ENABLED=false</c> server gate surfaces as HTTP 403 (mapped to the replay-blocked banner).
/// </summary>
public interface IDlqReplayService
{
    /// <summary>Replay the DLQ entry <paramref name="id"/> back to its source topic (web <c>useDLQReplay</c>).</summary>
    Task<DlqReplayOutcome> ReplayAsync(long id, CancellationToken cancellationToken);
}

/// <summary>The default DLQ list feed — resolves every fetch to an empty, replay-disabled queue.</summary>
public sealed class EmptyDlqListFeed : IDlqListFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyDlqListFeed Instance { get; } = new();

    private EmptyDlqListFeed()
    {
    }

    /// <inheritdoc />
    public Task<DlqListSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new DlqListSnapshot(0, false, Array.Empty<DlqEntrySummary>()));
    }
}

/// <summary>The default DLQ entry feed — resolves to an empty full record (never reached in the empty page).</summary>
public sealed class EmptyDlqEntryFeed : IDlqEntryFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyDlqEntryFeed Instance { get; } = new();

    private EmptyDlqEntryFeed()
    {
    }

    /// <inheritdoc />
    public Task<DlqEntryFull> FetchAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var summary = new DlqEntrySummary(id, string.Empty, string.Empty, false, 0);
        return Task.FromResult(new DlqEntryFull(summary, string.Empty, string.Empty));
    }
}

/// <summary>The default replay-audit feed — resolves every fetch to no rows.</summary>
public sealed class EmptyDlqAuditFeed : IDlqAuditFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyDlqAuditFeed Instance { get; } = new();

    private EmptyDlqAuditFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<AuditRecord>> FetchAsync(long? dlqId, int limit, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<AuditRecord>>(Array.Empty<AuditRecord>());
    }
}

/// <summary>The default replay service — always reports the replay disabled (the empty page has nothing to replay).</summary>
public sealed class EmptyDlqReplayService : IDlqReplayService
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyDlqReplayService Instance { get; } = new();

    private EmptyDlqReplayService()
    {
    }

    /// <inheritdoc />
    public Task<DlqReplayOutcome> ReplayAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new DlqReplayOutcome(false, id, string.Empty, DlqReplayResultCode.Disabled));
    }
}

/// <summary>
/// Canonical metadata + localized literals for the <c>DLQInspectorPage</c> feature surface — the native mirror of the
/// web page at <c>web/src/features/admin/pages/DLQInspectorPage.tsx</c> (route <c>/admin/dlq</c>, nav name
/// <c>DLQInspector</c>). Every visible literal resolves through the i18n facade using the same catalog keys the web
/// source feeds into <c>t()</c> (the Strings/{lang}/Resources.resw catalog stores them under the <c>translation.</c>
/// prefix); the English fallback is the web default verbatim. UI-free so the mapping is asserted without a XAML host.
/// </summary>
public static class DlqInspectorRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "DLQInspectorPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>DLQInspector</c> → <c>admin/dlq</c>).</summary>
    public const string RouteName = "DLQInspector";

    /// <summary>The generated OpenAPI operation id for the list query (web <c>useDLQList</c>, <c>GET /system/dlq</c>).</summary>
    public const string ListOperation = "get_api_v1_system_dlq";

    /// <summary>The generated OpenAPI operation id for the single-entry query (web <c>useDLQEntry</c>, <c>GET /system/dlq/{id}</c>).</summary>
    public const string EntryOperation = "get_api_v1_system_dlq_id";

    /// <summary>The generated OpenAPI operation id for the global audit query (web <c>useDLQAudit</c>, <c>GET /system/dlq/audit</c>).</summary>
    public const string AuditOperation = "get_api_v1_system_dlq_audit";

    /// <summary>The generated OpenAPI operation id for the scoped audit query (web <c>useDLQAudit</c>, <c>GET /system/dlq/{id}/audit</c>).</summary>
    public const string EntryAuditOperation = "get_api_v1_system_dlq_id_audit";

    /// <summary>The generated OpenAPI operation id for the replay mutation (web <c>useDLQReplay</c>, <c>POST /system/dlq/{id}/replay</c>).</summary>
    public const string ReplayOperation = "post_api_v1_system_dlq_id_replay";

    /// <summary>The default audit page size the global feed mounts with (web <c>useDLQAudit(null, 50)</c>).</summary>
    public const int AuditLimit = 50;

    /// <summary>The page title (web key <c>admin.dlq.pageTitle</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Get(localizer, "translation.admin.dlq.pageTitle", "DLQ Inspector");

    /// <summary>The page subtitle (web key <c>admin.dlq.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Get(localizer, "translation.admin.dlq.subtitle",
            "Dead-letter queue \u2014 inspect failed ingests and replay them back to their source topic.");

    /// <summary>The dead-letter-entries panel title (web key <c>admin.dlq.panels.entries</c>).</summary>
    public static string PanelEntries(ILocalizer localizer) =>
        Get(localizer, "translation.admin.dlq.panels.entries", "Dead-letter entries");

    /// <summary>The replay-activity panel title (web key <c>admin.dlq.panels.audit</c>).</summary>
    public static string PanelAudit(ILocalizer localizer) =>
        Get(localizer, "translation.admin.dlq.panels.audit", "Recent replay activity");

    /// <summary>The replay-blocked banner title (web key <c>admin.dlq.banners.replayBlockedTitle</c>).</summary>
    public static string BannerBlockedTitle(ILocalizer localizer) =>
        Get(localizer, "translation.admin.dlq.banners.replayBlockedTitle", "Replay blocked");

    /// <summary>The replay-blocked banner message (web key <c>admin.dlq.banners.replayBlockedMessage</c>).</summary>
    public static string BannerBlockedMessage(ILocalizer localizer) =>
        Get(localizer, "translation.admin.dlq.banners.replayBlockedMessage",
            "The server rejected the replay because DLQ_REPLAY_ENABLED is not set. Restart the worker with this env var to enable replays.");

    /// <summary>The replay confirm-dialog title (web key <c>admin.dlq.confirm.title</c>).</summary>
    public static string ConfirmTitle(ILocalizer localizer) =>
        Get(localizer, "translation.admin.dlq.confirm.title", "Replay DLQ entry?");

    /// <summary>
    /// The replay confirm-dialog message with the entry id interpolated (web key <c>admin.dlq.confirm.message</c>,
    /// web template <c>"…entry #{{id}}…"</c> — the catalog uses the positional <c>{0}</c> form).
    /// </summary>
    public static string ConfirmMessage(ILocalizer localizer, long id)
    {
        string template = Get(localizer, "translation.admin.dlq.confirm.message",
            "This will republish entry #{0} to its source topic. The action is logged and rate-limited.");
        return template.Replace("{0}", id.ToString(System.Globalization.CultureInfo.CurrentCulture), StringComparison.Ordinal);
    }

    /// <summary>The replay confirm-dialog confirm label (web key <c>admin.dlq.confirm.confirm</c>).</summary>
    public static string ConfirmLabel(ILocalizer localizer) =>
        Get(localizer, "translation.admin.dlq.confirm.confirm", "Replay");

    /// <summary>The shared cancel label (web key <c>common.cancel</c>).</summary>
    public static string CancelLabel(ILocalizer localizer) =>
        Get(localizer, "translation.common.cancel", "Cancel");

    /// <summary>The retry affordance label for the list-error surface.</summary>
    public static string RetryLabel(ILocalizer localizer) =>
        Get(localizer, "translation.common.retry", "Retry");

    /// <summary>The list-error surface message.</summary>
    public static string LoadErrorMessage(ILocalizer localizer) =>
        Get(localizer, "translation.admin.dlq.errors.loadFailed", "Failed to load the dead-letter queue.");

    private static string Get(ILocalizer localizer, string key, string fallback)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(key, fallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>DLQInspectorPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a DLQ id, VIN, payload, actor or topic — so a
/// diagnostics line can never leak operational data. Thread-safe.
/// </summary>
public sealed class DlqInspectorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DlqInspectorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DLQInspectorPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DlqInspectorRegistration.Slug}");
    }
}
