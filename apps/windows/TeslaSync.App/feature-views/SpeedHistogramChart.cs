using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
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
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Speed-Histogram feature surface — a parity port of
/// web/src/features/driving/components/drive-detail/SpeedHistogramChart.tsx. It reproduces the web
/// <c>ChartContainer</c> chrome (title "Speed Histogram" + accessible summary + tabular range/percentage
/// data-view toggle) wrapping the recharts <c>BarChart</c> of the drive's speed-bucket distribution: one
/// purple bar per populated display-unit speed range, each labelled with its share of the drive, the bucket
/// edges along the bottom and a "% of drive" axis hint. The web component is a pure child of the Drive-Detail
/// page; the native surface binds its own cache-then-network <see cref="SpeedHistogramChartViewModel"/>, so it
/// renders every state the P2 contract mandates — a loading skeleton, the populated histogram, the friendly
/// "No telemetry data available" empty surface, an explicit retry surface on hard failure, plus stale and
/// offline freshness chips. All data flows through the view-model; the view never performs HTTP. Every string
/// resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class SpeedHistogramChart : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double ChartHeight = 220;        // web ChartContainer height={220}
    private const double SkeletonChartHeight = 220;
    private const int FadeInDelayMs = 0;           // web <FadeIn> (no delay prop)
    private const double LabelFontSize = 11;
    private const double BarMargin = 6;

    private readonly SpeedHistogramChartViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SpeedHistogramChartDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsFadeIn _fade = new() { DelayMs = FadeInDelayMs };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, (optional) diagnostics and units.</summary>
    /// <param name="source">The cache-then-network drive-telemetry source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink; a private collector is used when null.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    public SpeedHistogramChart(
        ISpeedHistogramChartSource source,
        ILocalizer localizer,
        SpeedHistogramChartDiagnostics? diagnostics = null,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SpeedHistogramChartDiagnostics();
        _viewModel = new SpeedHistogramChartViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = _fade;
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>speed-histogram-chart</c>).</summary>
    public static string SurfaceId => SpeedHistogramChartRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public SpeedHistogramChartViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SpeedHistogramChartSource"/> from the
    /// shared data layer (the host's P2-core dependencies), scoped to an explicit <paramref name="driveId"/>
    /// (the Drive-Detail route) or — when null — the newest drive of the <paramref name="vehicleId"/> /
    /// primary vehicle.
    /// </summary>
    public static SpeedHistogramChart Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        long? driveId = null,
        SpeedHistogramChartDiagnostics? diagnostics = null,
        UnitPref? units = null)
    {
        var source = new SpeedHistogramChartSource(vehicles, api, engine, options, vehicleId, driveId);
        return new SpeedHistogramChart(source, localizer, diagnostics, units);
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
            SpeedHistogramChartState.Loading => BuildLoading(display),
            SpeedHistogramChartState.Error => BuildErrorSurface(),
            _ => BuildChartContainer(display),
        };
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SpeedHistogramChartAutomationPeer(this);

    // ── Loading (skeleton chrome) ───────────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildLoading(SpeedHistogramChartDisplay display)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(new PanelTitle { Value = display.Title });
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
            string.Format(CultureInfo.CurrentCulture, "{0}. {1}", display.Title, _viewModel.LoadingLabel));
        return panel;
    }

    // ── Error surface (web QueryError) ──────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildErrorSurface()
    {
        var error = new TsQueryError
        {
            Title = _viewModel.ErrorTitle,
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle,
            ActionText = _viewModel.RetryLabel,
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

    private TsChartContainer BuildChartContainer(SpeedHistogramChartDisplay display)
    {
        bool hasData = display.HasData;

        var container = new TsChartContainer
        {
            Title = display.Title,
            AccessibleSummary = display.AriaLabel,
            EmptyMessage = display.EmptyMessage,
            DataViewLabel = display.DataTableLabel,
            State = hasData ? ChartState.Ready : ChartState.Empty,
            Actions = BuildActions(),
        };

        if (hasData)
        {
            container.Body = BuildChartBody(display);
            container.DataView.Series = display.ToChartSeries();
            container.DataView.XLabel = display.RangeColumnLabel;
        }

        return container;
    }

    /// <summary>
    /// The chart body: the "% of drive" value-axis hint (web bar <c>name</c>), the bars themselves (one per
    /// populated bucket, sized by their share of the drive) and the bucket-edge category labels along the
    /// bottom (the web recharts <c>XAxis</c> ticks). Each bar carries a Narrator name describing its range
    /// and percentage.
    /// </summary>
    private static StackPanel BuildChartBody(SpeedHistogramChartDisplay display)
    {
        var model = display.Chart;
        var body = new StackPanel { Spacing = 8 };
        body.Children.Add(new Caption
        {
            Value = model.BarSeriesName,
            HorizontalAlignment = HorizontalAlignment.Left,
        });
        body.Children.Add(BuildBars(model));
        body.Children.Add(BuildCategoryLabels(model));
        return body;
    }

    private static Grid BuildBars(SpeedHistogramChartModel model)
    {
        int n = model.Bars.Count;
        var plot = new Grid { Height = ChartHeight };
        for (int c = 0; c < n; c++)
        {
            plot.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var brush = DisplayTokens.Brush(SpeedHistogramChartProjection.BarBrushKey);

        for (int i = 0; i < n; i++)
        {
            var bar = model.Bars[i];
            var holder = new Grid { Margin = new Thickness(BarMargin, 0, BarMargin, 0) };
            holder.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Math.Max(0.0, 1 - bar.HeightRatio), GridUnitType.Star) });
            holder.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Math.Max(0.0, bar.HeightRatio), GridUnitType.Star) });

            // The percentage readout sits at the bottom of the upper cell, floating just above the bar.
            var pctLabel = new TextBlock
            {
                Text = bar.PctLabel,
                FontSize = LabelFontSize,
                Foreground = DisplayTokens.TextSecondary,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Bottom,
                Margin = new Thickness(0, 0, 0, 2),
            };
            AutomationProperties.SetAccessibilityView(pctLabel, AccessibilityView.Raw);
            Grid.SetRow(pctLabel, 0);
            holder.Children.Add(pctLabel);

            var fill = new Border
            {
                Background = brush,
                CornerRadius = new CornerRadius(4, 4, 0, 0), // web Bar radius={[4, 4, 0, 0]}
                MinHeight = bar.HeightRatio > 0 ? 2 : 0,
                VerticalAlignment = VerticalAlignment.Stretch,
            };
            Grid.SetRow(fill, 1);
            holder.Children.Add(fill);

            AutomationProperties.SetName(holder, bar.AutomationName);
            Grid.SetColumn(holder, i);
            plot.Children.Add(holder);
        }

        return plot;
    }

    private static Grid BuildCategoryLabels(SpeedHistogramChartModel model)
    {
        int n = model.Bars.Count;
        var grid = new Grid();
        for (int c = 0; c < n; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < n; i++)
        {
            var label = new TextBlock
            {
                Text = model.Bars[i].Range,
                FontSize = LabelFontSize,
                Foreground = DisplayTokens.TextMuted, // web XAxis tick fill var(--text-muted)
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

    // ── Header actions (freshness chip + freshness + refresh) ───────────────────────────────────────────

    private StackPanel BuildActions()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is SpeedHistogramChartState.Stale or SpeedHistogramChartState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == SpeedHistogramChartState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());
        return actions;
    }

    private TsBadge BuildFreshnessChip(SpeedHistogramChartState state)
    {
        bool offline = state == SpeedHistogramChartState.Offline;
        string text = offline ? _viewModel.OfflineChip : _viewModel.StaleChip;

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
        AutomationProperties.SetName(button, _viewModel.RefreshLabel);
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private sealed class SpeedHistogramChartAutomationPeer(SpeedHistogramChart owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((SpeedHistogramChart)Owner).ViewModel.AriaLabel
                : name;
        }
    }
}
