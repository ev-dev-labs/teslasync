using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Battery Analytics dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/BatteryHealthAnalyticsWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a full-area skeleton while loading, a retry surface on error, otherwise a freshness header) wrapping the
/// web <c>WidgetGaugeHero</c>: a radial state-of-health gauge whose arc is tinted by the web <c>scoreColor</c>
/// threshold (green ≥80, amber ≥50, red otherwise) with the integer score caption beneath it, and — when
/// standard (≥2 cols) — the six stat tiles (Cycles, Charge Depth, Discharge, DC Fast, Temp Score, Habits)
/// the web stats memo emits. The compact footprint (1 col) drops the title and stats and shows the gauge
/// alone (web <c>isCompact</c>). When the response carries no analytics object the surface renders a friendly
/// "No battery health data" empty state (the web <c>{hasData ? hero : &lt;EmptyState&gt;}</c> gate). All data
/// flows through the shared <see cref="BatteryHealthAnalyticsViewModel"/>; the view never performs HTTP. Every
/// string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class BatteryHealthAnalyticsWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double StrokeWidth = 8;
    private const int StatColumns = 3;

    private readonly BatteryHealthAnalyticsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly BatteryHealthAnalyticsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 6,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();
    private readonly ScrollViewer _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public BatteryHealthAnalyticsWidget(
        IBatteryHealthAnalyticsSource source,
        ILocalizer localizer,
        BatteryHealthAnalyticsSize size,
        BatteryHealthAnalyticsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new BatteryHealthAnalyticsDiagnostics();
        _viewModel = new BatteryHealthAnalyticsViewModel(source, localizer, size);
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

    /// <summary>The canonical registry id this surface registers under (<c>battery-health-analytics</c>).</summary>
    public static string RegistryId => BatteryHealthAnalyticsRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the gauge + stats for the new layout.</summary>
    public BatteryHealthAnalyticsSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="BatteryHealthAnalyticsSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle
    /// unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static BatteryHealthAnalyticsWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        BatteryHealthAnalyticsSize? size = null,
        long? vehicleId = null,
        BatteryHealthAnalyticsDiagnostics? diagnostics = null)
    {
        var source = new BatteryHealthAnalyticsSource(vehicles, api, engine, options, vehicleId);
        return new BatteryHealthAnalyticsWidget(
            source, localizer, size ?? BatteryHealthAnalyticsRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = BatteryHealthAnalyticsProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
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
        AutomationProperties.SetName(
            _refresh, _localizer.GetString("widget.batteryHealthAnalytics.refresh", "Refresh battery analytics"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
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
        switch (_viewModel.State)
        {
            case BatteryHealthAnalyticsState.Loading:
                Content = BuildLoading();
                break;

            case BatteryHealthAnalyticsState.Error:
                Content = BuildError();
                break;

            case BatteryHealthAnalyticsState.Empty:
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
        _titleRow.Visibility = _viewModel.Size.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody() =>
        _viewModel.Display is { } display ? BuildHero(display) : BuildEmpty();

    private static StackPanel BuildHero(BatteryHealthAnalyticsDisplay display)
    {
        // Web WidgetGaugeHero: flex flex-col items-center justify-center gap-2 (gauge above, stats below).
        var column = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(BuildGaugeColumn(display));

        if (!display.IsCompact && display.Stats.Count > 0)
        {
            column.Children.Add(BuildStats(display.Stats));
        }

        return column;
    }

    private static StackPanel BuildGaugeColumn(BatteryHealthAnalyticsDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 4,
            MinHeight = 44, // web min-h-[44px]
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var ring = BuildRing(display);
        AutomationProperties.SetName(ring, display.GaugeAutomationName);
        column.Children.Add(ring);

        // Web parity: RadialGauge renders `label` (here the integer score) beneath the ring.
        var caption = new TextBlock
        {
            Text = display.GaugeCaption,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(caption, AccessibilityView.Raw);
        column.Children.Add(caption);

        return column;
    }

    private static Grid BuildRing(BatteryHealthAnalyticsDisplay display)
    {
        double size = display.GaugeDiameter;
        double radius = (size - StrokeWidth) / 2;
        var center = new PointD(size / 2, size / 2);

        var canvas = new Canvas { Width = size, Height = size };
        AutomationProperties.SetAccessibilityView(canvas, AccessibilityView.Raw);

        canvas.Children.Add(ChartShapes.ArcPath(
            ChartGeometry.RingArc(center, radius, 0.9999),
            ChartBrushes.Border,
            StrokeWidth));

        double fraction = ChartGeometry.GaugeFraction(display.GaugeValue, display.GaugeMax);
        if (fraction > 0)
        {
            canvas.Children.Add(ChartShapes.ArcPath(
                ChartGeometry.RingArc(center, radius, fraction),
                ChartBrushes.ForStatus(display.Status),
                StrokeWidth));
        }

        // Web RadialGauge centre: the value (bold) immediately followed by the small "health" unit run.
        var value = new TextBlock
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            FontSize = display.IsCompact ? 16 : 18,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
        };
        value.Inlines.Add(new Run { Text = display.GaugeValueText });
        if (!string.IsNullOrEmpty(display.GaugeUnit))
        {
            value.Inlines.Add(new Run
            {
                Text = display.GaugeUnit,
                FontSize = 11,
                FontWeight = FontWeights.Normal,
                Foreground = DisplayTokens.TextSecondary,
            });
        }

        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);

        var centerHost = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        centerHost.Children.Add(value);

        var ring = new Grid { Width = size, Height = size };
        ring.Children.Add(canvas);
        ring.Children.Add(centerHost);
        return ring;
    }

    private static Grid BuildStats(IReadOnlyList<BatteryHealthHeroStat> stats)
    {
        // Web: flex flex-wrap items-center justify-center gap-x-4 gap-y-1 — a centred grid of auto-width tiles.
        var grid = new Grid
        {
            ColumnSpacing = 16,
            RowSpacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        for (int c = 0; c < StatColumns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        }

        int rows = (int)Math.Ceiling(stats.Count / (double)StatColumns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < stats.Count; i++)
        {
            var cell = BuildStatColumn(stats[i]);
            Grid.SetColumn(cell, i % StatColumns);
            Grid.SetRow(cell, i / StatColumns);
            grid.Children.Add(cell);
        }

        return grid;
    }

    private static StackPanel BuildStatColumn(BatteryHealthHeroStat stat)
    {
        var label = new TextBlock
        {
            Text = stat.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);

        var valueRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 2,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        valueRow.Children.Add(new TextBlock
        {
            Text = stat.Value,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
        });

        if (!string.IsNullOrEmpty(stat.Unit))
        {
            valueRow.Children.Add(new TextBlock
            {
                Text = stat.Unit,
                FontSize = 12,
                FontWeight = FontWeights.Normal,
                Foreground = DisplayTokens.TextSecondary,
                VerticalAlignment = VerticalAlignment.Bottom,
            });
        }

        AutomationProperties.SetAccessibilityView(valueRow, AccessibilityView.Raw);

        var column = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(label);
        column.Children.Add(valueRow);
        AutomationProperties.SetName(column, stat.AutomationName);
        return column;
    }

    private TsSkeleton BuildLoading()
    {
        var skeleton = new TsSkeleton
        {
            BlockWidth = double.NaN,
            BlockHeight = double.NaN,
            Radius = 12,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            Margin = new Thickness(12),
        };

        AutomationProperties.SetName(
            skeleton, _localizer.GetString("widget.batteryHealthAnalytics.loading", "Loading battery analytics"));
        return skeleton;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("widget.batteryHealthAnalytics.error", "Couldn't load battery health"),
            ActionText = _localizer.GetString("widget.batteryHealthAnalytics.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = BatteryHealthAnalyticsProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
