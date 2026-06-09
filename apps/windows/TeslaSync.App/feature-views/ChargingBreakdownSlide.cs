using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>ChargingBreakdownSlide</c> feature surface — a parity port of
/// web/src/features/analytics/components/review/ChargingBreakdownSlide.tsx. It is a presentational slide:
/// assign a <see cref="Model"/> (the web <c>data: YearReview</c> prop, narrowed to the charging fields) and
/// it renders exactly one of three web-derived branches — <see cref="ChargingBreakdownSlideState.Loading"/>
/// (skeleton chrome while the parent fetches the Year-Review), <see cref="ChargingBreakdownSlideState.Empty"/>
/// (a friendly empty state when no charge sessions exist), or <see cref="ChargingBreakdownSlideState.Ready"/>
/// (the centred hero composition the web renders: the 🔌 emoji, the "<c>{count} charge sessions</c>"
/// headline, the "<c>Average plug-in at {soc}% battery</c>" line, the connector-mix donut — the native
/// analogue of the recharts <c>PieChart</c> via <see cref="TsPieChart"/> — and the colour-keyed legend).
/// The view never performs HTTP; all branch selection, label resolution and formatting happen in the
/// WinUI-free <see cref="ChargingBreakdownSlideProjection"/>. Entrances stagger through <see cref="TsFadeIn"/>
/// (honouring reduce-motion), every string resolves through the i18n facade, and the surface + each legend
/// row carry a Narrator name.
/// </summary>
public sealed partial class ChargingBreakdownSlide : ContentControl
{
    private const double EmojiFontSize = 48; // web text-5xl
    private const double DonutSize = 224;    // web w-56 h-56
    private const double DonutInnerRadiusRatio = 0.65; // web innerRadius 55 / outerRadius 85
    private const double LegendDotSize = 12;  // web h-3 w-3
    private const string EmptyGlyph = "\uE945"; // Segoe Fluent — LightningBolt (charging)

    private readonly ILocalizer _localizer;
    private readonly ChargingBreakdownSlideDiagnostics _diagnostics;

    private ChargingBreakdownSlideModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="ChargingBreakdownSlideModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ChargingBreakdownSlide(
        ILocalizer localizer,
        ChargingBreakdownSlideModel? model = null,
        ChargingBreakdownSlideDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? ChargingBreakdownSlideModel.Pending;
        _diagnostics = diagnostics ?? new ChargingBreakdownSlideDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        Padding = new Thickness(32, 0, 32, 0); // web px-8 (centred, full-height slide)

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ChargingBreakdownSlide</c>).</summary>
    public static string Slug => ChargingBreakdownSlideRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public ChargingBreakdownSlideModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void Render()
    {
        var display = ChargingBreakdownSlideProjection.Project(_model, _localizer);

        FrameworkElement surface = display.State switch
        {
            ChargingBreakdownSlideState.Loading => BuildLoading(display),
            ChargingBreakdownSlideState.Empty => BuildEmpty(display),
            _ => BuildReady(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Loading (parent still fetching the Year-Review) ──────────────────────────────────────────────
    private static StackPanel BuildLoading(ChargingBreakdownSlideDisplay display)
    {
        var column = CenteredColumn();
        column.Children.Add(new TsSkeleton
        {
            BlockWidth = 56,
            BlockHeight = 56,
            Radius = 28,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        column.Children.Add(new TsSkeleton { BlockWidth = 220, BlockHeight = 28, HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new TsSkeleton { BlockWidth = 260, BlockHeight = 16, HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new TsSkeleton
        {
            BlockWidth = DonutSize,
            BlockHeight = DonutSize,
            Radius = DonutSize / 2,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        AutomationProperties.SetName(column, display.LoadingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    // ── Empty (web: no charging activity to break down) ──────────────────────────────────────────────
    private static TsEmptyState BuildEmpty(ChargingBreakdownSlideDisplay display) => new()
    {
        IconGlyph = EmptyGlyph,
        Message = display.EmptyMessage,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Ready (web fall-through: emoji + sessions + SoC + donut + legend) ─────────────────────────────
    private static StackPanel BuildReady(ChargingBreakdownSlideDisplay display)
    {
        var column = CenteredColumn();
        column.Children.Add(Animated(BuildEmoji(display.Emoji), 0));
        column.Children.Add(Animated(BuildSessions(display), 120));
        column.Children.Add(Animated(BuildAverageSoc(display), 220));
        column.Children.Add(Animated(BuildDonut(display), 320));
        column.Children.Add(Animated(BuildLegend(display), 460));

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    private static TextBlock BuildEmoji(string emoji)
    {
        var text = new TextBlock
        {
            Text = emoji,
            FontSize = EmojiFontSize,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };

        // Decorative: the surface automation name already conveys the slide's meaning.
        AutomationProperties.SetAccessibilityView(text, AccessibilityView.Raw);
        return text;
    }

    private static TextBlock BuildSessions(ChargingBreakdownSlideDisplay display)
    {
        var text = CenteredText(
            display.SessionsLine,
            TypographyTokens.Size("TsTypeTitleFontSize", 24),
            DisplayTokens.TextPrimary);
        text.FontWeight = FontWeights.Bold;
        return text;
    }

    private static TextBlock BuildAverageSoc(ChargingBreakdownSlideDisplay display) => CenteredText(
        display.AverageSocText,
        TypographyTokens.Size("TsTypePanelFontSize", 16),
        DisplayTokens.TextMuted);

    private static FrameworkElement BuildDonut(ChargingBreakdownSlideDisplay display)
    {
        if (display.Segments.Count == 0)
        {
            // Sessions exist but every share rounds away — show an in-place note, never a blank ring.
            var note = CenteredText(
                display.EmptyMessage,
                TypographyTokens.Size("TsTypeBodyFontSize", 14),
                DisplayTokens.TextMuted);
            note.Height = DonutSize;
            note.VerticalAlignment = VerticalAlignment.Center;
            return note;
        }

        var points = new List<ChartPoint>(display.Segments.Count);
        foreach (var segment in display.Segments)
        {
            points.Add(new ChartPoint(0, segment.Percent, segment.Name));
        }

        var donut = new TsPieChart
        {
            Values = points,
            InnerRadiusRatio = DonutInnerRadiusRatio,
            Width = DonutSize,
            Height = DonutSize,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(donut, display.ChartSummary);
        return donut;
    }

    private static StackPanel BuildLegend(ChargingBreakdownSlideDisplay display)
    {
        var legend = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 20,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        foreach (var segment in display.Segments)
        {
            legend.Children.Add(BuildLegendItem(segment));
        }

        return legend;
    }

    private static StackPanel BuildLegendItem(ChargingBreakdownSegment segment)
    {
        var item = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var dot = new Ellipse
        {
            Width = LegendDotSize,
            Height = LegendDotSize,
            Fill = ChartBrushes.ForIndex(segment.ColorIndex),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = segment.LegendText,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };

        item.Children.Add(dot);
        item.Children.Add(label);
        AutomationProperties.SetName(item, segment.AutomationName);
        return item;
    }

    private static TsFadeIn Animated(FrameworkElement child, int delayMs) => new()
    {
        DelayMs = delayMs,
        HorizontalAlignment = HorizontalAlignment.Center,
        Content = child,
    };

    private static StackPanel CenteredColumn() => new()
    {
        Spacing = 16,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static TextBlock CenteredText(string text, double fontSize, Brush foreground) => new()
    {
        Text = text,
        FontSize = fontSize,
        Foreground = foreground,
        TextWrapping = TextWrapping.Wrap,
        TextAlignment = TextAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
    };
}
