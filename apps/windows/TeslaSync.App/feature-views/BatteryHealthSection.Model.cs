using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>BatteryHealthSection</c> surface — the native union of the
/// states the P2 feature-view contract requires for the weekly-digest Battery-Health section
/// (web/src/features/analytics/components/weekly-digest/BatteryHealthSection.tsx). The web component is a pure
/// presentational child (it takes a <c>metrics: DigestMetrics</c> prop and performs no fetching), so the
/// parent Weekly-Digest experience owns the query lifecycle and supplies the active state. Every member maps
/// onto a visible surface; none is ever hidden behind a <c>{data &amp;&amp; …}</c> guard.
/// </summary>
public enum BatteryHealthSectionState
{
    /// <summary>The digest query is in flight and no metrics have arrived yet — skeleton chrome.</summary>
    Loading,

    /// <summary>At least one charge session to summarise (the web fall-through) — pills + mini-stats.</summary>
    Ready,

    /// <summary>Resolved with no charge sessions to summarise — a friendly empty state, never a blank box.</summary>
    Empty,

    /// <summary>The digest query failed with no usable snapshot — a retriable error surface.</summary>
    Error,

    /// <summary>Showing a snapshot older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>No connectivity — the last cached snapshot plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The render-time data model the <c>BatteryHealthSection</c> view binds to — the native analogue of the web
/// component's <c>metrics: DigestMetrics</c> prop, narrowed to the four fields the section actually reads
/// (<c>batteryStart</c>, <c>batteryEnd</c>, <c>chargeEnergyAdded</c>, <c>chargingSessionCount</c>) plus the
/// parent-supplied lifecycle <see cref="Status"/> and freshness flags. The view never performs HTTP; the
/// parent Weekly-Digest state holder fills this in (the native P1/S8 seam). Battery percentages are 0..100
/// shares (SI on disk — a dimensionless percentage needs no display conversion). <see cref="ChargeEnergyAdded"/>
/// is the web's <c>metrics.chargeEnergyAdded</c> aggregate verbatim; the projection multiplies it by the web's
/// own <see cref="BatteryHealthSectionProjection.RangeKilometersPerEnergyUnit"/> range heuristic at the
/// display boundary, reproducing the source exactly rather than introducing a new unit-suffixed field. Pure
/// data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record BatteryHealthSectionModel(
    BatteryHealthSectionState Status,
    double AverageBatteryStartPercent,
    double AverageBatteryEndPercent,
    double ChargeEnergyAdded,
    long ChargingSessionCount,
    DateTimeOffset? UpdatedAt = null,
    bool IsFetching = false,
    string? ErrorMessage = null)
{
    /// <summary>The initial model: the digest query is in flight and no metrics have arrived yet.</summary>
    public static BatteryHealthSectionModel Loading { get; } = new(BatteryHealthSectionState.Loading, 0, 0, 0, 0);

    /// <summary>A resolved model with no charging activity — the empty state.</summary>
    public static BatteryHealthSectionModel Empty { get; } = new(BatteryHealthSectionState.Empty, 0, 0, 0, 0);

    /// <summary>A hard-failure model (no usable snapshot) carrying an optional already-localized message.</summary>
    public static BatteryHealthSectionModel Failed(string? message = null) =>
        new(BatteryHealthSectionState.Error, 0, 0, 0, 0, ErrorMessage: message);

    /// <summary>A fresh resolved model with the four battery-health metrics.</summary>
    public static BatteryHealthSectionModel Ready(
        double averageBatteryStartPercent,
        double averageBatteryEndPercent,
        double chargeEnergyAdded,
        long chargingSessionCount,
        DateTimeOffset? updatedAt = null,
        bool isFetching = false) =>
        new(
            BatteryHealthSectionState.Ready,
            averageBatteryStartPercent,
            averageBatteryEndPercent,
            chargeEnergyAdded,
            chargingSessionCount,
            updatedAt,
            isFetching);

    /// <summary>A stale snapshot (older than the freshness window) carrying the cached metrics.</summary>
    public static BatteryHealthSectionModel Stale(
        double averageBatteryStartPercent,
        double averageBatteryEndPercent,
        double chargeEnergyAdded,
        long chargingSessionCount,
        DateTimeOffset? updatedAt = null) =>
        new(
            BatteryHealthSectionState.Stale,
            averageBatteryStartPercent,
            averageBatteryEndPercent,
            chargeEnergyAdded,
            chargingSessionCount,
            updatedAt);

    /// <summary>An offline snapshot (no connectivity) carrying the last cached metrics.</summary>
    public static BatteryHealthSectionModel Offline(
        double averageBatteryStartPercent,
        double averageBatteryEndPercent,
        double chargeEnergyAdded,
        long chargingSessionCount,
        DateTimeOffset? updatedAt = null) =>
        new(
            BatteryHealthSectionState.Offline,
            averageBatteryStartPercent,
            averageBatteryEndPercent,
            chargeEnergyAdded,
            chargingSessionCount,
            updatedAt);
}

/// <summary>
/// One projected, render-ready battery pill — the native analogue of the web <c>BatteryPill</c>
/// (web/src/features/analytics/components/weekly-digest/BatteryPill.tsx). <see cref="Label"/> is the localized
/// caption; <see cref="LevelText"/> is the rounded "<c>{level}%</c>" the web renders via
/// <c>fmtInt(Math.round(value))</c>; <see cref="BarFraction"/> is the clamped 0..1 fill the web computes as
/// <c>Math.min(level, 100)%</c>; <see cref="Status"/> maps the web <c>STATUS_COLORS</c> threshold (≥60 good,
/// ≥30 warning, else critical) onto a semantic <see cref="StatusKind"/>; and <see cref="AutomationName"/> is
/// the spoken "<c>{label}, {level}%</c>". Pure data.
/// </summary>
public sealed record BatteryHealthPill(
    string Label,
    string LevelText,
    double BarFraction,
    StatusKind Status,
    string AutomationName);

/// <summary>The three weekly-digest battery mini-stats, in the web's fixed render order.</summary>
public enum BatteryHealthStatKind
{
    /// <summary>Web "Avg Charge Gain" — <c>fmtNumber(batteryEnd - batteryStart, 1)%</c>.</summary>
    ChargeGain,

    /// <summary>Web "Charge Sessions" — <c>fmtInt(chargingSessionCount)</c>.</summary>
    ChargeSessions,

    /// <summary>Web "Est. Range Added" — <c>fmtNumber(chargeEnergyAdded * 5.5, 0) km</c>.</summary>
    RangeAdded,
}

/// <summary>
/// One projected, render-ready mini-stat — the native analogue of a single web <c>MiniStat</c>
/// (web/src/features/analytics/components/weekly-digest/MiniStat.tsx). <see cref="Kind"/> lets the view pick
/// the matching Segoe Fluent glyph (the web's lucide icon), <see cref="Label"/> is the localized caption,
/// <see cref="Value"/> is the pre-formatted value string and <see cref="AutomationName"/> is the spoken
/// "<c>{label}, {value}</c>". Pure data.
/// </summary>
public sealed record BatteryHealthStat(
    BatteryHealthStatKind Kind,
    string Label,
    string Value,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the section for one input model — the native analogue of what
/// the web <c>BatteryHealthSection</c> renders. Holds the active <see cref="State"/>, the localized
/// <see cref="Title"/>, the two <see cref="Pills"/> and three <see cref="Stats"/>, the freshness chip copy +
/// status (shown only for <see cref="BatteryHealthSectionState.Stale"/> / <see cref="BatteryHealthSectionState.Offline"/>),
/// the empty / loading / error copy and retry label, the freshness timestamp + fetching flag, and the surface
/// <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record BatteryHealthSectionDisplay(
    BatteryHealthSectionState State,
    string Title,
    IReadOnlyList<BatteryHealthPill> Pills,
    IReadOnlyList<BatteryHealthStat> Stats,
    bool ShowFreshnessChip,
    string FreshnessChipText,
    StatusKind FreshnessChipStatus,
    string EmptyMessage,
    string LoadingLabel,
    string ErrorTitle,
    string ErrorMessage,
    string RetryLabel,
    DateTimeOffset? UpdatedAt,
    bool IsFetching,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="BatteryHealthSectionModel"/> to its
/// <see cref="BatteryHealthSectionDisplay"/> — the native port of
/// web/src/features/analytics/components/weekly-digest/BatteryHealthSection.tsx. Branch precedence mirrors the
/// web parent's data lifecycle (loading → error → empty → freshness → ready); a fresh snapshot with no charge
/// sessions collapses to a friendly empty state (battery health is derived entirely from charging activity),
/// while a stale / offline snapshot keeps its cached content under a freshness chip. Every numeric string is
/// produced by <see cref="NumberFormatting"/> (the 1:1 port of the web <c>fmtNumber</c> / <c>fmtInt</c>,
/// round-half-away-from-zero), the pill level is rounded then thresholded exactly as the web
/// <c>BatteryPill</c>, and the estimated range reproduces the web's own <c>chargeEnergyAdded * 5.5</c> km
/// heuristic verbatim. Every label resolves through the i18n facade using the same keys the web feeds into
/// <c>t(...)</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class BatteryHealthSectionProjection
{
    /// <summary>
    /// Estimated kilometres of range per unit of <c>chargeEnergyAdded</c> — the web source's own heuristic
    /// (<c>metrics.chargeEnergyAdded * 5.5</c>). Reproduced verbatim for parity; this is a display-boundary
    /// estimate, not a stored SI quantity.
    /// </summary>
    public const double RangeKilometersPerEnergyUnit = 5.5;

    /// <summary>Battery level at or above which the pill reads "good" (web <c>STATUS_COLORS.good</c>).</summary>
    public const double GoodThresholdPercent = 60;

    /// <summary>Battery level at or above which the pill reads "warning" (web <c>STATUS_COLORS.warning</c>).</summary>
    public const double WarningThresholdPercent = 30;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web prop, narrowed to the battery fields).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static BatteryHealthSectionDisplay Project(BatteryHealthSectionModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        BatteryHealthSectionState state = SelectState(model);

        string title = localizer.GetString("analytics.weeklyDigest.batteryHealth", "Battery Health");
        IReadOnlyList<BatteryHealthPill> pills = BuildPills(model, localizer);
        IReadOnlyList<BatteryHealthStat> stats = BuildStats(model, localizer);

        bool showChip = state is BatteryHealthSectionState.Stale or BatteryHealthSectionState.Offline;
        string chipText = state switch
        {
            BatteryHealthSectionState.Offline => localizer.GetString("common.offline", "Offline"),
            BatteryHealthSectionState.Stale => localizer.GetString("analytics.weeklyDigest.staleChip", "Stale"),
            _ => string.Empty,
        };
        StatusKind chipStatus = state == BatteryHealthSectionState.Offline ? StatusKind.Danger : StatusKind.Warning;

        string emptyMessage = localizer.GetString(
            "analytics.weeklyDigest.batteryHealthEmpty", "No charge sessions to summarize this week");
        string loadingLabel = localizer.GetString("common.loading", "Loading");
        string errorTitle = localizer.GetString(
            "analytics.weeklyDigest.batteryHealthError", "Couldn't load battery health");
        string errorMessage = string.IsNullOrWhiteSpace(model.ErrorMessage)
            ? localizer.GetString(
                "analytics.weeklyDigest.batteryHealthErrorMessage",
                "We couldn't load battery health for this week. Please try again.")
            : model.ErrorMessage!;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        string automationName = BuildAutomationName(
            state, title, showChip, chipText, pills, stats, emptyMessage, loadingLabel, errorTitle);

        return new BatteryHealthSectionDisplay(
            State: state,
            Title: title,
            Pills: pills,
            Stats: stats,
            ShowFreshnessChip: showChip,
            FreshnessChipText: chipText,
            FreshnessChipStatus: chipStatus,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            ErrorTitle: errorTitle,
            ErrorMessage: errorMessage,
            RetryLabel: retryLabel,
            UpdatedAt: model.UpdatedAt,
            IsFetching: model.IsFetching,
            AutomationName: automationName);
    }

    // Branch precedence from the web parent's data lifecycle. Loading / Error / Empty / Stale / Offline come
    // straight from the parent's classification; a fresh "Ready" snapshot with no charge sessions has no
    // battery-health story to tell and collapses to the friendly empty state (the same rule the
    // ChargingBreakdownSlide uses), while a stale / offline snapshot keeps its cached content under a chip.
    private static BatteryHealthSectionState SelectState(BatteryHealthSectionModel model) => model.Status switch
    {
        BatteryHealthSectionState.Loading => BatteryHealthSectionState.Loading,
        BatteryHealthSectionState.Error => BatteryHealthSectionState.Error,
        BatteryHealthSectionState.Empty => BatteryHealthSectionState.Empty,
        BatteryHealthSectionState.Stale => BatteryHealthSectionState.Stale,
        BatteryHealthSectionState.Offline => BatteryHealthSectionState.Offline,
        _ => model.ChargingSessionCount > 0 ? BatteryHealthSectionState.Ready : BatteryHealthSectionState.Empty,
    };

    private static IReadOnlyList<BatteryHealthPill> BuildPills(BatteryHealthSectionModel model, ILocalizer localizer) =>
    [
        BuildPill(
            model.AverageBatteryStartPercent,
            localizer.GetString("analytics.weeklyDigest.avgBatteryStart", "Avg Battery at Charge Start")),
        BuildPill(
            model.AverageBatteryEndPercent,
            localizer.GetString("analytics.weeklyDigest.avgBatteryEnd", "Avg Battery at Charge End")),
    ];

    private static BatteryHealthPill BuildPill(double rawPercent, string label)
    {
        // Web BatteryPill: level = Math.round(value); the colour threshold + bar both read the rounded level.
        // Battery share is non-negative, so half-away-from-zero matches JS Math.round here.
        double level = Math.Round(rawPercent, MidpointRounding.AwayFromZero);
        string levelText = NumberFormatting.Format(level, null, 0) + "%";
        double barFraction = Math.Clamp(level, 0, 100) / 100.0;
        StatusKind status = level >= GoodThresholdPercent
            ? StatusKind.Success
            : level >= WarningThresholdPercent
                ? StatusKind.Warning
                : StatusKind.Danger;

        return new BatteryHealthPill(label, levelText, barFraction, status, $"{label}, {levelText}");
    }

    private static IReadOnlyList<BatteryHealthStat> BuildStats(BatteryHealthSectionModel model, ILocalizer localizer)
    {
        // Web: fmtNumber(batteryEnd - batteryStart, 1)%  /  fmtInt(count)  /  fmtNumber(chargeEnergyAdded * 5.5, 0) km.
        string gainValue = NumberFormatting.Format(
            model.AverageBatteryEndPercent - model.AverageBatteryStartPercent, null, 1) + "%";
        string sessionsValue = NumberFormatting.Format(model.ChargingSessionCount, null, 0);
        string rangeValue = NumberFormatting.Format(
            model.ChargeEnergyAdded * RangeKilometersPerEnergyUnit, null, 0) + " km";

        string gainLabel = localizer.GetString("analytics.weeklyDigest.avgChargeGain", "Avg Charge Gain");
        string sessionsLabel = localizer.GetString("analytics.weeklyDigest.chargeSessions", "Charge Sessions");
        string rangeLabel = localizer.GetString("analytics.weeklyDigest.estRangeAdded", "Est. Range Added");

        return
        [
            new BatteryHealthStat(BatteryHealthStatKind.ChargeGain, gainLabel, gainValue, $"{gainLabel}, {gainValue}"),
            new BatteryHealthStat(BatteryHealthStatKind.ChargeSessions, sessionsLabel, sessionsValue, $"{sessionsLabel}, {sessionsValue}"),
            new BatteryHealthStat(BatteryHealthStatKind.RangeAdded, rangeLabel, rangeValue, $"{rangeLabel}, {rangeValue}"),
        ];
    }

    private static string BuildAutomationName(
        BatteryHealthSectionState state,
        string title,
        bool showChip,
        string chipText,
        IReadOnlyList<BatteryHealthPill> pills,
        IReadOnlyList<BatteryHealthStat> stats,
        string emptyMessage,
        string loadingLabel,
        string errorTitle)
    {
        switch (state)
        {
            case BatteryHealthSectionState.Loading:
                return $"{title}. {loadingLabel}";
            case BatteryHealthSectionState.Empty:
                return $"{title}. {emptyMessage}";
            case BatteryHealthSectionState.Error:
                return $"{title}. {errorTitle}";
            default:
                var parts = new List<string> { title };
                if (showChip)
                {
                    parts.Add(chipText);
                }

                foreach (var pill in pills)
                {
                    parts.Add(pill.AutomationName);
                }

                foreach (var stat in stats)
                {
                    parts.Add(stat.AutomationName);
                }

                return string.Join(". ", parts);
        }
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>BatteryHealthSection</c> surface (P1/S11 diagnostics contract). Records
/// only the operational <c>view.opened</c> event with the surface slug — never a battery level, charge gain,
/// session count or range — so a diagnostics line can never leak a user's charging behaviour. Thread-safe.
/// </summary>
public sealed class BatteryHealthSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BatteryHealthSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BatteryHealthSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BatteryHealthSectionRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>BatteryHealthSection</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/analytics/components/weekly-digest/BatteryHealthSection.tsx</c>.
/// </summary>
public static class BatteryHealthSectionRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BatteryHealthSection";
}
