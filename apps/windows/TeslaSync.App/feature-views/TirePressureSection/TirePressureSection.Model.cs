using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="TirePressureSectionViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches a P2 feature surface must render for the web
/// drive-detail Tire-Pressure chart
/// (web/src/features/driving/components/drive-detail/TirePressureSection.tsx). The web component is a pure
/// child of the Drive-Detail page that draws a friendly "No telemetry data available" empty state when its
/// <c>stats.hasTirePressure</c> gate is false (no vehicle, no drive, or a drive with no tyre-pressure
/// channel); the native feature-view owns its cache-then-network drive-telemetry read and therefore renders
/// the full state matrix. Every branch maps onto a visible surface; none is hidden. <see cref="Empty"/>
/// mirrors the web <c>chartData.some(d =&gt; d.tireFl !== null || …)</c> gate and is distinct from a transport
/// failure (<see cref="Error"/>).
/// </summary>
public enum TirePressureSectionState
{
    /// <summary>Initial fetch with no cached telemetry — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) drive trace carrying at least one tyre-pressure reading.</summary>
    Loaded,

    /// <summary>No vehicle / drive resolved, or a drive with no tyre-pressure channel — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached trace exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached trace older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached trace remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One drive-telemetry sample projected from the per-drive telemetry response (web
/// <c>DriveTelemetryPoint</c> in <c>@/types/driving</c>). Only the fields the web Tire-Pressure chart reads
/// are kept: the timestamp (X axis) and the four corner tyre pressures in SI Pascals
/// (<c>tire_pressure_fl</c> / <c>tire_pressure_fr</c> / <c>tire_pressure_rl</c> / <c>tire_pressure_rr</c>).
/// Parsing is null-tolerant so a partial row never throws and a missing corner stays null (the chart connects
/// across the gap, mirroring the web per-corner <c>!== null</c> filter). Pressures stay SI Pascals — divided
/// to kilopascals and converted to the user's display unit only at projection time.
/// </summary>
/// <param name="TimestampUtc">Sample instant, or null (web <c>tp.createdAt ?? tp.created_at ?? tp.timestamp</c>).</param>
/// <param name="FrontLeftPa">Front-left tyre pressure in SI Pascals, or null (web <c>tirePressureFl</c>).</param>
/// <param name="FrontRightPa">Front-right tyre pressure in SI Pascals, or null (web <c>tirePressureFr</c>).</param>
/// <param name="RearLeftPa">Rear-left tyre pressure in SI Pascals, or null (web <c>tirePressureRl</c>).</param>
/// <param name="RearRightPa">Rear-right tyre pressure in SI Pascals, or null (web <c>tirePressureRr</c>).</param>
public sealed record TirePressureSample(
    DateTimeOffset? TimestampUtc,
    double? FrontLeftPa,
    double? FrontRightPa,
    double? RearLeftPa,
    double? RearRightPa)
{
    /// <summary>Parse a drive-telemetry JSON array into a tolerant list of samples, preserving order.</summary>
    /// <param name="element">The raw telemetry JSON (an array; any other kind yields an empty list).</param>
    /// <returns>The parsed samples in wire order, skipping non-object rows.</returns>
    public static IReadOnlyList<TirePressureSample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TirePressureSample>();
        }

        var list = new List<TirePressureSample>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single drive-telemetry JSON object into a tolerant sample.</summary>
    /// <param name="obj">The raw telemetry row.</param>
    /// <returns>The parsed sample (every field null-tolerant).</returns>
    public static TirePressureSample FromJson(JsonElement obj) => new(
        // Web parity: the hook reads `tp.createdAt ?? tp.created_at ?? tp.timestamp`; the Go telemetry
        // handler emits `created_at`, so try `timestamp` first then `created_at`.
        GetDateTime(obj, "timestamp") ?? GetDateTime(obj, "created_at"),
        GetDouble(obj, "tire_pressure_fl"),
        GetDouble(obj, "tire_pressure_fr"),
        GetDouble(obj, "tire_pressure_rl"),
        GetDouble(obj, "tire_pressure_rr"));

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

    private static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var ts)
            ? ts
            : null;
    }
}

/// <summary>
/// One projected, render-ready point of a tyre-pressure line — the native analogue of a single web
/// <c>ChartDataPoint</c> tyre reading. Holds the X-axis <see cref="Index"/> (the sample's ordinal in the
/// trace, shared across every corner), the converted display-unit <see cref="ValueDisplay"/> and the 24-hour
/// local <see cref="TimeLabel"/> shown in the tooltip. Pure data so the geometry is unit-tested without a UI
/// host.
/// </summary>
/// <param name="Index">Zero-based sample ordinal (the shared X position).</param>
/// <param name="ValueDisplay">Tyre pressure in the user's display unit.</param>
/// <param name="TimeLabel">24-hour local <c>HH:mm</c> label for the tooltip.</param>
public sealed record TirePressureSectionPoint(int Index, double ValueDisplay, string TimeLabel);

/// <summary>
/// One tyre-pressure line series — the native analogue of a web <c>&lt;Line&gt;</c> in the recharts
/// <c>LineChart</c>. Holds the localized <see cref="Label"/> (the abbreviated corner carrying the active
/// pressure unit, e.g. "FL (psi)"), the categorical palette <see cref="ColorIndex"/> tinting the line + legend
/// swatch, the converted <see cref="Points"/> and the Narrator <see cref="AutomationName"/>. A series is
/// present only when at least one sample carries its corner (web <c>chartData.some(d =&gt; d.tireFl !== null)</c>).
/// Pure data.
/// </summary>
/// <param name="Key">Stable corner key (<c>fl</c> / <c>fr</c> / <c>rl</c> / <c>rr</c>).</param>
/// <param name="Label">Localized abbreviated series label including the pressure unit.</param>
/// <param name="ColorIndex">Zero-based brand-palette index tinting the line and legend swatch.</param>
/// <param name="Points">The converted, display-unit points (gaps omitted, connected across).</param>
/// <param name="AutomationName">Spoken summary of the series (full corner name + sample count).</param>
public sealed record TirePressureSectionSeries(
    string Key,
    string Label,
    int ColorIndex,
    IReadOnlyList<TirePressureSectionPoint> Points,
    string AutomationName);

/// <summary>
/// One projected, display-ready stat tile shown above the chart — the native analogue of a web per-corner stat
/// tile (the small <c>rounded-lg</c> cards over the trace). Holds the localized <see cref="Label"/> (the corner
/// name), the already-formatted <see cref="Value"/> (the min–max pressure range, or an em dash when the corner
/// reported nothing), the optional <see cref="Unit"/> suffix (the pressure unit when a range is present; empty
/// otherwise), the accent token brush key and the Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Label">Localized tile label (e.g. "Front Left").</param>
/// <param name="Value">Formatted tile value (the min–max range, or an em dash).</param>
/// <param name="Unit">Unit suffix shown beside the value (pressure unit, or empty).</param>
/// <param name="AccentBrushKey">Token brush key for the tile accent.</param>
/// <param name="AutomationName">Narrator name combining the label, value and unit.</param>
public sealed record TirePressureSectionTile(
    string Label,
    string Value,
    string Unit,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Tire-Pressure surface — the native analogue of everything the
/// web component computes before returning its <c>ChartContainer</c>. Carries the always-present chrome
/// strings (title / chart aria / empty message), the <see cref="HasData"/> gate
/// (web <c>stats.hasTirePressure</c>), the per-corner stat <see cref="Tiles"/> (always four when present, in
/// FL / FR / RL / RR order) and the present line <see cref="Series"/>. Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when at least one corner reported a reading (web <c>stats.hasTirePressure</c>).</param>
/// <param name="Title">Localized surface title (web "Tire Pressure During Drive").</param>
/// <param name="ChartAriaLabel">Localized chart Narrator label.</param>
/// <param name="EmptyMessage">Localized empty-state message.</param>
/// <param name="Tiles">The per-corner stat tiles, in web order (FL / FR / RL / RR).</param>
/// <param name="Series">The present tyre-pressure line series, in web order.</param>
public sealed record TirePressureSectionDisplay(
    bool HasData,
    string Title,
    string ChartAriaLabel,
    string EmptyMessage,
    IReadOnlyList<TirePressureSectionTile> Tiles,
    IReadOnlyList<TirePressureSectionSeries> Series);

/// <summary>
/// Pure projection from the raw drive-telemetry samples to the display model — the native port of the web
/// <c>chartData</c> tyre mapping (<c>tp.tirePressureFl / 1000</c> then <c>convertPressureFromSI</c>), the
/// per-corner min–max rollup (over readings <c>&gt; 0</c>), the <c>stats.hasTirePressure</c> gate and the
/// conditional <c>&lt;Line&gt;</c> / stat-tile composition in
/// web/src/features/driving/components/drive-detail/TirePressureSection.tsx (+ useDriveDetailData.ts). SI
/// Pascals are divided to kilopascals and converted to the user's display unit here (and only here, via
/// <see cref="UnitConverters.PressureFromSi"/>); every label resolves through the i18n facade and the
/// per-series colours map onto the shared categorical chart palette (FL / FR / RL / RR → indices 0..3).
/// </summary>
public static class TirePressureSectionProjection
{
    /// <summary>Segoe Fluent gauge glyph (web <c>Activity</c> empty icon) for the empty state.</summary>
    public const string GaugeGlyph = "\uE9D9";

    /// <summary>Categorical palette index of the front-left tyre series.</summary>
    public const int FrontLeftColorIndex = 0;

    /// <summary>Categorical palette index of the front-right tyre series.</summary>
    public const int FrontRightColorIndex = 1;

    /// <summary>Categorical palette index of the rear-left tyre series.</summary>
    public const int RearLeftColorIndex = 2;

    /// <summary>Categorical palette index of the rear-right tyre series.</summary>
    public const int RearRightColorIndex = 3;

    // SI Pascals → kilopascals before the display-unit conversion (web `tp.tirePressureFl / 1000`).
    private const double PascalsPerKilopascal = 1000;

    // Native pressure readouts carry one decimal (the shared UnitFormatters pressure precision).
    private const int PressurePrecision = 1;

    /// <summary>Project <paramref name="samples"/> into the display model for <paramref name="units"/>.</summary>
    /// <param name="samples">The drive-telemetry samples (chronological; the projection preserves order).</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); only pressure is read.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <returns>The render-ready display model.</returns>
    public static TirePressureSectionDisplay Project(
        IReadOnlyList<TirePressureSample> samples,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(samples);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var pressureUnit = units.Pressure;
        string unitLabel = UnitLabels.Label(pressureUnit);

        var frontLeft = BuildChannel(samples, static s => s.FrontLeftPa, pressureUnit);
        var frontRight = BuildChannel(samples, static s => s.FrontRightPa, pressureUnit);
        var rearLeft = BuildChannel(samples, static s => s.RearLeftPa, pressureUnit);
        var rearRight = BuildChannel(samples, static s => s.RearRightPa, pressureUnit);

        // Web gate: stats.hasTirePressure = chartData.some(d => d.tireFl !== null || … ).
        bool hasData = frontLeft.Points.Count > 0
            || frontRight.Points.Count > 0
            || rearLeft.Points.Count > 0
            || rearRight.Points.Count > 0;

        var series = new List<TirePressureSectionSeries>(4);
        var tiles = new List<TirePressureSectionTile>(4);

        if (hasData)
        {
            AddSeries(series, "fl", "driveDetail.frontLeftShort", "FL", "driveDetail.frontLeft", "Front Left", FrontLeftColorIndex, frontLeft, unitLabel, localizer);
            AddSeries(series, "fr", "driveDetail.frontRightShort", "FR", "driveDetail.frontRight", "Front Right", FrontRightColorIndex, frontRight, unitLabel, localizer);
            AddSeries(series, "rl", "driveDetail.rearLeftShort", "RL", "driveDetail.rearLeft", "Rear Left", RearLeftColorIndex, rearLeft, unitLabel, localizer);
            AddSeries(series, "rr", "driveDetail.rearRightShort", "RR", "driveDetail.rearRight", "Rear Right", RearRightColorIndex, rearRight, unitLabel, localizer);

            // Web parity: all four corner tiles always render when hasTirePressure (each shows its min–max
            // range, or an em dash when that corner reported nothing positive).
            AddTile(tiles, "driveDetail.frontLeft", "Front Left", FrontLeftColorIndex, frontLeft, unitLabel, localizer);
            AddTile(tiles, "driveDetail.frontRight", "Front Right", FrontRightColorIndex, frontRight, unitLabel, localizer);
            AddTile(tiles, "driveDetail.rearLeft", "Rear Left", RearLeftColorIndex, rearLeft, unitLabel, localizer);
            AddTile(tiles, "driveDetail.rearRight", "Rear Right", RearRightColorIndex, rearRight, unitLabel, localizer);
        }

        return new TirePressureSectionDisplay(
            HasData: hasData,
            Title: localizer.GetString("driveDetail.tirePressure", "Tire Pressure During Drive"),
            ChartAriaLabel: localizer.GetString(
                "driveDetail.tirePressure.aria",
                "Front and rear tire pressure lines over the drive timeline"),
            EmptyMessage: localizer.GetString("driveDetail.noChartData", "No telemetry data available"),
            Tiles: tiles,
            Series: series);
    }

    /// <summary>Project the empty (no drive / no tyre-pressure channel) display using the localizer.</summary>
    /// <param name="units">The user's unit preference.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <returns>An empty, no-data display carrying the localized chrome.</returns>
    public static TirePressureSectionDisplay Empty(UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);
        return Project(Array.Empty<TirePressureSample>(), units, localizer);
    }

    private static TireChannel BuildChannel(
        IReadOnlyList<TirePressureSample> samples,
        Func<TirePressureSample, double?> selector,
        PressureUnit pressureUnit)
    {
        var points = new List<TirePressureSectionPoint>(samples.Count);
        double min = double.PositiveInfinity;
        double max = double.NegativeInfinity;
        bool hasRange = false;
        for (int i = 0; i < samples.Count; i++)
        {
            if (selector(samples[i]) is not { } pascals)
            {
                continue;
            }

            double display = UnitConverters.PressureFromSi(pascals / PascalsPerKilopascal, pressureUnit);
            points.Add(new TirePressureSectionPoint(i, display, TimeLabel(samples[i].TimestampUtc)));

            // Web parity: the tile min/max filters `v != null && v > 0`; the line keeps every non-null point.
            if (display > 0)
            {
                hasRange = true;
                if (display < min)
                {
                    min = display;
                }

                if (display > max)
                {
                    max = display;
                }
            }
        }

        return new TireChannel(points, hasRange ? min : null, hasRange ? max : null);
    }

    private static void AddSeries(
        List<TirePressureSectionSeries> series,
        string key,
        string shortKey,
        string shortFallback,
        string fullKey,
        string fullFallback,
        int colorIndex,
        TireChannel channel,
        string unitLabel,
        ILocalizer localizer)
    {
        if (channel.Points.Count == 0)
        {
            return;
        }

        // Web parity: name={`FL (${pressureUnit})`} — abbreviated corner plus the active unit.
        string shortLabel = localizer.GetString(shortKey, shortFallback);
        string label = string.Format(CultureInfo.CurrentCulture, "{0} ({1})", shortLabel, unitLabel);
        string fullLabel = localizer.GetString(fullKey, fullFallback);
        string automationName = string.Format(CultureInfo.CurrentCulture, "{0}: {1}", fullLabel, channel.Points.Count);
        series.Add(new TirePressureSectionSeries(key, label, colorIndex, channel.Points, automationName));
    }

    private static void AddTile(
        List<TirePressureSectionTile> tiles,
        string labelKey,
        string labelFallback,
        int colorIndex,
        TireChannel channel,
        string unitLabel,
        ILocalizer localizer)
    {
        string label = localizer.GetString(labelKey, labelFallback);
        string accent = ChartPalette.KeyForIndex(colorIndex);
        if (channel.Min is { } min && channel.Max is { } max)
        {
            // Web parity: `${fmtNumber(min)}–${fmtNumber(max)} ${pressureUnit}` (en dash between the bounds).
            string minText = ScalarFormatters.FormatNumber(min, PressurePrecision);
            string maxText = ScalarFormatters.FormatNumber(max, PressurePrecision);
            string value = string.Format(CultureInfo.CurrentCulture, "{0}\u2013{1}", minText, maxText);
            string automationName = string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unitLabel);
            tiles.Add(new TirePressureSectionTile(label, value, unitLabel, accent, automationName));
        }
        else
        {
            // Web parity: the corner with no positive reading shows a bare em dash and no unit.
            const string EmDash = "\u2014";
            string automationName = string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, EmDash);
            tiles.Add(new TirePressureSectionTile(label, EmDash, string.Empty, accent, automationName));
        }
    }

    private static string TimeLabel(DateTimeOffset? timestamp) =>
        timestamp is { } ts
            ? ts.ToLocalTime().ToString("HH:mm", CultureInfo.CurrentCulture)
            : "\u2014";

    private sealed record TireChannel(IReadOnlyList<TirePressureSectionPoint> Points, double? Min, double? Max);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;TirePressureSample&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class TirePressureSectionResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission.</param>
    /// <returns>The typed emission with the same status / freshness.</returns>
    public static RepositoryResult<IReadOnlyList<TirePressureSample>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<TirePressureSample> Parse() =>
            raw.HasValue ? TirePressureSample.ParseList(raw.Value) : Array.Empty<TirePressureSample>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<TirePressureSample>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<TirePressureSample>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<TirePressureSample>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<TirePressureSample>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<TirePressureSample>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<TirePressureSample>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<TirePressureSample>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Tire-Pressure surface — the native mirror of the web component
/// (web/src/features/driving/components/drive-detail/TirePressureSection.tsx). Centralises the stable id, the
/// diagnostics slug and the localized title so the view and view-model stay free of literal copy.
/// </summary>
public static class TirePressureSectionRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "tire-pressure-section";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "TirePressureSection";

    /// <summary>Localized surface title (web <c>driveDetail.tirePressure</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized "Tire Pressure During Drive" title.</returns>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("driveDetail.tirePressure", "Tire Pressure During Drive");
    }
}

/// <summary>
/// PII-safe diagnostics for the Tire-Pressure surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a pressure value, VIN or drive id — so a
/// diagnostics line can never leak drive data. Thread-safe.
/// </summary>
public sealed class TirePressureSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Optional sink invoked with each diagnostics line.</param>
    public TirePressureSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TirePressureSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TirePressureSectionRegistration.Slug}");
    }
}
