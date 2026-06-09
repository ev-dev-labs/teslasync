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
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>ChargerTypeBreakdown</c> feature surface — a parity port of
/// web/src/features/charging/components/cost-analysis/ChargerTypeBreakdown.tsx. It is a pure presentational
/// control: assign a <see cref="Model"/> (the web <c>data</c> + <c>totalCost</c> props) and it renders exactly
/// one of three web-derived branches — <see cref="ChargerTypeBreakdownState.Loading"/> (title + skeleton
/// chrome while the parent computes the breakdown), <see cref="ChargerTypeBreakdownState.Empty"/> (title + a
/// friendly empty state, the web <c>costAnalysis.charts.noData</c> message), or
/// <see cref="ChargerTypeBreakdownState.Ready"/> (the cost-weighted connector donut — the native analogue of
/// the recharts <c>PieChart</c> via <see cref="TsPieChart"/> — alongside the colour-keyed legend and the
/// per-type detail bars the web source lays out beside it: name, <c>{cost} · {n} sessions</c>, a share bar,
/// and the energy / cost-per-kWh / share footer). The title's lightning glyph stands in for the web Lucide
/// <c>Zap</c> icon and is tinted with the warning accent (the web <c>text-yellow-400</c>). The view never
/// performs HTTP; all branch selection, label resolution and formatting happen in the WinUI-free
/// <see cref="ChargerTypeBreakdownProjection"/>. Every string resolves through the i18n facade and every
/// region, legend chip and bar carries a Narrator name.
/// </summary>
public sealed partial class ChargerTypeBreakdown : ContentControl
{
    private const double DonutSize = 240;            // web ResponsiveContainer height 280, donut inner 60 / outer 100
    private const double DonutInnerRadiusRatio = 0.6; // web innerRadius 60 / outerRadius 100
    private const double LegendDotSize = 12;          // web h-3 w-3
    private const double BarTrackHeight = 8;          // web h-2
    private const double NameFontSize = 12;           // web text-xs
    private const double FooterFontSize = 10;         // web text-[10px]

    private readonly ILocalizer _localizer;
    private readonly ChargerTypeBreakdownDiagnostics _diagnostics;
    private readonly string? _currencySymbol;

    private ChargerTypeBreakdownModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics/currency.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="ChargerTypeBreakdownModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="currencySymbol">The currency symbol (web <c>settings.currency_symbol</c>; default "$").</param>
    public ChargerTypeBreakdown(
        ILocalizer localizer,
        ChargerTypeBreakdownModel? model = null,
        ChargerTypeBreakdownDiagnostics? diagnostics = null,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? ChargerTypeBreakdownModel.Pending;
        _diagnostics = diagnostics ?? new ChargerTypeBreakdownDiagnostics();
        _currencySymbol = currencySymbol;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ChargerTypeBreakdown</c>).</summary>
    public static string Slug => ChargerTypeBreakdownRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public ChargerTypeBreakdownModel Model
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
        var display = ChargerTypeBreakdownProjection.Project(_model, _localizer, _currencySymbol);

        UIElement surface = display.State switch
        {
            ChargerTypeBreakdownState.Loading => BuildLoading(display),
            ChargerTypeBreakdownState.Empty => BuildEmpty(display),
            _ => BuildReady(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Loading (parent still computing the breakdown) ───────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(ChargerTypeBreakdownDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildHeader(display));

        var body = TwoColumnGrid();
        var donutSkeleton = new TsSkeleton
        {
            BlockWidth = DonutSize,
            BlockHeight = DonutSize,
            Radius = DonutSize / 2,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        Grid.SetColumn(donutSkeleton, 0);
        body.Children.Add(donutSkeleton);

        var bars = new StackPanel { Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        for (int i = 0; i < 3; i++)
        {
            bars.Children.Add(new TsSkeleton { BlockHeight = 16 });
            bars.Children.Add(new TsSkeleton { BlockHeight = BarTrackHeight });
        }

        Grid.SetColumn(bars, 1);
        body.Children.Add(bars);
        stack.Children.Add(body);

        var box = Box(stack, display.AutomationName);
        LiveRegion.Configure(box);
        LiveRegion.Announce(box);
        return box;
    }

    // ── Empty (web `data.length === 0` → "Not enough data") ──────────────────────────────────────────
    private static TsGlassPanel BuildEmpty(ChargerTypeBreakdownDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsEmptyState
        {
            Message = display.EmptyMessage,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return Box(stack, display.AutomationName);
    }

    // ── Ready (web fall-through: donut + legend + per-type detail bars) ───────────────────────────────
    private static TsGlassPanel BuildReady(ChargerTypeBreakdownDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildHeader(display));

        var body = TwoColumnGrid();

        var donut = BuildDonut(display);
        Grid.SetColumn(donut, 0);
        body.Children.Add(donut);

        var detail = BuildDetail(display);
        Grid.SetColumn(detail, 1);
        body.Children.Add(detail);

        stack.Children.Add(body);
        return Box(stack, display.AutomationName);
    }

    private static StackPanel BuildHeader(ChargerTypeBreakdownDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = ChargerTypeBreakdownRegistration.TitleGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Warning)),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        row.Children.Add(icon);
        row.Children.Add(new PanelTitle { Value = display.Title, VerticalAlignment = VerticalAlignment.Center });
        AutomationProperties.SetName(row, display.Title);
        return row;
    }

    /// <summary>
    /// The cost-weighted connector donut — the native analogue of the web recharts <c>PieChart</c>
    /// (<c>dataKey="cost"</c>, <c>innerRadius 60 / outerRadius 100</c>). Each wedge is tinted from the brand
    /// palette by its row position so the legend dot, wedge and detail bar of a charger type all share one
    /// colour. The donut carries the spoken share summary as its Narrator name.
    /// </summary>
    private static TsPieChart BuildDonut(ChargerTypeBreakdownDisplay display)
    {
        var points = new List<ChartPoint>(display.Slices.Count);
        foreach (var slice in display.Slices)
        {
            points.Add(new ChartPoint(0, slice.Cost, slice.Name));
        }

        var donut = new TsPieChart
        {
            Values = points,
            InnerRadiusRatio = DonutInnerRadiusRatio,
            Width = DonutSize,
            Height = DonutSize,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(donut, display.ChartSummary);
        return donut;
    }

    private static StackPanel BuildDetail(ChargerTypeBreakdownDisplay display)
    {
        var detail = new StackPanel { Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        detail.Children.Add(BuildLegend(display));
        foreach (var slice in display.Slices)
        {
            detail.Children.Add(BuildBarBlock(slice));
        }

        return detail;
    }

    private static StackPanel BuildLegend(ChargerTypeBreakdownDisplay display)
    {
        var legend = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
        };

        foreach (var slice in display.Slices)
        {
            var item = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 6,
                VerticalAlignment = VerticalAlignment.Center,
            };

            var dot = new Ellipse
            {
                Width = LegendDotSize,
                Height = LegendDotSize,
                Fill = ChartBrushes.ForIndex(slice.ColorIndex),
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);

            item.Children.Add(dot);
            item.Children.Add(new TextBlock
            {
                Text = slice.Name,
                FontSize = NameFontSize,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            });
            AutomationProperties.SetName(item, slice.Name);
            legend.Children.Add(item);
        }

        return legend;
    }

    /// <summary>
    /// One charger type's detail block — the native analogue of a single web detail row: the name + the
    /// "<c>{cost} · {n} sessions</c>" caption, the palette-tinted share bar (its filled width the type's
    /// percentage of total cost), and the energy / cost-per-kWh / share footer.
    /// </summary>
    private static StackPanel BuildBarBlock(ChargerTypeBreakdownSlice slice)
    {
        var block = new StackPanel { Spacing = 4 };

        // Name (left) + cost · sessions caption (right).
        var headRow = new Grid();
        headRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Auto) });

        var name = new TextBlock
        {
            Text = slice.Name,
            FontSize = NameFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(name, 0);
        headRow.Children.Add(name);

        var meta = new TextBlock
        {
            Text = slice.MetaText,
            FontSize = NameFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(meta, 1);
        headRow.Children.Add(meta);
        block.Children.Add(headRow);

        block.Children.Add(BuildShareBar(slice));

        // Footer: energy (left) · cost-per-kWh (centre) · share (right).
        var footer = new Grid();
        for (int i = 0; i < 3; i++)
        {
            footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var energy = FooterText(slice.EnergyText, HorizontalAlignment.Left);
        Grid.SetColumn(energy, 0);
        footer.Children.Add(energy);

        var perKwh = FooterText(slice.PerKwhText, HorizontalAlignment.Center);
        Grid.SetColumn(perKwh, 1);
        footer.Children.Add(perKwh);

        var share = FooterText(slice.PercentText, HorizontalAlignment.Right);
        Grid.SetColumn(share, 2);
        footer.Children.Add(share);
        block.Children.Add(footer);

        AutomationProperties.SetName(block, slice.AutomationName);
        return block;
    }

    private static Border BuildShareBar(ChargerTypeBreakdownSlice slice)
    {
        double pct = Math.Clamp(slice.Percent, 0, 100);

        var fillRow = new Grid();
        fillRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(pct, GridUnitType.Star) });
        fillRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(100 - pct, GridUnitType.Star) });

        var fill = new Border
        {
            CornerRadius = new CornerRadius(BarTrackHeight / 2),
            Background = ChartBrushes.ForIndex(slice.ColorIndex),
        };
        Grid.SetColumn(fill, 0);
        fillRow.Children.Add(fill);

        var track = new Border
        {
            Height = BarTrackHeight,
            CornerRadius = new CornerRadius(BarTrackHeight / 2),
            Background = DisplayTokens.Border,
            Child = fillRow,
        };
        AutomationProperties.SetAccessibilityView(track, AccessibilityView.Raw);
        return track;
    }

    private static TextBlock FooterText(string text, HorizontalAlignment alignment) => new()
    {
        Text = text,
        FontSize = FooterFontSize,
        Foreground = DisplayTokens.TextMuted,
        HorizontalAlignment = alignment,
        TextTrimming = TextTrimming.CharacterEllipsis,
        TextWrapping = TextWrapping.NoWrap,
    };

    private static Grid TwoColumnGrid()
    {
        var grid = new Grid { ColumnSpacing = 24 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Auto) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        return grid;
    }

    private static TsGlassPanel Box(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = content };
        AutomationProperties.SetName(panel, automationName);
        return panel;
    }
}
