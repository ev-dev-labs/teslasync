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
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Components.Vehicles;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Vehicles;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Vehicle Gauges surface — a parity port of
/// web/src/features/vehicles/components/VehicleGauges.tsx. It renders the web layout inside a glass panel: a
/// vehicle visualization on the left and, on the right, the four radial gauges (battery, range, speed, power),
/// the metric bars (battery level, estimated range, and — only while charging — charge rate) and the four
/// status chips (lock, Sentry, climate, firmware). The web component is a pure presentational child; the
/// native surface binds the same vehicle + live-state data through the shared <see cref="VehicleGaugesViewModel"/>
/// so every state renders as a visible surface — the loading skeleton, the friendly empty state when no vehicle
/// or live state resolves, the retry surface on hard failure, and stale / offline freshness chips over the
/// content. The gauges are drawn from the shared <see cref="ChartGeometry"/> / <see cref="ChartShapes"/>
/// primitives (the same ones <c>TsRadialGauge</c> uses) because the web colours each gauge by a semantic value
/// (<c>batteryColor</c> / <c>boolColorMuted</c>), not purely a brand-palette role. The view never performs HTTP;
/// all derivation, unit conversion and formatting happen in the WinUI-free <see cref="VehicleGaugesProjection"/>.
/// Every string resolves through the i18n facade and every gauge / chip carries a Narrator name.
/// </summary>
public sealed partial class VehicleGauges : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string CarGlyph = "\uE804";     // Segoe Fluent — Car (empty surface)
    private const double GaugeDiameter = 104;
    private const double GaugeStrokeWidth = 8;
    private const double SectionSpacing = 20;
    private const int GaugeCount = 4;

    private readonly VehicleGaugesViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly VehicleGaugesDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly StackPanel _header = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
        Padding = new Thickness(0, 0, 0, 8),
    };

    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly ContentControl _bodyHost = new()
    {
        HorizontalContentAlignment = HorizontalAlignment.Stretch,
        VerticalContentAlignment = VerticalAlignment.Stretch,
    };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, unit preference and (optional) diagnostics.</summary>
    /// <param name="source">The cache-then-network gauges source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits().unitPrefs</c>); null = metric.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehicleGauges(
        IVehicleGaugesSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        VehicleGaugesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new VehicleGaugesDiagnostics();
        _viewModel = new VehicleGaugesViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.SurfaceName);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>VehicleGauges</c>).</summary>
    public static string Slug => VehicleGaugesRegistration.Slug;

    /// <summary>The user's unit preference; reassigning re-projects the gauges in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="VehicleGaugesSource"/> from the shared
    /// data layer (the vehicles host's P2-core dependencies).
    /// </summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference, or <see langword="null"/> for metric.</param>
    /// <param name="vehicleId">An explicit vehicle id, or <see langword="null"/> for the primary vehicle.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <returns>A ready-to-host surface bound to the live data layer.</returns>
    public static VehicleGauges Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        VehicleGaugesDiagnostics? diagnostics = null)
    {
        var source = new VehicleGaugesSource(api, engine, options, vehicleId);
        return new VehicleGauges(source, localizer, units, diagnostics);
    }

    private void BuildChrome()
    {
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
        AutomationProperties.SetName(this, _viewModel.Display.AutomationName);

        switch (_viewModel.State)
        {
            case VehicleGaugesState.Loading:
                Content = BuildLoading();
                break;

            case VehicleGaugesState.Error:
                Content = BuildError();
                break;

            case VehicleGaugesState.Empty:
                Content = BuildEmpty();
                break;

            default:
                UpdateHeader();
                _bodyHost.Content = BuildContent(_viewModel.Display);
                Content = _root;
                break;
        }
    }

    // ── Header (stale/offline chip + freshness + refresh) ─────────────────────────────────────────────

    private void UpdateHeader()
    {
        _header.Children.Clear();

        if (_viewModel.State is VehicleGaugesState.Stale or VehicleGaugesState.Offline)
        {
            _header.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.State == VehicleGaugesState.Offline;
        _header.Children.Add(_freshness);
        _header.Children.Add(BuildRefreshButton());
    }

    private TsBadge BuildFreshnessChip(VehicleGaugesState state)
    {
        bool offline = state == VehicleGaugesState.Offline;
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
            IsEnabled = !_viewModel.IsFetching,
        };
        AutomationProperties.SetName(button, _localizer.GetString("common.refresh", "Refresh"));
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── States: loading / error / empty ───────────────────────────────────────────────────────────────

    private TsFadeIn BuildLoading()
    {
        var grid = NewGaugeGrid();
        for (int i = 0; i < GaugeCount; i++)
        {
            var column = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
            column.Children.Add(new TsSkeleton { BlockWidth = GaugeDiameter, BlockHeight = GaugeDiameter });
            column.Children.Add(new TsSkeleton { BlockWidth = 64, BlockHeight = 12 });
            grid.Children.Add(column);
        }

        AutomationProperties.SetName(grid, _localizer.GetString("common.loading", "Loading"));
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);

        var panel = new TsGlassPanel { Padding = new Thickness(24), Content = grid };
        return new TsFadeIn { DelayMs = 50, Content = panel };
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("vehicleGauges.error", "Couldn't load the vehicle gauges"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = CarGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Content (glass panel: car + gauges/metrics/chips) ──────────────────────────────────────────────

    private static TsFadeIn BuildContent(VehicleGaugesDisplay display)
    {
        var layout = new Grid { ColumnSpacing = SectionSpacing };
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var car = BuildCar(display.Car);
        Grid.SetColumn(car, 0);
        layout.Children.Add(car);

        var right = new StackPanel { Spacing = SectionSpacing, VerticalAlignment = VerticalAlignment.Center };
        right.Children.Add(BuildGaugeRow(display.Gauges));
        right.Children.Add(BuildMetrics(display.Metrics));
        right.Children.Add(BuildChips(display.Chips));
        Grid.SetColumn(right, 1);
        layout.Children.Add(right);

        AutomationProperties.SetName(layout, display.AutomationName);
        var panel = new TsGlassPanel { Padding = new Thickness(24), Content = layout };
        return new TsFadeIn { DelayMs = 50, Content = panel };
    }

    private static TsVehicleTwin BuildCar(VehicleGaugesCar? car)
    {
        var twin = new TsVehicleTwin
        {
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            MaxWidth = 360,
        };

        if (car is { } c)
        {
            twin.SetModel(new VehicleTwinModel
            {
                Locked = c.Locked,
                SentryMode = c.SentryMode,
                IsCharging = c.IsCharging,
                IsDriving = c.IsDriving,
                ExteriorColor = string.IsNullOrWhiteSpace(c.ExteriorColor) ? null : c.ExteriorColor,
            });
            AutomationProperties.SetName(twin, c.AutomationName);
        }

        return twin;
    }

    private static TsGrid BuildGaugeRow(IReadOnlyList<VehicleGaugesGauge> gauges)
    {
        var grid = NewGaugeGrid();
        foreach (var gauge in gauges)
        {
            grid.Children.Add(BuildGaugeVisual(gauge));
        }

        return grid;
    }

    private static TsGrid NewGaugeGrid() => new() { Columns = GaugeCount, Gutter = 16, ItemMinWidth = 96 };

    // web RadialGauge: a tokenized background ring, a semantic-coloured value arc swept by value/max, the
    // formatted value + small unit centred, and the label beneath — drawn from the shared gauge primitives.
    private static StackPanel BuildGaugeVisual(VehicleGaugesGauge gauge)
    {
        double radius = (GaugeDiameter - GaugeStrokeWidth) / 2;
        var center = new PointD(GaugeDiameter / 2, GaugeDiameter / 2);

        var canvas = new Canvas { Width = GaugeDiameter, Height = GaugeDiameter };
        canvas.Children.Add(ChartShapes.ArcPath(
            ChartGeometry.RingArc(center, radius, 0.9999), ChartBrushes.Border, GaugeStrokeWidth));

        double fraction = ChartGeometry.GaugeFraction(gauge.Value, gauge.Max);
        if (fraction > 0)
        {
            Brush arcBrush = ChartBrushes.Resolve(gauge.BrushKey);
            canvas.Children.Add(ChartShapes.ArcPath(
                ChartGeometry.RingArc(center, radius, fraction), arcBrush, GaugeStrokeWidth));
        }

        AutomationProperties.SetAccessibilityView(canvas, AccessibilityView.Raw);

        var ring = new Grid { Width = GaugeDiameter, Height = GaugeDiameter };
        ring.Children.Add(canvas);
        ring.Children.Add(BuildCenterValue(gauge));

        var column = new StackPanel { Spacing = 6, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(ring);
        column.Children.Add(new Caption
        {
            Value = gauge.Label,
            HorizontalAlignment = HorizontalAlignment.Center,
            HorizontalContentAlignment = HorizontalAlignment.Center,
        });

        AutomationProperties.SetName(column, gauge.AutomationName);
        return column;
    }

    private static StackPanel BuildCenterValue(VehicleGaugesGauge gauge)
    {
        var value = new TextBlock
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            FontSize = 18,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
        };
        value.Inlines.Add(new Run { Text = ScalarFormatters.FormatNumber(gauge.Value, 0) });
        if (!string.IsNullOrEmpty(gauge.Unit))
        {
            value.Inlines.Add(new Run
            {
                Text = " " + gauge.Unit,
                FontSize = 11,
                FontWeight = FontWeights.Normal,
                Foreground = DisplayTokens.TextMuted,
            });
        }

        var host = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        host.Children.Add(value);
        return host;
    }

    private static StackPanel BuildMetrics(IReadOnlyList<VehicleGaugesMetric> metrics)
    {
        var stack = new StackPanel { Spacing = 12 };
        foreach (var metric in metrics)
        {
            var bar = new TsMetricBar
            {
                Label = metric.Label,
                Value = metric.Value,
                Max = metric.Max,
                ValueText = metric.ValueText,
                AccentBrushKey = metric.BrushKey,
            };
            AutomationProperties.SetName(bar, metric.AutomationName);
            stack.Children.Add(bar);
        }

        return stack;
    }

    private static StackPanel BuildChips(IReadOnlyList<VehicleGaugesChip> chips)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        foreach (var chip in chips)
        {
            row.Children.Add(BuildChip(chip));
        }

        return row;
    }

    private static Border BuildChip(VehicleGaugesChip chip)
    {
        var icon = new FontIcon
        {
            Glyph = chip.Glyph,
            FontSize = 12,
            Foreground = ChartBrushes.Resolve(chip.BrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = chip.Label,
            FontSize = 11,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        content.Children.Add(icon);
        content.Children.Add(label);

        var chipBorder = new Border
        {
            Child = content,
            CornerRadius = DisplayTokens.Radius("TsRadiusPill", 999),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12, 4, 12, 4),
        };
        AutomationProperties.SetName(chipBorder, chip.AutomationName);
        return chipBorder;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new VehicleGaugesAutomationPeer(this);

    private sealed class VehicleGaugesAutomationPeer(VehicleGauges owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override string GetClassNameCore() => nameof(VehicleGauges);

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
