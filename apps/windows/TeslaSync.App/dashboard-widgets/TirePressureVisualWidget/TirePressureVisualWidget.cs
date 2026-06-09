using System.Globalization;
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
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Tire Pressure Visual dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/TirePressureVisualWidget.tsx. It mirrors the web <c>WidgetShell</c> used
/// with a title (a full-area skeleton while loading, a retry surface on error, otherwise the "◌ Tire Pressure"
/// freshness header above the body): when a tire-pressure object resolves, a top-down car diagram with four
/// colour-coded tire indicators flanked by the FL / RL and FR / RR pressure readings, plus a footer carrying the
/// overall status badge ("All Normal" / "Check Pressure") and the unit suffix · most-recent-reading time; when the
/// response carries no tire object, a friendly "No tire pressure data" empty state (the web
/// <c>{tireData ? … : &lt;EmptyState&gt;}</c> gate). All data flows through the shared
/// <see cref="TirePressureVisualViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class TirePressureVisualWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    // Web CarDiagram SVG viewBox 0 0 120 180 and the corner / body geometry (px in that viewBox).
    private const double DiagramWidth = 120;
    private const double DiagramHeight = 180;
    private const double DiagramMaxHeight = 140; // web max-h-[140px]
    private const double TireWidth = 16;
    private const double TireHeight = 26;
    private const double TireRadius = 4;
    private const double TireFillOpacity = 0.85;

    private readonly TirePressureVisualViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly TirePressureVisualDiagnostics _diagnostics;
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

    /// <summary>Creates the surface over its data source, localizer, footprint, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network tire-pressure source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata).</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public TirePressureVisualWidget(
        ITirePressureVisualSource source,
        ILocalizer localizer,
        TirePressureVisualSize size,
        UnitPref? units = null,
        TirePressureVisualDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new TirePressureVisualDiagnostics();
        _viewModel = new TirePressureVisualViewModel(source, localizer, size, units);
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

    /// <summary>The canonical registry id this surface registers under (<c>tire-pressure-visual</c>).</summary>
    public static string RegistryId => TirePressureVisualRegistration.Id;

    /// <summary>The widget footprint (registry metadata; only the title row reacts to a compact width).</summary>
    public TirePressureVisualSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the corner pressures.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="TirePressureVisualSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static TirePressureVisualWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        TirePressureVisualSize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        TirePressureVisualDiagnostics? diagnostics = null)
    {
        var source = new TirePressureVisualSource(vehicles, api, engine, options, vehicleId);
        return new TirePressureVisualWidget(
            source, localizer, size ?? TirePressureVisualRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = TirePressureVisualProjection.CircleGlyph,
            FontSize = 14,
            Foreground = InfoBrush(),
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.tirePressureVisual.refresh", "Refresh tire pressure"));
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

        _header.Padding = new Thickness(16, 12, 12, 2);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(actions, 1);
        _header.Children.Add(_titleRow);
        _header.Children.Add(actions);

        _bodyHost.Padding = new Thickness(16, 4, 16, 12);
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
            case TirePressureVisualState.Loading:
                Content = BuildLoading();
                break;

            case TirePressureVisualState.Error:
                Content = BuildError();
                break;

            case TirePressureVisualState.Empty:
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
        // Web parity: WidgetShell title is `isCompact ? undefined : t('widget.tirePressure')` — collapse the
        // title row (icon + caption) when compact; the freshness / refresh actions stay pinned top-right.
        _titleRow.Visibility = _viewModel.Size.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    // ── Tire body (web tireData branch) ──
    private static Grid BuildBody(TirePressureDisplay display)
    {
        var body = new Grid { RowSpacing = 8 };
        body.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        body.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var diagramRow = BuildDiagramRow(display);
        Grid.SetRow(diagramRow, 0);
        body.Children.Add(diagramRow);

        var footer = BuildFooter(display);
        Grid.SetRow(footer, 1);
        body.Children.Add(footer);

        AutomationProperties.SetName(body, display.AutomationName);
        return body;
    }

    // Web parity: <div className="flex-1 flex items-center gap-3"> — FL/RL values, car diagram, FR/RR values.
    private static Grid BuildDiagramRow(TirePressureDisplay display)
    {
        var row = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = BuildValueColumn(display.FrontLeft, display.RearLeft, TextAlignment.Right, HorizontalAlignment.Right, display.UnitLabel);
        Grid.SetColumn(left, 0);
        row.Children.Add(left);

        var diagram = BuildDiagram(display);
        Grid.SetColumn(diagram, 1);
        row.Children.Add(diagram);

        var right = BuildValueColumn(display.FrontRight, display.RearRight, TextAlignment.Left, HorizontalAlignment.Left, display.UnitLabel);
        Grid.SetColumn(right, 2);
        row.Children.Add(right);

        return row;
    }

    // Web parity: a column with the front corner at the top and the rear corner at the bottom (justify-between).
    private static Grid BuildValueColumn(TirePressureCorner front, TirePressureCorner rear, TextAlignment align, HorizontalAlignment hAlign, string unitLabel)
    {
        var column = new Grid { MinWidth = 50, Padding = new Thickness(0, 8, 0, 8) };
        column.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        column.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        column.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var top = BuildValueBlock(front, align, hAlign, unitLabel);
        Grid.SetRow(top, 0);
        column.Children.Add(top);

        var bottom = BuildValueBlock(rear, align, hAlign, unitLabel);
        Grid.SetRow(bottom, 2);
        column.Children.Add(bottom);

        return column;
    }

    private static StackPanel BuildValueBlock(TirePressureCorner corner, TextAlignment align, HorizontalAlignment hAlign, string unitLabel)
    {
        var label = new TextBlock
        {
            Text = corner.Label.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            TextAlignment = align,
            HorizontalAlignment = hAlign,
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);

        var value = new TextBlock
        {
            Text = corner.ValueText,
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = AccentBrush(corner.Status),
            TextAlignment = align,
            HorizontalAlignment = hAlign,
        };
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);

        var block = new StackPanel { Spacing = 2 };
        block.Children.Add(label);
        block.Children.Add(value);
        AutomationProperties.SetName(block, $"{corner.Label} {corner.ValueText} {unitLabel}");
        return block;
    }

    // Web CarDiagram: a top-down silhouette (rounded body + windshield / rear-window hints) with four
    // status-tinted tire rectangles. Hosted in a Viewbox so the fixed 120×180 geometry scales like the SVG.
    private static Viewbox BuildDiagram(TirePressureDisplay display)
    {
        var canvas = new Canvas { Width = DiagramWidth, Height = DiagramHeight };

        var body = new Rectangle
        {
            Width = 60,
            Height = 148,
            RadiusX = 16,
            RadiusY = 16,
            Stroke = OutlineBrush(0.12),
            StrokeThickness = 1.5,
        };
        Canvas.SetLeft(body, 30);
        Canvas.SetTop(body, 16);
        canvas.Children.Add(body);

        canvas.Children.Add(HintLine(36, 52, 84, 52));   // windshield hint
        canvas.Children.Add(HintLine(36, 132, 84, 132)); // rear-window hint

        AddTire(canvas, display.FrontLeft, 14, 28);
        AddTire(canvas, display.FrontRight, 90, 28);
        AddTire(canvas, display.RearLeft, 14, 126);
        AddTire(canvas, display.RearRight, 90, 126);

        var viewbox = new Viewbox
        {
            Stretch = Stretch.Uniform,
            MaxHeight = DiagramMaxHeight,
            Child = canvas,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(viewbox, AccessibilityView.Raw);
        return viewbox;
    }

    private static void AddTire(Canvas canvas, TirePressureCorner corner, double x, double y)
    {
        var tire = new Rectangle
        {
            Width = TireWidth,
            Height = TireHeight,
            RadiusX = TireRadius,
            RadiusY = TireRadius,
            Fill = TireFill(corner.Status),
        };
        Canvas.SetLeft(tire, x);
        Canvas.SetTop(tire, y);
        canvas.Children.Add(tire);
    }

    private static Line HintLine(double x1, double y1, double x2, double y2) => new()
    {
        X1 = x1,
        Y1 = y1,
        X2 = x2,
        Y2 = y2,
        Stroke = OutlineBrush(0.08),
        StrokeThickness = 1,
    };

    // Web parity: <div className="flex items-center justify-between"> — status badge left, unit · time right.
    private static Grid BuildFooter(TirePressureDisplay display)
    {
        var footer = new Grid { ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var badge = new TsBadge
        {
            Status = display.BadgeStatus,
            Content = new TextBlock { Text = display.BadgeText, Foreground = AccentBrush(display.BadgeStatus) },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.BadgeText);
        Grid.SetColumn(badge, 0);
        footer.Children.Add(badge);

        var meta = new TextBlock
        {
            Text = display.FooterText,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        AutomationProperties.SetName(meta, display.FooterText);
        Grid.SetColumn(meta, 1);
        footer.Children.Add(meta);

        return footer;
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

        AutomationProperties.SetName(skeleton, _localizer.GetString("widget.tirePressureVisual.loading", "Loading tire pressure"));
        return skeleton;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.tirePressureVisual.error", "Couldn't load tire pressure"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = TirePressureVisualProjection.CircleGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Brush helpers (theme-token driven; opacity derived for the diagram tints) ──
    private static Brush AccentBrush(StatusKind kind) => DisplayTokens.Brush(StatusResources.AccentBrushKey(kind));

    private static Brush TireFill(StatusKind kind) => WithOpacity(AccentBrush(kind), TireFillOpacity);

    private static Brush OutlineBrush(double opacity) => WithOpacity(DisplayTokens.Border, opacity);

    private static Brush InfoBrush() => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Info));

    private static Brush WithOpacity(Brush source, double opacity) =>
        source is SolidColorBrush solid
            ? new SolidColorBrush(solid.Color) { Opacity = opacity }
            : new SolidColorBrush(Microsoft.UI.Colors.Transparent);

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
