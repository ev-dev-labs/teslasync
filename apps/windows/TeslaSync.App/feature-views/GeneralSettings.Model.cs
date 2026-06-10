using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="GeneralSettingsViewModel"/> can be in — the native
/// union of the branches the web <c>GeneralSettings</c>
/// (web/src/features/settings/components/GeneralSettings.tsx) renders, widened to the full P2 cache-then-network
/// state matrix. The web component hydrates an editable form from <c>useSettings()</c> and shows a five-block
/// skeleton while that query is in flight; because the native surface owns its own cache-then-network read of
/// <c>GET /settings</c>, it reproduces the full loading / loaded / empty / error / stale / offline matrix the
/// P2 contract requires. Every value maps onto a visible surface (never a blank panel): <see cref="Loaded"/>,
/// <see cref="Empty"/>, <see cref="Stale"/> and <see cref="Offline"/> render the full settings form (seeded
/// with the cached/fresh document or the privacy-first defaults), <see cref="Loading"/> shows the skeleton
/// chrome and <see cref="Error"/> the retry affordance.
/// </summary>
public enum GeneralSettingsState
{
    /// <summary>Initial fetch with no cached settings document — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh settings document arrived — render the full form bound to it.</summary>
    Loaded,

    /// <summary>The settings document resolved empty — render the full form seeded with defaults.</summary>
    Empty,

    /// <summary>The read failed and no cached document exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached document older than the freshness window — render the form plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached document remains — render the form plus an offline chip.</summary>
    Offline,
}

// The distance / temperature / pressure preferences reuse the shared display-unit enums from
// TeslaSync.App.Core.Units (DistanceUnit{Km,Mi,Ft}, TemperatureUnit{Celsius,Fahrenheit},
// PressureUnit{Kpa,Psi,Bar}) so the settings form and the rest of the app agree on a single type.

/// <summary>The preferred range readout (web <c>preferred_range</c> — <c>rated</c> / <c>ideal</c>).</summary>
public enum PreferredRange
{
    /// <summary>Rated range (web <c>rated</c>).</summary>
    Rated,

    /// <summary>Ideal range (web <c>ideal</c>).</summary>
    Ideal,
}

/// <summary>The default time-zone display (web <c>tz_display_default</c> — <c>vehicle</c> / <c>user</c> / <c>utc</c>).</summary>
public enum TimeZoneDisplay
{
    /// <summary>The vehicle's local time (web <c>vehicle</c>, the recommended default).</summary>
    Vehicle,

    /// <summary>The user's local time (web <c>user</c>).</summary>
    User,

    /// <summary>UTC (web <c>utc</c>).</summary>
    Utc,
}

/// <summary>The gas-price denominator for the EV-vs-ICE comparison (web <c>gas_unit</c> — <c>gallon</c> / <c>liter</c>).</summary>
public enum GasUnit
{
    /// <summary>Per gallon (web <c>gallon</c>).</summary>
    Gallon,

    /// <summary>Per litre (web <c>liter</c>).</summary>
    Liter,
}

/// <summary>
/// The canonical wire tokens + enum mapping for the unit/range/timezone/gas preferences. Kept in one place so
/// the parse (<see cref="GeneralServerSettings.FromJson"/>) and the full-replace save body
/// (<see cref="GeneralServerSettings.ToRequestBody"/>) agree exactly with the Go API's snake_case JSON. WinUI-free
/// so the mapping is unit-tested without a UI host.
/// </summary>
public static class GeneralWire
{
    /// <summary>The <c>unit_of_length</c> settings key.</summary>
    public const string DistanceKey = "unit_of_length";

    /// <summary>The <c>unit_of_temp</c> settings key.</summary>
    public const string TemperatureKey = "unit_of_temp";

    /// <summary>The <c>unit_of_pressure</c> settings key.</summary>
    public const string PressureKey = "unit_of_pressure";

    /// <summary>The <c>preferred_range</c> settings key.</summary>
    public const string PreferredRangeKey = "preferred_range";

    /// <summary>The <c>decimal_precision</c> settings key.</summary>
    public const string DecimalPrecisionKey = "decimal_precision";

    /// <summary>The <c>language</c> settings key.</summary>
    public const string LanguageKey = "language";

    /// <summary>The <c>currency_symbol</c> settings key.</summary>
    public const string CurrencyKey = "currency_symbol";

    /// <summary>The <c>locale</c> settings key.</summary>
    public const string LocaleKey = "locale";

    /// <summary>The <c>tz_display_default</c> settings key.</summary>
    public const string TzDisplayKey = "tz_display_default";

    /// <summary>The <c>timezone_user</c> settings key.</summary>
    public const string TimezoneUserKey = "timezone_user";

    /// <summary>The <c>base_cost_per_kwh</c> settings key.</summary>
    public const string BaseCostPerKwhKey = "base_cost_per_kwh";

    /// <summary>The <c>gas_price_per_unit</c> settings key.</summary>
    public const string GasPriceKey = "gas_price_per_unit";

    /// <summary>The <c>gas_unit</c> settings key.</summary>
    public const string GasUnitKey = "gas_unit";

    /// <summary>The <c>gas_efficiency_mpg</c> settings key.</summary>
    public const string GasEfficiencyKey = "gas_efficiency_mpg";

    /// <summary>The wire token for a <see cref="DistanceUnit"/>.</summary>
    public static string Token(DistanceUnit value) => value == DistanceUnit.Mi ? "mi" : "km";

    /// <summary>The wire token for a <see cref="TemperatureUnit"/>.</summary>
    public static string Token(TemperatureUnit value) => value == TemperatureUnit.Fahrenheit ? "F" : "C";

    /// <summary>The wire token for a <see cref="PressureUnit"/>.</summary>
    public static string Token(PressureUnit value) => value == PressureUnit.Psi ? "psi" : "bar";

    /// <summary>The wire token for a <see cref="PreferredRange"/>.</summary>
    public static string Token(PreferredRange value) => value == PreferredRange.Ideal ? "ideal" : "rated";

    /// <summary>The wire token for a <see cref="TimeZoneDisplay"/>.</summary>
    public static string Token(TimeZoneDisplay value) => value switch
    {
        TimeZoneDisplay.User => "user",
        TimeZoneDisplay.Utc => "utc",
        _ => "vehicle",
    };

    /// <summary>The wire token for a <see cref="GasUnit"/>.</summary>
    public static string Token(GasUnit value) => value == GasUnit.Liter ? "liter" : "gallon";

    /// <summary>Parses a <c>unit_of_length</c> token, defaulting to <see cref="DistanceUnit.Km"/>.</summary>
    public static DistanceUnit ParseDistance(string? token) =>
        string.Equals(token?.Trim(), "mi", StringComparison.OrdinalIgnoreCase) ? DistanceUnit.Mi : DistanceUnit.Km;

    /// <summary>Parses a <c>unit_of_temp</c> token, defaulting to <see cref="TemperatureUnit.Celsius"/>.</summary>
    public static TemperatureUnit ParseTemperature(string? token) =>
        string.Equals(token?.Trim(), "F", StringComparison.OrdinalIgnoreCase)
            ? TemperatureUnit.Fahrenheit
            : TemperatureUnit.Celsius;

    /// <summary>Parses a <c>unit_of_pressure</c> token, defaulting to <see cref="PressureUnit.Bar"/>.</summary>
    public static PressureUnit ParsePressure(string? token) =>
        string.Equals(token?.Trim(), "psi", StringComparison.OrdinalIgnoreCase) ? PressureUnit.Psi : PressureUnit.Bar;

    /// <summary>Parses a <c>preferred_range</c> token, defaulting to <see cref="PreferredRange.Rated"/>.</summary>
    public static PreferredRange ParsePreferredRange(string? token) =>
        string.Equals(token?.Trim(), "ideal", StringComparison.OrdinalIgnoreCase)
            ? PreferredRange.Ideal
            : PreferredRange.Rated;

    /// <summary>Parses a <c>tz_display_default</c> token, defaulting to <see cref="TimeZoneDisplay.Vehicle"/>.</summary>
    public static TimeZoneDisplay ParseTzDisplay(string? token) => token?.Trim().ToLowerInvariant() switch
    {
        "user" => TimeZoneDisplay.User,
        "utc" => TimeZoneDisplay.Utc,
        _ => TimeZoneDisplay.Vehicle,
    };

    /// <summary>Parses a <c>gas_unit</c> token, defaulting to <see cref="GasUnit.Gallon"/>.</summary>
    public static GasUnit ParseGasUnit(string? token) =>
        string.Equals(token?.Trim(), "liter", StringComparison.OrdinalIgnoreCase) ? GasUnit.Liter : GasUnit.Gallon;
}

/// <summary>
/// The Tesla-enum interpretation helpers the "Sync from Car" flow uses — the native port of
/// web/src/lib/parseSettingEnum.ts. Tesla Fleet Telemetry sends unit settings as prefixed enum strings
/// (<c>DistanceUnitMiles</c>, <c>TemperatureUnitCelsius</c>, <c>PressureUnitPsi</c>, …); these helpers strip the
/// prefix to a clean display value and detect the imperial/metric intent the sync button maps onto the form.
/// Pure — unit-tested without a UI host.
/// </summary>
public static class SettingEnumParser
{
    private static readonly IReadOnlyDictionary<string, string> Distance = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["distanceunitmiles"] = "Miles",
        ["distanceunitkilometers"] = "Kilometers",
        ["distanceunitkm"] = "Kilometers",
        ["miles"] = "Miles",
        ["mi"] = "Miles",
        ["km"] = "Kilometers",
        ["kilometers"] = "Kilometers",
    };

    private static readonly IReadOnlyDictionary<string, string> Temperature = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["temperatureunitcelsius"] = "Celsius",
        ["temperatureunitfahrenheit"] = "Fahrenheit",
        ["celsius"] = "Celsius",
        ["fahrenheit"] = "Fahrenheit",
        ["c"] = "Celsius",
        ["f"] = "Fahrenheit",
    };

    private static readonly IReadOnlyDictionary<string, string> Pressure = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["pressureunitpsi"] = "PSI",
        ["pressureunitbar"] = "Bar",
        ["pressureunitkpa"] = "kPa",
        ["psi"] = "PSI",
        ["bar"] = "Bar",
        ["kpa"] = "kPa",
    };

    /// <summary>The display categories the parser recognises (web <c>keyof typeof enumMappings</c>).</summary>
    public enum Category
    {
        /// <summary>Distance units.</summary>
        Distance,

        /// <summary>Temperature units.</summary>
        Temperature,

        /// <summary>Tyre-pressure units.</summary>
        Pressure,
    }

    /// <summary>Clean display value for a raw Tesla setting enum, falling back to the em-dash (web parity).</summary>
    public static string Parse(string? value, Category category)
    {
        if (string.IsNullOrEmpty(value))
        {
            return "\u2014";
        }

        var lower = StripToLetters(value);
        var table = category switch
        {
            Category.Distance => Distance,
            Category.Temperature => Temperature,
            _ => Pressure,
        };

        return table.TryGetValue(lower, out var display) ? display : value;
    }

    /// <summary>True when the raw distance setting means imperial/miles (web <c>isSettingMiles</c>).</summary>
    public static bool IsMiles(string? value) => Contains(value, "mile");

    /// <summary>True when the raw temperature setting means Fahrenheit (web <c>isSettingFahrenheit</c>).</summary>
    public static bool IsFahrenheit(string? value) => Contains(value, "fahr");

    /// <summary>True when the raw pressure setting means PSI (web <c>isSettingPSI</c>).</summary>
    public static bool IsPsi(string? value) => Contains(value, "psi");

    /// <summary>True when the raw pressure setting means Bar (web <c>isSettingBar</c>).</summary>
    public static bool IsBar(string? value) => Contains(value, "bar");

    private static bool Contains(string? value, string needle) =>
        !string.IsNullOrEmpty(value) && value.ToLowerInvariant().Contains(needle, StringComparison.Ordinal);

    private static string StripToLetters(string value)
    {
        var letters = new List<char>(value.Length);
        foreach (var ch in value.ToLowerInvariant())
        {
            if (ch is >= 'a' and <= 'z')
            {
                letters.Add(ch);
            }
        }

        return new string(letters.ToArray());
    }
}

/// <summary>
/// The editable form values the web <c>GeneralSettings</c> binds to its controls — the fourteen preference fields
/// the user can change before pressing Save. Mirrors the web <c>AppSettings</c> subset the form mutates, with the
/// same privacy-first defaults as the web <c>DEFAULT_FORM</c>. Pure value record so the dirty check is a structural
/// comparison and the projection is unit-tested without a UI host.
/// </summary>
/// <param name="DistanceUnit">Distance unit (web <c>unit_of_length</c>).</param>
/// <param name="TemperatureUnit">Temperature unit (web <c>unit_of_temp</c>).</param>
/// <param name="PressureUnit">Tyre-pressure unit (web <c>unit_of_pressure</c>).</param>
/// <param name="PreferredRange">Preferred range readout (web <c>preferred_range</c>).</param>
/// <param name="DecimalPrecision">Decimal precision 0–20 (web <c>decimal_precision</c>).</param>
/// <param name="Language">UI language code (web <c>language</c>).</param>
/// <param name="CurrencySymbol">Currency glyph (web <c>currency_symbol</c>).</param>
/// <param name="Locale">Number &amp; date locale (web <c>locale</c>).</param>
/// <param name="TzDisplayDefault">Default time-zone display (web <c>tz_display_default</c>).</param>
/// <param name="TimezoneUser">IANA tz override (web <c>timezone_user</c>).</param>
/// <param name="BaseCostPerKwh">Electricity cost per kWh (web <c>base_cost_per_kwh</c>).</param>
/// <param name="GasPricePerUnit">Gas price per unit (web <c>gas_price_per_unit</c>).</param>
/// <param name="GasUnit">Gas price denominator (web <c>gas_unit</c>).</param>
/// <param name="GasEfficiencyMpg">Comparison vehicle MPG (web <c>gas_efficiency_mpg</c>).</param>
public sealed record GeneralFormValues(
    DistanceUnit DistanceUnit,
    TemperatureUnit TemperatureUnit,
    PressureUnit PressureUnit,
    PreferredRange PreferredRange,
    int DecimalPrecision,
    string Language,
    string CurrencySymbol,
    string Locale,
    TimeZoneDisplay TzDisplayDefault,
    string TimezoneUser,
    double BaseCostPerKwh,
    double GasPricePerUnit,
    GasUnit GasUnit,
    double GasEfficiencyMpg)
{
    /// <summary>The privacy-first defaults used while the read is in flight or the document is absent/empty (web <c>DEFAULT_FORM</c>).</summary>
    public static GeneralFormValues Default { get; } = new(
        DistanceUnit.Km,
        TemperatureUnit.Celsius,
        PressureUnit.Bar,
        PreferredRange.Rated,
        2,
        "en",
        "$",
        "en-US",
        TimeZoneDisplay.Vehicle,
        string.Empty,
        0.12,
        3.50,
        GasUnit.Gallon,
        25);

    /// <summary>The smallest allowed decimal precision (web <c>Math.max(0, …)</c>).</summary>
    public const int MinPrecision = 0;

    /// <summary>The largest allowed decimal precision (web <c>Math.min(20, …)</c>).</summary>
    public const int MaxPrecision = 20;

    /// <summary>This form with the decimal precision clamped to the web 0–20 range.</summary>
    public GeneralFormValues WithDecimalPrecision(int value) =>
        this with { DecimalPrecision = Math.Max(MinPrecision, Math.Min(MaxPrecision, value)) };

    /// <summary>The decimal-precision preview string (web <c>(14.248539).toFixed(decimal_precision)</c>).</summary>
    public string PrecisionPreview() =>
        (14.248539).ToString("F" + Math.Max(MinPrecision, Math.Min(MaxPrecision, DecimalPrecision)), CultureInfo.InvariantCulture);
}

/// <summary>
/// The fourteen editable preferences plus the rest of the settings document. The web reads these from
/// <c>useSettings()</c> and — because <c>PUT /settings</c> is full-replace (not patch) — saves with the
/// partial-merge pattern <c>{ ...settings, …fields }</c>. <see cref="Raw"/> preserves every other top-level field
/// of the document so <see cref="ToRequestBody"/> reproduces that lossless full-replace merge. WinUI-free so the
/// parse and merge are unit-tested without a UI host.
/// </summary>
/// <param name="Form">The fourteen editable preference values parsed from the document.</param>
/// <param name="Raw">Every top-level field of the document (detached clones) for the lossless save.</param>
public sealed record GeneralServerSettings(
    GeneralFormValues Form,
    IReadOnlyDictionary<string, JsonElement> Raw)
{
    /// <summary>The defaults used while the read is in flight or the document is absent/empty.</summary>
    public static GeneralServerSettings Default { get; } = new(
        GeneralFormValues.Default,
        new Dictionary<string, JsonElement>(StringComparer.Ordinal));

    /// <summary>
    /// Project a <c>GET /settings</c> JSON object into the editable preferences, tolerating an absent/non-object
    /// body (returns <see cref="Default"/>) and absent/invalid fields (each falls back to its default). Every other
    /// top-level field is preserved in <see cref="Raw"/> so a later save round-trips the whole document.
    /// </summary>
    public static GeneralServerSettings FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Default;
        }

        var raw = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
        {
            raw[property.Name] = property.Value.Clone();
        }

        var defaults = GeneralFormValues.Default;
        var form = new GeneralFormValues(
            GeneralWire.ParseDistance(GetString(element, GeneralWire.DistanceKey)),
            GeneralWire.ParseTemperature(GetString(element, GeneralWire.TemperatureKey)),
            GeneralWire.ParsePressure(GetString(element, GeneralWire.PressureKey)),
            GeneralWire.ParsePreferredRange(GetString(element, GeneralWire.PreferredRangeKey)),
            ClampPrecision(GetInt(element, GeneralWire.DecimalPrecisionKey, defaults.DecimalPrecision)),
            GetNonEmptyString(element, GeneralWire.LanguageKey, defaults.Language),
            GetNonEmptyString(element, GeneralWire.CurrencyKey, defaults.CurrencySymbol),
            GetNonEmptyString(element, GeneralWire.LocaleKey, defaults.Locale),
            GeneralWire.ParseTzDisplay(GetString(element, GeneralWire.TzDisplayKey)),
            GetString(element, GeneralWire.TimezoneUserKey) ?? defaults.TimezoneUser,
            GetDouble(element, GeneralWire.BaseCostPerKwhKey, defaults.BaseCostPerKwh),
            GetDouble(element, GeneralWire.GasPriceKey, defaults.GasPricePerUnit),
            GeneralWire.ParseGasUnit(GetString(element, GeneralWire.GasUnitKey)),
            GetDouble(element, GeneralWire.GasEfficiencyKey, defaults.GasEfficiencyMpg));

        return new GeneralServerSettings(form, raw);
    }

    /// <summary>The settings document with this form applied (the web <c>setForm</c>).</summary>
    public GeneralServerSettings WithForm(GeneralFormValues form)
    {
        ArgumentNullException.ThrowIfNull(form);
        return this with { Form = form };
    }

    /// <summary>
    /// The full-replace <c>PUT /settings</c> body: every preserved field from <see cref="Raw"/> plus the fourteen
    /// editable keys authored from the current <see cref="Form"/> (the web <c>{ ...settings, …fields }</c> merge).
    /// The fourteen keys are always authored from the typed form so a stale raw value cannot win.
    /// </summary>
    public IReadOnlyDictionary<string, object?> ToRequestBody()
    {
        var body = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var (key, value) in Raw)
        {
            body[key] = value;
        }

        body[GeneralWire.DistanceKey] = GeneralWire.Token(Form.DistanceUnit);
        body[GeneralWire.TemperatureKey] = GeneralWire.Token(Form.TemperatureUnit);
        body[GeneralWire.PressureKey] = GeneralWire.Token(Form.PressureUnit);
        body[GeneralWire.PreferredRangeKey] = GeneralWire.Token(Form.PreferredRange);
        body[GeneralWire.DecimalPrecisionKey] = Form.DecimalPrecision;
        body[GeneralWire.LanguageKey] = Form.Language;
        body[GeneralWire.CurrencyKey] = Form.CurrencySymbol;
        body[GeneralWire.LocaleKey] = Form.Locale;
        body[GeneralWire.TzDisplayKey] = GeneralWire.Token(Form.TzDisplayDefault);
        body[GeneralWire.TimezoneUserKey] = Form.TimezoneUser;
        body[GeneralWire.BaseCostPerKwhKey] = Form.BaseCostPerKwh;
        body[GeneralWire.GasPriceKey] = Form.GasPricePerUnit;
        body[GeneralWire.GasUnitKey] = GeneralWire.Token(Form.GasUnit);
        body[GeneralWire.GasEfficiencyKey] = Form.GasEfficiencyMpg;
        return body;
    }

    private static int ClampPrecision(int value) =>
        Math.Max(GeneralFormValues.MinPrecision, Math.Min(GeneralFormValues.MaxPrecision, value));

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static string GetNonEmptyString(JsonElement obj, string name, string fallback)
    {
        var value = GetString(obj, name);
        return string.IsNullOrWhiteSpace(value) ? fallback : value;
    }

    private static double GetDouble(JsonElement obj, string name, double fallback)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return fallback;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var d) => d,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => fallback,
        };
    }

    private static int GetInt(JsonElement obj, string name, int fallback)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return fallback;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt32(out var i) => i,
            JsonValueKind.Number when v.TryGetDouble(out var d) => (int)d,
            JsonValueKind.String when int.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => fallback,
        };
    }
}

/// <summary>
/// The vehicle's own unit/clock display preferences from <c>GET /user-preferences/latest</c> — the native
/// analogue of the web <c>UserPreferenceLatest</c> (web/src/api/hooks/useSettings.ts). Drives the optional
/// "Sync from Car" banner and the read-only clock-format banner. Field names mirror the Go API's snake_case JSON
/// tags; parsing is null-tolerant so a partial body never throws. Pure data — unit-tested without a UI host.
/// </summary>
/// <param name="DistanceUnit">The car's raw distance-unit enum (web <c>setting_distance_unit</c>), nullable.</param>
/// <param name="TemperatureUnit">The car's raw temperature-unit enum (web <c>setting_temperature_unit</c>), nullable.</param>
/// <param name="PressureUnit">The car's raw tyre-pressure-unit enum (web <c>setting_tire_pressure_unit</c>), nullable.</param>
/// <param name="Is24HourClock">The car's clock format (web <c>setting_24hr_time</c>), null when not reported.</param>
public sealed record CarPreferences(
    string? DistanceUnit,
    string? TemperatureUnit,
    string? PressureUnit,
    bool? Is24HourClock)
{
    /// <summary>True when at least one unit preference is present (web <c>carPrefs.setting_distance_unit || …</c>).</summary>
    public bool HasUnitInfo =>
        !string.IsNullOrWhiteSpace(DistanceUnit) || !string.IsNullOrWhiteSpace(TemperatureUnit);

    /// <summary>True when a clock-format preference is present (web <c>carPrefs.setting_24hr_time != null</c>).</summary>
    public bool HasClockInfo => Is24HourClock is not null;

    /// <summary>Parse the latest user-preference envelope, tolerating an absent/non-object body.</summary>
    public static CarPreferences? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new CarPreferences(
            GetString(element, "setting_distance_unit"),
            GetString(element, "setting_temperature_unit"),
            GetString(element, "setting_tire_pressure_unit"),
            GetBool(element, "setting_24hr_time"));
    }

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

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
}

/// <summary>
/// A minimal vehicle identity from <c>GET /vehicles</c> — the native analogue of the web <c>useVehicles()</c>
/// list, of which the component reads only <c>vehicles[0].id</c> to drive the per-vehicle car-preferences read.
/// Pure data — unit-tested without a UI host.
/// </summary>
/// <param name="Id">The vehicle's numeric id (web <c>vehicles[0].id</c>).</param>
/// <param name="Name">The vehicle's display name (web <c>vehicles[0].name</c>), or empty.</param>
public sealed record VehicleSummary(long Id, string Name)
{
    /// <summary>The first vehicle in a <c>GET /vehicles</c> array, or null when the body is empty / not an array.</summary>
    public static VehicleSummary? FirstFrom(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            if (item.TryGetProperty("id", out var idProp) && idProp.ValueKind == JsonValueKind.Number && idProp.TryGetInt64(out var id))
            {
                var name = item.TryGetProperty("name", out var nameProp) && nameProp.ValueKind == JsonValueKind.String
                    ? nameProp.GetString() ?? string.Empty
                    : string.Empty;
                return new VehicleSummary(id, name);
            }
        }

        return null;
    }
}

/// <summary>The severity of a transient settings notice — the native analogue of the web toast severity.</summary>
public enum GeneralSettingsNoticeKind
{
    /// <summary>A success notice (web <c>toast.success</c>).</summary>
    Success,

    /// <summary>An informational notice (web <c>toast.info</c>).</summary>
    Info,

    /// <summary>An error notice (web <c>toast.error</c>).</summary>
    Error,
}

/// <summary>
/// A transient settings notice — the native analogue of the in-app toast the web raises from its save / sync
/// callbacks (web <c>useToast</c>). The view renders it as an InfoBar live-region line (announced to Narrator),
/// the desktop-idiomatic equivalent of a transient toast. Pure data — unit-tested without a UI host.
/// </summary>
/// <param name="Kind">The notice severity.</param>
/// <param name="Title">The resolved, localized notice title (web toast title).</param>
/// <param name="Detail">The resolved, localized supporting line (web toast description), or empty.</param>
public sealed record GeneralSettingsNotice(GeneralSettingsNoticeKind Kind, string Title, string Detail);

/// <summary>One option in a settings dropdown (web <c>Select</c> option). The <see cref="Value"/> is the wire token.</summary>
/// <param name="Value">The stored wire value (form enum token or raw string).</param>
/// <param name="Label">The localized option label.</param>
public sealed record SelectOption(string Value, string Label);

/// <summary>
/// The optional "Sync from Car" banner (web <c>carPrefs &amp;&amp; (distance || temperature)</c> block): the
/// "Car uses X / Y / Z" line, the supporting hint and the action label. Pure data — unit-tested without a UI host.
/// </summary>
/// <param name="CarUsesText">The "Car uses {distance} / {temperature} / {pressure}" line.</param>
/// <param name="Hint">The supporting hint (web <c>app.syncHint</c>).</param>
/// <param name="ActionLabel">The "Sync from Car" action label (web <c>app.syncFromCar</c>).</param>
public sealed record SyncBanner(string CarUsesText, string Hint, string ActionLabel);

/// <summary>
/// The optional read-only clock-format banner (web <c>carPrefs.setting_24hr_time != null</c> block): the label, the
/// resolved 24-hour / 12-hour value and the supporting hint. Pure data — unit-tested without a UI host.
/// </summary>
/// <param name="Label">The "Car clock format" label (web <c>app.carClockFormat</c>).</param>
/// <param name="Value">The resolved "24-hour" / "12-hour" value.</param>
/// <param name="Hint">The supporting hint (web <c>app.clockFormatHint</c>).</param>
public sealed record ClockBanner(string Label, string Value, string Hint);

/// <summary>
/// The fully projected, render-ready view of the General settings surface — every label, option list, hint and
/// banner the web <c>GeneralSettings</c> renders, with every string already resolved through the i18n facade. The
/// current field values come from the editable <see cref="GeneralFormValues"/> the view-model owns; this display
/// carries only the static chrome plus the per-vehicle banners. Pure data so every section is asserted without a UI
/// host.
/// </summary>
public sealed record GeneralSettingsDisplay(
    string Title,
    string Subtitle,
    SyncBanner? Sync,
    ClockBanner? Clock,
    string DistanceLabel,
    IReadOnlyList<SelectOption> DistanceOptions,
    string TemperatureLabel,
    IReadOnlyList<SelectOption> TemperatureOptions,
    string PressureLabel,
    IReadOnlyList<SelectOption> PressureOptions,
    string PreferredRangeLabel,
    IReadOnlyList<SelectOption> PreferredRangeOptions,
    string DecimalPrecisionLabel,
    string PreviewLabel,
    string LanguageLabel,
    IReadOnlyList<SelectOption> LanguageOptions,
    string CurrencyLabel,
    IReadOnlyList<SelectOption> CurrencyOptions,
    string LocaleLabel,
    IReadOnlyList<SelectOption> LocaleOptions,
    string TzDisplayLabel,
    IReadOnlyList<SelectOption> TzDisplayOptions,
    string TimezoneUserLabel,
    string TimezoneUserPlaceholder, // parity:allow input-hint placeholder text mirroring the web attribute, not a stub
    string TimezoneUserHint,
    string ElectricityCostLabel,
    string GasPriceLabel,
    IReadOnlyList<SelectOption> GasUnitOptions,
    string ComparisonMpgLabel,
    string MpgPlaceholder, // parity:allow input-hint placeholder text mirroring the web attribute, not a stub
    string SaveLabel,
    string SettingsSavedLabel,
    string UnsavedLabel,
    string AutomationName)
{
    /// <summary>An all-default display (no per-vehicle banners) for the loading fallback.</summary>
    public static GeneralSettingsDisplay Default(ILocalizer localizer) =>
        GeneralSettingsProjection.Project(localizer, carPrefs: null);
}

/// <summary>
/// Canonical registry metadata for the General settings surface — the native mirror of the web
/// <c>GeneralSettings</c>. The diagnostics <see cref="Slug"/> is the stable surface identifier emitted with the
/// <c>view.opened</c> event (P1/S11 diagnostics contract); the localized <see cref="Title"/> / <see cref="Subtitle"/>
/// back the surface's Narrator name and any host chrome. Every fallback equals its catalog value so a headless
/// <see cref="PassthroughLocalizer"/> renders identically to the app's resource bridge. UI-free so it is asserted in
/// tests without a XAML host.
/// </summary>
public static class GeneralSettingsRegistration
{
    /// <summary>Stable kebab-case surface id.</summary>
    public const string Id = "general-settings";

    /// <summary>Surface category (the web component lives under the settings feature).</summary>
    public const string Category = "settings";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "GeneralSettings";

    /// <summary>Localized surface title (web <c>t('app.title', 'Application')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("translation.app.title", "Application");
    }

    /// <summary>Localized surface subtitle (web <c>t('app.subtitle', …)</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("translation.app.subtitle", "Units, language, and cost preferences");
    }
}

/// <summary>
/// Pure projection from the localizer (+ optional per-vehicle preferences) to the render-ready
/// <see cref="GeneralSettingsDisplay"/> — the native port of the static render logic in
/// web/src/features/settings/components/GeneralSettings.tsx. Every label, option label, hint and banner string
/// resolves through the i18n facade with the web English literal as the fallback, so the resource keys are asserted
/// in tests and resolved for real in the app. WinUI-free — unit-tested without a UI host.
/// </summary>
public static class GeneralSettingsProjection
{
    /// <summary>Project the localized chrome (+ optional car-preference banners) into the render-ready display.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="carPrefs">The vehicle's reported preferences, or null when unavailable.</param>
    public static GeneralSettingsDisplay Project(ILocalizer localizer, CarPreferences? carPrefs)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var title = localizer.GetString("translation.app.title", "Application");
        var subtitle = localizer.GetString("translation.app.subtitle", "Units, language, and cost preferences");

        return new GeneralSettingsDisplay(
            title,
            subtitle,
            BuildSyncBanner(localizer, carPrefs),
            BuildClockBanner(localizer, carPrefs),
            localizer.GetString("translation.app.distanceUnit", "Distance Unit"),
            new[]
            {
                new SelectOption(GeneralWire.Token(DistanceUnit.Km), localizer.GetString("translation.app.kilometers", "Kilometers")),
                new SelectOption(GeneralWire.Token(DistanceUnit.Mi), localizer.GetString("translation.app.miles", "Miles")),
            },
            localizer.GetString("translation.app.temperatureUnit", "Temperature Unit"),
            new[]
            {
                new SelectOption(GeneralWire.Token(TemperatureUnit.Celsius), localizer.GetString("translation.app.celsius", "Celsius")),
                new SelectOption(GeneralWire.Token(TemperatureUnit.Fahrenheit), localizer.GetString("translation.app.fahrenheit", "Fahrenheit")),
            },
            localizer.GetString("translation.app.pressureUnit", "Pressure Unit"),
            new[]
            {
                new SelectOption(GeneralWire.Token(PressureUnit.Bar), localizer.GetString("translation.app.bar", "Bar")),
                new SelectOption(GeneralWire.Token(PressureUnit.Psi), localizer.GetString("translation.app.psi", "PSI")),
            },
            localizer.GetString("translation.app.preferredRange", "Preferred Range"),
            new[]
            {
                new SelectOption(GeneralWire.Token(PreferredRange.Rated), localizer.GetString("translation.app.rated", "Rated")),
                new SelectOption(GeneralWire.Token(PreferredRange.Ideal), localizer.GetString("translation.app.ideal", "Ideal")),
            },
            localizer.GetString("translation.app.decimalPrecision", "Decimal Precision"),
            localizer.GetString("translation.app.preview", "Preview"),
            localizer.GetString("translation.app.language", "Language"),
            new[]
            {
                new SelectOption("en", "English"),
                new SelectOption("de", "Deutsch"),
                new SelectOption("fr", "Fran\u00e7ais"),
                new SelectOption("es", "Espa\u00f1ol"),
                new SelectOption("zh", "\u4e2d\u6587"),
            },
            localizer.GetString("translation.app.currency", "Currency"),
            new[]
            {
                new SelectOption("$", "USD ($)"),
                new SelectOption("\u20ac", "EUR (\u20ac)"),
                new SelectOption("\u00a3", "GBP (\u00a3)"),
                new SelectOption("C$", "CAD (C$)"),
                new SelectOption("A$", "AUD (A$)"),
                new SelectOption("\u00a5", "JPY (\u00a5)"),
                new SelectOption("\u5143", "CNY (\u5143)"),
                new SelectOption("CHF", "CHF (CHF)"),
                new SelectOption("kr", "SEK / NOK / DKK (kr)"),
                new SelectOption("\u20b9", "INR (\u20b9)"),
            },
            localizer.GetString("translation.app.locale", "Number & Date Locale"),
            new[]
            {
                new SelectOption("en-US", "English (US) \u2014 1,234.56"),
                new SelectOption("en-GB", "English (UK) \u2014 1,234.56"),
                new SelectOption("de-DE", "Deutsch (DE) \u2014 1.234,56"),
                new SelectOption("fr-FR", "Fran\u00e7ais (FR) \u2014 1 234,56"),
                new SelectOption("es-ES", "Espa\u00f1ol (ES) \u2014 1.234,56"),
                new SelectOption("ja-JP", "\u65e5\u672c\u8a9e (JP) \u2014 1,234.56"),
                new SelectOption("zh-CN", "\u7b80\u4f53\u4e2d\u6587 (CN) \u2014 1,234.56"),
            },
            localizer.GetString("translation.app.tzDisplayDefault", "Time Zone Display"),
            new[]
            {
                new SelectOption(GeneralWire.Token(TimeZoneDisplay.Vehicle), localizer.GetString("translation.app.tzVehicle", "Vehicle's local time (recommended)")),
                new SelectOption(GeneralWire.Token(TimeZoneDisplay.User), localizer.GetString("translation.app.tzUser", "My local time")),
                new SelectOption(GeneralWire.Token(TimeZoneDisplay.Utc), localizer.GetString("translation.app.tzUtc", "UTC")),
            },
            localizer.GetString("translation.app.timezoneUser", "My Time Zone Override"),
            localizer.GetString("translation.app.timezoneUserPlaceholder", "e.g. America/Los_Angeles (leave blank for browser default)"), // parity:allow input-hint placeholder text mirroring the web attribute, not a stub
            localizer.GetString("translation.app.timezoneUserHint", "IANA tz name. Useful when travelling but you'd rather see times in your home zone."),
            localizer.GetString("translation.app.electricityCost", "Electricity Cost (per kWh)"),
            localizer.GetString("translation.app.gasPrice", "Gas Price (for EV vs ICE comparison)"),
            new[]
            {
                new SelectOption(GeneralWire.Token(GasUnit.Gallon), localizer.GetString("translation.app.perGallon", "/ gallon")),
                new SelectOption(GeneralWire.Token(GasUnit.Liter), localizer.GetString("translation.app.perLiter", "/ liter")),
            },
            localizer.GetString("translation.app.comparisonMPG", "Comparison Vehicle MPG"),
            localizer.GetString("translation.app.mpgPlaceholder", "Average MPG of equivalent gas car"), // parity:allow input-hint placeholder text mirroring the web attribute, not a stub
            localizer.GetString("translation.app.save", "Save Settings"),
            localizer.GetString("translation.app.settingsSaved", "Settings saved"),
            localizer.GetString("translation.forms.unsavedSettings", "You have unsaved settings."),
            title);
    }

    /// <summary>
    /// Compose the "Units synced from car" toast detail (web parity): "{Distance}: {Miles|Kilometers}, {Temperature}:
    /// {Fahrenheit|Celsius}, {Pressure}: {PSI|Bar}", each part defaulting to the metric branch when the corresponding
    /// unit was not changed (the web reads <c>updates.unit_*</c>, which is undefined for an unchanged unit).
    /// </summary>
    public static string ComposeSyncDetail(
        ILocalizer localizer,
        DistanceUnit? distance,
        TemperatureUnit? temperature,
        PressureUnit? pressure)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var distanceLabel = localizer.GetString("translation.distance", "Distance");
        var temperatureLabel = localizer.GetString("translation.temperature", "Temperature");
        var pressureLabel = localizer.GetString("translation.pressure", "Pressure");

        var distanceValue = distance == DistanceUnit.Mi
            ? localizer.GetString("translation.miles", "Miles")
            : localizer.GetString("translation.kilometers", "Kilometers");
        var temperatureValue = temperature == TemperatureUnit.Fahrenheit
            ? localizer.GetString("translation.fahrenheit", "Fahrenheit")
            : localizer.GetString("translation.celsius", "Celsius");
        var pressureValue = pressure == PressureUnit.Psi ? "PSI" : "Bar";

        return string.Create(
            CultureInfo.CurrentCulture,
            $"{distanceLabel}: {distanceValue}, {temperatureLabel}: {temperatureValue}, {pressureLabel}: {pressureValue}");
    }

    private static SyncBanner? BuildSyncBanner(ILocalizer localizer, CarPreferences? carPrefs)
    {
        if (carPrefs is null || !carPrefs.HasUnitInfo)
        {
            return null;
        }

        var distance = SettingEnumParser.Parse(carPrefs.DistanceUnit, SettingEnumParser.Category.Distance);
        var temperature = SettingEnumParser.Parse(carPrefs.TemperatureUnit, SettingEnumParser.Category.Temperature);
        var pressure = SettingEnumParser.Parse(carPrefs.PressureUnit, SettingEnumParser.Category.Pressure);
        var carUses = localizer.GetString("translation.app.carUses", "Car uses");

        return new SyncBanner(
            string.Create(CultureInfo.CurrentCulture, $"{carUses} {distance} / {temperature} / {pressure}"),
            localizer.GetString("translation.app.syncHint", "Sync your app's units to match your vehicle's display settings"),
            localizer.GetString("translation.app.syncFromCar", "Sync from Car"));
    }

    private static ClockBanner? BuildClockBanner(ILocalizer localizer, CarPreferences? carPrefs)
    {
        if (carPrefs is null || !carPrefs.HasClockInfo)
        {
            return null;
        }

        var value = carPrefs.Is24HourClock == true
            ? localizer.GetString("translation.app.clock24h", "24-hour")
            : localizer.GetString("translation.app.clock12h", "12-hour");

        return new ClockBanner(
            localizer.GetString("translation.app.carClockFormat", "Car clock format"),
            value,
            localizer.GetString("translation.app.clockFormatHint", "Your vehicle's time display preference (read-only)"));
    }
}

/// <summary>
/// PII-safe diagnostics for the General settings surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a preference value or any user data — so a diagnostics line
/// can never leak operational data. Thread-safe.
/// </summary>
public sealed class GeneralSettingsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public GeneralSettingsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=GeneralSettings</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={GeneralSettingsRegistration.Slug}");
    }
}
