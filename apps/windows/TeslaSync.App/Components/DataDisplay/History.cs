using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Text;
using TeslaSync.App.Core.DataDisplay;

namespace TeslaSync.App.Components.DataDisplay;

/// <summary>
/// A–F score chip (mirrors the web <c>ScoreBadge</c>). Maps a 0–100 numeric score to
/// a letter grade via <see cref="ScoreScale"/> and renders the grade in its palette
/// colour. The palette is a semantic data attribute shared with the web.
/// </summary>
public sealed partial class TsScoreBadge : ContentControl
{
    /// <summary>The 0–100 score (NaN → no-data sentinel).</summary>
    public static readonly DependencyProperty ScoreProperty = DependencyProperty.Register(
        nameof(Score), typeof(double), typeof(TsScoreBadge), new PropertyMetadata(double.NaN, OnChanged));

    /// <summary>Initialise the badge.</summary>
    public TsScoreBadge()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>The numeric score.</summary>
    public double Score
    {
        get => (double)GetValue(ScoreProperty);
        set => SetValue(ScoreProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsScoreBadge)d).Rebuild();

    private void Rebuild()
    {
        double? score = double.IsNaN(Score) || double.IsInfinity(Score) ? null : Score;
        var info = ScoreScale.NumericToGrade(score);
        var accent = DisplayPrimitives.HexBrush(info.ColorHex);

        var label = new TextBlock
        {
            Text = info.Label,
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };

        Content = DisplayPrimitives.Pill(label, accent);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, $"Grade {info.Label}");
    }
}

/// <summary>
/// Battery state-of-charge change chip (mirrors the web <c>BatteryDelta</c>). Renders
/// the signed percentage-point change between a start and end SOC with a directional
/// arrow, coloured green for a gain (charge) and red for a loss (consumption).
/// </summary>
public sealed partial class TsBatteryDelta : ContentControl
{
    /// <summary>Start state-of-charge in percent (NaN → no comparison).</summary>
    public static readonly DependencyProperty StartPercentProperty = DependencyProperty.Register(
        nameof(StartPercent), typeof(double), typeof(TsBatteryDelta), new PropertyMetadata(double.NaN, OnChanged));

    /// <summary>End state-of-charge in percent (NaN → no comparison).</summary>
    public static readonly DependencyProperty EndPercentProperty = DependencyProperty.Register(
        nameof(EndPercent), typeof(double), typeof(TsBatteryDelta), new PropertyMetadata(double.NaN, OnChanged));

    /// <summary>Initialise the chip.</summary>
    public TsBatteryDelta()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>Start SOC percent.</summary>
    public double StartPercent
    {
        get => (double)GetValue(StartPercentProperty);
        set => SetValue(StartPercentProperty, value);
    }

    /// <summary>End SOC percent.</summary>
    public double EndPercent
    {
        get => (double)GetValue(EndPercentProperty);
        set => SetValue(EndPercentProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsBatteryDelta)d).Rebuild();

    private static double? Nullable(double v) => double.IsNaN(v) || double.IsInfinity(v) ? null : v;

    private void Rebuild()
    {
        var result = DeltaLogic.Compute(Nullable(EndPercent), Nullable(StartPercent), MetricDirection.HigherBetter);
        if (!result.HasComparison)
        {
            Content = DisplayPrimitives.Caption("\u2014");
            return;
        }

        var accent = DisplayTokens.Brush(DeltaLogic.AccentBrushKey(result.Tone));
        string glyph = result.Arrow switch
        {
            DeltaArrow.Up => "\uE70E",
            DeltaArrow.Down => "\uE70D",
            _ => "\uE738",
        };

        string sign = result.SignedDelta > 0 ? "+" : result.SignedDelta < 0 ? "\u2212" : string.Empty;
        string text = $"{sign}{result.AbsoluteDelta.ToString("0.#", CultureInfo.InvariantCulture)}%";

        var row = DisplayPrimitives.Row(4);
        row.Children.Add(new FontIcon { Glyph = glyph, FontSize = 12, Foreground = accent });
        row.Children.Add(new TextBlock
        {
            Text = text,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        });

        Content = row;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, $"Battery {text}");
    }
}

/// <summary>
/// Route "from → to" line (mirrors the web <c>RouteDisplay</c>). Resolves endpoint
/// labels and round-trip collapsing via <see cref="RouteLogic"/>; renders a single
/// label for round trips and a "start → end" pair for point-to-point routes.
/// </summary>
public sealed partial class TsRouteDisplay : ContentControl
{
    /// <summary>Resolved start address (preferred over coordinates).</summary>
    public static readonly DependencyProperty StartAddressProperty = DependencyProperty.Register(
        nameof(StartAddress), typeof(string), typeof(TsRouteDisplay), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Start latitude (NaN → none).</summary>
    public static readonly DependencyProperty StartLatProperty = DependencyProperty.Register(
        nameof(StartLat), typeof(double), typeof(TsRouteDisplay), new PropertyMetadata(double.NaN, OnChanged));

    /// <summary>Start longitude (NaN → none).</summary>
    public static readonly DependencyProperty StartLonProperty = DependencyProperty.Register(
        nameof(StartLon), typeof(double), typeof(TsRouteDisplay), new PropertyMetadata(double.NaN, OnChanged));

    /// <summary>Resolved end address (preferred over coordinates).</summary>
    public static readonly DependencyProperty EndAddressProperty = DependencyProperty.Register(
        nameof(EndAddress), typeof(string), typeof(TsRouteDisplay), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>End latitude (NaN → none).</summary>
    public static readonly DependencyProperty EndLatProperty = DependencyProperty.Register(
        nameof(EndLat), typeof(double), typeof(TsRouteDisplay), new PropertyMetadata(double.NaN, OnChanged));

    /// <summary>End longitude (NaN → none).</summary>
    public static readonly DependencyProperty EndLonProperty = DependencyProperty.Register(
        nameof(EndLon), typeof(double), typeof(TsRouteDisplay), new PropertyMetadata(double.NaN, OnChanged));

    /// <summary>When true, no end endpoint is supplied (single-location round trip).</summary>
    public static readonly DependencyProperty SingleLocationProperty = DependencyProperty.Register(
        nameof(SingleLocation), typeof(bool), typeof(TsRouteDisplay), new PropertyMetadata(false, OnChanged));

    /// <summary>Initialise the display.</summary>
    public TsRouteDisplay()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>Start address.</summary>
    public string StartAddress
    {
        get => (string)GetValue(StartAddressProperty);
        set => SetValue(StartAddressProperty, value);
    }

    /// <summary>Start latitude.</summary>
    public double StartLat
    {
        get => (double)GetValue(StartLatProperty);
        set => SetValue(StartLatProperty, value);
    }

    /// <summary>Start longitude.</summary>
    public double StartLon
    {
        get => (double)GetValue(StartLonProperty);
        set => SetValue(StartLonProperty, value);
    }

    /// <summary>End address.</summary>
    public string EndAddress
    {
        get => (string)GetValue(EndAddressProperty);
        set => SetValue(EndAddressProperty, value);
    }

    /// <summary>End latitude.</summary>
    public double EndLat
    {
        get => (double)GetValue(EndLatProperty);
        set => SetValue(EndLatProperty, value);
    }

    /// <summary>End longitude.</summary>
    public double EndLon
    {
        get => (double)GetValue(EndLonProperty);
        set => SetValue(EndLonProperty, value);
    }

    /// <summary>Whether this is an explicit single-location round trip.</summary>
    public bool SingleLocation
    {
        get => (bool)GetValue(SingleLocationProperty);
        set => SetValue(SingleLocationProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsRouteDisplay)d).Rebuild();

    private static double? Nullable(double v) => double.IsNaN(v) || double.IsInfinity(v) ? null : v;

    private RouteEndpoint StartEndpoint() => new(
        string.IsNullOrEmpty(StartAddress) ? null : StartAddress, Nullable(StartLat), Nullable(StartLon));

    private RouteEndpoint EndEndpoint() => new(
        string.IsNullOrEmpty(EndAddress) ? null : EndAddress, Nullable(EndLat), Nullable(EndLon));

    private void Rebuild()
    {
        RouteEndpoint? end = SingleLocation ? null : EndEndpoint();
        var result = RouteLogic.Resolve(StartEndpoint(), end);

        var row = DisplayPrimitives.Row(6);
        row.Children.Add(new FontIcon { Glyph = "\uE707", FontSize = 12, Foreground = DisplayTokens.Accent });

        switch (result.Kind)
        {
            case RouteKind.None:
                row.Children.Add(DisplayPrimitives.Caption("No location data"));
                break;
            case RouteKind.RoundTrip:
                row.Children.Add(DisplayPrimitives.Label(result.StartLabel ?? "\u2014"));
                row.Children.Add(DisplayPrimitives.Caption("(round trip)"));
                break;
            default:
                row.Children.Add(DisplayPrimitives.Label(result.StartLabel ?? "\u2014"));
                row.Children.Add(new FontIcon { Glyph = "\uE72A", FontSize = 11, Foreground = DisplayTokens.TextMuted });
                row.Children.Add(DisplayPrimitives.Label(result.EndLabel ?? "\u2014"));
                break;
        }

        Content = row;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(
            this, $"{result.StartLabel} to {result.EndLabel}".Trim());
    }
}

/// <summary>
/// Generic history/list row (mirrors the web <c>HistoryListRow</c>): a leading accent
/// glyph, a title + subtitle stack, and a trailing pre-formatted value with a chevron.
/// </summary>
public sealed partial class TsHistoryListRow : ContentControl
{
    /// <summary>Leading Fluent glyph.</summary>
    public static readonly DependencyProperty GlyphProperty = DependencyProperty.Register(
        nameof(Glyph), typeof(string), typeof(TsHistoryListRow), new PropertyMetadata("\uE81C", OnChanged));

    /// <summary>Primary title.</summary>
    public static readonly DependencyProperty TitleProperty = DependencyProperty.Register(
        nameof(Title), typeof(string), typeof(TsHistoryListRow), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Secondary subtitle.</summary>
    public static readonly DependencyProperty SubtitleProperty = DependencyProperty.Register(
        nameof(Subtitle), typeof(string), typeof(TsHistoryListRow), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Trailing pre-formatted value.</summary>
    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        nameof(Value), typeof(string), typeof(TsHistoryListRow), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Initialise the row.</summary>
    public TsHistoryListRow()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>The leading glyph.</summary>
    public string Glyph
    {
        get => (string)GetValue(GlyphProperty);
        set => SetValue(GlyphProperty, value);
    }

    /// <summary>The title.</summary>
    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    /// <summary>The subtitle.</summary>
    public string Subtitle
    {
        get => (string)GetValue(SubtitleProperty);
        set => SetValue(SubtitleProperty, value);
    }

    /// <summary>The trailing value.</summary>
    public string Value
    {
        get => (string)GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsHistoryListRow)d).Rebuild();

    private void Rebuild()
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var icon = new FontIcon
        {
            Glyph = Glyph,
            FontSize = 16,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 12, 0),
        };
        Grid.SetColumn(icon, 0);

        var body = DisplayPrimitives.Column(0);
        body.VerticalAlignment = VerticalAlignment.Center;
        body.Children.Add(DisplayPrimitives.Value(Title, 14));
        if (!string.IsNullOrEmpty(Subtitle))
        {
            body.Children.Add(DisplayPrimitives.Caption(Subtitle));
        }

        Grid.SetColumn(body, 1);

        var trailing = DisplayPrimitives.Row(8);
        trailing.Children.Add(DisplayPrimitives.Value(string.IsNullOrEmpty(Value) ? "\u2014" : Value, 14));
        trailing.Children.Add(new FontIcon { Glyph = "\uE76C", FontSize = 12, Foreground = DisplayTokens.TextMuted });
        Grid.SetColumn(trailing, 2);

        grid.Children.Add(icon);
        grid.Children.Add(body);
        grid.Children.Add(trailing);

        var card = DisplayPrimitives.Card(grid);
        card.Padding = new Thickness(12);
        Content = card;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, $"{Title} {Value}");
    }
}
