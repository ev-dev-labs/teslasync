using System.Globalization;
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
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Regen Braking dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a full-area skeleton while loading, a retry surface on error, otherwise — only when not compact — the
/// "Regen Braking" title row with a help tooltip, plus an overlaid freshness chip) wrapping the web
/// <c>WidgetGaugeHero</c>: a radial recovery gauge whose value arc is tinted by the web <c>regenColor</c>
/// threshold (green&gt;30, amber&gt;15, red otherwise), the "%" caption beneath it, the centred "recovery" unit,
/// and — only when not compact — a centred row of Total Recovered / Monthly Avg / Free Charges stats. When no
/// vehicle resolves the surface renders a friendly "No regen data" empty state (the web
/// <c>{data ? gauge : &lt;EmptyState&gt;}</c> gate). All data flows through the shared
/// <see cref="RegenEfficiencyViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class RegenEfficiencyWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double StrokeWidth = 8;          // web STROKE_WIDTH (gauge value arc)

    private readonly RegenEfficiencyViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly RegenEfficiencyDiagnostics _diagnostics;
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
    private readonly TsHelpTooltip _help = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();
    private readonly ScrollViewer _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, units and diagnostics.</summary>
    public RegenEfficiencyWidget(
        IRegenEfficiencySource source,
        ILocalizer localizer,
        RegenEfficiencySize size,
        UnitPref? units = null,
        RegenEfficiencyDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new RegenEfficiencyDiagnostics();
        _viewModel = new RegenEfficiencyViewModel(source, localizer, size, units);
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

    /// <summary>The canonical registry id this surface registers under (<c>regen-efficiency</c>).</summary>
    public static string RegistryId => RegenEfficiencyRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the gauge for the new layout.</summary>
    public RegenEfficiencySize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the stats in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="RegenEfficiencySource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static RegenEfficiencyWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        RegenEfficiencySize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        RegenEfficiencyDiagnostics? diagnostics = null)
    {
        var source = new RegenEfficiencySource(vehicles, api, engine, options, vehicleId);
        return new RegenEfficiencyWidget(
            source, localizer, size ?? RegenEfficiencyRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = RegenEfficiencyProjection.HeaderGlyph,
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

        // Web parity: WidgetShell renders the help "?" tooltip next to the title only when a title is visible.
        _help.Hint = _viewModel.HelpText;
        _help.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(icon);
        _titleRow.Children.Add(_titleText);
        _titleRow.Children.Add(_help);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.regenEfficiency.refresh", "Refresh regen data"));
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
            case RegenEfficiencyState.Loading:
                Content = BuildLoading();
                break;

            case RegenEfficiencyState.Error:
                Content = BuildError();
                break;

            case RegenEfficiencyState.Empty:
                UpdateHeader();
                _bodyHost.Content = BuildEmpty();
                Content = _root;
                break;

            default:
                UpdateHeader();
                _bodyHost.Content = _viewModel.Display is { } display ? BuildBody(display) : BuildEmpty();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        // Web parity: WidgetShell renders the title (icon + caption + help) only when !isCompact; the
        // freshness/refresh actions stay pinned top-right in every layout.
        _titleRow.Visibility = _viewModel.Size.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _help.Hint = _viewModel.HelpText;
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private static StackPanel BuildBody(RegenEfficiencyDisplay display)
    {
        // Web WidgetGaugeHero: flex flex-col items-center justify-center gap-2 — gauge, then (when !compact) stats.
        var outer = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Center,
        };

        outer.Children.Add(BuildGaugeColumn(display));

        if (display.ShowStats && display.Stats.Count > 0)
        {
            outer.Children.Add(BuildStats(display.Stats));
        }

        return outer;
    }

    private static StackPanel BuildGaugeColumn(RegenEfficiencyDisplay display)
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

        // Web parity: RadialGauge renders the `label` (the "%" caption) beneath the ring.
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

    private static Grid BuildRing(RegenEfficiencyDisplay display)
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

        // Value arc, tinted by the recovery threshold status (web regenColor).
        double fraction = ChartGeometry.GaugeFraction(display.GaugeValue, display.GaugeMax);
        if (fraction > 0)
        {
            canvas.Children.Add(ChartShapes.ArcPath(
                ChartGeometry.RingArc(center, radius, fraction),
                ChartBrushes.ForStatus(display.Status),
                StrokeWidth));
        }

        // Centre: the clamped value with the small "recovery" unit beneath it (web RadialGauge value + unit span).
        var value = new TextBlock
        {
            Text = display.GaugeValueText,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            FontSize = display.IsCompact ? 18 : 22,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
        };
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);

        var unit = new TextBlock
        {
            Text = display.GaugeUnit,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            MaxWidth = size - (StrokeWidth * 2),
            FontSize = 9,
            Foreground = DisplayTokens.TextSecondary,
        };
        AutomationProperties.SetAccessibilityView(unit, AccessibilityView.Raw);

        var centerHost = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        centerHost.Children.Add(value);
        centerHost.Children.Add(unit);

        var ring = new Grid { Width = size, Height = size };
        ring.Children.Add(canvas);
        ring.Children.Add(centerHost);
        return ring;
    }

    private static StackPanel BuildStats(IReadOnlyList<RegenEfficiencyStat> stats)
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

    private static StackPanel BuildStatTile(RegenEfficiencyStat stat)
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

        var value = new TextBlock
        {
            Text = stat.ValueText,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);

        var tile = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };
        tile.Children.Add(label);
        tile.Children.Add(value);
        AutomationProperties.SetName(tile, stat.AutomationName);
        return tile;
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

        AutomationProperties.SetName(skeleton, _localizer.GetString("widget.regenEfficiency.loading", "Loading regen data"));
        LiveRegion.Configure(skeleton);
        LiveRegion.Announce(skeleton);
        return skeleton;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.regenEfficiency.error", "Couldn't load regen data"),
            ActionText = _localizer.GetString("widget.regenEfficiency.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = RegenEfficiencyProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
