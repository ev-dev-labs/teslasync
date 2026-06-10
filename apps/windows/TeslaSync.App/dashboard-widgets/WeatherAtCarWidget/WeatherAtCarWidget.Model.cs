using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="WeatherAtCarViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>WeatherAtCarWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/WeatherAtCarWidget.tsx). Every branch maps
/// onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web
/// <c>hasData = outsideTemp != null</c> gate (no resolved vehicle, no state in the response, or a state with no
/// outside temperature) — the "No weather data" surface.
/// </summary>
public enum WeatherAtCarState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying an outside temperature to render.</summary>
    Loaded,

    /// <summary>No vehicle resolved, no state, or no outside temperature — render the "No weather data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the readout plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the readout plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The three fields the weather surface reads from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of
/// the exact <c>VehicleState</c> slice the web widget consumes (<c>state.outside_temp</c> in SI Celsius, plus
/// <c>state.latitude</c> / <c>state.longitude</c> in degrees, web/src/api/types). Display conversion of the
/// temperature happens only at projection time via the shared <see cref="UnitConverters"/>; the coordinates are
/// rendered verbatim like the web <c>toFixed(2)</c>. Parsing mirrors the web <c>useVehicleState</c>
/// normalisation (shared with the native <c>RangeBarWidget</c> / <c>GeofenceWidget</c>): a <see langword="null"/>
/// parse result models <c>stateData?.state</c> being undefined (no state → the empty surface), while a present
/// state with an absent <c>outside_temp</c> yields a reading whose <see cref="OutsideTempC"/> is
/// <see langword="null"/> so the view-model still collapses to the empty surface (web <c>outsideTemp != null</c>).
/// Parsing is null-tolerant so a partial body never throws.
/// </summary>
/// <param name="OutsideTempC">Ambient temperature in SI Celsius, or null (web <c>state.outside_temp</c>).</param>
/// <param name="Latitude">Vehicle latitude in degrees, or null (web <c>state.latitude</c>).</param>
/// <param name="Longitude">Vehicle longitude in degrees, or null (web <c>state.longitude</c>).</param>
public sealed record WeatherAtCarReading(double? OutsideTempC, double? Latitude, double? Longitude)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the weather slice, mirroring the
    /// normalisation in the web <c>useVehicleState</c> hook: prefer the canonical <c>state</c> object (the one
    /// carrying <c>vehicle_id</c>), otherwise fall back to a plain <c>state</c> object, otherwise reconstruct
    /// from the <c>position</c> snapshot when a <c>vehicle</c>/<c>position</c> is present (in which case the web
    /// hook defaults <c>outside_temp</c> / <c>latitude</c> / <c>longitude</c> to <c>0</c>). Returns
    /// <see langword="null"/> when none of those yield a state — the native analogue of the web <c>state</c>
    /// being undefined (the empty surface).
    /// </summary>
    public static WeatherAtCarReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        // Web parity (primary): res.state with a vehicle_id is the canonical SignalStore state object.
        if (Object(root, "state") is { } state && Has(state, "vehicle_id"))
        {
            return FromStateObject(state);
        }

        var vehicle = Object(root, "vehicle");
        var position = Object(root, "position");
        if (vehicle is null && position is null)
        {
            // Web parity: a plain state object is still usable, otherwise there is no state and the widget
            // shows its empty surface.
            return Object(root, "state") is { } plain ? FromStateObject(plain) : null;
        }

        // Web parity (fallback): the hook synthesises the state from the position snapshot, defaulting the
        // outside temperature and coordinates to 0 (p?.outside_temp ?? 0, p?.latitude ?? 0, p?.longitude ?? 0).
        return position is { } p
            ? new WeatherAtCarReading(
                ReadDouble(p, "outside_temp") ?? 0,
                ReadDouble(p, "latitude") ?? 0,
                ReadDouble(p, "longitude") ?? 0)
            : new WeatherAtCarReading(0, 0, 0);
    }

    private static WeatherAtCarReading FromStateObject(JsonElement state) => new(
        OutsideTempC: ReadDouble(state, "outside_temp"),
        Latitude: ReadDouble(state, "latitude"),
        Longitude: ReadDouble(state, "longitude"));

    private static JsonElement? Object(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object &&
        parent.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.Object
            ? value
            : null;

    private static bool Has(JsonElement obj, string name) => obj.TryGetProperty(name, out _);

    private static double? ReadDouble(JsonElement obj, string name)
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
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact = size.cols === 1 &amp;&amp; size.rows === 1</c> flag in
/// web/src/features/dashboard/widgets/WeatherAtCarWidget.tsx (the title-less single-cell layout).
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct WeatherAtCarSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (1×2).</summary>
    public static WeatherAtCarSize Default => new(1, 2);

    /// <summary>
    /// True at exactly one column and one row (web <c>isCompact = size.cols === 1 &amp;&amp; size.rows === 1</c>):
    /// drop the title + coordinates and centre the condition icon over a single big temperature readout.
    /// </summary>
    public bool IsCompact => Cols == 1 && Rows == 1;
}

/// <summary>
/// The fully projected, render-ready view of the weather surface for one footprint and unit preference — the
/// native analogue of everything the web component computes before returning JSX (the unit-converted temperature
/// string, the condition icon chosen from the SI Celsius value, the localized "Outside Temperature" caption and
/// the optional coordinate line). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="IsCompact">Whether the single-cell layout is active (web <c>isCompact</c>).</param>
/// <param name="HasData">Whether an outside temperature resolved (web <c>hasData = outsideTemp != null</c>).</param>
/// <param name="TemperatureText">Pre-formatted outside temperature, e.g. "15°C" (web <c>fmtInt(convert)+unit</c>).</param>
/// <param name="ConditionGlyph">Segoe Fluent condition glyph chosen from the SI Celsius value (web <c>WeatherIcon</c>).</param>
/// <param name="OutsideLabel">Localized "Outside Temperature" caption (standard layout only).</param>
/// <param name="ShowCoordinates">Whether the lat/long line renders (web <c>!isCompact &amp;&amp; lat != null &amp;&amp; lon != null</c>).</param>
/// <param name="CoordinatesText">Pre-formatted "lat°, lon°" line, e.g. "37.50°, -122.30°" (web <c>toFixed(2)</c>).</param>
/// <param name="AutomationName">Narrator name summarising the rendered readout for the active layout.</param>
public sealed record WeatherAtCarDisplay(
    bool IsCompact,
    bool HasData,
    string TemperatureText,
    string ConditionGlyph,
    string OutsideLabel,
    bool ShowCoordinates,
    string CoordinatesText,
    string AutomationName);

/// <summary>
/// Pure projection from a raw <see cref="WeatherAtCarReading"/> to the display model — the native port of the
/// inline formatting in web/src/features/dashboard/widgets/WeatherAtCarWidget.tsx. The temperature arrives as SI
/// Celsius, so this converts to the user's display unit (web <c>convertTempFromSI(value, unitPrefs.temperature)</c>)
/// at zero fraction digits with the unit suffix appended (web <c>fmtInt(…) + tempUnit</c>); the condition glyph is
/// chosen from the <em>SI Celsius</em> value (web <c>WeatherIcon tempC={outsideTemp}</c>, never the display value);
/// the coordinate line reproduces the web <c>{lat.toFixed(2)}°, {lon.toFixed(2)}°</c>. Every label resolves
/// through the i18n facade.
/// </summary>
public static class WeatherAtCarProjection
{
    /// <summary>Segoe Fluent "PartlyCloudyDay" glyph — the web <c>CloudSun</c> header + mild-condition icon.</summary>
    public const string CloudSunGlyph = "\uE753";

    /// <summary>Segoe Fluent "Brightness" glyph — the web <c>Sun</c> warm-condition icon (≥ 25 °C).</summary>
    public const string SunGlyph = "\uE706";

    /// <summary>Segoe Fluent "Frigid" glyph — the web <c>CloudSnow</c> cold-condition icon (≤ 0 °C).</summary>
    public const string SnowGlyph = "\uEB3A";

    /// <summary>Segoe Fluent "Temperature" glyph — the web <c>Thermometer</c> empty-surface icon.</summary>
    public const string ThermometerGlyph = "\uE9CA";

    /// <summary>Temperature fraction digits (web <c>fmtInt</c> = <c>fmtNumber(…, 0)</c>).</summary>
    public const int TemperaturePrecision = 0;

    /// <summary>Coordinate fraction digits (web <c>toFixed(2)</c>).</summary>
    public const int CoordinatePrecision = 2;

    /// <summary>The cold-condition ceiling: at or below this SI Celsius value the snow icon shows (web <c>tempC &lt;= 0</c>).</summary>
    public const double ColdCelsius = 0.0;

    /// <summary>The warm-condition floor: at or above this SI Celsius value the sun icon shows (web <c>tempC &gt;= 25</c>).</summary>
    public const double WarmCelsius = 25.0;

    /// <summary>Project <paramref name="reading"/> for <paramref name="size"/> using the user's units and the localizer for every label.</summary>
    public static WeatherAtCarDisplay Project(
        WeatherAtCarReading reading,
        WeatherAtCarSize size,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        bool isCompact = size.IsCompact;

        // Web parity: hasData = outsideTemp != null (a finite SI Celsius value resolved).
        bool hasData = reading.OutsideTempC is { } t && IsFinite(t);
        double celsius = hasData ? reading.OutsideTempC!.Value : 0.0;

        string temperatureText = FormatTemperature(reading.OutsideTempC, units);
        string conditionGlyph = ConditionGlyphFor(celsius);
        string outsideLabel = localizer.GetString("widget.outsideTemp", "Outside Temperature");

        // Web parity: the coordinate line renders only in the standard layout when both fixes are present.
        bool showCoordinates =
            hasData && !isCompact && reading.Latitude is { } lat && IsFinite(lat) &&
            reading.Longitude is { } lon && IsFinite(lon);
        string coordinatesText = showCoordinates
            ? FormatCoordinates(reading.Latitude!.Value, reading.Longitude!.Value)
            : string.Empty;

        string automation = BuildAutomationName(
            hasData, isCompact, temperatureText, outsideLabel, showCoordinates, coordinatesText, localizer);

        return new WeatherAtCarDisplay(
            IsCompact: isCompact,
            HasData: hasData,
            TemperatureText: temperatureText,
            ConditionGlyph: conditionGlyph,
            OutsideLabel: outsideLabel,
            ShowCoordinates: showCoordinates,
            CoordinatesText: coordinatesText,
            AutomationName: automation);
    }

    /// <summary>
    /// Format an SI Celsius temperature the way the web does — null / non-finite → em dash, otherwise
    /// <c>fmtInt(convertTempFromSI(c, unit))</c> + the unit suffix with no separating space (e.g. "15°C").
    /// </summary>
    public static string FormatTemperature(double? celsius, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        if (celsius is not { } c || !IsFinite(c))
        {
            return UnitFormatters.DefaultEmptyDisplay;
        }

        double display = UnitConverters.TemperatureFromSi(c, units.Temperature);
        return ScalarFormatters.FormatNumber(display, TemperaturePrecision) + UnitLabels.Label(units.Temperature);
    }

    /// <summary>
    /// Choose the condition glyph from the SI Celsius value exactly like the web <c>WeatherIcon</c>: snow at or
    /// below 0 °C, sun at or above 25 °C, otherwise the partly-cloudy icon.
    /// </summary>
    public static string ConditionGlyphFor(double celsius)
    {
        if (celsius <= ColdCelsius)
        {
            return SnowGlyph;
        }

        return celsius >= WarmCelsius ? SunGlyph : CloudSunGlyph;
    }

    /// <summary>Format the coordinate line as the web does: <c>{lat.toFixed(2)}°, {lon.toFixed(2)}°</c>.</summary>
    public static string FormatCoordinates(double latitude, double longitude)
    {
        string format = "F" + CoordinatePrecision.ToString(CultureInfo.InvariantCulture);
        string lat = latitude.ToString(format, CultureInfo.InvariantCulture);
        string lon = longitude.ToString(format, CultureInfo.InvariantCulture);
        return string.Create(CultureInfo.InvariantCulture, $"{lat}\u00B0, {lon}\u00B0");
    }

    private static string BuildAutomationName(
        bool hasData,
        bool isCompact,
        string temperatureText,
        string outsideLabel,
        bool showCoordinates,
        string coordinatesText,
        ILocalizer localizer)
    {
        if (!hasData)
        {
            return localizer.GetString("widget.noWeather", "No weather data");
        }

        // Compact has no caption — still pair the label with the temperature so Narrator reads a full phrase.
        string head = string.Format(CultureInfo.CurrentCulture, "{0} {1}", outsideLabel, temperatureText);
        if (isCompact || !showCoordinates)
        {
            return head;
        }

        return string.Format(CultureInfo.CurrentCulture, "{0}, {1}", head, coordinatesText);
    }

    private static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;WeatherAtCarReading&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline). A successful emission whose body carries no usable state collapses
/// to <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>state</c> being undefined. The
/// additional <c>outsideTemp != null</c> half of the web <c>hasData</c> gate is applied by the view-model (so a
/// stale snapshot with no temperature still flows through with its freshness intact). Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class WeatherAtCarResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<WeatherAtCarReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        WeatherAtCarReading? Parse() => raw.HasValue ? WeatherAtCarReading.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<WeatherAtCarReading>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<WeatherAtCarReading>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<WeatherAtCarReading>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<WeatherAtCarReading>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<WeatherAtCarReading>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<WeatherAtCarReading>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<WeatherAtCarReading>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<WeatherAtCarReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<WeatherAtCarReading>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<WeatherAtCarReading>.Empty(raw.FetchedAt),
            _ => RepositoryResult<WeatherAtCarReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
