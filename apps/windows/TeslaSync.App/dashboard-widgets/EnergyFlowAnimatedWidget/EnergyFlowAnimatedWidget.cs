using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Energy Flow Animated dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/EnergyFlowAnimatedWidget.tsx. It mirrors the web <c>WidgetShell</c> (a
/// skeleton while loading, a retry surface on error, otherwise a "⚡ Energy Flow" freshness header) wrapping the
/// energy-flow body: at &lt; 2 columns the compact fallback (the battery percent plus one coloured row per live
/// flow — charger / drive / regen — or an "Idle" label), otherwise the animated flow diagram (battery, drive
/// and charger nodes wired by battery→drive / drive→battery / charger→battery arrows whose dashes animate while
/// the flow is live). When the response carries no state the surface renders a friendly "No energy data
/// available" empty state (the web <c>{state ? … : &lt;EmptyState&gt;}</c> gate). All data flows through the
/// shared <see cref="EnergyFlowAnimatedViewModel"/>; the view never performs HTTP. Every string resolves
/// through the i18n facade and the diagram and its controls carry Narrator names; the flow animation honours
/// the system reduce-motion preference.
/// </summary>
public sealed partial class EnergyFlowAnimatedWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    // The flow diagram renders into a fixed coordinate space (the web 100×100 viewBox) plus a symmetric
    // margin so node circles and labels near the edges never clip when the Viewbox scales the canvas.
    private const double DiagramMargin = 12;
    private const double DiagramExtent = EnergyFlowGeometry.ViewExtent + (DiagramMargin * 2);

    private readonly EnergyFlowAnimatedViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly EnergyFlowAnimatedDiagnostics _diagnostics;
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
    public EnergyFlowAnimatedWidget(
        IEnergyFlowAnimatedSource source,
        ILocalizer localizer,
        EnergyFlowSize size,
        EnergyFlowAnimatedDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new EnergyFlowAnimatedDiagnostics();
        _viewModel = new EnergyFlowAnimatedViewModel(source, localizer, size);
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

    /// <summary>The canonical registry id this surface registers under (<c>energy-flow-animated</c>).</summary>
    public static string RegistryId => EnergyFlowAnimatedRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the flow view for the new layout.</summary>
    public EnergyFlowSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="EnergyFlowAnimatedSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle
    /// unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static EnergyFlowAnimatedWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        EnergyFlowSize? size = null,
        long? vehicleId = null,
        EnergyFlowAnimatedDiagnostics? diagnostics = null)
    {
        var source = new EnergyFlowAnimatedSource(vehicles, api, engine, options, vehicleId);
        return new EnergyFlowAnimatedWidget(source, localizer, size ?? EnergyFlowAnimatedRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = EnergyFlowProjection.ZapGlyph,
            FontSize = 14,
            Foreground = StatusBrush(StatusKind.Info),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;
        _titleText.Text = _viewModel.Title;

        _titleRow.Children.Add(icon);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.energyFlowAnimated.refresh", "Refresh energy flow"));
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
            case EnergyFlowState.Loading:
                Content = BuildLoading();
                break;

            case EnergyFlowState.Error:
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
        // Web parity: EnergyFlowAnimatedWidget always passes a title to WidgetShell (no title-less compact mode).
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
            return BuildEmpty();
        }

        return display.IsCompact ? BuildCompact(display) : BuildFlowDiagram(display, _viewModel.EmptyMessage);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 24, BlockWidth = 120 });
        column.Children.Add(new TsSkeleton { BlockHeight = 80 });
        column.Children.Add(new TsSkeleton { BlockHeight = 18 });

        AutomationProperties.SetName(column, _localizer.GetString("widget.energyFlowAnimated.loading", "Loading energy flow"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.energyFlowAnimated.error", "Couldn't load energy flow"),
            ActionText = _localizer.GetString("widget.energyFlowAnimated.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = EnergyFlowProjection.ZapGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Compact fallback (web CompactView) ──
    private static StackPanel BuildCompact(EnergyFlowDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 6,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(new TextBlock
        {
            Text = display.BatteryPercentText,
            FontSize = 20,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        foreach (var line in display.CompactLines)
        {
            column.Children.Add(BuildCompactLine(line));
        }

        if (display.IsIdle)
        {
            column.Children.Add(new TextBlock
            {
                Text = display.IdleText,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    private static StackPanel BuildCompactLine(EnergyFlowCompactLine line)
    {
        var accent = StatusBrush(line.Color);
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var glyph = new FontIcon { Glyph = line.Glyph, FontSize = 12, Foreground = accent };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        row.Children.Add(glyph);
        row.Children.Add(new TextBlock
        {
            Text = line.Value,
            FontSize = 12,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        });

        AutomationProperties.SetName(row, line.AutomationName);
        return row;
    }

    // ── Animated flow diagram (web WidgetFlowDiagram) ──
    private static UIElement BuildFlowDiagram(EnergyFlowDisplay display, string emptyMessage)
    {
        if (display.Nodes.Count == 0)
        {
            return new TsEmptyState
            {
                IconGlyph = EnergyFlowProjection.ZapGlyph,
                Message = emptyMessage,
                VerticalAlignment = VerticalAlignment.Center,
            };
        }

        var canvas = new Canvas { Width = DiagramExtent, Height = DiagramExtent };
        double maxArrow = EnergyFlowGeometry.MaxArrowValue(display.Arrows);
        var nodeById = new Dictionary<string, EnergyFlowNode>(StringComparer.Ordinal);
        foreach (var node in display.Nodes)
        {
            nodeById[node.Id] = node;
        }

        // Arrows render beneath the nodes (web draws lines first, then node circles).
        foreach (var arrow in display.Arrows)
        {
            if (!nodeById.TryGetValue(arrow.From, out var from) || !nodeById.TryGetValue(arrow.To, out var to))
            {
                continue;
            }

            canvas.Children.Add(BuildArrow(arrow, from, to, maxArrow));
        }

        foreach (var node in display.Nodes)
        {
            AddNode(canvas, node);
        }

        var viewbox = new Viewbox
        {
            Child = canvas,
            Stretch = Stretch.Uniform,
            StretchDirection = StretchDirection.Both,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(viewbox, display.AutomationName);
        return viewbox;
    }

    private static Line BuildArrow(EnergyFlowArrow arrow, EnergyFlowNode from, EnergyFlowNode to, double maxArrow)
    {
        var p1 = EnergyFlowGeometry.Coord(from.Position);
        var p2 = EnergyFlowGeometry.Coord(to.Position);
        var seg = EnergyFlowGeometry.Segment(p1, p2, EnergyFlowGeometry.NodeRadius);
        double thickness = EnergyFlowGeometry.StrokeForValue(arrow.Value, maxArrow);

        var line = new Line
        {
            X1 = seg.X1 + DiagramMargin,
            Y1 = seg.Y1 + DiagramMargin,
            X2 = seg.X2 + DiagramMargin,
            Y2 = seg.Y2 + DiagramMargin,
            Stroke = StatusBrush(arrow.Color),
            StrokeThickness = thickness,
            StrokeStartLineCap = PenLineCap.Round,
            StrokeEndLineCap = PenLineCap.Round,
        };

        if (arrow.Active)
        {
            // Web parity: active flows render a moving dash ("flow-active" keyframes); inactive flows are solid.
            line.StrokeDashCap = PenLineCap.Round;
            line.StrokeDashArray = new DoubleCollection { 4, 6 };
            if (!MotionPreference.ReduceMotion)
            {
                AttachFlowAnimation(line);
            }
        }

        AutomationProperties.SetAccessibilityView(line, AccessibilityView.Raw);
        return line;
    }

    private static void AddNode(Canvas canvas, EnergyFlowNode node)
    {
        var p = EnergyFlowGeometry.Coord(node.Position);
        const double r = EnergyFlowGeometry.NodeRadius;

        var circle = new Ellipse
        {
            Width = r * 2,
            Height = r * 2,
            Fill = NodeFill(),
            Stroke = DisplayTokens.Border,
            StrokeThickness = 0.5,
        };
        Canvas.SetLeft(circle, p.X - r + DiagramMargin);
        Canvas.SetTop(circle, p.Y - r + DiagramMargin);
        AutomationProperties.SetAccessibilityView(circle, AccessibilityView.Raw);
        canvas.Children.Add(circle);

        var stack = new StackPanel
        {
            Spacing = 0,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        stack.Children.Add(new FontIcon
        {
            Glyph = node.Glyph,
            FontSize = 7,
            Foreground = DisplayTokens.TextPrimary,
        });
        stack.Children.Add(new TextBlock
        {
            Text = ScalarFormatters.FormatNumber(node.Value, EnergyFlowProjection.PowerPrecision),
            FontSize = 5,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var content = new Grid { Width = r * 2, Height = r * 2 };
        content.Children.Add(stack);
        Canvas.SetLeft(content, p.X - r + DiagramMargin);
        Canvas.SetTop(content, p.Y - r + DiagramMargin);
        AutomationProperties.SetName(content, node.AutomationName);
        canvas.Children.Add(content);

        // Web parity: labels sit above left/right nodes; top/bottom labels sit below to stay in the viewBox.
        const double labelHalfWidth = 22;
        bool below = node.Position is EnergyFlowPosition.Top or EnergyFlowPosition.Bottom;
        double labelY = below ? p.Y + r + 3 : p.Y - r - 6;

        var labelHost = new Grid { Width = labelHalfWidth * 2 };
        labelHost.Children.Add(new TextBlock
        {
            Text = node.Label,
            FontSize = 4.5,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextMuted,
            TextAlignment = TextAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        });
        Canvas.SetLeft(labelHost, p.X - labelHalfWidth + DiagramMargin);
        Canvas.SetTop(labelHost, labelY + DiagramMargin);
        AutomationProperties.SetAccessibilityView(labelHost, AccessibilityView.Raw);
        canvas.Children.Add(labelHost);
    }

    private static void AttachFlowAnimation(Line line)
    {
        var animation = new DoubleAnimation
        {
            From = 0,
            To = -12,
            Duration = new Duration(TimeSpan.FromMilliseconds(800)),
            RepeatBehavior = RepeatBehavior.Forever,
            EnableDependentAnimation = true,
        };

        Storyboard.SetTarget(animation, line);
        Storyboard.SetTargetProperty(animation, "(Shape.StrokeDashOffset)");

        var storyboard = new Storyboard();
        storyboard.Children.Add(animation);

        if (line.IsLoaded)
        {
            storyboard.Begin();
        }
        else
        {
            line.Loaded += (_, _) => storyboard.Begin();
        }
    }

    private static Brush NodeFill()
    {
        var surface = DisplayTokens.Surface;
        if (surface is SolidColorBrush solid)
        {
            return new SolidColorBrush(solid.Color) { Opacity = 0.45 };
        }

        return surface;
    }

    private static Brush StatusBrush(StatusKind kind) =>
        DisplayTokens.Brush(StatusResources.AccentBrushKey(kind));

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
