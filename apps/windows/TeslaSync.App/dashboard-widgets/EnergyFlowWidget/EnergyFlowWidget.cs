using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
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
/// The native WinUI 3 Energy Flow dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/EnergyFlowWidget.tsx. It mirrors the web <c>WidgetShell</c> (a skeleton
/// while loading, a retry surface on error, otherwise a "⚡ Energy Flow" freshness header) wrapping the live
/// power-flow body: a battery node (left) and a motor node (right, labelled Consuming / Regenerating / Standby
/// by the sign of <c>power</c>), plus a charger node (top) while charging, joined by directional arrows whose
/// thickness tracks magnitude and whose active flow marches as animated dashes. When the response carries no
/// state the surface renders a friendly "No energy data available" empty state (the web
/// <c>{state ? &lt;WidgetFlowDiagram/&gt; : &lt;EmptyState/&gt;}</c> gate). All data flows through the shared
/// <see cref="EnergyFlowViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class EnergyFlowWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    // The diagram view-box colours the web renders as Tailwind white/opacity utility classes.
    private const string NodeFillHex = "#0DFFFFFF";   // fill-white/5
    private const string NodeStrokeHex = "#33FFFFFF"; // stroke-white/20
    private const string NodeLabelHex = "#99FFFFFF";  // fill-white/60

    // Marching-ants cadence: the web animates stroke-dashoffset 0 → -12 over 0.8s, looping.
    private const double DashCycleUnits = 12;
    private const double DashPeriodSeconds = 0.8;
    private const int DashTickMs = 33;

    private readonly EnergyFlowViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly EnergyFlowDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ContentControl _bodyHost = new()
    {
        HorizontalContentAlignment = HorizontalAlignment.Stretch,
        VerticalContentAlignment = VerticalAlignment.Stretch,
    };

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

    private readonly List<Line> _activeArrows = new();
    private readonly DispatcherTimer _dashTimer = new() { Interval = TimeSpan.FromMilliseconds(DashTickMs) };
    private double _dashPhase;

    private EnergyFlowSize _size;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public EnergyFlowWidget(
        IEnergyFlowSource source,
        ILocalizer localizer,
        EnergyFlowSize size,
        EnergyFlowDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new EnergyFlowDiagnostics();
        _viewModel = new EnergyFlowViewModel(source, localizer);
        _size = EnergyFlowRegistration.Clamp(size);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _dashTimer.Tick += OnDashTick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical registry id this surface registers under (<c>energy-flow</c>).</summary>
    public static string RegistryId => EnergyFlowRegistration.Id;

    /// <summary>The widget footprint (clamped to the registry bounds). The diagram scales to fill any footprint.</summary>
    public EnergyFlowSize WidgetSize
    {
        get => _size;
        set => _size = EnergyFlowRegistration.Clamp(value);
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="EnergyFlowSource"/> from the shared data
    /// layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static EnergyFlowWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        EnergyFlowSize? size = null,
        long? vehicleId = null,
        EnergyFlowDiagnostics? diagnostics = null)
    {
        var source = new EnergyFlowSource(vehicles, api, engine, options, vehicleId);
        return new EnergyFlowWidget(source, localizer, size ?? EnergyFlowRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = EnergyFlowProjection.ActivityGlyph,
            FontSize = 14,
            Foreground = DisplayPrimitives.HexBrush(EnergyFlowProjection.CyanHex),
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
        _refresh.Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.energyFlow.refresh", "Refresh energy flow"));
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

    /// <summary>Detach from the view-model, stop the dash animation and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _dashTimer.Stop();
        _dashTimer.Tick -= OnDashTick;
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
            case EnergyFlowState.Loading:
                StopDashAnimation();
                Content = BuildLoading();
                break;

            case EnergyFlowState.Error:
                StopDashAnimation();
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
            StopDashAnimation();
            return BuildEmpty();
        }

        return BuildDiagram(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 24, BlockWidth = 120 });
        column.Children.Add(new TsSkeleton { BlockHeight = 90 });
        column.Children.Add(new TsSkeleton { BlockHeight = 14, BlockWidth = 80 });

        AutomationProperties.SetName(column, _localizer.GetString("widget.energyFlow.loading", "Loading energy flow"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.energyFlow.error", "Couldn't load energy flow"),
            ActionText = _localizer.GetString("widget.energyFlow.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = EnergyFlowProjection.ActivityGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Flow diagram (web WidgetFlowDiagram) — a 100×100 view-box scaled to fill with a Viewbox ──
    private Viewbox BuildDiagram(EnergyFlowDisplay display)
    {
        _activeArrows.Clear();

        var canvas = new Canvas { Width = EnergyFlowGeometry.ViewBox, Height = EnergyFlowGeometry.ViewBox };
        AutomationProperties.SetName(canvas, display.DiagramAutomationName);

        var nodeById = new Dictionary<string, EnergyFlowNode>(StringComparer.Ordinal);
        foreach (var node in display.Nodes)
        {
            nodeById[node.Id] = node;
        }

        double maxArrowValue = EnergyFlowGeometry.MaxArrowValue(display.Arrows);
        foreach (var arrow in display.Arrows)
        {
            if (!nodeById.TryGetValue(arrow.FromId, out var from) || !nodeById.TryGetValue(arrow.ToId, out var to))
            {
                continue;
            }

            canvas.Children.Add(BuildArrow(arrow, from, to, maxArrowValue));
        }

        foreach (var node in display.Nodes)
        {
            AddNode(canvas, node);
        }

        StartOrStopDashAnimation();

        return new Viewbox
        {
            Stretch = Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Child = canvas,
        };
    }

    private Line BuildArrow(EnergyFlowArrow arrow, EnergyFlowNode from, EnergyFlowNode to, double maxArrowValue)
    {
        var (x1, y1, x2, y2) = EnergyFlowGeometry.ArrowEndpoints(from.Position, to.Position, EnergyFlowGeometry.NodeRadius);
        double thickness = EnergyFlowGeometry.StrokeForValue(arrow.Value, maxArrowValue);

        var line = new Line
        {
            X1 = x1,
            Y1 = y1,
            X2 = x2,
            Y2 = y2,
            Stroke = DisplayPrimitives.HexBrush(arrow.ColorHex),
            StrokeThickness = thickness,
            StrokeStartLineCap = PenLineCap.Round,
            StrokeEndLineCap = PenLineCap.Round,
            StrokeDashCap = PenLineCap.Round,
        };
        AutomationProperties.SetAccessibilityView(line, AccessibilityView.Raw);

        if (arrow.Active)
        {
            // WinUI dash array / offset are in multiples of stroke thickness; convert the web's "4 8" + the
            // -12 marching offset (both in view-box units) accordingly so the cadence matches across widths.
            line.StrokeDashArray = new DoubleCollection { 4.0 / thickness, 8.0 / thickness };
            _activeArrows.Add(line);
        }

        return line;
    }

    private static void AddNode(Canvas canvas, EnergyFlowNode node)
    {
        const double r = EnergyFlowGeometry.NodeRadius;
        var (cx, cy) = EnergyFlowGeometry.Coords(node.Position);

        var circle = new Ellipse
        {
            Width = r * 2,
            Height = r * 2,
            Fill = DisplayPrimitives.HexBrush(NodeFillHex),
            Stroke = DisplayPrimitives.HexBrush(NodeStrokeHex),
            StrokeThickness = 0.5,
        };
        AutomationProperties.SetAccessibilityView(circle, AccessibilityView.Raw);
        Canvas.SetLeft(circle, cx - r);
        Canvas.SetTop(circle, cy - r);
        canvas.Children.Add(circle);

        var content = new StackPanel
        {
            Spacing = 0.5,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        content.Children.Add(new FontIcon
        {
            Glyph = node.Glyph,
            FontSize = 6,
            Foreground = DisplayPrimitives.HexBrush(node.IconColorHex),
        });
        content.Children.Add(new TextBlock
        {
            Text = ScalarFormatters.FormatNumber(node.Value, EnergyFlowProjection.PowerPrecision),
            FontSize = 5,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var contentHost = new Grid { Width = r * 2, Height = r * 2 };
        contentHost.Children.Add(content);
        AutomationProperties.SetName(contentHost, node.AutomationName);
        Canvas.SetLeft(contentHost, cx - r);
        Canvas.SetTop(contentHost, cy - r);
        canvas.Children.Add(contentHost);

        const double labelWidth = 60;
        var label = new TextBlock
        {
            Text = node.Label,
            FontSize = 4,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayPrimitives.HexBrush(NodeLabelHex),
            Width = labelWidth,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.NoWrap,
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
        Canvas.SetLeft(label, cx - (labelWidth / 2));
        Canvas.SetTop(label, node.Position == FlowNodePosition.Bottom ? cy + r + 2 : cy - r - 6);
        canvas.Children.Add(label);
    }

    private void StartOrStopDashAnimation()
    {
        if (_activeArrows.Count > 0 && !MotionPreference.ReduceMotion)
        {
            ApplyDashOffset();
            if (!_dashTimer.IsEnabled)
            {
                _dashTimer.Start();
            }
        }
        else
        {
            StopDashAnimation();
        }
    }

    private void StopDashAnimation()
    {
        if (_dashTimer.IsEnabled)
        {
            _dashTimer.Stop();
        }
    }

    private void OnDashTick(object? sender, object e)
    {
        double step = DashCycleUnits * DashTickMs / 1000.0 / DashPeriodSeconds;
        _dashPhase = (_dashPhase + step) % DashCycleUnits;
        ApplyDashOffset();
    }

    private void ApplyDashOffset()
    {
        foreach (var line in _activeArrows)
        {
            double thickness = line.StrokeThickness <= 0 ? 1 : line.StrokeThickness;
            line.StrokeDashOffset = -_dashPhase / thickness;
        }
    }
}
