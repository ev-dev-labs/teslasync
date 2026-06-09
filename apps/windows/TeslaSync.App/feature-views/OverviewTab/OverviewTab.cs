using System.ComponentModel;
using Microsoft.UI.Dispatching;
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
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using Windows.Foundation;
using Windows.UI;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The native WinUI 3 <c>OverviewTab</c> feature surface — a parity port of
/// web/src/features/analytics/components/analytics/OverviewTab.tsx. It reproduces the web component's four
/// panels: a <b>Distance by Vehicle</b> bar chart (the per-vehicle distance converted to the user's unit), a
/// <b>Day of Week Pattern</b> composed chart (a drives bar on the left axis plus an average-distance line on
/// the right), a <b>Monthly Cost Comparison</b> composed chart (electric + gas cost bars plus a savings line),
/// and a <b>Quick Links</b> grid. Each chart shows its own friendly empty state when its series is empty (web
/// per-section <c>EmptyState</c>), and the whole surface renders the loading / loaded / empty / error / stale
/// / offline branches the cache-then-network fleet read can yield. The data is bound through the shared
/// <see cref="OverviewTabViewModel"/> (P1/S8 state-holder seam); the view never performs HTTP. Every string
/// resolves through the i18n facade, every bar / line point / link carries a Narrator name, and the layout
/// uses platform tokens (no ported web styling). The embedded web <c>OverviewVehicleComparison</c> is a
/// separate surface (W-0060) with its own prompt; this view exposes a <see cref="VehicleComparison"/>
/// composition slot at the web ordering position so the host page can place that surface without this one
/// re-implementing it.
/// </summary>
public sealed partial class OverviewTab : ContentControl, IDisposable
{
    private const double PlotHeight = 240;
    private const string ChevronGlyph = "\uE76C"; // ChevronRight — web ArrowRight
    private const string OfflineGlyph = "\uEB5E";  // StreetsideSplitMinimize / cloud-off style

    private readonly OverviewTabViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly OverviewTabDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private UIElement? _vehicleComparison;
    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units and diagnostics.</summary>
    public OverviewTab(
        IOverviewTabSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        OverviewTabDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new OverviewTabDiagnostics();
        _viewModel = new OverviewTabViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _localizer.GetString("analytics.tabs.overview", "Overview"));
        AutomationProperties.SetLandmarkType(this, AutomationLandmarkType.Main);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface reports under (<c>OverviewTab</c>).</summary>
    public static string Slug => OverviewTabRegistration.Slug;

    /// <summary>Raised when a Quick Link is invoked; the argument is the in-app route (e.g. <c>/statistics</c>).</summary>
    public event EventHandler<string>? QuickLinkInvoked;

    /// <summary>The user's unit preference; reassigning re-projects the current snapshot in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Optional native <c>OverviewVehicleComparison</c> surface (W-0060) injected by the host page. When set
    /// it is rendered at the web ordering position — between the Distance and Day-of-Week panels — preserving
    /// the web composition without this surface re-implementing the separate one.
    /// </summary>
    public UIElement? VehicleComparison
    {
        get => _vehicleComparison;
        set
        {
            _vehicleComparison = value;
            ScheduleRender();
        }
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="OverviewTabSource"/> from the shared
    /// data layer (the host's P2-core dependencies).
    /// </summary>
    public static OverviewTab Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        OverviewTabDiagnostics? diagnostics = null)
    {
        var source = new OverviewTabSource(api, engine, options);
        return new OverviewTab(source, localizer, units, diagnostics);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) => ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        Content = _viewModel.State switch
        {
            OverviewTabState.Loading => BuildLoading(),
            OverviewTabState.Error => BuildError(),
            OverviewTabState.Empty => BuildEmpty(),
            _ => BuildContent(),
        };
    }

    // ── Loading ──────────────────────────────────────────────────────────────────────────────────────
    private StackPanel BuildLoading()
    {
        var stack = new StackPanel { Spacing = 16 };
        for (int i = 0; i < 3; i++)
        {
            var panel = new StackPanel { Spacing = 12 };
            panel.Children.Add(new TsSkeleton { BlockWidth = 180, BlockHeight = 16 });
            panel.Children.Add(new TsSkeleton { BlockHeight = (int)PlotHeight });
            stack.Children.Add(new TsGlassPanel { Padding = new Thickness(16), Content = panel });
        }

        AutomationProperties.SetName(stack, _localizer.GetString("analytics.overview.loading", "Loading analytics"));
        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        return stack;
    }

    // ── Error (web QueryError) ───────────────────────────────────────────────────────────────────────
    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("analytics.overview.error", "Couldn't load analytics"),
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += (_, _) => _ = _viewModel.RetryAsync();
        return error;
    }

    // ── Empty (no analytics object at all) ───────────────────────────────────────────────────────────
    private TsEmptyState BuildEmpty() => new()
    {
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Content (web active-tab body wrapped in FadeIn) ──────────────────────────────────────────────
    private TsFadeIn BuildContent()
    {
        var display = _viewModel.Display;
        var stack = new StackPanel { Spacing = 16 };

        var strip = BuildStatusStrip();
        if (strip is not null)
        {
            stack.Children.Add(strip);
        }

        stack.Children.Add(BuildChartPanel(display.Charts[0])); // Distance by Vehicle

        if (_vehicleComparison is { } comparison)
        {
            stack.Children.Add(comparison); // composition seam (W-0060)
        }

        stack.Children.Add(BuildChartPanel(display.Charts[1])); // Day of Week Pattern
        stack.Children.Add(BuildChartPanel(display.Charts[2])); // Monthly Cost Comparison
        stack.Children.Add(BuildQuickLinksPanel(display));

        return new TsFadeIn { Content = stack };
    }

    private StackPanel? BuildStatusStrip()
    {
        if (_viewModel.State == OverviewTabState.Loaded && !_viewModel.IsFetching)
        {
            return null; // fresh — no chrome, matching the clean web tab body
        }

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };

        if (_viewModel.State == OverviewTabState.Offline)
        {
            row.Children.Add(Pill(OfflineGlyph, _viewModel.OfflineLabel, DisplayTokens.Brush("TsColorWarningBrush")));
            var retry = new TsButton { Text = _viewModel.RetryLabel, Variant = ButtonVariant.Secondary };
            retry.Click += (_, _) => _ = _viewModel.RetryAsync();
            row.Children.Add(retry);
        }
        else
        {
            row.Children.Add(new TsDataFreshness
            {
                UpdatedAt = _viewModel.UpdatedAt,
                IsFetching = _viewModel.IsFetching,
                IsError = false,
            });
            if (_viewModel.IsStale)
            {
                row.Children.Add(new Caption { Value = _viewModel.StaleLabel, VerticalAlignment = VerticalAlignment.Center });
            }
        }

        return row;
    }

    private static Border Pill(string glyph, string text, Brush accent)
    {
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        var icon = new FontIcon { Glyph = glyph, FontSize = 12, Foreground = accent };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        content.Children.Add(icon);
        content.Children.Add(new TextBlock { Text = text, FontSize = 12, Foreground = accent, VerticalAlignment = VerticalAlignment.Center });

        var pill = new Border
        {
            Child = content,
            CornerRadius = new CornerRadius(999),
            BorderBrush = accent,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(10, 4, 10, 4),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(pill, text);
        return pill;
    }

    // ── Chart panel (GlassPanel → title + chart | empty) ─────────────────────────────────────────────
    private static TsGlassPanel BuildChartPanel(OverviewChart chart)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(new SectionTitle { Value = chart.Title });

        if (chart.HasData)
        {
            stack.Children.Add(BuildPlot(chart));
            stack.Children.Add(BuildCategoryLabels(chart));
            if (chart.LineSeries is not null || chart.BarSeries.Count > 1)
            {
                stack.Children.Add(BuildLegend(chart));
            }
        }
        else
        {
            stack.Children.Add(new TsEmptyState
            {
                Message = chart.EmptyMessage,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = stack };
        AutomationProperties.SetName(panel, chart.AriaLabel);
        return panel;
    }

    // The bars (grouped, ratio-sized via a two-row grid so no pixel maths is needed) plus an overlaid line
    // canvas for the right-axis series. Mirrors the web recharts BarChart / ComposedChart plot area.
    private static Grid BuildPlot(OverviewChart chart)
    {
        int n = chart.Categories.Count;
        var plot = new Grid { Height = PlotHeight };
        AutomationProperties.SetName(plot, chart.AriaLabel);

        var bars = new Grid();
        for (int c = 0; c < n; c++)
        {
            bars.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int ci = 0; ci < n; ci++)
        {
            var cell = new Grid();
            for (int s = 0; s < chart.BarSeries.Count; s++)
            {
                cell.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            }

            for (int s = 0; s < chart.BarSeries.Count; s++)
            {
                var series = chart.BarSeries[s];
                var bar = series.Bars[ci];
                var holder = new Grid();
                holder.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Math.Max(0.0, 1 - bar.HeightRatio), GridUnitType.Star) });
                holder.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Math.Max(0.0, bar.HeightRatio), GridUnitType.Star) });

                var fill = new Border
                {
                    Background = ChartBrushes.ForIndex(series.ColorIndex),
                    CornerRadius = new CornerRadius(3, 3, 0, 0),
                    Margin = new Thickness(2, 0, 2, 0),
                    MinHeight = bar.HeightRatio > 0 ? 2 : 0,
                    VerticalAlignment = VerticalAlignment.Stretch,
                };
                Grid.SetRow(fill, 1);
                holder.Children.Add(fill);
                AutomationProperties.SetName(holder, bar.AutomationName);
                Grid.SetColumn(holder, s);
                cell.Children.Add(holder);
            }

            Grid.SetColumn(cell, ci);
            bars.Children.Add(cell);
        }

        plot.Children.Add(bars);

        if (chart.LineSeries is { } line)
        {
            var canvas = new Canvas { IsHitTestVisible = false };
            canvas.SizeChanged += (_, e) => DrawLine(canvas, line, n, e.NewSize);
            plot.Children.Add(canvas);
        }

        return plot;
    }

    private static void DrawLine(Canvas canvas, OverviewLineSeries line, int n, Size size)
    {
        canvas.Children.Clear();
        double w = size.Width;
        double h = size.Height;
        if (w <= 0 || h <= 0 || n == 0 || line.Points.Count == 0)
        {
            return;
        }

        var brush = ChartBrushes.ForIndex(line.ColorIndex);

        // A faint zero baseline so a line that dips negative (e.g. savings) stays readable.
        if (line.ZeroRatio > 0.001 && line.ZeroRatio < 0.999)
        {
            double zeroY = (1 - line.ZeroRatio) * h;
            canvas.Children.Add(new Line
            {
                X1 = 0,
                X2 = w,
                Y1 = zeroY,
                Y2 = zeroY,
                Stroke = DisplayTokens.Border,
                StrokeThickness = 1,
                StrokeDashArray = [3, 3],
                Opacity = 0.7,
            });
        }

        var polyline = new Polyline { Stroke = brush, StrokeThickness = 2 };
        for (int i = 0; i < line.Points.Count; i++)
        {
            double x = (i + 0.5) / n * w;
            double y = (1 - line.Points[i].Ratio) * h;
            polyline.Points.Add(new Point(x, y));
        }

        canvas.Children.Add(polyline);

        for (int i = 0; i < line.Points.Count; i++)
        {
            double x = (i + 0.5) / n * w;
            double y = (1 - line.Points[i].Ratio) * h;
            var dot = new Ellipse { Width = 6, Height = 6, Fill = brush };
            Canvas.SetLeft(dot, x - 3);
            Canvas.SetTop(dot, y - 3);
            AutomationProperties.SetName(dot, line.Points[i].AutomationName);
            canvas.Children.Add(dot);
        }
    }

    private static Grid BuildCategoryLabels(OverviewChart chart)
    {
        int n = chart.Categories.Count;
        var grid = new Grid();
        for (int c = 0; c < n; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < n; i++)
        {
            var label = new TextBlock
            {
                Text = chart.Categories[i],
                FontSize = 11,
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

    private static StackPanel BuildLegend(OverviewChart chart)
    {
        var legend = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        foreach (var series in chart.BarSeries)
        {
            legend.Children.Add(LegendChip(series.Name, series.ColorIndex));
        }

        if (chart.LineSeries is { } line)
        {
            legend.Children.Add(LegendChip(line.Name, line.ColorIndex));
        }

        return legend;
    }

    private static StackPanel LegendChip(string name, int colorIndex)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        var swatch = new Border
        {
            Width = 10,
            Height = 10,
            CornerRadius = new CornerRadius(2),
            Background = ChartBrushes.ForIndex(colorIndex),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(swatch, AccessibilityView.Raw);
        row.Children.Add(swatch);
        row.Children.Add(new TextBlock { Text = name, FontSize = 12, Foreground = DisplayTokens.TextMuted, VerticalAlignment = VerticalAlignment.Center });
        AutomationProperties.SetName(row, name);
        return row;
    }

    // ── Quick Links (responsive 1/2/5-column grid of nav cards) ──────────────────────────────────────
    private TsGlassPanel BuildQuickLinksPanel(OverviewTabDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(new SectionTitle { Value = display.QuickLinksTitle });
        stack.Children.Add(BuildQuickLinksGrid(display.QuickLinks));

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = stack };
        AutomationProperties.SetName(panel, display.QuickLinksTitle);
        return panel;
    }

    private Grid BuildQuickLinksGrid(IReadOnlyList<OverviewQuickLink> links)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        var cards = new List<FrameworkElement>(links.Count);
        foreach (var link in links)
        {
            cards.Add(BuildLinkCard(link));
        }

        int current = -1;

        void Layout(double width)
        {
            int columns = width >= 1024 ? 5 : width >= 640 ? 2 : 1;
            columns = Math.Max(1, Math.Min(columns, cards.Count));
            if (columns == current)
            {
                return;
            }

            current = columns;
            grid.Children.Clear();
            grid.ColumnDefinitions.Clear();
            grid.RowDefinitions.Clear();

            for (int c = 0; c < columns; c++)
            {
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            }

            int rows = (int)Math.Ceiling(cards.Count / (double)columns);
            for (int r = 0; r < rows; r++)
            {
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            }

            for (int i = 0; i < cards.Count; i++)
            {
                Grid.SetColumn(cards[i], i % columns);
                Grid.SetRow(cards[i], i / columns);
                grid.Children.Add(cards[i]);
            }
        }

        grid.SizeChanged += (_, e) => Layout(e.NewSize.Width);
        Layout(0);
        return grid;
    }

    private TsGlassPanel BuildLinkCard(OverviewQuickLink link)
    {
        var iconTile = new Border
        {
            Width = 32,
            Height = 32,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = SubtleFill(),
            Child = new FontIcon { Glyph = link.Glyph, FontSize = 16, Foreground = DisplayTokens.TextPrimary },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(iconTile, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = link.Label,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var chevron = new FontIcon { Glyph = ChevronGlyph, FontSize = 12, Foreground = DisplayTokens.TextMuted };
        AutomationProperties.SetAccessibilityView(chevron, AccessibilityView.Raw);

        var inner = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        inner.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        inner.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        inner.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(iconTile, 0);
        Grid.SetColumn(label, 1);
        Grid.SetColumn(chevron, 2);
        inner.Children.Add(iconTile);
        inner.Children.Add(label);
        inner.Children.Add(chevron);

        var button = new Button
        {
            Content = inner,
            Padding = new Thickness(12),
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            BorderThickness = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        button.Click += (_, _) => QuickLinkInvoked?.Invoke(this, link.Route);
        AutomationProperties.SetName(button, link.AutomationName);
        ToolTipService.SetToolTip(button, link.Label);

        return new TsGlassPanel
        {
            Glow = GlassGlow.Cyan,
            Padding = new Thickness(0),
            Content = button,
        };
    }

    private static Brush SubtleFill()
    {
        if (DisplayTokens.TextPrimary is SolidColorBrush solid && solid.Color.A != 0)
        {
            Color c = solid.Color;
            return new SolidColorBrush(Color.FromArgb(16, c.R, c.G, c.B));
        }

        return DisplayTokens.Surface;
    }
}
