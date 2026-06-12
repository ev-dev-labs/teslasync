using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Which unit family a <see cref="UnitInputProps"/> represents — the native port of the web
/// <c>UnitKind</c> union (web/src/lib/unitInput.ts). Each kind fixes the canonical metric the field
/// stores (the web doc: distance =&gt; miles, speed =&gt; mph, temperature =&gt; Celsius, energy =&gt; kWh,
/// percent =&gt; 0..100, currency =&gt; as-typed) and the display unit/symbol derived from the user's
/// settings.
/// </summary>
public enum UnitInputKind
{
    /// <summary>Distance: canonical miles; display mi / km (web <c>'distance'</c>).</summary>
    Distance,

    /// <summary>Energy: canonical kWh, no per-user conversion (web <c>'energy'</c>).</summary>
    Energy,

    /// <summary>Temperature: canonical Celsius; display °C / °F (web <c>'temperature'</c>).</summary>
    Temperature,

    /// <summary>Speed: canonical mph; display mph / km/h (web <c>'speed'</c>).</summary>
    Speed,

    /// <summary>Percent: canonical 0..100, no per-user conversion (web <c>'percent'</c>).</summary>
    Percent,

    /// <summary>Currency: canonical as-typed, symbol from settings (web <c>'currency'</c>).</summary>
    Currency,
}

/// <summary>The user's length display preference — the native port of the web <c>settings.unit_of_length</c> ('mi' | 'km').</summary>
public enum UnitInputLength
{
    /// <summary>Miles (web <c>'mi'</c>) — the canonical unit for distance / speed, so no conversion.</summary>
    Miles,

    /// <summary>Kilometres (web <c>'km'</c>) — distance / speed are converted from the mile canonical.</summary>
    Kilometers,
}

/// <summary>The user's temperature display preference — the native port of the web <c>settings.unit_of_temp</c> ('C' | 'F').</summary>
public enum UnitInputTemperature
{
    /// <summary>Celsius (web <c>'C'</c>) — the canonical unit, so no conversion.</summary>
    Celsius,

    /// <summary>Fahrenheit (web <c>'F'</c>) — converted from the Celsius canonical.</summary>
    Fahrenheit,
}

/// <summary>
/// The slice of the user's settings the field reads on every render — the native analogue of the web
/// <c>useSettings()</c> result consumed by <c>&lt;UnitInput&gt;</c> (web/src/components/forms/UnitInput.tsx
/// via web/src/lib/unitInput.ts): the length and temperature display preferences, the currency symbol,
/// the display precision (web <c>decimal_precision ?? 2</c>) and the formatting culture (web
/// <c>resolveLocale(settings.locale)</c>). A null currency falls back to <c>$</c>; the precision is
/// clamped to 0..15; a null culture falls back to en-US (the floor the web <c>resolveLocale</c> applies
/// to a blank locale). Pure value type so the parse / format helpers are unit-tested headlessly.
/// </summary>
public sealed record UnitInputSettings
{
    private static readonly CultureInfo EnUs = CultureInfo.GetCultureInfo("en-US");

    /// <summary>Creates the settings slice, normalising the currency symbol, precision and culture.</summary>
    /// <param name="length">Length display preference (web <c>unit_of_length</c>).</param>
    /// <param name="temperature">Temperature display preference (web <c>unit_of_temp</c>).</param>
    /// <param name="currencySymbol">Currency adornment (web <c>currency_symbol</c>); null falls back to <c>$</c>.</param>
    /// <param name="decimalPrecision">Display fractional digits (web <c>decimal_precision ?? 2</c>); clamped 0..15.</param>
    /// <param name="culture">Formatting culture (web <c>resolveLocale(locale)</c>); null falls back to en-US.</param>
    public UnitInputSettings(
        UnitInputLength length = UnitInputLength.Miles,
        UnitInputTemperature temperature = UnitInputTemperature.Celsius,
        string currencySymbol = "$",
        int decimalPrecision = UnitInputRegistration.DefaultPrecision,
        CultureInfo? culture = null)
    {
        Length = length;
        Temperature = temperature;
        CurrencySymbol = currencySymbol ?? "$";
        DecimalPrecision = Math.Clamp(decimalPrecision, 0, 15);
        Culture = culture ?? EnUs;
    }

    /// <summary>Length display preference (web <c>unit_of_length</c>).</summary>
    public UnitInputLength Length { get; init; }

    /// <summary>Temperature display preference (web <c>unit_of_temp</c>).</summary>
    public UnitInputTemperature Temperature { get; init; }

    /// <summary>The currency adornment (web <c>currency_symbol</c>); never null.</summary>
    public string CurrencySymbol { get; init; }

    /// <summary>Display fractional digits (web <c>decimal_precision ?? 2</c>); 0..15.</summary>
    public int DecimalPrecision { get; init; }

    /// <summary>The formatting culture (web <c>resolveLocale(locale)</c>); never null.</summary>
    public CultureInfo Culture { get; init; }

    /// <summary>
    /// Build a settings slice from the raw web <c>AppSettings</c> fields, mirroring how the web component
    /// reads <c>useSettings()</c>: <c>unit_of_length</c> ('km' =&gt; kilometres, else miles),
    /// <c>unit_of_temp</c> ('F' =&gt; Fahrenheit, else Celsius), <c>currency_symbol</c>,
    /// <c>decimal_precision ?? 2</c> and <c>resolveLocale(locale)</c> (a blank locale falls back to en-US).
    /// </summary>
    /// <param name="unitOfLength">Raw web <c>unit_of_length</c> ('mi' / 'km').</param>
    /// <param name="unitOfTemp">Raw web <c>unit_of_temp</c> ('C' / 'F').</param>
    /// <param name="currencySymbol">Raw web <c>currency_symbol</c>.</param>
    /// <param name="decimalPrecision">Raw web <c>decimal_precision</c>; null falls back to the default.</param>
    /// <param name="locale">Raw web <c>locale</c>; blank falls back to en-US (web <c>resolveLocale</c>).</param>
    public static UnitInputSettings From(
        string? unitOfLength,
        string? unitOfTemp,
        string? currencySymbol,
        int? decimalPrecision,
        string? locale) =>
        new(
            string.Equals(unitOfLength, "km", StringComparison.OrdinalIgnoreCase)
                ? UnitInputLength.Kilometers
                : UnitInputLength.Miles,
            string.Equals(unitOfTemp, "F", StringComparison.OrdinalIgnoreCase)
                ? UnitInputTemperature.Fahrenheit
                : UnitInputTemperature.Celsius,
            currencySymbol ?? "$",
            decimalPrecision ?? UnitInputRegistration.DefaultPrecision,
            ResolveCulture(locale));

    /// <summary>Resolve a BCP-47 locale to a culture, falling back to en-US for blank / unknown tags (web <c>resolveLocale</c>).</summary>
    /// <param name="locale">The BCP-47 locale tag.</param>
    public static CultureInfo ResolveCulture(string? locale)
    {
        if (string.IsNullOrWhiteSpace(locale))
        {
            return EnUs;
        }

        try
        {
            return CultureInfo.GetCultureInfo(locale);
        }
        catch (CultureNotFoundException)
        {
            return EnUs;
        }
    }
}

/// <summary>
/// Pure parse / format / symbol helpers for the unit-aware field — a 1:1 port of the web
/// <c>parseForUnit</c> / <c>formatForUnit</c> / <c>unitSymbol</c> surface (web/src/lib/unitInput.ts).
/// The canonical metric stored by the field is the SAME as the web (distance =&gt; miles, speed =&gt; mph,
/// temperature =&gt; Celsius, energy =&gt; kWh, percent =&gt; 0..100, currency =&gt; as-typed): parsing
/// returns the canonical so a caller can store one value and re-render it in whatever unit the user later
/// prefers without precision loss. UI-free so the round-trip is verified headlessly; the WinUI view never
/// duplicates this math.
/// </summary>
public static class UnitFieldFormat
{
    /// <summary>1 mile = 1.609344 km exactly (web <c>KM_PER_MI</c>).</summary>
    private const double KmPerMi = 1.609344;

    /// <summary>
    /// Trailing unit tokens stripped from typed text before parsing, longest-first so 'km/h' wins over
    /// 'km' (web <c>STRIPPABLE_SUFFIXES</c>). Compared case-insensitively against the lower-cased input.
    /// </summary>
    private static readonly string[] StrippableSuffixes =
    {
        "km/h",
        "kwh",
        "mph",
        "\u00B0c",
        "\u00B0f",
        "kw",
        "mi",
        "km",
        "\u00B0",
    };

    /// <summary>
    /// Format a canonical metric value as the display text shown in the field — the native port of the web
    /// <c>formatForUnit</c>. Converts the canonical to the user's display unit, then renders it at the
    /// settings precision with no group separators (web <c>useGrouping: false</c>) and a 0..precision
    /// fractional range (trailing zeros trimmed). Returns the empty string for null / non-finite values so
    /// the field shows blank.
    /// </summary>
    /// <param name="value">The canonical metric value (web <c>value</c>); null / non-finite renders blank.</param>
    /// <param name="unit">Which unit family the field represents.</param>
    /// <param name="settings">The user's display settings.</param>
    public static string Format(double? value, UnitInputKind unit, UnitInputSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);

        if (value is not { } canonical || double.IsNaN(canonical) || double.IsInfinity(canonical))
        {
            return string.Empty;
        }

        double display = ToDisplay(canonical, unit, settings);
        return FormatNumber(display, settings.Culture, settings.DecimalPrecision);
    }

    /// <summary>
    /// Parse user-typed text into the canonical metric value — the native port of the web
    /// <c>parseForUnit</c>. Handles (in order): trim and blank =&gt; null; the leading currency symbol and
    /// accounting parentheses for negatives (currency); a trailing '%' (percent); a trailing unit suffix
    /// token (longest match); locale-aware decimal / group separators (unless <paramref name="strict"/>);
    /// then converts the parsed display value back to the canonical. Returns null for blank / unparseable
    /// input.
    /// </summary>
    /// <param name="text">The raw text the user typed.</param>
    /// <param name="unit">Which unit family the field represents.</param>
    /// <param name="settings">The user's display settings.</param>
    /// <param name="strict">
    /// When true, bypass locale-aware separator handling and parse with the invariant culture (the web
    /// <c>{ strict: true }</c> =&gt; <c>Number(raw)</c> Blocked-Path escape for ambiguous separators).
    /// </param>
    public static double? Parse(string? text, UnitInputKind unit, UnitInputSettings settings, bool strict)
    {
        ArgumentNullException.ThrowIfNull(settings);

        string raw = (text ?? string.Empty).Trim();
        if (raw.Length == 0)
        {
            return null;
        }

        if (unit == UnitInputKind.Currency)
        {
            string symbol = CurrencyMark(settings);
            if (symbol.Length > 0 && raw.StartsWith(symbol, StringComparison.Ordinal))
            {
                raw = raw[symbol.Length..].Trim();
            }

            if (raw.StartsWith('(') && raw.EndsWith(')'))
            {
                raw = "-" + raw[1..^1].Trim();
                if (symbol.Length > 0 && raw.StartsWith("-" + symbol, StringComparison.Ordinal))
                {
                    raw = "-" + raw[(1 + symbol.Length)..].Trim();
                }
            }
        }

        if (unit == UnitInputKind.Percent && raw.EndsWith('%'))
        {
            raw = raw[..^1].Trim();
        }

        string lower = raw.ToLowerInvariant();
        foreach (string suffix in StrippableSuffixes)
        {
            if (lower.EndsWith(suffix, StringComparison.Ordinal))
            {
                raw = raw[..^suffix.Length].Trim();
                break;
            }
        }

        if (raw.Length == 0)
        {
            return null;
        }

        double n;
        bool ok = strict
            ? double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out n)
            : TryParseLocale(raw, settings.Culture, out n);

        if (!ok || double.IsNaN(n) || double.IsInfinity(n))
        {
            return null;
        }

        return ToCanonical(n, unit, settings);
    }

    /// <summary>
    /// The unit symbol shown in the field's adornment — the native port of the web <c>unitSymbol</c>:
    /// 'mi'/'km', 'mph'/'km/h', '°C'/'°F', 'kWh', '%', or the currency symbol (falling back to <c>$</c>).
    /// </summary>
    /// <param name="unit">Which unit family the field represents.</param>
    /// <param name="settings">The user's display settings.</param>
    public static string Symbol(UnitInputKind unit, UnitInputSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);

        return unit switch
        {
            UnitInputKind.Distance => settings.Length == UnitInputLength.Kilometers ? "km" : "mi",
            UnitInputKind.Speed => settings.Length == UnitInputLength.Kilometers ? "km/h" : "mph",
            UnitInputKind.Temperature => settings.Temperature == UnitInputTemperature.Fahrenheit ? "\u00B0F" : "\u00B0C",
            UnitInputKind.Energy => "kWh",
            UnitInputKind.Percent => "%",
            UnitInputKind.Currency => CurrencyMark(settings),
            _ => string.Empty,
        };
    }

    private static double ToDisplay(double canonical, UnitInputKind unit, UnitInputSettings settings) => unit switch
    {
        UnitInputKind.Distance or UnitInputKind.Speed =>
            settings.Length == UnitInputLength.Kilometers ? canonical * KmPerMi : canonical,
        UnitInputKind.Temperature =>
            settings.Temperature == UnitInputTemperature.Fahrenheit ? (canonical * 9 / 5) + 32 : canonical,
        _ => canonical,
    };

    private static double ToCanonical(double display, UnitInputKind unit, UnitInputSettings settings) => unit switch
    {
        UnitInputKind.Distance or UnitInputKind.Speed =>
            settings.Length == UnitInputLength.Kilometers ? display / KmPerMi : display,
        UnitInputKind.Temperature =>
            settings.Temperature == UnitInputTemperature.Fahrenheit ? ((display - 32) * 5) / 9 : display,
        _ => display,
    };

    private static string CurrencyMark(UnitInputSettings settings)
    {
        string symbol = (settings.CurrencySymbol ?? string.Empty).Trim();
        return symbol.Length == 0 ? "$" : symbol;
    }

    private static string FormatNumber(double display, CultureInfo culture, int decimals)
    {
        int digits = Math.Clamp(decimals, 0, 15);

        // web Intl rounding mode is half-expand (round half away from zero); match it explicitly because
        // .NET's default ToString rounding is to-even.
        double rounded = Math.Round(display, digits, MidpointRounding.AwayFromZero);

        // 0..digits fractional range, trailing zeros trimmed, no group separators (web min 0 / max
        // precision / useGrouping false).
        string pattern = digits <= 0 ? "0" : "0." + new string('#', digits);
        return rounded.ToString(pattern, culture);
    }

    private static bool TryParseLocale(string text, CultureInfo culture, out double value)
    {
        value = double.NaN;
        if (string.IsNullOrEmpty(text))
        {
            return false;
        }

        string group = culture.NumberFormat.NumberGroupSeparator;
        string dec = culture.NumberFormat.NumberDecimalSeparator;

        string normalized = text;
        if (!string.IsNullOrEmpty(group) && !string.Equals(group, dec, StringComparison.Ordinal))
        {
            normalized = normalized.Replace(group, string.Empty, StringComparison.Ordinal);
        }

        if (!string.Equals(dec, ".", StringComparison.Ordinal))
        {
            normalized = normalized.Replace(dec, ".", StringComparison.Ordinal);
        }

        return double.TryParse(normalized, NumberStyles.Float, CultureInfo.InvariantCulture, out value);
    }
}

/// <summary>
/// Canonical metadata + the localized default label for the UnitInput surface — the native analogue of the
/// module-level identity of the web <c>&lt;UnitInput&gt;</c> primitive
/// (web/src/components/forms/UnitInput.tsx) and the single user-facing string in its JSDoc <c>@example</c>
/// (<c>t('chargePlanner.batteryCapacity', 'Battery Capacity')</c>). The web component is presentational and
/// fetches nothing, so this carries the diagnostics slug (P1/S11), the native automation ids, the default
/// precision (web <c>decimal_precision ?? 2</c>), the symbol adornment automation hook (web
/// <c>data-testid="unit-input-symbol"</c>) and the i18n key behind the example accessible label. UI-free so
/// every value is asserted headlessly.
/// </summary>
public static class UnitInputRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "UnitInput";

    /// <summary>
    /// The root automation id the view stamps on itself. The web field is identified by its label / role
    /// rather than a <c>data-testid</c>, so this is the native-only stable hook UI-automation tests target.
    /// </summary>
    public const string RootAutomationId = "unit-input";

    /// <summary>
    /// The automation id of the trailing unit-symbol adornment — the native port of the web
    /// <c>data-testid="unit-input-symbol"</c> span. The adornment is decorative for assistive tech
    /// (web <c>aria-hidden="true"</c>); the id exists only so UI-automation can assert the symbol.
    /// </summary>
    public const string SymbolAutomationId = "unit-input-symbol";

    /// <summary>Default fractional digits the value is displayed at (web <c>decimal_precision ?? 2</c>).</summary>
    public const int DefaultPrecision = 2;

    /// <summary>
    /// i18n key behind the example accessible label (web JSDoc
    /// <c>t('chargePlanner.batteryCapacity', 'Battery Capacity')</c>). It is the default accessible name when
    /// a host supplies neither an explicit aria label nor a visible label, so the field is never announced
    /// anonymously. The key already exists in the P1/S10 catalogue under
    /// <c>translation.chargePlanner.batteryCapacity</c> for en / ar / he.
    /// </summary>
    public const string DefaultAriaLabelKey = "translation.chargePlanner.batteryCapacity";

    /// <summary>English fallback for <see cref="DefaultAriaLabelKey"/> — the web example literal, verbatim.</summary>
    public const string DefaultAriaLabelFallback = "Battery Capacity";

    /// <summary>
    /// Resolve the default accessible label (web <c>'Battery Capacity'</c>) through the i18n facade. Used
    /// when a host passes neither an explicit aria label nor a visible label so Narrator always announces a
    /// meaningful field name.
    /// </summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string ResolveDefaultAriaLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(DefaultAriaLabelKey, DefaultAriaLabelFallback);
    }
}

/// <summary>
/// Which render branch the field is showing. The web <c>&lt;UnitInput&gt;</c> fetches no data — it only
/// reads the local <c>useSettings()</c> and its controlled <c>value</c> prop — so, exactly like the sibling
/// CurrencyInput surface, there is no loading / error / stale / offline data state. The genuine branches in
/// the web source are the populated value (a formatted unit string) and the empty field (a null
/// <c>value</c> renders a blank editable area carrying only the trailing unit-symbol affordance, never a
/// nameless blank box). The independent <see cref="UnitInputDisplay.IsEnabled"/> /
/// <see cref="UnitInputDisplay.HasError"/> flags (the web passthrough <c>disabled</c> / <c>error</c>
/// InputProps) and the focused editing buffer are layered on top of these two value states by the
/// view-model.
/// </summary>
public enum UnitInputState
{
    /// <summary>The canonical value is null / non-finite — the field shows an empty editable area with the symbol adornment.</summary>
    Empty,

    /// <summary>The canonical value is set — the field shows the formatted unit string.</summary>
    Value,
}

/// <summary>
/// The presentational inputs of the UnitInput surface — the native analogue of the props the web
/// <c>&lt;UnitInput&gt;</c> receives plus the <c>useSettings()</c> slice it reads
/// (web/src/components/forms/UnitInput.tsx). The component is fully controlled, so these are its complete
/// state: the canonical metric <see cref="Value"/> (web <c>value</c>), the <see cref="Unit"/> family (web
/// <c>unit</c>), the <see cref="Settings"/> display context (web <c>useSettings()</c>), the
/// <see cref="ParseStrict"/> escape (web <c>parseStrict</c>), the accessible label (web — for naming the
/// field), an optional visible <see cref="Label"/> forwarded to the field header (web passthrough
/// <c>label</c>) and the disabled / error passthrough flags (web passthrough <c>disabled</c> /
/// <c>error</c>). A null <see cref="Settings"/> is normalised so the projector never sees null.
/// </summary>
public sealed record UnitInputProps
{
    /// <summary>Creates the inputs, normalising the settings and aria label to safe defaults.</summary>
    /// <param name="value">Canonical metric value (web <c>value</c>); null when the field is empty.</param>
    /// <param name="unit">Which unit family the field represents (web <c>unit</c>).</param>
    /// <param name="settings">The display context (web <c>useSettings()</c>); null falls back to defaults.</param>
    /// <param name="parseStrict">Bypass locale-aware separator parsing (web <c>parseStrict</c>).</param>
    /// <param name="ariaLabel">Explicit accessible label; blank falls back to the visible label then the i18n default.</param>
    /// <param name="label">Optional visible field label (web passthrough <c>label</c>); null hides the header.</param>
    /// <param name="disabled">Whether the field is disabled (web passthrough <c>disabled</c>).</param>
    /// <param name="hasError">Whether the field is in the error state (web passthrough <c>error</c>).</param>
    public UnitInputProps(
        double? value = null,
        UnitInputKind unit = UnitInputKind.Distance,
        UnitInputSettings? settings = null,
        bool parseStrict = false,
        string? ariaLabel = null,
        string? label = null,
        bool disabled = false,
        bool hasError = false)
    {
        Value = value;
        Unit = unit;
        Settings = settings ?? new UnitInputSettings();
        ParseStrict = parseStrict;
        AriaLabel = ariaLabel ?? string.Empty;
        Label = label;
        Disabled = disabled;
        HasError = hasError;
    }

    /// <summary>Canonical metric value (web <c>value</c>); null when empty.</summary>
    public double? Value { get; init; }

    /// <summary>Which unit family the field represents (web <c>unit</c>).</summary>
    public UnitInputKind Unit { get; init; }

    /// <summary>The display context (web <c>useSettings()</c>); never null.</summary>
    public UnitInputSettings Settings { get; init; }

    /// <summary>Bypass locale-aware separator parsing (web <c>parseStrict</c>).</summary>
    public bool ParseStrict { get; init; }

    /// <summary>The explicit accessible label; may be blank (then the visible label / i18n default is used).</summary>
    public string AriaLabel { get; init; }

    /// <summary>Optional visible field label (web passthrough <c>label</c>); null hides the header.</summary>
    public string? Label { get; init; }

    /// <summary>Whether the field is disabled (web passthrough <c>disabled</c>).</summary>
    public bool Disabled { get; init; }

    /// <summary>Whether the field is in the error state (web passthrough <c>error</c>).</summary>
    public bool HasError { get; init; }
}

/// <summary>
/// The render-ready projection of one <see cref="UnitInputProps"/> — the native port of the derived values
/// the web component computes from its props + settings (web/src/components/forms/UnitInput.tsx L93-L100):
/// the formatted <see cref="FormattedValue"/> (web <c>display = formatForUnit(value, unit, settings)</c>),
/// the trailing <see cref="Symbol"/> adornment (web <c>symbol = unitSymbol(unit, settings)</c>), which value
/// <see cref="State"/> is showing, the resolved <see cref="AccessibleName"/> (the field name, with the i18n
/// default substituted when neither an aria label nor a visible label is supplied), the optional visible
/// <see cref="Label"/> header and the passthrough enabled / error flags. Pure value type so identical inputs
/// compare equal and the adapter is unit-tested without a UI thread.
/// </summary>
public readonly record struct UnitInputDisplay
{
    private UnitInputDisplay(
        UnitInputState state,
        string formattedValue,
        string symbol,
        string accessibleName,
        string? label,
        bool isEnabled,
        bool hasError)
    {
        State = state;
        FormattedValue = formattedValue;
        Symbol = symbol;
        AccessibleName = accessibleName;
        Label = label;
        IsEnabled = isEnabled;
        HasError = hasError;
    }

    /// <summary>Which value branch is showing (empty vs populated).</summary>
    public UnitInputState State { get; }

    /// <summary>
    /// The canonical formatted value for the current props (web <c>display</c>): the unit-formatted string
    /// when a value is set, or the empty string when <see cref="UnitInputState.Empty"/>. This is what the
    /// field shows when it is not being edited; the view-model re-syncs its editing buffer to this whenever
    /// the field is unfocused.
    /// </summary>
    public string FormattedValue { get; }

    /// <summary>The trailing unit-symbol adornment (web <c>symbol</c>); decorative for assistive tech.</summary>
    public string Symbol { get; }

    /// <summary>The accessible name the field announces (the aria label, the visible label, or the i18n default).</summary>
    public string AccessibleName { get; }

    /// <summary>The optional visible label header (web passthrough <c>label</c>); null hides it.</summary>
    public string? Label { get; }

    /// <summary>Whether the field accepts input (web <c>!disabled</c>).</summary>
    public bool IsEnabled { get; }

    /// <summary>Whether the field renders the error border and is announced invalid (web <c>error</c>).</summary>
    public bool HasError { get; }

    /// <summary>True while the field is empty (a null / non-finite canonical value).</summary>
    public bool IsEmpty => State == UnitInputState.Empty;

    /// <summary>True while a populated value is showing.</summary>
    public bool HasValue => State == UnitInputState.Value;

    /// <summary>True when a visible label header should be drawn.</summary>
    public bool HasLabel => !string.IsNullOrEmpty(Label);

    /// <summary>
    /// Project <paramref name="props"/> into a render-ready display, resolving the accessible name through
    /// <paramref name="localizer"/>. Reproduces the web derived values: the formatted display, the symbol
    /// adornment, the empty/value branch and the accessible-name fallback chain (aria label =&gt; visible
    /// label =&gt; i18n default). Formatting and the symbol come from the shared <see cref="UnitFieldFormat"/>
    /// helper, so a null / non-finite value formats to the empty string and the round-trip with
    /// <see cref="UnitFieldFormat.Parse"/> on commit is canonical-stable.
    /// </summary>
    /// <param name="props">The current presentational inputs.</param>
    /// <param name="localizer">The i18n facade the default accessible label resolves through.</param>
    public static UnitInputDisplay Project(UnitInputProps props, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(props);
        ArgumentNullException.ThrowIfNull(localizer);

        string formatted = UnitFieldFormat.Format(props.Value, props.Unit, props.Settings);
        string symbol = UnitFieldFormat.Symbol(props.Unit, props.Settings);
        string accessibleName = ResolveAccessibleName(props, localizer);
        string? label = string.IsNullOrWhiteSpace(props.Label) ? null : props.Label!.Trim();

        bool hasValue = props.Value is { } v && !double.IsNaN(v) && !double.IsInfinity(v);

        return new UnitInputDisplay(
            hasValue ? UnitInputState.Value : UnitInputState.Empty,
            formattedValue: formatted,
            symbol: symbol,
            accessibleName: accessibleName,
            label: label,
            isEnabled: !props.Disabled,
            hasError: props.HasError);
    }

    private static string ResolveAccessibleName(UnitInputProps props, ILocalizer localizer)
    {
        if (!string.IsNullOrWhiteSpace(props.AriaLabel))
        {
            return props.AriaLabel.Trim();
        }

        if (!string.IsNullOrWhiteSpace(props.Label))
        {
            return props.Label!.Trim();
        }

        return UnitInputRegistration.ResolveDefaultAriaLabel(localizer);
    }
}

/// <summary>
/// The payload raised when the field commits an edit — the native port of the web <c>onChange(next)</c>
/// callback. Carries the parsed canonical metric value, or null when the field was cleared.
/// </summary>
/// <param name="Value">The committed canonical metric value, or null when the field is empty.</param>
public readonly record struct UnitInputCommit(double? Value);

/// <summary>
/// PII-safe diagnostics for the UnitInput surface (P1/S11 diagnostics contract). A unit field carries a
/// figure the user typed (a capacity / speed / temperature), so the collector records ONLY the operational
/// <c>view.opened</c> signal with the surface slug — never the value, the parsed canonical or the symbol.
/// Thread-safe; mirrors the peer shared-surface diagnostics collectors.
/// </summary>
public sealed class UnitInputDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public UnitInputDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=UnitInput</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={UnitInputRegistration.Slug}");
    }
}
