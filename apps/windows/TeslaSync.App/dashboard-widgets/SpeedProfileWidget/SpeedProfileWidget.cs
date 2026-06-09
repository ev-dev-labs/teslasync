using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Speed Profile dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/SpeedProfileWidget.tsx. It mirrors the web <c>WidgetShell</c> (a
/// skeleton while loading, a retry surface on error, otherwise a freshness header) wrapping the web
/// <c>WidgetChartSummary</c>: a summary stat row (Most Common, Peak Freq, Sweet Spot) and — when standard
/// (not a single column) — the speed-distribution histogram with its efficiency-overlay line, sharing one
/// composed chart surface; a friendly "No speed data" empty state covers the surface when no bucket has any
/// readings (the web <c>hasData</c> gate). At a single column the title, chart and Peak Freq stat collapse
/// to a Most Common + Sweet Spot summary (the web <c>isCompact</c> branch). All data flows through the
/// shared <see cref="SpeedProfileViewModel"/>; the view never performs HTTP. Speed ranges are shown in the
/// user's speed unit (mph or km/h); every string resolves through the i18n facade and every interactive
/// element carries a Narrator name.
/// </summary>
public sealed partial class SpeedProfileWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly SpeedProfileViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SpeedProfileDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();
    private readonly ScrollViewer _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, units and diagnostics.</summary>
    public SpeedProfileWidget(
        ISpeedProfileSource source,
        ILocalizer localizer,
        SpeedProfileSize size,
        UnitPref? units = null,
        SpeedProfileDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SpeedProfileDiagnostics();
        _viewModel = new SpeedProfileViewModel(source, localizer, size, units);
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

    /// <summary>The canonical registry id this surface registers under (<c>speed-profile</c>).</summary>
    public static string RegistryId => SpeedProfileRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the snapshot for the new layout.</summary>
    public SpeedProfileSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the speed ranges in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SpeedProfileSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless
    /// an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static SpeedProfileWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        SpeedProfileSize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        SpeedProfileDiagnostics? diagnostics = null)
    {
        var source = new SpeedProfileSource(vehicles, api, engine, options, vehicleId);
        return new SpeedProfileWidget(
            source, localizer, size ?? SpeedProfileRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = SpeedProfileProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(SpeedProfileProjection.HeaderAccentBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.speedProfile.refresh", "Refresh speed profile"));
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
            case SpeedProfileState.Loading:
                Content = BuildLoading();
                break;

            case SpeedProfileState.Error:
                Content = BuildError();
                break;

            case SpeedProfileState.Empty:
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
        // Web parity: the compact layout uses a title-less WidgetShell.
        _titleRow.Visibility = _viewModel.Display.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
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
        column.Children.Add(new TsSkeleton { BlockHeight = 160, ReduceMotion = MotionPreference.ReduceMotion });

        AutomationProperties.SetName(column, _localizer.GetString("widget.speedProfile.loading", "Loading speed profile"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.speedProfile.error", "Couldn't load speed profile"),
            ActionText = _localizer.GetString("widget.speedProfile.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = SpeedProfileProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Grid BuildStatRow(SpeedProfileDisplay display)
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

    private static StackPanel BuildStatCell(SpeedProfileStat stat)
    {
        var label = new TextBlock
        {
            Text = stat.Label,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var valueRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, VerticalAlignment = VerticalAlignment.Bottom };
        valueRow.Children.Add(new TextBlock
        {
            Text = stat.Value,
            FontSize = 14,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        if (!string.IsNullOrEmpty(stat.Unit))
        {
            valueRow.Children.Add(new TextBlock
            {
                Text = stat.Unit,
                FontSize = 10,
                Foreground = DisplayTokens.TextMuted,
                Margin = new Thickness(0, 0, 0, 1),
                VerticalAlignment = VerticalAlignment.Bottom,
            });
        }

        var cell = new StackPanel { Spacing = 2 };
        cell.Children.Add(label);
        cell.Children.Add(valueRow);
        AutomationProperties.SetName(cell, stat.AutomationName);
        return cell;
    }

    /// <summary>
    /// The composed speed-distribution chart — the native analogue of the web recharts
    /// <c>ComposedChart</c>: the frequency histogram (bars, palette series 0 ≈ web indigo) with the
    /// efficiency-overlay line (palette series 1 ≈ web amber). Mixed series kinds share one surface via
    /// <see cref="TsComposedChart"/>; the bucket labels carry through each point so the tooltip and the
    /// accessible summary name the ranges. The chart carries the widget title as its accessible name.
    /// </summary>
    private static TsComposedChart BuildChart(SpeedProfileDisplay display, string title)
    {
        var frequencyPoints = new List<ChartPoint>(display.Points.Count);
        var efficiencyPoints = new List<ChartPoint>(display.Points.Count);
        for (int i = 0; i < display.Points.Count; i++)
        {
            var point = display.Points[i];
            frequencyPoints.Add(new ChartPoint(i, point.Frequency, point.Bucket));
            efficiencyPoints.Add(new ChartPoint(i, point.Efficiency, point.Bucket));
        }

        var series = new List<ChartSeries>(2)
        {
            new(display.FrequencySeriesName, frequencyPoints)
            {
                Kind = ChartSeriesKind.Bar,
                ColorIndex = SpeedProfileProjection.FrequencyColorIndex,
                Unit = "%",
                Decimals = 1,
            },

            // Web parity: the efficiency overlay always renders (it reads the legacy avg_power_kw key, which
            // is absent on the SI backend, so the line sits flat at 0 — the documented degradation path).
            new(display.EfficiencySeriesName, efficiencyPoints)
            {
                Kind = ChartSeriesKind.Line,
                ColorIndex = SpeedProfileProjection.EfficiencyColorIndex,
                Decimals = 1,
            },
        };

        var chart = new TsComposedChart
        {
            Title = title,
            Series = series,
            ShowLegend = false,
            IncludeZero = true,
            MinHeight = 160,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(chart, title);
        return chart;
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
