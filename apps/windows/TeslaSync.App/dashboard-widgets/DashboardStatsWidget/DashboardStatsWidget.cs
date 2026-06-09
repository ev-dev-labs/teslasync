using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Dashboard Stats surface — a parity port of
/// web/src/features/dashboard/widgets/DashboardStatsWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (skeleton while loading, a retry surface on a load-bearing failure, otherwise a title + freshness
/// header) wrapping either the compact big active-trips number (1×N), or the four-tile
/// <c>WidgetStatGrid</c> (Vehicles, Trips, Charge Sessions, FSM State) laid out 2-up plus the
/// "Current State" status badge — and, when wide (3×N+), the "Recent Transitions" list; or a friendly
/// empty state when the dashboard read has no payload. All data flows through the shared
/// <see cref="DashboardStatsViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class DashboardStatsWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly DashboardStatsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DashboardStatsDiagnostics _diagnostics;
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
    public DashboardStatsWidget(
        IDashboardStatsSource source,
        ILocalizer localizer,
        DashboardStatsSize size,
        DashboardStatsDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new DashboardStatsDiagnostics();
        _viewModel = new DashboardStatsViewModel(source, localizer, size, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>dashboard-stats</c>).</summary>
    public static string RegistryId => DashboardStatsRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the surface for the new layout.</summary>
    public DashboardStatsSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="DashboardStatsSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies).
    /// </summary>
    public static DashboardStatsWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        DashboardStatsSize? size = null,
        DashboardStatsDiagnostics? diagnostics = null)
    {
        var source = new DashboardStatsSource(vehicles, api, engine, options);
        return new DashboardStatsWidget(source, localizer, size ?? DashboardStatsRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = DashboardStatsProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Accent,
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.dashboardStats.refresh", "Refresh dashboard stats"));
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
            case DashboardStatsState.Loading:
                Content = BuildLoading();
                break;

            case DashboardStatsState.Error:
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
        if (display is null)
        {
            return BuildEmpty();
        }

        if (display.IsCompact)
        {
            return BuildCompact(display);
        }

        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildStatGrid(display.Stats));
        column.Children.Add(BuildCurrentStateRow(display));

        if (display.IsWide && display.RecentTransitions.Count > 0)
        {
            column.Children.Add(BuildTransitions(display));
        }

        return column;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        for (int i = 0; i < 3; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 18 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.dashboardStats.loading", "Loading dashboard stats"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.dashboardStats.error", "Couldn't load dashboard stats"),
            ActionText = _localizer.GetString("widget.dashboardStats.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = DashboardStatsProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel BuildCompact(DashboardStatsDisplay display)
    {
        var number = new TextBlock
        {
            Text = display.CompactValue,
            FontSize = 26,
            FontWeight = Microsoft.UI.Text.FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var label = new TextBlock
        {
            Text = display.CompactLabel,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var column = new StackPanel
        {
            Spacing = 2,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(number);
        column.Children.Add(label);

        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    private static Grid BuildStatGrid(IReadOnlyList<DashboardStatItem> stats)
    {
        const int cols = 2;
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        int rows = (int)Math.Ceiling(stats.Count / (double)cols);
        for (int c = 0; c < cols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < stats.Count; i++)
        {
            var tile = BuildStatTile(stats[i]);
            Grid.SetColumn(tile, i % cols);
            Grid.SetRow(tile, i / cols);
            grid.Children.Add(tile);
        }

        return grid;
    }

    private static Border BuildStatTile(DashboardStatItem stat)
    {
        var labelText = new TextBlock
        {
            Text = stat.Label,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var valueText = new TextBlock
        {
            Text = stat.Value,
            FontSize = 20,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(labelText);
        column.Children.Add(valueText);

        var tile = new Border
        {
            Child = column,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12, 10, 12, 10),
        };
        AutomationProperties.SetName(tile, stat.AutomationName);
        return tile;
    }

    private static Grid BuildCurrentStateRow(DashboardStatsDisplay display)
    {
        var label = new TextBlock
        {
            Text = display.CurrentStateLabel,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var badge = new TsBadge
        {
            Status = display.FsmTone,
            Dot = true,
            Content = display.FsmStateLabel,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
        };

        var row = new Grid { MinHeight = 44, ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(label, 0);
        Grid.SetColumn(badge, 1);
        row.Children.Add(label);
        row.Children.Add(badge);

        AutomationProperties.SetName(row, display.CurrentStateAutomationName);
        return row;
    }

    private static StackPanel BuildTransitions(DashboardStatsDisplay display)
    {
        var header = new TextBlock
        {
            Text = display.RecentTransitionsLabel.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 120,
        };

        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(header);

        foreach (var entry in display.RecentTransitions)
        {
            column.Children.Add(BuildTransitionRow(entry));
        }

        return column;
    }

    private static Grid BuildTransitionRow(DashboardTransitionRow entry)
    {
        var badge = new TsBadge
        {
            Status = TeslaSync.App.Core.StatusKind.Neutral,
            Content = entry.StateLabel,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
        };

        var time = new TextBlock
        {
            Text = entry.RelativeTime,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var row = new Grid { MinHeight = 44, ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(badge, 0);
        Grid.SetColumn(time, 1);
        row.Children.Add(badge);
        row.Children.Add(time);

        AutomationProperties.SetName(row, entry.AutomationName);
        return row;
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
