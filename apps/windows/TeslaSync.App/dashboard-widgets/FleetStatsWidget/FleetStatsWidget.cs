using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Fleet Stats dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/FleetStatsWidget.tsx. It mirrors the web <c>WidgetShell</c> (skeleton
/// while loading, a retry surface on hard error, otherwise a freshness header) wrapping the web
/// <c>FleetStatsBar</c>: five centred metric cards — fleet size (with the online sub-count), 30-day distance
/// (cyan, with a recent-drives sparkline), 30-day energy (emerald, with a recent-charges sparkline), fleet
/// average efficiency (amber) and unread alerts — or a friendly empty state when the fleet is empty. All data
/// flows through the shared <see cref="FleetStatsViewModel"/>; the view never performs HTTP. Every string
/// resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class FleetStatsWidget : ContentControl, IDisposable
{
    private const string HeaderGlyph = "\uE9D9"; // Segoe Fluent — BarChart (web BarChart3)
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly FleetStatsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly FleetStatsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, units and diagnostics.</summary>
    public FleetStatsWidget(
        IFleetStatsSource source,
        ILocalizer localizer,
        FleetStatsSize size,
        UnitPref? units = null,
        FleetStatsDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new FleetStatsDiagnostics();
        _viewModel = new FleetStatsViewModel(source, localizer, size, units, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical registry id this surface registers under (<c>fleet-stats</c>).</summary>
    public static string RegistryId => FleetStatsRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the metrics for the new layout.</summary>
    public FleetStatsSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the metrics in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="FleetStatsSource"/> from the shared data
    /// layer (the dashboard host's P2-core dependencies).
    /// </summary>
    public static FleetStatsWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        FleetStatsSize? size = null,
        UnitPref? units = null,
        FleetStatsDiagnostics? diagnostics = null)
    {
        var source = new FleetStatsSource(vehicles, api, engine, options);
        return new FleetStatsWidget(
            source, localizer, size ?? FleetStatsRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(icon);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.fleetStats.refresh", "Refresh fleet stats"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        _header.Padding = new Thickness(12, 8, 12, 2);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(actions, 1);
        _header.Children.Add(_titleRow);
        _header.Children.Add(actions);

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(12, 0, 12, 12);

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
            case FleetStatsState.Loading:
                Content = BuildLoading();
                break;

            case FleetStatsState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _bodyHost.Content = BuildBody();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        var display = _viewModel.Display;
        return display.HasData
            ? BuildCardGrid(display.Cards, _viewModel.Size.GridColumns)
            : BuildEmpty();
    }

    private StackPanel BuildLoading()
    {
        bool reduceMotion = MotionPreference.ReduceMotion;
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };

        var topRow = SkeletonRow(reduceMotion);
        var bottomRow = SkeletonRow(reduceMotion);
        column.Children.Add(topRow);
        column.Children.Add(bottomRow);

        AutomationProperties.SetName(column, _localizer.GetString("widget.fleetStats.loading", "Loading fleet stats"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private static Grid SkeletonRow(bool reduceMotion)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        for (int c = 0; c < 3; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var block = new TsSkeleton { BlockHeight = 56, Radius = 8, ReduceMotion = reduceMotion };
            Grid.SetColumn(block, c);
            grid.Children.Add(block);
        }

        return grid;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.fleetStats.error", "Couldn't load fleet stats"),
            ActionText = _localizer.GetString("widget.fleetStats.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Grid BuildCardGrid(IReadOnlyList<FleetStatCard> cards, int cols)
    {
        int columns = Math.Max(1, cols);
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        int rows = (int)Math.Ceiling(cards.Count / (double)columns);
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < cards.Count; i++)
        {
            var tile = BuildCard(cards[i]);
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        return grid;
    }

    private static Border BuildCard(FleetStatCard card)
    {
        var label = new TextBlock
        {
            Text = card.Label,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);

        var value = new TextBlock
        {
            Text = FormatValue(card),
            FontSize = 22,
            FontWeight = FontWeights.SemiBold,
            Foreground = ToneBrush(card.Tone),
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);

        var column = new StackPanel
        {
            Spacing = 4,
            MinHeight = 64,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(label);
        column.Children.Add(value);

        if (card.Sparkline is { Count: >= 2 } sparkline)
        {
            var spark = new TsSparkline
            {
                Data = sparkline,
                ColorIndex = card.SparkColorIndex,
                ChartWidth = 60,
                ChartHeight = 24,
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(spark, AccessibilityView.Raw);
            column.Children.Add(spark);
        }
        else if (!string.IsNullOrEmpty(card.Subtitle))
        {
            var subtitle = new TextBlock
            {
                Text = card.Subtitle,
                FontSize = 10,
                Foreground = DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Center,
                TextAlignment = TextAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(subtitle, AccessibilityView.Raw);
            column.Children.Add(subtitle);
        }

        var tile = new Border
        {
            Child = column,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12, 10, 12, 10),
        };
        AutomationProperties.SetName(tile, card.AutomationName);
        return tile;
    }

    private static string FormatValue(FleetStatCard card)
    {
        string number = ScalarFormatters.FormatNumber(card.Value, Math.Max(0, card.Precision));
        return string.Concat(number, card.Suffix);
    }

    private static Brush ToneBrush(FleetStatTone tone) => tone switch
    {
        FleetStatTone.Cyan => ChartBrushes.ForIndex(0),
        FleetStatTone.Emerald => ChartBrushes.ForIndex(1),
        FleetStatTone.Amber => ChartBrushes.ForIndex(2),
        FleetStatTone.AlertActive => DisplayTokens.Brush("TsColorDangerBrush"),
        FleetStatTone.AlertClear => DisplayTokens.Brush("TsColorSuccessBrush"),
        _ => DisplayTokens.TextPrimary,
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
