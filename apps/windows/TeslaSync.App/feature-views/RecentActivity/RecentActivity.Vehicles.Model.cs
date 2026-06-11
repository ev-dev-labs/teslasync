using System.Collections.Generic;
using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// The mutually-exclusive render branch of the vehicle-detail <c>RecentActivity</c> surface — the native union
/// of the states the web component participates in (web/src/features/vehicles/components/RecentActivity.tsx).
/// The web source is a pure presentational child of the vehicle-detail page: it takes the <c>drives</c> /
/// <c>sessions</c> props (plus the user's unit context) and performs no fetching, so the branch is a direct
/// function of the input <see cref="RecentActivityModel"/>. The parent page owns the query lifecycle (it shows
/// a page-level skeleton / error / empty surface before mounting this section), so this leaf reproduces that
/// loading hand-off as a parent-supplied <see cref="RecentActivityModel.Loading"/> flag and otherwise renders
/// the web's two-panel composition. There is therefore no fetch-driven error / stale / offline branch to
/// reproduce inside this surface — those are owned by the parent page exactly as in the web source. Emptiness
/// is per-panel (web parity): the recent-drives and recent-charges panels each show a friendly empty note
/// instead of a blank box. No branch is ever hidden.
/// </summary>
public enum RecentActivityState
{
    /// <summary>The parent page's queries have not resolved yet (still fetching) — skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved — the web fall-through: the recent-drives panel beside the recent-charges panel.</summary>
    Ready,
}

/// <summary>
/// Which kind of activity a panel / row represents — the native union of the two columns the web renders
/// (web/src/features/vehicles/components/RecentActivity.tsx): recent drives (the web <c>Route</c> icon + cyan
/// accent) or recent charging sessions (the web <c>BatteryCharging</c> / <c>Zap</c> icons + green accent).
/// UI-free so the projection is unit-tested without a XAML runtime.
/// </summary>
public enum RecentActivityKind
{
    /// <summary>A recent drive — web Route icon, cyan (<c>text-cyan-300</c>) accent, links to <c>/drives</c>.</summary>
    Drive,

    /// <summary>A recent charge — web Zap icon, emerald (<c>text-emerald-300</c>) accent, links to <c>/charging</c>.</summary>
    Charge,
}

/// <summary>
/// One recent drive the web list reads (web <c>Drive</c> in web/src/api/types.ts), narrowed to the fields
/// <c>RecentActivity</c> actually consumes. SI on the wire — meters and seconds — so the projection converts to
/// the user's display unit at the render boundary exactly as the web <c>convertDistanceFromSI</c> does. Pure
/// data — no WinUI types.
/// </summary>
/// <param name="Id">The drive id (web <c>d.id</c>) used as the row key and the <c>/drives/{id}</c> link target.</param>
/// <param name="DistanceM">Distance travelled in SI meters (web <c>distance_m ?? 0</c>).</param>
/// <param name="DurationS">Drive duration in SI seconds (web <c>duration_s</c>).</param>
/// <param name="StartSocPct">Start state-of-charge percent, or null (web <c>start_soc_pct</c>).</param>
/// <param name="EndSocPct">End state-of-charge percent, or null (web <c>end_soc_pct</c>); the span shows only when both are present.</param>
/// <param name="StartedAt">The drive start instant (web <c>d.start_ts</c>) shown as the relative time.</param>
public sealed record RecentActivityDrive(
    long Id,
    double DistanceM,
    double DurationS,
    double? StartSocPct,
    double? EndSocPct,
    DateTimeOffset StartedAt);

/// <summary>
/// One recent charging session the web list reads (web <c>ChargingSession</c> in web/src/api/types.ts),
/// narrowed to the fields <c>RecentActivity</c> consumes. SI on the wire — watt-hours and seconds — so the
/// projection converts energy to kWh at the render boundary exactly as the web
/// <c>convertEnergyFromSI(_, 'kWh')</c> does, and the duration is held in seconds (the web reads the legacy
/// <c>duration_min</c>; the SI-canonical seconds produce the identical <c>{h}h {m}m</c> display). Pure data —
/// no WinUI types.
/// </summary>
/// <param name="Id">The session id (web <c>s.id</c>) used as the row key and the <c>/charging/{id}</c> link target.</param>
/// <param name="EnergyAddedWh">Energy added in SI watt-hours (web <c>total_energy_added_wh</c>).</param>
/// <param name="DurationS">Session duration in SI seconds (the web <c>duration_min</c> × 60).</param>
/// <param name="StartSocPct">Start state-of-charge percent, or null (web <c>start_soc_pct</c>).</param>
/// <param name="EndSocPct">End state-of-charge percent, or null (web <c>end_soc_pct</c>); the span shows only when it is present.</param>
/// <param name="StartedAt">The session start instant (web <c>s.start_ts</c>) shown as the relative time.</param>
public sealed record RecentActivityCharge(
    long Id,
    double EnergyAddedWh,
    double DurationS,
    double? StartSocPct,
    double? EndSocPct,
    DateTimeOffset StartedAt);

/// <summary>
/// The render-time data model the <c>RecentActivity</c> view binds to — the native analogue of the web
/// component's props (web/src/features/vehicles/components/RecentActivity.tsx: <c>drives</c>, <c>sessions</c>,
/// plus the <c>useUnits</c> distance preference and the parent's fetch flag). The component is presentational;
/// user-facing labels are resolved from the i18n facade by the projection, not passed in. Distance is
/// converted from SI meters using <see cref="DistanceUnit"/> at the render boundary; energy is always shown in
/// kWh. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Loading">Whether the parent page's queries are still in flight (the skeleton hand-off).</param>
/// <param name="Drives">The recent drives feeding the recent-drives panel.</param>
/// <param name="Charges">The recent charging sessions feeding the recent-charges panel.</param>
/// <param name="DistanceUnit">The user's distance display unit (the web <c>unitPrefs.distance</c>).</param>
public sealed record RecentActivityModel(
    bool Loading,
    IReadOnlyList<RecentActivityDrive> Drives,
    IReadOnlyList<RecentActivityCharge> Charges,
    DistanceUnit DistanceUnit)
{
    /// <summary>The initial model: the parent fetch is in flight and no data has arrived yet.</summary>
    public static RecentActivityModel Pending { get; } =
        new(true, Array.Empty<RecentActivityDrive>(), Array.Empty<RecentActivityCharge>(), DistanceUnit.Mi);

    /// <summary>A resolved model with no drives or charges — both panels show their empty branch.</summary>
    public static RecentActivityModel Empty { get; } =
        new(false, Array.Empty<RecentActivityDrive>(), Array.Empty<RecentActivityCharge>(), DistanceUnit.Mi);
}

/// <summary>
/// One projected, render-ready list row — the native analogue of a single web <c>&lt;Link&gt;</c> item
/// (web/src/features/vehicles/components/RecentActivity.tsx). <see cref="Value"/> / <see cref="ValuePrecision"/>
/// / <see cref="ValueSuffix"/> drive the count-up <c>AnimatedNumber</c> (already converted from SI to the
/// display unit / kWh); <see cref="ValueText"/> is the same figure pre-formatted for the spoken name and tests;
/// <see cref="Timestamp"/> drives the relative-time label; <see cref="Duration"/> is the <c>{h}h {m}m</c>
/// <c>InlineMetric</c> value; <see cref="SocSpan"/> is the optional "<c>{start}% → {end}%</c>"; and
/// <see cref="AutomationName"/> is the spoken row summary. Pure data.
/// </summary>
public sealed record RecentActivityRow(
    long Id,
    double Value,
    int ValuePrecision,
    string ValueSuffix,
    string ValueText,
    DateTimeOffset Timestamp,
    string Duration,
    string? SocSpan,
    string AutomationName);

/// <summary>
/// One fully projected panel — the native analogue of a single web <c>GlassPanel</c>
/// (web/src/features/vehicles/components/RecentActivity.tsx). Holds the localized <see cref="Title"/>, the
/// decorative header / row glyphs, the accent severity, the "View all" affordance label + route target, the
/// capped <see cref="Rows"/> (web <c>slice(0, 5)</c>), the friendly <see cref="EmptyMessage"/>, and the spoken
/// <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record RecentActivityPanel(
    RecentActivityKind Kind,
    string Title,
    string HeaderGlyph,
    string RowGlyph,
    string Accent,
    string ViewAllLabel,
    string ViewAllTarget,
    IReadOnlyList<RecentActivityRow> Rows,
    string EmptyMessage,
    string AutomationName)
{
    /// <summary>True when the panel has at least one row (otherwise the friendly empty note shows).</summary>
    public bool HasRows => Rows.Count > 0;
}

/// <summary>
/// The fully projected, render-ready view of the surface for one input model — the native analogue of what the
/// web vehicle-detail <c>RecentActivity</c> renders. Holds the active <see cref="State"/>, the
/// <see cref="Drives"/> and <see cref="Charges"/> panels, the loading copy and the surface
/// <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record RecentActivityDisplay(
    RecentActivityState State,
    RecentActivityPanel Drives,
    RecentActivityPanel Charges,
    string LoadingLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="RecentActivityModel"/> to its <see cref="RecentActivityDisplay"/> — the
/// native port of web/src/features/vehicles/components/RecentActivity.tsx. It builds the recent-drives panel
/// (distance converted from SI through <see cref="UnitConverters"/> at one decimal with the display-unit
/// suffix, the <c>{h}h {m}m</c> duration, and the "<c>{start}% → {end}%</c>" span shown only when both SoCs are
/// present) and the recent-charges panel (energy converted to kWh at one decimal, the same duration, and the
/// span shown when the end SoC is present), each capped at five rows in input order (web <c>slice(0, 5)</c>).
/// Every non-finite input is coerced to zero (the web <c>?? 0</c> / <c>safeNumber</c> guard) and every label
/// resolves through the i18n facade. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class RecentActivityProjection
{
    /// <summary>Decorative drives-panel + drive-row glyph (Segoe Fluent — Car; the native mapping of the web <c>Route</c> icon).</summary>
    public const string RouteGlyph = "\uE804";

    /// <summary>Decorative charge-row glyph (Segoe Fluent — LightningBolt; web <c>Zap</c>).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Decorative charges-panel header glyph (Segoe Fluent — BatteryCharging; web <c>BatteryCharging</c>).</summary>
    public const string BatteryChargingGlyph = "\uE83F";

    /// <summary>Decorative duration glyph (Segoe Fluent — Clock; the web <c>InlineMetric</c> <c>Clock</c> icon).</summary>
    public const string ClockGlyph = "\uE823";

    /// <summary>Decorative "View all" chevron glyph (Segoe Fluent — ChevronRight; web <c>ChevronRight</c>).</summary>
    public const string ChevronGlyph = "\uE76C";

    /// <summary>The drives accent severity (web cyan <c>text-cyan-300</c> → the native info accent).</summary>
    public const string DriveAccent = "info";

    /// <summary>The charges accent severity (web emerald <c>text-emerald-300</c> → the native success accent).</summary>
    public const string ChargeAccent = "success";

    /// <summary>Maximum rows shown per panel (web <c>drives.slice(0, 5)</c> / <c>sessions.slice(0, 5)</c>).</summary>
    public const int MaxRows = 5;

    /// <summary>The drives "View all" route target (web <c>&lt;Link to="/drives"&gt;</c>).</summary>
    public const string DrivesTarget = "/drives";

    /// <summary>The charges "View all" route target (web <c>&lt;Link to="/charging"&gt;</c>).</summary>
    public const string ChargesTarget = "/charging";

    private const string Arrow = " \u2192 "; // web " → " between SoCs
    private const string Unknown = "?";       // defensive fallback for a missing SoC

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    public static RecentActivityDisplay Project(RecentActivityModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        RecentActivityState state = model.Loading ? RecentActivityState.Loading : RecentActivityState.Ready;

        string viewAll = localizer.GetString("translation.common.viewAll", "View all");
        string loadingLabel = localizer.GetString("translation.common.loading", "Loading");

        RecentActivityPanel drives = BuildDrivesPanel(model, localizer, viewAll);
        RecentActivityPanel charges = BuildChargesPanel(model, localizer, viewAll);

        string automationName = state == RecentActivityState.Loading
            ? loadingLabel
            : drives.AutomationName + ". " + charges.AutomationName;

        return new RecentActivityDisplay(state, drives, charges, loadingLabel, automationName);
    }

    // web: the Recent Drives GlassPanel — header (Route + title + "View all") over up to five drive links / empty note.
    private static RecentActivityPanel BuildDrivesPanel(RecentActivityModel model, ILocalizer localizer, string viewAll)
    {
        string title = localizer.GetString("translation.common.recentDrives", "Recent Drives");
        string empty = localizer.GetString("translation.common.noDrives", "No drives recorded yet");
        string unitLabel = UnitLabels.Label(model.DistanceUnit);
        string suffix = " " + unitLabel;

        var rows = new List<RecentActivityRow>();
        if (model.Drives is { } drives)
        {
            foreach (RecentActivityDrive d in drives)
            {
                if (d is null)
                {
                    continue;
                }

                // web: convertDistanceFromSI(d.distance_m ?? 0, unitPrefs.distance), decimals 1, suffix ` ${unit}`.
                double value = UnitConverters.DistanceFromSi(Safe(d.DistanceM), model.DistanceUnit);
                string valueText = NumberFormatting.Format(value, null, 1) + suffix;
                string duration = DurationText(Safe(d.DurationS));
                // web: start_soc_pct != null && end_soc_pct != null.
                string? soc = IsFinite(d.StartSocPct) && IsFinite(d.EndSocPct) ? SocSpan(d.StartSocPct, d.EndSocPct) : null;

                rows.Add(new RecentActivityRow(
                    d.Id, value, 1, suffix, valueText, d.StartedAt, duration, soc, RowAutomation(valueText, duration, soc)));

                if (rows.Count == MaxRows)
                {
                    break;
                }
            }
        }

        return new RecentActivityPanel(
            RecentActivityKind.Drive, title, RouteGlyph, RouteGlyph, DriveAccent,
            viewAll, DrivesTarget, rows, empty, PanelAutomation(title, rows.Count, empty));
    }

    // web: the Recent Charges GlassPanel — header (BatteryCharging + title + "View all") over up to five charge links / empty note.
    private static RecentActivityPanel BuildChargesPanel(RecentActivityModel model, ILocalizer localizer, string viewAll)
    {
        string title = localizer.GetString("translation.common.recentCharges", "Recent Charges");
        string empty = localizer.GetString("translation.common.noCharges", "No charging sessions recorded yet");

        var rows = new List<RecentActivityRow>();
        if (model.Charges is { } charges)
        {
            foreach (RecentActivityCharge s in charges)
            {
                if (s is null)
                {
                    continue;
                }

                // web: convertEnergyFromSI(s.total_energy_added_wh, 'kWh'), decimals 1, suffix " kWh".
                double value = UnitConverters.EnergyFromSi(Safe(s.EnergyAddedWh), EnergyUnit.Kwh);
                string valueText = NumberFormatting.Format(value, null, 1) + " kWh";
                string duration = DurationText(Safe(s.DurationS));
                // web: s.end_soc_pct != null.
                string? soc = IsFinite(s.EndSocPct) ? SocSpan(s.StartSocPct, s.EndSocPct) : null;

                rows.Add(new RecentActivityRow(
                    s.Id, value, 1, " kWh", valueText, s.StartedAt, duration, soc, RowAutomation(valueText, duration, soc)));

                if (rows.Count == MaxRows)
                {
                    break;
                }
            }
        }

        return new RecentActivityPanel(
            RecentActivityKind.Charge, title, BatteryChargingGlyph, ZapGlyph, ChargeAccent,
            viewAll, ChargesTarget, rows, empty, PanelAutomation(title, rows.Count, empty));
    }

    // web: `${Math.floor(s / 3600)}h ${fmtInt(Math.floor((s % 3600) / 60))}m`
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
        IsFinite(value) ? NumberFormatting.Format(value!.Value, null, 0) : Unknown;

    private static string RowAutomation(string valueText, string duration, string? soc) =>
        soc is null ? valueText + ", " + duration : valueText + ", " + duration + ", " + soc;

    private static string PanelAutomation(string title, int count, string empty) =>
        count > 0
            ? title + ": " + count.ToString(CultureInfo.InvariantCulture)
            : title + ": " + empty;

    private static bool IsFinite(double? value) => value is { } v && double.IsFinite(v);

    // The web safeNumber() guard: a non-finite value formats as 0 rather than "NaN" / "∞".
    private static double Safe(double value) => double.IsFinite(value) ? value : 0;
}

/// <summary>
/// PII-safe diagnostics for the vehicle-detail <c>RecentActivity</c> surface (P1/S11 diagnostics contract).
/// Records only the operational <c>view.opened</c> event with the surface slug — never a drive distance, SoC,
/// charge energy or session id — so a diagnostics line can never leak a user's driving / charging behaviour.
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
/// Canonical metadata for the vehicle-detail <c>RecentActivity</c> feature surface — the native mirror of the
/// web component at <c>web/src/features/vehicles/components/RecentActivity.tsx</c>.
/// </summary>
public static class RecentActivityRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "RecentActivity";
}
