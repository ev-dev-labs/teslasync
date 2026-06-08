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
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Drive Score Gauge dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/DriveScoreGaugeWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a full-area skeleton while loading, a retry surface on error, otherwise the "Drive Score" title row —
/// present only when not compact — with an overlaid freshness chip) wrapping the web <c>WidgetGaugeHero</c>:
/// a radial weekly-score gauge whose value arc is tinted by the web <c>scoreColor</c> threshold
/// (green&gt;=80, cyan&gt;=60, amber&gt;=40, red otherwise), the grade caption beneath it, a centred row of
/// efficiency / smoothness / speed-discipline stats (only when not compact), and — when tall (≥2 rows) — three
/// per-metric bars colour-coded by the same threshold. When no vehicle resolves the surface renders a friendly
/// "No score yet" empty state (the web <c>{score ? gauge : &lt;EmptyState&gt;}</c> gate). All data flows
/// through the shared <see cref="DriveScoreGaugeViewModel"/>; the view never performs HTTP. Every string
/// resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class DriveScoreGaugeWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double StrokeWidth = 8;          // web STROKE_WIDTH (gauge value arc)
    private const double BarHeight = 8;            // web MetricBar track h-2
    private const double BarRadius = 4;

    private readonly DriveScoreGaugeViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DriveScoreGaugeDiagnostics _diagnostics;
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
    private readonly ScrollViewer _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public DriveScoreGaugeWidget(
        IDriveScoreGaugeSource source,
        ILocalizer localizer,
        DriveScoreGaugeSize size,
        DriveScoreGaugeDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new DriveScoreGaugeDiagnostics();
        _viewModel = new DriveScoreGaugeViewModel(source, localizer, size);
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

    /// <summary>The canonical registry id this surface registers under (<c>drive-score-gauge</c>).</summary>
    public static string RegistryId => DriveScoreGaugeRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the gauge for the new layout.</summary>
    public DriveScoreGaugeSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="DriveScoreGaugeSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static DriveScoreGaugeWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        DriveScoreGaugeSize? size = null,
        long? vehicleId = null,
        DriveScoreGaugeDiagnostics? diagnostics = null)
    {
        var source = new DriveScoreGaugeSource(vehicles, api, engine, options, vehicleId);
        return new DriveScoreGaugeWidget(
            source, localizer, size ?? DriveScoreGaugeRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = DriveScoreGaugeProjection.HeaderGlyph,
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.driveScoreGauge.refresh", "Refresh drive score"));
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
            case DriveScoreGaugeState.Loading:
                Content = BuildLoading();
                break;

            case DriveScoreGaugeState.Error:
                Content = BuildError();
                break;

            case DriveScoreGaugeState.Empty:
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
        // Web parity: WidgetShell title is `isCompact ? undefined : t('widget.driveScoreGauge.title')` — collapse
        // the title row (icon + caption) when compact; the freshness/refresh actions stay pinned top-right.
        _titleRow.Visibility = _viewModel.Size.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private static StackPanel BuildBody(DriveScoreGaugeDisplay display)
    {
        // Web WidgetGaugeHero: flex flex-col items-center justify-center gap-2 — gauge, then stats, then bars.
        var outer = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Center,
        };

        outer.Children.Add(BuildGaugeColumn(display));

        if (display.ShowStats && display.Metrics.Count > 0)
        {
            outer.Children.Add(BuildStats(display.Metrics));
        }

        if (display.ShowBars && display.Metrics.Count > 0)
        {
            outer.Children.Add(BuildBars(display.Metrics));
        }

        return outer;
    }

    private static StackPanel BuildGaugeColumn(DriveScoreGaugeDisplay display)
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

        // Web parity: RadialGauge renders the `label` (the grade) beneath the ring.
        var caption = new TextBlock
        {
            Text = display.GradeLabel,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(caption, AccessibilityView.Raw);
        column.Children.Add(caption);

        return column;
    }

    private static Grid BuildRing(DriveScoreGaugeDisplay display)
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

        // Value arc, tinted by the score threshold status (web scoreColor).
        double fraction = ChartGeometry.GaugeFraction(display.Value, display.Max);
        if (fraction > 0)
        {
            canvas.Children.Add(ChartShapes.ArcPath(
                ChartGeometry.RingArc(center, radius, fraction),
                ChartBrushes.ForStatus(display.Status),
                StrokeWidth));
        }

        // Centre: the value with the small "Weekly score" unit beneath it (web RadialGauge value + unit span).
        var value = new TextBlock
        {
            Text = display.ValueText,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            FontSize = display.IsCompact ? 18 : 22,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
        };
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);

        var unit = new TextBlock
        {
            Text = display.Unit,
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

    private static StackPanel BuildStats(IReadOnlyList<DriveScoreMetric> metrics)
    {
        // Web: flex flex-wrap items-center justify-center gap-x-4 gap-y-1 — a centred row of auto-width tiles.
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        foreach (var metric in metrics)
        {
            row.Children.Add(BuildStatTile(metric));
        }

        return row;
    }

    private static StackPanel BuildStatTile(DriveScoreMetric metric)
    {
        var label = new TextBlock
        {
            Text = metric.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);

        var value = new TextBlock
        {
            Text = metric.ValueText,
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
        AutomationProperties.SetName(tile, $"{metric.Label} {metric.ValueText}");
        return tile;
    }

    private static StackPanel BuildBars(IReadOnlyList<DriveScoreMetric> metrics)
    {
        // Web: flex flex-col gap-2 w-full — a full-width column of MetricBars.
        var column = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        foreach (var metric in metrics)
        {
            column.Children.Add(BuildMetricBar(metric));
        }

        return column;
    }

    private static StackPanel BuildMetricBar(DriveScoreMetric metric)
    {
        var brush = ChartBrushes.ForStatus(metric.Status);

        var label = new TextBlock
        {
            Text = metric.Label,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var value = new TextBlock
        {
            Text = metric.ValueText,
            FontSize = 12,
            Foreground = brush,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);

        var headerRow = new Grid { Margin = new Thickness(0, 0, 0, 6) };
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(label, 0);
        Grid.SetColumn(value, 1);
        headerRow.Children.Add(label);
        headerRow.Children.Add(value);

        // Track + proportional fill (web: track bg-[var(--surface-2)], fill width = value/max).
        double fraction = Math.Clamp(metric.Value / DriveScoreGaugeProjection.MaxScore, 0, 1);

        var fill = new Border
        {
            Background = brush,
            CornerRadius = new CornerRadius(BarRadius),
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        var fillGrid = new Grid();
        fillGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(fraction, GridUnitType.Star) });
        fillGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1 - fraction, GridUnitType.Star) });
        Grid.SetColumn(fill, 0);
        fillGrid.Children.Add(fill);

        var track = new Border
        {
            Height = BarHeight,
            CornerRadius = new CornerRadius(BarRadius),
            Background = ChartBrushes.Border,
            Child = fillGrid,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        var bar = new StackPanel { HorizontalAlignment = HorizontalAlignment.Stretch };
        bar.Children.Add(headerRow);
        bar.Children.Add(track);
        AutomationProperties.SetName(bar, $"{metric.Label} {metric.ValueText}");
        return bar;
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

        AutomationProperties.SetName(skeleton, _localizer.GetString("widget.driveScoreGauge.loading", "Loading drive score"));
        LiveRegion.Configure(skeleton);
        LiveRegion.Announce(skeleton);
        return skeleton;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.driveScoreGauge.error", "Couldn't load drive score"),
            ActionText = _localizer.GetString("widget.driveScoreGauge.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = DriveScoreGaugeProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
