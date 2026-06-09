using System.Collections.Generic;
using System.Globalization;
using System.Text;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Dashboard;

/// <summary>
/// The mutually-exclusive render branch of the <c>RecentActivity</c> surface — the native union of the
/// states the web component participates in (web/src/features/dashboard/components/RecentActivity.tsx).
/// The web source is a pure presentational child of the Dashboard page: it takes the
/// <c>recentDrives</c> / <c>recentCharges</c> / <c>analytics</c> props (plus the user's unit context and
/// the <c>toEfficiencyDisplay</c> callback) and performs no fetching, so the branch is a direct function
/// of the input <see cref="RecentActivityModel"/>. The Dashboard page owns the query lifecycle (it renders
/// a skeleton while the drives / charging / analytics queries load and a page-level error / empty surface
/// before mounting the sections), so this leaf reproduces that loading hand-off as a parent-supplied
/// <see cref="RecentActivityModel.Loading"/> flag and otherwise renders the three-panel composition. There
/// is therefore no fetch-driven error / stale / offline branch to reproduce inside this surface — those are
/// owned by the parent Dashboard page exactly as in the web source. Emptiness is per-panel (web parity): the
/// activity feed and battery-trend panels each show a friendly empty note instead of a blank box, and the
/// fleet-performance panel always renders (with the web's <c>?? 0</c> fallbacks). No branch is ever hidden.
/// </summary>
public enum RecentActivityState
{
    /// <summary>The Dashboard queries have not resolved yet (the parent is still fetching) — skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved — the web fall-through: the activity feed, the battery-trend chart and fleet performance.</summary>
    Ready,
}

/// <summary>
/// Which kind of activity a unified-feed row represents — the native union of the two branches the web
/// merges into its timeline (web/src/features/dashboard/components/RecentActivity.tsx): a completed drive
/// (the web <c>Route</c> icon + cyan accent) or a charging session (the web <c>Zap</c> icon + green accent).
/// UI-free so the feed assembly is unit-tested without a XAML runtime.
/// </summary>
public enum RecentActivityKind
{
    /// <summary>A completed drive — web <c>type: 'drive'</c> (Route icon, <c>#00f0ff</c> cyan accent).</summary>
    Drive,

    /// <summary>A charging session — web <c>type: 'charge'</c> (Zap icon, <c>#10b981</c> green accent).</summary>
    Charge,
}

/// <summary>
/// One recent drive the web feed reads (web <c>Drive</c> in web/src/features/dashboard/types.ts), narrowed
/// to the fields <c>RecentActivity</c> actually consumes. SI on the wire — meters and seconds — so the
/// projection converts to the user's display unit at the render boundary exactly as the web
/// <c>convertDistanceFromSI</c> does. Pure data — no WinUI types.
/// </summary>
/// <param name="DistanceM">Distance travelled in SI meters (web <c>distance_m ?? 0</c>).</param>
/// <param name="DurationS">Drive duration in SI seconds (web <c>duration_s ?? 0</c>).</param>
/// <param name="StartSocPct">Start state-of-charge percent, or null (web <c>start_soc_pct ?? '?'</c>).</param>
/// <param name="EndSocPct">End state-of-charge percent, or null (web <c>end_soc_pct ?? '?'</c>); also feeds the battery trend (web <c>?? 50</c>).</param>
/// <param name="StartedAt">The drive start instant (web <c>new Date(d.started_at)</c>) used to sort the feed and show the relative time.</param>
public sealed record RecentActivityDrive(
    double DistanceM,
    double DurationS,
    double? StartSocPct,
    double? EndSocPct,
    DateTimeOffset StartedAt);

/// <summary>
/// One recent charging session the web feed reads (web <c>ChargingSession</c> in
/// web/src/features/dashboard/types.ts), narrowed to the fields <c>RecentActivity</c> consumes. SI on the
/// wire — watt-hours — so the projection converts to kWh at the render boundary exactly as the web
/// <c>convertEnergyFromSI(_, 'kWh')</c> does. Pure data — no WinUI types.
/// </summary>
/// <param name="EnergyAddedWh">Energy added in SI watt-hours (web <c>total_energy_added_wh ?? 0</c>).</param>
/// <param name="StartSocPct">Start state-of-charge percent, or null (web <c>start_soc_pct ?? '?'</c>).</param>
/// <param name="EndSocPct">End state-of-charge percent, or null (web <c>end_soc_pct ?? '?'</c>).</param>
/// <param name="Cost">The session cost, or null when unknown (web shows it only when <c>typeof cost === 'number'</c>).</param>
/// <param name="StartedAt">The session start instant (web <c>new Date(s.started_at)</c>) used to sort the feed and show the relative time.</param>
public sealed record RecentActivityCharge(
    double EnergyAddedWh,
    double? StartSocPct,
    double? EndSocPct,
    double? Cost,
    DateTimeOffset StartedAt);

/// <summary>
/// The fleet's most-efficient vehicle the web fleet-performance panel highlights (web
/// <c>analytics.most_efficient_vehicle</c>). The web renders <c>fmtInt(toEfficiencyDisplay(efficiency)) +
/// ' ' + efficiencyUnit</c>; because <c>toEfficiencyDisplay</c> is a parent-supplied prop (the Dashboard's
/// unit-settings hook owns the Wh/km → display conversion), this record carries the already-converted
/// display value plus its unit label, keeping the projection pure and faithful to the presentational web
/// source. Pure data — no WinUI types.
/// </summary>
/// <param name="Name">The vehicle display name (web <c>most_efficient_vehicle.name</c>).</param>
/// <param name="EfficiencyDisplay">The efficiency already converted to the user's display unit (web <c>toEfficiencyDisplay(efficiency)</c>).</param>
/// <param name="EfficiencyUnit">The efficiency unit label (web <c>efficiencyUnit</c>, e.g. "Wh/km" or "mi/kWh").</param>
public sealed record RecentActivityMostEfficient(string Name, double EfficiencyDisplay, string EfficiencyUnit);

/// <summary>
/// The fleet analytics the web fleet-performance panel reads (web <c>FleetAnalytics</c> in
/// web/src/features/dashboard/types.ts), narrowed to the four metrics + the most-efficient vehicle the
/// panel renders. <see cref="TotalEnergyKwh"/> is already in kWh (the analytics API field
/// <c>total_energy_kwh</c>); the projection multiplies it by the web's <c>0.42</c> kg-CO₂/kWh factor for the
/// "CO₂ Saved" stat. Pure data — no WinUI types.
/// </summary>
/// <param name="TotalDrives">Total drives in the window (web <c>total_drives ?? 0</c>).</param>
/// <param name="TotalChargingSessions">Total charge sessions (web <c>total_charging_sessions ?? 0</c>).</param>
/// <param name="TotalCost">Total charging cost (web <c>total_cost ?? 0</c>), rendered through the currency formatter.</param>
/// <param name="TotalEnergyKwh">Total energy in kWh (web <c>total_energy_kwh ?? 0</c>); the CO₂ stat is this × 0.42 kg.</param>
/// <param name="MostEfficient">The most-efficient vehicle, or null when the web omits the block.</param>
public sealed record RecentActivityAnalytics(
    long TotalDrives,
    long TotalChargingSessions,
    double TotalCost,
    double TotalEnergyKwh,
    RecentActivityMostEfficient? MostEfficient);

/// <summary>
/// The render-time data model the <c>RecentActivity</c> view binds to — the native analogue of the web
/// component's props (web/src/features/dashboard/components/RecentActivity.tsx: <c>recentDrives</c>,
/// <c>recentCharges</c>, <c>analytics</c>, <c>distanceUnit</c>, plus the parent's fetch flag). The
/// component is presentational; user-facing labels are resolved from the i18n facade by the projection, not
/// passed in. Distance is converted from SI meters using <see cref="DistanceUnit"/> at the render boundary;
/// energy is always shown in kWh; the currency symbol is supplied separately (the web <c>formatCurrency</c>
/// / <c>Currency</c> seam). Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Loading">Whether the parent Dashboard queries are still in flight (the skeleton hand-off).</param>
/// <param name="RecentDrives">The recent drives feeding the activity feed and the battery trend.</param>
/// <param name="RecentCharges">The recent charging sessions feeding the activity feed.</param>
/// <param name="Analytics">The fleet analytics for the performance panel, or null when unavailable.</param>
/// <param name="DistanceUnit">The user's distance display unit (the web <c>distanceUnit</c> prop).</param>
public sealed record RecentActivityModel(
    bool Loading,
    IReadOnlyList<RecentActivityDrive> RecentDrives,
    IReadOnlyList<RecentActivityCharge> RecentCharges,
    RecentActivityAnalytics? Analytics,
    DistanceUnit DistanceUnit)
{
    /// <summary>The initial model: the Dashboard fetch is in flight and no data has arrived yet.</summary>
    public static RecentActivityModel Pending { get; } =
        new(true, Array.Empty<RecentActivityDrive>(), Array.Empty<RecentActivityCharge>(), null, DistanceUnit.Mi);

    /// <summary>A resolved model with no drives, charges or analytics — every panel shows its empty branch.</summary>
    public static RecentActivityModel Empty { get; } =
        new(false, Array.Empty<RecentActivityDrive>(), Array.Empty<RecentActivityCharge>(), null, DistanceUnit.Mi);
}

/// <summary>
/// One projected, render-ready row of the unified activity feed — the native analogue of a single web
/// timeline item (web/src/features/dashboard/components/RecentActivity.tsx). <see cref="Title"/> and
/// <see cref="Subtitle"/> are pre-formatted (already carrying their unit / currency strings so the view
/// never does number math); <see cref="Timestamp"/> drives the relative-time label the native
/// <c>TsTimeline</c> renders (the web <c>formatTimeAgo</c>); <see cref="Kind"/>, <see cref="Glyph"/> and
/// <see cref="Severity"/> select the row icon and accent colour; and <see cref="AutomationName"/> is the
/// spoken "<c>{title}. {subtitle}</c>". Pure data.
/// </summary>
public sealed record RecentActivityItem(
    string Title,
    string Subtitle,
    DateTimeOffset Timestamp,
    RecentActivityKind Kind,
    string Glyph,
    string Severity,
    string AutomationName);

/// <summary>
/// One projected point of the battery-trend area chart — the native analogue of a single web
/// <c>batteryTrend</c> entry (<c>{ i, v }</c> built from each recent drive's <c>end_soc_pct ?? 50</c>, then
/// reversed so the oldest drive is leftmost). <see cref="Index"/> is the ordinal x-position and
/// <see cref="Soc"/> is the end state-of-charge percent. Pure data.
/// </summary>
public sealed record RecentActivityTrendPoint(int Index, double Soc);

/// <summary>
/// One projected fleet-performance stat row — the native analogue of a single label/value row in the web
/// fleet-performance panel. <see cref="Value"/> is pre-formatted (grouped integer, currency, or
/// "<c>{n} kg</c>") so the view never does number math; <see cref="AutomationName"/> is the spoken
/// "<c>{label}: {value}</c>". Pure data.
/// </summary>
public sealed record RecentActivityStat(string Label, string Value, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the surface for one input model — the native analogue of what
/// the web <c>RecentActivity</c> renders. Holds the active <see cref="State"/>, the three panel headers and
/// their decorative glyphs, the capped + time-sorted activity <see cref="Items"/> (and the activity empty
/// copy), the reversed battery <see cref="BatteryTrend"/> points (and the battery empty copy + spoken
/// summary), the four fleet <see cref="Stats"/>, the optional most-efficient block, the loading copy, and
/// the surface <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record RecentActivityDisplay(
    RecentActivityState State,
    string ActivityTitle,
    string ActivityGlyph,
    string ViewAllLabel,
    IReadOnlyList<RecentActivityItem> Items,
    string ActivityEmptyMessage,
    string BatteryTitle,
    string BatteryGlyph,
    IReadOnlyList<RecentActivityTrendPoint> BatteryTrend,
    string BatterySeriesLabel,
    string BatteryEmptyMessage,
    string BatteryChartSummary,
    string PerfTitle,
    string PerfGlyph,
    IReadOnlyList<RecentActivityStat> Stats,
    RecentActivityMostEfficient? MostEfficient,
    string MostEfficientLabel,
    string MostEfficientValue,
    string LoadingLabel,
    string AutomationName)
{
    /// <summary>True when the activity feed has at least one row (otherwise the friendly empty note shows).</summary>
    public bool HasActivity => Items.Count > 0;

    /// <summary>True when the battery trend has more than one point (web <c>batteryTrend.length &gt; 1</c>).</summary>
    public bool HasBatteryTrend => BatteryTrend.Count > 1;

    /// <summary>True when the most-efficient block renders (web <c>analytics?.most_efficient_vehicle &amp;&amp; …</c>).</summary>
    public bool HasMostEfficient => MostEfficient is not null;
}

/// <summary>
/// Pure projection from a <see cref="RecentActivityModel"/> to its <see cref="RecentActivityDisplay"/> — the
/// native port of web/src/features/dashboard/components/RecentActivity.tsx. It merges drives + charges into
/// one time-sorted feed capped at eight rows (web <c>activityItems.sort(…).slice(0, 8)</c>), builds the
/// reversed battery trend from each drive's end SoC (web <c>map(… end_soc_pct ?? 50).reverse()</c>),
/// formats the four fleet stats with the web's exact precisions and unit suffixes (<c>fmtInt</c> drives /
/// sessions, the currency total, and <c>fmtInt(total_energy_kwh × 0.42) + ' kg'</c> CO₂), and resolves the
/// optional most-efficient block. Distance is converted from SI through <see cref="UnitConverters"/>
/// (the web <c>convertDistanceFromSI</c>), energy through the same converter to kWh, and every non-finite
/// input is coerced to zero (the web <c>safeNumber</c> guard inside <c>fmtNumber</c>). Every label resolves
/// through the i18n facade. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class RecentActivityProjection
{
    /// <summary>Decorative activity glyph (Segoe Fluent; web <c>Activity</c>).</summary>
    public const string ActivityGlyph = "\uE9D2";

    /// <summary>Decorative drive glyph (Segoe Fluent — Car; the native mapping of the web <c>Route</c> icon).</summary>
    public const string DriveGlyph = "\uE804";

    /// <summary>Decorative charge glyph (Segoe Fluent — LightningBolt; web <c>Zap</c>).</summary>
    public const string ChargeGlyph = "\uE945";

    /// <summary>Decorative clock glyph (Segoe Fluent; web <c>Clock</c> in the activity empty state).</summary>
    public const string ClockGlyph = "\uE823";

    /// <summary>Decorative battery-charging glyph (Segoe Fluent; web <c>BatteryCharging</c>).</summary>
    public const string BatteryGlyph = "\uE83F";

    /// <summary>Decorative trending-up glyph (Segoe Fluent; web <c>TrendingUp</c>).</summary>
    public const string TrendingUpGlyph = "\uE9D2";

    /// <summary>The drive feed-row accent severity (web cyan <c>#00f0ff</c> → the native info accent).</summary>
    public const string DriveSeverity = "info";

    /// <summary>The charge feed-row accent severity (web green <c>#10b981</c> → the native success accent).</summary>
    public const string ChargeSeverity = "success";

    /// <summary>Maximum activity rows shown (web <c>activityItems.slice(0, 8)</c>).</summary>
    public const int MaxItems = 8;

    /// <summary>The end-SoC the web substitutes when a drive has none, for the battery trend (web <c>?? 50</c>).</summary>
    public const double DefaultTrendSoc = 50;

    /// <summary>kg of CO₂ saved per kWh — the web's fleet-performance <c>* 0.42</c> factor.</summary>
    public const double Co2KgPerKwh = 0.42;

    private const string Dot = " \u00B7 ";   // web " · " separator
    private const string Arrow = " \u2192 "; // web " → " between SoCs
    private const string Unknown = "?";       // web `?? '?'`

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade + currency.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="currencySymbol">The active currency symbol (the <c>useFormatting</c> seam; defaults to <c>$</c>).</param>
    public static RecentActivityDisplay Project(
        RecentActivityModel model,
        ILocalizer localizer,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string currency = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        RecentActivityState state = model.Loading ? RecentActivityState.Loading : RecentActivityState.Ready;

        string activityTitle = localizer.GetString("translation.activity.title", "Recent Activity");
        string viewAll = localizer.GetString("translation.activity.viewAll", "View all");
        string activityEmpty = localizer.GetString("translation.activity.empty", "No activity yet. Start driving!");
        // The dashboard's "battery.title" / "battery.empty" collide in the flattened native catalog with the
        // battery-health page's keys ("Battery Health" / "No battery health data available yet."), so the
        // RecentActivity battery-trend strings use dashboard-scoped keys to preserve web parity.
        string batteryTitle = localizer.GetString("translation.dashboard.batteryTrend.title", "Battery Trend");
        string batteryEmpty = localizer.GetString("translation.dashboard.batteryTrend.empty", "Charge data will appear here");
        string batterySeries = localizer.GetString("translation.dashboard.batteryTrend.series", "Battery %");
        string perfTitle = localizer.GetString("translation.perf.title", "Fleet Performance");
        string mostEfficientLabel = localizer.GetString("translation.perf.mostEfficient", "Most Efficient");
        string loadingLabel = localizer.GetString("translation.common.loading", "Loading");

        IReadOnlyList<RecentActivityItem> items = BuildItems(model, localizer, currency);
        IReadOnlyList<RecentActivityTrendPoint> trend = BuildTrend(model.RecentDrives);
        string trendSummary = BuildTrendSummary(batteryTitle, trend, batteryEmpty);
        IReadOnlyList<RecentActivityStat> stats = BuildStats(model.Analytics, localizer, currency);

        RecentActivityMostEfficient? mostEfficient = NormalizeMostEfficient(model.Analytics?.MostEfficient);
        string mostEfficientValue = mostEfficient is null
            ? string.Empty
            : NumberFormatting.Format(Safe(mostEfficient.EfficiencyDisplay), null, 0) + " " + mostEfficient.EfficiencyUnit;

        string automationName = BuildAutomationName(
            state, activityTitle, items, activityEmpty, batteryTitle, trend, batteryEmpty,
            perfTitle, stats, mostEfficient, mostEfficientLabel, mostEfficientValue, loadingLabel);

        return new RecentActivityDisplay(
            State: state,
            ActivityTitle: activityTitle,
            ActivityGlyph: ActivityGlyph,
            ViewAllLabel: viewAll,
            Items: items,
            ActivityEmptyMessage: activityEmpty,
            BatteryTitle: batteryTitle,
            BatteryGlyph: BatteryGlyph,
            BatteryTrend: trend,
            BatterySeriesLabel: batterySeries,
            BatteryEmptyMessage: batteryEmpty,
            BatteryChartSummary: trendSummary,
            PerfTitle: perfTitle,
            PerfGlyph: TrendingUpGlyph,
            Stats: stats,
            MostEfficient: mostEfficient,
            MostEfficientLabel: mostEfficientLabel,
            MostEfficientValue: mostEfficientValue,
            LoadingLabel: loadingLabel,
            AutomationName: automationName);
    }

    // ── Unified activity feed: drives + charges, time-sorted desc, capped at 8 (web parity) ──────────────
    private static List<RecentActivityItem> BuildItems(
        RecentActivityModel model,
        ILocalizer localizer,
        string currency)
    {
        string driveWord = localizer.GetString("translation.activity.drive", "drive");
        string chargedWord = localizer.GetString("translation.activity.charged", "charged");
        string distanceUnit = UnitLabels.Label(model.DistanceUnit);

        var items = new List<RecentActivityItem>();

        if (model.RecentDrives is { } drives)
        {
            foreach (var d in drives)
            {
                if (d is null)
                {
                    continue;
                }

                double distance = UnitConverters.DistanceFromSi(Safe(d.DistanceM), model.DistanceUnit);
                // web: `${fmtNumber(distance, 1)} ${distanceUnit} ${t('activity.drive')}`
                string title = NumberFormatting.Format(distance, null, 1) + " " + distanceUnit + " " + driveWord;
                string subtitle = DurationText(Safe(d.DurationS)) + Dot + SocSpan(d.StartSocPct, d.EndSocPct);
                items.Add(Item(title, subtitle, d.StartedAt, RecentActivityKind.Drive));
            }
        }

        if (model.RecentCharges is { } charges)
        {
            foreach (var s in charges)
            {
                if (s is null)
                {
                    continue;
                }

                double kwh = UnitConverters.EnergyFromSi(Safe(s.EnergyAddedWh), EnergyUnit.Kwh);
                // web: `${fmtNumber(kwh, 1)} kWh ${t('activity.charged')}`
                string title = NumberFormatting.Format(kwh, null, 1) + " kWh " + chargedWord;
                string subtitle = SocSpan(s.StartSocPct, s.EndSocPct);
                if (s.Cost is { } cost && double.IsFinite(cost))
                {
                    subtitle += Dot + currency + NumberFormatting.Format(cost, null, 2);
                }

                items.Add(Item(title, subtitle, s.StartedAt, RecentActivityKind.Charge));
            }
        }

        // web: activityItems.sort((a, b) => b.time - a.time).slice(0, 8)
        items.Sort((a, b) => b.Timestamp.CompareTo(a.Timestamp));
        if (items.Count > MaxItems)
        {
            items.RemoveRange(MaxItems, items.Count - MaxItems);
        }

        return items;
    }

    private static RecentActivityItem Item(string title, string subtitle, DateTimeOffset time, RecentActivityKind kind)
    {
        string glyph = kind == RecentActivityKind.Drive ? DriveGlyph : ChargeGlyph;
        string severity = kind == RecentActivityKind.Drive ? DriveSeverity : ChargeSeverity;
        string automation = string.IsNullOrEmpty(subtitle) ? title : title + ". " + subtitle;
        return new RecentActivityItem(title, subtitle, time, kind, glyph, severity, automation);
    }

    // web: `${Math.floor(s/3600)}h ${fmtInt(Math.floor((s%3600)/60))}m`
    private static string DurationText(double seconds)
    {
        long hours = (long)Math.Floor(seconds / 3600);
        long minutes = (long)Math.Floor((seconds % 3600) / 60);
        return hours.ToString(CultureInfo.InvariantCulture) + "h " + NumberFormatting.Format(minutes, null, 0) + "m";
    }

    // web: `${start ?? '?'}% → ${end ?? '?'}%`
    private static string SocSpan(double? start, double? end) =>
        Soc(start) + "%" + Arrow + Soc(end) + "%";

    private static string Soc(double? value) =>
        value is { } v && double.IsFinite(v) ? NumberFormatting.Format(v, null, 0) : Unknown;

    // ── Battery trend: each drive's end SoC (?? 50), reversed so the oldest drive is leftmost (web parity) ─
    private static IReadOnlyList<RecentActivityTrendPoint> BuildTrend(IReadOnlyList<RecentActivityDrive>? drives)
    {
        if (drives is null || drives.Count == 0)
        {
            return Array.Empty<RecentActivityTrendPoint>();
        }

        var socs = new List<double>(drives.Count);
        foreach (var d in drives)
        {
            if (d is null)
            {
                continue;
            }

            socs.Add(d.EndSocPct is { } v && double.IsFinite(v) ? v : DefaultTrendSoc);
        }

        var points = new List<RecentActivityTrendPoint>(socs.Count);
        for (int i = 0; i < socs.Count; i++)
        {
            // reverse: the last drive collected becomes index 0 (web `.reverse()`).
            points.Add(new RecentActivityTrendPoint(i, socs[socs.Count - 1 - i]));
        }

        return points;
    }

    private static string BuildTrendSummary(
        string title,
        IReadOnlyList<RecentActivityTrendPoint> trend,
        string emptyMessage)
    {
        if (trend.Count <= 1)
        {
            return title + ": " + emptyMessage;
        }

        var parts = new List<string>(trend.Count);
        foreach (var point in trend)
        {
            parts.Add(NumberFormatting.Format(point.Soc, null, 0) + "%");
        }

        return title + ": " + string.Join(", ", parts);
    }

    // ── Fleet performance: drives, charge sessions, total cost, CO₂ saved (web order + formatting) ────────
    private static RecentActivityStat[] BuildStats(
        RecentActivityAnalytics? analytics,
        ILocalizer localizer,
        string currency)
    {
        long drives = analytics?.TotalDrives ?? 0;
        long sessions = analytics?.TotalChargingSessions ?? 0;
        double cost = Safe(analytics?.TotalCost ?? 0);
        double energyKwh = Safe(analytics?.TotalEnergyKwh ?? 0);

        var totalDrives = Stat(
            localizer.GetString("translation.perf.drives", "Total Drives (30d)"),
            NumberFormatting.Format(drives, null, 0));

        var chargeSessions = Stat(
            localizer.GetString("translation.perf.charges", "Charge Sessions"),
            NumberFormatting.Format(sessions, null, 0));

        var totalCost = Stat(
            localizer.GetString("translation.perf.cost", "Total Cost"),
            currency + NumberFormatting.Format(cost, null, 2));

        // web: `${fmtInt((total_energy_kwh ?? 0) * 0.42)} kg`
        var co2 = Stat(
            localizer.GetString("translation.perf.co2", "CO\u2082 Saved"),
            NumberFormatting.Format(energyKwh * Co2KgPerKwh, null, 0) + " kg");

        return new[] { totalDrives, chargeSessions, totalCost, co2 };
    }

    private static RecentActivityStat Stat(string label, string value) => new(label, value, $"{label}: {value}");

    private static RecentActivityMostEfficient? NormalizeMostEfficient(RecentActivityMostEfficient? source)
    {
        if (source is null)
        {
            return null;
        }

        return new RecentActivityMostEfficient(
            source.Name ?? string.Empty,
            Safe(source.EfficiencyDisplay),
            source.EfficiencyUnit ?? string.Empty);
    }

    private static string BuildAutomationName(
        RecentActivityState state,
        string activityTitle,
        IReadOnlyList<RecentActivityItem> items,
        string activityEmpty,
        string batteryTitle,
        IReadOnlyList<RecentActivityTrendPoint> trend,
        string batteryEmpty,
        string perfTitle,
        IReadOnlyList<RecentActivityStat> stats,
        RecentActivityMostEfficient? mostEfficient,
        string mostEfficientLabel,
        string mostEfficientValue,
        string loadingLabel)
    {
        if (state == RecentActivityState.Loading)
        {
            return loadingLabel;
        }

        var builder = new StringBuilder();
        builder.Append(activityTitle);
        builder.Append(items.Count > 0 ? $": {items.Count}" : $": {activityEmpty}");

        builder.Append(CultureInfo.CurrentCulture, $". {batteryTitle}");
        builder.Append(trend.Count > 1 ? string.Empty : $": {batteryEmpty}");

        builder.Append(CultureInfo.CurrentCulture, $". {perfTitle}");
        foreach (var stat in stats)
        {
            builder.Append(CultureInfo.CurrentCulture, $". {stat.Label} {stat.Value}");
        }

        if (mostEfficient is not null)
        {
            builder.Append(CultureInfo.CurrentCulture, $". {mostEfficientLabel} {mostEfficient.Name} {mostEfficientValue}");
        }

        return builder.ToString();
    }

    // The web safeNumber() guard inside fmtNumber: a non-finite value formats as 0 rather than "NaN"/"∞".
    private static double Safe(double value) => double.IsFinite(value) ? value : 0;
}

/// <summary>
/// PII-safe diagnostics for the <c>RecentActivity</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a drive distance, SoC, charge energy,
/// cost or vehicle name — so a diagnostics line can never leak a user's driving / charging behaviour.
/// Thread-safe.
/// </summary>
public sealed class RecentActivityDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public RecentActivityDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RecentActivity</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RecentActivityRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>RecentActivity</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/dashboard/components/RecentActivity.tsx</c>.
/// </summary>
public static class RecentActivityRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "RecentActivity";
}
