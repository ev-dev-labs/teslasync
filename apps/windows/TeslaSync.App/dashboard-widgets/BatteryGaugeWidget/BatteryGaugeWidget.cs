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
/// The native WinUI 3 Battery Level dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/BatteryGaugeWidget.tsx. It mirrors the web title-less <c>WidgetShell</c>
/// (a full-area skeleton while loading, a retry surface on error, otherwise an overlaid freshness chip)
/// wrapping the web <c>WidgetGaugeHero</c>: a radial state-of-charge gauge whose value arc is tinted by the
/// web <c>batteryColor</c> threshold (green&gt;50, amber&gt;20, red otherwise), the "Battery" caption beneath
/// it, and a "⚡ Charging" indicator when the vehicle is charging (standard size only). When the response
/// carries no state the surface renders a friendly "No battery data" empty state (the web
/// <c>{state ? gauge : &lt;EmptyState&gt;}</c> gate). All data flows through the shared
/// <see cref="BatteryGaugeViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class BatteryGaugeWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double StrokeWidth = 8;

    private readonly BatteryGaugeViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly BatteryGaugeDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Border _bodyHost = new();
    private readonly StackPanel _overlay = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 4,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Top,
        Margin = new Thickness(0, 6, 6, 0),
    };

    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public BatteryGaugeWidget(
        IBatteryGaugeSource source,
        ILocalizer localizer,
        BatteryGaugeSize size,
        BatteryGaugeDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new BatteryGaugeDiagnostics();
        _viewModel = new BatteryGaugeViewModel(source, localizer, size);
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

    /// <summary>The canonical registry id this surface registers under (<c>battery-gauge</c>).</summary>
    public static string RegistryId => BatteryGaugeRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the gauge for the new layout.</summary>
    public BatteryGaugeSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="BatteryGaugeSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static BatteryGaugeWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        BatteryGaugeSize? size = null,
        long? vehicleId = null,
        BatteryGaugeDiagnostics? diagnostics = null)
    {
        var source = new BatteryGaugeSource(vehicles, api, engine, options, vehicleId);
        return new BatteryGaugeWidget(source, localizer, size ?? BatteryGaugeRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.batteryGauge.refresh", "Refresh battery"));
        _refresh.Click += OnRefreshClick;

        _overlay.Children.Add(_freshness);
        _overlay.Children.Add(_refresh);

        _bodyHost.Padding = new Thickness(12);
        _bodyHost.HorizontalAlignment = HorizontalAlignment.Stretch;
        _bodyHost.VerticalAlignment = VerticalAlignment.Stretch;

        _root.Children.Add(_bodyHost);
        _root.Children.Add(_overlay);
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
            case BatteryGaugeState.Loading:
                Content = BuildLoading();
                break;

            case BatteryGaugeState.Error:
                Content = BuildError();
                break;

            case BatteryGaugeState.Empty:
                UpdateOverlay();
                _bodyHost.Child = BuildEmpty();
                Content = _root;
                break;

            default:
                UpdateOverlay();
                _bodyHost.Child = _viewModel.Display is { } display ? BuildGauge(display) : BuildEmpty();
                Content = _root;
                break;
        }
    }

    private void UpdateOverlay()
    {
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
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

        AutomationProperties.SetName(skeleton, _localizer.GetString("widget.batteryGauge.loading", "Loading battery"));
        return skeleton;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.batteryGauge.error", "Couldn't load battery"),
            ActionText = _localizer.GetString("widget.batteryGauge.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = BatteryGaugeProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel BuildGauge(BatteryGaugeDisplay display)
    {
        var hero = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var ring = BuildRing(display);
        AutomationProperties.SetName(ring, display.GaugeAutomationName);
        hero.Children.Add(ring);

        var caption = new TextBlock
        {
            Text = display.Label,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(caption, AccessibilityView.Raw);
        hero.Children.Add(caption);

        if (display.ShowCharging)
        {
            hero.Children.Add(BuildChargingIndicator(display));
        }

        return hero;
    }

    private static Grid BuildRing(BatteryGaugeDisplay display)
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

        double fraction = ChartGeometry.GaugeFraction(display.Value, display.Max);
        if (fraction > 0)
        {
            canvas.Children.Add(ChartShapes.ArcPath(
                ChartGeometry.RingArc(center, radius, fraction),
                ChartBrushes.ForStatus(display.Status),
                StrokeWidth));
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

    private static TextBlock BuildChargingIndicator(BatteryGaugeDisplay display)
    {
        var charging = new TextBlock
        {
            Text = $"{BatteryGaugeProjection.ChargingBolt} {display.ChargingText}",
            FontSize = 10,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success)),
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 2, 0, 0),
        };
        AutomationProperties.SetName(charging, display.ChargingText);

        if (!MotionPreference.ReduceMotion)
        {
            PulseHelper.Attach(charging);
        }

        return charging;
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
