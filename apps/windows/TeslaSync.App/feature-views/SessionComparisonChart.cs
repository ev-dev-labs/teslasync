using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Session-Comparison feature surface — a parity port of
/// web/src/features/charging/components/charging-curve/SessionComparisonChart.tsx. It reproduces the web
/// <c>ChartContainer</c> (title / subtitle / accessible summary / tabular data-view toggle / export) wrapping
/// an overlaid power-vs-SOC <c>LineChart</c>: one line per charging session (up to the last ten), coloured
/// from the cycling chart palette, with a "SOC (%)" x-axis label, a "Power (kW)" y-axis label and a custom
/// per-session date-chip legend beneath. The web component is a pure child of the charging-curve page; the
/// native surface binds its own cache-then-network <see cref="SessionComparisonViewModel"/>, so it renders
/// every state the P2 contract requires — the skeleton while loading, a retry surface on a hard failure, a
/// friendly empty state when there is no session to plot, and a freshness chip (stale / offline) over the
/// chart otherwise. The view never performs HTTP. Every string resolves through the i18n facade and every
/// interactive element carries a Narrator name.
/// </summary>
public sealed partial class SessionComparisonChart : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string ExportFileBaseName = "session-comparison"; // web exportFilename
    private const double ChartHeight = 300; // web ChartContainer height={300}
    private const double SkeletonChartHeight = 300;

    private readonly SessionComparisonViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SessionComparisonDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsFadeIn _fade = new() { DelayMs = 150 }; // web FadeIn delay={0.15}

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and (optional) diagnostics/clock.</summary>
    public SessionComparisonChart(
        ISessionComparisonSource source,
        ILocalizer localizer,
        SessionComparisonDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SessionComparisonDiagnostics();
        _viewModel = new SessionComparisonViewModel(source, localizer, clock);
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

    /// <summary>The canonical surface id (<c>session-comparison-chart</c>).</summary>
    public static string SurfaceId => SessionComparisonRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public SessionComparisonViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SessionComparisonSource"/> from the
    /// shared data layer (the host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static SessionComparisonChart Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        SessionComparisonDiagnostics? diagnostics = null)
    {
        var source = new SessionComparisonSource(vehicles, api, engine, options, vehicleId);
        return new SessionComparisonChart(source, localizer, diagnostics);
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
            SessionComparisonState.Loading => BuildLoading(display),
            SessionComparisonState.Error => BuildErrorSurface(),
            _ => BuildChartContainer(display),
        };
    }

    // ── Loading (skeleton chrome) ───────────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildLoading(SessionComparisonDisplay display)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(new PanelTitle { Value = display.Title });
        content.Children.Add(new Caption { Value = display.Subtitle });
        content.Children.Add(new TsSkeleton
        {
            BlockHeight = SkeletonChartHeight,
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
            Title = _localizer.GetString("charging.curve.sessionComparison", "Session Comparison"),
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("charging.curve.sessionComparison.error", "Couldn't load charging sessions"),
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

    // ── Chart container (Loaded / Empty / Stale / Offline) ──────────────────────────────────────────────

    private TsChartContainer BuildChartContainer(SessionComparisonDisplay display)
    {
        bool hasData = display.HasData;
        var series = hasData ? display.ToChartSeries() : Array.Empty<ChartSeries>();

        TsLineChart? chart = hasData ? BuildChart(display, series) : null;

        var container = new TsChartContainer
        {
            Title = display.Title,
            Subtitle = display.Subtitle,
            AccessibleSummary = display.AriaLabel,
            EmptyMessage = display.EmptyMessage,
            DataViewLabel = _localizer.GetString("charging.curve.sessionComparison.dataTable", "Show data table"),
            State = hasData ? ChartState.Ready : ChartState.Empty,
            Actions = BuildActions(display, chart, series),
        };

        if (hasData && chart is not null)
        {
            container.Body = BuildChartBody(display, chart);
            container.DataView.Series = series;
            container.DataView.XLabel = display.SocAxisLabel;
        }

        return container;
    }

    private static TsLineChart BuildChart(SessionComparisonDisplay display, IReadOnlyList<ChartSeries> series)
    {
        var chart = new TsLineChart
        {
            Series = series,
            ShowLegend = false, // web has no recharts <Legend>; the custom date-chip legend sits below.
            IncludeZero = true,
            Height = ChartHeight,
            Title = display.AriaLabel,
        };
        AutomationProperties.SetName(chart, display.AriaLabel);
        return chart;
    }

    /// <summary>
    /// The chart body: the "Power (kW)" y-axis label, the overlaid line chart, the "SOC (%)" x-axis label and
    /// the custom per-session date-chip legend (web lines 106-116). The two axis labels reproduce the web
    /// recharts <c>XAxis</c>/<c>YAxis</c> <c>label</c> props.
    /// </summary>
    private static StackPanel BuildChartBody(SessionComparisonDisplay display, TsLineChart chart)
    {
        var body = new StackPanel { Spacing = 8 };
        body.Children.Add(new Caption
        {
            Value = display.PowerAxisLabel,
            HorizontalAlignment = HorizontalAlignment.Left,
        });
        body.Children.Add(chart);
        body.Children.Add(new Caption
        {
            Value = display.SocAxisLabel,
            HorizontalAlignment = HorizontalAlignment.Right,
        });
        body.Children.Add(BuildLegend(display));
        return body;
    }

    private static StackPanel BuildLegend(SessionComparisonDisplay display)
    {
        var legend = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
        };

        foreach (var s in display.Series)
        {
            var swatch = new Border
            {
                Width = 12,
                Height = 8,
                CornerRadius = new CornerRadius(2),
                Background = DisplayTokens.Brush(ChartPalette.KeyForIndex(s.ColorIndex)),
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(swatch, AccessibilityView.Raw);

            var label = new TextBlock
            {
                Text = s.DateLabel,
                FontSize = 12,
                Foreground = DisplayTokens.TextSecondary,
                VerticalAlignment = VerticalAlignment.Center,
            };

            var chip = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 6,
                VerticalAlignment = VerticalAlignment.Center,
            };
            chip.Children.Add(swatch);
            chip.Children.Add(label);
            AutomationProperties.SetName(
                chip,
                string.Format(CultureInfo.CurrentCulture, "{0}, {1}", s.DateLabel, s.ChargerLabel));
            legend.Children.Add(chip);
        }

        return legend;
    }

    // ── Header actions (freshness chip + freshness + refresh + export) ──────────────────────────────────

    private StackPanel BuildActions(
        SessionComparisonDisplay display,
        TsLineChart? chart,
        IReadOnlyList<ChartSeries> series)
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is SessionComparisonState.Stale or SessionComparisonState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == SessionComparisonState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());

        // Web parity: ChartContainer exportable — only meaningful when there is a chart to export.
        if (display.HasData && chart is not null)
        {
            actions.Children.Add(new TsChartExportMenu
            {
                Series = series,
                Target = chart,
                FileBaseName = ExportFileBaseName,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        return actions;
    }

    private TsBadge BuildFreshnessChip(SessionComparisonState state)
    {
        bool offline = state == SessionComparisonState.Offline;
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
}
