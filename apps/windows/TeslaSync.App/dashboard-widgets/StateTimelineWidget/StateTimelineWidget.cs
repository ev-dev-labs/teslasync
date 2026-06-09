using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 State Timeline dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/StateTimelineWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (skeleton while loading, a retry surface on a load-bearing failure, otherwise a title + freshness header)
/// wrapping the stacked state-distribution bar plus — by footprint — the compact legend dots (1×N), the
/// standard per-state list (duration + percentage), and, when wide (3×N+) with transitions present, the
/// "24h Timeline" stripe; or a friendly empty state when the state summary holds no recorded minutes. All
/// data flows through the shared <see cref="StateTimelineViewModel"/>; the view never performs HTTP. Every
/// string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class StateTimelineWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private const double BarHeight = 20;
    private const double BarRadius = 10;
    private const double StripeHeight = 16;
    private const double StripeRadius = 4;
    private const double TouchTarget = 44;

    private readonly StateTimelineViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly StateTimelineDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, diagnostics and clock.</summary>
    public StateTimelineWidget(
        IStateTimelineSource source,
        ILocalizer localizer,
        StateTimelineSize size,
        StateTimelineDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new StateTimelineDiagnostics();
        _viewModel = new StateTimelineViewModel(source, localizer, size, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>state-timeline</c>).</summary>
    public static string RegistryId => StateTimelineRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the surface for the new layout.</summary>
    public StateTimelineSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="StateTimelineSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies + the widget vehicle source).
    /// </summary>
    public static StateTimelineWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        StateTimelineSize? size = null,
        long? vehicleId = null,
        StateTimelineDiagnostics? diagnostics = null)
    {
        var source = new StateTimelineSource(vehicles, api, engine, options, vehicleId);
        return new StateTimelineWidget(
            source, localizer, size ?? StateTimelineRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = StateTimelineProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorInfoBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = Microsoft.UI.Text.FontWeights.Medium;
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.stateTimeline.refresh", "Refresh state timeline"));
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
            case StateTimelineState.Loading:
                Content = BuildLoading();
                break;

            case StateTimelineState.Error:
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
        _titleRow.Visibility = _viewModel.Size.IsCompact ? Visibility.Collapsed : Visibility.Visible;
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

        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildStackedBar(display.Segments));

        if (display.IsCompact)
        {
            column.Children.Add(BuildLegend(display.LegendSegments));
        }
        else
        {
            column.Children.Add(BuildStateList(display.Segments));
        }

        if (display.IsWide && display.HasStripe)
        {
            column.Children.Add(BuildStripe(display));
        }

        return column;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = BarHeight });
        for (int i = 0; i < 3; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 14 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.stateTimeline.loading", "Loading state timeline"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.stateTimeline.error", "Couldn't load the state timeline"),
            ActionText = _localizer.GetString("widget.stateTimeline.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = StateTimelineProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Grid BuildStackedBar(IReadOnlyList<StateTimelineSegment> segments)
    {
        var grid = new Grid { Height = BarHeight, VerticalAlignment = VerticalAlignment.Top };
        for (int i = 0; i < segments.Count; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0, segments[i].Percent), GridUnitType.Star) });
        }

        for (int i = 0; i < segments.Count; i++)
        {
            var seg = segments[i];
            var cell = new Border
            {
                Background = DisplayTokens.Brush(seg.ColorKey),
                CornerRadius = BarCornerRadius(i, segments.Count),
            };
            ToolTipService.SetToolTip(cell, seg.BarAutomationName);
            AutomationProperties.SetName(cell, seg.BarAutomationName);
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        AutomationProperties.SetName(grid, BarSummary(segments));
        return grid;
    }

    private static CornerRadius BarCornerRadius(int index, int count)
    {
        if (count <= 1)
        {
            return new CornerRadius(BarRadius);
        }

        if (index == 0)
        {
            return new CornerRadius(BarRadius, 0, 0, BarRadius);
        }

        if (index == count - 1)
        {
            return new CornerRadius(0, BarRadius, BarRadius, 0);
        }

        return new CornerRadius(0);
    }

    private static StackPanel BuildLegend(IReadOnlyList<StateTimelineSegment> legend)
    {
        var column = new StackPanel { Spacing = 4 };
        foreach (var seg in legend)
        {
            var row = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 6,
                MinHeight = TouchTarget,
                VerticalAlignment = VerticalAlignment.Center,
            };
            row.Children.Add(Dot(seg.ColorKey, 8));
            row.Children.Add(new TextBlock
            {
                Text = seg.Label,
                FontSize = 11,
                Foreground = DisplayTokens.TextSecondary,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
                VerticalAlignment = VerticalAlignment.Center,
            });
            row.Children.Add(new TextBlock
            {
                Text = seg.PercentTextCompact,
                FontSize = 11,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            });
            AutomationProperties.SetName(row, seg.LegendAutomationName);
            column.Children.Add(row);
        }

        return column;
    }

    private static StackPanel BuildStateList(IReadOnlyList<StateTimelineSegment> segments)
    {
        var column = new StackPanel { Spacing = 4 };
        foreach (var seg in segments)
        {
            column.Children.Add(BuildStateRow(seg));
        }

        return column;
    }

    private static Grid BuildStateRow(StateTimelineSegment seg)
    {
        var grid = new Grid { MinHeight = TouchTarget, ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        left.Children.Add(Dot(seg.ColorKey, 10));
        left.Children.Add(new TextBlock
        {
            Text = seg.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var right = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        right.Children.Add(new TextBlock
        {
            Text = seg.DurationText,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        });
        right.Children.Add(new TsBadge
        {
            Status = StatusKind.Neutral,
            Content = seg.PercentText,
            VerticalAlignment = VerticalAlignment.Center,
        });

        Grid.SetColumn(left, 0);
        Grid.SetColumn(right, 1);
        grid.Children.Add(left);
        grid.Children.Add(right);
        AutomationProperties.SetName(grid, seg.RowAutomationName);
        return grid;
    }

    private static StackPanel BuildStripe(StateTimelineDisplay display)
    {
        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(new TextBlock
        {
            Text = display.TimelineLabel.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
        });

        var grid = new Grid { Height = StripeHeight, VerticalAlignment = VerticalAlignment.Top };
        var stripe = display.Stripe;
        for (int i = 0; i < stripe.Count; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0, stripe[i].Percent), GridUnitType.Star) });
        }

        for (int i = 0; i < stripe.Count; i++)
        {
            var seg = stripe[i];
            var cell = new Border
            {
                Background = DisplayTokens.Brush(seg.ColorKey),
                CornerRadius = StripeCornerRadius(i, stripe.Count),
            };
            ToolTipService.SetToolTip(cell, seg.AutomationName);
            AutomationProperties.SetName(cell, seg.AutomationName);
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        AutomationProperties.SetName(grid, display.TimelineLabel);
        column.Children.Add(grid);
        return column;
    }

    private static CornerRadius StripeCornerRadius(int index, int count)
    {
        if (count <= 1)
        {
            return new CornerRadius(StripeRadius);
        }

        if (index == 0)
        {
            return new CornerRadius(StripeRadius, 0, 0, StripeRadius);
        }

        if (index == count - 1)
        {
            return new CornerRadius(0, StripeRadius, StripeRadius, 0);
        }

        return new CornerRadius(0);
    }

    private static Ellipse Dot(string colorKey, double size) => new()
    {
        Width = size,
        Height = size,
        Fill = DisplayTokens.Brush(colorKey),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static string BarSummary(IReadOnlyList<StateTimelineSegment> segments)
    {
        var parts = new string[segments.Count];
        for (int i = 0; i < segments.Count; i++)
        {
            parts[i] = segments[i].BarAutomationName;
        }

        return string.Join("; ", parts);
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
