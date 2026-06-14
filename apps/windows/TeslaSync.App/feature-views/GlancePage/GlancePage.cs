using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Dashboard;

/// <summary>
/// The native WinUI 3 <c>GlancePage</c> — a parity port of the web page
/// web/src/features/dashboard/pages/GlancePage.tsx (route <c>/glance</c>, nav name <c>Glance</c>). It binds to a
/// <see cref="GlancePageViewModel"/> and renders every web region the manifest enumerates with Fluent components and
/// design tokens: the centred glance card (the <c>GlassPanel1</c> Mica surface) carrying the vehicle name + online
/// status badge, the big battery <c>RadialGauge</c> tinted by the web <c>batteryColor</c> threshold, the four
/// <c>MetricCard</c> tiles (Range, Interior, Security, Location), the three quick-action command buttons
/// (lock/unlock, climate, horn), the data-freshness chip and the "Open full app" link. The four data states are
/// distinct surfaces — a loading skeleton, a retry surface (web <c>vehiclesError</c>), the "No vehicle found" empty
/// surface (web <c>!vehicle</c>) and the success card — so a region never collapses silently. The view is a thin
/// renderer: all branch selection, unit conversion and i18n happen in the view-model's <see cref="GlanceDisplay"/>
/// projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class GlancePage : UserControl, IDisposable
{
    private const double GaugeSize = 180;  // web RadialGauge size={180}
    private const double StrokeWidth = 8;  // web STROKE_WIDTH (gauge value arc)

    private readonly GlancePageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly GlanceDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the page over the default empty local-state sources and the shell resource localizer.</summary>
    public GlancePage()
        : this(
            EmptyGlanceVehiclesSource.Instance,
            EmptyGlanceVehicleStateSource.Instance,
            EmptyGlanceLocationSource.Instance,
            NoopGlanceCommandSender.Instance,
            ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over explicit data ports, a localizer, an optional unit preference and diagnostics.</summary>
    /// <param name="vehiclesSource">The cache-then-network vehicle-resolution port (native <c>useVehicles</c>).</param>
    /// <param name="stateSource">The cache-then-network vehicle-state port (native <c>useVehicleState</c>).</param>
    /// <param name="locationSource">The cache-then-network latest-location port (native <c>useLocationSnapshotLatest</c>).</param>
    /// <param name="commandSender">The one-shot command mutation port (native <c>useVehicleCommand</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public GlancePage(
        IGlanceVehiclesSource vehiclesSource,
        IGlanceVehicleStateSource stateSource,
        IGlanceLocationSource locationSource,
        IGlanceCommandSender commandSender,
        ILocalizer localizer,
        UnitPref? units = null,
        GlanceDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(vehiclesSource);
        ArgumentNullException.ThrowIfNull(stateSource);
        ArgumentNullException.ThrowIfNull(locationSource);
        ArgumentNullException.ThrowIfNull(commandSender);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new GlanceDiagnostics();
        _viewModel = new GlancePageViewModel(vehiclesSource, stateSource, locationSource, commandSender, localizer, units, _diagnostics);

        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>Raised when the page requests navigation to another route (web "Open full app" link).</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>The diagnostics surface slug (<c>GlancePage</c>).</summary>
    public static string Slug => GlanceRegistration.Slug;

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
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
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => ScheduleRender();

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
        Content = _viewModel.State switch
        {
            GlanceState.Loading => BuildLoading(),
            GlanceState.Error => BuildError(),
            GlanceState.Empty => BuildShell(BuildEmpty()),
            _ => BuildShell(BuildSuccess(_viewModel.Display)),
        };
    }

    // ── Shell + states ───────────────────────────────────────────────────

    // GlassPanel1 — the centred Mica glass card wrapping the page body (web `<GlassPanel className="p-8">`).
    private static ScrollViewer BuildShell(UIElement body)
    {
        var panel = new TsGlassPanel
        {
            Padding = new Thickness(32),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MaxWidth = 420,
            Content = body,
        };

        var host = new Grid
        {
            Padding = new Thickness(24),
            MinHeight = 480,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        host.Children.Add(panel);

        return new ScrollViewer
        {
            Content = host,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
        };
    }

    private ScrollViewer BuildLoading()
    {
        var column = new StackPanel
        {
            Spacing = 16,
            Width = 240,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(new TsSkeleton { BlockWidth = 180, BlockHeight = 180, Radius = 90, HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new TsSkeleton { BlockWidth = 240, BlockHeight = 24, Radius = 8 });
        column.Children.Add(new TsSkeleton { BlockWidth = 240, BlockHeight = 96, Radius = 12 });
        AutomationProperties.SetName(column, _localizer.GetString("glance.title", "Quick Glance"));

        var host = new Grid { Padding = new Thickness(24), MinHeight = 480 };
        host.Children.Add(column);
        return new ScrollViewer
        {
            Content = host,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
        };
    }

    private Grid BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("glance.error", "Couldn't load your vehicle"),
            ActionText = _localizer.GetString("glance.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;

        var host = new Grid { Padding = new Thickness(24), MinHeight = 480 };
        host.Children.Add(error);
        return host;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = "\uE83F", // Battery (web EmptyState icon)
        Message = _viewModel.Display.NoVehicleMessage,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Success card ─────────────────────────────────────────────────────

    private StackPanel BuildSuccess(GlanceDisplay display)
    {
        var column = new StackPanel { Spacing = 24, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(BuildHeader(display));
        column.Children.Add(BuildGauge(display));
        column.Children.Add(BuildMetrics(display));
        column.Children.Add(BuildQuickActions(display));
        column.Children.Add(BuildFreshness());
        column.Children.Add(BuildOpenApp(display));
        return column;
    }

    private static StackPanel BuildHeader(GlanceDisplay display)
    {
        var column = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };

        var name = new Heading
        {
            Value = display.VehicleName,
            HorizontalAlignment = HorizontalAlignment.Center,
            HorizontalContentAlignment = HorizontalAlignment.Center,
        };
        column.Children.Add(name);

        var badge = new TsBadge
        {
            Status = display.StatusKind,
            Dot = true,
            Content = display.StatusText,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.StatusText);
        column.Children.Add(badge);

        return column;
    }

    // The battery RadialGauge — a native ring (the same ChartShapes/ChartGeometry primitives the W3 TsRadialGauge
    // is built from) tinted by the web batteryColor threshold (green>50, amber>20, red otherwise) via the semantic
    // status brush, with the state-of-charge centred and the "Battery" caption beneath (web RadialGauge label).
    private static StackPanel BuildGauge(GlanceDisplay display)
    {
        var column = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };

        double radius = (GaugeSize - StrokeWidth) / 2;
        var center = new PointD(GaugeSize / 2, GaugeSize / 2);

        var canvas = new Canvas { Width = GaugeSize, Height = GaugeSize };
        AutomationProperties.SetAccessibilityView(canvas, AccessibilityView.Raw);

        // Track (full faint ring).
        canvas.Children.Add(ChartShapes.ArcPath(ChartGeometry.RingArc(center, radius, 0.9999), ChartBrushes.Border, StrokeWidth));

        // Value arc, tinted by the battery threshold status (web batteryColor); absent when there's no reading.
        double fraction = ChartGeometry.GaugeFraction(display.BatteryValue, display.BatteryMax);
        if (display.HasBatteryReading && fraction > 0)
        {
            canvas.Children.Add(ChartShapes.ArcPath(
                ChartGeometry.RingArc(center, radius, fraction),
                ChartBrushes.ForStatus(display.BatteryStatus),
                StrokeWidth));
        }

        var value = new TextBlock
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            FontSize = 36,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
        };
        value.Inlines.Add(new Run { Text = display.BatteryValueText });
        value.Inlines.Add(new Run
        {
            Text = display.BatteryUnit,
            FontSize = 18,
            FontWeight = FontWeights.Normal,
            Foreground = DisplayTokens.TextSecondary,
        });
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);

        var centerHost = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        centerHost.Children.Add(value);

        var ring = new Grid { Width = GaugeSize, Height = GaugeSize };
        ring.Children.Add(canvas);
        ring.Children.Add(centerHost);
        AutomationProperties.SetName(ring, display.GaugeAutomationName);
        column.Children.Add(ring);

        column.Children.Add(new Caption
        {
            Value = display.BatteryLabel,
            HorizontalAlignment = HorizontalAlignment.Center,
            HorizontalContentAlignment = HorizontalAlignment.Center,
        });

        return column;
    }

    private static Grid BuildMetrics(GlanceDisplay display)
    {
        var grid = new Grid
        {
            ColumnSpacing = 12,
            RowSpacing = 12,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        AddMetric(grid, display.Range, 0, 0);
        AddMetric(grid, display.Interior, 0, 1);
        AddMetric(grid, display.Security, 1, 0);
        AddMetric(grid, display.Location, 1, 1);
        return grid;
    }

    private static void AddMetric(Grid grid, GlanceMetric metric, int row, int column)
    {
        var card = new TsMetricCard
        {
            Label = metric.Label,
            Value = metric.Value,
            AccentBrushKey = metric.AccentBrushKey,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(card, $"{metric.Label}: {metric.Value}");
        Grid.SetRow(card, row);
        Grid.SetColumn(card, column);
        grid.Children.Add(card);
    }

    private StackPanel BuildQuickActions(GlanceDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        foreach (var action in display.QuickActions)
        {
            row.Children.Add(BuildQuickAction(action));
        }

        return row;
    }

    private TsButton BuildQuickAction(GlanceQuickAction action)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Medium,
            IconGlyph = action.Glyph,
            Text = action.Label,
            IsLoading = action.IsLoading,
            IsEnabled = !action.Disabled,
        };
        AutomationProperties.SetName(button, action.Label);

        string command = action.Command;
        button.Click += (_, _) => _ = _viewModel.SendCommandAsync(command);
        return button;
    }

    private TsDataFreshness BuildFreshness() => new()
    {
        UpdatedAt = _viewModel.UpdatedAt,
        IsFetching = _viewModel.IsFetching,
        IsError = _viewModel.IsError,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    private TsButton BuildOpenApp(GlanceDisplay display)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = display.OpenAppLabel,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(button, display.OpenAppLabel);
        button.Click += (_, _) => NavigationRequested?.Invoke(this, string.Empty);
        return button;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();
}
