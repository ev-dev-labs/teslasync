using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets.UptimeMonitor;

/// <summary>
/// The native WinUI 3 Uptime Monitor dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/UptimeMonitorWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (skeleton while loading, a retry surface on error, otherwise a Health-glyph title + freshness header)
/// wrapping one of two bodies: the standard layout (an "Overall" status row + a status-coloured dot / label /
/// badge per service — database, MQTT, Tesla API, Fleet Telemetry — plus, when tall, a DB-size / table-count
/// footer); or — when compact (1×1) — the "Overall" row above the centred healthy-count metric
/// (<c>healthyCount/total</c>). When the query resolved with no body it shows the "no system health data"
/// empty state. All data flows through the shared <see cref="UptimeMonitorViewModel"/>; the view never
/// performs HTTP. Every string resolves through the i18n facade and every interactive element carries a
/// Narrator name.
/// </summary>
public sealed partial class UptimeMonitorWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";  // Segoe Fluent — Refresh
    private const string HealthGlyph = "\uE95E";   // Segoe Fluent — Health (web Activity / registry HeartPulse)

    private readonly UptimeMonitorViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly UptimeMonitorDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public UptimeMonitorWidget(
        IUptimeMonitorSource source,
        ILocalizer localizer,
        UptimeMonitorSize size,
        UptimeMonitorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new UptimeMonitorDiagnostics();
        _viewModel = new UptimeMonitorViewModel(source, localizer, size);
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

    /// <summary>The canonical registry id this surface registers under (<c>uptime-monitor</c>).</summary>
    public static string RegistryId => UptimeMonitorRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the layout.</summary>
    public UptimeMonitorSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="UptimeMonitorSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies).
    /// </summary>
    public static UptimeMonitorWidget Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UptimeMonitorSize? size = null,
        UptimeMonitorDiagnostics? diagnostics = null)
    {
        var source = new UptimeMonitorSource(api, engine, options);
        return new UptimeMonitorWidget(source, localizer, size ?? UptimeMonitorRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = HealthGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.uptime.refresh", "Refresh system health"));
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
        switch (_viewModel.State)
        {
            case UptimeMonitorState.Loading:
                Content = BuildLoading();
                break;

            case UptimeMonitorState.Error:
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
            return BuildEmpty(display.EmptyMessage);
        }

        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(BuildOverallRow(display));

        if (display.IsCompact)
        {
            column.Children.Add(BuildCompactCount(display));
        }
        else
        {
            column.Children.Add(BuildServiceList(display));
            if (display.IsTall)
            {
                column.Children.Add(BuildFooter(display));
            }
        }

        return column;
    }

    private static Grid BuildOverallRow(UptimeMonitorDisplay display)
    {
        var label = new TextBlock
        {
            Text = display.OverallLabel.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var badge = new TsBadge
        {
            Status = display.OverallKind,
            Content = display.OverallBadgeText,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);

        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(label, 0);
        Grid.SetColumn(badge, 1);
        grid.Children.Add(label);
        grid.Children.Add(badge);
        AutomationProperties.SetName(grid, display.OverallAutomationName);
        return grid;
    }

    private static StackPanel BuildCompactCount(UptimeMonitorDisplay display)
    {
        var value = new TextBlock
        {
            Text = display.CompactCountText,
            FontSize = 24,
            FontWeight = Microsoft.UI.Text.FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var host = new StackPanel
        {
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        host.Children.Add(value);
        AutomationProperties.SetName(host, display.CompactAutomationName);
        return host;
    }

    private static StackPanel BuildServiceList(UptimeMonitorDisplay display)
    {
        var column = new StackPanel { Spacing = 8 };
        foreach (var service in display.Services)
        {
            column.Children.Add(BuildServiceRow(service));
        }

        return column;
    }

    private static Grid BuildServiceRow(UptimeServiceRow service)
    {
        var dot = DisplayPrimitives.Dot(DotBrush(service.Kind), 10);
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = service.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        left.Children.Add(dot);
        left.Children.Add(label);

        var badge = new TsBadge
        {
            Status = service.Kind,
            Content = service.BadgeText,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);

        var grid = new Grid { ColumnSpacing = 10, MinHeight = 28 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(left, 0);
        Grid.SetColumn(badge, 1);
        grid.Children.Add(left);
        grid.Children.Add(badge);
        AutomationProperties.SetName(grid, service.AccessibilityName);
        return grid;
    }

    private static Border BuildFooter(UptimeMonitorDisplay display)
    {
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(BuildFooterRow(display.DatabaseSizeLabel, display.DatabaseSizeValue));
        column.Children.Add(BuildFooterRow(display.TableCountLabel, display.TableCountValue));

        return new Border
        {
            Child = column,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 1, 0, 0),
            Padding = new Thickness(0, 8, 0, 0),
            Margin = new Thickness(0, 4, 0, 0),
        };
    }

    private static Grid BuildFooterRow(string label, string value)
    {
        var labelText = new TextBlock
        {
            Text = label,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var valueText = new TextBlock
        {
            Text = value,
            FontSize = 11,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(labelText, 0);
        Grid.SetColumn(valueText, 1);
        grid.Children.Add(labelText);
        grid.Children.Add(valueText);
        AutomationProperties.SetName(grid, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value));
        return grid;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        for (int i = 0; i < 4; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.uptime.loading", "Loading system health"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.uptime.error", "Couldn't load system health"),
            ActionText = _localizer.GetString("widget.uptime.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private static TsEmptyState BuildEmpty(string message) => new()
    {
        IconGlyph = HealthGlyph,
        Message = message,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Brush DotBrush(StatusKind kind) =>
        DisplayTokens.Brush(StatusResources.AccentBrushKey(kind));

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
