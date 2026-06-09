using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Lifetime-Summary surface — a parity port of
/// web/src/features/charging/components/cost-analysis/LifetimeSummary.tsx. It mirrors the web glass panel
/// (cyan glow) headed by a trending-up icon and "Lifetime Summary" title, wrapping a responsive grid of the
/// seven lifetime metric tiles (Total Spent, Total Energy, Total Sessions, Avg Session Cost, Avg Energy /
/// Session, Avg Duration, Free Sessions). The web component is presentational (it takes
/// <c>lifetimeMetrics</c> + <c>coreStats</c> and shows the grid or a centred "No data" message); the native
/// feature-view owns its charging-sessions read and therefore renders the full state matrix the P2 contract
/// mandates — per-metric skeletons while loading, the populated tile grid, the web "No data" empty surface, an
/// explicit retry surface on hard failure, plus stale and offline freshness chips. All data flows through the
/// shared <see cref="LifetimeSummaryViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class LifetimeSummary : ContentControl, IDisposable
{
    private const string TrendingUpGlyph = "\uE9D2"; // Segoe Fluent — trending up (web lucide TrendingUp)
    private const string RefreshGlyph = "\uE72C";    // Segoe Fluent — Refresh
    private const double TitleIconSize = 16;
    private const double SkeletonValueWidth = 90;
    private const double SkeletonValueHeight = 30;
    private const double NarrowBreakpoint = 600;
    private const int MetricCount = 7;

    private readonly LifetimeSummaryViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly LifetimeSummaryDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsGlassPanel _panel = new() { Glow = GlassGlow.Cyan, Padding = new Thickness(16) };
    private readonly Grid _root = new() { RowSpacing = 16 };
    private readonly Grid _header = new();
    private readonly PanelTitle _title = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel _headerRight = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Right,
    };

    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, currency symbol and diagnostics.</summary>
    public LifetimeSummary(
        ILifetimeSummarySource source,
        ILocalizer localizer,
        string? currencySymbol = null,
        LifetimeSummaryDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new LifetimeSummaryDiagnostics();
        _viewModel = new LifetimeSummaryViewModel(source, localizer, currencySymbol);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Content = _panel;
        Render();
    }

    /// <summary>The canonical surface id (<c>lifetime-summary</c>).</summary>
    public static string SurfaceId => LifetimeSummaryRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public LifetimeSummaryViewModel ViewModel => _viewModel;

    /// <summary>The currency symbol used for the cost metrics; reassigning re-projects the current snapshot.</summary>
    public string CurrencySymbol
    {
        get => _viewModel.CurrencySymbol;
        set => _viewModel.CurrencySymbol = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="LifetimeSummarySource"/> from the shared
    /// data layer (the host's P2-core dependencies), optionally scoped to a single vehicle.
    /// </summary>
    public static LifetimeSummary Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        string? currencySymbol = null,
        LifetimeSummaryDiagnostics? diagnostics = null,
        long? vehicleId = null)
    {
        var source = new LifetimeSummarySource(api, engine, options, vehicleId);
        return new LifetimeSummary(source, localizer, currencySymbol, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = TrendingUpGlyph,
            FontSize = TitleIconSize,
            Foreground = DisplayTokens.Brush("TsChartSpeedBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleRow.Children.Add(icon);
        titleRow.Children.Add(_title);

        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(titleRow, 0);
        Grid.SetColumn(_headerRight, 1);
        _header.Children.Add(titleRow);
        _header.Children.Add(_headerRight);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);

        _panel.Content = _root;
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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (e.PreviousSize.Width != e.NewSize.Width && _viewModel.Display.HasData && IsContentState(_viewModel.State))
        {
            ScheduleRender();
        }
    }

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        SizeChanged -= OnSizeChanged;
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
        _title.Value = _viewModel.Title;
        AutomationProperties.SetName(this, _viewModel.Title);
        UpdateHeaderRight();
        _bodyHost.Child = BuildBody();
    }

    // ── Header (stale/offline chip + freshness + refresh) ─────────────────────────────────────────────

    private void UpdateHeaderRight()
    {
        _headerRight.Children.Clear();

        if (_viewModel.State is LifetimeSummaryState.Stale or LifetimeSummaryState.Offline)
        {
            _headerRight.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.State == LifetimeSummaryState.Offline;
        _freshness.Visibility = _viewModel.State == LifetimeSummaryState.Loading
            ? Visibility.Collapsed
            : Visibility.Visible;
        _headerRight.Children.Add(_freshness);

        _headerRight.Children.Add(BuildRefreshButton());
    }

    private TsBadge BuildFreshnessChip(LifetimeSummaryState state)
    {
        bool offline = state == LifetimeSummaryState.Offline;
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
        };
        AutomationProperties.SetName(button, _localizer.GetString("common.refresh", "Refresh"));
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Body (per state) ──────────────────────────────────────────────────────────────────────────────

    private UIElement BuildBody() => _viewModel.State switch
    {
        LifetimeSummaryState.Loading => BuildLoading(),
        LifetimeSummaryState.Error => BuildError(),
        LifetimeSummaryState.Empty => BuildEmpty(),
        _ => _viewModel.Display.HasData ? BuildGrid(_viewModel.Display) : BuildEmpty(),
    };

    private Grid BuildGrid(LifetimeSummaryDisplay display)
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(display.Metrics.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.Metrics.Count; i++)
        {
            var tile = BuildMetricTile(display.Metrics[i]);
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        return grid;
    }

    private static Border BuildMetricTile(LifetimeMetric metric)
    {
        var column = new StackPanel { Spacing = 2 };
        column.Children.Add(new Caption { Value = metric.Label });
        column.Children.Add(new MetricValue { Value = metric.Value });

        var tile = new Border
        {
            Child = column,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12),
        };
        AutomationProperties.SetName(tile, metric.AutomationName);
        return tile;
    }

    private Grid BuildLoading()
    {
        const int columns = 3;
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(MetricCount / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < MetricCount; i++)
        {
            var tile = BuildSkeletonTile();
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        AutomationProperties.SetName(
            grid,
            string.Format(
                CultureInfo.CurrentCulture,
                "{0}. {1}",
                _viewModel.Title,
                _localizer.GetString("common.loading", "Loading...")));
        return grid;
    }

    private static Border BuildSkeletonTile()
    {
        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(new TsSkeleton { BlockWidth = 60, BlockHeight = 12, HorizontalAlignment = HorizontalAlignment.Left });
        column.Children.Add(new TsSkeleton { BlockWidth = SkeletonValueWidth, BlockHeight = SkeletonValueHeight, HorizontalAlignment = HorizontalAlignment.Left });

        return new Border
        {
            Child = column,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12),
        };
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("costAnalysis.lifetime.error", "Couldn't load the lifetime summary"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        Message = _localizer.GetString("costAnalysis.lifetime.noData", "No data"),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private double AvailableWidth()
    {
        double width = _bodyHost.ActualWidth;
        if (width <= 0)
        {
            width = ActualWidth;
        }

        return width;
    }

    private static int ColumnsForWidth(double width) => width switch
    {
        <= 0 => 2,
        < NarrowBreakpoint => 2,
        _ => 3,
    };

    private static bool IsContentState(LifetimeSummaryState state) =>
        state is LifetimeSummaryState.Loaded or LifetimeSummaryState.Stale or LifetimeSummaryState.Offline;

    protected override AutomationPeer OnCreateAutomationPeer() => new LifetimeSummaryAutomationPeer(this);

    private sealed class LifetimeSummaryAutomationPeer(LifetimeSummary owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((LifetimeSummary)Owner).ViewModel.Title
                : name;
        }
    }
}
