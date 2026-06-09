using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>BatteryLevelChart</c> feature surface — a parity port of
/// web/src/features/charging/components/charging-list/BatteryLevelChart.tsx. It is a pure presentational
/// control: assign a <see cref="Model"/> (the web <c>data: StartLevelBucket[]</c> prop plus the parent's
/// fetch flag) and it renders exactly one of three web-derived branches inside a translucent
/// <see cref="TsGlassPanel"/> — <see cref="BatteryLevelChartState.Loading"/> (the amber battery title +
/// skeleton chrome while the parent fetches the sessions), <see cref="BatteryLevelChartState.Empty"/> (the
/// title + a friendly <c>chart.noData</c> empty state when no session has a starting level), or
/// <see cref="BatteryLevelChartState.Ready"/> (the SoC-band sample-count bar strip — the native analogue of
/// the recharts <c>BarChart</c> whose amber bars are filled at the web's 60% opacity with rounded tops). The
/// view never performs HTTP; all branch selection, label resolution and formatting happen in the WinUI-free
/// <see cref="BatteryLevelChartProjection"/>. Every string resolves through the i18n facade and every
/// region/bar carries a Narrator name.
/// </summary>
public sealed partial class BatteryLevelChart : ContentControl
{
    // web `<div className="h-36 sm:h-44">` — the taller sm breakpoint (11rem ≈ 176px) for the bars area.
    private const double BarsAreaHeight = 176;

    // Segoe Fluent "Battery" glyph — the native stand-in for the web `BatteryCharging` (lucide) header icon,
    // matching the established convention across the charging widgets.
    private const string BatteryChargingGlyph = "\uE83F";

    // web `fillOpacity={0.6}` on the amber bars.
    private const double FillOpacity = 0.6;

    private readonly ILocalizer _localizer;
    private readonly BatteryLevelChartDiagnostics _diagnostics;

    private BatteryLevelChartModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="BatteryLevelChartModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public BatteryLevelChart(
        ILocalizer localizer,
        BatteryLevelChartModel? model = null,
        BatteryLevelChartDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? BatteryLevelChartModel.Pending;
        _diagnostics = diagnostics ?? new BatteryLevelChartDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>BatteryLevelChart</c>).</summary>
    public static string Slug => BatteryLevelChartRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public BatteryLevelChartModel Model
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
        var display = BatteryLevelChartProjection.Project(_model, _localizer);

        UIElement surface = display.State switch
        {
            BatteryLevelChartState.Loading => BuildLoading(display),
            BatteryLevelChartState.Empty => BuildEmpty(display),
            _ => BuildReady(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Loading (parent still fetching the sessions) ─────────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(BatteryLevelChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsSkeleton { BlockHeight = BarsAreaHeight, Radius = 10 });

        var box = Box(stack, display.AutomationName);
        LiveRegion.Configure(box);
        LiveRegion.Announce(box);
        return box;
    }

    // ── Empty (web: no session has a starting level to bucket) ───────────────────────────────────────
    private static TsGlassPanel BuildEmpty(BatteryLevelChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsEmptyState
        {
            IconGlyph = BatteryChargingGlyph,
            Message = display.EmptyMessage,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return Box(stack, display.AutomationName);
    }

    // ── Ready (web fall-through: the GlassPanel header + the BarChart) ────────────────────────────────
    private static TsGlassPanel BuildReady(BatteryLevelChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(BuildBars(display));

        return Box(stack, display.AutomationName);
    }

    // web `<h3 className="section-title flex items-center gap-2">` — the amber BatteryCharging icon + the
    // title, with the muted hint beneath (the web inline `<span>` rendered as a native caption row).
    private static StackPanel BuildHeader(BatteryLevelChartDisplay display)
    {
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };

        var icon = new FontIcon
        {
            Glyph = BatteryChargingGlyph,
            FontSize = 16,
            Foreground = AmberBrush(),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        titleRow.Children.Add(icon);
        titleRow.Children.Add(new PanelTitle { Value = display.Title, VerticalAlignment = VerticalAlignment.Center });

        var header = new StackPanel { Spacing = 2 };
        header.Children.Add(titleRow);
        header.Children.Add(new Caption { Value = display.Hint });
        return header;
    }

    /// <summary>
    /// The amber SoC-band sample-count bar strip — the native analogue of the web recharts <c>BarChart</c>.
    /// Each bar's height is scaled to the projected <see cref="BatteryLevelChartBar.HeightRatio"/> (0..1 of
    /// the tallest bucket), filled with the warning/amber design token at the web's 60% opacity with rounded
    /// tops, and labelled with its SoC band beneath. Every bar carries a Narrator name with its band + count.
    /// </summary>
    private static StackPanel BuildBars(BatteryLevelChartDisplay display)
    {
        var bars = display.Bars;
        var chart = new StackPanel { Spacing = 4 };
        AutomationProperties.SetName(chart, display.Title);

        var barsArea = new Grid { Height = BarsAreaHeight, VerticalAlignment = VerticalAlignment.Bottom };
        var labelsRow = new Grid();
        for (int i = 0; i < bars.Count; i++)
        {
            barsArea.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            labelsRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var fillBrush = AmberBrush();
        for (int i = 0; i < bars.Count; i++)
        {
            var bar = bars[i];

            var inner = new Grid();
            inner.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Math.Max(0.0, 1 - bar.HeightRatio), GridUnitType.Star) });
            inner.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Math.Max(0.0, bar.HeightRatio), GridUnitType.Star) });

            var fill = new Border
            {
                Background = fillBrush,
                Opacity = FillOpacity,
                CornerRadius = new CornerRadius(4, 4, 0, 0),
                Margin = new Thickness(3, 0, 3, 0),
                VerticalAlignment = VerticalAlignment.Stretch,
                MinHeight = bar.HeightRatio > 0 ? 2 : 0,
            };
            Grid.SetRow(fill, 1);
            inner.Children.Add(fill);

            Grid.SetColumn(inner, i);
            barsArea.Children.Add(inner);
            AutomationProperties.SetName(inner, bar.AutomationName);

            var lbl = new TextBlock
            {
                Text = bar.Range,
                FontSize = 9,
                Foreground = DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            };
            AutomationProperties.SetAccessibilityView(lbl, AccessibilityView.Raw);
            Grid.SetColumn(lbl, i);
            labelsRow.Children.Add(lbl);
        }

        chart.Children.Add(barsArea);
        chart.Children.Add(labelsRow);
        return chart;
    }

    private static TsGlassPanel Box(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(24), Content = content }; // web p-6
        AutomationProperties.SetName(panel, automationName);
        return panel;
    }

    // The web amber (`#f59e0b` / `text-neon-amber`) mapped to the theme-aware warning design token rather
    // than a hard-coded hex, so the icon + bars stay correct across light / dark / high-contrast.
    private static Brush AmberBrush() => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Warning));
}
