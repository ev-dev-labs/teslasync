using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + localized strings for the CurrencyInput surface — the native analogue of the
/// module-level identity of the web <c>&lt;CurrencyInput&gt;</c> primitive (web/src/components/forms/CurrencyInput.tsx)
/// and the single user-facing string in its JSDoc <c>@example</c>
/// (<c>t('settings.electricityCost', 'Electricity Cost (per kWh)')</c>). The web component is a presentational,
/// currency-aware number field: it stores its value in integer micro-units (1 major unit = 1_000_000) to dodge
/// floating-point round-trip loss, renders the value formatted for the active currency/locale, parses user-typed
/// text on blur / Enter (symbol on either side, the ISO code, locale group separators, accounting parentheses for
/// negatives) and re-syncs from the parent's value only while the field is not focused. It fetches nothing, so this
/// carries the diagnostics slug (P1/S11), the native automation id, the default precision (web <c>precision ?? 2</c>),
/// the symbol adornment automation hook (web <c>data-testid="currency-input-symbol"</c>) and the i18n key behind the
/// example accessible label. UI-free so every value is asserted headlessly.
/// </summary>
public static class CurrencyInputRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "CurrencyInput";

    /// <summary>
    /// The root automation id the view stamps on itself. The web field is identified by its label / role rather
    /// than a <c>data-testid</c>, so this is the native-only stable hook UI-automation tests target.
    /// </summary>
    public const string RootAutomationId = "currency-input";

    /// <summary>
    /// The automation id of the leading currency-symbol adornment — the native port of the web
    /// <c>data-testid="currency-input-symbol"</c> span. The adornment is decorative for assistive tech
    /// (web <c>aria-hidden="true"</c>); the id exists only so UI-automation can assert the symbol.
    /// </summary>
    public const string SymbolAutomationId = "currency-input-symbol";

    /// <summary>Default fractional digits the value is displayed at (web <c>precision ?? 2</c>).</summary>
    public const int DefaultPrecision = 2;

    /// <summary>
    /// i18n key behind the example accessible label (web JSDoc
    /// <c>t('settings.electricityCost', 'Electricity Cost (per kWh)')</c>). It is the default accessible name when a
    /// host supplies a blank <c>ariaLabel</c>, so the field is never announced anonymously. The key already exists in
    /// the P1/S10 catalogue under <c>translation.settings.electricityCost</c> for en / ar / he.
    /// </summary>
    public const string DefaultAriaLabelKey = "translation.settings.electricityCost";

    /// <summary>English fallback for <see cref="DefaultAriaLabelKey"/> — the web example literal, verbatim.</summary>
    public const string DefaultAriaLabelFallback = "Electricity Cost (per kWh)";

    /// <summary>
    /// Resolve the default accessible label (web <c>'Electricity Cost (per kWh)'</c>) through the i18n facade. Used
    /// when a host passes a null/blank <c>ariaLabel</c> so Narrator always announces a meaningful field name.
    /// </summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string ResolveDefaultAriaLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(DefaultAriaLabelKey, DefaultAriaLabelFallback);
    }
}

/// <summary>
/// Which render branch the field is showing. The web <c>&lt;CurrencyInput&gt;</c> fetches no data, so — exactly like
/// the Spinner surface — there is no loading / error / stale / offline data state. The genuine branches that exist in
/// the web source are the populated value (a formatted currency string) and the empty field (a null
/// <c>valueMicro</c> renders a blank editable area carrying only the leading currency-symbol affordance, never a
/// nameless blank box). The independent <see cref="CurrencyInputDisplay.IsEnabled"/> / <see cref="CurrencyInputDisplay.HasError"/>
/// flags (the web passthrough <c>disabled</c> / <c>error</c> InputProps) and the focused editing buffer are layered
/// on top of these two value states by the view-model.
/// </summary>
public enum CurrencyInputState
{
    /// <summary>The canonical value is null — the field shows an empty editable area with the symbol adornment.</summary>
    Empty,

    /// <summary>The canonical value is set — the field shows the formatted currency string.</summary>
    Value,
}

/// <summary>
/// The presentational inputs of the CurrencyInput surface — the native analogue of the props the web
/// <c>&lt;CurrencyInput&gt;</c> receives from its parent (web/src/components/forms/CurrencyInput.tsx). The component is
/// fully controlled, so these are its complete state: the canonical micro value (web <c>valueMicro</c>), the ISO-4217
/// currency code (web <c>currency</c>), the formatting culture (web <c>locale</c> / <c>navigator.language</c>), the
/// display precision (web <c>precision</c>), the required accessible label (web <c>ariaLabel</c>), an optional visible
/// label forwarded to the field header (web passthrough <c>label</c>) and the disabled / error passthrough flags. A
/// null <see cref="Culture"/> is normalised to <see cref="CultureInfo.CurrentCulture"/> so the formatter never sees
/// null (parity with the web resolving an absent locale to <c>navigator.language</c>).
/// </summary>
public sealed record CurrencyInputProps
{
    /// <summary>Creates the inputs, normalising the culture, currency, precision and labels to safe defaults.</summary>
    /// <param name="valueMicro">Canonical integer micro-units (web <c>valueMicro</c>); null when the field is empty.</param>
    /// <param name="currency">ISO-4217 currency code (web <c>currency</c>); blank is treated as no symbol.</param>
    /// <param name="culture">Formatting culture (web <c>locale</c>); null falls back to the current culture.</param>
    /// <param name="precision">Display fractional digits (web <c>precision ?? 2</c>); clamped to 0..20.</param>
    /// <param name="ariaLabel">Required accessible label (web <c>ariaLabel</c>); blank resolves to the i18n default.</param>
    /// <param name="label">Optional visible field label (web passthrough <c>label</c>); null hides it.</param>
    /// <param name="disabled">Whether the field is disabled (web passthrough <c>disabled</c>).</param>
    /// <param name="hasError">Whether the field is in the error state (web passthrough <c>error</c>).</param>
    public CurrencyInputProps(
        long? valueMicro = null,
        string currency = "USD",
        CultureInfo? culture = null,
        int precision = CurrencyInputRegistration.DefaultPrecision,
        string? ariaLabel = null,
        string? label = null,
        bool disabled = false,
        bool hasError = false)
    {
        ValueMicro = valueMicro;
        Currency = currency ?? string.Empty;
        Culture = culture ?? CultureInfo.CurrentCulture;
        Precision = Math.Clamp(precision, 0, 20);
        AriaLabel = ariaLabel ?? string.Empty;
        Label = label;
        Disabled = disabled;
        HasError = hasError;
    }

    /// <summary>Canonical integer micro-units (web <c>valueMicro</c>); null when empty.</summary>
    public long? ValueMicro { get; init; }

    /// <summary>ISO-4217 currency code (web <c>currency</c>).</summary>
    public string Currency { get; init; }

    /// <summary>The formatting culture (web <c>locale</c>); never null.</summary>
    public CultureInfo Culture { get; init; }

    /// <summary>Display fractional digits (web <c>precision ?? 2</c>); 0..20.</summary>
    public int Precision { get; init; }

    /// <summary>The required accessible label (web <c>ariaLabel</c>); may be blank (then the i18n default is used).</summary>
    public string AriaLabel { get; init; }

    /// <summary>Optional visible field label (web passthrough <c>label</c>); null hides the header.</summary>
    public string? Label { get; init; }

    /// <summary>Whether the field is disabled (web passthrough <c>disabled</c>).</summary>
    public bool Disabled { get; init; }

    /// <summary>Whether the field is in the error state (web passthrough <c>error</c>).</summary>
    public bool HasError { get; init; }
}

/// <summary>
/// The render-ready projection of one <see cref="CurrencyInputProps"/> — the native port of the derived values the
/// web component computes from its props (web/src/components/forms/CurrencyInput.tsx L109-L119): the formatted
/// <see cref="FormattedValue"/> (web <c>display = formatCurrencyMicro(valueMicro, currency, locale, precision)</c>),
/// the leading <see cref="Symbol"/> adornment (web <c>symbol = currencySymbol(currency, locale)</c>), which value
/// <see cref="State"/> is showing, the resolved <see cref="AccessibleName"/> (web <c>aria-label</c>, with the i18n
/// default substituted for a blank), the optional visible <see cref="Label"/> header and the passthrough enabled /
/// error flags. Pure value type so identical inputs compare equal and the adapter is unit-tested without a UI thread.
/// </summary>
public readonly record struct CurrencyInputDisplay
{
    private CurrencyInputDisplay(
        CurrencyInputState state,
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
    public CurrencyInputState State { get; }

    /// <summary>
    /// The canonical formatted value for the current props (web <c>display</c>): the currency-formatted string when a
    /// value is set, or the empty string when <see cref="CurrencyInputState.Empty"/>. This is what the field shows
    /// when it is not being edited; the view-model re-syncs its editing buffer to this whenever the field is unfocused.
    /// </summary>
    public string FormattedValue { get; }

    /// <summary>The leading currency-symbol adornment (web <c>symbol</c>); decorative for assistive tech.</summary>
    public string Symbol { get; }

    /// <summary>The accessible name the field announces (web <c>aria-label</c>; the i18n default when blank).</summary>
    public string AccessibleName { get; }

    /// <summary>The optional visible label header (web passthrough <c>label</c>); null hides it.</summary>
    public string? Label { get; }

    /// <summary>Whether the field accepts input (web <c>!disabled</c>).</summary>
    public bool IsEnabled { get; }

    /// <summary>Whether the field renders the error border and is announced invalid (web <c>error</c>).</summary>
    public bool HasError { get; }

    /// <summary>True while the field is empty (a null canonical value).</summary>
    public bool IsEmpty => State == CurrencyInputState.Empty;

    /// <summary>True while a populated value is showing.</summary>
    public bool HasValue => State == CurrencyInputState.Value;

    /// <summary>True when a visible label header should be drawn.</summary>
    public bool HasLabel => !string.IsNullOrEmpty(Label);

    /// <summary>
    /// Project <paramref name="props"/> into a render-ready display, resolving the accessible name through
    /// <paramref name="localizer"/>. Reproduces the web derived values: the formatted display, the symbol adornment,
    /// the empty/value branch and the blank-aria-label fallback. Formatting and the symbol come from the shared
    /// <see cref="CurrencyMicro"/> helper (the native canonical currency math), so a null value formats to the empty
    /// string and the round-trip with <see cref="CurrencyMicro.Parse"/> on commit is loss-free.
    /// </summary>
    /// <param name="props">The current presentational inputs.</param>
    /// <param name="localizer">The i18n facade the default accessible label resolves through.</param>
    public static CurrencyInputDisplay Project(CurrencyInputProps props, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(props);
        ArgumentNullException.ThrowIfNull(localizer);

        string formatted = CurrencyMicro.Format(props.ValueMicro, props.Currency, props.Culture, props.Precision);
        string symbol = CurrencyMicro.Symbol(props.Currency);
        bool hasAriaLabel = !string.IsNullOrWhiteSpace(props.AriaLabel);
        string accessibleName = hasAriaLabel
            ? props.AriaLabel.Trim()
            : CurrencyInputRegistration.ResolveDefaultAriaLabel(localizer);
        string? label = string.IsNullOrWhiteSpace(props.Label) ? null : props.Label!.Trim();

        return new CurrencyInputDisplay(
            props.ValueMicro is null ? CurrencyInputState.Empty : CurrencyInputState.Value,
            formattedValue: formatted,
            symbol: symbol,
            accessibleName: accessibleName,
            label: label,
            isEnabled: !props.Disabled,
            hasError: props.HasError);
    }
}

/// <summary>
/// The payload raised when the field commits an edit — the native port of the web
/// <c>onChange({ valueMicro })</c> callback (web <c>CurrencyInputChangePayload</c>). Carries the parsed canonical
/// micro value, or null when the field was cleared.
/// </summary>
/// <param name="ValueMicro">The committed canonical micro value, or null when the field is empty.</param>
public readonly record struct CurrencyInputCommit(long? ValueMicro);

/// <summary>
/// PII-safe diagnostics for the CurrencyInput surface (P1/S11 diagnostics contract). A currency field carries a
/// sensitive figure (a tariff / cost the user typed), so the collector records ONLY the operational
/// <c>view.opened</c> signal with the surface slug — never the value, the parsed micros or the symbol. Thread-safe;
/// mirrors the peer shared-surface diagnostics collectors.
/// </summary>
public sealed class CurrencyInputDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public CurrencyInputDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CurrencyInput</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={CurrencyInputRegistration.Slug}");
    }
}
