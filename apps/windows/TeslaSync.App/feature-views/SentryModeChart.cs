using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>SentryModeChart</c> feature surface — a parity port of
/// web/src/features/admin/components/security-access/SentryModeChart.tsx. It is a pure presentational
/// control: assign a <see cref="Model"/> (the web <c>sentryBuckets: SentryDayBucket[]</c> prop plus the
/// parent's fetch flag) and it renders exactly one of three web-derived branches inside a translucent
/// <see cref="TsGlassPanel"/> faded in with the web's 0.2s delay — <see cref="SentryModeChartState.Loading"/>
/// (the title + skeleton chrome while the parent fetches the security history),
/// <see cref="SentryModeChartState.Empty"/> (the title + a friendly <c>common.noData</c> empty state, the
/// native stand-in for the web's <c>sentryBuckets.length &gt; 0 ? … : EmptyState</c> gate), or
/// <see cref="SentryModeChartState.Ready"/> (the per-day stacked Sentry On / Sentry Off bar strip — the native
/// analogue of the recharts stacked <c>BarChart</c> with its two <c>stackId="sentry"</c> bars, built-in legend
/// and short-date axis). The view never performs HTTP; all branch selection, scaling, label resolution and
/// formatting happen in the WinUI-free <see cref="SentryModeChartProjection"/>. Every string resolves through
/// the i18n facade and every region/column carries a Narrator name.
/// </summary>
public sealed partial class SentryModeChart : ContentControl
{
    // web `<div className="h-64">` — the 16rem (256px) plot area for the bars.
    private const double BarsAreaHeight = 256;

    // web <FadeIn delay={0.2}> — 0.2s expressed in milliseconds.
    private const int FadeInDelayMs = 200;

    // web GlassPanel `p-4` — the 16px inset.
    private const double PanelPadding = 16;

    // Horizontal breathing room between adjacent day columns (the web bar category gap).
    private const double BarMargin = 4;

    // web `XAxis tick={{ fontSize: 11 }}`.
    private const double AxisFontSize = 11;

    // Legend colour-swatch edge length.
    private const double LegendSwatchSize = 10;

    // Segoe Fluent "Shield" glyph — the native stand-in for the web `Activity` (lucide) empty-state icon,
    // matching the established sentry/security convention across the app's surfaces.
    private const string ShieldGlyph = "\uEA18";

    // web `Bar radius={[4, 4, 0, 0]}` — rounded top corners on the top of the stack.
    private static readonly CornerRadius RoundedTop = new(4, 4, 0, 0);
    private static readonly CornerRadius Square = new(0);

    private readonly ILocalizer _localizer;
    private readonly SentryModeChartDiagnostics _diagnostics;
    private readonly TsFadeIn _fade = new() { DelayMs = FadeInDelayMs };

    private SentryModeChartModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="SentryModeChartModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SentryModeChart(
        ILocalizer localizer,
        SentryModeChartModel? model = null,
        SentryModeChartDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? SentryModeChartModel.Pending;
        _diagnostics = diagnostics ?? new SentryModeChartDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = _fade;
        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SentryModeChart</c>).</summary>
    public static string Slug => SentryModeChartRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public SentryModeChartModel Model
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
        SentryModeChartDisplay display = SentryModeChartProjection.Project(_model, _localizer);

        UIElement surface = display.State switch
        {
            SentryModeChartState.Loading => BuildLoading(display),
            SentryModeChartState.Empty => BuildEmpty(display),
            _ => BuildReady(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        _fade.Content = surface;
    }

    // ── Loading (parent still fetching the security history) ──────────────────────────────────────────
    private static TsGlassPanel BuildLoading(SentryModeChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildTitle(display));
        stack.Children.Add(new TsSkeleton
        {
            BlockHeight = BarsAreaHeight,
            Radius = 10,
            ReduceMotion = MotionPreference.ReduceMotion,
        });

        TsGlassPanel box = Box(stack, display.AutomationName);
        LiveRegion.Configure(box);
        LiveRegion.Announce(box);
        return box;
    }

    // ── Empty (web: sentryBuckets.length === 0 → EmptyState) ──────────────────────────────────────────
    private static TsGlassPanel BuildEmpty(SentryModeChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildTitle(display));
        stack.Children.Add(new TsEmptyState
        {
            IconGlyph = ShieldGlyph,
            Message = display.EmptyMessage,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return Box(stack, display.AutomationName);
    }

    // ── Ready (web fall-through: the GlassPanel title + the legend + the stacked BarChart) ────────────
    private static TsGlassPanel BuildReady(SentryModeChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildTitle(display));
        stack.Children.Add(BuildLegend(display));
        stack.Children.Add(BuildChart(display));

        return Box(stack, display.AutomationName);
    }

    // web `<h2 className="text-lg font-semibold text-gray-200">` — the section title.
    private static SectionTitle BuildTitle(SentryModeChartDisplay display) => new() { Value = display.Title };

    /// <summary>
    /// The series legend — the native analogue of the web recharts <c>&lt;Legend /&gt;</c>: a coloured swatch
    /// plus its localized series label for each of Sentry On and Sentry Off. The swatches are decorative; the
    /// labels are read by Narrator so the colour encoding is conveyed non-visually.
    /// </summary>
    private static StackPanel BuildLegend(SentryModeChartDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
        };
        row.Children.Add(BuildLegendItem(
            DisplayTokens.Brush(SentryModeChartProjection.SentryOnBrushKey),
            display.SentryOnLabel));
        row.Children.Add(BuildLegendItem(
            DisplayTokens.Brush(SentryModeChartProjection.SentryOffBrushKey),
            display.SentryOffLabel));
        return row;
    }

    private static StackPanel BuildLegendItem(Brush swatch, string label)
    {
        var item = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var dot = new Border
        {
            Width = LegendSwatchSize,
            Height = LegendSwatchSize,
            CornerRadius = new CornerRadius(2),
            Background = swatch,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);

        item.Children.Add(dot);
        item.Children.Add(new Caption { Value = label, VerticalAlignment = VerticalAlignment.Center });
        return item;
    }

    // The plot: the stacked bars over the short-date axis labels (the web recharts XAxis ticks).
    private static StackPanel BuildChart(SentryModeChartDisplay display)
    {
        var body = new StackPanel { Spacing = 4 };
        body.Children.Add(BuildBars(display));
        body.Children.Add(BuildAxisLabels(display));
        return body;
    }

    /// <summary>
    /// The per-day stacked bar strip — the native analogue of the recharts stacked <c>&lt;BarChart&gt;</c>.
    /// Each day is one column whose two segments are scaled to the busiest day's total (so columns are
    /// comparable). Recharts stacks the first-declared series at the bottom, so Sentry On sits beneath Sentry
    /// Off; only the topmost present segment carries the web's rounded top. Every column exposes a Narrator
    /// name with its date and both tallies.
    /// </summary>
    private static Grid BuildBars(SentryModeChartDisplay display)
    {
        var columns = display.Columns;
        var area = new Grid { Height = BarsAreaHeight, VerticalAlignment = VerticalAlignment.Bottom };
        for (int i = 0; i < columns.Count; i++)
        {
            area.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        Brush onBrush = DisplayTokens.Brush(SentryModeChartProjection.SentryOnBrushKey);
        Brush offBrush = DisplayTokens.Brush(SentryModeChartProjection.SentryOffBrushKey);

        for (int i = 0; i < columns.Count; i++)
        {
            SentryModeChartColumn col = columns[i];
            bool offOnTop = col.OffRatio > 0;
            double spacer = Math.Max(0.0, 1.0 - col.OnRatio - col.OffRatio);

            var inner = new Grid();
            inner.RowDefinitions.Add(new RowDefinition { Height = new GridLength(spacer, GridUnitType.Star) });
            inner.RowDefinitions.Add(new RowDefinition { Height = new GridLength(col.OffRatio, GridUnitType.Star) });
            inner.RowDefinitions.Add(new RowDefinition { Height = new GridLength(col.OnRatio, GridUnitType.Star) });

            var offFill = new Border
            {
                Background = offBrush,
                CornerRadius = RoundedTop,
                Margin = new Thickness(BarMargin, 0, BarMargin, 0),
                VerticalAlignment = VerticalAlignment.Stretch,
                MinHeight = col.OffRatio > 0 ? 2 : 0,
                Visibility = col.OffRatio > 0 ? Visibility.Visible : Visibility.Collapsed,
            };
            Grid.SetRow(offFill, 1);
            inner.Children.Add(offFill);

            var onFill = new Border
            {
                Background = onBrush,
                CornerRadius = offOnTop ? Square : RoundedTop,
                Margin = new Thickness(BarMargin, 0, BarMargin, 0),
                VerticalAlignment = VerticalAlignment.Stretch,
                MinHeight = col.OnRatio > 0 ? 2 : 0,
                Visibility = col.OnRatio > 0 ? Visibility.Visible : Visibility.Collapsed,
            };
            Grid.SetRow(onFill, 2);
            inner.Children.Add(onFill);

            AutomationProperties.SetName(inner, col.AutomationName);
            Grid.SetColumn(inner, i);
            area.Children.Add(inner);
        }

        return area;
    }

    // The short-date category labels beneath each column (the web recharts XAxis ticks, var(--text-muted)).
    private static Grid BuildAxisLabels(SentryModeChartDisplay display)
    {
        var columns = display.Columns;
        var grid = new Grid();
        for (int i = 0; i < columns.Count; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < columns.Count; i++)
        {
            var label = new TextBlock
            {
                Text = columns[i].AxisLabel,
                FontSize = AxisFontSize,
                Foreground = DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Center,
                TextAlignment = TextAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            };
            AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
            Grid.SetColumn(label, i);
            grid.Children.Add(label);
        }

        return grid;
    }

    private static TsGlassPanel Box(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
        AutomationProperties.SetName(panel, automationName);
        return panel;
    }
}
