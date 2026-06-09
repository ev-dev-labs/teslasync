using System.Collections.Generic;
using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Vampire Drain dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/VampireDrainWidget.tsx. It mirrors the web <c>WidgetShell</c> (a
/// skeleton while loading, otherwise a title + BatteryWarning + freshness header with a refresh retry)
/// wrapping either the compact single big-number drain stat + "/day" caption (1×N), or — when standard
/// (≥2 cols) — the "Avg Drain" stat card (severity-tinted battery glyph, <c>X.X%/day</c> value, and a
/// "{count} events · {hours}h total" sublabel when the summary is present), the wide-only daily-drain
/// sparkline (severity-tinted), and the newest-first <c>WidgetEventFeed</c> of recent drain events
/// (battery-lost % / duration / optional Sentry tag / drain-per-day rows), or its "No recent drain events"
/// empty state. A friendly "No vampire drain data" empty state covers both layouts when neither the stats
/// summary nor any event is present (the web <c>hasData</c> gate). Faithful to the web component, a fetch
/// failure is surfaced through the freshness "Error" chip plus the refresh button (the retry affordance)
/// rather than replacing the body. All data flows through the shared <see cref="VampireDrainViewModel"/>;
/// the view never performs HTTP. Every string resolves through the i18n facade and every interactive
/// element carries a Narrator name.
/// </summary>
public sealed partial class VampireDrainWidget : ContentControl, IDisposable
{
    private const string BatteryGlyph = "\uE83F";  // Segoe Fluent — Battery10 (web BatteryWarning icon)
    private const string RefreshGlyph = "\uE72C";  // Segoe Fluent — Refresh

    private const double SparklineWidth = 260;
    private const double SparklineHeight = 36;

    private readonly VampireDrainViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly VampireDrainDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    /// <param name="source">The cache-then-network phantom-drain stats + events source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata; drives compact / wide branches).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    /// <param name="clock">Optional clock for deterministic relative-time rendering.</param>
    public VampireDrainWidget(
        IVampireDrainSource source,
        ILocalizer localizer,
        VampireDrainSize size,
        VampireDrainDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new VampireDrainDiagnostics();
        _viewModel = new VampireDrainViewModel(source, localizer, size, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>vampire-drain</c>).</summary>
    public static string RegistryId => VampireDrainRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the surface for the new layout.</summary>
    public VampireDrainSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="VampireDrainSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle
    /// unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static VampireDrainWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        VampireDrainSize? size = null,
        long? vehicleId = null,
        VampireDrainDiagnostics? diagnostics = null)
    {
        var source = new VampireDrainSource(vehicles, api, engine, options, vehicleId);
        return new VampireDrainWidget(source, localizer, size ?? VampireDrainRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = BatteryGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorWarningBrush"),
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.vampireDrain.refresh", "Refresh vampire drain"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        var header = new Grid { Padding = new Thickness(12, 8, 12, 2) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(actions, 1);
        header.Children.Add(_titleRow);
        header.Children.Add(actions);

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(12, 0, 12, 12);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(header);
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
        if (_viewModel.State == VampireDrainState.Loading)
        {
            Content = BuildLoading();
            return;
        }

        UpdateHeader();
        _bodyHost.Content = BuildBody();
        Content = _root;
    }

    private void UpdateHeader()
    {
        // Web parity: the compact layout uses a title-less WidgetShell (title/icon/help omitted).
        _titleRow.Visibility = _viewModel.Display.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        var display = _viewModel.Display;
        if (!display.HasData)
        {
            return BuildEmpty();
        }

        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 36 });
        for (int i = 0; i < 3; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.vampireDrain.loading", "Loading vampire drain"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = BatteryGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel BuildCompact(VampireDrainDisplay display)
    {
        var value = new TextBlock
        {
            Text = display.CompactValueText,
            FontSize = 28,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(display.CompactSeverity)),
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var label = new TextBlock
        {
            Text = display.CompactPerDayLabel,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var column = new StackPanel
        {
            Spacing = 2,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(value);
        column.Children.Add(label);
        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    private static StackPanel BuildStandard(VampireDrainDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildAvgDrainCard(display));

        if (display.ShowSparkline)
        {
            column.Children.Add(BuildTrend(display));
        }

        column.Children.Add(display.HasEvents ? BuildEventList(display) : BuildNoEvents(display));
        return column;
    }

    private static Border BuildAvgDrainCard(VampireDrainDisplay display)
    {
        var header = DisplayPrimitives.Row(8);
        header.Children.Add(new FontIcon
        {
            Glyph = BatteryGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(display.AvgDrainSeverity)),
        });
        header.Children.Add(DisplayPrimitives.Caption(display.AvgDrainLabel));

        var column = DisplayPrimitives.Column(4);
        column.Children.Add(header);
        column.Children.Add(DisplayPrimitives.Value(display.AvgDrainValueText, 26));

        if (!string.IsNullOrEmpty(display.AvgDrainSublabel))
        {
            column.Children.Add(DisplayPrimitives.Caption(display.AvgDrainSublabel));
        }

        var card = DisplayPrimitives.Card(column);
        AutomationProperties.SetName(card, display.AvgDrainAutomationName);
        return card;
    }

    private static StackPanel BuildTrend(VampireDrainDisplay display)
    {
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(new TextBlock
        {
            Text = display.TrendLabel,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
        });
        column.Children.Add(BuildSparkline(display.SparklineData, display.SparklineSeverity));
        AutomationProperties.SetName(column, display.TrendLabel);
        return column;
    }

    private static Canvas BuildSparkline(IReadOnlyList<double> data, StatusKind severity)
    {
        var canvas = new Canvas
        {
            Width = SparklineWidth,
            Height = SparklineHeight,
            HorizontalAlignment = HorizontalAlignment.Left,
        };

        var points = ChartGeometry.SparklinePoints(data, SparklineWidth, SparklineHeight);
        if (points.Count == 0)
        {
            return canvas;
        }

        var brush = ChartBrushes.ForStatus(severity);

        var area = new List<PointD>(points.Count + 2)
        {
            new(points[0].X, SparklineHeight),
        };
        area.AddRange(points);
        area.Add(new PointD(points[^1].X, SparklineHeight));

        Polygon fill = ChartShapes.Polygon(area, brush);
        fill.Opacity = 0.22;
        canvas.Children.Add(fill);
        canvas.Children.Add(ChartShapes.Polyline(points, brush, 1.5));
        return canvas;
    }

    private static StackPanel BuildEventList(VampireDrainDisplay display)
    {
        var column = new StackPanel { Spacing = 2 };
        foreach (var row in display.Events)
        {
            column.Children.Add(BuildEventRow(row));
        }

        return column;
    }

    private static Grid BuildEventRow(VampireDrainEventRow row)
    {
        var icon = new FontIcon
        {
            Glyph = BatteryGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(row.Severity)),
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var body = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(new TextBlock
        {
            Text = row.Title,
            FontSize = 14,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        body.Children.Add(new TextBlock
        {
            Text = row.Subtitle,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        var time = new TextBlock
        {
            Text = row.RelativeTime,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Top,
        };

        var grid = new Grid { ColumnSpacing = 10, Padding = new Thickness(2, 6, 2, 6) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(body, 1);
        Grid.SetColumn(time, 2);
        grid.Children.Add(icon);
        grid.Children.Add(body);
        grid.Children.Add(time);

        AutomationProperties.SetName(grid, row.AutomationName);
        return grid;
    }

    private static TsEmptyState BuildNoEvents(VampireDrainDisplay display) => new()
    {
        IconGlyph = BatteryGlyph,
        Message = display.NoEventsMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
