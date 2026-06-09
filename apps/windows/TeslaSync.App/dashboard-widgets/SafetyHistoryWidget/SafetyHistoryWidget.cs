using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets.SafetyHistory;

/// <summary>
/// The native WinUI 3 Safety History dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/SafetyHistoryWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a skeleton while loading, a retry surface on error, otherwise an AlertOctagon + "Safety History"
/// freshness header) wrapping the two web layouts: at a single column the compact one-liner (a 30-day
/// event count plus most-common type and trend, or a friendly empty surface), and at two-plus columns the
/// three summary stat cards (Events 30d / Most Common / Trend) above the newest-first ADAS event feed
/// (collision warnings, AEB, lane departures) — each feed row a severity-iconed title + detail + relative
/// time, with a friendly empty surface when no event is recorded. All data flows through the shared
/// <see cref="SafetyHistoryViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class SafetyHistoryWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly SafetyHistoryViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SafetyHistoryDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();
    private readonly ScrollViewer _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public SafetyHistoryWidget(
        ISafetyHistorySource source,
        ILocalizer localizer,
        SafetyHistorySize size,
        SafetyHistoryDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SafetyHistoryDiagnostics();
        _viewModel = new SafetyHistoryViewModel(source, localizer, size, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>safety-history</c>).</summary>
    public static string RegistryId => SafetyHistoryRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the history for the new layout.</summary>
    public SafetyHistorySize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SafetyHistorySource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle
    /// unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static SafetyHistoryWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        SafetyHistorySize? size = null,
        long? vehicleId = null,
        SafetyHistoryDiagnostics? diagnostics = null)
    {
        var source = new SafetyHistorySource(vehicles, api, engine, options, vehicleId);
        return new SafetyHistoryWidget(source, localizer, size ?? SafetyHistoryRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = SafetyHistoryProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.safetyHistory.refresh", "Refresh safety history"));
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
            case SafetyHistoryState.Loading:
                Content = BuildLoading();
                break;

            case SafetyHistoryState.Error:
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
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    // Web parity: the compact (single-column) layout shows the one-liner; the standard layout shows the
    // stat cards above the event feed. Both keep every section visible — the empty case renders a friendly
    // surface rather than collapsing.
    private FrameworkElement BuildBody()
    {
        var display = _viewModel.Display;
        if (display.IsCompact)
        {
            return display.HasSnapshots ? BuildCompact(display) : BuildEmpty();
        }

        return BuildStandard(display);
    }

    private StackPanel BuildStandard(SafetyHistoryDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildStatCards(display));
        column.Children.Add(BuildFeed(display));
        return column;
    }

    private static Grid BuildStatCards(SafetyHistoryDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        for (int c = 0; c < display.Stats.Count; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < display.Stats.Count; i++)
        {
            var stat = display.Stats[i];
            var card = new TsStatCard
            {
                Label = stat.Label,
                Value = stat.Value,
                Sublabel = stat.Sublabel ?? string.Empty,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            AutomationProperties.SetName(card, stat.AutomationName);
            Grid.SetColumn(card, i);
            grid.Children.Add(card);
        }

        return grid;
    }

    private FrameworkElement BuildFeed(SafetyHistoryDisplay display)
    {
        if (display.Rows.Count == 0)
        {
            return BuildEmpty();
        }

        var column = new StackPanel { Spacing = 2 };
        foreach (var row in display.Rows)
        {
            column.Children.Add(BuildRow(row));
        }

        return column;
    }

    private static Grid BuildRow(SafetyHistoryRow row)
    {
        var icon = new FontIcon
        {
            Glyph = row.Glyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(row.AccentBrushKey),
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

        if (!string.IsNullOrEmpty(row.Subtitle))
        {
            body.Children.Add(new TextBlock
            {
                Text = row.Subtitle,
                FontSize = 12,
                Foreground = DisplayTokens.TextSecondary,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            });
        }

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

    private static Grid BuildCompact(SafetyHistoryDisplay display)
    {
        var icon = new FontIcon
        {
            Glyph = SafetyHistoryProjection.HeaderGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var body = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(new TextBlock
        {
            Text = display.CompactPrimary,
            FontSize = 14,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        if (display.CompactSecondary is { } secondary)
        {
            body.Children.Add(new TextBlock
            {
                Text = secondary,
                FontSize = 12,
                Foreground = DisplayTokens.TextSecondary,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            });
        }

        var grid = new Grid { ColumnSpacing = 8, MinHeight = 44, Padding = new Thickness(2, 4, 2, 4) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(body, 1);
        grid.Children.Add(icon);
        grid.Children.Add(body);
        AutomationProperties.SetName(grid, display.CompactAutomationName);
        return grid;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 32, ReduceMotion = MotionPreference.ReduceMotion });
        for (int i = 0; i < 3; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 16, ReduceMotion = MotionPreference.ReduceMotion });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.safetyHistory.loading", "Loading safety history"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.safetyHistory.error", "Couldn't load safety history"),
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
        IconGlyph = SafetyHistoryProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
