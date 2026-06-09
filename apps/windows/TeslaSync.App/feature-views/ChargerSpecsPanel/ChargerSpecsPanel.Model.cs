using System.Globalization;
using System.Text;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>ChargerSpecsPanel</c> surface — the native union of the
/// states the web component renders
/// (web/src/features/charging/components/charging-list/ChargerSpecsPanel.tsx). The web source is a pure
/// presentational panel (it takes a <c>specs: ChargerSpecsData | null</c> prop and performs no fetching), so
/// the branches are a direct function of the input <see cref="ChargerSpecsPanelModel"/> — there is no
/// fetch-driven error / stale / offline branch to reproduce in THIS surface. The parent charging-list
/// experience owns the query lifecycle (loading / error / stale / offline are handled once for the whole page
/// before the breakdown is computed), exactly as the web list page only renders the panel once its sessions
/// query has resolved. Every branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum ChargerSpecsState
{
    /// <summary>The parent has not produced the breakdown yet (sessions query in flight) — skeleton chrome.</summary>
    Loading,

    /// <summary>
    /// Resolved with no usable breakdown — the web <c>!hasData</c> branch (a null <c>specs</c>, or one whose
    /// voltage, cable and brand groups are all empty) — the friendly empty surface.
    /// </summary>
    Empty,

    /// <summary>At least one of voltage / cable / brand has rows (web <c>hasData</c>) — the four-column grid.</summary>
    Ready,
}

/// <summary>
/// One charger-spec group entry — the native analogue of a single web <c>SpecEntry</c>
/// (<c>{ name, count, energy, avgPower? }</c>). Values are SI as the backend stores them: <see cref="EnergyWh"/>
/// is watt-hours and <see cref="AvgPowerW"/> is the mean peak power in watts (the web prop carries these already
/// converted to kWh / kW by <c>computeChargerSpecs</c>; the native architecture defers that conversion to the
/// display boundary in <see cref="ChargerSpecsPanelProjection"/>). <see cref="AvgPowerW"/> is null when the
/// group has no power signal (the web <c>avgPower === undefined</c>), in which case the row falls back to the
/// energy readout. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Name">The group label exactly as the backend supplies it (charger brand, cable type, …).</param>
/// <param name="Count">Number of charge sessions in this group.</param>
/// <param name="EnergyWh">Total energy added across the group, SI watt-hours.</param>
/// <param name="AvgPowerW">Mean peak power for the group in SI watts, or null when no power signal exists.</param>
public sealed record ChargerSpecsEntry(string Name, long Count, double EnergyWh, double? AvgPowerW);

/// <summary>
/// The render-time data model the <c>ChargerSpecsPanel</c> view binds to — the native analogue of the web
/// component's <c>specs: ChargerSpecsData | null</c> prop, plus the <see cref="Loading"/> flag the parent
/// supplies (the web panel itself has no loading prop; the parent list page owns that). A null web <c>specs</c>
/// and a <c>specs</c> whose groups are all empty both collapse to the same empty surface, so both are modelled
/// here as empty group lists. The component is presentational; user-facing labels are resolved from the i18n
/// facade by the projection, not passed in. Pure data — no WinUI types.
/// </summary>
/// <param name="Loading">True while the parent is still producing the breakdown (sessions query in flight).</param>
/// <param name="Voltage">The "By Voltage" group rows.</param>
/// <param name="Phase">The "By Phase" group rows.</param>
/// <param name="Cable">The "By Cable" group rows.</param>
/// <param name="Brand">The "By Brand" group rows (the only column that surfaces average power).</param>
public sealed record ChargerSpecsPanelModel(
    bool Loading,
    IReadOnlyList<ChargerSpecsEntry> Voltage,
    IReadOnlyList<ChargerSpecsEntry> Phase,
    IReadOnlyList<ChargerSpecsEntry> Cable,
    IReadOnlyList<ChargerSpecsEntry> Brand)
{
    /// <summary>The initial model: the parent is still producing the breakdown and no groups have arrived.</summary>
    public static ChargerSpecsPanelModel Pending { get; } = new(true, [], [], [], []);

    /// <summary>A resolved model with no breakdown groups — the empty surface (web null / all-empty specs).</summary>
    public static ChargerSpecsPanelModel Empty { get; } = new(false, [], [], [], []);
}

/// <summary>
/// One projected, render-ready breakdown row — the native analogue of a single web column entry
/// (<c>&lt;span&gt;{v.name}&lt;/span&gt;</c> plus the "<c>{count} sessions · {detail}</c>" meta line).
/// <see cref="Name"/> is the group label; <see cref="Meta"/> is the fully composed, unit-converted meta line;
/// <see cref="AutomationName"/> is the spoken "<c>{name}: {meta}</c>". Pure data.
/// </summary>
public sealed record ChargerSpecsRow(string Name, string Meta, string AutomationName);

/// <summary>
/// One projected, render-ready breakdown column — the native analogue of a web <c>SpecColumn</c>. Carries the
/// decorative <see cref="Glyph"/>, the localized <see cref="Label"/>, whether it <see cref="HasItems"/> (web
/// <c>items.length &gt; 0</c>), the <see cref="EmptyMessage"/> shown when it does not, the projected
/// <see cref="Rows"/>, and a spoken <see cref="AutomationName"/>. Pure data.
/// </summary>
public sealed record ChargerSpecsColumn(
    string Glyph,
    string Label,
    bool HasItems,
    string EmptyMessage,
    IReadOnlyList<ChargerSpecsRow> Rows,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the panel for one input model — the native analogue of what the
/// web <c>ChargerSpecsPanel</c> renders. Holds the active <see cref="State"/>, the localized <see cref="Title"/>,
/// the decorative <see cref="HeaderGlyph"/>, the four <see cref="Columns"/> (always built so the grid and the
/// loading skeleton share a column count), the overall <see cref="EmptyMessage"/>, the <see cref="LoadingLabel"/>,
/// and the surface <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record ChargerSpecsPanelDisplay(
    ChargerSpecsState State,
    string Title,
    string HeaderGlyph,
    IReadOnlyList<ChargerSpecsColumn> Columns,
    string EmptyMessage,
    string LoadingLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="ChargerSpecsPanelModel"/> to its <see cref="ChargerSpecsPanelDisplay"/> —
/// the native port of web/src/features/charging/components/charging-list/ChargerSpecsPanel.tsx. The branch
/// precedence mirrors the web source's lifecycle (loading → empty → ready); the
/// <see cref="ChargerSpecsPanelModel.Phase"/> group is intentionally excluded from the <see cref="HasData"/>
/// test to reproduce the web <c>hasData</c> expression
/// (<c>specs &amp;&amp; (voltage.length || cable.length || brand.length)</c>) bug-for-bug. Each row's energy is
/// formatted through <see cref="UnitFormatters.FormatEnergy"/> pinned to kWh and its average power through
/// <see cref="UnitFormatters.FormatPower"/> pinned to kW — the web hard-codes those units (energy/power have no
/// user toggle), so the display preference is honoured only for locale and precision. The session count is
/// rendered ungrouped, matching the web's raw <c>{v.count}</c>. Every label resolves through the i18n facade
/// using the same keys the web source feeds into <c>t(...)</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ChargerSpecsPanelProjection
{
    /// <summary>Segoe Fluent — Speedometer / gauge (web Lucide <c>Gauge</c>), the panel's header glyph.</summary>
    public const string HeaderGlyph = "\uE950";

    /// <summary>Segoe Fluent — LightningBolt (web Lucide <c>Zap</c>), the voltage column glyph.</summary>
    public const string VoltageGlyph = "\uE945";

    /// <summary>Segoe Fluent — Health / pulse (web Lucide <c>Activity</c>), the phase column glyph.</summary>
    public const string PhaseGlyph = "\uE9D2";

    /// <summary>Segoe Fluent — USB connector (web Lucide <c>Cable</c>), the cable column glyph.</summary>
    public const string CableGlyph = "\uE88E";

    /// <summary>Segoe Fluent — Plug (web Lucide <c>Plug</c>), the brand column glyph.</summary>
    public const string BrandGlyph = "\uE7E8";

    private const string MiddleDot = "\u00B7"; // web "·" separator
    private const int PowerPrecision = 0; // web fmtInt(avgPower)

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade and units.</summary>
    /// <param name="model">The render-time data model (the web prop, plus the parent's loading flag).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's display preference (used for locale + precision; energy/power are pinned).</param>
    public static ChargerSpecsPanelDisplay Project(
        ChargerSpecsPanelModel model,
        ILocalizer localizer,
        UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(units);

        string title = localizer.GetString("charging.specs.title", "Charger Specs Breakdown");
        string emptyMessage = localizer.GetString("charging.specs.noData", "No charger specification data available yet");
        string loadingLabel = localizer.GetString("common.loading", "Loading...");
        string sessionsWord = localizer.GetString("sessions", "sessions");
        string avgWord = localizer.GetString("avg", "avg");

        var columns = new[]
        {
            BuildColumn(VoltageGlyph, "charging.specs.byVoltage", "By Voltage", "charging.specs.noVoltage", "No voltage data", model.Voltage, false, localizer, units, sessionsWord, avgWord),
            BuildColumn(PhaseGlyph, "charging.specs.byPhase", "By Phase", "charging.specs.noPhase", "No phase data", model.Phase, false, localizer, units, sessionsWord, avgWord),
            BuildColumn(CableGlyph, "charging.specs.byCable", "By Cable", "charging.specs.noCable", "No cable data", model.Cable, false, localizer, units, sessionsWord, avgWord),
            BuildColumn(BrandGlyph, "charging.specs.byBrand", "By Brand", "charging.specs.noBrand", "No brand data", model.Brand, true, localizer, units, sessionsWord, avgWord),
        };

        ChargerSpecsState state = SelectState(model);

        return new ChargerSpecsPanelDisplay(
            State: state,
            Title: title,
            HeaderGlyph: HeaderGlyph,
            Columns: columns,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            AutomationName: BuildAutomationName(state, title, emptyMessage, loadingLabel, columns));
    }

    /// <summary>
    /// The web <c>hasData</c> expression — <c>specs &amp;&amp; (voltage.length || cable.length || brand.length)</c>.
    /// The phase group is intentionally NOT part of this test (web parity): a breakdown that only has phase rows
    /// still collapses to the overall empty surface.
    /// </summary>
    public static bool HasData(ChargerSpecsPanelModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        return model.Voltage.Count > 0 || model.Cable.Count > 0 || model.Brand.Count > 0;
    }

    /// <summary>Branch precedence from the web source's lifecycle: loading → empty → ready.</summary>
    private static ChargerSpecsState SelectState(ChargerSpecsPanelModel model)
    {
        if (model.Loading)
        {
            return ChargerSpecsState.Loading;
        }

        return HasData(model) ? ChargerSpecsState.Ready : ChargerSpecsState.Empty;
    }

    private static ChargerSpecsColumn BuildColumn(
        string glyph,
        string labelKey,
        string labelFallback,
        string emptyKey,
        string emptyFallback,
        IReadOnlyList<ChargerSpecsEntry> items,
        bool showAvgPower,
        ILocalizer localizer,
        UnitPref units,
        string sessionsWord,
        string avgWord)
    {
        string label = localizer.GetString(labelKey, labelFallback);
        string emptyMessage = localizer.GetString(emptyKey, emptyFallback);

        if (items.Count == 0)
        {
            // Web parity: an empty group renders its own <EmptyState>, never a blank cell.
            return new ChargerSpecsColumn(
                glyph,
                label,
                HasItems: false,
                emptyMessage,
                Array.Empty<ChargerSpecsRow>(),
                AutomationName: $"{label}. {emptyMessage}");
        }

        var rows = new List<ChargerSpecsRow>(items.Count);
        foreach (ChargerSpecsEntry item in items)
        {
            string meta = BuildMeta(item, showAvgPower, units, sessionsWord, avgWord);
            rows.Add(new ChargerSpecsRow(item.Name, meta, $"{item.Name}: {meta}"));
        }

        return new ChargerSpecsColumn(
            glyph,
            label,
            HasItems: true,
            emptyMessage,
            rows,
            AutomationName: BuildColumnAutomationName(label, rows));
    }

    // Web: `{v.count} sessions · {showAvgPower && v.avgPower != null ? `${fmtInt(v.avgPower)} kW avg`
    // : fmtWithUnit(v.energy, 'kWh')}`. The count is rendered raw (no grouping); energy is pinned to kWh at the
    // web global precision; average power is pinned to kW at zero decimals (fmtInt). Energy is always finite in
    // the model, so the unit formatter's em-dash fallback for non-finite input is never reached here.
    private static string BuildMeta(
        ChargerSpecsEntry item,
        bool showAvgPower,
        UnitPref units,
        string sessionsWord,
        string avgWord)
    {
        string detail = showAvgPower && item.AvgPowerW is { } watts
            ? $"{UnitFormatters.FormatPower(watts, units with { Power = PowerUnit.Kw }, PowerPrecision)} {avgWord}"
            : FormatGroupEnergy(item.EnergyWh, units);

        string count = item.Count.ToString(CultureInfo.InvariantCulture);
        return $"{count} {sessionsWord} {MiddleDot} {detail}";
    }

    // Web fmtWithUnit(energy, 'kWh') uses the global decimal precision (default 2). The unit-pref Precision is
    // that global analogue: forward it when set, otherwise let the energy formatter apply its own 2-dp default.
    private static string FormatGroupEnergy(double energyWh, UnitPref units)
    {
        UnitPref kwh = units with { Energy = EnergyUnit.Kwh };
        int? precision = units.Precision is { } p and >= 0 ? p : null;
        return UnitFormatters.FormatEnergy(energyWh, kwh, precision);
    }

    private static string BuildColumnAutomationName(string label, IReadOnlyList<ChargerSpecsRow> rows)
    {
        var builder = new StringBuilder(label);
        foreach (ChargerSpecsRow row in rows)
        {
            builder.Append(". ").Append(row.AutomationName);
        }

        return builder.ToString();
    }

    private static string BuildAutomationName(
        ChargerSpecsState state,
        string title,
        string emptyMessage,
        string loadingLabel,
        IReadOnlyList<ChargerSpecsColumn> columns) => state switch
        {
            ChargerSpecsState.Loading => loadingLabel,
            ChargerSpecsState.Empty => $"{title}. {emptyMessage}",
            _ => BuildReadyAutomationName(title, columns),
        };

    private static string BuildReadyAutomationName(string title, IReadOnlyList<ChargerSpecsColumn> columns)
    {
        var builder = new StringBuilder(title);
        foreach (ChargerSpecsColumn column in columns)
        {
            if (column.HasItems)
            {
                builder.Append(". ").Append(column.Label);
            }
        }

        return builder.ToString();
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>ChargerSpecsPanel</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a session count, energy figure or charger
/// name — so a diagnostics line can never leak a user's charging behaviour. Thread-safe.
/// </summary>
public sealed class ChargerSpecsPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChargerSpecsPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChargerSpecsPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChargerSpecsPanelRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>ChargerSpecsPanel</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/charging/components/charging-list/ChargerSpecsPanel.tsx</c>.
/// </summary>
public static class ChargerSpecsPanelRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ChargerSpecsPanel";
}
