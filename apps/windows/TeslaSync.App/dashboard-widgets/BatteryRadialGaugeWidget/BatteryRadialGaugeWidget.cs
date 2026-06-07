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
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Battery Radial Gauge dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/BatteryRadialGaugeWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a full-area skeleton while loading, a retry surface on error, otherwise the "Battery" title row — present
/// only when not compact — with an overlaid freshness chip) wrapping the web <c>WidgetGaugeHero</c>: a radial
/// state-of-charge gauge whose value arc is tinted by the web <c>getBatteryColor</c> threshold (green&gt;50,
/// amber&gt;20, red otherwise), a faint <c>ChargeLimitRing</c> overlay arc marking the charge limit position
/// (when <c>charge_limit_soc</c> is present and the footprint is not compact), the Level / Limit stat tiles
/// (only when large, ≥2 cols × ≥2 rows), and a pulsing "⚡ Charging" indicator beneath the gauge whenever the
/// vehicle is charging. When the response carries no state the surface renders a friendly "No battery data"
/// empty state (the web <c>{state ? gauge : &lt;EmptyState&gt;}</c> gate). All data flows through the shared
/// <see cref="BatteryRadialGaugeViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class BatteryRadialGaugeWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double StrokeWidth = 8;          // web STROKE_WIDTH (gauge value arc)
    private const double ChargeLimitStroke = 2;    // web ChargeLimitRing strokeWidth={2}

    private readonly BatteryRadialGaugeViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly BatteryRadialGaugeDiagnostics _diagnostics;
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
    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public BatteryRadialGaugeWidget(
        IBatteryRadialGaugeSource source,
        ILocalizer localizer,
        BatteryRadialGaugeSize size,
        BatteryRadialGaugeDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new BatteryRadialGaugeDiagnostics();
        _viewModel = new BatteryRadialGaugeViewModel(source, localizer, size);
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

    /// <summary>The canonical registry id this surface registers under (<c>battery-radial-gauge</c>).</summary>
    public static string RegistryId => BatteryRadialGaugeRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the gauge for the new layout.</summary>
    public BatteryRadialGaugeSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="BatteryRadialGaugeSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle
    /// unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static BatteryRadialGaugeWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        BatteryRadialGaugeSize? size = null,
        long? vehicleId = null,
        BatteryRadialGaugeDiagnostics? diagnostics = null)
    {
        var source = new BatteryRadialGaugeSource(vehicles, api, engine, options, vehicleId);
        return new BatteryRadialGaugeWidget(
            source, localizer, size ?? BatteryRadialGaugeRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = BatteryRadialGaugeProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.batteryRadialGauge.refresh", "Refresh battery"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
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

        _bodyHost.Padding = new Thickness(12, 0, 12, 12);
        _bodyHost.HorizontalAlignment = HorizontalAlignment.Stretch;
        _bodyHost.VerticalAlignment = VerticalAlignment.Stretch;

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
            case BatteryRadialGaugeState.Loading:
                Content = BuildLoading();
                break;

            case BatteryRadialGaugeState.Error:
                Content = BuildError();
                break;

            case BatteryRadialGaugeState.Empty:
                UpdateHeader();
                _bodyHost.Child = BuildEmpty();
                Content = _root;
                break;

            default:
                UpdateHeader();
                _bodyHost.Child = _viewModel.Display is { } display ? BuildBody(display) : BuildEmpty();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        // Web parity: WidgetShell title is `isCompact ? undefined : t('widget.batteryRadial')` — collapse the
        // title row (icon + caption) when compact; the freshness/refresh actions stay pinned top-right.
        _titleRow.Visibility = _viewModel.Size.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private static StackPanel BuildBody(BatteryRadialGaugeDisplay display)
    {
        // Web outer column: h-full flex flex-col items-center justify-center gap-1 (gauge above, charging below).
        var outer = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        outer.Children.Add(BuildHero(display));

        if (display.ShowCharging)
        {
            outer.Children.Add(BuildChargingIndicator(display));
        }

        return outer;
    }

    private static StackPanel BuildHero(BatteryRadialGaugeDisplay display)
    {
        // Web WidgetGaugeHero: flex flex-col items-center justify-center gap-2 (gauge, then stats row).
        var column = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(BuildGaugeColumn(display));

        if (display.ShowStats && display.Stats.Count > 0)
        {
            column.Children.Add(BuildStats(display.Stats));
        }

        return column;
    }

    private static StackPanel BuildGaugeColumn(BatteryRadialGaugeDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var ring = BuildRing(display);
        AutomationProperties.SetName(ring, display.GaugeAutomationName);
        column.Children.Add(ring);

        // Web parity: RadialGauge renders `label` beneath the ring — empty (and so dropped) when compact.
        if (!string.IsNullOrEmpty(display.GaugeLabel))
        {
            var caption = new TextBlock
            {
                Text = display.GaugeLabel,
                FontSize = 12,
                FontWeight = FontWeights.Medium,
                Foreground = DisplayTokens.TextSecondary,
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(caption, AccessibilityView.Raw);
            column.Children.Add(caption);
        }

        return column;
    }

    private static Grid BuildRing(BatteryRadialGaugeDisplay display)
    {
        double size = display.GaugeDiameter;
        double radius = (size - StrokeWidth) / 2;
        var center = new PointD(size / 2, size / 2);

        var canvas = new Canvas { Width = size, Height = size };
        AutomationProperties.SetAccessibilityView(canvas, AccessibilityView.Raw);

        // Track (full faint ring).
        canvas.Children.Add(ChartShapes.ArcPath(
            ChartGeometry.RingArc(center, radius, 0.9999),
            ChartBrushes.Border,
            StrokeWidth));

        // Value arc, tinted by the battery threshold status.
        double fraction = ChartGeometry.GaugeFraction(display.Value, display.Max);
        if (fraction > 0)
        {
            canvas.Children.Add(ChartShapes.ArcPath(
                ChartGeometry.RingArc(center, radius, fraction),
                ChartBrushes.ForStatus(display.Status),
                StrokeWidth));
        }

        // Web ChargeLimitRing: a thin faint-white arc on the same radius marking the charge limit position.
        if (display.ShowChargeLimitRing && display.ChargeLimitFraction > 0)
        {
            var limit = ChartShapes.ArcPath(
                ChartGeometry.RingArc(center, radius, display.ChargeLimitFraction),
                ChargeLimitBrush(),
                ChargeLimitStroke);
            AutomationProperties.SetAccessibilityView(limit, AccessibilityView.Raw);
            canvas.Children.Add(limit);
        }

        var value = new TextBlock
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            FontSize = display.IsCompact ? 16 : 18,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
        };
        value.Inlines.Add(new Run { Text = display.ValueText });
        if (!string.IsNullOrEmpty(display.Unit))
        {
            value.Inlines.Add(new Run
            {
                Text = display.Unit,
                FontSize = 12,
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

    private static StackPanel BuildStats(IReadOnlyList<RadialGaugeStat> stats)
    {
        // Web: flex flex-wrap items-center justify-center gap-x-4 gap-y-1 — a centred row of auto-width tiles.
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        foreach (var stat in stats)
        {
            row.Children.Add(BuildStatTile(stat));
        }

        return row;
    }

    private static StackPanel BuildStatTile(RadialGaugeStat stat)
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
            Text = stat.ValueText,
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

        var tile = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };
        tile.Children.Add(label);
        tile.Children.Add(valueRow);
        AutomationProperties.SetName(tile, stat.AutomationName);
        return tile;
    }

    private static TextBlock BuildChargingIndicator(BatteryRadialGaugeDisplay display)
    {
        var charging = new TextBlock
        {
            Text = $"{BatteryRadialGaugeProjection.ChargingBolt} {display.ChargingText}",
            FontSize = 10,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success)),
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 4, 0, 0),
        };
        AutomationProperties.SetName(charging, display.ChargingText);

        if (!MotionPreference.ReduceMotion)
        {
            PulseHelper.Attach(charging);
        }

        return charging;
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

        AutomationProperties.SetName(skeleton, _localizer.GetString("widget.batteryRadialGauge.loading", "Loading battery"));
        return skeleton;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.batteryRadialGauge.error", "Couldn't load battery"),
            ActionText = _localizer.GetString("widget.batteryRadialGauge.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = BatteryRadialGaugeProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // Web ChargeLimitRing stroke: rgba(255,255,255,0.25) — a faint white tick over the gauge (0x40 ≈ 0.25·255).
    private static SolidColorBrush ChargeLimitBrush() =>
        new(Windows.UI.Color.FromArgb(0x40, 0xFF, 0xFF, 0xFF));

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
