using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>DrivingTips</c> surface — the native union of the states the
/// P2 feature-view contract requires for the driving-dynamics recommendations panel
/// (web/src/features/driving/components/driving-dynamics/DrivingTips.tsx). The web component is a pure
/// presentational child: it takes already-resolved <c>motorStats</c> / <c>throttleStyle</c> props and performs
/// no fetching, so the parent Driving-Dynamics page owns the query lifecycle and supplies the active state. The
/// native surface reproduces the full loading / ready / empty / error / stale / offline matrix the prompt
/// mandates; every member maps onto a visible surface (the glass recommendations panel, a skeleton, or a retry
/// affordance) and none is ever hidden behind a <c>{data &amp;&amp; …}</c> guard. <see cref="Empty"/> mirrors the
/// web rendering its <c>tipNoData</c> branch when <c>motorStats</c> is null (the "Drive your vehicle to start
/// collecting dynamics data." row), never a blank box.
/// </summary>
public enum DrivingTipsState
{
    /// <summary>The parent query is in flight and no motor stats have arrived yet — skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved motor stats to render — the lightbulb panel over the derived tip rows (web fall-through).</summary>
    Ready,

    /// <summary>Resolved with no motor stats — the panel over the single "drive to collect data" row, never blank.</summary>
    Empty,

    /// <summary>The query failed with no usable snapshot — a retriable error surface.</summary>
    Error,

    /// <summary>Showing a snapshot older than the freshness window — the tips plus a stale chip.</summary>
    Stale,

    /// <summary>No connectivity — the last cached tips plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One driving-style recommendation the <c>DrivingTips</c> surface can show — the native, localizer-free
/// enumeration of the exact <c>t('dynamics.tip…')</c> branches the web <c>useMemo</c> derives
/// (web/src/features/driving/components/driving-dynamics/DrivingTips.tsx). Keeping the <em>selection</em> as an
/// enum (separate from its localized text) lets the threshold logic be asserted headlessly, byte-for-byte
/// against the web, without a resource host.
/// </summary>
public enum DrivingTipKind
{
    /// <summary>web <c>dynamics.tipNoData</c> — shown when there are no motor stats yet.</summary>
    NoData,

    /// <summary>web <c>dynamics.tipEaseAccel</c> — high average power, ease into the accelerator.</summary>
    EaseAccel,

    /// <summary>web <c>dynamics.tipBrakeEarly</c> — high average power, brake earlier for regen.</summary>
    BrakeEarly,

    /// <summary>web <c>dynamics.tipSmoothThrottle</c> — moderate average power, smooth transitions.</summary>
    SmoothThrottle,

    /// <summary>web <c>dynamics.tipCoast</c> — moderate average power, lift off to coast on regen.</summary>
    Coast,

    /// <summary>web <c>dynamics.tipGreat</c> — low average power, excellent style.</summary>
    Great,

    /// <summary>web <c>dynamics.tipKeep</c> — low average power, keep it consistent.</summary>
    Keep,

    /// <summary>web <c>dynamics.tipThermal</c> — appended when the peak motor temperature runs high.</summary>
    Thermal,
}

/// <summary>
/// Derives the ordered driving-style recommendations from a drive's motor statistics — the 1:1 native port of the
/// web <c>DrivingTips</c> <c>useMemo</c> body (web/src/features/driving/components/driving-dynamics/DrivingTips.tsx)
/// and the surface's "cached telemetry → projection" data adapter. The branch thresholds are reproduced exactly:
/// with no stats the single <see cref="DrivingTipKind.NoData"/> row is returned; otherwise the average motor
/// power (kW) selects the ease/brake (&gt; <see cref="EaseThresholdKw"/>), smooth/coast
/// (&gt; <see cref="SmoothThresholdKw"/>) or great/keep pair, and a peak motor temperature above
/// <see cref="ThermalTipCeilingCelsius"/> appends the thermal caution. All comparisons are strict <c>&gt;</c>
/// exactly like the web. Power is the SI-derived kilowatt figure and temperature the raw SI Celsius the API
/// delivers, so the recommendations never change with the user's display units. Pure logic — unit-tested without
/// a UI host.
/// </summary>
public static class DrivingTipsAdapter
{
    /// <summary>Average motor power (kW) above which the high-power ease/brake tips show (web <c>avgPower &gt; 80</c>).</summary>
    public const double EaseThresholdKw = 80;

    /// <summary>Average motor power (kW) above which the moderate smooth/coast tips show (web <c>avgPower &gt; 20</c>).</summary>
    public const double SmoothThresholdKw = 20;

    /// <summary>Peak motor temperature (°C) above which the thermal caution is appended (web <c>maxMotorTemp &gt; 120</c>).</summary>
    public const double ThermalTipCeilingCelsius = 120;

    /// <summary>
    /// Select the ordered recommendations for <paramref name="stats"/> — the web <c>useMemo</c> list. A null
    /// <paramref name="stats"/> yields the single <see cref="DrivingTipKind.NoData"/> row.
    /// </summary>
    /// <param name="stats">The aggregated motor stats (web <c>motorStats</c>), or null.</param>
    /// <returns>The ordered recommendation kinds, never empty.</returns>
    public static IReadOnlyList<DrivingTipKind> Select(MotorEfficiencyStats? stats)
    {
        var tips = new List<DrivingTipKind>(3);

        if (stats is not { } s)
        {
            tips.Add(DrivingTipKind.NoData);
            return tips;
        }

        if (s.AvgPowerKw > EaseThresholdKw)
        {
            tips.Add(DrivingTipKind.EaseAccel);
            tips.Add(DrivingTipKind.BrakeEarly);
        }
        else if (s.AvgPowerKw > SmoothThresholdKw)
        {
            tips.Add(DrivingTipKind.SmoothThrottle);
            tips.Add(DrivingTipKind.Coast);
        }
        else
        {
            tips.Add(DrivingTipKind.Great);
            tips.Add(DrivingTipKind.Keep);
        }

        if (s.MaxMotorTempCelsius > ThermalTipCeilingCelsius)
        {
            tips.Add(DrivingTipKind.Thermal);
        }

        return tips;
    }

    /// <summary>
    /// The i18n key and English fallback for a recommendation — the exact <c>t(key, fallback)</c> pair the web
    /// component passes for each tip. The fallback is rendered verbatim when the key is absent from the catalog.
    /// </summary>
    /// <param name="kind">The recommendation to resolve.</param>
    /// <returns>The i18n key and its English fallback.</returns>
    public static (string Key, string Fallback) Resource(DrivingTipKind kind) => kind switch
    {
        DrivingTipKind.NoData => (
            "dynamics.tipNoData",
            "Drive your vehicle to start collecting dynamics data."),
        DrivingTipKind.EaseAccel => (
            "dynamics.tipEaseAccel",
            "Ease into the accelerator \u2014 gradual inputs save energy and tire wear."),
        DrivingTipKind.BrakeEarly => (
            "dynamics.tipBrakeEarly",
            "Brake earlier and lighter to improve regen capture."),
        DrivingTipKind.SmoothThrottle => (
            "dynamics.tipSmoothThrottle",
            "Smooth throttle transitions can improve efficiency by 10\u201315%."),
        DrivingTipKind.Coast => (
            "dynamics.tipCoast",
            "Lift off the pedal earlier to let regen do the work."),
        DrivingTipKind.Great => (
            "dynamics.tipGreat",
            "Excellent driving style! Maintaining this maximizes range and comfort."),
        DrivingTipKind.Keep => (
            "dynamics.tipKeep",
            "Keep monitoring your scores \u2014 consistency is key."),
        _ => (
            "dynamics.tipThermal",
            "Motor temps are running high \u2014 consider easing off sustained high power."),
    };

    /// <summary>Resolve a recommendation to its localized text through the i18n facade.</summary>
    /// <param name="kind">The recommendation to localize.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized recommendation text.</returns>
    public static string Localize(DrivingTipKind kind, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        (string key, string fallback) = Resource(kind);
        return localizer.GetString(key, fallback);
    }
}

/// <summary>
/// The render-time data model the <c>DrivingTips</c> view binds to — the native analogue of the web component's
/// props (<c>motorStats</c> / <c>throttleStyle</c>,
/// web/src/features/driving/components/driving-dynamics/DrivingTips.tsx) plus the parent-supplied lifecycle
/// <see cref="Status"/> and freshness flags. The view never performs HTTP; the parent Driving-Dynamics state
/// holder fills this in (the native P1/S8 seam). Motor stats stay SI; the recommendations and the row icon are
/// derived at projection time. <see cref="Style"/> is optional — when the stats are present and no style is
/// supplied, the projection derives it from the average power exactly like the web parent
/// (<c>throttleStyle = motorStats ? getThrottleStyle(motorStats.avgPower) : null</c>). Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="Status">The parent-supplied lifecycle state.</param>
/// <param name="Stats">The aggregated motor stats (web <c>motorStats</c>), or null when there are none.</param>
/// <param name="Style">The driving style (web <c>throttleStyle</c>), or null to derive from the average power.</param>
/// <param name="UpdatedAt">Last successful update timestamp surfaced in the freshness chip.</param>
/// <param name="IsFetching">True while a background refresh is in flight.</param>
/// <param name="ErrorMessage">Already-localized error message for the error / offline surfaces, when set.</param>
public sealed record DrivingTipsModel(
    DrivingTipsState Status,
    MotorEfficiencyStats? Stats,
    ThrottleStyle? Style,
    DateTimeOffset? UpdatedAt = null,
    bool IsFetching = false,
    string? ErrorMessage = null)
{
    /// <summary>The initial model: the parent query is in flight and no stats have arrived yet.</summary>
    public static DrivingTipsModel Loading() =>
        new(DrivingTipsState.Loading, null, null);

    /// <summary>A resolved model with no motor stats — the panel over the "drive to collect data" row.</summary>
    public static DrivingTipsModel Empty() =>
        new(DrivingTipsState.Empty, null, null);

    /// <summary>A hard-failure model (no usable snapshot) carrying an optional already-localized message.</summary>
    /// <param name="message">An already-localized error message, or null for the default copy.</param>
    public static DrivingTipsModel Failed(string? message = null) =>
        new(DrivingTipsState.Error, null, null, ErrorMessage: message);

    /// <summary>A fresh resolved model carrying the motor stats the recommendations derive from.</summary>
    /// <param name="stats">The aggregated motor stats.</param>
    /// <param name="style">The driving style, or null to derive from the average power.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    /// <param name="isFetching">True while a background refresh is in flight.</param>
    public static DrivingTipsModel Ready(
        MotorEfficiencyStats stats,
        ThrottleStyle? style = null,
        DateTimeOffset? updatedAt = null,
        bool isFetching = false)
    {
        ArgumentNullException.ThrowIfNull(stats);
        return new(DrivingTipsState.Ready, stats, style, updatedAt, isFetching);
    }

    /// <summary>A stale snapshot (older than the freshness window) carrying the cached motor stats.</summary>
    /// <param name="stats">The cached motor stats.</param>
    /// <param name="style">The driving style, or null to derive from the average power.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    public static DrivingTipsModel Stale(
        MotorEfficiencyStats stats,
        ThrottleStyle? style = null,
        DateTimeOffset? updatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(stats);
        return new(DrivingTipsState.Stale, stats, style, updatedAt);
    }

    /// <summary>An offline snapshot (no connectivity) carrying the last cached motor stats.</summary>
    /// <param name="stats">The cached motor stats.</param>
    /// <param name="style">The driving style, or null to derive from the average power.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    /// <param name="message">An already-localized offline message, or null for the default copy.</param>
    public static DrivingTipsModel Offline(
        MotorEfficiencyStats stats,
        ThrottleStyle? style = null,
        DateTimeOffset? updatedAt = null,
        string? message = null)
    {
        ArgumentNullException.ThrowIfNull(stats);
        return new(DrivingTipsState.Offline, stats, style, updatedAt, ErrorMessage: message);
    }
}

/// <summary>
/// One render-ready recommendation row — the native analogue of a single web tip row (the bordered
/// <c>flex items-start</c> box). Carries the already-localized <see cref="Text"/> and the per-row Narrator
/// <see cref="AutomationName"/>; the leading icon (shield / triangle) is shared across the list and lives on the
/// parent <see cref="DrivingTipsDisplay"/>. Pure data.
/// </summary>
/// <param name="Text">The localized recommendation text (web tip string).</param>
/// <param name="AutomationName">The Narrator name for the row.</param>
public sealed record DrivingTipRow(string Text, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the driving recommendations — the native analogue of everything the
/// web <c>DrivingTips</c> renders. Holds the active <see cref="State"/>, the localized panel
/// <see cref="Title"/>, the ordered <see cref="Tips"/> rows, the shared leading-icon glyph + tone
/// (<see cref="TipIconGlyph"/> / <see cref="TipIconStatus"/>, the web <c>ShieldCheck</c>-vs-<c>AlertTriangle</c>
/// choice), the freshness chip copy + status (shown only for <see cref="DrivingTipsState.Stale"/> /
/// <see cref="DrivingTipsState.Offline"/>), the loading / error copy and retry label, the freshness timestamp +
/// fetching flag, and the surface <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="State">The resolved render branch.</param>
/// <param name="Title">Localized panel title (web "Driving Style Recommendations").</param>
/// <param name="Tips">The ordered recommendation rows (always at least one).</param>
/// <param name="TipIconGlyph">Segoe Fluent glyph shared by every row (shield when conservative, else triangle).</param>
/// <param name="TipIconStatus">Semantic tone for the row icon (success when conservative, else warning).</param>
/// <param name="ShowFreshnessChip">Whether a stale / offline chip is shown beside the title.</param>
/// <param name="FreshnessChipText">Localized stale / offline chip text.</param>
/// <param name="FreshnessChipStatus">Semantic tone for the freshness chip.</param>
/// <param name="LoadingLabel">Localized loading copy (loading branch).</param>
/// <param name="ErrorTitle">Localized error heading (error branch).</param>
/// <param name="ErrorMessage">Localized error message (error / offline branch).</param>
/// <param name="RetryLabel">Localized retry affordance label.</param>
/// <param name="UpdatedAt">Last successful update timestamp surfaced in the freshness chip.</param>
/// <param name="IsFetching">True while a background refresh is in flight.</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record DrivingTipsDisplay(
    DrivingTipsState State,
    string Title,
    IReadOnlyList<DrivingTipRow> Tips,
    string TipIconGlyph,
    StatusKind TipIconStatus,
    bool ShowFreshnessChip,
    string FreshnessChipText,
    StatusKind FreshnessChipStatus,
    string LoadingLabel,
    string ErrorTitle,
    string ErrorMessage,
    string RetryLabel,
    DateTimeOffset? UpdatedAt,
    bool IsFetching,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="DrivingTipsModel"/> to its <see cref="DrivingTipsDisplay"/> — the native
/// port of web/src/features/driving/components/driving-dynamics/DrivingTips.tsx. Branch precedence mirrors the
/// web parent's data lifecycle (loading → error → empty → freshness → ready); a fresh snapshot with no stats
/// collapses to the empty branch (the single "drive to collect data" row), while a stale / offline snapshot keeps
/// its cached recommendations under a freshness chip. The recommendation list comes from
/// <see cref="DrivingTipsAdapter.Select"/>; the leading row icon reproduces the web ternary
/// (<c>throttleStyle === 'conservative' ? ShieldCheck : AlertTriangle</c>), deriving the style from the average
/// power when the parent did not supply one (<see cref="ThrottleStyles.FromAveragePower"/>). Every label resolves
/// through the i18n facade using the same keys the web feeds into <c>t(...)</c>. No WinUI types — unit-tested
/// without a UI host.
/// </summary>
public static class DrivingTipsProjection
{
    /// <summary>i18n key for the panel title (web <c>dynamics.recommendations</c>).</summary>
    public const string TitleKey = "dynamics.recommendations";

    /// <summary>English fallback for <see cref="TitleKey"/>.</summary>
    public const string TitleFallback = "Driving Style Recommendations";

    /// <summary>i18n key for the error heading (native-only — the web child has no error branch).</summary>
    public const string ErrorTitleKey = "dynamics.tipsError";

    /// <summary>English fallback for <see cref="ErrorTitleKey"/>.</summary>
    public const string ErrorTitleFallback = "Couldn't load recommendations";

    /// <summary>i18n key for the default error message.</summary>
    public const string ErrorMessageKey = "dynamics.tipsErrorMessage";

    /// <summary>English fallback for <see cref="ErrorMessageKey"/>.</summary>
    public const string ErrorMessageFallback =
        "We couldn't load your driving recommendations. Please try again.";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props plus lifecycle).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static DrivingTipsDisplay Project(DrivingTipsModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        DrivingTipsState state = SelectState(model);
        string title = localizer.GetString(TitleKey, TitleFallback);

        // web: motorStats drives the tip list; when the snapshot resolved with no stats we show the single
        // no-data row (the empty branch renders the same panel, never a blank box).
        MotorEfficiencyStats? stats = state == DrivingTipsState.Empty ? null : model.Stats;
        List<DrivingTipRow> tips = BuildTips(stats, localizer);

        bool conservative = IsConservative(stats, model.Style);
        string iconGlyph = conservative
            ? DrivingTipsRegistration.ShieldCheckGlyph
            : DrivingTipsRegistration.AlertTriangleGlyph;
        StatusKind iconStatus = conservative ? StatusKind.Success : StatusKind.Warning;

        bool showChip = state is DrivingTipsState.Stale or DrivingTipsState.Offline;
        string chipText = state switch
        {
            DrivingTipsState.Offline => localizer.GetString("common.offline", "Offline"),
            DrivingTipsState.Stale => localizer.GetString("common.stale", "Stale"),
            _ => string.Empty,
        };
        StatusKind chipStatus = state == DrivingTipsState.Offline ? StatusKind.Danger : StatusKind.Warning;

        string loadingLabel = localizer.GetString("common.loading", "Loading");
        string errorTitle = localizer.GetString(ErrorTitleKey, ErrorTitleFallback);
        string errorMessage = string.IsNullOrWhiteSpace(model.ErrorMessage)
            ? localizer.GetString(ErrorMessageKey, ErrorMessageFallback)
            : model.ErrorMessage!;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        string automationName = BuildAutomationName(
            state, title, tips, showChip, chipText, loadingLabel, errorTitle);

        return new DrivingTipsDisplay(
            State: state,
            Title: title,
            Tips: tips,
            TipIconGlyph: iconGlyph,
            TipIconStatus: iconStatus,
            ShowFreshnessChip: showChip,
            FreshnessChipText: chipText,
            FreshnessChipStatus: chipStatus,
            LoadingLabel: loadingLabel,
            ErrorTitle: errorTitle,
            ErrorMessage: errorMessage,
            RetryLabel: retryLabel,
            UpdatedAt: model.UpdatedAt,
            IsFetching: model.IsFetching,
            AutomationName: automationName);
    }

    /// <summary>
    /// Whether the driving style resolves to conservative — the web <c>throttleStyle === 'conservative'</c> test
    /// that picks the shield icon. With no stats the style is null (web parent passes null), so the triangle
    /// shows; otherwise an explicit style wins and a missing one is derived from the average power.
    /// </summary>
    /// <param name="stats">The motor stats, or null.</param>
    /// <param name="style">The parent-supplied style, or null to derive.</param>
    /// <returns>True when the resolved style is conservative.</returns>
    public static bool IsConservative(MotorEfficiencyStats? stats, ThrottleStyle? style)
    {
        if (stats is not { } s)
        {
            // web: throttleStyle = motorStats ? getThrottleStyle(...) : null → null is never 'conservative'.
            return style == ThrottleStyle.Conservative;
        }

        ThrottleStyle resolved = style ?? ThrottleStyles.FromAveragePower(s.AvgPowerKw);
        return resolved == ThrottleStyle.Conservative;
    }

    // Branch precedence from the web parent's data lifecycle. Loading / Error / Empty / Stale / Offline come
    // straight from the parent's classification; a fresh "Ready" snapshot with no stats has only the no-data row
    // and collapses to the empty branch, while a stale / offline snapshot keeps its cached tips.
    private static DrivingTipsState SelectState(DrivingTipsModel model) => model.Status switch
    {
        DrivingTipsState.Loading => DrivingTipsState.Loading,
        DrivingTipsState.Error => DrivingTipsState.Error,
        DrivingTipsState.Empty => DrivingTipsState.Empty,
        DrivingTipsState.Stale => DrivingTipsState.Stale,
        DrivingTipsState.Offline => DrivingTipsState.Offline,
        _ => model.Stats is not null ? DrivingTipsState.Ready : DrivingTipsState.Empty,
    };

    private static List<DrivingTipRow> BuildTips(MotorEfficiencyStats? stats, ILocalizer localizer)
    {
        IReadOnlyList<DrivingTipKind> kinds = DrivingTipsAdapter.Select(stats);
        var rows = new List<DrivingTipRow>(kinds.Count);
        foreach (DrivingTipKind kind in kinds)
        {
            string text = DrivingTipsAdapter.Localize(kind, localizer);
            rows.Add(new DrivingTipRow(text, text));
        }

        return rows;
    }

    private static string BuildAutomationName(
        DrivingTipsState state,
        string title,
        List<DrivingTipRow> tips,
        bool showChip,
        string chipText,
        string loadingLabel,
        string errorTitle)
    {
        switch (state)
        {
            case DrivingTipsState.Loading:
                return string.Create(CultureInfo.CurrentCulture, $"{title}. {loadingLabel}");
            case DrivingTipsState.Error:
                return errorTitle;
            default:
                var parts = new List<string>(tips.Count + 2) { title };
                if (showChip)
                {
                    parts.Add(chipText);
                }

                foreach (DrivingTipRow tip in tips)
                {
                    parts.Add(tip.Text);
                }

                return string.Join(". ", parts);
        }
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>DrivingTips</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a motor power, temperature or VIN — so a
/// diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class DrivingTipsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Optional sink invoked with each diagnostics line.</param>
    public DrivingTipsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DrivingTips</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DrivingTipsRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>DrivingTips</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/driving/components/driving-dynamics/DrivingTips.tsx</c>. Holds the diagnostics slug and the
/// Segoe Fluent glyphs that stand in for the web Lucide icons (<c>Lightbulb</c> header, <c>ShieldCheck</c> /
/// <c>AlertTriangle</c> row markers). UI-free so the metadata is asserted in tests.
/// </summary>
public static class DrivingTipsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "DrivingTips";

    /// <summary>Segoe Fluent "Lightbulb" glyph for the panel header (web lucide <c>Lightbulb</c>).</summary>
    public const string LightbulbGlyph = "\uEA80";

    /// <summary>Segoe Fluent "Shield" glyph for a conservative-style row (web lucide <c>ShieldCheck</c>).</summary>
    public const string ShieldCheckGlyph = "\uEA18";

    /// <summary>Segoe Fluent "Warning" glyph for a non-conservative-style row (web lucide <c>AlertTriangle</c>).</summary>
    public const string AlertTriangleGlyph = "\uE7BA";
}
