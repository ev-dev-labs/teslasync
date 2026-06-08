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
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Charging Telemetry dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/ChargingTelemetryWidget.tsx. It mirrors the web <c>WidgetShell</c> (a
/// skeleton while loading, a retry surface on error, otherwise — when not compact — a "⚙ Charging Telemetry"
/// freshness header) wrapping the telemetry body: when charging, either the compact big-number power readout
/// (1 column) or the standard Voltage / Current / Power / Phases stat grid (plus, when wide, an Efficiency tile,
/// a DC/AC charger badge and a rolling power sparkline); when not charging — or when the response carries no
/// telemetry row — a friendly "Not currently charging" surface (the web <c>{isCharging ? … : EmptyState}</c>
/// gate). All data flows through the shared <see cref="ChargingTelemetryViewModel"/>; the view never performs
/// HTTP. Every string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class ChargingTelemetryWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const int StatCellSpacing = 8;

    private readonly ChargingTelemetryViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ChargingTelemetryDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
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

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public ChargingTelemetryWidget(
        IChargingTelemetrySource source,
        ILocalizer localizer,
        ChargingTelemetrySize size,
        ChargingTelemetryDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ChargingTelemetryDiagnostics();
        _viewModel = new ChargingTelemetryViewModel(source, localizer, size);
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

    /// <summary>The canonical registry id this surface registers under (<c>charging-telemetry</c>).</summary>
    public static string RegistryId => ChargingTelemetryRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the telemetry view for the new layout.</summary>
    public ChargingTelemetrySize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ChargingTelemetrySource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle
    /// unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static ChargingTelemetryWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ChargingTelemetrySize? size = null,
        long? vehicleId = null,
        ChargingTelemetryDiagnostics? diagnostics = null)
    {
        var source = new ChargingTelemetrySource(vehicles, api, engine, options, vehicleId);
        return new ChargingTelemetryWidget(source, localizer, size ?? ChargingTelemetryRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = ChargingTelemetryProjection.GaugeGlyph,
            FontSize = 14,
            Foreground = SuccessBrush(),
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.chargingTelemetry.refresh", "Refresh charging telemetry"));
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
        _bodyHost.Padding = new Thickness(12, 4, 12, 12);

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
            case ChargingTelemetryState.Loading:
                Content = BuildLoading();
                break;

            case ChargingTelemetryState.Error:
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
        // Web parity: the compact layout uses a title-less WidgetShell (no title, no icon).
        bool compact = _viewModel.Display?.IsCompact ?? false;
        _titleRow.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title;
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        if (_viewModel.Display is not { } display)
        {
            // Web parity: no telemetry row (data == null) renders the "Not currently charging" surface.
            return BuildNotCharging(_viewModel.NotChargingMessage);
        }

        if (display.IsCharging)
        {
            return display.IsCompact ? BuildCompactCharging(display) : BuildStandardCharging(display);
        }

        return BuildNotCharging(display.NotChargingText);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 24, BlockWidth = 140 });
        column.Children.Add(new TsSkeleton { BlockHeight = 18 });
        column.Children.Add(new TsSkeleton { BlockHeight = 18 });

        AutomationProperties.SetName(column, _localizer.GetString("widget.chargingTelemetry.loading", "Loading charging telemetry"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.chargingTelemetry.error", "Couldn't load charging telemetry"),
            ActionText = _localizer.GetString("widget.chargingTelemetry.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private static TsEmptyState BuildNotCharging(string message) => new()
    {
        IconGlyph = ChargingTelemetryProjection.PlugGlyph,
        Message = message,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Compact: charging (web compact JSX branch) ──
    private static StackPanel BuildCompactCharging(ChargingTelemetryDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MinHeight = 44,
        };

        column.Children.Add(ChargingGlyph(20));
        column.Children.Add(new TextBlock
        {
            Text = display.PowerText,
            FontSize = 18,
            FontWeight = FontWeights.Bold,
            Foreground = SuccessBrush(),
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        column.Children.Add(new TextBlock
        {
            Text = display.VoltageCurrentText,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    // ── Standard / Wide: charging (web standard JSX branch) ──
    private static StackPanel BuildStandardCharging(ChargingTelemetryDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(BuildStatGrid(display.Stats, display.StatColumns));

        // Web parity: wide extras — a top-bordered row with the charger-type badge + power sparkline.
        if (display.IsWide && (display.ChargerBadgeText is not null || display.ShowSparkline))
        {
            column.Children.Add(BuildWideExtras(display));
        }

        AutomationProperties.SetName(column, display.ChargingAutomationName);
        return column;
    }

    private static Grid BuildStatGrid(IReadOnlyList<ChargingTelemetryStat> stats, int columns)
    {
        int cols = Math.Max(1, columns);
        int rows = (stats.Count + cols - 1) / cols;

        var grid = new Grid { ColumnSpacing = StatCellSpacing, RowSpacing = StatCellSpacing };
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
            var cell = BuildStatCard(stats[i]);
            Grid.SetColumn(cell, i % cols);
            Grid.SetRow(cell, i / cols);
            grid.Children.Add(cell);
        }

        return grid;
    }

    private static Border BuildStatCard(ChargingTelemetryStat stat)
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new TextBlock
        {
            Text = stat.Label,
            FontSize = 11,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        Grid.SetColumn(label, 0);

        var glyph = new FontIcon
        {
            Glyph = stat.Glyph,
            FontSize = 13,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        Grid.SetColumn(glyph, 1);

        header.Children.Add(label);
        header.Children.Add(glyph);

        var valueRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        valueRow.Children.Add(new TextBlock
        {
            Text = stat.Value,
            FontSize = 20,
            FontWeight = FontWeights.Bold,
            Foreground = stat.Emphasize ? SuccessBrush() : DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Bottom,
        });
        if (!string.IsNullOrEmpty(stat.Unit))
        {
            valueRow.Children.Add(new TextBlock
            {
                Text = stat.Unit,
                FontSize = 11,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Bottom,
                Margin = new Thickness(0, 0, 0, 3),
            });
        }

        var content = new StackPanel { Spacing = 4 };
        content.Children.Add(header);
        content.Children.Add(valueRow);

        var card = new Border
        {
            Child = content,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12, 10, 12, 10),
        };
        AutomationProperties.SetName(card, stat.AutomationName);
        return card;
    }

    private static StackPanel BuildWideExtras(ChargingTelemetryDisplay display)
    {
        var stack = new StackPanel { Spacing = 8 };

        var divider = new Border
        {
            Height = 1,
            Background = DisplayTokens.Border,
        };
        AutomationProperties.SetAccessibilityView(divider, AccessibilityView.Raw);
        stack.Children.Add(divider);

        var row = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        if (display.ChargerBadgeText is { } badgeText)
        {
            var badge = new TsBadge
            {
                Status = display.ChargerBadgeStatus,
                Content = new TextBlock { Text = badgeText, FontSize = 12 },
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetName(badge, badgeText);
            Grid.SetColumn(badge, 0);
            row.Children.Add(badge);
        }

        if (display.ShowSparkline)
        {
            var spark = new TsSparkline
            {
                Data = display.PowerHistory,
                Role = ChartRole.Power,
                ChartWidth = 160,
                ChartHeight = 28,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(spark, AccessibilityView.Raw);
            Grid.SetColumn(spark, 1);
            row.Children.Add(spark);
        }

        stack.Children.Add(row);
        return stack;
    }

    private static FontIcon ChargingGlyph(double size)
    {
        var glyph = new FontIcon
        {
            Glyph = ChargingTelemetryProjection.BatteryChargingGlyph,
            FontSize = size,
            Foreground = SuccessBrush(),
        };

        if (!MotionPreference.ReduceMotion)
        {
            PulseHelper.Attach(glyph);
        }

        return glyph;
    }

    private static Brush SuccessBrush() => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success));

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
