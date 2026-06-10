using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>SummaryStatsRow</c> surface — the native union of the states
/// the web component renders (web/src/features/admin/components/security-access/SummaryStatsRow.tsx). The web
/// source is a pure presentational row: it takes already-resolved <c>isSecure</c> / <c>lastLockChange</c> /
/// <c>sentryUptime</c> / <c>totalEvents</c> props plus the parent's <c>isLoading</c> flag and performs no
/// fetching, so the branch is a direct function of the input <see cref="SummaryStatsRowModel"/>. There is no
/// fetch-driven empty / error / stale / offline branch to reproduce here: the owning Security-Access page owns
/// the query lifecycle (its skeleton / <c>QueryError</c> / freshness chrome is rendered once for the whole page
/// before this row is composed with resolved props), exactly as React only renders <c>&lt;SummaryStatsRow … /&gt;</c>
/// once its data has resolved. Every branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum SummaryStatsRowState
{
    /// <summary>The page is still fetching the security history (web <c>isLoading</c>) — four skeleton tiles.</summary>
    Loading,

    /// <summary>Resolved (the web fall-through) — the four metric tiles entering through a fade.</summary>
    Ready,
}

/// <summary>
/// The render-time data model the <c>SummaryStatsRow</c> view binds to — the native analogue of the web
/// component's five props (web/src/features/admin/components/security-access/SummaryStatsRow.tsx). The component
/// is presentational, so user-facing strings (labels, the secure/unsecure words, the relative-time copy and the
/// loading copy) are resolved from the i18n facade by the projection rather than passed in. <see cref="SentryUptime"/>
/// is the already-computed percentage the web feeds <c>fmtInt</c>; <see cref="TotalEvents"/> the raw event count
/// the web renders verbatim; and <see cref="LastLockChange"/> the instant the web hands <c>timeSince</c> (the web
/// passes the raw ISO timestamp and computes the relative label inside the component, so the native projection
/// reproduces that same <c>timeSince</c> logic against an injected clock). Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="Loading">When true the parent is still fetching (web <c>isLoading</c>) — the loading branch.</param>
/// <param name="IsSecure">Whether the vehicle is currently secured (web <c>isSecure</c>) — drives the status tile.</param>
/// <param name="LastLockChange">The instant of the last lock-state change (web <c>lastLockChange</c>), or null.</param>
/// <param name="SentryUptime">The Sentry-on percentage (web <c>sentryUptime</c>), rendered at zero decimals.</param>
/// <param name="TotalEvents">The total security-event count (web <c>totalEvents</c>), rendered verbatim.</param>
public sealed record SummaryStatsRowModel(
    bool Loading,
    bool IsSecure,
    DateTimeOffset? LastLockChange,
    double SentryUptime,
    int TotalEvents)
{
    /// <summary>The initial model: the page fetch is in flight and no security history has arrived yet.</summary>
    public static SummaryStatsRowModel Pending { get; } =
        new(true, false, null, 0, 0);
}

/// <summary>
/// One fully projected, render-ready metric tile — the native analogue of a single web <c>&lt;MetricCard&gt;</c>
/// (SummaryStatsRow.tsx lines 39-62). <see cref="Label"/> is the localized metric label; <see cref="Value"/> the
/// already-formatted display value the tile renders verbatim; <see cref="AccentBrushKey"/> the theme token brush
/// that tints the accent rail (the native mapping of the web <c>color</c> prop — see
/// <see cref="SummaryStatsRowProjection"/>); and <see cref="AutomationName"/> the spoken "<c>{label}: {value}</c>".
/// The web <c>icon</c> is intentionally dropped: the shared <c>TsMetricCard</c> carries its semantic colour on the
/// accent rail rather than a glyph, exactly as the sibling <c>TemperatureMetricCards</c> port does. Pure data.
/// </summary>
public sealed record SummaryStat(string Label, string Value, string AccentBrushKey, string AutomationName);

/// <summary>
/// The fully projected view of the row for one input model — the native analogue of what the web
/// <c>SummaryStatsRow</c> renders. Holds the active <see cref="State"/>, the four tile projections (empty while
/// loading), the shared loading copy, and the surface <see cref="AutomationName"/>. Pure data so every branch is
/// asserted headlessly.
/// </summary>
public sealed record SummaryStatsRowDisplay(
    SummaryStatsRowState State,
    IReadOnlyList<SummaryStat> Cards,
    string LoadingLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="SummaryStatsRowModel"/> to its <see cref="SummaryStatsRowDisplay"/> — the
/// native port of web/src/features/admin/components/security-access/SummaryStatsRow.tsx. The branch precedence
/// mirrors the web (loading → ready); the four tiles reproduce the web's four <c>&lt;MetricCard&gt;</c> in order;
/// the Sentry-uptime value reproduces the web's <c>`${fmtInt(sentryUptime)}%`</c> (a fixed zero-decimal,
/// en-US-grouped format — <see cref="NumberFormatting"/> with the shared <c>numberFormat.ts</c> contract) and the
/// total-events value the web's verbatim integer; the last-lock value reproduces helpers.ts <c>timeSince</c>
/// against the injected clock; and every label resolves through the i18n facade using the keys the web feeds into
/// <c>t(...)</c>. The web <c>color</c> per tile maps to a theme-aware token brush key (the web icon chip's tint).
/// No WinUI types — unit-tested without a UI host.
/// </summary>
public static class SummaryStatsRowProjection
{
    /// <summary>The em dash shown in place of a missing / future last-lock instant (web <c>timeSince</c> "—").</summary>
    public const string EmDash = "\u2014";

    /// <summary>The literal percent suffix the web appends to the Sentry-uptime value (<c>`…%`</c>).</summary>
    public const string PercentSuffix = "%";

    /// <summary>The number of metric tiles the row always renders (web's four <c>&lt;MetricCard&gt;</c>).</summary>
    public const int TileCount = 4;

    /// <summary>
    /// Accent token for the "Last Lock Change" tile — the native mapping of the web <c>color="cyan"</c>. Resolves
    /// to <c>TsColorInfoBrush</c> (#00F0FF, the exact neon-cyan), the same brush <see cref="StatusKind.Info"/> uses.
    /// </summary>
    public const string CyanBrushKey = "TsColorInfoBrush";

    /// <summary>
    /// Accent token for the "Sentry Uptime" tile — the native mapping of the web <c>color="blue"</c>. Resolves to
    /// <c>TsChartSpeedBrush</c> (#3B82F6), the brand-palette blue (the web neon-blue indigo has no dedicated token).
    /// </summary>
    public const string BlueBrushKey = "TsChartSpeedBrush";

    /// <summary>
    /// Accent token for the "Total Events" tile — the native mapping of the web <c>color="purple"</c>. Resolves to
    /// <c>TsChartPowerBrush</c> (#A855F7, the exact neon-purple), as the sibling <c>TemperatureMetricCards</c> port.
    /// </summary>
    public const string PurpleBrushKey = "TsChartPowerBrush";

    // ── i18n keys (taken verbatim from the web t(...) call sites, plus the shared loading key) ──────────────
    internal const string StatusLabelKey = "admin.security.stat.status";
    internal const string StatusLabelFallback = "Current Status";
    internal const string SecureKey = "admin.security.secure";
    internal const string SecureFallback = "Secure";
    internal const string UnsecureKey = "admin.security.unsecure";
    internal const string UnsecureFallback = "Unsecure";
    internal const string LastLockLabelKey = "admin.security.stat.lastLock";
    internal const string LastLockLabelFallback = "Last Lock Change";
    internal const string SentryUptimeLabelKey = "admin.security.stat.sentryUptime";
    internal const string SentryUptimeLabelFallback = "Sentry Uptime";
    internal const string TotalEventsLabelKey = "admin.security.stat.totalEvents";
    internal const string TotalEventsLabelFallback = "Total Events";
    internal const string LoadingKey = "common.loading";
    internal const string LoadingFallback = "Loading...";

    // ── Relative-time keys: the web helpers.ts timeSince emits these literals untranslated; the native port
    //    routes them through the facade with the web literal as the English fallback so behaviour is identical
    //    while honouring the "no bare English literal" native contract. ───────────────────────────────────────
    internal const string JustNowKey = "time.justNow";
    internal const string JustNowFallback = "just now";
    internal const string MinutesAgoKey = "time.minutesAgo";
    internal const string MinutesAgoFallback = "{0}m ago";
    internal const string HoursAgoKey = "time.hoursAgo";
    internal const string HoursAgoFallback = "{0}h ago";
    internal const string DaysAgoKey = "time.daysAgo";
    internal const string DaysAgoFallback = "{0}d ago";

    private const long SecondsPerMinute = 60;
    private const long MinutesPerHour = 60;
    private const long HoursPerDay = 24;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade and clock.</summary>
    /// <param name="model">The render-time data model (the web props, plus the parent's fetch flag).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The clock the last-lock relative label is measured against (web <c>Date.now()</c>).</param>
    public static SummaryStatsRowDisplay Project(SummaryStatsRowModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string loadingLabel = localizer.GetString(LoadingKey, LoadingFallback);

        if (model.Loading)
        {
            return new SummaryStatsRowDisplay(SummaryStatsRowState.Loading, [], loadingLabel, loadingLabel);
        }

        var cards = new List<SummaryStat>(TileCount)
        {
            Card(
                localizer.GetString(StatusLabelKey, StatusLabelFallback),
                model.IsSecure
                    ? localizer.GetString(SecureKey, SecureFallback)
                    : localizer.GetString(UnsecureKey, UnsecureFallback),
                StatusResources.AccentBrushKey(model.IsSecure ? StatusKind.Success : StatusKind.Danger)),
            Card(
                localizer.GetString(LastLockLabelKey, LastLockLabelFallback),
                TimeSince(model.LastLockChange, now, localizer),
                CyanBrushKey),
            Card(
                localizer.GetString(SentryUptimeLabelKey, SentryUptimeLabelFallback),
                NumberFormatting.Format(model.SentryUptime, null, 0) + PercentSuffix,
                BlueBrushKey),
            Card(
                localizer.GetString(TotalEventsLabelKey, TotalEventsLabelFallback),
                model.TotalEvents.ToString(CultureInfo.InvariantCulture),
                PurpleBrushKey),
        };

        return new SummaryStatsRowDisplay(
            SummaryStatsRowState.Ready,
            cards,
            loadingLabel,
            BuildSurfaceAutomationName(cards));
    }

    /// <summary>
    /// The native port of helpers.ts <c>timeSince</c>: a null / future instant yields the em dash, otherwise the
    /// floored elapsed time renders as "just now" (&lt; 1 min), "{n}m ago" (&lt; 1 h), "{n}h ago" (&lt; 1 day) or
    /// "{n}d ago". The relative-time words resolve through the facade (web literal as the English fallback).
    /// </summary>
    /// <param name="when">The instant being aged (web <c>lastLockChange</c>), or null.</param>
    /// <param name="now">The reference clock (web <c>Date.now()</c>).</param>
    /// <param name="localizer">The i18n facade the relative-time words resolve through.</param>
    public static string TimeSince(DateTimeOffset? when, DateTimeOffset now, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        if (when is not { } instant)
        {
            return EmDash;
        }

        TimeSpan diff = now - instant;
        if (diff < TimeSpan.Zero)
        {
            return EmDash;
        }

        long seconds = (long)Math.Floor(diff.TotalSeconds);
        if (seconds < SecondsPerMinute)
        {
            return localizer.GetString(JustNowKey, JustNowFallback);
        }

        long minutes = seconds / SecondsPerMinute;
        if (minutes < MinutesPerHour)
        {
            return Relative(localizer.GetString(MinutesAgoKey, MinutesAgoFallback), minutes);
        }

        long hours = minutes / MinutesPerHour;
        if (hours < HoursPerDay)
        {
            return Relative(localizer.GetString(HoursAgoKey, HoursAgoFallback), hours);
        }

        long days = hours / HoursPerDay;
        return Relative(localizer.GetString(DaysAgoKey, DaysAgoFallback), days);
    }

    private static string Relative(string format, long value) =>
        string.Format(CultureInfo.CurrentCulture, format, value);

    private static SummaryStat Card(string label, string value, string accentBrushKey) =>
        new(label, value, accentBrushKey, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value));

    private static string BuildSurfaceAutomationName(List<SummaryStat> cards)
    {
        var parts = new string[cards.Count];
        for (int i = 0; i < cards.Count; i++)
        {
            parts[i] = cards[i].AutomationName;
        }

        return string.Join(". ", parts);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SummaryStatsRow</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the secure flag, uptime, event count or
/// lock timing — so a diagnostics line can never leak a user's security posture. Thread-safe.
/// </summary>
public sealed class SummaryStatsRowDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public SummaryStatsRowDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SummaryStatsRow</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SummaryStatsRowRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>SummaryStatsRow</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/admin/components/security-access/SummaryStatsRow.tsx</c>. UI-free so the metadata is
/// asserted in tests and referenced without a XAML runtime.
/// </summary>
public static class SummaryStatsRowRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SummaryStatsRow";
}
