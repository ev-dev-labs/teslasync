using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="MoreDetailsPanelViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. The web component
/// (web/src/features/driving/components/drive-detail/MoreDetailsPanel.tsx) is purely presentational: it
/// receives a resolved <c>drive</c> + computed <c>stats</c> as props and only renders the two metric grids.
/// The native feature-view owns its own per-drive read (web <c>useDrive</c> → <c>useDriveDetailData</c>), so
/// the loading / error / stale / offline branches are that query lifecycle reproduced as visible surfaces —
/// none is ever hidden. <see cref="Empty"/> mirrors the parent page's <c>hasMeaningfulDriveStats</c> gate (a
/// drive with no distance, no energy and no telemetry rows), not an empty HTTP body.
/// </summary>
public enum MoreDetailsState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying meaningful drive metrics.</summary>
    Loaded,

    /// <summary>The drive resolved but carries no meaningful metrics — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The fully reduced, unit-independent SI snapshot of a single drive the surface consumes — the native
/// analogue of the <c>drive</c> aggregate plus the slice of the <c>DriveStats</c> object computed by
/// web/src/features/driving/components/drive-detail/useDriveDetailData.ts that
/// <c>MoreDetailsPanel.tsx</c> actually reads. Every distance is metres, every speed metres-per-second,
/// every temperature Celsius, energy watt-hours and power kilowatts (telemetry <c>power</c> is already
/// kW on the wire). Display-unit conversion happens only at projection time (web <c>useUnits</c>). The
/// per-row telemetry reductions (elevation gain/loss, min moving speed, mean cabin/ambient temperature,
/// first/last odometer and range) are unit-independent and therefore pre-computed here, exactly mirroring
/// the <c>useDriveDetailData</c> reductions but kept in SI so a unit change never re-parses.
/// </summary>
public sealed record MoreDetailsSnapshot(
    double DistanceM,
    long DurationS,
    double? EnergyUsedWh,
    double? RegenEnergyWh,
    double? AvgPowerW,
    long? StartBatteryPct,
    long? EndBatteryPct,
    int RowCount,
    double SumPowerKw,
    double SumRegenPowerKw,
    double ElevGainM,
    double ElevLossM,
    double? MinSpeedMps,
    double? AvgOutsideTempC,
    double? AvgInsideTempC,
    double? OdometerStartM,
    double? OdometerEndM,
    double? StartRangeM,
    double? EndRangeM)
{
    /// <summary>A no-data snapshot — the parse fallback for an absent / non-object body.</summary>
    public static MoreDetailsSnapshot Empty { get; } = new(
        0, 0, null, null, null, null, null, 0, 0, 0, 0, 0, null, null, null, null, null, null, null);

    /// <summary>
    /// True when the drive carries something worth charting — mirrors the parent page's
    /// <c>hasMeaningfulDriveStats</c> (web/src/features/driving/pages/DriveDetailPage.tsx): a non-zero
    /// distance, a non-zero energy figure, or at least one telemetry / position sample. Gates the empty
    /// state so a freshly-detected drive whose signal_log slice held only gear transitions renders a
    /// friendly empty surface rather than a wall of zeroes.
    /// </summary>
    public bool HasData =>
        DistanceM > 0 || EnergyUsedWh.GetValueOrDefault() > 0 || RowCount > 0;

    /// <summary>
    /// Project a <c>GET /drives/{driveID}</c> JSON object (the web <c>DriveDetail</c>: a Drive aggregate
    /// plus embedded <c>telemetry[]</c> / <c>positions[]</c>) into a tolerant SI snapshot. Parsing is
    /// null-tolerant — a partial / schema-drifted body never throws.
    /// </summary>
    /// <param name="element">The raw drive-detail JSON object (non-objects yield <see cref="Empty"/>).</param>
    /// <returns>The reduced SI snapshot.</returns>
    public static MoreDetailsSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        double distanceM = GetDouble(element, "distance_m", "distanceM") ?? 0;
        long durationS = (long)Math.Round(GetDouble(element, "duration_s", "durationS") ?? 0);
        double? energyUsedWh = GetDouble(element, "energy_used_wh", "energyUsedWh");
        double? regenEnergyWh = GetDouble(element, "regen_energy_wh", "regenEnergyWh");
        double? avgPowerW = GetDouble(element, "avg_power_w", "avgPowerW");
        long? startBatteryPct = GetLong(element, "start_battery_pct", "startBatteryPct");
        long? endBatteryPct = GetLong(element, "end_battery_pct", "endBatteryPct");

        var r = ReduceRows(SelectRows(element));

        return new MoreDetailsSnapshot(
            DistanceM: distanceM,
            DurationS: durationS,
            EnergyUsedWh: energyUsedWh,
            RegenEnergyWh: regenEnergyWh,
            AvgPowerW: avgPowerW,
            StartBatteryPct: startBatteryPct,
            EndBatteryPct: endBatteryPct,
            RowCount: r.RowCount,
            SumPowerKw: r.SumPowerKw,
            SumRegenPowerKw: r.SumRegenPowerKw,
            ElevGainM: r.ElevGainM,
            ElevLossM: r.ElevLossM,
            MinSpeedMps: r.MinSpeedMps,
            AvgOutsideTempC: r.OutsideCount > 0 ? r.OutsideSum / r.OutsideCount : null,
            AvgInsideTempC: r.InsideCount > 0 ? r.InsideSum / r.InsideCount : null,
            OdometerStartM: r.OdometerStartM,
            OdometerEndM: r.OdometerEndM,
            StartRangeM: r.StartRangeM,
            EndRangeM: r.EndRangeM);
    }

    // web useDriveDetailData: prefer the per-second telemetry stream; fall back to the coarser position
    // stream when telemetry is empty. A drive with neither yields an all-zero reduction.
    private static JsonElement.ArrayEnumerator? SelectRows(JsonElement drive)
    {
        if (drive.TryGetProperty("telemetry", out var telemetry) &&
            telemetry.ValueKind == JsonValueKind.Array &&
            telemetry.GetArrayLength() > 0)
        {
            return telemetry.EnumerateArray();
        }

        if (drive.TryGetProperty("positions", out var positions) &&
            positions.ValueKind == JsonValueKind.Array &&
            positions.GetArrayLength() > 0)
        {
            return positions.EnumerateArray();
        }

        return null;
    }

    private static RowReduction ReduceRows(JsonElement.ArrayEnumerator? rows)
    {
        var acc = new RowReduction();
        if (rows is not { } enumerator)
        {
            return acc;
        }

        bool hasPrevElevation = false;
        double prevElevation = 0;

        foreach (var row in enumerator)
        {
            if (row.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            acc.RowCount++;

            // power is already kilowatts on the wire (backend: pack_voltage * pack_current / 1000), sign
            // preserved (positive = motoring, negative = regen).
            double powerKw = GetDouble(row, "power") ?? 0;
            acc.SumPowerKw += powerKw;
            if (powerKw < 0)
            {
                acc.SumRegenPowerKw += Math.Abs(powerKw);
            }

            // elevation gain/loss from consecutive samples (web: missing elevation coerced to 0).
            double elevation = GetDouble(row, "elevation") ?? 0;
            if (hasPrevElevation)
            {
                double diff = elevation - prevElevation;
                if (diff > 0)
                {
                    acc.ElevGainM += diff;
                }
                else if (diff < 0)
                {
                    acc.ElevLossM += -diff;
                }
            }

            prevElevation = elevation;
            hasPrevElevation = true;

            // min *moving* speed (web filters display speed > 0; SI speed > 0 is equivalent).
            double speedMps = GetDouble(row, "speed") ?? 0;
            if (speedMps > 0 && (acc.MinSpeedMps is null || speedMps < acc.MinSpeedMps))
            {
                acc.MinSpeedMps = speedMps;
            }

            if (GetDouble(row, "outside_temp", "outsideTemp") is { } outside)
            {
                acc.OutsideSum += outside;
                acc.OutsideCount++;
            }

            if (GetDouble(row, "inside_temp", "insideTemp") is { } inside)
            {
                acc.InsideSum += inside;
                acc.InsideCount++;
            }

            // odometer: first and last strictly-positive reading (Tesla emits Odometer sparsely).
            if (GetDouble(row, "odometer") is { } odo && odo > 0)
            {
                acc.OdometerStartM ??= odo;
                acc.OdometerEndM = odo;
            }

            // range: first and last sample carrying ideal- or rated-range (ideal preferred).
            double? range = GetDouble(row, "ideal_range", "idealRange") ?? GetDouble(row, "rated_range", "ratedRange");
            if (range is { } rng)
            {
                acc.StartRangeM ??= rng;
                acc.EndRangeM = rng;
            }
        }

        return acc;
    }

    private static double? GetDouble(JsonElement obj, params string[] names)
    {
        foreach (var name in names)
        {
            if (obj.TryGetProperty(name, out var v))
            {
                switch (v.ValueKind)
                {
                    case JsonValueKind.Number when v.TryGetDouble(out var n):
                        return n;
                    case JsonValueKind.String when double.TryParse(
                        v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s):
                        return s;
                }
            }
        }

        return null;
    }

    private static long? GetLong(JsonElement obj, params string[] names)
    {
        var value = GetDouble(obj, names);
        return value is { } v ? (long)Math.Round(v) : null;
    }

    private sealed class RowReduction
    {
        public int RowCount { get; set; }
        public double SumPowerKw { get; set; }
        public double SumRegenPowerKw { get; set; }
        public double ElevGainM { get; set; }
        public double ElevLossM { get; set; }
        public double? MinSpeedMps { get; set; }
        public double OutsideSum { get; set; }
        public int OutsideCount { get; set; }
        public double InsideSum { get; set; }
        public int InsideCount { get; set; }
        public double? OdometerStartM { get; set; }
        public double? OdometerEndM { get; set; }
        public double? StartRangeM { get; set; }
        public double? EndRangeM { get; set; }
    }
}

/// <summary>
/// One projected, display-ready metric tile consumed by the WinUI view — the native analogue of a web
/// centred metric cell. Holds the localized label, the already-formatted primary value (or an em-dash), an
/// optional muted unit suffix (web's trailing <c>&lt;span&gt;</c>), the accent token brush key, the Narrator
/// name and — for the elevation cell alone — an optional second value line (gain ↑ / loss ↓) with its own
/// accent. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Label">Localized cell label.</param>
/// <param name="Value">Formatted primary value, or an em-dash when absent.</param>
/// <param name="Unit">Muted unit suffix shown after the value (empty when the unit is folded into the value).</param>
/// <param name="AccentBrushKey">Token brush key for the primary value's accent.</param>
/// <param name="AutomationName">Narrator name combining label, value(s) and unit.</param>
/// <param name="SecondaryValue">Optional second value line (elevation loss), else null.</param>
/// <param name="SecondaryAccentBrushKey">Accent token brush key for the second line, else null.</param>
public sealed record MoreDetailsTile(
    string Label,
    string Value,
    string Unit,
    string AccentBrushKey,
    string AutomationName,
    string? SecondaryValue = null,
    string? SecondaryAccentBrushKey = null);

/// <summary>
/// The fully projected, render-ready view of the panel — the two metric groups the web renders (a primary
/// six-cell grid and a secondary grid below a divider) plus the <see cref="HasData"/> gate. Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when the drive carries meaningful metrics (gates the empty state).</param>
/// <param name="Primary">The six primary cells (odometer, range, elevation, energy used/recovered, consumption).</param>
/// <param name="Secondary">The secondary cells (avg power, optional temps, min speed, battery used, net).</param>
public sealed record MoreDetailsDisplay(
    bool HasData,
    IReadOnlyList<MoreDetailsTile> Primary,
    IReadOnlyList<MoreDetailsTile> Secondary)
{
    /// <summary>An empty display with no cells — the projection fallback for a no-data snapshot.</summary>
    public static MoreDetailsDisplay Empty { get; } =
        new(false, Array.Empty<MoreDetailsTile>(), Array.Empty<MoreDetailsTile>());
}

/// <summary>
/// Pure projection from a reduced <see cref="MoreDetailsSnapshot"/> to the two display grids — the native
/// port of the inline cell construction + unit conversion in
/// web/src/features/driving/components/drive-detail/MoreDetailsPanel.tsx. SI is converted to the user's
/// display unit here (and only here); the kWh/Wh magnitude switch, the Wh/km↔Wh/mi efficiency factor and
/// the battery-delta arithmetic all mirror the web exactly; every label resolves through the i18n facade
/// and every cell carries a Narrator name. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class MoreDetailsProjection
{
    /// <summary>Display fallback shown when a metric is absent (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Arrow joining the odometer / range start → end values (web <c>'→'</c>).</summary>
    public const string ArrowRight = "\u2192";

    /// <summary>Up arrow prefixing the elevation gain line (web <c>ArrowUpRight</c>).</summary>
    public const string ArrowUp = "\u2191";

    /// <summary>Down arrow prefixing the elevation loss line (web <c>ArrowDownRight</c>).</summary>
    public const string ArrowDown = "\u2193";

    /// <summary>Kilometres per mile: 1 mile = 1.609344 km (web efficiency factor).</summary>
    public const double KmPerMile = 1.609344;

    /// <summary>Energy magnitude above which the value renders in kWh rather than Wh (web threshold).</summary>
    public const double KwhThresholdWh = 1000.0;

    /// <summary>Elevation unit suffix — always metres (web renders raw metres, never converted).</summary>
    public const string MetersLabel = "m";

    // Web color → generated design token brush key (verified present in Tokens.xaml):
    // cyan #00F0FF, green #10B981, amber #F59E0B, purple #A855F7, blue #3B82F6, red #EF4444, secondary #9CA3AF.
    private const string AccentCyan = "TsColorInfoBrush";
    private const string AccentGreen = "TsColorSuccessBrush";
    private const string AccentAmber = "TsColorWarningBrush";
    private const string AccentPurple = "TsChartPowerBrush";
    private const string AccentBlue = "TsChartSpeedBrush";
    private const string AccentRed = "TsColorDangerBrush";
    private const string AccentSecondary = "TsColorTextSecondaryBrush";

    private const int DistancePrecision = 0;
    private const int ElevationPrecision = 0;
    private const int EnergyKwhPrecision = 1;
    private const int EnergyWhPrecision = 0;
    private const int ConsumptionPrecision = 0;
    private const int PowerPrecision = 1;
    private const int TemperaturePrecision = 1;
    private const int SpeedPrecision = 0;

    /// <summary>Project <paramref name="snapshot"/> into the two metric grids using the user's units.</summary>
    /// <param name="snapshot">The reduced SI snapshot.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>).</param>
    /// <param name="localizer">The i18n facade every label flows through.</param>
    /// <returns>The render-ready display model.</returns>
    public static MoreDetailsDisplay Project(MoreDetailsSnapshot snapshot, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var distanceUnit = units.Distance;
        var speedUnit = units.Speed;
        var temperatureUnit = units.Temperature;
        string distanceLabel = UnitLabels.Label(distanceUnit);
        string speedLabel = UnitLabels.Label(speedUnit);
        string temperatureLabel = UnitLabels.Label(temperatureUnit);
        string efficiencyLabel = distanceUnit == DistanceUnit.Mi ? "Wh/mi" : "Wh/km";

        // ── derived energy / power / consumption (web useDriveDetailData, unit-independent) ──
        double durationH = snapshot.DurationS / 3600.0;
        double avgPowerKw = snapshot.AvgPowerW is { } w
            ? w / 1000.0
            : snapshot.RowCount > 0 ? snapshot.SumPowerKw / snapshot.RowCount : 0;
        double energyWh = snapshot.EnergyUsedWh ?? Math.Abs(avgPowerKw) * durationH * 1000.0;
        double regenWh = snapshot.RegenEnergyWh ?? (snapshot.RowCount > 0
            ? snapshot.SumRegenPowerKw * (durationH / snapshot.RowCount) * 1000.0
            : 0);
        double consumptionWhKm = snapshot.DistanceM > 0 ? energyWh / (snapshot.DistanceM / 1000.0) : 0;
        double consumptionDisplay = distanceUnit == DistanceUnit.Mi ? consumptionWhKm * KmPerMile : consumptionWhKm;

        var primary = new List<MoreDetailsTile>(6)
        {
            OdometerTile(snapshot, distanceUnit, distanceLabel, localizer),
            RangeTile(snapshot, distanceUnit, distanceLabel, localizer),
            ElevationTile(snapshot, localizer),
            EnergyTile("driveDetail.energyConsumed", "Energy Consumed", energyWh, AccentAmber, localizer),
            EnergyTile("driveDetail.energyRecovered", "Energy Recovered", regenWh, AccentGreen, localizer),
            ConsumptionTile(consumptionWhKm, consumptionDisplay, efficiencyLabel, localizer),
        };

        var secondary = new List<MoreDetailsTile>(6)
        {
            ValueTile("driveDetail.avgPower", "Avg Power",
                ScalarFormatters.FormatNumber(avgPowerKw, PowerPrecision), "kW", AccentAmber, localizer),
        };

        if (snapshot.AvgOutsideTempC is { } outsideC)
        {
            secondary.Add(ValueTile("driveDetail.avgOutsideTemp", "Avg Outside Temp",
                ScalarFormatters.FormatNumber(UnitConverters.TemperatureFromSi(outsideC, temperatureUnit), TemperaturePrecision),
                temperatureLabel, AccentBlue, localizer));
        }

        if (snapshot.AvgInsideTempC is { } insideC)
        {
            secondary.Add(ValueTile("driveDetail.avgInsideTemp", "Avg Inside Temp",
                ScalarFormatters.FormatNumber(UnitConverters.TemperatureFromSi(insideC, temperatureUnit), TemperaturePrecision),
                temperatureLabel, AccentAmber, localizer));
        }

        double minSpeed = snapshot.MinSpeedMps is { } mps ? UnitConverters.SpeedFromSi(mps, speedUnit) : 0;
        secondary.Add(ValueTile("driveDetail.minSpeed", "Min Speed",
            ScalarFormatters.FormatNumber(minSpeed, SpeedPrecision), speedLabel, AccentSecondary, localizer));

        secondary.Add(BatteryUsedTile(snapshot, localizer));
        secondary.Add(EnergyTile("driveDetail.netEnergy", "Net Consumption", energyWh - regenWh, AccentCyan, localizer));

        return new MoreDetailsDisplay(snapshot.HasData, primary, secondary);
    }

    private static MoreDetailsTile OdometerTile(
        MoreDetailsSnapshot s, DistanceUnit unit, string unitLabel, ILocalizer localizer)
    {
        string label = localizer.GetString("driveDetail.odometer", "Odometer (From \u2192 To)");
        string value = s.OdometerStartM is { } start && s.OdometerEndM is { } end
            ? $"{Distance(start, unit)} {ArrowRight} {Distance(end, unit)}"
            : EmDash;
        return new MoreDetailsTile(label, value, unitLabel, AccentCyan, AutomationName(label, value, unitLabel));
    }

    private static MoreDetailsTile RangeTile(
        MoreDetailsSnapshot s, DistanceUnit unit, string unitLabel, ILocalizer localizer)
    {
        string label = localizer.GetString("driveDetail.rangeStartEnd", "Range (Start \u2192 End)");
        string value;
        if (s.StartRangeM is { } start)
        {
            string end = s.EndRangeM is { } e ? Distance(e, unit) : "?";
            value = $"{Distance(start, unit)} {ArrowRight} {end}";
        }
        else
        {
            value = EmDash;
        }

        return new MoreDetailsTile(label, value, unitLabel, AccentGreen, AutomationName(label, value, unitLabel));
    }

    private static MoreDetailsTile ElevationTile(MoreDetailsSnapshot s, ILocalizer localizer)
    {
        string label = localizer.GetString("driveDetail.elevSummary", "Elevation Summary");
        string gain = $"{ArrowUp} {ScalarFormatters.FormatNumber(s.ElevGainM, ElevationPrecision)} {MetersLabel}";
        string loss = $"{ArrowDown} {ScalarFormatters.FormatNumber(s.ElevLossM, ElevationPrecision)} {MetersLabel}";
        string automation = string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", label, gain, loss);
        return new MoreDetailsTile(label, gain, string.Empty, AccentGreen, automation, loss, AccentRed);
    }

    private static MoreDetailsTile EnergyTile(
        string labelKey, string labelFallback, double wh, string accent, ILocalizer localizer)
    {
        string label = localizer.GetString(labelKey, labelFallback);
        string value = EnergyString(wh);
        return new MoreDetailsTile(label, value, string.Empty, accent, AutomationName(label, value, string.Empty));
    }

    private static MoreDetailsTile ConsumptionTile(
        double consumptionWhKm, double consumptionDisplay, string efficiencyLabel, ILocalizer localizer)
    {
        string label = localizer.GetString("driveDetail.consumptionRate", "Consumption");
        string value = consumptionWhKm > 0
            ? ScalarFormatters.FormatNumber(consumptionDisplay, ConsumptionPrecision)
            : EmDash;
        return new MoreDetailsTile(label, value, efficiencyLabel, AccentPurple, AutomationName(label, value, efficiencyLabel));
    }

    private static MoreDetailsTile BatteryUsedTile(MoreDetailsSnapshot s, ILocalizer localizer)
    {
        string label = localizer.GetString("driveDetail.batteryUsed", "Battery Used");
        string value = s.StartBatteryPct is { } start && s.EndBatteryPct is { } end
            ? $"{ScalarFormatters.FormatNumber(start - end, 0)}%"
            : EmDash;
        return new MoreDetailsTile(label, value, string.Empty, AccentAmber, AutomationName(label, value, string.Empty));
    }

    private static MoreDetailsTile ValueTile(
        string labelKey, string labelFallback, string value, string unit, string accent, ILocalizer localizer)
    {
        string label = localizer.GetString(labelKey, labelFallback);
        return new MoreDetailsTile(label, value, unit, accent, AutomationName(label, value, unit));
    }

    private static string Distance(double meters, DistanceUnit unit) =>
        ScalarFormatters.FormatNumber(UnitConverters.DistanceFromSi(meters, unit), DistancePrecision);

    // web: stats.energyWh > 1000 ? `${energyWh/1000} kWh` : `${energyWh} Wh`.
    private static string EnergyString(double wh) => wh > KwhThresholdWh
        ? $"{ScalarFormatters.FormatNumber(wh / 1000.0, EnergyKwhPrecision)} kWh"
        : $"{ScalarFormatters.FormatNumber(wh, EnergyWhPrecision)} Wh";

    private static string AutomationName(string label, string value, string unit) =>
        string.IsNullOrEmpty(unit) || string.Equals(value, EmDash, StringComparison.Ordinal)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unit);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;MoreDetailsSnapshot&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class MoreDetailsPanelResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission.</param>
    /// <returns>The typed emission with the same status / freshness.</returns>
    public static RepositoryResult<MoreDetailsSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        MoreDetailsSnapshot Parse() =>
            raw.HasValue ? MoreDetailsSnapshot.FromJson(raw.Value) : MoreDetailsSnapshot.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<MoreDetailsSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<MoreDetailsSnapshot>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<MoreDetailsSnapshot>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<MoreDetailsSnapshot>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<MoreDetailsSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<MoreDetailsSnapshot>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<MoreDetailsSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the More Details surface — the native mirror of the web component
/// (web/src/features/driving/components/drive-detail/MoreDetailsPanel.tsx, rendered by the drive-detail
/// page). Centralises the stable id, the diagnostics slug and the localized panel title so the view and
/// view-model stay free of literal copy.
/// </summary>
public static class MoreDetailsPanelRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "more-details-panel";

    /// <summary>Surface category (matches the web driving feature).</summary>
    public const string Category = "driving";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "MoreDetailsPanel";

    /// <summary>Localized panel title (web <c>driveDetail.moreDetails</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized "More Details" title.</returns>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("driveDetail.moreDetails", "More Details");
    }
}

/// <summary>
/// PII-safe diagnostics for the More Details surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an odometer reading, range, location
/// or any drive metric — so a diagnostics line can never leak drive data. Thread-safe.
/// </summary>
public sealed class MoreDetailsPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Optional sink invoked with each diagnostics line.</param>
    public MoreDetailsPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=MoreDetailsPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MoreDetailsPanelRegistration.Slug}");
    }
}
