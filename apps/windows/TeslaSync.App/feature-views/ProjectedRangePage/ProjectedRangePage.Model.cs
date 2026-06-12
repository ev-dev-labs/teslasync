using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// One range-impact factor (web <c>RangeFactor</c> in
/// web/src/features/battery/pages/ProjectedRangePage.tsx). Parsing is null-tolerant. Pure data.
/// </summary>
/// <param name="Name">The factor key/name (web <c>name</c>).</param>
/// <param name="ImpactPct">Signed percentage impact on range (web <c>impact_pct</c>).</param>
/// <param name="Description">Human description (web <c>description</c>).</param>
public sealed record RangeFactor(string Name, double ImpactPct, string Description);

/// <summary>
/// One point on the rated-vs-projected range curve (web <c>CurvePoint</c>). Distances are kilometres
/// as delivered by <c>/analytics/range-projection</c>; they are restated to SI / display units only at
/// projection time. Pure data.
/// </summary>
/// <param name="BatteryPct">State of charge for the point, 0..100 (web <c>battery_pct</c>).</param>
/// <param name="RatedRangeKm">EPA/rated range at that SoC, kilometres (web <c>rated_range</c>).</param>
/// <param name="ProjectedRangeKm">Personalized projected range at that SoC, kilometres (web <c>projected_range</c>).</param>
public sealed record RangeCurvePoint(double BatteryPct, double RatedRangeKm, double ProjectedRangeKm);

/// <summary>
/// One cell of the personal efficiency matrix (web <c>EfficiencyBucket</c>) — the learned Wh/km for a
/// (temperature × speed) bucket and how many drives backed it. Pure data.
/// </summary>
/// <param name="TempBucket">Temperature bucket key (<c>freezing</c>/<c>cold</c>/<c>mild</c>/<c>hot</c>).</param>
/// <param name="SpeedBucket">Speed bucket key (<c>city</c>/<c>suburban</c>/<c>highway</c>).</param>
/// <param name="WhPerKm">Learned consumption for the bucket (web <c>wh_km</c>).</param>
/// <param name="Samples">Number of drives backing the bucket (web <c>samples</c>).</param>
public sealed record RangeEfficiencyBucket(string TempBucket, string SpeedBucket, double WhPerKm, int Samples);

/// <summary>
/// One "what your range looks like under these conditions" scenario (web <c>RangeScenario</c>). Speed is
/// km/h and ranges are kilometres as delivered; temperature is already SI Celsius. Pure data.
/// </summary>
public sealed record RangeScenario(
    string Name,
    double SpeedKmh,
    double TempC,
    double EfficiencyWhKm,
    double RangeKm,
    double RangeMi,
    int SampleCount,
    IReadOnlyList<string> Extras,
    bool IsCurrent);

/// <summary>
/// The personalized range projection from <c>GET /analytics/range-projection?vehicle_id=…</c> (web
/// <c>RangeProjection</c>, the <c>useQuery</c> shape in
/// web/src/features/battery/pages/ProjectedRangePage.tsx). Field names mirror the Go API's snake_case JSON
/// tags; parsing is null-tolerant so a partial body never throws. Distances/speeds arrive as km / km/h and
/// are restated to SI / the user's display unit only at projection time; <see cref="UsableCapacityWh"/> is
/// SI watt-hours and <see cref="EfficiencyFactor"/> is a 0..1 fraction. Pure data — no WinUI types.
/// </summary>
public sealed record RangeProjection(
    double CurrentRangeKm,
    double ProjectedRangeKm,
    double BatteryLevel,
    double EfficiencyFactor,
    double CurrentBatteryPct,
    double UsableCapacityWh,
    double HealthFactor,
    double TeslaEstimateKm,
    double YourEstimateKm,
    string AccuracyNote,
    IReadOnlyList<RangeFactor> Factors,
    IReadOnlyList<RangeCurvePoint> ProjectionCurve,
    IReadOnlyList<RangeScenario> Scenarios,
    IReadOnlyList<RangeEfficiencyBucket> EfficiencyMatrix)
{
    private const string EmDash = "\u2014";

    /// <summary>The all-zero / all-empty projection used before any data resolves and for the empty state.</summary>
    public static RangeProjection Empty { get; } = new(
        0, 0, 0, 0, 0, 0, 1, 0, 0, string.Empty,
        Array.Empty<RangeFactor>(),
        Array.Empty<RangeCurvePoint>(),
        Array.Empty<RangeScenario>(),
        Array.Empty<RangeEfficiencyBucket>());

    /// <summary>
    /// True when the payload carries no usable projection at all (no curve, no scenarios, no matrix, no
    /// factors and a zero estimate) — the native analogue of the web's <c>data</c>-undefined branch. Drives
    /// the page-level empty state rather than a fully blank success layout.
    /// </summary>
    public bool IsEmpty =>
        ProjectionCurve.Count == 0 &&
        Scenarios.Count == 0 &&
        EfficiencyMatrix.Count == 0 &&
        Factors.Count == 0 &&
        YourEstimateKm == 0 &&
        TeslaEstimateKm == 0 &&
        UsableCapacityWh == 0;

    /// <summary>Parse a raw JSON object into a projection, tolerating missing/typed-wrong fields.</summary>
    public static RangeProjection FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new RangeProjection(
            CurrentRangeKm: GetDouble(element, "current_range_km") ?? 0,
            ProjectedRangeKm: GetDouble(element, "projected_range_km") ?? 0,
            BatteryLevel: GetDouble(element, "battery_level") ?? 0,
            EfficiencyFactor: GetDouble(element, "efficiency_factor") ?? 0,
            CurrentBatteryPct: GetDouble(element, "current_battery_pct") ?? 0,
            UsableCapacityWh: GetDouble(element, "usable_capacity_wh") ?? 0,
            HealthFactor: GetDouble(element, "health_factor") ?? 1,
            TeslaEstimateKm: GetDouble(element, "tesla_estimate_km") ?? 0,
            YourEstimateKm: GetDouble(element, "your_estimate_km") ?? 0,
            AccuracyNote: GetString(element, "accuracy_note") ?? string.Empty,
            Factors: GetFactors(element, "factors"),
            ProjectionCurve: GetCurve(element, "projection_curve"),
            Scenarios: GetScenarios(element, "scenarios"),
            EfficiencyMatrix: GetMatrix(element, "efficiency_matrix"));
    }

    private static IReadOnlyList<RangeFactor> GetFactors(JsonElement obj, string name)
    {
        if (!TryArray(obj, name, out var arr))
        {
            return Array.Empty<RangeFactor>();
        }

        var list = new List<RangeFactor>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new RangeFactor(
                Name: GetString(item, "name") ?? string.Empty,
                ImpactPct: GetDouble(item, "impact_pct") ?? 0,
                Description: GetString(item, "description") ?? string.Empty));
        }

        return list;
    }

    private static IReadOnlyList<RangeCurvePoint> GetCurve(JsonElement obj, string name)
    {
        if (!TryArray(obj, name, out var arr))
        {
            return Array.Empty<RangeCurvePoint>();
        }

        var list = new List<RangeCurvePoint>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new RangeCurvePoint(
                BatteryPct: GetDouble(item, "battery_pct") ?? 0,
                RatedRangeKm: GetDouble(item, "rated_range") ?? 0,
                ProjectedRangeKm: GetDouble(item, "projected_range") ?? 0));
        }

        return list;
    }

    private static IReadOnlyList<RangeScenario> GetScenarios(JsonElement obj, string name)
    {
        if (!TryArray(obj, name, out var arr))
        {
            return Array.Empty<RangeScenario>();
        }

        var list = new List<RangeScenario>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new RangeScenario(
                Name: GetString(item, "name") ?? EmDash,
                SpeedKmh: GetDouble(item, "speed_kmh") ?? 0,
                TempC: GetDouble(item, "temp_c") ?? 0,
                EfficiencyWhKm: GetDouble(item, "efficiency_wh_km") ?? 0,
                RangeKm: GetDouble(item, "range_km") ?? 0,
                RangeMi: GetDouble(item, "range_mi") ?? 0,
                SampleCount: (int)(GetDouble(item, "sample_count") ?? 0),
                Extras: GetStringArray(item, "extras"),
                IsCurrent: GetBool(item, "is_current")));
        }

        return list;
    }

    private static IReadOnlyList<RangeEfficiencyBucket> GetMatrix(JsonElement obj, string name)
    {
        if (!TryArray(obj, name, out var arr))
        {
            return Array.Empty<RangeEfficiencyBucket>();
        }

        var list = new List<RangeEfficiencyBucket>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new RangeEfficiencyBucket(
                TempBucket: GetString(item, "temp_bucket") ?? string.Empty,
                SpeedBucket: GetString(item, "speed_bucket") ?? string.Empty,
                WhPerKm: GetDouble(item, "wh_km") ?? 0,
                Samples: (int)(GetDouble(item, "samples") ?? 0)));
        }

        return list;
    }

    private static bool TryArray(JsonElement obj, string name, out JsonElement arr)
    {
        if (obj.TryGetProperty(name, out arr) && arr.ValueKind == JsonValueKind.Array)
        {
            return true;
        }

        arr = default;
        return false;
    }

    private static IReadOnlyList<string> GetStringArray(JsonElement obj, string name)
    {
        if (!TryArray(obj, name, out var arr))
        {
            return Array.Empty<string>();
        }

        var list = new List<string>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String && item.GetString() is { Length: > 0 } s)
            {
                list.Add(s);
            }
        }

        return list;
    }

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static bool GetBool(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

/// <summary>
/// The lifecycle state the <see cref="ProjectedRangePageViewModel"/> can be in — the native union of the
/// four web data states (<c>loading</c> / <c>empty</c> / <c>error</c> / <c>success</c>) plus the
/// cached/stale/offline freshness branches the cache-then-network engine emits. The page renders the full
/// hero-cards + gauge + curve + scenarios + matrix + what-if + factors + tips layout for
/// <see cref="Loaded"/>, <see cref="Stale"/> and <see cref="Offline"/>; a genuinely empty response collapses
/// to <see cref="Empty"/>, and a failed first read with no cache to <see cref="Error"/>.
/// </summary>
public enum RangeProjectionState
{
    /// <summary>Initial fetch with no cached snapshot — the page-level loading body (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>A snapshot with projection data — render every section.</summary>
    Loaded,

    /// <summary>A genuinely empty response — render the page-level empty state (web <c>data</c> undefined).</summary>
    Empty,

    /// <summary>The first read failed with no cache — render the error banner (web <c>error</c>).</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — content plus an offline chip.</summary>
    Offline,
}

/// <summary>One projected hero metric card (web hero <c>MetricCard</c>). Pure data — no WinUI types.</summary>
/// <param name="Label">Localized label.</param>
/// <param name="Value">Already-formatted value.</param>
/// <param name="Glyph">Segoe Fluent accent glyph.</param>
/// <param name="AutomationName">Narrator name.</param>
public sealed record RangeHeroStat(
    string Label,
    string Value,
    string Glyph,
    string AutomationName);

/// <summary>One projected scenario card (web inner scenario <c>GlassPanel</c>). Pure data.</summary>
public sealed record RangeScenarioCard(
    string Name,
    string Glyph,
    string RangeValue,
    string SpeedValue,
    string TempValue,
    string EfficiencyValue,
    string SamplesValue,
    IReadOnlyList<string> Extras,
    bool IsCurrent,
    string CurrentLabel,
    string AutomationName);

/// <summary>One efficiency-matrix cell (web heatmap tile). <see cref="Severity"/> 0..3 maps low→high Wh/km; -1 = no data.</summary>
public sealed record RangeMatrixCell(string Value, string Samples, bool HasData, int Severity, string AutomationName);

/// <summary>One efficiency-matrix row — a temperature label plus one cell per speed bucket.</summary>
public sealed record RangeMatrixRow(string TempLabel, IReadOnlyList<RangeMatrixCell> Cells);

/// <summary>One projected range factor card (web inner factor <c>GlassPanel</c>). Pure data.</summary>
public sealed record RangeFactorCard(
    string Name,
    string Glyph,
    string ImpactText,
    bool IsPositive,
    string Description,
    string AutomationName);

/// <summary>One range-maximizing tip (web tips list item). Pure data.</summary>
public sealed record RangeTipItem(string Glyph, string Text);

/// <summary>
/// The fully projected, render-ready view of the range projection — the native analogue of everything the
/// web page computes before returning JSX. Holds the localized header, the five hero cards, the efficiency
/// gauge value + accuracy note, the projection-curve series + current-SoC reference annotation, the scenario
/// cards, the efficiency heatmap rows, the interactive what-if readout, the range-factor cards, the tips, and
/// every per-section + page-level empty message. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record RangeProjectionDisplay(
    string Title,
    string Subtitle,
    RangeHeroStat YourEstimate,
    RangeHeroStat TeslaEstimate,
    RangeHeroStat Battery,
    RangeHeroStat UsableCapacity,
    RangeHeroStat HealthFactor,
    double EfficiencyValue,
    string EfficiencyLabel,
    int EfficiencyColorIndex,
    string AccuracyNote,
    string CurveTitle,
    string RatedName,
    string ProjectedName,
    string CurrentLabel,
    IReadOnlyList<ChartSeries> CurveSeries,
    IReadOnlyList<ChartAnnotation> CurveAnnotations,
    bool HasCurve,
    string CurveAria,
    string ScenariosTitle,
    IReadOnlyList<RangeScenarioCard> Scenarios,
    bool HasScenarios,
    string NoScenariosMessage,
    string MatrixTitle,
    IReadOnlyList<string> MatrixSpeedHeaders,
    IReadOnlyList<RangeMatrixRow> MatrixRows,
    bool HasMatrix,
    string NoMatrixMessage,
    string WhatIfTitle,
    string SpeedLabel,
    string TemperatureLabel,
    string WhatIfRangeValue,
    string WhatIfEfficiencyValue,
    string WhatIfConditions,
    bool HasWhatIf,
    string NoWhatIfMessage,
    string FactorsTitle,
    IReadOnlyList<RangeFactorCard> Factors,
    string TipsTitle,
    IReadOnlyList<RangeTipItem> Tips,
    string NoDataMessage);

/// <summary>
/// Pure projection from a raw <see cref="RangeProjection"/> to the render-ready
/// <see cref="RangeProjectionDisplay"/> — the native port of the JSX-time computation in
/// web/src/features/battery/pages/ProjectedRangePage.tsx (hero cards, efficiency gauge, projection curve,
/// scenario cards, efficiency heatmap, the "what if" interpolation, range factors and tips). SI / display
/// conversion happens here (and only here) via <see cref="UnitFormatters"/>; every label resolves through the
/// i18n facade with the web key names.
/// </summary>
public static class RangeProjectionProjection
{
    /// <summary>Web what-if speed slider default (km/h).</summary>
    public const double DefaultWhatIfSpeedKmh = 80;

    /// <summary>Web what-if temperature slider default (°C).</summary>
    public const double DefaultWhatIfTempC = 20;

    // Segoe Fluent Icons glyphs mirroring the web lucide icons.
    private const string TrendingUpGlyph = "\uE9D9";   // TrendingUp (Your Estimate)
    private const string CarGlyph = "\uE804";          // Car (Tesla Estimate / Speed)
    private const string BatteryGlyph = "\uEBAA";      // Battery (Battery card)
    private const string ZapGlyph = "\uE945";          // Lightning bolt (Usable Capacity / default scenario)
    private const string ShieldGlyph = "\uEA18";       // Shield (Health Factor / sentry scenario)
    private const string SnowflakeGlyph = "\uE9CA";    // Frigid (cold scenario / temperature factor)
    private const string GaugeGlyph = "\uE9D9";        // Gauge (driving-style factor fallback)
    private const string WindGlyph = "\uE9CA";         // HVAC factor
    private const string MountainGlyph = "\uE0A5";     // Elevation factor / elevation tip
    private const string ThermometerGlyph = "\uE9CA";  // Temperature tip

    private static readonly string[] TempBuckets = { "freezing", "cold", "mild", "hot" };
    private static readonly string[] SpeedBuckets = { "city", "suburban", "highway" };

    /// <summary>Project <paramref name="data"/> for the given what-if conditions and unit preference.</summary>
    public static RangeProjectionDisplay Project(
        RangeProjection data,
        double whatIfSpeedKmh,
        double whatIfTempC,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("range.title", "Projected Range");
        string subtitle = localizer.GetString(
            "range.subtitle",
            "Personalized range estimates based on your driving patterns, weather, and conditions");
        string currentLabel = localizer.GetString("range.current", "Current");

        // ---- Hero cards (glow + accent brush are a view concern, applied per tile in the view) ----
        double batteryPct = data.CurrentBatteryPct != 0 ? data.CurrentBatteryPct : data.BatteryLevel;
        var your = Hero(
            localizer.GetString("range.yourEstimate", "Your Estimate"),
            UnitFormatters.FormatDistance(data.YourEstimateKm * 1000, units, 0),
            TrendingUpGlyph);
        var tesla = Hero(
            localizer.GetString("range.teslaEstimate", "Tesla Estimate"),
            UnitFormatters.FormatDistance(data.TeslaEstimateKm * 1000, units, 0),
            CarGlyph);
        var battery = Hero(
            localizer.GetString("range.battery", "Battery"),
            ScalarFormatters.FormatPercentage(batteryPct, 0),
            BatteryGlyph);
        var capacity = Hero(
            localizer.GetString("range.usableCapacity", "Usable Capacity"),
            UnitFormatters.FormatEnergy(data.UsableCapacityWh, units),
            ZapGlyph);
        var health = Hero(
            localizer.GetString("range.healthFactor", "Health Factor"),
            ScalarFormatters.FormatPercentage((data.HealthFactor == 0 ? 1 : data.HealthFactor) * 100, 1),
            ShieldGlyph);

        // ---- Efficiency gauge ----
        double efficiencyValue = Math.Round(data.EfficiencyFactor * 100);
        int efficiencyColorIndex = data.EfficiencyFactor >= 0.9 ? 1 : data.EfficiencyFactor >= 0.7 ? 3 : 5;
        string efficiencyLabel = localizer.GetString("range.efficiency", "Efficiency");

        // ---- Projection curve (rated + projected areas) + current-SoC reference line ----
        string ratedName = localizer.GetString("range.rated", "Rated Range");
        string projectedName = localizer.GetString("range.projected", "Projected Range");
        bool hasCurve = data.ProjectionCurve.Count > 0;
        IReadOnlyList<ChartSeries> curveSeries;
        IReadOnlyList<ChartAnnotation> curveAnnotations;
        if (hasCurve)
        {
            var rated = new List<ChartPoint>(data.ProjectionCurve.Count);
            var projected = new List<ChartPoint>(data.ProjectionCurve.Count);
            foreach (var p in data.ProjectionCurve)
            {
                rated.Add(new ChartPoint(p.BatteryPct, p.RatedRangeKm));
                projected.Add(new ChartPoint(p.BatteryPct, p.ProjectedRangeKm));
            }

            curveSeries = new[]
            {
                new ChartSeries(ratedName, rated) { Kind = ChartSeriesKind.Area, ColorIndex = 0, Decimals = 0, Unit = UnitLabels.Label(units.Distance) },
                new ChartSeries(projectedName, projected) { Kind = ChartSeriesKind.Area, Role = ChartRole.Battery, Decimals = 0, Unit = UnitLabels.Label(units.Distance) },
            };
            curveAnnotations = new[]
            {
                new ChartAnnotation("current-soc", ChartAnnotationKind.VerticalLine, data.BatteryLevel)
                {
                    Label = currentLabel,
                    Role = ChartRole.Speed,
                },
            };
        }
        else
        {
            curveSeries = Array.Empty<ChartSeries>();
            curveAnnotations = Array.Empty<ChartAnnotation>();
        }

        // ---- Scenario cards ----
        var scenarioCards = new List<RangeScenarioCard>(data.Scenarios.Count);
        foreach (var s in data.Scenarios)
        {
            string rangeValue = UnitFormatters.FormatDistance(s.RangeKm * 1000, units, 0);
            string speedValue = UnitFormatters.FormatSpeed(s.SpeedKmh / 3.6, units, 0);
            string tempValue = UnitFormatters.FormatTemperature(s.TempC, units, 0);
            string effValue = $"{ScalarFormatters.FormatNumber(s.EfficiencyWhKm, 0)} Wh/km";
            string samples = s.SampleCount > 0
                ? string.Format(CultureInfo.CurrentCulture, "({0} {1})", s.SampleCount, localizer.GetString("range.drives", "drives"))
                : string.Empty;
            scenarioCards.Add(new RangeScenarioCard(
                Name: s.Name,
                Glyph: ScenarioGlyph(s),
                RangeValue: rangeValue,
                SpeedValue: speedValue,
                TempValue: tempValue,
                EfficiencyValue: effValue,
                SamplesValue: samples,
                Extras: s.Extras,
                IsCurrent: s.IsCurrent,
                CurrentLabel: currentLabel,
                AutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}", s.Name, rangeValue)));
        }

        // ---- Efficiency heatmap ----
        var matrixLookup = new Dictionary<string, RangeEfficiencyBucket>(StringComparer.Ordinal);
        foreach (var b in data.EfficiencyMatrix)
        {
            matrixLookup[$"{b.TempBucket}|{b.SpeedBucket}"] = b;
        }

        var speedHeaders = new List<string>(SpeedBuckets.Length);
        foreach (var speed in SpeedBuckets)
        {
            speedHeaders.Add(Capitalize(localizer.GetString($"range.bucket.{speed}", Capitalize(speed))));
        }

        var matrixRows = new List<RangeMatrixRow>(TempBuckets.Length);
        foreach (var temp in TempBuckets)
        {
            var cells = new List<RangeMatrixCell>(SpeedBuckets.Length);
            foreach (var speed in SpeedBuckets)
            {
                if (matrixLookup.TryGetValue($"{temp}|{speed}", out var bucket))
                {
                    cells.Add(new RangeMatrixCell(
                        Value: ScalarFormatters.FormatNumber(bucket.WhPerKm, 0),
                        Samples: $"({bucket.Samples})",
                        HasData: true,
                        Severity: EfficiencySeverity(bucket.WhPerKm),
                        AutomationName: string.Format(
                            CultureInfo.CurrentCulture,
                            "{0} {1}: {2} Wh/km",
                            Capitalize(temp), Capitalize(speed), ScalarFormatters.FormatNumber(bucket.WhPerKm, 0))));
                }
                else
                {
                    cells.Add(new RangeMatrixCell("\u2014", string.Empty, false, -1, string.Empty));
                }
            }

            matrixRows.Add(new RangeMatrixRow(Capitalize(localizer.GetString($"range.bucket.{temp}", Capitalize(temp))), cells));
        }

        // ---- What-if interpolation ----
        double capacityWh = data.UsableCapacityWh != 0 ? data.UsableCapacityWh : 75000;
        double whatIfBatteryPct = batteryPct != 0 ? batteryPct : 80;
        var (effWhKm, rangeKm) = InterpolateRange(data.EfficiencyMatrix, whatIfSpeedKmh, whatIfTempC, whatIfBatteryPct, capacityWh);
        string whatIfRange = UnitFormatters.FormatDistance(rangeKm * 1000, units, 0);
        string whatIfEff = $"{ScalarFormatters.FormatNumber(effWhKm, 0)} Wh/km";
        string whatIfConditions = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("range.whatIfConditions", "at {0} km/h, {1}\u00B0C"),
            ScalarFormatters.FormatNumber(whatIfSpeedKmh, 0),
            ScalarFormatters.FormatNumber(whatIfTempC, 0));

        // ---- Range factors ----
        var factorCards = new List<RangeFactorCard>(data.Factors.Count);
        foreach (var f in data.Factors)
        {
            bool positive = f.ImpactPct >= 0;
            string impact = string.Format(
                CultureInfo.CurrentCulture, "{0}{1}%", positive ? "+" : string.Empty, ScalarFormatters.FormatNumber(f.ImpactPct, 1));
            factorCards.Add(new RangeFactorCard(
                Name: localizer.GetString($"range.factor.{f.Name}", f.Name),
                Glyph: FactorGlyph(f.Name),
                ImpactText: impact,
                IsPositive: positive,
                Description: localizer.GetString($"range.factorDesc.{f.Name}", f.Description),
                AutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}", f.Name, impact)));
        }

        // ---- Tips ----
        var tips = new[]
        {
            new RangeTipItem(ZapGlyph, localizer.GetString("range.tip.speed", "Keep speed under 110 km/h for optimal efficiency.")),
            new RangeTipItem(ThermometerGlyph, localizer.GetString("range.tip.precondition", "Pre-condition the cabin while still plugged in.")),
            new RangeTipItem(WindGlyph, localizer.GetString("range.tip.seatHeaters", "Use seat heaters instead of cabin heat in cold weather.")),
            new RangeTipItem(MountainGlyph, localizer.GetString("range.tip.elevation", "Plan routes to minimize elevation changes.")),
        };

        return new RangeProjectionDisplay(
            Title: title,
            Subtitle: subtitle,
            YourEstimate: your,
            TeslaEstimate: tesla,
            Battery: battery,
            UsableCapacity: capacity,
            HealthFactor: health,
            EfficiencyValue: efficiencyValue,
            EfficiencyLabel: efficiencyLabel,
            EfficiencyColorIndex: efficiencyColorIndex,
            AccuracyNote: data.AccuracyNote,
            CurveTitle: localizer.GetString("range.projectionCurve", "Range Projection Curve"),
            RatedName: ratedName,
            ProjectedName: projectedName,
            CurrentLabel: currentLabel,
            CurveSeries: curveSeries,
            CurveAnnotations: curveAnnotations,
            HasCurve: hasCurve,
            CurveAria: string.Format(
                CultureInfo.CurrentCulture,
                "{0}. {1} / {2}.",
                localizer.GetString("range.projectionCurve", "Range Projection Curve"), ratedName, projectedName),
            ScenariosTitle: localizer.GetString("range.scenarios", "Range Scenarios"),
            Scenarios: scenarioCards,
            HasScenarios: scenarioCards.Count > 0,
            NoScenariosMessage: localizer.GetString("range.noScenarios", "Drive more to see personalized scenario projections."),
            MatrixTitle: localizer.GetString("range.efficiencyMatrix", "Personal Efficiency Matrix (Wh/km)"),
            MatrixSpeedHeaders: speedHeaders,
            MatrixRows: matrixRows,
            HasMatrix: data.EfficiencyMatrix.Count > 0,
            NoMatrixMessage: localizer.GetString("range.noMatrix", "Efficiency data requires drives in different conditions."),
            WhatIfTitle: localizer.GetString("range.whatIf", "What If Calculator"),
            SpeedLabel: localizer.GetString("range.speed", "Speed"),
            TemperatureLabel: localizer.GetString("range.temperature", "Temperature"),
            WhatIfRangeValue: whatIfRange,
            WhatIfEfficiencyValue: whatIfEff,
            WhatIfConditions: whatIfConditions,
            HasWhatIf: true,
            NoWhatIfMessage: localizer.GetString("range.noWhatIf", "Adjust sliders to calculate projected range."),
            FactorsTitle: localizer.GetString("range.factors", "Range Factors"),
            Factors: factorCards,
            TipsTitle: localizer.GetString("range.tips", "Tips to Maximize Range"),
            Tips: tips,
            NoDataMessage: localizer.GetString("range.noData", "No range projection yet. Drive to build a personalized projection."));
    }

    /// <summary>
    /// Interpolate the projected efficiency + range for a (speed, temperature) what-if — the 1:1 port of the
    /// web <c>interpolateRange</c> helper. Returns Wh/km and kilometres, both rounded to one decimal.
    /// </summary>
    public static (double EffWhKm, double RangeKm) InterpolateRange(
        IReadOnlyList<RangeEfficiencyBucket> matrix,
        double speedKmh,
        double tempC,
        double batteryPct,
        double capacityWh)
    {
        ArgumentNullException.ThrowIfNull(matrix);

        string tempBucket = tempC < 0 ? "freezing" : tempC < 10 ? "cold" : tempC < 25 ? "mild" : "hot";
        string speedBucket = speedKmh < 50 ? "city" : speedKmh < 90 ? "suburban" : "highway";

        double? matchEff = null;
        foreach (var b in matrix)
        {
            if (string.Equals(b.TempBucket, tempBucket, StringComparison.Ordinal) &&
                string.Equals(b.SpeedBucket, speedBucket, StringComparison.Ordinal))
            {
                matchEff = b.WhPerKm;
                break;
            }
        }

        double eff = matchEff ?? (155 + ((speedKmh - 35) * 0.5) + (Math.Max(0, 20 - tempC) * 1.5));
        if (eff <= 0)
        {
            eff = 170;
        }

        double rangeKm = capacityWh * (batteryPct / 100) / eff;
        return (Math.Round(eff * 10) / 10, Math.Round(rangeKm * 10) / 10);
    }

    private static RangeHeroStat Hero(string label, string value, string glyph) =>
        new(label, value, glyph, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value));

    private static string ScenarioGlyph(RangeScenario scenario)
    {
        foreach (var x in scenario.Extras)
        {
            if (string.Equals(x, "sentry", StringComparison.OrdinalIgnoreCase))
            {
                return ShieldGlyph;
            }
        }

        if (scenario.TempC < 0)
        {
            return SnowflakeGlyph;
        }

        return scenario.SpeedKmh > 90 ? CarGlyph : ZapGlyph;
    }

    private static string FactorGlyph(string name) => (name ?? string.Empty).ToLowerInvariant().Replace(' ', '_') switch
    {
        "temperature" => ThermometerGlyph,
        "speed" => CarGlyph,
        "hvac" => WindGlyph,
        "elevation" => MountainGlyph,
        "driving_style" => GaugeGlyph,
        _ => GaugeGlyph,
    };

    // wh_km <= 155 best, <= 180 good, <= 210 fair, else poor (web effColor thresholds).
    private static int EfficiencySeverity(double whKm) => whKm <= 155 ? 0 : whKm <= 180 ? 1 : whKm <= 210 ? 2 : 3;

    private static string Capitalize(string value) =>
        string.IsNullOrEmpty(value) ? value : char.ToUpperInvariant(value[0]) + value[1..];
}

/// <summary>
/// The data port the <see cref="ProjectedRangePageViewModel"/> binds to (P1/S8 state-holder seam) — the
/// native analogue of the web page's <c>useQuery(['range-projection', vehicleId])</c> read. It yields the
/// cache-then-network sequence of parsed projections for the scoped vehicle. The view never performs HTTP;
/// the repository-backed <see cref="RangeProjectionSource"/> (or a test fake) drives this.
/// </summary>
public interface IRangeProjectionSource
{
    /// <summary>Stream the cache-then-network range-projection snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<RangeProjection>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The default <see cref="IRangeProjectionSource"/> — resolves every read to the empty data state. It is the
/// parameterless-constructed page's feed (the navigation host wires the repository-backed source via
/// <see cref="RangeProjectionSource"/>), mirroring how the other W7 pages default to an empty feed until a
/// data adapter is supplied.
/// </summary>
public sealed class EmptyRangeProjectionSource : IRangeProjectionSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyRangeProjectionSource Instance { get; } = new();

    private EmptyRangeProjectionSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<RangeProjection>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<RangeProjection>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;RangeProjection&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. Kept pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class RangeProjectionResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<RangeProjection> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        RangeProjection Parse() => raw.HasValue ? RangeProjection.FromJson(raw.Value) : RangeProjection.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<RangeProjection>.Loading(),
            LoadStatus.Cached => RepositoryResult<RangeProjection>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<RangeProjection>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<RangeProjection>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<RangeProjection>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<RangeProjection>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<RangeProjection>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the Projected Range page — the native mirror of the web route
/// <c>/analytics/range</c> (visible nav item <c>/projected-range</c>; both resolve to the nav name
/// <c>ProjectedRange</c>). The shell page factory registers the surface under <see cref="RouteName"/>; the
/// title / subtitle resolve through the i18n facade with the web key names.
/// </summary>
public static class ProjectedRangePageRegistration
{
    /// <summary>The navigation route name the shell page factory registers this surface under.</summary>
    public const string RouteName = "ProjectedRange";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ProjectedRangePage";

    /// <summary>The localized page title (web <c>range.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("range.title", "Projected Range");
    }

    /// <summary>The localized page subtitle (web <c>range.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "range.subtitle",
            "Personalized range estimates based on your driving patterns, weather, and conditions");
    }
}

/// <summary>
/// PII-safe diagnostics for the Projected Range page (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a range, capacity, health score or
/// vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class ProjectedRangePageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ProjectedRangePageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ProjectedRangePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ProjectedRangePageRegistration.Slug}");
    }
}
