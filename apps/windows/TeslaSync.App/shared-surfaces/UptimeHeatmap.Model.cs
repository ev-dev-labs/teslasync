using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Status;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces.UptimeHeatmapSurface;

/// <summary>
/// Canonical metadata + localization keys for the <c>UptimeHeatmap</c> shared surface — the native mirror of the
/// web component at <c>web/src/components/status/UptimeHeatmap.tsx</c>. UI-free so every key, fallback and the
/// diagnostics slug are asserted headlessly. The web component has no <c>t()</c> calls (it inlines English), so
/// these keys are minted to route every label through the P1/S10 i18n facade; the English fallback reproduces the
/// web text verbatim until the catalog gains the keys, exactly as the sibling <c>ScoreBadge</c> / <c>ServiceStatus</c>
/// surfaces do.
/// </summary>
public static class UptimeHeatmapRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "UptimeHeatmap";

    /// <summary>i18n key for the panel heading (web <c>`Uptime — last ${days.length} days`</c>).</summary>
    public const string TitleKey = "translation.status.uptime.title";

    /// <summary>English fallback for <see cref="TitleKey"/>, with the day-count interpolation token.</summary>
    public const string TitleFallback = "Uptime — last {{count}} days";

    /// <summary>i18n key for the uptime caption (web <c>`${fmtPercent(uptimePct, 2)} uptime`</c>).</summary>
    public const string CaptionKey = "translation.status.uptime.caption";

    /// <summary>English fallback for <see cref="CaptionKey"/>, with the formatted-percent interpolation token.</summary>
    public const string CaptionFallback = "{{percent}} uptime";

    /// <summary>i18n key for the squares container accessible name (web <c>aria-label="Daily status history"</c>).</summary>
    public const string ListLabelKey = "translation.status.uptime.listLabel";

    /// <summary>English fallback for <see cref="ListLabelKey"/>.</summary>
    public const string ListLabelFallback = "Daily status history";

    /// <summary>
    /// i18n key for the friendly empty state. The web renders an empty squares row when there are no days; the
    /// native surface shows a non-blank empty state instead (per the P2 "never a blank box" rule).
    /// </summary>
    public const string EmptyKey = "translation.status.uptime.empty";

    /// <summary>English fallback for <see cref="EmptyKey"/>.</summary>
    public const string EmptyFallback = "No status history yet";

    /// <summary>i18n key for the "Operational" day label (web <c>STATUS_LABEL.healthy</c>).</summary>
    public const string LabelOperationalKey = "translation.status.label.operational";

    /// <summary>i18n key for the "Degraded" day label (web <c>STATUS_LABEL.degraded</c>).</summary>
    public const string LabelDegradedKey = "translation.status.label.degraded";

    /// <summary>i18n key for the "Outage" day label (web <c>STATUS_LABEL.unhealthy</c>).</summary>
    public const string LabelOutageKey = "translation.status.label.outage";

    /// <summary>i18n key for the "Unknown" day label (web <c>STATUS_LABEL.unknown</c>).</summary>
    public const string LabelUnknownKey = "translation.status.label.unknown";

    /// <summary>i18n key for the "Maintenance" day label (web <c>STATUS_LABEL.maintenance</c>).</summary>
    public const string LabelMaintenanceKey = "translation.status.label.maintenance";

    /// <summary>The i18n key for a status' short day label (web <c>STATUS_LABEL[status]</c>).</summary>
    /// <param name="status">The day's health status.</param>
    public static string LabelKey(HealthStatus status) => status switch
    {
        HealthStatus.Healthy => LabelOperationalKey,
        HealthStatus.Degraded => LabelDegradedKey,
        HealthStatus.Unhealthy => LabelOutageKey,
        HealthStatus.Maintenance => LabelMaintenanceKey,
        _ => LabelUnknownKey,
    };
}

/// <summary>
/// The render-time data model the <c>UptimeHeatmap</c> view binds to — the native analogue of the web
/// <c>UptimeHeatmapProps</c> (web/src/components/status/UptimeHeatmap.tsx L26-34). The web component is purely
/// presentational: its parent (a System / Status page) owns any data fetching and feeds an already-resolved day
/// window, so — exactly like React re-rendering the element with already-resolved props — there is no fetch-driven
/// loading / error / stale / offline branch to reproduce here. The only branches are "populated" (one tinted square
/// per day, oldest first, with the rolling uptime caption) and "empty" (no days — the always-rendered friendly empty
/// state). Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record UptimeHeatmapModel
{
    /// <summary>Creates a model over a day window with optional heading / footnote overrides.</summary>
    /// <param name="days">The rolling day window, oldest first (web <c>days</c>); null is treated as empty.</param>
    /// <param name="title">Optional heading override (web <c>title</c>); null uses the localized default.</param>
    /// <param name="footnote">Optional footnote beneath the squares (web <c>footnote</c>); null / empty hides it.</param>
    public UptimeHeatmapModel(
        IReadOnlyList<UptimeDay>? days = null,
        string? title = null,
        string? footnote = null)
    {
        Days = days ?? [];
        Title = title;
        Footnote = footnote;
    }

    /// <summary>The rolling day window, oldest first (web <c>days</c>).</summary>
    public IReadOnlyList<UptimeDay> Days { get; }

    /// <summary>Optional heading override (web <c>title</c>); null uses the localized "Uptime — last N days".</summary>
    public string? Title { get; }

    /// <summary>Optional footnote beneath the squares (web <c>footnote</c>); null / empty hides the footnote.</summary>
    public string? Footnote { get; }

    /// <summary>The initial / empty model — no days, rendering the friendly empty state.</summary>
    public static UptimeHeatmapModel Empty { get; } = new();
}

/// <summary>
/// One fully projected day square — the native analogue of a single mapped <c>day</c> in the web grid
/// (web/src/components/status/UptimeHeatmap.tsx L88-115): the <see cref="AccentHex"/> tint (web
/// <c>SQUARE_BG[day.status]</c>, mapped to the shared status palette), the localized <see cref="StatusLabel"/> (web
/// <c>STATUS_LABEL[day.status]</c>), the composed <see cref="TooltipText"/> (web Tooltip content: date + status +
/// optional summary) and the <see cref="AccessibleLabel"/> (web <c>aria-label={`${date}: ${STATUS_LABEL}`}</c>).
/// Pure data so every field is asserted headlessly.
/// </summary>
/// <param name="Date">The ISO day (web <c>day.date</c>).</param>
/// <param name="Status">The day's health status (web <c>day.status</c>).</param>
/// <param name="AccentHex">The shared-palette tint for the square (web <c>SQUARE_BG[status]</c>).</param>
/// <param name="StatusLabel">The localized status label (web <c>STATUS_LABEL[status]</c>).</param>
/// <param name="TooltipText">The hover/focus tooltip: date + status + optional summary (web Tooltip content).</param>
/// <param name="AccessibleLabel">The square's accessible name (web button <c>aria-label</c>).</param>
/// <param name="Summary">The optional day summary (web <c>day.summary</c>); null / empty when absent.</param>
public sealed record UptimeDayCell(
    string Date,
    HealthStatus Status,
    string AccentHex,
    string StatusLabel,
    string TooltipText,
    string AccessibleLabel,
    string? Summary);

/// <summary>
/// The fully projected, render-ready view of an <see cref="UptimeHeatmapModel"/> — everything the web component
/// derives before returning JSX (web/src/components/status/UptimeHeatmap.tsx): the resolved <see cref="Heading"/>
/// (web <c>title ?? `Uptime — last N days`</c>), the rolling <see cref="UptimeText"/> caption and its threshold
/// <see cref="UptimeColorHex"/> (web's <c>&gt;=99</c> green / <c>&gt;=95</c> amber / else red tiers), the per-day
/// <see cref="Cells"/>, the <see cref="ListLabel"/> for the squares container, the optional <see cref="Footnote"/>,
/// and the friendly <see cref="EmptyText"/> shown when there are no days. <see cref="HasUptime"/> is false for an
/// empty window (web <c>uptimePct == null</c> hides the caption) and <see cref="HasDays"/> gates the squares vs the
/// empty state. Pure data so every value is asserted headlessly.
/// </summary>
/// <param name="Heading">The resolved panel heading (web <c>heading</c>).</param>
/// <param name="HasUptime">True when the uptime caption renders (web <c>uptimePct != null</c>).</param>
/// <param name="UptimeText">The rolling uptime caption (web <c>`${fmtPercent(pct,2)} uptime`</c>); empty when none.</param>
/// <param name="UptimeColorHex">The caption colour for the resolved threshold tier (web green/amber/red).</param>
/// <param name="HasDays">True when there is at least one day (web <c>days.length &gt; 0</c>): squares vs empty state.</param>
/// <param name="EmptyText">The friendly empty-state message shown when <see cref="HasDays"/> is false.</param>
/// <param name="Cells">One projected square per day, oldest first (web mapped <c>days</c>).</param>
/// <param name="ListLabel">The squares container's accessible name (web <c>aria-label="Daily status history"</c>).</param>
/// <param name="Footnote">The optional footnote text (web <c>footnote</c>); null / empty when absent.</param>
/// <param name="HasFootnote">True when <see cref="Footnote"/> renders.</param>
/// <param name="AutomationName">The whole-surface accessible name (heading + uptime caption).</param>
public sealed record UptimeHeatmapDisplay(
    string Heading,
    bool HasUptime,
    string UptimeText,
    string UptimeColorHex,
    bool HasDays,
    string EmptyText,
    IReadOnlyList<UptimeDayCell> Cells,
    string ListLabel,
    string? Footnote,
    bool HasFootnote,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="UptimeHeatmapModel"/> to its <see cref="UptimeHeatmapDisplay"/> — the native
/// port of web/src/components/status/UptimeHeatmap.tsx. Reproduces the web derivations exactly:
/// <list type="bullet">
///   <item><description>the rolling uptime percentage counts healthy + maintenance days as "up"
///   (<see cref="StatusPresentation.UptimePercent"/> mirrors the web <c>uptimePct</c>); a null result (empty
///   window) hides the caption.</description></item>
///   <item><description>the heading is the caller override if present, else the interpolated
///   <c>status.uptime.title</c> template with the day count substituted (web <c>title ?? `Uptime — last N days`</c>).</description></item>
///   <item><description>the caption colour follows the web tiers: <c>&gt;= 99</c> healthy-green, <c>&gt;= 95</c>
///   degraded-amber, else outage-red (<see cref="UptimeColorHex"/>).</description></item>
///   <item><description>each square is tinted by the shared status palette (<see cref="StatusPresentation.AccentHex"/>,
///   the native counterpart of the web <c>SQUARE_BG</c> map), carries the localized status label and a date + status
///   (+ optional summary) tooltip, and exposes the web <c>`${date}: ${label}`</c> accessible name.</description></item>
/// </list>
/// Every label resolves through the i18n facade with the minted key + the verbatim English fallback. No WinUI types —
/// so the projection is unit-tested without a UI host.
/// </summary>
public static class UptimeHeatmapProjection
{
    /// <summary>Decimal places for the uptime caption (web <c>fmtPercent(uptimePct, 2)</c>).</summary>
    public const int UptimePercentDecimals = 2;

    /// <summary>Lower bound (inclusive) for the healthy-green caption tier (web <c>uptimePct &gt;= 99</c>).</summary>
    public const double HealthyThreshold = 99;

    /// <summary>Lower bound (inclusive) for the degraded-amber caption tier (web <c>uptimePct &gt;= 95</c>).</summary>
    public const double DegradedThreshold = 95;

    private const string CountToken = "{{count}}";
    private const string PercentToken = "{{percent}}";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <returns>The render-ready display model.</returns>
    public static UptimeHeatmapDisplay Project(UptimeHeatmapModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<UptimeDay> days = model.Days;
        double? pct = StatusPresentation.UptimePercent(days);

        string heading = model.Title ?? FormatTitle(localizer, days.Count);
        bool hasUptime = pct is not null;
        string uptimeText = hasUptime ? FormatCaption(localizer, pct!.Value) : string.Empty;
        string uptimeColorHex = hasUptime ? UptimeColorHex(pct!.Value) : StatusPresentation.UnknownHex;

        var cells = new List<UptimeDayCell>(days.Count);
        foreach (UptimeDay day in days)
        {
            cells.Add(BuildCell(day, localizer));
        }

        string emptyText = localizer.GetString(UptimeHeatmapRegistration.EmptyKey, UptimeHeatmapRegistration.EmptyFallback);
        string listLabel = localizer.GetString(UptimeHeatmapRegistration.ListLabelKey, UptimeHeatmapRegistration.ListLabelFallback);
        bool hasFootnote = !string.IsNullOrWhiteSpace(model.Footnote);
        string automationName = hasUptime ? $"{heading}. {uptimeText}" : heading;

        return new UptimeHeatmapDisplay(
            Heading: heading,
            HasUptime: hasUptime,
            UptimeText: uptimeText,
            UptimeColorHex: uptimeColorHex,
            HasDays: days.Count > 0,
            EmptyText: emptyText,
            Cells: cells,
            ListLabel: listLabel,
            Footnote: model.Footnote,
            HasFootnote: hasFootnote,
            AutomationName: automationName);
    }

    /// <summary>Project a single day into its render-ready square cell.</summary>
    /// <param name="day">The day window entry (web <c>day</c>).</param>
    /// <param name="localizer">The i18n facade the status label resolves through (P1/S10).</param>
    /// <returns>The render-ready cell.</returns>
    public static UptimeDayCell BuildCell(UptimeDay day, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(day);
        ArgumentNullException.ThrowIfNull(localizer);

        string date = day.Date ?? string.Empty;
        string statusLabel = StatusLabel(day.Status, localizer);
        string accessibleLabel = $"{date}: {statusLabel}";
        string tooltip = string.IsNullOrWhiteSpace(day.Summary)
            ? accessibleLabel
            : $"{accessibleLabel} — {day.Summary}";

        return new UptimeDayCell(
            Date: date,
            Status: day.Status,
            AccentHex: StatusPresentation.AccentHex(day.Status),
            StatusLabel: statusLabel,
            TooltipText: tooltip,
            AccessibleLabel: accessibleLabel,
            Summary: day.Summary);
    }

    /// <summary>The localized short day label for a status (web <c>STATUS_LABEL[status]</c>).</summary>
    /// <param name="status">The day's health status.</param>
    /// <param name="localizer">The i18n facade the label resolves through (P1/S10).</param>
    public static string StatusLabel(HealthStatus status, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(UptimeHeatmapRegistration.LabelKey(status), StatusPresentation.Label(status));
    }

    /// <summary>The caption colour hex for an uptime percentage (web's green / amber / red threshold tiers).</summary>
    /// <param name="percent">The rolling uptime percentage (0..100).</param>
    public static string UptimeColorHex(double percent) => percent switch
    {
        >= HealthyThreshold => StatusPresentation.HealthyHex,
        >= DegradedThreshold => StatusPresentation.DegradedHex,
        _ => StatusPresentation.UnhealthyHex,
    };

    private static string FormatTitle(ILocalizer localizer, int count) =>
        localizer
            .GetString(UptimeHeatmapRegistration.TitleKey, UptimeHeatmapRegistration.TitleFallback)
            .Replace(CountToken, count.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);

    private static string FormatCaption(ILocalizer localizer, double percent) =>
        localizer
            .GetString(UptimeHeatmapRegistration.CaptionKey, UptimeHeatmapRegistration.CaptionFallback)
            .Replace(PercentToken, ScalarFormatters.FormatPercentage(percent, UptimePercentDecimals), StringComparison.Ordinal);
}

/// <summary>
/// PII-safe diagnostics for the <c>UptimeHeatmap</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the day window or the uptime value — so a
/// diagnostics line can never leak fleet state. Thread-safe.
/// </summary>
public sealed class UptimeHeatmapDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public UptimeHeatmapDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=UptimeHeatmap</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={UptimeHeatmapRegistration.Slug}");
    }
}
