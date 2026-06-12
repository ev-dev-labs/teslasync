using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The data seam the <see cref="CurrencyInputViewModel"/> binds to (P1/S8 state-holder seam) — the native analogue
/// of the props the web <c>&lt;CurrencyInput&gt;</c> receives from its parent and re-syncs against
/// (web/src/components/forms/CurrencyInput.tsx). The web component is presentational and fetches nothing; likewise
/// this seam simply holds the resolved <see cref="Props"/> (the canonical micro value, the currency / culture /
/// precision formatting context, the accessible + visible labels and the disabled / error flags) and raises
/// <see cref="Changed"/> when any of them is reassigned — the analogue of the parent re-rendering with a new
/// <c>valueMicro</c> or the settings holder publishing a new currency / locale. The view never touches this seam or
/// any HTTP directly; it observes the view-model, which re-projects on <see cref="Changed"/>.
/// </summary>
public interface ICurrencyInputSource
{
    /// <summary>The current presentational inputs (value, currency, culture, precision, labels, flags); never null.</summary>
    CurrencyInputProps Props { get; }

    /// <summary>Raised whenever the props are reassigned (a parent re-render or a settings change).</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The in-memory <see cref="ICurrencyInputSource"/> — the canonical holder a page (or a test) pushes the field's
/// inputs into. It mirrors a parent passing fresh props to the web <c>&lt;CurrencyInput&gt;</c>:
/// <see cref="SetProps"/> replaces the whole input, <see cref="SetValueMicro"/> moves just the canonical value (the
/// analogue of the parent re-rendering with a new <c>valueMicro</c> after handling <c>onChange</c>),
/// <see cref="SetContext"/> publishes a new currency / culture / precision, and <see cref="SetDisabled"/> /
/// <see cref="SetHasError"/> toggle the passthrough flags — each raising <see cref="Changed"/> so the bound
/// view-model re-projects. A null assignment falls back to a safe default so the view-model never dereferences null.
/// </summary>
public sealed class CurrencyInputSource : ICurrencyInputSource
{
    private CurrencyInputProps _props;

    /// <summary>Creates an empty source (a null USD value at the default precision and the current culture).</summary>
    public CurrencyInputSource()
        : this(new CurrencyInputProps())
    {
    }

    /// <summary>Creates a source seeded with an initial set of inputs (a null falls back to the default props).</summary>
    /// <param name="props">The initial inputs.</param>
    public CurrencyInputSource(CurrencyInputProps props) => _props = props ?? new CurrencyInputProps();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public CurrencyInputProps Props => _props;

    /// <summary>Replace the whole input (a null falls back to the default props) and notify.</summary>
    /// <param name="props">The new inputs.</param>
    public void SetProps(CurrencyInputProps props)
    {
        _props = props ?? new CurrencyInputProps();
        RaiseChanged();
    }

    /// <summary>
    /// Move just the canonical micro value, keeping every other input — the analogue of the parent re-rendering
    /// with a new <c>valueMicro</c> prop after handling the field's <c>onChange</c>.
    /// </summary>
    /// <param name="valueMicro">The new canonical micro value, or null to clear.</param>
    public void SetValueMicro(long? valueMicro)
    {
        if (_props.ValueMicro == valueMicro)
        {
            return;
        }

        _props = _props with { ValueMicro = valueMicro };
        RaiseChanged();
    }

    /// <summary>
    /// Publish a new formatting context (web <c>currency</c> / <c>locale</c> / <c>precision</c>), keeping the value
    /// and labels. A null currency is treated as no symbol; a null culture falls back to the current culture; the
    /// precision is clamped 0..20.
    /// </summary>
    /// <param name="currency">The ISO-4217 currency code.</param>
    /// <param name="culture">The formatting culture, or null for the current culture.</param>
    /// <param name="precision">The display fractional digits.</param>
    public void SetContext(string currency, CultureInfo? culture, int precision = CurrencyInputRegistration.DefaultPrecision)
    {
        _props = _props with
        {
            Currency = currency ?? string.Empty,
            Culture = culture ?? CultureInfo.CurrentCulture,
            Precision = Math.Clamp(precision, 0, 20),
        };
        RaiseChanged();
    }

    /// <summary>Toggle the passthrough disabled flag (web <c>disabled</c>), keeping every other input.</summary>
    /// <param name="disabled">Whether the field is disabled.</param>
    public void SetDisabled(bool disabled)
    {
        if (_props.Disabled == disabled)
        {
            return;
        }

        _props = _props with { Disabled = disabled };
        RaiseChanged();
    }

    /// <summary>Toggle the passthrough error flag (web <c>error</c>), keeping every other input.</summary>
    /// <param name="hasError">Whether the field is in the error state.</param>
    public void SetHasError(bool hasError)
    {
        if (_props.HasError == hasError)
        {
            return;
        }

        _props = _props with { HasError = hasError };
        RaiseChanged();
    }

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
