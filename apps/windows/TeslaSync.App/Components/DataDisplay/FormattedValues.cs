using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.Components.DataDisplay;

/// <summary>
/// Base for the SI-aware formatted value controls. Hosts a tokenized
/// <see cref="TextBlock"/> and re-renders whenever its inputs change. Concrete
/// controls supply <see cref="FormatValue"/>, which MUST delegate to the C#
/// behavior port (<see cref="UnitFormatters"/> / <see cref="ScalarFormatters"/>)
/// — never to ad-hoc conversion math (ADR-004).
/// </summary>
public abstract partial class FormattedValueControl : ContentControl
{
    /// <summary>SI input value. <see cref="double.NaN"/> (the default) renders the empty fallback.</summary>
    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        nameof(Value), typeof(double), typeof(FormattedValueControl),
        new PropertyMetadata(double.NaN, OnFormatInputChanged));

    /// <summary>Per-call fraction-digit override; negative (the default) uses the formatter default.</summary>
    public static readonly DependencyProperty PrecisionProperty = DependencyProperty.Register(
        nameof(Precision), typeof(int), typeof(FormattedValueControl),
        new PropertyMetadata(-1, OnFormatInputChanged));

    /// <summary>The user's unit-display preference bag.</summary>
    public static readonly DependencyProperty PrefProperty = DependencyProperty.Register(
        nameof(Pref), typeof(UnitPref), typeof(FormattedValueControl),
        new PropertyMetadata(null, OnFormatInputChanged));

    private readonly TextBlock _text = new();

    /// <summary>Initialise the hosted text block with tokenized foreground.</summary>
    protected FormattedValueControl()
    {
        IsTabStop = false;
        _text.Foreground = DisplayTokens.TextPrimary;
        Content = _text;
        Refresh();
    }

    /// <summary>SI input value (NaN = empty).</summary>
    public double Value
    {
        get => (double)GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    /// <summary>Fraction-digit override (&lt; 0 = formatter default).</summary>
    public int Precision
    {
        get => (int)GetValue(PrecisionProperty);
        set => SetValue(PrecisionProperty, value);
    }

    /// <summary>The active unit preference (defaults to metric when unset).</summary>
    public UnitPref? Pref
    {
        get => (UnitPref?)GetValue(PrefProperty);
        set => SetValue(PrefProperty, value);
    }

    /// <summary>The effective preference, falling back to metric defaults.</summary>
    protected UnitPref EffectivePref => Pref ?? UnitPref.Metric;

    /// <summary>The effective per-call precision, or null when the default applies.</summary>
    protected int? EffectivePrecision => Precision >= 0 ? Precision : null;

    /// <summary>The nullable SI input (NaN/Infinity collapse to null so formatters render the fallback).</summary>
    protected double? Input => double.IsNaN(Value) || double.IsInfinity(Value) ? null : Value;

    /// <summary>Produce the formatted display string via the C# behavior port.</summary>
    protected abstract string FormatValue();

    /// <summary>Re-render the hosted text block.</summary>
    protected void Refresh() => _text.Text = FormatValue();

    private static void OnFormatInputChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((FormattedValueControl)d).Refresh();
}

/// <summary>Renders an SI-meters distance honouring the user's distance unit.</summary>
public sealed partial class TsDistance : FormattedValueControl
{
    /// <inheritdoc />
    protected override string FormatValue() => UnitFormatters.FormatDistance(Input, EffectivePref, EffectivePrecision);
}

/// <summary>Renders an SI m/s speed honouring the user's speed unit.</summary>
public sealed partial class TsSpeed : FormattedValueControl
{
    /// <inheritdoc />
    protected override string FormatValue() => UnitFormatters.FormatSpeed(Input, EffectivePref, EffectivePrecision);
}

/// <summary>Renders an SI Celsius temperature honouring the user's temperature unit.</summary>
public sealed partial class TsTemperature : FormattedValueControl
{
    /// <inheritdoc />
    protected override string FormatValue() => UnitFormatters.FormatTemperature(Input, EffectivePref, EffectivePrecision);
}

/// <summary>Renders an SI kilopascal pressure honouring the user's pressure unit.</summary>
public sealed partial class TsPressure : FormattedValueControl
{
    /// <inheritdoc />
    protected override string FormatValue() => UnitFormatters.FormatPressure(Input, EffectivePref, EffectivePrecision);
}

/// <summary>Renders an SI watt-hours energy honouring the user's energy unit.</summary>
public sealed partial class TsEnergy : FormattedValueControl
{
    /// <inheritdoc />
    protected override string FormatValue() => UnitFormatters.FormatEnergy(Input, EffectivePref, EffectivePrecision);
}

/// <summary>Renders SI watts honouring the user's power unit.</summary>
public sealed partial class TsPower : FormattedValueControl
{
    /// <inheritdoc />
    protected override string FormatValue() => UnitFormatters.FormatPower(Input, EffectivePref, EffectivePrecision);
}

/// <summary>Renders an SI-seconds duration honouring the user's duration unit.</summary>
public sealed partial class TsDuration : FormattedValueControl
{
    /// <inheritdoc />
    protected override string FormatValue() => UnitFormatters.FormatDuration(Input, EffectivePref, EffectivePrecision);
}

/// <summary>Renders an SI voltage (volts) — already SI, no conversion.</summary>
public sealed partial class TsVoltage : FormattedValueControl
{
    /// <inheritdoc />
    protected override string FormatValue() =>
        EffectivePrecision is { } p ? ScalarFormatters.FormatVoltage(Input, p) : ScalarFormatters.FormatVoltage(Input);
}

/// <summary>Renders an SI current (amperes) — already SI, no conversion.</summary>
public sealed partial class TsCurrent : FormattedValueControl
{
    /// <inheritdoc />
    protected override string FormatValue() =>
        EffectivePrecision is { } p ? ScalarFormatters.FormatCurrent(Input, p) : ScalarFormatters.FormatCurrent(Input);
}

/// <summary>Renders a percentage value (already 0..100) with a trailing %.</summary>
public sealed partial class TsPercentage : FormattedValueControl
{
    /// <inheritdoc />
    protected override string FormatValue() =>
        EffectivePrecision is { } p ? ScalarFormatters.FormatPercentage(Input, p) : ScalarFormatters.FormatPercentage(Input);
}

/// <summary>Renders a dimensionless number with en-US grouping.</summary>
public sealed partial class TsNumber : FormattedValueControl
{
    /// <inheritdoc />
    protected override string FormatValue() =>
        ScalarFormatters.FormatNumber(Input, EffectivePrecision ?? ScalarFormatters.PrecisionNumber);
}

/// <summary>Renders a currency amount with a leading symbol.</summary>
public sealed partial class TsCurrency : FormattedValueControl
{
    /// <summary>Currency symbol shown before the amount (default "$").</summary>
    public static readonly DependencyProperty SymbolProperty = DependencyProperty.Register(
        nameof(Symbol), typeof(string), typeof(TsCurrency), new PropertyMetadata("$", OnSymbolChanged));

    /// <summary>The currency symbol.</summary>
    public string Symbol
    {
        get => (string)GetValue(SymbolProperty);
        set => SetValue(SymbolProperty, value);
    }

    /// <inheritdoc />
    protected override string FormatValue() => EffectivePrecision is { } p
        ? ScalarFormatters.FormatCurrency(Input, Symbol, p)
        : ScalarFormatters.FormatCurrency(Input, Symbol);

    private static void OnSymbolChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsCurrency)d).Refresh();
}

/// <summary>
/// Renders the user's "primary range" — an SI-metres distance formatted via the
/// distance unit. Pre-resolved at the call boundary (caller supplies the preferred
/// rated/ideal range in metres).
/// </summary>
public sealed partial class TsRange : FormattedValueControl
{
    /// <inheritdoc />
    protected override string FormatValue() => UnitFormatters.FormatDistance(Input, EffectivePref, EffectivePrecision ?? 0);
}
