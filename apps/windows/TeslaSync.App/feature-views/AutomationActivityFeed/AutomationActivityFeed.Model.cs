using System.Globalization;
using System.Text;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The live-connection state of the automation SSE stream — the native union of the web component's
/// <c>connectionState: 'connected' | 'reconnecting'</c> prop
/// (web/src/features/automations/pages/AutomationActivityFeed.tsx). It drives only the header chip; the
/// history list itself is unaffected. UI-free so the header projection is unit-tested without a XAML runtime.
/// </summary>
public enum AutomationFeedConnection
{
    /// <summary>The SSE stream is connected — the green "Live" chip (web <c>connectionState === 'connected'</c>).</summary>
    Connected,

    /// <summary>The SSE stream is re-establishing — the amber pulsing "Reconnecting" chip (web <c>'reconnecting'</c>).</summary>
    Reconnecting,
}

/// <summary>
/// Which branch the history area renders — the native union of the three mutually-exclusive sub-states the web
/// component selects between for its history list (web/src/features/automations/pages/AutomationActivityFeed.tsx:
/// <c>isLoading ? skeletons : items.length &gt; 0 ? rows : EmptyState</c>). The header and the live-event strip
/// always render regardless of this branch, exactly as in the web source. UI-free.
/// </summary>
public enum AutomationHistorySection
{
    /// <summary>The parent's history query is still in flight — the skeleton rows (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>Resolved with at least one execution — the history rows (web <c>items.length &gt; 0</c>).</summary>
    Populated,

    /// <summary>Resolved with no executions — the friendly empty note (web <c>EmptyState</c>).</summary>
    Empty,
}

/// <summary>
/// One recent automation-execution row the web history list reads (web <c>AutomationHistory</c> in
/// web/src/api/types.ts), narrowed to the fields the feed actually renders
/// (web/src/features/automations/pages/AutomationActivityFeed.tsx <c>HistoryRow</c>). Pure data — no WinUI types —
/// so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Id">The execution id (web <c>item.id</c>), used only as the stable row key.</param>
/// <param name="AutomationName">The automation's display name (web <c>item.automation_name</c>).</param>
/// <param name="Status">The execution status discriminator (web <c>item.status</c>): success / partial / failed / skipped / test / undo / running / cancelled.</param>
/// <param name="Error">The failure detail, or null when the run did not fail (web <c>item.error</c>, shown as "— {error}").</param>
/// <param name="TriggeredAt">The instant the automation fired (web <c>item.triggered_at</c>), used for the relative-time label.</param>
/// <param name="DurationMs">The execution duration in milliseconds, or null (web <c>item.duration_ms</c>, shown via <c>formatDurationMs</c>).</param>
/// <param name="ActionsTotal">The number of actions the run attempted (web <c>item.actions_total</c>); the ratio shows only when this is &gt; 0.</param>
/// <param name="ActionsSucceeded">The number of actions that succeeded (web <c>item.actions_succeeded</c>).</param>
public sealed record AutomationHistoryEntry(
    long Id,
    string AutomationName,
    string Status,
    string? Error,
    DateTimeOffset TriggeredAt,
    double? DurationMs,
    int ActionsTotal,
    int ActionsSucceeded);

/// <summary>
/// The aggregate execution statistics the web header strip reads (web <c>AutomationHistoryStats</c> in
/// web/src/api/types.ts), narrowed to the three figures the strip renders
/// (web/src/features/automations/pages/AutomationActivityFeed.tsx). The strip is shown only when
/// <see cref="TotalExecutions"/> is &gt; 0 (web <c>historyStats &amp;&amp; historyStats.total_executions &gt; 0</c>).
/// Pure data — no WinUI types.
/// </summary>
/// <param name="TotalExecutions">Total runs in the window (web <c>total_executions</c>), shown verbatim before the "total" word.</param>
/// <param name="SuccessRate">The success percentage 0–100 (web <c>success_rate</c>), shown via <c>fmtPercent(_, 0)</c> before "success".</param>
/// <param name="AvgDurationMs">The mean duration in milliseconds (web <c>avg_duration_ms</c>), shown via <c>formatDurationMs</c> before "avg".</param>
public sealed record AutomationHistorySummary(
    long TotalExecutions,
    double SuccessRate,
    double AvgDurationMs);

/// <summary>
/// One real-time automation event the web live strip reads (web <c>AutomationActivityEvent</c> in
/// web/src/hooks/useAutomationEvents.ts), narrowed to the fields the strip renders
/// (web/src/features/automations/pages/AutomationActivityFeed.tsx <c>LiveEventRow</c>). The web event payloads all
/// carry a <c>name</c>; when it is absent the row falls back to <c>#{automation_id}</c>. Only failed events carry an
/// <see cref="Error"/> and only skipped events a <see cref="Reason"/>. Pure data — no WinUI types.
/// </summary>
/// <param name="Id">The event's unique id (web <c>event.id</c>), used as the stable row key.</param>
/// <param name="Type">The SSE event type (web <c>event.type</c>), e.g. <c>automation.triggered</c>; the badge drops the <c>automation.</c> prefix.</param>
/// <param name="AutomationId">The automation id (web <c>data.automation_id</c>), used for the <c>#id</c> name fallback.</param>
/// <param name="Name">The automation name (web <c>data.name</c>), or null to fall back to <c>#{AutomationId}</c>.</param>
/// <param name="Error">The failure detail for an <c>automation.failed</c> event (web <c>data.error</c>), or null.</param>
/// <param name="Reason">The skip detail for an <c>automation.skipped</c> event (web <c>data.reason</c>), or null.</param>
public sealed record AutomationLiveEvent(
    string Id,
    string Type,
    long AutomationId,
    string? Name,
    string? Error,
    string? Reason);

/// <summary>
/// The render-time data model the <c>AutomationActivityFeed</c> view binds to — the native analogue of the web
/// component's props (web/src/features/automations/pages/AutomationActivityFeed.tsx: <c>history</c>,
/// <c>historyStats</c>, <c>isLoading</c>, <c>liveEvents</c>, <c>connectionState</c>). The component is
/// presentational and performs no fetching, so the rendered surface is a direct function of this model; user-facing
/// labels are resolved from the i18n facade by the projection, not passed in. The fetch-driven error / stale /
/// offline branches are owned by the parent automations page (which renders its own query error / empty surface
/// before mounting this leaf), exactly as in the web source — the only live-connection nuance reproduced here is the
/// <see cref="Connection"/> chip, the web SSE <c>connectionState</c>. Pure data — no WinUI types — so the projection
/// is unit-tested without a UI host.
/// </summary>
/// <param name="Loading">Whether the parent's history query is still loading (the web <c>isLoading</c> skeleton hand-off).</param>
/// <param name="History">The recent executions feeding the history list (web <c>history</c>).</param>
/// <param name="Stats">The aggregate statistics for the header strip, or null when unavailable (web <c>historyStats</c>).</param>
/// <param name="LiveEvents">The real-time SSE events feeding the live strip, newest first (web <c>liveEvents</c>).</param>
/// <param name="Connection">The SSE connection state driving the header chip (web <c>connectionState</c>).</param>
public sealed record AutomationActivityFeedModel(
    bool Loading,
    IReadOnlyList<AutomationHistoryEntry> History,
    AutomationHistorySummary? Stats,
    IReadOnlyList<AutomationLiveEvent> LiveEvents,
    AutomationFeedConnection Connection)
{
    /// <summary>The initial model: the parent's history query is in flight and no data has arrived yet.</summary>
    public static AutomationActivityFeedModel Pending { get; } =
        new(true,
            Array.Empty<AutomationHistoryEntry>(),
            null,
            Array.Empty<AutomationLiveEvent>(),
            AutomationFeedConnection.Connected);

    /// <summary>A resolved model with no history, stats or live events — the friendly empty branch.</summary>
    public static AutomationActivityFeedModel Empty { get; } =
        new(false,
            Array.Empty<AutomationHistoryEntry>(),
            null,
            Array.Empty<AutomationLiveEvent>(),
            AutomationFeedConnection.Connected);
}

/// <summary>
/// One projected, render-ready live-event row — the native analogue of a single web <c>LiveEventRow</c>
/// (web/src/features/automations/pages/AutomationActivityFeed.tsx). <see cref="Glyph"/> and <see cref="Accent"/>
/// select the pulsing row icon and its colour (the web <c>typeMap</c>); <see cref="Name"/> is the resolved automation
/// name (or <c>#id</c>); <see cref="Detail"/> is the optional failure / skip note (<see cref="DetailIsError"/> picks
/// its red-vs-muted colour); <see cref="BadgeLabel"/> is the web <c>event.type.replace('automation.', '')</c> chip; and
/// <see cref="AutomationName"/> is the spoken row. Pure data.
/// </summary>
public sealed record AutomationLiveRow(
    string Glyph,
    StatusKind Accent,
    string Name,
    string? Detail,
    bool DetailIsError,
    string BadgeLabel,
    string AutomationName);

/// <summary>
/// One projected, render-ready history row — the native analogue of a single web <c>HistoryRow</c>
/// (web/src/features/automations/pages/AutomationActivityFeed.tsx). <see cref="Glyph"/> and <see cref="Accent"/> select
/// the status icon and colour (the web <c>statusConfig</c>); <see cref="Name"/> is the automation name; <see cref="Error"/>
/// is the optional inline failure note; <see cref="RelativeTime"/> and <see cref="Duration"/> are the pre-formatted
/// time-ago and duration strings; <see cref="Actions"/> is the <c>succeeded/total</c> ratio (null when the run attempted
/// no actions); and <see cref="AutomationName"/> is the spoken row. Pure data — the view never does number / date math.
/// </summary>
public sealed record AutomationHistoryRow(
    string Glyph,
    StatusKind Accent,
    string Name,
    string? Error,
    string RelativeTime,
    string Duration,
    string? Actions,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the surface for one input model — the native analogue of what the web
/// <c>AutomationActivityFeed</c> renders. Holds the header title + decorative glyph, the live-connection chip
/// (label / glyph / accent), the optional statistics strip (the three pre-formatted figures + a flag), the capped
/// live-event rows, the active history <see cref="HistorySection"/> with its projected rows / empty copy /
/// skeleton-row count, and the surface <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record AutomationActivityFeedDisplay(
    string Title,
    string Glyph,
    AutomationFeedConnection Connection,
    string ConnectionLabel,
    string ConnectionGlyph,
    StatusKind ConnectionAccent,
    bool ShowStats,
    string TotalLabel,
    string SuccessLabel,
    string AvgLabel,
    IReadOnlyList<AutomationLiveRow> LiveEvents,
    AutomationHistorySection HistorySection,
    IReadOnlyList<AutomationHistoryRow> History,
    string EmptyMessage,
    int SkeletonRows,
    string AutomationName)
{
    /// <summary>True when the live-event strip has at least one row (web <c>recentLive.length &gt; 0</c>).</summary>
    public bool HasLiveEvents => LiveEvents.Count > 0;

    /// <summary>True when the history list has at least one row (web <c>items.length &gt; 0</c>).</summary>
    public bool HasHistory => History.Count > 0;
}

/// <summary>
/// Pure projection from an <see cref="AutomationActivityFeedModel"/> to its <see cref="AutomationActivityFeedDisplay"/> —
/// the native port of web/src/features/automations/pages/AutomationActivityFeed.tsx. It resolves the header title and
/// the live-connection chip, formats the optional statistics strip with the web's exact precisions and suffix words
/// (<c>{total_executions} total</c>, <c>{fmtPercent(success_rate, 0)} success</c>, <c>{formatDurationMs(avg_duration_ms)}
/// avg</c>), caps the live-event strip at five rows (web <c>liveEvents.slice(0, 5)</c>) mapping each type to its icon /
/// accent / badge, and selects the history branch (skeleton / rows / empty) building each row's status icon, inline
/// error, relative time (web <c>timeAgo</c>), duration (web <c>formatDurationMs</c>) and actions ratio. Every label
/// resolves through the i18n facade and every non-finite figure is coerced to zero / the em dash. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class AutomationActivityFeedProjection
{
    /// <summary>Decorative activity glyph (Segoe Fluent — pulse line; web <c>Activity</c>).</summary>
    public const string ActivityGlyph = "\uE9D2";

    /// <summary>Decorative connected glyph (Segoe Fluent — Wifi; web <c>Wifi</c>).</summary>
    public const string WifiGlyph = "\uE701";

    /// <summary>Decorative reconnecting glyph (Segoe Fluent — Sync; the native mapping of the web <c>WifiOff</c> icon, which Segoe lacks a stable counterpart for — Sync reads as "re-establishing").</summary>
    public const string SyncGlyph = "\uE895";

    /// <summary>Decorative success glyph (Segoe Fluent — Completed; web <c>CheckCircle</c>).</summary>
    public const string CheckGlyph = "\uE930";

    /// <summary>Decorative failure glyph (Segoe Fluent — ErrorBadge; web <c>XCircle</c>).</summary>
    public const string ErrorGlyph = "\uEA39";

    /// <summary>Decorative skip glyph (Segoe Fluent — Next; web <c>SkipForward</c>).</summary>
    public const string SkipGlyph = "\uE893";

    /// <summary>Decorative trigger / test glyph (Segoe Fluent — LightningBolt; web <c>Zap</c>).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Decorative undo glyph (Segoe Fluent — Clock; web <c>Clock</c>).</summary>
    public const string ClockGlyph = "\uE823";

    /// <summary>Maximum live-event rows shown (web <c>liveEvents.slice(0, 5)</c>).</summary>
    public const int MaxLiveEvents = 5;

    /// <summary>Skeleton rows shown while the parent's history query loads (web <c>Array.from({ length: 5 })</c>).</summary>
    public const int SkeletonRowCount = 5;

    private const string EventPrefix = "automation.";
    private const string EmDash = "\u2014"; // the web FALLBACK '—' for a missing duration

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="now">The reference instant for the relative-time labels (the web <c>Date.now()</c> seam); defaults to <see cref="DateTimeOffset.UtcNow"/>.</param>
    public static AutomationActivityFeedDisplay Project(
        AutomationActivityFeedModel model,
        ILocalizer localizer,
        DateTimeOffset? now = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        DateTimeOffset reference = now ?? DateTimeOffset.UtcNow;

        string title = localizer.GetString("translation.automations.recentActivity", "Recent Activity");
        string loadingLabel = localizer.GetString("translation.common.loading", "Loading");

        (string connectionLabel, string connectionGlyph, StatusKind connectionAccent) = model.Connection switch
        {
            AutomationFeedConnection.Reconnecting => (
                localizer.GetString("translation.automations.reconnecting", "Reconnecting"),
                SyncGlyph,
                StatusKind.Warning),
            _ => (
                localizer.GetString("translation.automations.live", "Live"),
                WifiGlyph,
                StatusKind.Success),
        };

        bool showStats = model.Stats is { } stats && stats.TotalExecutions > 0;
        (string totalLabel, string successLabel, string avgLabel) = BuildStats(model.Stats, localizer);

        var liveRows = BuildLiveRows(model.LiveEvents);
        var historyRows = BuildHistoryRows(model.History, localizer, reference);

        AutomationHistorySection section = model.Loading
            ? AutomationHistorySection.Loading
            : historyRows.Count > 0
                ? AutomationHistorySection.Populated
                : AutomationHistorySection.Empty;

        string emptyMessage = localizer.GetString("translation.automations.noHistory", "No execution history yet");

        string automationName = BuildAutomationName(
            title, section, loadingLabel, connectionLabel,
            showStats, totalLabel, successLabel, avgLabel, emptyMessage);

        return new AutomationActivityFeedDisplay(
            Title: title,
            Glyph: ActivityGlyph,
            Connection: model.Connection,
            ConnectionLabel: connectionLabel,
            ConnectionGlyph: connectionGlyph,
            ConnectionAccent: connectionAccent,
            ShowStats: showStats,
            TotalLabel: totalLabel,
            SuccessLabel: successLabel,
            AvgLabel: avgLabel,
            LiveEvents: liveRows,
            HistorySection: section,
            History: historyRows,
            EmptyMessage: emptyMessage,
            SkeletonRows: SkeletonRowCount,
            AutomationName: automationName);
    }

    // ── Statistics strip: total runs, success rate, average duration (web order + formatting) ────────────
    private static (string Total, string Success, string Avg) BuildStats(
        AutomationHistorySummary? stats,
        ILocalizer localizer)
    {
        string totalWord = localizer.GetString("translation.automations.totalRuns", "total");
        string successWord = localizer.GetString("translation.automations.successRate", "success");
        string avgWord = localizer.GetString("translation.automations.avgDuration", "avg");

        long total = stats?.TotalExecutions ?? 0;
        double rate = Safe(stats?.SuccessRate ?? 0);
        double avgMs = stats?.AvgDurationMs ?? 0;

        // web: `{total_executions} {t('totalRuns')}` — the count is shown verbatim (no grouping).
        string totalLabel = total.ToString(CultureInfo.InvariantCulture) + " " + totalWord;
        // web: `{fmtPercent(success_rate, 0)} {t('successRate')}` — fmtNumber(_, 0) + "%".
        string successLabel = NumberFormatting.Format(rate, null, 0) + "% " + successWord;
        // web: `{formatDurationMs(avg_duration_ms)} {t('avgDuration')}`.
        string avgLabel = FormatDurationMs(avgMs) + " " + avgWord;

        return (totalLabel, successLabel, avgLabel);
    }

    // ── Live-event strip: newest five, mapped to icon / accent / badge (web parity) ──────────────────────
    private static List<AutomationLiveRow> BuildLiveRows(IReadOnlyList<AutomationLiveEvent>? events)
    {
        var rows = new List<AutomationLiveRow>();
        if (events is null)
        {
            return rows;
        }

        foreach (var evt in events)
        {
            if (evt is null)
            {
                continue;
            }

            if (rows.Count >= MaxLiveEvents)
            {
                break;
            }

            (string glyph, StatusKind accent) = LiveVisual(evt.Type);
            string name = ResolveEventName(evt);
            (string? detail, bool detailIsError) = ResolveEventDetail(evt);
            string badge = StripEventPrefix(evt.Type);
            string automation = ComposeLiveName(name, detail, badge);

            rows.Add(new AutomationLiveRow(glyph, accent, name, detail, detailIsError, badge, automation));
        }

        return rows;
    }

    // web typeMap: triggered → Zap/cyan, succeeded → CheckCircle/green, failed → XCircle/red,
    // skipped → SkipForward/muted, state_changed → Activity/purple. Cyan and purple have no dedicated
    // status token, so both map to the Info accent; the fallback is the triggered visual.
    private static (string Glyph, StatusKind Accent) LiveVisual(string? type) => type switch
    {
        "automation.succeeded" => (CheckGlyph, StatusKind.Success),
        "automation.failed" => (ErrorGlyph, StatusKind.Danger),
        "automation.skipped" => (SkipGlyph, StatusKind.Neutral),
        "automation.state_changed" => (ActivityGlyph, StatusKind.Info),
        _ => (ZapGlyph, StatusKind.Info),
    };

    private static string ResolveEventName(AutomationLiveEvent evt) =>
        string.IsNullOrEmpty(evt.Name)
            ? "#" + evt.AutomationId.ToString(CultureInfo.InvariantCulture)
            : evt.Name;

    // web: shows `— {error}` for a failed event, else `— {reason}` for a skipped event.
    private static (string? Detail, bool IsError) ResolveEventDetail(AutomationLiveEvent evt)
    {
        if (!string.IsNullOrEmpty(evt.Error))
        {
            return (evt.Error, true);
        }

        if (!string.IsNullOrEmpty(evt.Reason))
        {
            return (evt.Reason, false);
        }

        return (null, false);
    }

    // web: event.type.replace('automation.', '').
    private static string StripEventPrefix(string? type)
    {
        if (string.IsNullOrEmpty(type))
        {
            return string.Empty;
        }

        return type.StartsWith(EventPrefix, StringComparison.Ordinal)
            ? type[EventPrefix.Length..]
            : type;
    }

    // ── History list: status icon, inline error, relative time, duration, actions ratio (web parity) ─────
    private static List<AutomationHistoryRow> BuildHistoryRows(
        IReadOnlyList<AutomationHistoryEntry>? history,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        var rows = new List<AutomationHistoryRow>();
        if (history is null)
        {
            return rows;
        }

        foreach (var entry in history)
        {
            if (entry is null)
            {
                continue;
            }

            (string glyph, StatusKind accent) = HistoryVisual(entry.Status);
            string name = entry.AutomationName ?? string.Empty;
            string? error = string.IsNullOrEmpty(entry.Error) ? null : entry.Error;
            string relative = FormatTimeAgo(entry.TriggeredAt, now, localizer);
            string duration = FormatDurationMs(entry.DurationMs);
            string? actions = entry.ActionsTotal > 0
                ? entry.ActionsSucceeded.ToString(CultureInfo.InvariantCulture) + "/" +
                  entry.ActionsTotal.ToString(CultureInfo.InvariantCulture)
                : null;

            string automation = ComposeHistoryName(name, error, relative, duration, actions);
            rows.Add(new AutomationHistoryRow(glyph, accent, name, error, relative, duration, actions, automation));
        }

        return rows;
    }

    // web statusConfig: success → CheckCircle/green, partial → CheckCircle/amber, failed → XCircle/red,
    // skipped → SkipForward/muted, test → Zap/cyan, undo → Clock/purple, running → Activity/blue,
    // cancelled → XCircle/muted; unknown statuses fall back to the running visual. Cyan / purple / blue have
    // no dedicated status token, so they map to the Info accent.
    private static (string Glyph, StatusKind Accent) HistoryVisual(string? status) => status switch
    {
        "success" => (CheckGlyph, StatusKind.Success),
        "partial" => (CheckGlyph, StatusKind.Warning),
        "failed" => (ErrorGlyph, StatusKind.Danger),
        "skipped" => (SkipGlyph, StatusKind.Neutral),
        "test" => (ZapGlyph, StatusKind.Info),
        "undo" => (ClockGlyph, StatusKind.Info),
        "cancelled" => (ErrorGlyph, StatusKind.Neutral),
        _ => (ActivityGlyph, StatusKind.Info),
    };

    // web getTimeAgo tiers: "just now" (< 1m), "{m}m ago" (< 60m), "{h}h ago" (< 24h), "{d}d ago" (else).
    private static string FormatTimeAgo(DateTimeOffset triggeredAt, DateTimeOffset now, ILocalizer localizer)
    {
        double minutes = Math.Floor((now - triggeredAt).TotalMinutes);
        if (minutes < 1)
        {
            return localizer.GetString("translation.freshness.justNow", "just now");
        }

        if (minutes < 60)
        {
            return ((long)minutes).ToString(CultureInfo.InvariantCulture) + "m ago";
        }

        long hours = (long)Math.Floor(minutes / 60.0);
        if (hours < 24)
        {
            return hours.ToString(CultureInfo.InvariantCulture) + "h ago";
        }

        long days = (long)Math.Floor(hours / 24.0);
        return days.ToString(CultureInfo.InvariantCulture) + "d ago";
    }

    // web formatDurationMs: null / non-finite → '—'; < 1000 → `{ms}ms`; else → `{(ms/1000).toFixed(1)}s`.
    private static string FormatDurationMs(double? ms)
    {
        if (ms is not { } value || !double.IsFinite(value))
        {
            return EmDash;
        }

        if (value < 1000)
        {
            return value.ToString(CultureInfo.InvariantCulture) + "ms";
        }

        return (value / 1000.0).ToString("F1", CultureInfo.InvariantCulture) + "s";
    }

    private static string ComposeLiveName(string name, string? detail, string badge)
    {
        var builder = new StringBuilder();
        builder.Append(name);

        if (!string.IsNullOrEmpty(detail))
        {
            builder.Append(CultureInfo.CurrentCulture, $" {EmDash} {detail}");
        }

        if (!string.IsNullOrEmpty(badge))
        {
            builder.Append(CultureInfo.CurrentCulture, $". {badge}");
        }

        return builder.ToString();
    }

    private static string ComposeHistoryName(
        string name,
        string? error,
        string relative,
        string duration,
        string? actions)
    {
        var builder = new StringBuilder();
        builder.Append(name);

        if (!string.IsNullOrEmpty(error))
        {
            builder.Append(CultureInfo.CurrentCulture, $" {EmDash} {error}");
        }

        builder.Append(CultureInfo.InvariantCulture, $". {relative}");
        builder.Append(CultureInfo.InvariantCulture, $". {duration}");

        if (!string.IsNullOrEmpty(actions))
        {
            builder.Append(CultureInfo.InvariantCulture, $". {actions}");
        }

        return builder.ToString();
    }

    private static string BuildAutomationName(
        string title,
        AutomationHistorySection section,
        string loadingLabel,
        string connectionLabel,
        bool showStats,
        string totalLabel,
        string successLabel,
        string avgLabel,
        string emptyMessage)
    {
        var builder = new StringBuilder();
        builder.Append(title);
        builder.Append(CultureInfo.CurrentCulture, $". {connectionLabel}");

        if (showStats)
        {
            builder.Append(CultureInfo.CurrentCulture, $". {totalLabel}, {successLabel}, {avgLabel}");
        }

        if (section == AutomationHistorySection.Loading)
        {
            builder.Append(CultureInfo.CurrentCulture, $". {loadingLabel}");
        }
        else if (section == AutomationHistorySection.Empty)
        {
            builder.Append(CultureInfo.CurrentCulture, $". {emptyMessage}");
        }

        return builder.ToString();
    }

    // The web safeNumber() guard inside fmtNumber: a non-finite value formats as 0 rather than "NaN"/"∞".
    private static double Safe(double value) => double.IsFinite(value) ? value : 0;
}

/// <summary>
/// PII-safe diagnostics for the <c>AutomationActivityFeed</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an automation name, error, reason, duration or
/// success rate — so a diagnostics line can never leak a user's automation behaviour. Thread-safe.
/// </summary>
public sealed class AutomationActivityFeedDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AutomationActivityFeedDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AutomationActivityFeed</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AutomationActivityFeedRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>AutomationActivityFeed</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/automations/pages/AutomationActivityFeed.tsx</c>.
/// </summary>
public static class AutomationActivityFeedRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AutomationActivityFeed";
}
