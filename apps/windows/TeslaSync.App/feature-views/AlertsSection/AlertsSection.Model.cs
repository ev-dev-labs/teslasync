using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.WeeklyDigest;

/// <summary>
/// The mutually-exclusive render branch of the <c>AlertsSection</c> surface — the native union of the
/// states the web component renders
/// (web/src/features/analytics/components/weekly-digest/AlertsSection.tsx). The web source is a pure
/// presentational component (it takes the <c>metrics</c> + <c>alertPieData</c> props and performs no
/// fetching), so the branch is a direct function of the input <see cref="AlertsSectionModel"/>. The web
/// source itself has two intrinsic branches — the no-alerts empty state (<c>metrics.alertTotal === 0</c>)
/// and the severity-breakdown content — and the parent Weekly-Digest page owns the query lifecycle
/// (it renders a <c>DigestSkeleton</c> while <c>isLoading</c> and a <c>QueryError</c> on failure before
/// any section mounts). This surface reproduces that loading hand-off as a parent-supplied
/// <see cref="AlertsSectionModel.Loading"/> flag (skeleton chrome), exactly as the sibling
/// <c>ChargingBreakdownSlide</c> does; there is no fetch-driven error / stale / offline branch to
/// reproduce in this leaf, because the web component never fetches. Every branch maps onto a visible
/// surface — none is ever hidden.
/// </summary>
public enum AlertsSectionState
{
    /// <summary>The Weekly-Digest payload has not arrived yet (the parent is still fetching) — skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with no alerts (web <c>metrics.alertTotal === 0</c>) — the friendly empty state.</summary>
    Empty,

    /// <summary>At least one alert (web fall-through) — the severity breakdown list and the distribution donut.</summary>
    Content,
}

/// <summary>
/// The semantic class of an alert severity — the native union of the cases the web source special-cases
/// when picking a row icon, a <c>Badge</c> variant and a slice / icon colour
/// (web/src/features/analytics/components/weekly-digest/AlertsSection.tsx and its <c>ALERT_SEVERITY_COLORS</c>
/// in constants.ts). Unknown severities fall into <see cref="Other"/>, mirroring the web's
/// <c>?? CHART_COLORS[4]</c> colour fallback and its <c>… : 'info'</c> badge fallback. UI-free so the
/// classification is unit-tested without a XAML runtime.
/// </summary>
public enum AlertSeverityClass
{
    /// <summary>Web <c>'critical'</c>: AlertCircle icon, danger badge, <c>STATUS_COLORS.critical</c> slice.</summary>
    Critical,

    /// <summary>Web <c>'warning'</c>: AlertTriangle icon, warning badge, <c>STATUS_COLORS.warning</c> slice.</summary>
    Warning,

    /// <summary>Web <c>'info'</c>: Info icon, info badge, <c>CHART_COLORS[0]</c> slice.</summary>
    Info,

    /// <summary>Any other severity: no row icon, info badge, <c>CHART_COLORS[4]</c> slice (the web fallbacks).</summary>
    Other,
}

/// <summary>
/// One raw per-severity alert tally — the native analogue of a single
/// <c>Object.entries(metrics.alertsByType)</c> entry the web iterates
/// (web/src/features/analytics/components/weekly-digest/AlertsSection.tsx). Modelled as an ordered list
/// rather than a map so the JavaScript object-insertion order the web relies on (the order severities were
/// first seen while bucketing the week's alerts) is preserved for both the severity list and the donut.
/// Pure data — no WinUI types.
/// </summary>
/// <param name="Severity">The raw severity key (e.g. <c>"critical"</c>), shown title-cased.</param>
/// <param name="Count">The number of alerts of this severity that week.</param>
public sealed record AlertSeverityCount(string Severity, long Count);

/// <summary>
/// The render-time data model the <c>AlertsSection</c> view binds to — the native analogue of the web
/// component's props (<c>metrics: DigestMetrics</c> + <c>alertPieData: AlertPieEntry[]</c> in
/// web/src/features/analytics/components/weekly-digest/AlertsSection.tsx), narrowed to the alert fields the
/// section actually reads (<c>metrics.alertTotal</c> and <c>metrics.alertsByType</c>) plus the parent's
/// in-flight flag. The web's <c>alertPieData</c> is derived purely from <c>alertsByType</c> (same entries,
/// same order, with a per-severity colour), so the projection rebuilds it from <see cref="AlertsByType"/>
/// rather than carrying a redundant copy. Pure data — no WinUI types — so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Loading">Whether the parent Weekly-Digest query is still in flight (web <c>isLoading</c>).</param>
/// <param name="AlertTotal">The total alert count for the week (web <c>metrics.alertTotal</c>); drives the badge and the empty branch.</param>
/// <param name="AlertsByType">The ordered per-severity tallies (web <c>metrics.alertsByType</c>).</param>
public sealed record AlertsSectionModel(
    bool Loading,
    long AlertTotal,
    IReadOnlyList<AlertSeverityCount> AlertsByType)
{
    /// <summary>The initial model: the Weekly-Digest fetch is in flight and no alert data has arrived yet.</summary>
    public static AlertsSectionModel Pending { get; } = new(true, 0, Array.Empty<AlertSeverityCount>());

    /// <summary>A resolved model with no alerts — the empty state.</summary>
    public static AlertsSectionModel Empty { get; } = new(false, 0, Array.Empty<AlertSeverityCount>());
}

/// <summary>
/// One projected, render-ready severity row — the native analogue of both a row in the web "Alerts by
/// Severity" list and the matching <c>alertPieData</c> donut slice + legend entry (they share the same
/// source entry in web/src/features/analytics/components/weekly-digest/AlertsSection.tsx). <see cref="Label"/>
/// is the title-cased severity the web renders (CSS <c>capitalize</c> on the list, and the explicit
/// <c>charAt(0).toUpperCase()</c> on the pie <c>name</c>); <see cref="CountText"/> is the grouped
/// <c>fmtInt(count)</c>; <see cref="Class"/> selects the row icon and the slice / icon colour;
/// <see cref="BadgeStatus"/> is the web <c>Badge</c> variant (critical → danger, warning → warning,
/// otherwise info); and <see cref="AutomationName"/> is the spoken "<c>{label}, {count}</c>". Pure data.
/// </summary>
/// <param name="Severity">The raw severity key (web entry key).</param>
/// <param name="Label">The title-cased severity label (web <c>capitalize</c> / pie <c>name</c>).</param>
/// <param name="Count">The raw alert count for this severity.</param>
/// <param name="CountText">The grouped integer count (web <c>fmtInt(count)</c>).</param>
/// <param name="Class">The semantic class selecting the row icon and the slice / icon colour.</param>
/// <param name="BadgeStatus">The semantic status driving the count <c>Badge</c> colour.</param>
/// <param name="AutomationName">The spoken "<c>{label}, {count}</c>" for the row and its legend entry.</param>
public sealed record AlertSeverityRow(
    string Severity,
    string Label,
    long Count,
    string CountText,
    AlertSeverityClass Class,
    StatusKind BadgeStatus,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the section for one input model — the native analogue of what
/// the web <c>AlertsSection</c> renders. Holds the active <see cref="State"/>, the resolved
/// <see cref="Title"/>, the optional warning <see cref="TotalBadgeText"/> (web shows it only when
/// <c>alertTotal &gt; 0</c>), the per-severity <see cref="Rows"/> (shared by the list and the donut), the
/// two section captions, the empty + loading copy, a spoken <see cref="ChartSummary"/> of the donut, and
/// the surface <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="State">The resolved render branch.</param>
/// <param name="Title">The "Alerts" heading (all non-loading branches).</param>
/// <param name="TotalBadgeText">The grouped total alert count, or <see langword="null"/> when the badge is hidden.</param>
/// <param name="Rows">The ordered per-severity rows (content branch).</param>
/// <param name="BySeverityLabel">The "Alerts by Severity" caption (content branch).</param>
/// <param name="DistributionLabel">The "Alert Distribution" caption (content branch).</param>
/// <param name="EmptyMessage">The "No alerts this week …" copy (empty branch).</param>
/// <param name="LoadingLabel">The localized "Loading" label (loading branch).</param>
/// <param name="ChartSummary">A spoken summary of the donut, "<c>{label} {count}, …</c>" (content branch).</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record AlertsSectionDisplay(
    AlertsSectionState State,
    string Title,
    string? TotalBadgeText,
    IReadOnlyList<AlertSeverityRow> Rows,
    string BySeverityLabel,
    string DistributionLabel,
    string EmptyMessage,
    string LoadingLabel,
    string ChartSummary,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="AlertsSectionModel"/> to its <see cref="AlertsSectionDisplay"/> — the
/// native port of web/src/features/analytics/components/weekly-digest/AlertsSection.tsx. The branch
/// precedence mirrors the web data lifecycle (loading → empty → content): a parent fetch in flight renders
/// the skeleton, an <c>alertTotal === 0</c> renders the empty state, and otherwise the severity breakdown +
/// donut. Severity labels are title-cased with the same <c>charAt(0).toUpperCase() + slice(1)</c> rule the
/// web pie uses, counts render through <see cref="NumberFormatting"/> (the web <c>fmtInt</c>), each severity
/// is classified for its icon / slice colour exactly as the web's <c>ALERT_SEVERITY_COLORS</c> +
/// <c>STATUS_COLORS</c> tables dictate, and the <c>Badge</c> variant follows the web ternary. Every label
/// resolves through the i18n facade using the catalog keys the web source feeds into <c>t()</c>. No WinUI
/// types — unit-tested without a UI host.
/// </summary>
public static class AlertsSectionProjection
{
    /// <summary>i18n key for the "Alerts" heading (web <c>t('analytics.weeklyDigest.alertsSection', 'Alerts')</c>).</summary>
    public const string TitleKey = "translation.analytics.weeklyDigest.alertsSection";

    /// <summary>i18n key for the no-alerts empty copy (web <c>t('analytics.weeklyDigest.noAlerts', …)</c>).</summary>
    public const string NoAlertsKey = "translation.analytics.weeklyDigest.noAlerts";

    /// <summary>i18n key for the "Alerts by Severity" caption (web <c>t('analytics.weeklyDigest.alertsBySeverity', …)</c>).</summary>
    public const string BySeverityKey = "translation.analytics.weeklyDigest.alertsBySeverity";

    /// <summary>i18n key for the "Alert Distribution" caption (web <c>t('analytics.weeklyDigest.alertDistribution', …)</c>).</summary>
    public const string DistributionKey = "translation.analytics.weeklyDigest.alertDistribution";

    /// <summary>i18n key for the shared "Loading" label (the parent's skeleton hand-off).</summary>
    public const string LoadingKey = "translation.common.loading";

    /// <summary>English fallback for <see cref="TitleKey"/> (matches the web default).</summary>
    public const string TitleFallback = "Alerts";

    /// <summary>English fallback for <see cref="NoAlertsKey"/> (matches the web default, em dash included).</summary>
    public const string NoAlertsFallback = "No alerts this week \u2014 everything looks great!";

    /// <summary>English fallback for <see cref="BySeverityKey"/> (matches the web default).</summary>
    public const string BySeverityFallback = "Alerts by Severity";

    /// <summary>English fallback for <see cref="DistributionKey"/> (matches the web default).</summary>
    public const string DistributionFallback = "Alert Distribution";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading";

    /// <summary>Raw web severity key for a critical alert.</summary>
    public const string CriticalSeverity = "critical";

    /// <summary>Raw web severity key for a warning alert.</summary>
    public const string WarningSeverity = "warning";

    /// <summary>Raw web severity key for an informational alert.</summary>
    public const string InfoSeverity = "info";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props, narrowed to the alert fields).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static AlertsSectionDisplay Project(AlertsSectionModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString(TitleKey, TitleFallback);
        string bySeverity = localizer.GetString(BySeverityKey, BySeverityFallback);
        string distribution = localizer.GetString(DistributionKey, DistributionFallback);
        string emptyMessage = localizer.GetString(NoAlertsKey, NoAlertsFallback);
        string loadingLabel = localizer.GetString(LoadingKey, LoadingFallback);

        IReadOnlyList<AlertSeverityRow> rows = BuildRows(model.AlertsByType);
        string chartSummary = BuildChartSummary(rows);

        // Web parity: the warning badge renders only when alertTotal > 0 (and the count is fmtInt-grouped).
        string? totalBadgeText = model.AlertTotal > 0
            ? NumberFormatting.Format(model.AlertTotal, null, 0)
            : null;

        AlertsSectionState state = SelectState(model);

        return new AlertsSectionDisplay(
            State: state,
            Title: title,
            TotalBadgeText: totalBadgeText,
            Rows: rows,
            BySeverityLabel: bySeverity,
            DistributionLabel: distribution,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            ChartSummary: chartSummary,
            AutomationName: BuildAutomationName(state, title, totalBadgeText, rows, bySeverity, emptyMessage, loadingLabel));
    }

    /// <summary>Classify a raw severity key into its semantic class (the web colour / badge / icon switch).</summary>
    /// <param name="severity">The raw severity key (case-insensitive).</param>
    public static AlertSeverityClass Classify(string? severity) =>
        (severity ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            CriticalSeverity => AlertSeverityClass.Critical,
            WarningSeverity => AlertSeverityClass.Warning,
            InfoSeverity => AlertSeverityClass.Info,
            _ => AlertSeverityClass.Other,
        };

    /// <summary>
    /// The <c>Badge</c> variant for a severity class — the native port of the web ternary
    /// (<c>critical ? 'danger' : warning ? 'warning' : 'info'</c>): every non-critical, non-warning
    /// severity (info and any unknown) falls through to the info status.
    /// </summary>
    public static StatusKind BadgeStatusFor(AlertSeverityClass severityClass) => severityClass switch
    {
        AlertSeverityClass.Critical => StatusKind.Danger,
        AlertSeverityClass.Warning => StatusKind.Warning,
        _ => StatusKind.Info,
    };

    // Branch precedence from the web data lifecycle: loading -> empty (alertTotal === 0) -> content.
    private static AlertsSectionState SelectState(AlertsSectionModel model)
    {
        if (model.Loading)
        {
            return AlertsSectionState.Loading;
        }

        // Web: metrics.alertTotal === 0 ? <EmptyState/> : <grid/>. The empty branch is driven by the total,
        // exactly as the web source gates it.
        return model.AlertTotal == 0
            ? AlertsSectionState.Empty
            : AlertsSectionState.Content;
    }

    private static IReadOnlyList<AlertSeverityRow> BuildRows(IReadOnlyList<AlertSeverityCount> tallies)
    {
        if (tallies.Count == 0)
        {
            return Array.Empty<AlertSeverityRow>();
        }

        var rows = new List<AlertSeverityRow>(tallies.Count);
        foreach (var tally in tallies)
        {
            string severity = tally.Severity ?? string.Empty;
            string label = Capitalize(severity);
            string countText = NumberFormatting.Format(tally.Count, null, 0);
            AlertSeverityClass severityClass = Classify(severity);

            rows.Add(new AlertSeverityRow(
                Severity: severity,
                Label: label,
                Count: tally.Count,
                CountText: countText,
                Class: severityClass,
                BadgeStatus: BadgeStatusFor(severityClass),
                AutomationName: $"{label}, {countText}"));
        }

        return rows;
    }

    // Web pie name: severity.charAt(0).toUpperCase() + severity.slice(1) — uppercase only the first
    // character, leave the rest verbatim (the list relies on CSS `capitalize`, which is identical for the
    // single-word severity keys this surface receives).
    private static string Capitalize(string severity)
    {
        if (string.IsNullOrEmpty(severity))
        {
            return severity;
        }

        return char.ToUpper(severity[0], CultureInfo.InvariantCulture) + severity[1..];
    }

    private static string BuildChartSummary(IReadOnlyList<AlertSeverityRow> rows)
    {
        if (rows.Count == 0)
        {
            return string.Empty;
        }

        var parts = new List<string>(rows.Count);
        foreach (var row in rows)
        {
            parts.Add($"{row.Label} {row.CountText}");
        }

        return string.Join(", ", parts);
    }

    private static string BuildAutomationName(
        AlertsSectionState state,
        string title,
        string? totalBadgeText,
        IReadOnlyList<AlertSeverityRow> rows,
        string bySeverity,
        string emptyMessage,
        string loadingLabel) => state switch
        {
            AlertsSectionState.Loading => loadingLabel,
            AlertsSectionState.Empty => string.Create(CultureInfo.CurrentCulture, $"{title}. {emptyMessage}"),
            _ => BuildContentAutomationName(title, totalBadgeText, rows, bySeverity),
        };

    private static string BuildContentAutomationName(
        string title,
        string? totalBadgeText,
        IReadOnlyList<AlertSeverityRow> rows,
        string bySeverity)
    {
        string heading = totalBadgeText is null
            ? title
            : string.Create(CultureInfo.CurrentCulture, $"{title}, {totalBadgeText}");

        var parts = new List<string>(rows.Count);
        foreach (var row in rows)
        {
            parts.Add($"{row.Label} {row.CountText}");
        }

        return parts.Count > 0
            ? string.Create(CultureInfo.CurrentCulture, $"{heading}. {bySeverity}: {string.Join(", ", parts)}")
            : string.Create(CultureInfo.CurrentCulture, $"{heading}. {bySeverity}");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>AlertsSection</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an alert count or severity — so a
/// diagnostics line can never leak how many alerts (or of what kind) a user saw. Thread-safe.
/// </summary>
public sealed class AlertsSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AlertsSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AlertsSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AlertsSectionRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>AlertsSection</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/analytics/components/weekly-digest/AlertsSection.tsx</c>, plus the Segoe Fluent
/// Icons glyphs that stand in for the web Lucide icons (AlertTriangle, AlertCircle, Info). UI-free so the
/// metadata is asserted in tests.
/// </summary>
public static class AlertsSectionRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AlertsSection";

    /// <summary>Segoe Fluent "Warning" glyph — the section header + empty-state + warning-row icon (web <c>AlertTriangle</c>).</summary>
    public const string WarningTriangleGlyph = "\uE7BA";

    /// <summary>Segoe Fluent "ErrorBadge" glyph — the critical-row icon (web <c>AlertCircle</c>).</summary>
    public const string CriticalCircleGlyph = "\uEA39";

    /// <summary>Segoe Fluent "Info" glyph — the info-row icon (web <c>Info</c>).</summary>
    public const string InfoCircleGlyph = "\uE946";

    /// <summary>The Segoe Fluent glyph for a severity row's leading icon, or <see langword="null"/> when the web renders none.</summary>
    /// <param name="severityClass">The severity class selecting the glyph.</param>
    public static string? RowGlyph(AlertSeverityClass severityClass) => severityClass switch
    {
        AlertSeverityClass.Critical => CriticalCircleGlyph,
        AlertSeverityClass.Warning => WarningTriangleGlyph,
        AlertSeverityClass.Info => InfoCircleGlyph,
        _ => null,
    };
}
