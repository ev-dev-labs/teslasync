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
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Motor Performance dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/MotorPerformanceWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a full-area skeleton while loading, a retry surface on error, otherwise — when not compact — the
/// "Motor Performance" title row with a lightning icon and an overlaid freshness chip) wrapping two layouts the
/// web branches between on <c>isCompact = size.cols &lt;= 1</c>: the compact stacked Gear / Torque readout, and
/// the full layout — a radial torque gauge (value arc tinted by the web <c>torqueColor</c> threshold:
/// green&lt;200, amber&lt;400, red otherwise; centre shows |torque| Nm, caption shows the signed torque) above a
/// 2×2 grid of Stator Temp / Gear State / Lateral G / Longitudinal G stat cards. When the response carries no
/// motor object the surface renders a friendly "No motor data" empty state (the web <c>hasData</c> gate). All
/// data flows through the shared <see cref="MotorPerformanceViewModel"/>; the view never performs HTTP. Every
/// string resolves through the i18n facade and every readout carries a Narrator name.
/// </summary>
public sealed partial class MotorPerformanceWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double StrokeWidth = 8;          // web RadialGauge STROKE_WIDTH (gauge value arc)

    private readonly MotorPerformanceViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly MotorPerformanceDiagnostics _diagnostics;
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
    /// <param name="source">The cache-then-network motor source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata).</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public MotorPerformanceWidget(
        IMotorPerformanceSource source,
        ILocalizer localizer,
        MotorPerformanceSize size,
        UnitPref? units = null,
        MotorPerformanceDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new MotorPerformanceDiagnostics();
        _viewModel = new MotorPerformanceViewModel(source, localizer, size, units);
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

    /// <summary>The canonical registry id this surface registers under (<c>motor-performance</c>).</summary>
    public static string RegistryId => MotorPerformanceRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the readout for the new layout (compact ↔ full).</summary>
    public MotorPerformanceSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the stator temperature in the new unit.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="MotorPerformanceSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static MotorPerformanceWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        MotorPerformanceSize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        MotorPerformanceDiagnostics? diagnostics = null)
    {
        var source = new MotorPerformanceSource(vehicles, api, engine, options, vehicleId);
        return new MotorPerformanceWidget(
            source, localizer, size ?? MotorPerformanceRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = MotorPerformanceProjection.ZapGlyph,
            FontSize = 14,
            Foreground = AccentBrush(StatusKind.Warning), // web Zap icon: text-yellow-400
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        _titleText.Text = _viewModel.Title;
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.motorPerformance.refresh", "Refresh motor data"));
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
            case MotorPerformanceState.Loading:
                Content = BuildLoading();
                break;

            case MotorPerformanceState.Error:
                Content = BuildError();
                break;

            case MotorPerformanceState.Empty:
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
        // Web parity: the compact branch passes no title to WidgetShell — collapse the title row (icon + caption)
        // when compact; the freshness / refresh actions stay pinned top-right at every footprint.
        _titleRow.Visibility = _viewModel.Size.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private static UIElement BuildBody(MotorPerformanceDisplay display) =>
        display.IsCompact ? BuildCompactBody(display) : BuildFullBody(display);

    // Web compact: h-full flex flex-col items-center justify-center gap-1 min-h-[44px] — Gear caption + value,
    // Torque caption + value, stacked and centred.
    private static StackPanel BuildCompactBody(MotorPerformanceDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 2,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(CompactCaption(display.GearLabel));
        column.Children.Add(new TextBlock
        {
            Text = display.GearValue,
            FontSize = 18,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var torqueCaption = CompactCaption(display.TorqueLabel);
        torqueCaption.Margin = new Thickness(0, 4, 0, 0);
        column.Children.Add(torqueCaption);
        column.Children.Add(new TextBlock
        {
            Text = display.TorqueValueText,
            FontSize = 13,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        AutomationProperties.SetName(
            column,
            $"{display.GearLabel} {display.GearValue}, {display.TorqueLabel} {display.TorqueValueText}");
        return column;
    }

    private static TextBlock CompactCaption(string text) => new()
    {
        Text = text.ToUpper(CultureInfo.CurrentCulture),
        FontSize = 10,
        Foreground = DisplayTokens.TextMuted,
        CharacterSpacing = 80,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    // Web full: flex flex-col items-center gap-3 — the radial gauge above the 2×2 StatCard grid.
    private static ScrollViewer BuildFullBody(MotorPerformanceDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(BuildGaugeColumn(display));
        column.Children.Add(BuildStatGrid(display.Stats));

        return new ScrollViewer
        {
            Content = column,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalAlignment = VerticalAlignment.Center,
            Padding = new Thickness(0, 8, 0, 0),
        };
    }

    private static StackPanel BuildGaugeColumn(MotorPerformanceDisplay display)
    {
        // Web RadialGauge: inline-flex flex-col items-center gap-1 — the ring then the caption (signed torque).
        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(BuildRing(display));

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
        return column;
    }

    private static Grid BuildRing(MotorPerformanceDisplay display)
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

        // Value arc, tinted by the torque threshold status (web torqueColor).
        double fraction = ChartGeometry.GaugeFraction(display.GaugeValue, display.GaugeMax);
        if (fraction > 0)
        {
            canvas.Children.Add(ChartShapes.ArcPath(
                ChartGeometry.RingArc(center, radius, fraction),
                ChartBrushes.ForStatus(display.GaugeStatus),
                StrokeWidth));
        }

        var value = new TextBlock
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            FontSize = 18,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
        };
        value.Inlines.Add(new Run { Text = display.GaugeValueText });
        if (!string.IsNullOrEmpty(display.GaugeUnit))
        {
            value.Inlines.Add(new Run
            {
                Text = display.GaugeUnit,
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
        AutomationProperties.SetName(ring, display.GaugeAutomationName);
        return ring;
    }

    // Web: grid grid-cols-2 gap-3 w-full — four StatCards (Stator Temp, Gear State, Lateral G, Longitudinal G).
    private static Grid BuildStatGrid(IReadOnlyList<MotorStatTile> stats)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12, HorizontalAlignment = HorizontalAlignment.Stretch };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        for (var i = 0; i < stats.Count; i++)
        {
            var tile = stats[i];
            var card = new TsStatCard
            {
                Label = tile.Label,
                Value = tile.ValueText,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            AutomationProperties.SetName(card, tile.AutomationName);
            Grid.SetRow(card, i / 2);
            Grid.SetColumn(card, i % 2);
            grid.Children.Add(card);
        }

        return grid;
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

        AutomationProperties.SetName(skeleton, _localizer.GetString("widget.motorPerformance.loading", "Loading motor data"));
        return skeleton;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.motorPerformance.error", "Couldn't load motor data"),
            ActionText = _localizer.GetString("widget.motorPerformance.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = MotorPerformanceProjection.ZapGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Brush AccentBrush(StatusKind kind) => DisplayTokens.Brush(StatusResources.AccentBrushKey(kind));

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
