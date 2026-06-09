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
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Speed Heatmap dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/SpeedHeatmapWidget.tsx. It mirrors the web <c>WidgetShell</c> (a skeleton
/// while loading, a retry surface on error, otherwise — only when not compact — the "Speed Heatmap" title row
/// plus a freshness header with a refresh affordance) wrapping the SVG-equivalent 7×24 (day-of-week ×
/// hour-of-day) speed heatmap: a uniformly-scaled canvas of colour-graded cells with day/hour tick labels, a
/// "{n} drives · Peak avg {s} {unit}" summary above it and a Slow → Fast legend ramp below. In the single-column
/// compact layout the body collapses to the peak-speed metric (the web <c>isCompact</c> branch, showing "—" when
/// there is no data). A friendly "No drive data yet" empty state covers the body when no drives bucket. All data
/// flows through the shared <see cref="SpeedHeatmapViewModel"/>; the view never performs HTTP. Every string
/// resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class SpeedHeatmapWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string Separator = "\u00B7";    // middle dot (web "·")

    // Heatmap geometry — a 1:1 reproduction of the web SVG viewBox coordinate system so the canvas scales
    // uniformly (web preserveAspectRatio="xMidYMid meet") and the cells stay square-ish at any footprint.
    private const double CellStride = 10;   // web cell column stride
    private const double RowStride = 12;    // web cell row stride
    private const double CellWidth = 9;     // web rect width
    private const double CellHeight = 11;   // web rect height
    private const double CellRadius = 1.5;  // web rect rx
    private const double TopMargin = 14;    // web topMargin
    private const double WideLeftMargin = 30;
    private const double NarrowLeftMargin = 14;
    private const double LabelFontSize = 6; // web label font-size

    private readonly SpeedHeatmapViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SpeedHeatmapDiagnostics _diagnostics;
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
    public SpeedHeatmapWidget(
        ISpeedHeatmapSource source,
        ILocalizer localizer,
        SpeedHeatmapSize size,
        UnitPref? units = null,
        SpeedHeatmapDiagnostics? diagnostics = null,
        TimeZoneInfo? timeZone = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SpeedHeatmapDiagnostics();
        _viewModel = new SpeedHeatmapViewModel(source, localizer, size, units, timeZone);
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

    /// <summary>The canonical registry id this surface registers under (<c>speed-heatmap</c>).</summary>
    public static string RegistryId => SpeedHeatmapRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the heatmap for the new layout.</summary>
    public SpeedHeatmapSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the heatmap in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SpeedHeatmapSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static SpeedHeatmapWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        SpeedHeatmapSize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        SpeedHeatmapDiagnostics? diagnostics = null)
    {
        var source = new SpeedHeatmapSource(vehicles, api, engine, options, vehicleId);
        return new SpeedHeatmapWidget(
            source, localizer, size ?? SpeedHeatmapRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = SpeedHeatmapProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Accent,
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.speedHeatmap.refresh", "Refresh speed heatmap"));
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
            case SpeedHeatmapState.Loading:
                Content = BuildLoading();
                break;

            case SpeedHeatmapState.Error:
                Content = BuildError();
                break;

            case SpeedHeatmapState.Empty:
                UpdateHeader();
                // Web parity: the compact layout always renders the peak metric (with "—"); only the larger
                // layouts swap in the empty state.
                _bodyHost.Child = _viewModel.Display.IsCompact
                    ? BuildCompact(_viewModel.Display)
                    : (UIElement)BuildEmpty();
                Content = _root;
                break;

            default:
                UpdateHeader();
                _bodyHost.Child = BuildBody(_viewModel.Display);
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        // Web parity: WidgetShell renders the title (icon + caption) only when !isCompact; the freshness/refresh
        // actions stay pinned top-right in every layout.
        _titleRow.Visibility = _viewModel.Size.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private static UIElement BuildBody(SpeedHeatmapDisplay display) =>
        display.IsCompact ? BuildCompact(display) : (UIElement)BuildHeatmap(display);

    private static StackPanel BuildCompact(SpeedHeatmapDisplay display)
    {
        // Web isCompact: a centred peak-speed metric — the big value over a small "Peak {unit}" caption.
        var value = new TextBlock
        {
            Text = display.PeakValueText,
            FontSize = 24,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);

        var caption = new TextBlock
        {
            Text = display.PeakUnitCaption.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            CharacterSpacing = 80,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(caption, AccessibilityView.Raw);

        var column = new StackPanel
        {
            Spacing = 2,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(value);
        column.Children.Add(caption);
        AutomationProperties.SetName(column, display.PeakAutomationName);
        return column;
    }

    private static Grid BuildHeatmap(SpeedHeatmapDisplay display)
    {
        var body = new Grid { RowSpacing = 6 };
        body.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        body.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        body.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var summary = BuildSummary(display);
        Grid.SetRow(summary, 0);
        body.Children.Add(summary);

        var grid = BuildGrid(display);
        Grid.SetRow(grid, 1);
        body.Children.Add(grid);

        var legend = BuildLegend(display);
        Grid.SetRow(legend, 2);
        body.Children.Add(legend);

        return body;
    }

    private static StackPanel BuildSummary(SpeedHeatmapDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(new TextBlock
        {
            Text = display.SummaryDrivesText,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        var dot = new TextBlock
        {
            Text = Separator,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
        };
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);
        row.Children.Add(dot);

        row.Children.Add(new TextBlock
        {
            Text = display.SummaryPeakText,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        return row;
    }

    private static Viewbox BuildGrid(SpeedHeatmapDisplay display)
    {
        double leftMargin = display.IsWide ? WideLeftMargin : NarrowLeftMargin;
        double width = leftMargin + (SpeedHeatmapProjection.Cols * CellStride) + 2;
        double height = TopMargin + (SpeedHeatmapProjection.Rows * RowStride) + 2;

        var canvas = new Canvas { Width = width, Height = height };

        // Hour tick labels along the top (web: text-anchor middle).
        foreach (int hour in display.HourLabels)
        {
            var label = new TextBlock
            {
                Text = hour.ToString(CultureInfo.InvariantCulture),
                FontSize = LabelFontSize,
                Foreground = DisplayTokens.TextMuted,
                Width = CellStride,
                TextAlignment = TextAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
            Canvas.SetLeft(label, leftMargin + (hour * CellStride));
            Canvas.SetTop(label, 1);
            canvas.Children.Add(label);
        }

        // Day labels down the left (web: text-anchor end).
        for (int day = 0; day < display.DayLabels.Count; day++)
        {
            var label = new TextBlock
            {
                Text = display.DayLabels[day],
                FontSize = LabelFontSize,
                Foreground = DisplayTokens.TextMuted,
                Width = leftMargin - 3,
                TextAlignment = TextAlignment.Right,
            };
            AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
            Canvas.SetLeft(label, 0);
            Canvas.SetTop(label, TopMargin + (day * RowStride) + 2);
            canvas.Children.Add(label);
        }

        // Cells.
        foreach (var cell in display.Cells)
        {
            var rect = new Rectangle
            {
                Width = CellWidth,
                Height = CellHeight,
                RadiusX = CellRadius,
                RadiusY = CellRadius,
                Fill = ToBrush(cell.Color),
            };
            ToolTipService.SetToolTip(rect, cell.Tooltip);
            if (cell.AutomationName is { } name)
            {
                AutomationProperties.SetName(rect, name);
            }
            else
            {
                AutomationProperties.SetAccessibilityView(rect, AccessibilityView.Raw);
            }

            Canvas.SetLeft(rect, leftMargin + (cell.Hour * CellStride));
            Canvas.SetTop(rect, TopMargin + (cell.Day * RowStride));
            canvas.Children.Add(rect);
        }

        var viewbox = new Viewbox
        {
            Child = canvas,
            Stretch = Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(viewbox, display.HeatmapAutomationName);
        return viewbox;
    }

    private static Grid BuildLegend(SpeedHeatmapDisplay display)
    {
        var legend = new Grid { VerticalAlignment = VerticalAlignment.Center };
        legend.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        legend.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        legend.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var slow = new TextBlock
        {
            Text = display.SlowLabel,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(slow, 0);
        legend.Children.Add(slow);

        var swatches = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 1,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        foreach (var color in display.LegendColors)
        {
            swatches.Children.Add(new Border
            {
                Width = 16,
                Height = 8,
                CornerRadius = new CornerRadius(2),
                Background = ToBrush(color),
            });
        }

        AutomationProperties.SetAccessibilityView(swatches, AccessibilityView.Raw);
        Grid.SetColumn(swatches, 1);
        legend.Children.Add(swatches);

        var fast = new TextBlock
        {
            Text = display.FastLabel,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(fast, 2);
        legend.Children.Add(fast);

        return legend;
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

        AutomationProperties.SetName(skeleton, _localizer.GetString("widget.speedHeatmap.loading", "Loading speed heatmap"));
        LiveRegion.Configure(skeleton);
        LiveRegion.Announce(skeleton);
        return skeleton;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.speedHeatmap.error", "Couldn't load the speed heatmap"),
            ActionText = _localizer.GetString("widget.speedHeatmap.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = SpeedHeatmapProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static SolidColorBrush ToBrush(HeatColor color)
    {
        byte alpha = (byte)Math.Clamp(Math.Round(color.Opacity * 255, MidpointRounding.AwayFromZero), 0, 255);
        return new SolidColorBrush(Windows.UI.Color.FromArgb(alpha, color.R, color.G, color.B));
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
