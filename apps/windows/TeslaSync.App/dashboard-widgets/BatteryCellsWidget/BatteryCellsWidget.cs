using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Battery Cells dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/BatteryCellsWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a skeleton while loading, a retry surface on error, otherwise a freshness header) wrapping the
/// scrollable cell-voltage heatmap (the shared <c>WidgetStatusGrid</c>, which shows its own "No cell data"
/// message when there are no bricks) over the four min/max/avg/spread voltage stat cards and — when wide
/// (≥3 columns) — a row of per-module temperature stat cards; or a friendly "No battery cell data" empty
/// state when no vehicle or response resolved. All data flows through the shared
/// <see cref="BatteryCellsViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class BatteryCellsWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double DotSize = 8;

    private readonly BatteryCellsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly BatteryCellsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();
    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public BatteryCellsWidget(
        IBatteryCellsSource source,
        ILocalizer localizer,
        BatteryCellsSize size,
        BatteryCellsDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new BatteryCellsDiagnostics();
        _viewModel = new BatteryCellsViewModel(source, localizer, size, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>battery-cells</c>).</summary>
    public static string RegistryId => BatteryCellsRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the heatmap + stats for the new layout.</summary>
    public BatteryCellsSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="BatteryCellsSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static BatteryCellsWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        BatteryCellsSize? size = null,
        long? vehicleId = null,
        BatteryCellsDiagnostics? diagnostics = null)
    {
        var source = new BatteryCellsSource(vehicles, api, engine, options, vehicleId);
        return new BatteryCellsWidget(source, localizer, size ?? BatteryCellsRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = BatteryCellsProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = Microsoft.UI.Text.FontWeights.Medium;
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.batteryCells.refresh", "Refresh battery cells"));
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
            case BatteryCellsState.Loading:
                Content = BuildLoading();
                break;

            case BatteryCellsState.Error:
                Content = BuildError();
                break;

            case BatteryCellsState.Empty:
                UpdateHeader();
                _bodyHost.Child = BuildEmpty();
                Content = _root;
                break;

            default:
                UpdateHeader();
                _bodyHost.Child = BuildBody();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        _titleRow.Visibility = _viewModel.Size.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 120, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 36, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 36, ReduceMotion = MotionPreference.ReduceMotion });

        AutomationProperties.SetName(column, _localizer.GetString("widget.batteryCells.loading", "Loading battery cells"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.batteryCells.error", "Couldn't load battery cells"),
            ActionText = _localizer.GetString("widget.batteryCells.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = BatteryCellsProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private Grid BuildBody()
    {
        var display = _viewModel.Display;

        var body = new Grid { RowSpacing = 8 };
        body.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        body.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var heatmapHost = new ScrollViewer
        {
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Content = display.HasCells ? BuildHeatmap(display) : BuildCellsEmpty(display),
        };
        Grid.SetRow(heatmapHost, 0);
        body.Children.Add(heatmapHost);

        var voltageGrid = BuildStatGrid(display.VoltageStats, 2);
        Grid.SetRow(voltageGrid, 1);
        body.Children.Add(voltageGrid);

        if (display.ShowTemperature && display.TemperatureStats.Count > 0)
        {
            body.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var tempGrid = BuildStatGrid(display.TemperatureStats, 3);
            Grid.SetRow(tempGrid, 2);
            body.Children.Add(tempGrid);
        }

        return body;
    }

    private static TsEmptyState BuildCellsEmpty(BatteryCellsDisplay display) => new()
    {
        IconGlyph = BatteryCellsProjection.HeaderGlyph,
        Message = display.CellsEmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Grid BuildHeatmap(BatteryCellsDisplay display)
    {
        int cols = Math.Max(1, display.GridColumns);
        int rows = (int)Math.Ceiling(display.Cells.Count / (double)cols);

        var grid = new Grid { ColumnSpacing = 8, RowSpacing = 8 };
        for (int c = 0; c < cols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.Cells.Count; i++)
        {
            var tile = BuildCellTile(display.Cells[i], display.IsCompact);
            Grid.SetColumn(tile, i % cols);
            Grid.SetRow(tile, i / cols);
            grid.Children.Add(tile);
        }

        return grid;
    }

    private static Border BuildCellTile(BatteryCellStatusItem item, bool compact)
    {
        var kind = BatteryCellsProjection.ToStatusKind(item.Severity);

        var label = new TextBlock
        {
            Text = item.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var content = new StackPanel { Spacing = 2 };
        content.Children.Add(label);
        if (!compact)
        {
            content.Children.Add(new TextBlock
            {
                Text = item.Value,
                FontSize = 13,
                FontWeight = Microsoft.UI.Text.FontWeights.Medium,
                Foreground = DisplayTokens.TextPrimary,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
        }

        var dot = new Ellipse
        {
            Width = DotSize,
            Height = DotSize,
            Fill = DisplayTokens.Brush(StatusResources.AccentBrushKey(kind)),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 2, 2, 0),
        };
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);

        var layout = new Grid();
        layout.Children.Add(content);
        layout.Children.Add(dot);

        var tile = new Border
        {
            Child = layout,
            MinHeight = 44,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderThickness = new Thickness(1),
            BorderBrush = StatusTint(kind, 0.25),
            Background = StatusTint(kind, 0.10),
            Padding = compact ? new Thickness(8, 6, 8, 6) : new Thickness(12, 8, 12, 8),
        };
        AutomationProperties.SetName(tile, item.AutomationName);
        return tile;
    }

    private static Grid BuildStatGrid(IReadOnlyList<BatteryCellsStat> stats, int cols)
    {
        var grid = new Grid { ColumnSpacing = 8, RowSpacing = 8 };
        int rows = (int)Math.Ceiling(stats.Count / (double)cols);
        for (int c = 0; c < cols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < stats.Count; i++)
        {
            var card = new TsStatCard { Label = stats[i].Label, Value = stats[i].Value };
            Grid.SetColumn(card, i % cols);
            Grid.SetRow(card, i / cols);
            grid.Children.Add(card);
        }

        return grid;
    }

    /// <summary>
    /// A themed semantic-status tint at the given alpha (web's <c>bg-{status}/10</c> / <c>border-{status}/20</c>):
    /// resolves the status colour token and applies <paramref name="opacity"/>, falling back to the muted
    /// surface tokens when a key is missing so light/dark/high-contrast all stay token-driven.
    /// </summary>
    private static Brush StatusTint(StatusKind kind, double opacity)
    {
        if (Application.Current?.Resources is { } res &&
            res.TryGetValue(StatusResources.AccentColorKey(kind), out var value))
        {
            switch (value)
            {
                case Windows.UI.Color color:
                    return new SolidColorBrush(color) { Opacity = opacity };
                case SolidColorBrush brush:
                    return new SolidColorBrush(brush.Color) { Opacity = opacity };
            }
        }

        return kind == StatusKind.Neutral
            ? DisplayTokens.Surface
            : new SolidColorBrush(Microsoft.UI.Colors.Transparent);
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
