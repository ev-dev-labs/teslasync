using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="TemperatureSectionViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches a P2 feature surface must render for the web
/// drive-detail Temperatures chart
/// (web/src/features/driving/components/drive-detail/TemperatureSection.tsx). The web component is a pure
/// child of the Drive-Detail page that draws a friendly "No temperature telemetry is available for this
/// drive." empty state when its <c>chartData</c> prop holds one sample or fewer or carries no temperature
/// channel; the native feature-view owns its cache-then-network drive-telemetry read and therefore renders
/// the full state matrix. Every branch maps onto a visible surface; none is hidden. <see cref="Empty"/>
/// mirrors the web <c>chartData.length &gt; 1 &amp;&amp; stats.hasAnyTemp</c> gate (no vehicle, no drive, a
/// curve too short to plot, or a drive with no temperature samples) and is distinct from a transport failure
/// (<see cref="Error"/>).
/// </summary>
public enum TemperatureSectionState
{
    /// <summary>Initial fetch with no cached telemetry — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) drive trace carrying at least two temperature-bearing samples.</summary>
    Loaded,

    /// <summary>No vehicle / drive resolved, a curve too short to plot, or no temperature data — render the empty state.</summary>
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
/// <c>DriveTelemetryPoint</c> in <c>@/types/driving</c>). Only the fields the web Temperatures chart reads
/// are kept: the timestamp (X axis), the four SI Celsius cabin/ambient temperatures
/// (<c>outside_temp</c> / <c>inside_temp</c> / <c>driver_temp</c> / <c>passenger_temp</c>), the climate
/// on/off flag (<c>is_climate_on</c>) and the fan-speed reading (<c>fan_status</c>). Parsing is null-tolerant
/// so a partial row never throws and a missing channel stays null (the chart connects across the gap,
/// mirroring the web per-channel <c>!== null</c> filter). Temperatures stay SI Celsius — converted to the
/// user's display unit only at projection time.
/// </summary>
/// <param name="TimestampUtc">Sample instant, or null (web <c>tp.createdAt ?? tp.created_at ?? tp.timestamp</c>).</param>
/// <param name="OutsideTempC">Ambient temperature in SI Celsius, or null (web <c>outsideTemp</c>).</param>
/// <param name="InsideTempC">Cabin temperature in SI Celsius, or null (web <c>insideTemp</c>).</param>
/// <param name="DriverTempC">Driver set temperature in SI Celsius, or null (web <c>driverTemp</c>).</param>
/// <param name="PassengerTempC">Passenger set temperature in SI Celsius, or null (web <c>passengerTemp</c>).</param>
/// <param name="ClimateOn">Climate on/off flag, or null when absent (web <c>isClimateOn</c>).</param>
/// <param name="FanStatus">Fan-speed reading, or null when absent (web <c>fanStatus</c>).</param>
public sealed record TemperatureSample(
    DateTimeOffset? TimestampUtc,
    double? OutsideTempC,
    double? InsideTempC,
    double? DriverTempC,
    double? PassengerTempC,
    bool? ClimateOn,
    double? FanStatus)
{
    /// <summary>Parse a drive-telemetry JSON array into a tolerant list of samples, preserving order.</summary>
    /// <param name="element">The raw telemetry JSON (an array; any other kind yields an empty list).</param>
    /// <returns>The parsed samples in wire order, skipping non-object rows.</returns>
    public static IReadOnlyList<TemperatureSample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TemperatureSample>();
        }

        var list = new List<TemperatureSample>(element.GetArrayLength());
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
    public static TemperatureSample FromJson(JsonElement obj) => new(
        // Web parity: the hook reads `tp.createdAt ?? tp.created_at ?? tp.timestamp`; the Go telemetry
        // handler emits `created_at`, so try `timestamp` first then `created_at`.
        GetDateTime(obj, "timestamp") ?? GetDateTime(obj, "created_at"),
        GetDouble(obj, "outside_temp"),
        GetDouble(obj, "inside_temp"),
        GetDouble(obj, "driver_temp"),
        GetDouble(obj, "passenger_temp"),
        GetBool(obj, "is_climate_on"),
        GetDouble(obj, "fan_status"));

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

    private static bool? GetBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
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
/// One projected, render-ready point of a temperature line — the native analogue of a single web
/// <c>ChartDataPoint</c> temperature reading. Holds the X-axis <see cref="Index"/> (the sample's ordinal in
/// the trace, shared across every channel), the converted display-unit <see cref="ValueDisplay"/> and the
/// 24-hour local <see cref="TimeLabel"/> shown in the tooltip. Pure data so the geometry is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Index">Zero-based sample ordinal (the shared X position).</param>
/// <param name="ValueDisplay">Temperature in the user's display unit.</param>
/// <param name="TimeLabel">24-hour local <c>HH:mm</c> label for the tooltip.</param>
public sealed record TemperatureSectionPoint(int Index, double ValueDisplay, string TimeLabel);

/// <summary>
/// One temperature line series — the native analogue of a web <c>&lt;Line&gt;</c> in the recharts
/// <c>LineChart</c>. Holds the localized <see cref="Label"/> (carrying the active temperature unit, e.g.
/// "Outside °C"), the categorical palette <see cref="ColorIndex"/> tinting the line + legend swatch, the
/// converted <see cref="Points"/> and the Narrator <see cref="AutomationName"/>. A series is present only
/// when at least one sample carries its channel (web <c>stats.outsideTemps.length &gt; 0</c>). Pure data.
/// </summary>
/// <param name="Key">Stable channel key (<c>outside</c> / <c>inside</c> / <c>driver</c> / <c>passenger</c>).</param>
/// <param name="Label">Localized series label including the temperature unit.</param>
/// <param name="ColorIndex">Zero-based brand-palette index tinting the line and legend swatch.</param>
/// <param name="Points">The converted, display-unit points (gaps omitted, connected across).</param>
/// <param name="AutomationName">Spoken summary of the series (label + sample count).</param>
public sealed record TemperatureSectionSeries(
    string Key,
    string Label,
    int ColorIndex,
    IReadOnlyList<TemperatureSectionPoint> Points,
    string AutomationName);

/// <summary>
/// One projected, display-ready stat tile shown above the chart — the native analogue of a web stat tile
/// (the small <c>rounded-lg</c> cards over the trace). Holds the localized <see cref="Label"/>, the
/// already-formatted <see cref="Value"/>, the optional <see cref="Unit"/> suffix (the temperature unit for
/// the four temperature tiles; empty for the climate / fan tiles), the accent token brush key and the
/// Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Label">Localized tile label (e.g. "Outside Temperature").</param>
/// <param name="Value">Formatted tile value (temperature number, climate status, or fan summary).</param>
/// <param name="Unit">Unit suffix shown beside the value (temperature unit, or empty).</param>
/// <param name="AccentBrushKey">Token brush key for the tile accent.</param>
/// <param name="AutomationName">Narrator name combining the label, value and unit.</param>
public sealed record TemperatureSectionTile(
    string Label,
    string Value,
    string Unit,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Temperatures surface — the native analogue of everything the
/// web component computes before returning its <c>ChartContainer</c>. Carries the always-present chrome
/// strings (title / chart aria / empty message), the <see cref="HasData"/> gate
/// (web <c>chartData.length &gt; 1 &amp;&amp; stats.hasAnyTemp</c>), the conditional stat <see cref="Tiles"/>
/// (outside / inside / driver / passenger / climate / fan) and the present line <see cref="Series"/>. Pure
/// data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when there are ≥2 samples and at least one temperature channel (web gate).</param>
/// <param name="Title">Localized surface title (web "Temperatures").</param>
/// <param name="ChartAriaLabel">Localized chart Narrator label.</param>
/// <param name="EmptyMessage">Localized empty-state message.</param>
/// <param name="Tiles">The conditional stat tiles, in web order.</param>
/// <param name="Series">The present temperature line series, in web order.</param>
public sealed record TemperatureSectionDisplay(
    bool HasData,
    string Title,
    string ChartAriaLabel,
    string EmptyMessage,
    IReadOnlyList<TemperatureSectionTile> Tiles,
    IReadOnlyList<TemperatureSectionSeries> Series);

/// <summary>
/// Pure projection from the raw drive-telemetry samples to the display model — the native port of the web
/// <c>chartData</c> temperature mapping (<c>convertTempFromSI</c>), the <c>stats</c> rollup (per-channel
/// averages, climate status, fan avg/max, <c>hasAnyTemp</c>) and the conditional <c>&lt;Line&gt;</c> / stat
/// tile gates in web/src/features/driving/components/drive-detail/TemperatureSection.tsx
/// (+ useDriveDetailData.ts). SI Celsius is converted to the user's display unit here (and only here, via
/// <see cref="UnitConverters.TemperatureFromSi"/>); every label resolves through the i18n facade and the
/// per-series colours map onto the shared categorical chart palette.
/// </summary>
public static class TemperatureSectionProjection
{
    /// <summary>Segoe Fluent thermometer glyph (web <c>Activity</c> empty icon) for the empty state.</summary>
    public const string ThermometerGlyph = "\uE9CA";

    /// <summary>Categorical palette index of the outside (ambient) temperature series.</summary>
    public const int OutsideColorIndex = 0;

    /// <summary>Categorical palette index of the inside (cabin) temperature series.</summary>
    public const int InsideColorIndex = 1;

    /// <summary>Categorical palette index of the driver set-temperature series.</summary>
    public const int DriverColorIndex = 2;

    /// <summary>Categorical palette index of the passenger set-temperature series.</summary>
    public const int PassengerColorIndex = 3;

    /// <summary>Categorical palette index of the fan-status tile accent.</summary>
    public const int FanColorIndex = 4;

    private const int TemperaturePrecision = 1;
    private const int FanPrecision = 0;

    /// <summary>Project <paramref name="samples"/> into the display model for <paramref name="units"/>.</summary>
    /// <param name="samples">The drive-telemetry samples (chronological; the projection preserves order).</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); only temperature is read.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <returns>The render-ready display model.</returns>
    public static TemperatureSectionDisplay Project(
        IReadOnlyList<TemperatureSample> samples,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(samples);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var temperatureUnit = units.Temperature;
        string unitLabel = UnitLabels.Label(temperatureUnit);

        var outside = BuildChannel(samples, static s => s.OutsideTempC, temperatureUnit);
        var inside = BuildChannel(samples, static s => s.InsideTempC, temperatureUnit);
        var driver = BuildChannel(samples, static s => s.DriverTempC, temperatureUnit);
        var passenger = BuildChannel(samples, static s => s.PassengerTempC, temperatureUnit);

        bool hasAnyTemp = outside.Points.Count > 0
            || inside.Points.Count > 0
            || driver.Points.Count > 0
            || passenger.Points.Count > 0;

        // Web gate: chartData.length > 1 && stats.hasAnyTemp.
        bool hasData = samples.Count > 1 && hasAnyTemp;

        var series = new List<TemperatureSectionSeries>(4);
        var tiles = new List<TemperatureSectionTile>(6);

        if (hasData)
        {
            AddSeries(series, "outside", "driveDetail.outside", "Outside", OutsideColorIndex, outside, unitLabel, localizer);
            AddSeries(series, "inside", "driveDetail.inside", "Inside", InsideColorIndex, inside, unitLabel, localizer);
            AddSeries(series, "driver", "driveDetail.driver", "Driver", DriverColorIndex, driver, unitLabel, localizer);
            AddSeries(series, "passenger", "driveDetail.passenger", "Passenger", PassengerColorIndex, passenger, unitLabel, localizer);

            AddTemperatureTile(tiles, "driveDetail.outsideTemp", "Outside Temperature", outside, OutsideColorIndex, unitLabel, localizer);
            AddTemperatureTile(tiles, "driveDetail.insideTemp", "Inside Temperature", inside, InsideColorIndex, unitLabel, localizer);
            AddTemperatureTile(tiles, "driveDetail.driverTemp", "Driver Temperature", driver, DriverColorIndex, unitLabel, localizer);
            AddTemperatureTile(tiles, "driveDetail.passengerTemp", "Passenger Temperature", passenger, PassengerColorIndex, unitLabel, localizer);
            AddClimateTile(tiles, samples, localizer);
            AddFanTile(tiles, samples, localizer);
        }

        return new TemperatureSectionDisplay(
            HasData: hasData,
            Title: localizer.GetString("driveDetail.temperatures", "Temperatures"),
            ChartAriaLabel: localizer.GetString(
                "driveDetail.temperatures.aria",
                "Inside, outside, driver and passenger temperature lines over the drive timeline"),
            EmptyMessage: localizer.GetString(
                "driveDetail.noTemperatureData",
                "No temperature telemetry is available for this drive."),
            Tiles: tiles,
            Series: series);
    }

    /// <summary>Project the empty (no drive / too-short / no-temperature) display using the localizer.</summary>
    /// <param name="units">The user's unit preference.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <returns>An empty, no-data display carrying the localized chrome.</returns>
    public static TemperatureSectionDisplay Empty(UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);
        return Project(Array.Empty<TemperatureSample>(), units, localizer);
    }

    private static TemperatureChannel BuildChannel(
        IReadOnlyList<TemperatureSample> samples,
        Func<TemperatureSample, double?> selector,
        TemperatureUnit temperatureUnit)
    {
        var points = new List<TemperatureSectionPoint>(samples.Count);
        double sum = 0;
        for (int i = 0; i < samples.Count; i++)
        {
            if (selector(samples[i]) is not { } celsius)
            {
                continue;
            }

            double display = UnitConverters.TemperatureFromSi(celsius, temperatureUnit);
            points.Add(new TemperatureSectionPoint(i, display, TimeLabel(samples[i].TimestampUtc)));
            sum += display;
        }

        double? average = points.Count > 0 ? sum / points.Count : null;
        return new TemperatureChannel(points, average);
    }

    private static void AddSeries(
        List<TemperatureSectionSeries> series,
        string key,
        string labelKey,
        string labelFallback,
        int colorIndex,
        TemperatureChannel channel,
        string unitLabel,
        ILocalizer localizer)
    {
        if (channel.Points.Count == 0)
        {
            return;
        }

        // Web parity: name={`${t('driveDetail.outside','Outside')} ${tempUnit}`}.
        string label = string.Format(
            CultureInfo.CurrentCulture, "{0} {1}", localizer.GetString(labelKey, labelFallback), unitLabel);
        string automationName = string.Format(
            CultureInfo.CurrentCulture, "{0}: {1}", label, channel.Points.Count);
        series.Add(new TemperatureSectionSeries(key, label, colorIndex, channel.Points, automationName));
    }

    private static void AddTemperatureTile(
        List<TemperatureSectionTile> tiles,
        string labelKey,
        string labelFallback,
        TemperatureChannel channel,
        int colorIndex,
        string unitLabel,
        ILocalizer localizer)
    {
        if (channel.Average is not { } average)
        {
            return;
        }

        string label = localizer.GetString(labelKey, labelFallback);
        string value = ScalarFormatters.FormatNumber(average, TemperaturePrecision);
        string automationName = string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unitLabel);
        tiles.Add(new TemperatureSectionTile(label, value, unitLabel, ChartPalette.KeyForIndex(colorIndex), automationName));
    }

    private static void AddClimateTile(
        List<TemperatureSectionTile> tiles,
        IReadOnlyList<TemperatureSample> samples,
        ILocalizer localizer)
    {
        int onCount = 0;
        int offCount = 0;
        foreach (var sample in samples)
        {
            if (sample.ClimateOn is true)
            {
                onCount++;
            }
            else if (sample.ClimateOn is false)
            {
                offCount++;
            }
        }

        // Web parity: climateOnCount > 0 ? (climateOnCount >= climateOffCount ? 'On' : 'Mostly Off')
        //                                : (climateOffCount > 0 ? 'Off' : null).
        string key;
        string fallback;
        bool on;
        if (onCount > 0)
        {
            on = true;
            if (onCount >= offCount)
            {
                key = "driveDetail.climateOn";
                fallback = "On";
            }
            else
            {
                key = "driveDetail.climateMostlyOff";
                fallback = "Mostly Off";
            }
        }
        else if (offCount > 0)
        {
            on = false;
            key = "driveDetail.climateOff";
            fallback = "Off";
        }
        else
        {
            return;
        }

        string label = localizer.GetString("driveDetail.climate", "Climate");
        string value = localizer.GetString(key, fallback);

        // Web accent: text-green-400 when 'On', muted otherwise.
        string accent = on ? StatusResources.AccentBrushKey(StatusKind.Success) : "TsColorTextSecondaryBrush";
        string automationName = string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);
        tiles.Add(new TemperatureSectionTile(label, value, string.Empty, accent, automationName));
    }

    private static void AddFanTile(
        List<TemperatureSectionTile> tiles,
        IReadOnlyList<TemperatureSample> samples,
        ILocalizer localizer)
    {
        double sum = 0;
        int count = 0;
        double max = double.NegativeInfinity;
        foreach (var sample in samples)
        {
            if (sample.FanStatus is not { } fan)
            {
                continue;
            }

            sum += fan;
            count++;
            if (fan > max)
            {
                max = fan;
            }
        }

        if (count == 0)
        {
            return;
        }

        // Web parity: `${t('driveDetail.avg','Avg')} ${fmtInt(stats.avgFanSpeed)} · Max ${stats.maxFanSpeed}`.
        string avgLabel = localizer.GetString("driveDetail.avg", "Avg");
        string maxLabel = localizer.GetString("driveDetail.max", "Max");
        string avgValue = ScalarFormatters.FormatNumber(sum / count, FanPrecision);
        string maxValue = ScalarFormatters.FormatNumber(max, FanPrecision);
        string label = localizer.GetString("driveDetail.fanStatus", "Fan Status");
        string value = string.Format(
            CultureInfo.CurrentCulture, "{0} {1} \u00B7 {2} {3}", avgLabel, avgValue, maxLabel, maxValue);
        string automationName = string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);
        tiles.Add(new TemperatureSectionTile(label, value, string.Empty, ChartPalette.KeyForIndex(FanColorIndex), automationName));
    }

    private static string TimeLabel(DateTimeOffset? timestamp) =>
        timestamp is { } ts
            ? ts.ToLocalTime().ToString("HH:mm", CultureInfo.CurrentCulture)
            : "\u2014";

    private sealed record TemperatureChannel(IReadOnlyList<TemperatureSectionPoint> Points, double? Average);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;TemperatureSample&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class TemperatureSectionResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission.</param>
    /// <returns>The typed emission with the same status / freshness.</returns>
    public static RepositoryResult<IReadOnlyList<TemperatureSample>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<TemperatureSample> Parse() =>
            raw.HasValue ? TemperatureSample.ParseList(raw.Value) : Array.Empty<TemperatureSample>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<TemperatureSample>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<TemperatureSample>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<TemperatureSample>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<TemperatureSample>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<TemperatureSample>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<TemperatureSample>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<TemperatureSample>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Temperatures surface — the native mirror of the web component
/// (web/src/features/driving/components/drive-detail/TemperatureSection.tsx). Centralises the stable id, the
/// diagnostics slug and the localized title so the view and view-model stay free of literal copy.
/// </summary>
public static class TemperatureSectionRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "temperature-section";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "TemperatureSection";

    /// <summary>Localized surface title (web <c>driveDetail.temperatures</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized "Temperatures" title.</returns>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("driveDetail.temperatures", "Temperatures");
    }
}

/// <summary>
/// PII-safe diagnostics for the Temperatures surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a temperature value, VIN or drive id —
/// so a diagnostics line can never leak drive data. Thread-safe.
/// </summary>
public sealed class TemperatureSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Optional sink invoked with each diagnostics line.</param>
    public TemperatureSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TemperatureSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TemperatureSectionRegistration.Slug}");
    }
}
