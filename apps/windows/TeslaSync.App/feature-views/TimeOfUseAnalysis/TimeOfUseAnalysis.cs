using System.Globalization;
using Microsoft.UI.Dispatching;
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
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Time-of-Use analysis feature surface — a parity port of
/// web/src/features/charging/components/cost-analysis/TimeOfUseAnalysis.tsx. It reproduces the web
/// clock-iconed "Electricity Rate Analysis (Time-of-Use)" <c>GlassPanel</c> with its two regions: the hourly
/// session-distribution bar chart (24 bars, each tinted by its time-of-use band — red peak 2–7 PM, green
/// off-peak 10 PM–6 AM, brand-cyan mid-peak — the native analogue of the recharts <c>BarChart</c> +
/// per-<c>Cell</c> colours, drawn with the token-driven ratio-bar idiom plus the sparse hour axis and the
/// three-swatch legend) and the insights column (cheapest / priciest / busiest hour + off-peak share cards).
/// The web component is a pure child of the cost-analysis page; the native surface binds its own
/// cache-then-network <see cref="TimeOfUseAnalysisViewModel"/>, so it renders every state the P2 contract
/// requires — the skeleton while loading, a retry surface on a hard failure, a friendly empty state when there
/// are no charging sessions, and a freshness chip (stale / offline) over the content otherwise. The view never
/// performs HTTP. Every string resolves through the i18n facade and every bar, card and chip carries a
/// Narrator name.
/// </summary>
public sealed partial class TimeOfUseAnalysis : ContentControl, IDisposable
{
    private const string ClockGlyph = "\uE121"; // Segoe Fluent — Clock (web lucide <Clock/>, text-amber-400)
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private const double ChartHeight = 220; // web ResponsiveContainer height 260 minus the legend strip
    private const double BarMargin = 1.5; // gap between adjacent hour bars
    private const double SwatchSize = 12; // web legend h-3 w-3
    private const double ValueFontSize = 18; // web insight value text-lg
    private const double SubCaptionFontSize = 10; // web insight sub-caption text-[10px]
    private const double HourLabelFontSize = 10; // web axis tick text
    private const double SkeletonHeight = 240; // approximate chart + legend footprint

    private readonly TimeOfUseAnalysisViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly TimeOfUseAnalysisDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsFadeIn _fade = new() { DelayMs = 0 };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and (optional) diagnostics.</summary>
    public TimeOfUseAnalysis(
        ITimeOfUseAnalysisSource source,
        ILocalizer localizer,
        TimeOfUseAnalysisDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new TimeOfUseAnalysisDiagnostics();
        _viewModel = new TimeOfUseAnalysisViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = _fade;
        AutomationProperties.SetName(this, _viewModel.Display.AriaLabel);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>time-of-use-analysis</c>).</summary>
    public static string SurfaceId => TimeOfUseAnalysisRegistration.Id;

    /// <summary>The canonical diagnostics slug (<c>TimeOfUseAnalysis</c>).</summary>
    public static string Slug => TimeOfUseAnalysisRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public TimeOfUseAnalysisViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="TimeOfUseAnalysisSource"/> from the
    /// shared data layer (the host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static TimeOfUseAnalysis Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        TimeOfUseAnalysisDiagnostics? diagnostics = null)
    {
        var source = new TimeOfUseAnalysisSource(vehicles, api, engine, options, vehicleId);
        return new TimeOfUseAnalysis(source, localizer, diagnostics);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
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
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

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
        var display = _viewModel.Display;
        AutomationProperties.SetName(this, display.AriaLabel);

        _fade.Content = _viewModel.State switch
        {
            TimeOfUseAnalysisState.Loading => BuildLoading(display),
            TimeOfUseAnalysisState.Error => BuildErrorSurface(),
            _ => BuildPanel(display),
        };
    }

    // ── Loading (skeleton chrome) ───────────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildLoading(TimeOfUseDisplay display)
    {
        var content = new StackPanel { Spacing = 16 };
        content.Children.Add(BuildHeader(display, actions: null));
        content.Children.Add(new TsSkeleton
        {
            BlockHeight = SkeletonHeight,
            ReduceMotion = MotionPreference.ReduceMotion,
        });

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = content };
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        AutomationProperties.SetName(
            panel,
            string.Format(
                CultureInfo.CurrentCulture,
                "{0}. {1}",
                display.Title,
                _localizer.GetString("common.loading", "Loading...")));
        return panel;
    }

    // ── Error surface (web QueryError) ──────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildErrorSurface()
    {
        var error = new TsQueryError
        {
            Title = _localizer.GetString("costAnalysis.tou.title", "Electricity Rate Analysis (Time-of-Use)"),
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("error.loadFailed", "Failed to load data"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = error };
        AutomationProperties.SetName(panel, error.Message);
        return panel;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Panel (Loaded / Empty / Stale / Offline) ────────────────────────────────────────────────────────

    private TsGlassPanel BuildPanel(TimeOfUseDisplay display)
    {
        var content = new StackPanel { Spacing = 16 };
        content.Children.Add(BuildHeader(display, BuildActions()));
        if (display.HasData)
        {
            content.Children.Add(BuildBody(display));
        }
        else
        {
            // Web parity: the cost-analysis page renders its "No Charging Data" empty state when there are no
            // sessions; the native surface shows a friendly empty state instead of a blank panel.
            content.Children.Add(new TsEmptyState
            {
                Message = display.EmptyMessage,
                MinHeight = ChartHeight,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = content };
        AutomationProperties.SetName(panel, display.AriaLabel);
        return panel;
    }

    private static Grid BuildBody(TimeOfUseDisplay display)
    {
        // web grid-cols-1 lg:grid-cols-3 with the chart at lg:col-span-2 and the insights column beside it.
        var body = new Grid { ColumnSpacing = 24 };
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var chart = BuildChartColumn(display);
        Grid.SetColumn(chart, 0);
        body.Children.Add(chart);

        var insights = BuildInsightsColumn(display);
        Grid.SetColumn(insights, 1);
        body.Children.Add(insights);
        return body;
    }

    // ── Header (clock icon + title + actions) ───────────────────────────────────────────────────────────

    private static Grid BuildHeader(TimeOfUseDisplay display, FrameworkElement? actions)
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var icon = new FontIcon
        {
            Glyph = ClockGlyph,
            FontSize = 16,
            Foreground = ChartBrushes.ForStatus(StatusKind.Warning), // web text-amber-400
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        titleRow.Children.Add(icon);
        titleRow.Children.Add(new PanelTitle { Value = display.Title, VerticalAlignment = VerticalAlignment.Center });
        Grid.SetColumn(titleRow, 0);
        header.Children.Add(titleRow);

        if (actions is not null)
        {
            Grid.SetColumn(actions, 1);
            header.Children.Add(actions);
        }

        return header;
    }

    private StackPanel BuildActions()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is TimeOfUseAnalysisState.Stale or TimeOfUseAnalysisState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == TimeOfUseAnalysisState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());
        return actions;
    }

    private TsBadge BuildFreshnessChip(TimeOfUseAnalysisState state)
    {
        bool offline = state == TimeOfUseAnalysisState.Offline;
        string text = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("charging.curve.stale", "Stale");

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private TsButton BuildRefreshButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = RefreshGlyph,
            VerticalAlignment = VerticalAlignment.Center,
            IsEnabled = !_viewModel.IsFetching,
        };
        AutomationProperties.SetName(button, _localizer.GetString("common.refresh", "Refresh"));
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Chart column (hourly bars + sparse hour axis + legend) ──────────────────────────────────────────

    private static StackPanel BuildChartColumn(TimeOfUseDisplay display)
    {
        var column = new StackPanel { Spacing = 8 };
        if (display.HasHourlyBars)
        {
            column.Children.Add(BuildBars(display));
            column.Children.Add(BuildHourAxis(display));
            column.Children.Add(BuildLegend(display));
        }
        else
        {
            // Web defensive branch: `hourlyData.length > 0 ? <chart/> : <noData/>`.
            column.Children.Add(new TsEmptyState
            {
                Message = display.ChartEmptyMessage,
                MinHeight = ChartHeight,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        return column;
    }

    private static Grid BuildBars(TimeOfUseDisplay display)
    {
        var bars = new Grid { Height = ChartHeight };
        AutomationProperties.SetName(bars, string.Format(
            CultureInfo.CurrentCulture, "{0}. {1}", display.Title, display.SessionsLabel));

        for (int i = 0; i < display.Bars.Count; i++)
        {
            bars.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < display.Bars.Count; i++)
        {
            var bar = display.Bars[i];
            double ratio = Math.Clamp(bar.HeightRatio, 0, 1);

            var holder = new Grid();
            holder.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Math.Max(0.0, 1 - ratio), GridUnitType.Star) });
            holder.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Math.Max(0.0, ratio), GridUnitType.Star) });

            var fill = new Border
            {
                Background = CategoryBrush(bar.Category),
                CornerRadius = new CornerRadius(3, 3, 0, 0), // web Bar radius={[3, 3, 0, 0]}
                Margin = new Thickness(BarMargin, 0, BarMargin, 0),
                MinHeight = ratio > 0 ? 2 : 0,
                VerticalAlignment = VerticalAlignment.Stretch,
            };
            Grid.SetRow(fill, 1);
            holder.Children.Add(fill);

            AutomationProperties.SetName(holder, bar.AutomationName);
            Grid.SetColumn(holder, i);
            bars.Children.Add(holder);
        }

        return bars;
    }

    private static Grid BuildHourAxis(TimeOfUseDisplay display)
    {
        var axis = new Grid();
        for (int i = 0; i < display.Bars.Count; i++)
        {
            axis.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        foreach (var bar in display.Bars)
        {
            // Web XAxis interval={2}: the label is drawn only on every third column.
            if (bar.Hour % TimeOfUseAnalysisProjection.HourLabelInterval != 0)
            {
                continue;
            }

            var label = new TextBlock
            {
                Text = bar.Label,
                FontSize = HourLabelFontSize,
                Foreground = DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Center,
                TextWrapping = TextWrapping.NoWrap,
            };
            AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
            Grid.SetColumn(label, bar.Hour);
            axis.Children.Add(label);
        }

        return axis;
    }

    private static StackPanel BuildLegend(TimeOfUseDisplay display)
    {
        var legend = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 24,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        foreach (var entry in display.Legend)
        {
            var item = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 6,
                VerticalAlignment = VerticalAlignment.Center,
            };

            var swatch = new Ellipse
            {
                Width = SwatchSize,
                Height = SwatchSize,
                Fill = CategoryBrush(entry.Category),
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(swatch, AccessibilityView.Raw);

            item.Children.Add(swatch);
            item.Children.Add(new Caption { Value = entry.Label, VerticalAlignment = VerticalAlignment.Center });
            AutomationProperties.SetName(item, entry.Label);
            legend.Children.Add(item);
        }

        return legend;
    }

    // ── Insights column (heading + cards / no-insights) ─────────────────────────────────────────────────

    private static StackPanel BuildInsightsColumn(TimeOfUseDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new Caption { Value = display.InsightsHeading });

        if (display.HasInsights)
        {
            foreach (var card in display.Insights)
            {
                column.Children.Add(BuildInsightCard(card));
            }
        }
        else
        {
            // Web parity: `touInsights ? <cards/> : <noInsights/>`.
            column.Children.Add(new TsEmptyState
            {
                Message = display.NoInsightsMessage,
                MinHeight = 120,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        return column;
    }

    private static TsGlassPanel BuildInsightCard(TouInsightCard card)
    {
        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(new Caption { Value = card.Label });
        stack.Children.Add(new TextBlock
        {
            Text = card.Value,
            FontSize = ValueFontSize,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = ToneBrush(card.Tone),
        });
        stack.Children.Add(new TextBlock
        {
            Text = card.Caption,
            FontSize = SubCaptionFontSize,
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
        });

        var panel = new TsGlassPanel { Padding = new Thickness(12), Content = stack };
        AutomationProperties.SetName(panel, card.AutomationName);
        return panel;
    }

    // ── Token-driven brush mapping (web inline hex → theme-aware tokens) ─────────────────────────────────

    private static Brush CategoryBrush(TouHourCategory category) => category switch
    {
        TouHourCategory.Peak => ChartBrushes.ForStatus(StatusKind.Danger), // web #ef4444
        TouHourCategory.OffPeak => ChartBrushes.ForStatus(StatusKind.Success), // web #10b981
        _ => ChartBrushes.ForIndex(0), // web palette[0] / legend #00f0ff (brand cyan)
    };

    private static Brush ToneBrush(TouTone tone) => tone switch
    {
        TouTone.Negative => ChartBrushes.ForStatus(StatusKind.Danger), // web red-400
        TouTone.Info => ChartBrushes.ForIndex(0), // web cyan-400
        _ => ChartBrushes.ForStatus(StatusKind.Success), // web green-400 / emerald-400
    };
}
