using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// One projected fleet-summary stat tile — the native analogue of a web <c>&lt;MetricCard&gt;</c>. Holds the
/// localized <see cref="Label"/>, the resolved Segoe Fluent <see cref="Glyph"/>, the accent
/// <see cref="AccentBrushKey"/> (a design-token brush key, never a literal hex), the count-up <see cref="Value"/>
/// target with its <see cref="Precision"/> and unit <see cref="Suffix"/> (the web <c>AnimatedNumber</c>), the
/// optional muted <see cref="TrailingText"/> (the web "/ {onlineCount}" span) and the composed Narrator
/// <see cref="AutomationName"/>. Pure data.
/// </summary>
/// <param name="Key">Stable tile id used by the view + tests (e.g. <c>total-vehicles</c>).</param>
/// <param name="Label">The localized tile label.</param>
/// <param name="Glyph">The Segoe Fluent glyph standing in for the web Lucide icon.</param>
/// <param name="AccentBrushKey">The accent brush resource key (theme-aware token, never a literal hex).</param>
/// <param name="Value">The count-up target (web <c>AnimatedNumber value</c>).</param>
/// <param name="Precision">The count-up fraction digits.</param>
/// <param name="Suffix">The unit suffix appended after the number (web <c>AnimatedNumber suffix</c>).</param>
/// <param name="TrailingText">The muted trailing text (web "/ {onlineCount}"), or null.</param>
/// <param name="AutomationName">The composed Narrator name (label + value).</param>
public sealed record VehicleListMetricTile(
    string Key,
    string Label,
    string Glyph,
    string AccentBrushKey,
    double Value,
    int Precision,
    string Suffix,
    string? TrailingText,
    string AutomationName);

/// <summary>
/// One projected row in the Fleet Battery Status panel — the native analogue of a web battery bar row (the
/// vehicle name, the state-of-charge bar + percent and the rated range). Pure, pre-formatted data.
/// </summary>
/// <param name="VehicleId">The vehicle id (stable row key).</param>
/// <param name="Name">The vehicle name (web <c>display_name || vin</c>).</param>
/// <param name="Level">The state-of-charge percent the bar sweeps to.</param>
/// <param name="LevelText">The formatted percent, e.g. <c>"72%"</c> (web <c>{level}%</c>).</param>
/// <param name="RangeText">The formatted rated range, e.g. <c>"410.0 km"</c> (web <c>formatDistance(rated_range)</c>).</param>
/// <param name="BatteryBrushKey">The token brush key the bar fills with (web <c>batteryColor(level)</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the row.</param>
public sealed record VehicleListBatteryRow(
    long VehicleId,
    string Name,
    double Level,
    string LevelText,
    string RangeText,
    string BatteryBrushKey,
    string AutomationName);

/// <summary>
/// One projected vehicle card (the web <c>GlassPanel</c> list item). Holds the header identity + status, the
/// battery group, the live stat strings (range / odometer / charge power), the lock / Sentry flags, the detail
/// route and the composed Narrator name. The live fields are present only when the vehicle is awake
/// (<see cref="HasState"/>); the actions are always shown. Pure, pre-formatted data.
/// </summary>
/// <param name="Id">The vehicle id (scopes the pin toggle + detail link + delete).</param>
/// <param name="Name">The header name (web <c>display_name || vin</c>).</param>
/// <param name="Subtitle">The model / trim / VIN subtitle (web <c>{model} {trim} · {vin}</c>).</param>
/// <param name="ModelTrim">The model + trim portion of the subtitle (may be empty).</param>
/// <param name="Vin">The VIN portion of the subtitle (rendered monospace, web <c>font-mono</c>).</param>
/// <param name="Status">The raw derived status string (web <c>deriveVehicleStatus(state)</c>).</param>
/// <param name="StatusText">The capitalized status used in the badge + spoken name.</param>
/// <param name="StatusKind">The semantic badge status (web <c>statusVariant(status)</c>).</param>
/// <param name="Level">The battery percent the bar sweeps to (web <c>battery_level ?? 0</c>).</param>
/// <param name="LevelText">The formatted battery percent, e.g. <c>"72%"</c>.</param>
/// <param name="BatteryBrushKey">The token brush key the battery bar fills with.</param>
/// <param name="HasState">True when live state resolved — render the stats row (web <c>{state &amp;&amp; …}</c>).</param>
/// <param name="RangeText">The formatted rated range (web <c>formatDistance(rated_range)</c>), or null when asleep.</param>
/// <param name="OdometerText">The formatted odometer (web <c>formatDistance(odometer)</c>), or null when asleep.</param>
/// <param name="ChargerPowerText">The formatted charge power "<c>{kW} kW</c>" when charging, otherwise null.</param>
/// <param name="IsLocked">True when the locked flag glyph shows (web <c>state.is_locked</c>).</param>
/// <param name="SentryMode">True when the Sentry flag glyph shows (web <c>state.sentry_mode</c>).</param>
/// <param name="DetailRoute">The in-app detail route (web <c>/vehicles/{id}</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the whole card.</param>
public sealed record VehicleListVehicleRow(
    long Id,
    string Name,
    string Subtitle,
    string ModelTrim,
    string Vin,
    string Status,
    string StatusText,
    TeslaSync.App.Core.StatusKind StatusKind,
    double Level,
    string LevelText,
    string BatteryBrushKey,
    bool HasState,
    string? RangeText,
    string? OdometerText,
    string? ChargerPowerText,
    bool IsLocked,
    bool SentryMode,
    string DetailRoute,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Vehicle-list page for one roster + lifecycle state — the four
/// fleet-summary tiles, the Fleet Battery Status rows (+ avg), the ordered (pinned-first) vehicle cards and
/// every localized label the view needs (titles, section headings, empty / no-data / error copy). Pure data so
/// the projection is unit-tested without a UI host.
/// </summary>
public sealed record VehicleListDisplay(
    VehicleListState State,
    string Title,
    string Subtitle,
    IReadOnlyList<VehicleListMetricTile> Metrics,
    double AvgBatteryRounded,
    string BatteryStatusTitle,
    string AvgLabel,
    string AllVehiclesTitle,
    IReadOnlyList<VehicleListBatteryRow> BatteryRows,
    IReadOnlyList<VehicleListVehicleRow> VehicleRows,
    string EmptyTitle,
    string EmptyMessage,
    string NoDataMessage,
    string LoadErrorMessage,
    string SyncButtonLabel)
{
    /// <summary>The empty display (no roster) — the loading / empty / error fallback with resolved labels.</summary>
    /// <param name="state">The lifecycle state to stamp.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>An empty display carrying the resolved labels.</returns>
    public static VehicleListDisplay Empty(VehicleListState state, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new VehicleListDisplay(
            State: state,
            Title: localizer.GetString(VehicleListPageRegistration.NavVehiclesKey, VehicleListPageRegistration.NavVehiclesFallback),
            Subtitle: localizer.GetString(VehicleListPageRegistration.SubtitleKey, VehicleListPageRegistration.SubtitleFallback),
            Metrics: Array.Empty<VehicleListMetricTile>(),
            AvgBatteryRounded: 0,
            BatteryStatusTitle: localizer.GetString(VehicleListPageRegistration.BatteryStatusKey, VehicleListPageRegistration.BatteryStatusFallback),
            AvgLabel: localizer.GetString(VehicleListPageRegistration.AvgLabelKey, VehicleListPageRegistration.AvgLabelFallback),
            AllVehiclesTitle: localizer.GetString(VehicleListPageRegistration.AllVehiclesKey, VehicleListPageRegistration.AllVehiclesFallback),
            BatteryRows: Array.Empty<VehicleListBatteryRow>(),
            VehicleRows: Array.Empty<VehicleListVehicleRow>(),
            EmptyTitle: localizer.GetString(VehicleListPageRegistration.EmptyTitleKey, VehicleListPageRegistration.EmptyTitleFallback),
            EmptyMessage: localizer.GetString(VehicleListPageRegistration.EmptyMessageKey, VehicleListPageRegistration.EmptyMessageFallback),
            NoDataMessage: localizer.GetString(VehicleListPageRegistration.NoDataKey, VehicleListPageRegistration.NoDataFallback),
            LoadErrorMessage: localizer.GetString(VehicleListPageRegistration.LoadErrorKey, VehicleListPageRegistration.LoadErrorFallback),
            SyncButtonLabel: localizer.GetString(VehicleListPageRegistration.SyncButtonKey, VehicleListPageRegistration.SyncButtonFallback));
    }
}

/// <summary>
/// Pure projection from a <see cref="VehicleListReading"/> + lifecycle <see cref="VehicleListState"/> to its
/// render-ready <see cref="VehicleListDisplay"/> — the native port of
/// web/src/features/vehicles/pages/VehicleListPage.tsx. It reproduces the four fleet-summary tiles (Total
/// Vehicles, Avg Battery, Total Range with the unit appended to the label, Charging / Online with the muted "/
/// online" trailing), the Fleet Battery Status rows (the resolved-state vehicles, each with a battery bar +
/// percent + range and the avg), and the pinned-first vehicle cards (name + status badge + subtitle + battery +
/// the live stats row + lock / Sentry flags). SI metres convert to the user's distance unit only here (web
/// <c>useUnits</c>) via the WinUI-free <see cref="UnitConverters"/> / <see cref="UnitFormatters"/>; every number
/// formats through <see cref="ScalarFormatters"/> and every label resolves through the i18n facade. No WinUI
/// types — unit-tested headless.
/// </summary>
public static class VehicleListProjection
{
    private const string OnlineTrailingLeadIn = "/ ";

    /// <summary>Project <paramref name="reading"/> in <paramref name="state"/> into a render-ready display.</summary>
    /// <param name="reading">The resolved roster (the web roster + states + pins).</param>
    /// <param name="state">The lifecycle state to stamp.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits().unitPrefs</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display.</returns>
    public static VehicleListDisplay Project(
        VehicleListReading reading,
        VehicleListState state,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        if (state is VehicleListState.Loading or VehicleListState.Error)
        {
            return VehicleListDisplay.Empty(state, localizer);
        }

        if (state == VehicleListState.Empty || reading.VehicleCount == 0)
        {
            return VehicleListDisplay.Empty(VehicleListState.Empty, localizer);
        }

        var metrics = BuildMetrics(reading, units, localizer);
        var batteryRows = BuildBatteryRows(reading, units);
        var vehicleRows = BuildVehicleRows(reading, units, localizer);

        return new VehicleListDisplay(
            State: VehicleListState.Success,
            Title: localizer.GetString(VehicleListPageRegistration.NavVehiclesKey, VehicleListPageRegistration.NavVehiclesFallback),
            Subtitle: localizer.GetString(VehicleListPageRegistration.SubtitleKey, VehicleListPageRegistration.SubtitleFallback),
            Metrics: metrics,
            AvgBatteryRounded: Math.Round(reading.AvgBatteryPercent, MidpointRounding.AwayFromZero),
            BatteryStatusTitle: localizer.GetString(VehicleListPageRegistration.BatteryStatusKey, VehicleListPageRegistration.BatteryStatusFallback),
            AvgLabel: localizer.GetString(VehicleListPageRegistration.AvgLabelKey, VehicleListPageRegistration.AvgLabelFallback),
            AllVehiclesTitle: localizer.GetString(VehicleListPageRegistration.AllVehiclesKey, VehicleListPageRegistration.AllVehiclesFallback),
            BatteryRows: batteryRows,
            VehicleRows: vehicleRows,
            EmptyTitle: localizer.GetString(VehicleListPageRegistration.EmptyTitleKey, VehicleListPageRegistration.EmptyTitleFallback),
            EmptyMessage: localizer.GetString(VehicleListPageRegistration.EmptyMessageKey, VehicleListPageRegistration.EmptyMessageFallback),
            NoDataMessage: localizer.GetString(VehicleListPageRegistration.NoDataKey, VehicleListPageRegistration.NoDataFallback),
            LoadErrorMessage: localizer.GetString(VehicleListPageRegistration.LoadErrorKey, VehicleListPageRegistration.LoadErrorFallback),
            SyncButtonLabel: localizer.GetString(VehicleListPageRegistration.SyncButtonKey, VehicleListPageRegistration.SyncButtonFallback));
    }

    /// <summary>
    /// Order the roster pinned-first — a 1:1 port of the web <c>sortedVehicleList</c> memo: vehicles whose id
    /// appears in the pin map sort by ascending pin position ahead of the unpinned vehicles, and the relative
    /// order is otherwise stable. An empty pin set returns the roster unchanged.
    /// </summary>
    /// <param name="entries">The roster entries in wire order.</param>
    /// <param name="pins">The pin records (web <c>vehiclePins</c>).</param>
    /// <returns>The pinned-first ordered roster.</returns>
    public static IReadOnlyList<VehicleListEntry> SortByPins(
        IReadOnlyList<VehicleListEntry> entries,
        IReadOnlyList<VehicleListPin> pins)
    {
        ArgumentNullException.ThrowIfNull(entries);
        ArgumentNullException.ThrowIfNull(pins);

        if (pins.Count == 0)
        {
            return entries;
        }

        var order = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var pin in pins)
        {
            order[pin.ItemId] = pin.Position;
        }

        // Stable sort: index keeps the original order when neither (or both equal) are pinned.
        return entries
            .Select((entry, index) => (entry, index))
            .OrderBy(t =>
            {
                string id = t.entry.Vehicle.Id.ToString(CultureInfo.InvariantCulture);
                return order.TryGetValue(id, out int position) ? position : int.MaxValue;
            })
            .ThenBy(static t => t.index)
            .Select(static t => t.entry)
            .ToList();
    }

    private static List<VehicleListMetricTile> BuildMetrics(VehicleListReading reading, UnitPref units, ILocalizer localizer)
    {
        string distanceUnit = UnitLabels.Label(units.Distance);
        double avgBattery = Math.Round(reading.AvgBatteryPercent, MidpointRounding.AwayFromZero);
        double totalRange = Math.Round(
            UnitConverters.DistanceFromSi(reading.TotalRangeMeters, units.Distance),
            MidpointRounding.AwayFromZero);

        return new List<VehicleListMetricTile>(4)
        {
            // web <MetricCard label="Total Vehicles" value={vehicleList.length} icon={<Car/>} color="cyan" />.
            BuildTile(
                "total-vehicles",
                localizer.GetString(VehicleListPageRegistration.TotalVehiclesKey, VehicleListPageRegistration.TotalVehiclesFallback),
                VehicleListPageRegistration.CarGlyph,
                VehicleListPageRegistration.VehiclesColor,
                reading.VehicleCount,
                suffix: string.Empty,
                trailing: null),

            // web <MetricCard label="Avg Battery" value={`${fmtNumber(avgBattery)}%`} icon={<Battery/>} color="green" />.
            BuildTile(
                "avg-battery",
                localizer.GetString(VehicleListPageRegistration.AvgBatteryKey, VehicleListPageRegistration.AvgBatteryFallback),
                VehicleListPageRegistration.BatteryGlyph,
                VehicleListPageRegistration.AvgBatteryColor,
                avgBattery,
                suffix: VehicleListPageRegistration.PercentSuffix,
                trailing: null),

            // web <MetricCard label={`${t('vehicles.totalRange')} (${unit})`} value={round(convertDistanceFromSI(...))} color="purple" />.
            BuildTile(
                "total-range",
                string.Create(
                    CultureInfo.CurrentCulture,
                    $"{localizer.GetString(VehicleListPageRegistration.TotalRangeKey, VehicleListPageRegistration.TotalRangeFallback)} ({distanceUnit})"),
                VehicleListPageRegistration.GaugeGlyph,
                VehicleListPageRegistration.TotalRangeColor,
                totalRange,
                suffix: string.Empty,
                trailing: null),

            // web <MetricCard label="Charging / Online" value={`${chargingCount} / ${onlineCount}`} icon={<Zap/>} color="green" />.
            BuildTile(
                "charging-online",
                localizer.GetString(VehicleListPageRegistration.ChargingOnlineKey, VehicleListPageRegistration.ChargingOnlineFallback),
                VehicleListPageRegistration.ZapGlyph,
                VehicleListPageRegistration.ChargingOnlineColor,
                reading.ChargingCount,
                suffix: string.Empty,
                trailing: OnlineTrailingLeadIn + ScalarFormatters.FormatNumber(reading.OnlineCount)),
        };
    }

    private static VehicleListMetricTile BuildTile(
        string key,
        string label,
        string glyph,
        string accentBrushKey,
        double value,
        string suffix,
        string? trailing)
    {
        string valueText = ScalarFormatters.FormatNumber(value) + suffix;
        string spoken = trailing is null
            ? string.Create(CultureInfo.CurrentCulture, $"{label}: {valueText}")
            : string.Create(CultureInfo.CurrentCulture, $"{label}: {valueText} {trailing}");

        return new VehicleListMetricTile(
            key,
            label,
            glyph,
            accentBrushKey,
            value,
            Precision: 0,
            suffix,
            trailing,
            AutomationName: spoken);
    }

    private static List<VehicleListBatteryRow> BuildBatteryRows(VehicleListReading reading, UnitPref units)
    {
        var rows = new List<VehicleListBatteryRow>();
        foreach (var entry in reading.ResolvedEntries)
        {
            var state = entry.State!;
            double level = state.BatteryLevel ?? 0;
            string levelText = string.Create(CultureInfo.CurrentCulture, $"{(int)level}%");
            string rangeText = UnitFormatters.FormatDistance(state.RatedRangeMeters ?? 0, units);
            rows.Add(new VehicleListBatteryRow(
                VehicleId: entry.Vehicle.Id,
                Name: entry.Vehicle.Name,
                Level: level,
                LevelText: levelText,
                RangeText: rangeText,
                BatteryBrushKey: VehicleListStatus.BatteryBrushKey(level),
                AutomationName: string.Create(CultureInfo.CurrentCulture, $"{entry.Vehicle.Name}: {levelText} \u00B7 {rangeText}")));
        }

        return rows;
    }

    private static List<VehicleListVehicleRow> BuildVehicleRows(VehicleListReading reading, UnitPref units, ILocalizer localizer)
    {
        var ordered = SortByPins(reading.Entries, reading.Pins);
        var rows = new List<VehicleListVehicleRow>(ordered.Count);

        foreach (var entry in ordered)
        {
            var vehicle = entry.Vehicle;
            var state = entry.State;
            string status = VehicleListStatus.DeriveStatus(state);
            string statusText = VehicleListStatus.DisplayText(status);
            double level = state?.BatteryLevel ?? 0;

            string? rangeText = state is null ? null : UnitFormatters.FormatDistance(state.RatedRangeMeters ?? 0, units);
            string? odometerText = state is null ? null : UnitFormatters.FormatDistance(state.OdometerMeters ?? 0, units);
            string? chargerPowerText = state is { IsCharging: true }
                ? string.Create(CultureInfo.CurrentCulture, $"{ScalarFormatters.FormatNumber(state.ChargerPowerKw ?? 0)} kW")
                : null;

            string subtitle = string.Join(
                " \u00B7 ",
                new[] { vehicle.ModelTrim, vehicle.Vin }.Where(static p => !string.IsNullOrWhiteSpace(p)));

            rows.Add(new VehicleListVehicleRow(
                Id: vehicle.Id,
                Name: vehicle.Name,
                Subtitle: subtitle,
                ModelTrim: vehicle.ModelTrim,
                Vin: vehicle.Vin,
                Status: status,
                StatusText: statusText,
                StatusKind: VehicleListStatus.StatusKindFor(status),
                Level: level,
                LevelText: string.Create(CultureInfo.CurrentCulture, $"{(int)level}%"),
                BatteryBrushKey: VehicleListStatus.BatteryBrushKey(level),
                HasState: state is not null,
                RangeText: rangeText,
                OdometerText: odometerText,
                ChargerPowerText: chargerPowerText,
                IsLocked: state?.IsLocked ?? false,
                SentryMode: state?.SentryMode ?? false,
                DetailRoute: string.Create(CultureInfo.InvariantCulture, $"/vehicles/{vehicle.Id}"),
                AutomationName: BuildCardName(vehicle.Name, statusText, subtitle)));
        }

        return rows;
    }

    private static string BuildCardName(string name, string statusText, string subtitle)
    {
        string spoken = string.IsNullOrWhiteSpace(statusText)
            ? name
            : string.Create(CultureInfo.CurrentCulture, $"{name}, {statusText}");
        return string.IsNullOrWhiteSpace(subtitle)
            ? spoken
            : string.Create(CultureInfo.CurrentCulture, $"{spoken}. {subtitle}");
    }
}
