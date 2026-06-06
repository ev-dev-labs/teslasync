using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// Circular progress gauge (mirrors the web <c>RadialGauge</c>). Draws a tokenized
/// background track and a value arc whose sweep is <c>value / max</c>, with the
/// formatted value and unit centred and a caption beneath. The value arc colour
/// comes from the W1 palette via <see cref="Role"/> / <see cref="ColorIndex"/>.
/// </summary>
public partial class TsRadialGauge : ContentControl
{
    private const double StrokeWidth = 8;

    private readonly Canvas _canvas = new();
    private readonly TextBlock _valueText = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly Caption _label = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly Grid _ring = new();

    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        nameof(Value), typeof(double), typeof(TsRadialGauge), new PropertyMetadata(0.0, OnRenderChanged));

    public static readonly DependencyProperty MaxProperty = DependencyProperty.Register(
        nameof(Max), typeof(double), typeof(TsRadialGauge), new PropertyMetadata(100.0, OnRenderChanged));

    public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
        nameof(Label), typeof(string), typeof(TsRadialGauge), new PropertyMetadata(string.Empty, OnRenderChanged));

    public static readonly DependencyProperty UnitProperty = DependencyProperty.Register(
        nameof(Unit), typeof(string), typeof(TsRadialGauge), new PropertyMetadata(string.Empty, OnRenderChanged));

    public static readonly DependencyProperty DecimalsProperty = DependencyProperty.Register(
        nameof(Decimals), typeof(int), typeof(TsRadialGauge), new PropertyMetadata(-1, OnRenderChanged));

    public static readonly DependencyProperty DiameterProperty = DependencyProperty.Register(
        nameof(Diameter), typeof(double), typeof(TsRadialGauge), new PropertyMetadata(120.0, OnRenderChanged));

    public static readonly DependencyProperty ColorIndexProperty = DependencyProperty.Register(
        nameof(ColorIndex), typeof(int), typeof(TsRadialGauge), new PropertyMetadata(0, OnRenderChanged));

    public static readonly DependencyProperty RoleProperty = DependencyProperty.Register(
        nameof(Role), typeof(ChartRole), typeof(TsRadialGauge), new PropertyMetadata(ChartRole.None, OnRenderChanged));

    public TsRadialGauge()
    {
        IsTabStop = false;

        _valueText.FontSize = TypographyTokens.Size("TsTypeSectionFontSize", 18);
        _valueText.FontWeight = TypographyTokens.Weight(700);
        _valueText.Foreground = ChartBrushes.TextPrimary;

        var center = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        center.Children.Add(_valueText);

        _ring.Children.Add(_canvas);
        _ring.Children.Add(center);

        var outer = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center };
        outer.Children.Add(_ring);
        outer.Children.Add(_label);

        Content = outer;
        Render();
    }

    /// <summary>Current value.</summary>
    public double Value
    {
        get => (double)GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    /// <summary>Maximum value (full sweep).</summary>
    public double Max
    {
        get => (double)GetValue(MaxProperty);
        set => SetValue(MaxProperty, value);
    }

    /// <summary>Caption beneath the gauge.</summary>
    public string Label
    {
        get => (string)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    /// <summary>Unit suffix shown after the value.</summary>
    public string Unit
    {
        get => (string)GetValue(UnitProperty);
        set => SetValue(UnitProperty, value);
    }

    /// <summary>Fixed decimal places; negative means auto.</summary>
    public int Decimals
    {
        get => (int)GetValue(DecimalsProperty);
        set => SetValue(DecimalsProperty, value);
    }

    /// <summary>Gauge diameter in pixels.</summary>
    public double Diameter
    {
        get => (double)GetValue(DiameterProperty);
        set => SetValue(DiameterProperty, value);
    }

    /// <summary>Categorical palette index for the value arc.</summary>
    public int ColorIndex
    {
        get => (int)GetValue(ColorIndexProperty);
        set => SetValue(ColorIndexProperty, value);
    }

    /// <summary>Semantic role for the value arc (overrides <see cref="ColorIndex"/>).</summary>
    public ChartRole Role
    {
        get => (ChartRole)GetValue(RoleProperty);
        set => SetValue(RoleProperty, value);
    }

    private static void OnRenderChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsRadialGauge)d).Render();

    private void Render()
    {
        var size = Diameter;
        _canvas.Width = size;
        _canvas.Height = size;
        _ring.Width = size;
        _ring.Height = size;
        _canvas.Children.Clear();

        var radius = (size - StrokeWidth) / 2;
        var center = new PointD(size / 2, size / 2);

        var track = ChartShapes.ArcPath(
            ChartGeometry.RingArc(center, radius, 0.9999),
            ChartBrushes.Border,
            StrokeWidth);
        _canvas.Children.Add(track);

        var fraction = ChartGeometry.GaugeFraction(Value, Max);
        if (fraction > 0)
        {
            var arcBrush = Role != ChartRole.None
                ? ChartBrushes.Resolve(ChartPalette.KeyForRole(Role))
                : ChartBrushes.ForIndex(ColorIndex);
            var valueArc = ChartShapes.ArcPath(ChartGeometry.RingArc(center, radius, fraction), arcBrush, StrokeWidth);
            _canvas.Children.Add(valueArc);
        }

        int? decimals = Decimals >= 0 ? Decimals : null;
        var max = Max <= 0 ? Value : Max;
        var clamped = Math.Clamp(Value, 0, max);
        _valueText.Text = ChartPalette.FormatValue(clamped, decimals, string.IsNullOrEmpty(Unit) ? null : Unit);
        _label.Value = Label;

        AutomationProperties.SetName(this, $"{Label} {_valueText.Text}".Trim());
    }
}
