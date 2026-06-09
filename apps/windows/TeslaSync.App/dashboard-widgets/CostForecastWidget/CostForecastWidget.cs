using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Cost Forecast dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/CostForecastWidget.tsx. It mirrors the web <c>WidgetShell</c> (a
/// skeleton while loading, a retry surface on error, otherwise a freshness header) wrapping the web
/// <c>WidgetChartSummary</c>: a summary stat row and — when standard (more than a single column) — the
/// six-month cost bar chart. At a single column it collapses to the compact big-number summary (Next Month
/// + Trend, no chart — the web <c>isCompact = size.cols &lt;= 1</c> branch); standard adds the per-kWh and
/// signed-trend stats plus the chart and a trend header icon (rising costs → amber up, falling → emerald
/// down). A friendly "No forecast data" empty state covers the surface when there are no historical or
/// forecast months (the web <c>hasData = chartData.length &gt; 0</c> gate). All data flows through the
/// shared <see cref="CostForecastViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class CostForecastWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double BarsAreaHeight = 140;

    private readonly CostForecastViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly CostForecastDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly FontIcon _titleIcon = new() { FontSize = 14, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();
    private readonly ScrollViewer _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, currency and diagnostics.</summary>
    public CostForecastWidget(
        ICostForecastSource source,
        ILocalizer localizer,
        CostForecastSize size,
        string? currencySymbol = null,
        CostForecastDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new CostForecastDiagnostics();
        _viewModel = new CostForecastViewModel(source, localizer, size, currencySymbol);
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

    /// <summary>The canonical registry id this surface registers under (<c>cost-forecast</c>).</summary>
    public static string RegistryId => CostForecastRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the chart for the new layout.</summary>
    public CostForecastSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The currency symbol used to format costs; reassigning re-projects.</summary>
    public string CurrencySymbol
    {
        get => _viewModel.CurrencySymbol;
        set => _viewModel.CurrencySymbol = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="CostForecastSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static CostForecastWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        CostForecastSize? size = null,
        string? currencySymbol = null,
        long? vehicleId = null,
        CostForecastDiagnostics? diagnostics = null)
    {
        var source = new CostForecastSource(vehicles, api, engine, options, vehicleId);
        return new CostForecastWidget(
            source, localizer, size ?? CostForecastRegistration.DefaultSize, currencySymbol, diagnostics);
    }

    private void BuildChrome()
    {
        AutomationProperties.SetAccessibilityView(_titleIcon, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(_titleIcon);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.costForecast.refresh", "Refresh cost forecast"));
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
            case CostForecastState.Loading:
                Content = BuildLoading();
                break;

            case CostForecastState.Error:
                Content = BuildError();
                break;

            case CostForecastState.Empty:
                UpdateHeader();
                _bodyHost.Content = BuildEmpty();
                Content = _root;
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
        var display = _viewModel.Display;

        // Web parity: the compact layout uses a title-less WidgetShell.
        _titleRow.Visibility = display.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);

        // Web parity: icon = trendUp ? <TrendingUp amber/> : <TrendingDown emerald/>.
        _titleIcon.Glyph = CostForecastProjection.TrendGlyph(display.TrendUp);
        _titleIcon.Foreground = DisplayTokens.Brush(CostForecastProjection.TrendBrushKey(display.TrendUp));

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private StackPanel BuildBody()
    {
        var display = _viewModel.Display;
        var column = new StackPanel { Spacing = 12 };

        // Web parity: WidgetChartSummary always renders the stat row; the chart only when not compact.
        column.Children.Add(BuildStatRow(display));

        if (!display.IsCompact)
        {
            column.Children.Add(BuildChart(display, _viewModel.Title));
        }

        return column;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 32, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 140, ReduceMotion = MotionPreference.ReduceMotion });

        AutomationProperties.SetName(column, _localizer.GetString("widget.costForecast.loading", "Loading cost forecast"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.costForecast.error", "Couldn't load cost forecast"),
            ActionText = _localizer.GetString("widget.costForecast.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = CostForecastProjection.TrendUpGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Grid BuildStatRow(CostForecastDisplay display)
    {
        int cols = display.IsCompact ? 2 : Math.Max(1, display.Stats.Count);
        int rows = (int)Math.Ceiling(display.Stats.Count / (double)cols);

        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 8 };
        for (int c = 0; c < cols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.Stats.Count; i++)
        {
            var cell = BuildStatCell(display.Stats[i]);
            Grid.SetColumn(cell, i % cols);
            Grid.SetRow(cell, i / cols);
            grid.Children.Add(cell);
        }

        if (display.IsCompact)
        {
            AutomationProperties.SetName(grid, display.CompactAutomationName);
        }

        return grid;
    }

    private static StackPanel BuildStatCell(CostForecastStat stat)
    {
        var label = new TextBlock
        {
            Text = stat.Label,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var value = new TextBlock
        {
            Text = stat.Value,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var cell = new StackPanel { Spacing = 2 };
        cell.Children.Add(label);
        cell.Children.Add(value);
        AutomationProperties.SetName(cell, stat.AutomationName);
        return cell;
    }

    /// <summary>
    /// The six-month cost bar strip — the native analogue of the web recharts <c>BarChart</c> whose bars
    /// share a single flat fill. Each bar's height is scaled to the projected
    /// <see cref="CostForecastBar.HeightRatio"/> (0..1 of the costliest bar) and filled with the brand chart
    /// brush; the month label sits beneath. Every bar carries a Narrator name and a hover tooltip.
    /// </summary>
    private static StackPanel BuildChart(CostForecastDisplay display, string title)
    {
        var bars = display.Bars;
        var chart = new StackPanel { Spacing = 4 };
        AutomationProperties.SetName(chart, title);

        var barsArea = new Grid { Height = BarsAreaHeight, VerticalAlignment = VerticalAlignment.Bottom };
        var labelsRow = new Grid();
        for (int i = 0; i < bars.Count; i++)
        {
            barsArea.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            labelsRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < bars.Count; i++)
        {
            var bar = bars[i];

            var inner = new Grid();
            inner.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Math.Max(0.0, 1 - bar.HeightRatio), GridUnitType.Star) });
            inner.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Math.Max(0.0, bar.HeightRatio), GridUnitType.Star) });

            var fill = new Border
            {
                Background = DisplayTokens.Brush(bar.ColorBrushKey),
                CornerRadius = new CornerRadius(4, 4, 0, 0),
                Margin = new Thickness(3, 0, 3, 0),
                MaxWidth = 32,
                VerticalAlignment = VerticalAlignment.Stretch,
                MinHeight = bar.HeightRatio > 0 ? 2 : 0,
            };
            Grid.SetRow(fill, 1);
            inner.Children.Add(fill);

            Grid.SetColumn(inner, i);
            barsArea.Children.Add(inner);
            AutomationProperties.SetName(inner, bar.AutomationName);
            ToolTipService.SetToolTip(inner, bar.AutomationName);

            var lbl = new TextBlock
            {
                Text = bar.Month,
                FontSize = 9,
                Foreground = DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            };
            AutomationProperties.SetAccessibilityView(lbl, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);
            Grid.SetColumn(lbl, i);
            labelsRow.Children.Add(lbl);
        }

        chart.Children.Add(barsArea);
        chart.Children.Add(labelsRow);
        return chart;
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
