using System.Collections.Generic;
using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Microsoft.UI.Text;
using TeslaSync.App.Core.DataDisplay;

namespace TeslaSync.App.Components.DataDisplay;

/// <summary>A label/value pair rendered by <c>TsKVList</c> / <c>TsKpiOverviewCard</c>.</summary>
/// <param name="Key">Left-hand label.</param>
/// <param name="Value">Right-hand value.</param>
public sealed record TsKeyValue(string Key, string Value);

/// <summary>
/// Headline metric tile (mirrors the web <c>StatCard</c>): a muted label, a large
/// primary value, and an optional sub-line. Tokenized card surface; the value is
/// pre-formatted by the caller (typically via a formatted-value control or the C#
/// behavior port) so the card never does unit math itself.
/// </summary>
public sealed partial class TsStatCard : ContentControl
{
    /// <summary>Muted label above the value.</summary>
    public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
        nameof(Label), typeof(string), typeof(TsStatCard), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>The headline value (already formatted).</summary>
    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        nameof(Value), typeof(string), typeof(TsStatCard), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Optional sub-line under the value.</summary>
    public static readonly DependencyProperty SublabelProperty = DependencyProperty.Register(
        nameof(Sublabel), typeof(string), typeof(TsStatCard), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Optional Fluent glyph rendered as an accent.</summary>
    public static readonly DependencyProperty GlyphProperty = DependencyProperty.Register(
        nameof(Glyph), typeof(string), typeof(TsStatCard), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Initialise the card.</summary>
    public TsStatCard()
    {
        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Rebuild();
    }

    /// <summary>The label.</summary>
    public string Label
    {
        get => (string)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    /// <summary>The headline value.</summary>
    public string Value
    {
        get => (string)GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    /// <summary>The sub-line.</summary>
    public string Sublabel
    {
        get => (string)GetValue(SublabelProperty);
        set => SetValue(SublabelProperty, value);
    }

    /// <summary>The accent glyph.</summary>
    public string Glyph
    {
        get => (string)GetValue(GlyphProperty);
        set => SetValue(GlyphProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsStatCard)d).Rebuild();

    private void Rebuild()
    {
        var column = DisplayPrimitives.Column(4);

        var header = DisplayPrimitives.Row(8);
        if (!string.IsNullOrEmpty(Glyph))
        {
            header.Children.Add(new FontIcon { Glyph = Glyph, FontSize = 14, Foreground = DisplayTokens.Accent });
        }

        header.Children.Add(DisplayPrimitives.Caption(Label));
        column.Children.Add(header);
        column.Children.Add(DisplayPrimitives.Value(string.IsNullOrEmpty(Value) ? UnitsEmpty : Value, 26));

        if (!string.IsNullOrEmpty(Sublabel))
        {
            column.Children.Add(DisplayPrimitives.Caption(Sublabel));
        }

        Content = DisplayPrimitives.Card(column);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, $"{Label}: {Value}");
    }

    internal const string UnitsEmpty = "\u2014";
}

/// <summary>
/// Metric tile with a leading accent rail and an optional delta line (mirrors the
/// web <c>MetricCard</c>). Like <see cref="TsStatCard"/> the value is pre-formatted.
/// </summary>
public sealed partial class TsMetricCard : ContentControl
{
    /// <summary>Muted label.</summary>
    public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
        nameof(Label), typeof(string), typeof(TsMetricCard), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>The pre-formatted value.</summary>
    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        nameof(Value), typeof(string), typeof(TsMetricCard), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Token brush key for the accent rail (default accent).</summary>
    public static readonly DependencyProperty AccentBrushKeyProperty = DependencyProperty.Register(
        nameof(AccentBrushKey), typeof(string), typeof(TsMetricCard), new PropertyMetadata("TsColorAccentBrush", OnChanged));

    /// <summary>Optional delta caption (already formatted, e.g. "▲ 4%").</summary>
    public static readonly DependencyProperty DeltaTextProperty = DependencyProperty.Register(
        nameof(DeltaText), typeof(string), typeof(TsMetricCard), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Initialise the card.</summary>
    public TsMetricCard()
    {
        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Rebuild();
    }

    /// <summary>The label.</summary>
    public string Label
    {
        get => (string)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    /// <summary>The value.</summary>
    public string Value
    {
        get => (string)GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    /// <summary>Accent rail brush key.</summary>
    public string AccentBrushKey
    {
        get => (string)GetValue(AccentBrushKeyProperty);
        set => SetValue(AccentBrushKeyProperty, value);
    }

    /// <summary>Delta caption.</summary>
    public string DeltaText
    {
        get => (string)GetValue(DeltaTextProperty);
        set => SetValue(DeltaTextProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsMetricCard)d).Rebuild();

    private void Rebuild()
    {
        var rail = new Rectangle
        {
            Width = 3,
            Fill = DisplayTokens.Brush(AccentBrushKey),
            RadiusX = 2,
            RadiusY = 2,
        };

        var column = DisplayPrimitives.Column(4);
        column.Children.Add(DisplayPrimitives.Caption(Label));
        column.Children.Add(DisplayPrimitives.Value(string.IsNullOrEmpty(Value) ? TsStatCard.UnitsEmpty : Value, 24));
        if (!string.IsNullOrEmpty(DeltaText))
        {
            column.Children.Add(DisplayPrimitives.Caption(DeltaText));
        }

        var row = DisplayPrimitives.Row(12);
        row.Children.Add(rail);
        row.Children.Add(column);

        Content = DisplayPrimitives.Card(row);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, $"{Label}: {Value}");
    }
}

/// <summary>
/// Compact one-line "label value" pairing (mirrors the web <c>InlineMetric</c>) for
/// dense tables and headers.
/// </summary>
public sealed partial class TsInlineMetric : ContentControl
{
    /// <summary>Muted label.</summary>
    public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
        nameof(Label), typeof(string), typeof(TsInlineMetric), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>The pre-formatted value.</summary>
    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        nameof(Value), typeof(string), typeof(TsInlineMetric), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Initialise the control.</summary>
    public TsInlineMetric()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>The label.</summary>
    public string Label
    {
        get => (string)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    /// <summary>The value.</summary>
    public string Value
    {
        get => (string)GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsInlineMetric)d).Rebuild();

    private void Rebuild()
    {
        var row = DisplayPrimitives.Row(8);
        row.Children.Add(DisplayPrimitives.Caption(Label));
        var value = DisplayPrimitives.Value(string.IsNullOrEmpty(Value) ? TsStatCard.UnitsEmpty : Value, 14);
        row.Children.Add(value);
        Content = row;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, $"{Label}: {Value}");
    }
}

/// <summary>
/// Horizontal progress/fill bar with a label and value (mirrors the web
/// <c>MetricBar</c>). The fill fraction is a pure ratio of <see cref="Value"/> to
/// <see cref="Max"/> (clamped 0..1) — layout math, never unit conversion.
/// </summary>
public sealed partial class TsMetricBar : ContentControl
{
    /// <summary>Muted label above the bar.</summary>
    public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
        nameof(Label), typeof(string), typeof(TsMetricBar), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Current value.</summary>
    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        nameof(Value), typeof(double), typeof(TsMetricBar), new PropertyMetadata(0.0, OnChanged));

    /// <summary>Maximum value (the full bar).</summary>
    public static readonly DependencyProperty MaxProperty = DependencyProperty.Register(
        nameof(Max), typeof(double), typeof(TsMetricBar), new PropertyMetadata(100.0, OnChanged));

    /// <summary>Optional pre-formatted value text shown on the right.</summary>
    public static readonly DependencyProperty ValueTextProperty = DependencyProperty.Register(
        nameof(ValueText), typeof(string), typeof(TsMetricBar), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Token brush key for the fill (default accent).</summary>
    public static readonly DependencyProperty AccentBrushKeyProperty = DependencyProperty.Register(
        nameof(AccentBrushKey), typeof(string), typeof(TsMetricBar), new PropertyMetadata("TsColorAccentBrush", OnChanged));

    private readonly Border _track = new();
    private readonly Border _fill = new();
    private readonly Grid _root = new();
    private readonly TextBlock _label = DisplayPrimitives.Caption();
    private readonly TextBlock _value = DisplayPrimitives.Label();

    /// <summary>Initialise the bar.</summary>
    public TsMetricBar()
    {
        IsTabStop = false;
        BuildTree();
        SizeChanged += (_, _) => UpdateFill();
        Rebuild();
    }

    /// <summary>The label.</summary>
    public string Label
    {
        get => (string)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    /// <summary>The current value.</summary>
    public double Value
    {
        get => (double)GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    /// <summary>The maximum value.</summary>
    public double Max
    {
        get => (double)GetValue(MaxProperty);
        set => SetValue(MaxProperty, value);
    }

    /// <summary>Optional value text on the right.</summary>
    public string ValueText
    {
        get => (string)GetValue(ValueTextProperty);
        set => SetValue(ValueTextProperty, value);
    }

    /// <summary>Fill brush key.</summary>
    public string AccentBrushKey
    {
        get => (string)GetValue(AccentBrushKeyProperty);
        set => SetValue(AccentBrushKeyProperty, value);
    }

    /// <summary>The clamped 0..1 fill fraction.</summary>
    public double Fraction
    {
        get
        {
            if (Max <= 0 || double.IsNaN(Value) || double.IsNaN(Max))
            {
                return 0;
            }

            return Math.Clamp(Value / Max, 0.0, 1.0);
        }
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsMetricBar)d).Rebuild();

    private void BuildTree()
    {
        _track.Height = 8;
        _track.CornerRadius = DisplayTokens.Radius("TsRadiusPill", 999);
        _track.Background = DisplayTokens.Brush("TsColorBorderBrush");
        _track.HorizontalAlignment = HorizontalAlignment.Stretch;

        _fill.Height = 8;
        _fill.CornerRadius = DisplayTokens.Radius("TsRadiusPill", 999);
        _fill.HorizontalAlignment = HorizontalAlignment.Left;
        _track.Child = _fill;

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_label, 0);
        Grid.SetColumn(_value, 1);
        header.Children.Add(_label);
        header.Children.Add(_value);

        var column = DisplayPrimitives.Column(4);
        column.Children.Add(header);
        column.Children.Add(_track);
        _root.Children.Add(column);
    }

    private void Rebuild()
    {
        _label.Text = Label;
        _value.Text = string.IsNullOrEmpty(ValueText) ? string.Empty : ValueText;
        _value.Visibility = string.IsNullOrEmpty(ValueText) ? Visibility.Collapsed : Visibility.Visible;
        _fill.Background = DisplayTokens.Brush(AccentBrushKey);
        UpdateFill();
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(
            this, $"{Label}: {(Fraction * 100).ToString("0", CultureInfo.InvariantCulture)}%");
        Content = _root;
    }

    private void UpdateFill()
    {
        double available = _track.ActualWidth;
        _fill.Width = available > 0 ? available * Fraction : 0;
    }
}

/// <summary>
/// Key/value list (mirrors the web <c>KVList</c>): a stacked set of label-on-left,
/// value-on-right rows. Tokenized; missing values render the em dash.
/// </summary>
public sealed partial class TsKVList : ContentControl
{
    /// <summary>The rows to render.</summary>
    public static readonly DependencyProperty ItemsProperty = DependencyProperty.Register(
        nameof(Items), typeof(IEnumerable<TsKeyValue>), typeof(TsKVList), new PropertyMetadata(null, OnChanged));

    /// <summary>Initialise the list.</summary>
    public TsKVList()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>The key/value rows.</summary>
    public IEnumerable<TsKeyValue>? Items
    {
        get => (IEnumerable<TsKeyValue>?)GetValue(ItemsProperty);
        set => SetValue(ItemsProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsKVList)d).Rebuild();

    private void Rebuild()
    {
        var column = DisplayPrimitives.Column(6);
        foreach (var item in Items ?? Array.Empty<TsKeyValue>())
        {
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var key = DisplayPrimitives.Caption(item.Key);
            var value = DisplayPrimitives.Label(string.IsNullOrEmpty(item.Value) ? TsStatCard.UnitsEmpty : item.Value);
            value.Foreground = DisplayTokens.TextPrimary;
            Grid.SetColumn(key, 0);
            Grid.SetColumn(value, 1);
            grid.Children.Add(key);
            grid.Children.Add(value);
            column.Children.Add(grid);
        }

        Content = column;
    }
}

/// <summary>
/// Resource-usage card (mirrors the web <c>UsageCard</c>): a title, a "used of
/// total" headline, and a <see cref="TsMetricBar"/> showing the fraction consumed.
/// </summary>
public sealed partial class TsUsageCard : ContentControl
{
    /// <summary>Card title.</summary>
    public static readonly DependencyProperty TitleProperty = DependencyProperty.Register(
        nameof(Title), typeof(string), typeof(TsUsageCard), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Amount used (same unit as <see cref="Total"/>).</summary>
    public static readonly DependencyProperty UsedProperty = DependencyProperty.Register(
        nameof(Used), typeof(double), typeof(TsUsageCard), new PropertyMetadata(0.0, OnChanged));

    /// <summary>Total capacity.</summary>
    public static readonly DependencyProperty TotalProperty = DependencyProperty.Register(
        nameof(Total), typeof(double), typeof(TsUsageCard), new PropertyMetadata(0.0, OnChanged));

    /// <summary>Pre-formatted "used / total" summary text.</summary>
    public static readonly DependencyProperty SummaryProperty = DependencyProperty.Register(
        nameof(Summary), typeof(string), typeof(TsUsageCard), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Initialise the card.</summary>
    public TsUsageCard()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>The title.</summary>
    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    /// <summary>The used amount.</summary>
    public double Used
    {
        get => (double)GetValue(UsedProperty);
        set => SetValue(UsedProperty, value);
    }

    /// <summary>The total capacity.</summary>
    public double Total
    {
        get => (double)GetValue(TotalProperty);
        set => SetValue(TotalProperty, value);
    }

    /// <summary>The summary text.</summary>
    public string Summary
    {
        get => (string)GetValue(SummaryProperty);
        set => SetValue(SummaryProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsUsageCard)d).Rebuild();

    private void Rebuild()
    {
        var column = DisplayPrimitives.Column(8);
        column.Children.Add(DisplayPrimitives.Caption(Title));

        if (!string.IsNullOrEmpty(Summary))
        {
            column.Children.Add(DisplayPrimitives.Value(Summary, 18));
        }

        column.Children.Add(new TsMetricBar { Value = Used, Max = Total });

        Content = DisplayPrimitives.Card(column);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, $"{Title}: {Summary}");
    }
}

/// <summary>
/// A grid of KPI tiles (mirrors the web <c>KpiOverviewCard</c>): a titled card whose
/// body renders each <see cref="TsKeyValue"/> as a label-over-value tile.
/// </summary>
public sealed partial class TsKpiOverviewCard : ContentControl
{
    /// <summary>Card title.</summary>
    public static readonly DependencyProperty TitleProperty = DependencyProperty.Register(
        nameof(Title), typeof(string), typeof(TsKpiOverviewCard), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>The KPI tiles.</summary>
    public static readonly DependencyProperty ItemsProperty = DependencyProperty.Register(
        nameof(Items), typeof(IEnumerable<TsKeyValue>), typeof(TsKpiOverviewCard), new PropertyMetadata(null, OnChanged));

    /// <summary>Initialise the card.</summary>
    public TsKpiOverviewCard()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>The title.</summary>
    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    /// <summary>The KPI tiles.</summary>
    public IEnumerable<TsKeyValue>? Items
    {
        get => (IEnumerable<TsKeyValue>?)GetValue(ItemsProperty);
        set => SetValue(ItemsProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsKpiOverviewCard)d).Rebuild();

    private void Rebuild()
    {
        var column = DisplayPrimitives.Column(12);
        column.Children.Add(DisplayPrimitives.Caption(Title));

        var wrap = new VariableSizedWrapGrid { Orientation = Orientation.Horizontal, ItemWidth = 140, ItemHeight = 56 };
        foreach (var item in Items ?? Array.Empty<TsKeyValue>())
        {
            var tile = DisplayPrimitives.Column(2);
            tile.Children.Add(DisplayPrimitives.Caption(item.Key));
            tile.Children.Add(DisplayPrimitives.Value(string.IsNullOrEmpty(item.Value) ? TsStatCard.UnitsEmpty : item.Value, 18));
            wrap.Children.Add(tile);
        }

        column.Children.Add(wrap);
        Content = DisplayPrimitives.Card(column);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, Title);
    }
}

/// <summary>
/// Header for a period-over-period comparison (mirrors the web
/// <c>ComparisonHeader</c>): "Current → Previous" labels with an arrow between.
/// </summary>
public sealed partial class TsComparisonHeader : ContentControl
{
    /// <summary>Label for the current period.</summary>
    public static readonly DependencyProperty CurrentLabelProperty = DependencyProperty.Register(
        nameof(CurrentLabel), typeof(string), typeof(TsComparisonHeader), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Label for the comparison period.</summary>
    public static readonly DependencyProperty PreviousLabelProperty = DependencyProperty.Register(
        nameof(PreviousLabel), typeof(string), typeof(TsComparisonHeader), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Initialise the header.</summary>
    public TsComparisonHeader()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>Current period label.</summary>
    public string CurrentLabel
    {
        get => (string)GetValue(CurrentLabelProperty);
        set => SetValue(CurrentLabelProperty, value);
    }

    /// <summary>Comparison period label.</summary>
    public string PreviousLabel
    {
        get => (string)GetValue(PreviousLabelProperty);
        set => SetValue(PreviousLabelProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsComparisonHeader)d).Rebuild();

    private void Rebuild()
    {
        var row = DisplayPrimitives.Row(8);
        row.Children.Add(DisplayPrimitives.Value(CurrentLabel, 16));
        row.Children.Add(new FontIcon { Glyph = "\uE72A", FontSize = 12, Foreground = DisplayTokens.TextMuted });
        var prev = DisplayPrimitives.Label(PreviousLabel);
        prev.Foreground = DisplayTokens.TextMuted;
        row.Children.Add(prev);
        Content = row;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, $"{CurrentLabel} vs {PreviousLabel}");
    }
}

/// <summary>
/// Directional delta chip (mirrors the web <c>Delta</c>). Uses <see cref="DeltaLogic"/>
/// to compute the arrow + tone from <see cref="Current"/>/<see cref="Previous"/> and
/// the metric <see cref="Direction"/>. The magnitude is always rendered positive.
/// </summary>
public sealed partial class TsDelta : ContentControl
{
    /// <summary>Current value (NaN → no comparison).</summary>
    public static readonly DependencyProperty CurrentProperty = DependencyProperty.Register(
        nameof(Current), typeof(double), typeof(TsDelta), new PropertyMetadata(double.NaN, OnChanged));

    /// <summary>Previous value (NaN → no comparison).</summary>
    public static readonly DependencyProperty PreviousProperty = DependencyProperty.Register(
        nameof(Previous), typeof(double), typeof(TsDelta), new PropertyMetadata(double.NaN, OnChanged));

    /// <summary>Whether higher or lower is the desirable outcome.</summary>
    public static readonly DependencyProperty DirectionProperty = DependencyProperty.Register(
        nameof(Direction), typeof(MetricDirection), typeof(TsDelta), new PropertyMetadata(MetricDirection.HigherBetter, OnChanged));

    /// <summary>When true (default), render the percent change; otherwise the absolute delta.</summary>
    public static readonly DependencyProperty ShowPercentProperty = DependencyProperty.Register(
        nameof(ShowPercent), typeof(bool), typeof(TsDelta), new PropertyMetadata(true, OnChanged));

    /// <summary>Initialise the chip.</summary>
    public TsDelta()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>Current value.</summary>
    public double Current
    {
        get => (double)GetValue(CurrentProperty);
        set => SetValue(CurrentProperty, value);
    }

    /// <summary>Previous value.</summary>
    public double Previous
    {
        get => (double)GetValue(PreviousProperty);
        set => SetValue(PreviousProperty, value);
    }

    /// <summary>Metric direction.</summary>
    public MetricDirection Direction
    {
        get => (MetricDirection)GetValue(DirectionProperty);
        set => SetValue(DirectionProperty, value);
    }

    /// <summary>Whether to render the percent change.</summary>
    public bool ShowPercent
    {
        get => (bool)GetValue(ShowPercentProperty);
        set => SetValue(ShowPercentProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsDelta)d).Rebuild();

    private static double? Nullable(double v) => double.IsNaN(v) || double.IsInfinity(v) ? null : v;

    private void Rebuild()
    {
        var result = DeltaLogic.Compute(Nullable(Current), Nullable(Previous), Direction);
        var accent = DisplayTokens.Brush(DeltaLogic.AccentBrushKey(result.Tone));

        if (!result.HasComparison)
        {
            var dash = DisplayPrimitives.Caption(TsStatCard.UnitsEmpty);
            Content = dash;
            return;
        }

        string glyph = result.Arrow switch
        {
            DeltaArrow.Up => "\uE70E",   // ChevronUp
            DeltaArrow.Down => "\uE70D", // ChevronDown
            _ => "\uE738",               // Remove (flat)
        };

        string magnitude = ShowPercent && result.AbsolutePercent is { } pct
            ? $"{pct.ToString("0.#", CultureInfo.InvariantCulture)}%"
            : result.AbsoluteDelta.ToString("0.##", CultureInfo.InvariantCulture);

        var row = DisplayPrimitives.Row(4);
        row.Children.Add(new FontIcon { Glyph = glyph, FontSize = 12, Foreground = accent });
        row.Children.Add(new TextBlock
        {
            Text = magnitude,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        });

        Content = row;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, $"{result.Arrow} {magnitude}");
    }
}
