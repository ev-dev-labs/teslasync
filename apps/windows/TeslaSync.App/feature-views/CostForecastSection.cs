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
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Cost-Forecast feature surface — a parity port of
/// web/src/features/charging/components/cost-analysis/CostForecastSection.tsx. It reproduces the web
/// component's two cost panels: the forecast panel (a <see cref="TsComposedChart"/> overlaying the historical
/// "Actual Cost" area, the "95% Confidence" envelope and the dashed "Projected Cost" line, with the empty
/// branch when there are fewer than three historical months) and the cost-per-kWh trend panel (a
/// <see cref="TsLineChart"/> over the historical blended rate, with the empty branch below two months). The
/// web component is a pure child of the cost-analysis page; the native surface binds its own
/// cache-then-network <see cref="CostForecastSectionViewModel"/>, so it renders every state the P2 contract
/// requires — the skeleton while loading, a retry surface on a hard failure, the two panels (each its own
/// chart or friendly empty message) otherwise, and a freshness chip (stale / offline) over the forecast
/// panel. The web's middle <c>ForecastDetails</c> block is a separate surface (its own prompt) and is not
/// rendered here. The view never performs HTTP. Every string resolves through the i18n facade and every
/// interactive element carries a Narrator name.
/// </summary>
public sealed partial class CostForecastSection : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";   // Segoe Fluent — Refresh
    private const string TrendUpGlyph = "\uE9D2";   // Segoe Fluent — trending up (web lucide TrendingUp)
    private const double ForecastChartHeight = 300; // web ResponsiveContainer height={300}
    private const double TrendChartHeight = 200;     // web ResponsiveContainer height={200}
    private const double SkeletonChartHeight = 240;
    private const double PanelPadding = 16;           // web GlassPanel p-6
    private const double SectionSpacing = 16;         // web space-y-6 between panels

    private readonly CostForecastSectionViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly CostForecastSectionDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsFadeIn _fade = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, currency and (optional) diagnostics.</summary>
    /// <param name="source">The cache-then-network cost-forecast source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="currencySymbol">The currency symbol (web <c>useFormatting().currencySymbol</c>, default "$").</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public CostForecastSection(
        ICostForecastSectionSource source,
        ILocalizer localizer,
        string? currencySymbol = null,
        CostForecastSectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new CostForecastSectionDiagnostics();
        _viewModel = new CostForecastSectionViewModel(source, localizer, currencySymbol);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = _fade;
        AutomationProperties.SetName(this, _viewModel.Display.AutomationName);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>cost-forecast-section</c>).</summary>
    public static string SurfaceId => CostForecastSectionRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public CostForecastSectionViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="CostForecastSectionSource"/> from the
    /// shared data layer (the host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static CostForecastSection Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        string? currencySymbol = null,
        CostForecastSectionDiagnostics? diagnostics = null)
    {
        var source = new CostForecastSectionSource(vehicles, api, engine, options, vehicleId);
        return new CostForecastSection(source, localizer, currencySymbol, diagnostics);
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
        AutomationProperties.SetName(this, display.AutomationName);

        _fade.Content = _viewModel.State switch
        {
            CostForecastSectionState.Loading => BuildLoading(display),
            CostForecastSectionState.Error => BuildErrorSurface(display),
            _ => BuildContent(display),
        };
    }

    // ── Loading (skeleton chrome for both panels) ────────────────────────────────────────────────────────

    private StackPanel BuildLoading(CostForecastSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(BuildSkeletonPanel(display.ForecastTitle, TrendUpGlyph));
        stack.Children.Add(BuildSkeletonPanel(display.TrendTitle, glyph: null));
        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        AutomationProperties.SetName(
            stack,
            string.Format(
                System.Globalization.CultureInfo.CurrentCulture,
                "{0}. {1}",
                display.ForecastTitle,
                _localizer.GetString("common.loading", "Loading...")));
        return stack;
    }

    private static TsGlassPanel BuildSkeletonPanel(string title, string? glyph)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(BuildHeader(title, glyph, actions: null));
        content.Children.Add(new TsSkeleton
        {
            BlockHeight = SkeletonChartHeight,
            ReduceMotion = MotionPreference.ReduceMotion,
        });
        return Box(content, title);
    }

    // ── Error surface (web QueryError) ───────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildErrorSurface(CostForecastSectionDisplay display)
    {
        var error = new TsQueryError
        {
            Title = display.ForecastTitle,
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("costAnalysis.forecast.error", "Couldn't load the cost forecast"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = error };
        AutomationProperties.SetName(panel, error.Message);
        return panel;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Content (Loaded / Empty / Stale / Offline): the two cost panels, each chart or empty ─────────────

    private StackPanel BuildContent(CostForecastSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(BuildForecastPanel(display));
        stack.Children.Add(BuildTrendPanel(display));
        return stack;
    }

    private TsGlassPanel BuildForecastPanel(CostForecastSectionDisplay display)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(BuildHeader(display.ForecastTitle, TrendUpGlyph, BuildActions()));

        if (display.HasForecastChart)
        {
            var chart = new TsComposedChart
            {
                Series = display.ForecastSeries,
                Title = display.ForecastTitle,
                ShowLegend = true,        // web renders a <Legend /> beneath the ComposedChart
                IncludeZero = true,
                Height = ForecastChartHeight,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            AutomationProperties.SetName(chart, display.ForecastTitle);
            content.Children.Add(chart);
            content.Children.Add(BuildMonthAxis(display.ForecastMonths));
        }
        else
        {
            content.Children.Add(new TsEmptyState
            {
                Message = display.ForecastEmptyMessage,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        return Box(content, display.ForecastTitle);
    }

    private static TsGlassPanel BuildTrendPanel(CostForecastSectionDisplay display)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(BuildHeader(display.TrendTitle, glyph: null, actions: null));

        if (display.HasTrendChart)
        {
            var chart = new TsLineChart
            {
                Series = display.TrendSeries,
                Title = display.TrendTitle,
                ShowLegend = false,       // web cost-per-kWh chart has no <Legend>
                IncludeZero = true,
                Height = TrendChartHeight,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            AutomationProperties.SetName(chart, display.TrendTitle);
            content.Children.Add(chart);
            content.Children.Add(BuildMonthAxis(display.TrendMonths));
        }
        else
        {
            content.Children.Add(new TsEmptyState
            {
                Message = display.TrendEmptyMessage,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        return Box(content, display.TrendTitle);
    }

    private static Grid BuildHeader(string title, string? glyph, StackPanel? actions)
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

        if (!string.IsNullOrEmpty(glyph))
        {
            var icon = new FontIcon
            {
                Glyph = glyph,
                FontSize = 16,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
            titleRow.Children.Add(icon);
        }

        titleRow.Children.Add(new PanelTitle { Value = title, VerticalAlignment = VerticalAlignment.Center });
        Grid.SetColumn(titleRow, 0);
        header.Children.Add(titleRow);

        if (actions is not null)
        {
            Grid.SetColumn(actions, 1);
            header.Children.Add(actions);
        }

        return header;
    }

    // ── Header actions (freshness chip + freshness + refresh) ────────────────────────────────────────────

    private StackPanel BuildActions()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is CostForecastSectionState.Stale or CostForecastSectionState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == CostForecastSectionState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());
        return actions;
    }

    private TsBadge BuildFreshnessChip(CostForecastSectionState state)
    {
        bool offline = state == CostForecastSectionState.Offline;
        string text = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("common.stale", "Stale");

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

    // ── Categorical month axis (web XAxis dataKey="month") ───────────────────────────────────────────────

    private static Grid BuildMonthAxis(IReadOnlyList<string> months)
    {
        var grid = new Grid { Margin = new Thickness(0, 2, 0, 0) };
        for (int i = 0; i < months.Count; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var label = new Caption
            {
                Value = months[i],
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            Grid.SetColumn(label, i);
            grid.Children.Add(label);
        }

        AutomationProperties.SetName(grid, string.Join(", ", months));
        return grid;
    }

    private static TsGlassPanel Box(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
        AutomationProperties.SetName(panel, automationName);
        AutomationProperties.SetAccessibilityView(panel, AccessibilityView.Content);
        return panel;
    }
}
