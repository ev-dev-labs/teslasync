using System.Collections.Generic;
using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.OverviewVehicleComparison;

/// <summary>
/// The native WinUI 3 vehicle-comparison feature view — a parity port of
/// web/src/features/analytics/components/analytics/OverviewVehicleComparison.tsx. It renders the same four
/// panels in a responsive 2-up grid: a Fleet Usage donut (distance per vehicle), an Efficiency Leaderboard
/// (ranked proportional bars), a Vehicle Comparison radar (per-metric normalized, 2+ vehicles) and an
/// Energy &amp; Activity grouped bar (energy + drives). Each panel always renders — showing its own friendly
/// empty state when its slice is sparse — and the whole surface shows a skeleton while loading, a retry
/// surface on hard error, and a freshness chip for the cached / stale / offline states. All data flows
/// through the shared <see cref="OverviewVehicleComparisonViewModel"/>; the view never performs HTTP. Every
/// string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class OverviewVehicleComparisonView : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string EmptyGlyph = "\uE804";   // Segoe Fluent — Car
    private const double ChartHeight = 240;
    private const double TwoColumnThreshold = 680;

    private readonly OverviewVehicleComparisonViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly OverviewVehicleComparisonDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly Grid _header = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private int _columns = 2;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units and diagnostics.</summary>
    public OverviewVehicleComparisonView(
        IOverviewVehicleComparisonSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        OverviewVehicleComparisonDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new OverviewVehicleComparisonDiagnostics();
        _viewModel = new OverviewVehicleComparisonViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The user's unit preference; reassigning re-projects every panel in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="OverviewVehicleComparisonSource"/>
    /// from the shared data layer (the host's P2-core dependencies).
    /// </summary>
    public static OverviewVehicleComparisonView Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        OverviewVehicleComparisonDiagnostics? diagnostics = null)
    {
        var source = new OverviewVehicleComparisonSource(api, engine, options);
        return new OverviewVehicleComparisonView(source, localizer, units, diagnostics);
    }

    private void BuildChrome()
    {
        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("analytics.overview.refresh", "Refresh vehicle comparison"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        // Web parity: the component has no surface title — only a thin freshness/refresh strip is added,
        // the minimal native chrome the stale / offline / refreshing states require.
        _header.Padding = new Thickness(0, 0, 0, 8);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(actions, 1);
        _header.Children.Add(actions);

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);
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

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => ScheduleRender();

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        int desired = e.NewSize.Width >= TwoColumnThreshold ? 2 : 1;
        if (desired != _columns)
        {
            _columns = desired;
            ScheduleRender();
        }
    }

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
        switch (_viewModel.State)
        {
            case OverviewVehicleComparisonState.Loading:
                Content = BuildLoading();
                break;

            case OverviewVehicleComparisonState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _bodyHost.Content = BuildGrid(_viewModel.Display);
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private Grid BuildGrid(OverviewVehicleComparisonDisplay display)
    {
        var panels = new List<UIElement>(4)
        {
            BuildPanel(display.FleetUsageTitle, BuildFleetUsageBody(display)),
            BuildPanel(display.EfficiencyLeaderboardTitle, BuildLeaderboardBody(display)),
            BuildPanel(display.VehicleComparisonTitle, BuildComparisonBody(display)),
            BuildPanel(display.EnergyActivityTitle, BuildEnergyActivityBody(display)),
        };

        return LayoutPanels(panels);
    }

    private Grid LayoutPanels(List<UIElement> panels)
    {
        int cols = Math.Max(1, _columns);
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        for (int c = 0; c < cols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(panels.Count / (double)cols);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < panels.Count; i++)
        {
            var panel = panels[i];
            Grid.SetColumn((FrameworkElement)panel, i % cols);
            Grid.SetRow((FrameworkElement)panel, i / cols);
            grid.Children.Add(panel);
        }

        return grid;
    }

    private static TsGlassPanel BuildPanel(string title, UIElement body)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new PanelTitle { Value = title });
        column.Children.Add(body);
        return new TsGlassPanel { Content = column, Padding = new Thickness(16) };
    }

    private static UIElement BuildFleetUsageBody(OverviewVehicleComparisonDisplay display)
    {
        if (!display.HasVehicles)
        {
            return EmptyPanel(display.NoVehiclesMessage);
        }

        return new TsPieChart
        {
            Values = display.FleetUsage,
            InnerRadiusRatio = 0.55,
            Unit = display.DistanceUnitLabel,
            Height = ChartHeight,
            MinHeight = ChartHeight,
        };
    }

    private UIElement BuildLeaderboardBody(OverviewVehicleComparisonDisplay display)
    {
        if (display.Leaderboard.Count == 0)
        {
            return EmptyPanel(display.NoEfficiencyMessage);
        }

        var list = new StackPanel { Spacing = 12 };
        foreach (var entry in display.Leaderboard)
        {
            list.Children.Add(BuildLeaderboardRow(entry));
        }

        AutomationProperties.SetName(list, _localizer.GetString("analytics.overview.effLeaderboard", "Efficiency Leaderboard"));
        return list;
    }

    private static StackPanel BuildLeaderboardRow(LeaderboardEntry entry)
    {
        var labelRow = new Grid();
        labelRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        labelRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new TextBlock
        {
            Text = entry.Label,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var value = new TextBlock
        {
            Text = entry.FormattedValue,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(label, 0);
        Grid.SetColumn(value, 1);
        labelRow.Children.Add(label);
        labelRow.Children.Add(value);

        var track = new Grid { Height = 8, Margin = new Thickness(0, 6, 0, 0) };
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0, entry.BarFraction), GridUnitType.Star) });
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0, 1 - entry.BarFraction), GridUnitType.Star) });

        var background = new Border
        {
            Background = DisplayTokens.Border,
            CornerRadius = new CornerRadius(4),
            Opacity = 0.6,
        };
        Grid.SetColumnSpan(background, 2);
        track.Children.Add(background);

        var fill = new Border
        {
            Background = ChartBrushes.ForIndex(entry.ColorIndex),
            CornerRadius = new CornerRadius(4),
        };
        Grid.SetColumn(fill, 0);
        track.Children.Add(fill);

        var column = new StackPanel { Spacing = 0 };
        column.Children.Add(labelRow);
        column.Children.Add(track);
        AutomationProperties.SetName(column, entry.AutomationName);
        return column;
    }

    private static UIElement BuildComparisonBody(OverviewVehicleComparisonDisplay display)
    {
        if (!display.HasComparison)
        {
            return EmptyPanel(display.NoComparisonMessage);
        }

        return new TsRadarChart
        {
            Series = display.ComparisonSeries,
            MaxValue = display.ComparisonMax,
            Height = ChartHeight,
            MinHeight = ChartHeight,
        };
    }

    private UIElement BuildEnergyActivityBody(OverviewVehicleComparisonDisplay display)
    {
        if (!display.HasVehicles)
        {
            return EmptyPanel(display.NoVehiclesMessage);
        }

        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(new TsBarChart
        {
            Series = display.EnergyActivitySeries,
            ShowLegend = true,
            IncludeZero = true,
            Title = display.EnergyActivityTitle,
            Height = ChartHeight,
            MinHeight = ChartHeight,
        });
        column.Children.Add(BuildVehicleKey(display.VehicleNames));
        return column;
    }

    // The native bar chart uses an ordinal X axis, so the per-vehicle identity (shown on the web chart's X
    // axis) is preserved as a compact "n · name" key beneath the grouped bars.
    private StackPanel BuildVehicleKey(IReadOnlyList<string> vehicleNames)
    {
        var key = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14 };
        for (int i = 0; i < vehicleNames.Count; i++)
        {
            key.Children.Add(new Caption
            {
                Value = string.Format(CultureInfo.CurrentCulture, "{0} \u00B7 {1}", i + 1, vehicleNames[i]),
            });
        }

        AutomationProperties.SetName(key, _localizer.GetString("analytics.overview.vehicleKey", "Vehicles by index"));
        return key;
    }

    private static TsEmptyState EmptyPanel(string message) => new()
    {
        IconGlyph = EmptyGlyph,
        Message = message,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private Grid BuildLoading()
    {
        var display = _viewModel.Display;
        var panels = new List<UIElement>(4)
        {
            BuildSkeletonPanel(display.FleetUsageTitle),
            BuildSkeletonPanel(display.EfficiencyLeaderboardTitle),
            BuildSkeletonPanel(display.VehicleComparisonTitle),
            BuildSkeletonPanel(display.EnergyActivityTitle),
        };

        var grid = LayoutPanels(panels);
        AutomationProperties.SetName(grid, _localizer.GetString("analytics.overview.loading", "Loading vehicle comparison"));
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
    }

    private static TsGlassPanel BuildSkeletonPanel(string title)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new PanelTitle { Value = title });
        for (int i = 0; i < 3; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 18 });
        }

        return new TsGlassPanel { Content = column, Padding = new Thickness(16) };
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("analytics.overview.error", "Couldn't load vehicle comparison"),
            ActionText = _localizer.GetString("analytics.overview.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
