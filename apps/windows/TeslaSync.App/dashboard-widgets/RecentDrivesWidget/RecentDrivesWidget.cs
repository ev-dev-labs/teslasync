using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
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
/// A navigation request raised by the <see cref="RecentDrivesWidget"/> — the native analogue of the web
/// component's <c>&lt;Link&gt;</c> targets. <see cref="Route"/> is a leading-slash-free route path the host
/// resolves against the navigation table: the drive list (<c>drives</c>) for the "View all" action, or a
/// specific drive (<c>drives/{id}</c>) for a row.
/// </summary>
public sealed record RecentDrivesNavigation(string Route);

/// <summary>
/// The native WinUI 3 Recent Drives dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/RecentDrivesWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a skeleton while loading, a retry surface on error, otherwise a Car-iconed title + a "View all" action
/// + freshness header) wrapping the scrollable list of the five most-recent drives — each a drill-through
/// row showing the display-unit distance, the duration + start→end state-of-charge line, and the short
/// start date — or a friendly "No recent drives" empty state. All data flows through the shared
/// <see cref="RecentDrivesViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class RecentDrivesWidget : ContentControl, IDisposable
{
    private const string OpenGlyph = "\uE8A7";    // Segoe Fluent — OpenInNewWindow (web ArrowUpRight)
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly RecentDrivesViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly RecentDrivesDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly TextBlock _titleText = new();
    private readonly Button _viewAll = new();
    private readonly TextBlock _viewAllText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, units and diagnostics.</summary>
    public RecentDrivesWidget(
        IRecentDrivesSource source,
        ILocalizer localizer,
        RecentDrivesSize size,
        UnitPref? units = null,
        RecentDrivesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new RecentDrivesDiagnostics();
        _viewModel = new RecentDrivesViewModel(source, localizer, size, units);
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

    /// <summary>Raised when the "View all" action or a drive row is invoked; carries the navigation route.</summary>
    public event EventHandler<RecentDrivesNavigation>? NavigationRequested;

    /// <summary>The canonical registry id this surface registers under (<c>recent-drives</c>).</summary>
    public static string RegistryId => RecentDrivesRegistration.Id;

    /// <summary>The widget footprint (carried for the registry/grid API; the list is footprint-independent).</summary>
    public RecentDrivesSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the rows in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="RecentDrivesSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static RecentDrivesWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        RecentDrivesSize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        RecentDrivesDiagnostics? diagnostics = null)
    {
        var source = new RecentDrivesSource(vehicles, api, engine, options, vehicleId);
        return new RecentDrivesWidget(
            source, localizer, size ?? RecentDrivesRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = RecentDrivesProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(icon);
        titleRow.Children.Add(_titleText);

        BuildViewAll();

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.recentDrives.refresh", "Refresh recent drives"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_viewAll);
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        var header = new Grid { Padding = new Thickness(12, 8, 12, 2) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(titleRow, 0);
        Grid.SetColumn(actions, 1);
        header.Children.Add(titleRow);
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

    private void BuildViewAll()
    {
        _viewAllText.Text = _viewModel.ViewAllLabel;
        _viewAllText.FontSize = 11;
        _viewAllText.Foreground = DisplayTokens.TextMuted;
        _viewAllText.VerticalAlignment = VerticalAlignment.Center;

        var openIcon = new FontIcon { Glyph = OpenGlyph, FontSize = 10, Foreground = DisplayTokens.TextMuted, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(openIcon, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        content.Children.Add(_viewAllText);
        content.Children.Add(openIcon);

        _viewAll.Content = content;
        _viewAll.Background = Transparent();
        _viewAll.BorderThickness = new Thickness(0);
        _viewAll.Padding = new Thickness(4, 2, 4, 2);
        _viewAll.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_viewAll, _viewModel.ViewAllLabel);
        _viewAll.Click += OnViewAllClick;
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

    private void OnViewAllClick(object sender, RoutedEventArgs e) =>
        NavigationRequested?.Invoke(this, new RecentDrivesNavigation(RecentDrivesViewModel.ListRoute));

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
            case RecentDrivesState.Loading:
                Content = BuildLoading();
                break;

            case RecentDrivesState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _bodyHost.Content = _viewModel.HasRows ? BuildRows() : BuildEmpty();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _viewAllText.Text = _viewModel.ViewAllLabel;
        AutomationProperties.SetName(_viewAll, _viewModel.ViewAllLabel);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 8, Padding = new Thickness(12, 12, 12, 12) };
        for (int i = 0; i < RecentDrivesProjection.WindowLimit; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 36, ReduceMotion = MotionPreference.ReduceMotion });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.recentDrives.loading", "Loading recent drives"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.recentDrives.error", "Couldn't load recent drives"),
            ActionText = _localizer.GetString("widget.recentDrives.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = RecentDrivesProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private StackPanel BuildRows()
    {
        var column = new StackPanel { Spacing = 8 };
        foreach (var row in _viewModel.Rows)
        {
            column.Children.Add(BuildRow(row));
        }

        return column;
    }

    private Button BuildRow(RecentDrivesRow row)
    {
        var distance = new TextBlock
        {
            Text = row.DistanceText,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var detail = new TextBlock
        {
            Text = row.DetailText,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var body = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(distance);
        body.Children.Add(detail);

        var date = new TextBlock
        {
            Text = row.DateText,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 0, 0),
        };

        var grid = new Grid { ColumnSpacing = 8, Padding = new Thickness(8) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(body, 0);
        Grid.SetColumn(date, 1);
        grid.Children.Add(body);
        grid.Children.Add(date);

        var button = new Button
        {
            Content = grid,
            Background = DisplayTokens.Surface,
            BorderThickness = new Thickness(0),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            DataContext = row,
        };
        AutomationProperties.SetName(button, row.AutomationName);
        button.Click += OnRowClick;
        return button;
    }

    private void OnRowClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { DataContext: RecentDrivesRow row })
        {
            NavigationRequested?.Invoke(this, new RecentDrivesNavigation(row.Target));
        }
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
