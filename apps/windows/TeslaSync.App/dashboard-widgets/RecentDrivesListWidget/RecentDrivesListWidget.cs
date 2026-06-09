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
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// Carries the dashboard route a <see cref="RecentDrivesListWidget"/> affordance asks the host to navigate
/// to — the native analogue of a web <c>&lt;Link to=…&gt;</c> target ("/drives" for the header "View all"
/// action, "/drives/{id}" for a drive row). The dashboard host subscribes to
/// <see cref="RecentDrivesListWidget.NavigationRequested"/> and performs the navigation; the surface itself
/// stays a thin renderer.
/// </summary>
public sealed class RecentDrivesListNavigationEventArgs(string route) : EventArgs
{
    /// <summary>The dashboard route to navigate to.</summary>
    public string Route { get; } = route;
}

/// <summary>
/// The native WinUI 3 Recent Drives List dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/RecentDrivesListWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a skeleton while loading, otherwise a title + Route icon + freshness header with a "View all" link and a
/// refresh retry) wrapping the scrollable, newest-first list of recent drives: each navigable row shows the
/// distance + duration (left), the start/end addresses when wide (center, the web <c>isWide</c> branch), and
/// the SoC transition + optional battery-used percent + short date (right). A friendly "No recent drives
/// recorded" empty state covers the body when the list is empty. Faithful to the web component, a fetch
/// failure is surfaced through the freshness "Error" chip plus the refresh button (the retry affordance)
/// rather than replacing the body. All data flows through the shared <see cref="RecentDrivesListViewModel"/>;
/// the view never performs HTTP. Every string resolves through the i18n facade and every interactive element
/// carries a Narrator name.
/// </summary>
public sealed partial class RecentDrivesListWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly RecentDrivesListViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly RecentDrivesListDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _viewAll = new();
    private readonly TextBlock _viewAllText = new();
    private readonly Button _refresh = new();
    private readonly ScrollViewer _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public RecentDrivesListWidget(
        IRecentDrivesListSource source,
        ILocalizer localizer,
        RecentDrivesListSize size,
        RecentDrivesListDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new RecentDrivesListDiagnostics();
        _viewModel = new RecentDrivesListViewModel(source, localizer, size, clock: clock);
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

    /// <summary>Raised when a row or the "View all" action asks the host to navigate to a dashboard route.</summary>
    public event EventHandler<RecentDrivesListNavigationEventArgs>? NavigationRequested;

    /// <summary>The canonical registry id this surface registers under (<c>recent-drives-list</c>).</summary>
    public static string RegistryId => RecentDrivesListRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the list for the new layout.</summary>
    public RecentDrivesListSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="RecentDrivesListSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle
    /// unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static RecentDrivesListWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        RecentDrivesListSize? size = null,
        long? vehicleId = null,
        RecentDrivesListDiagnostics? diagnostics = null)
    {
        var source = new RecentDrivesListSource(vehicles, api, engine, options, vehicleId);
        return new RecentDrivesListWidget(
            source, localizer, size ?? RecentDrivesListRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = RecentDrivesListProjection.HeaderGlyph,
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

        BuildViewAll();

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.recentDrivesList.refresh", "Refresh recent drives"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_viewAll);
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

    private void BuildViewAll()
    {
        _viewAllText.FontSize = 10;
        _viewAllText.Foreground = DisplayTokens.TextMuted;
        _viewAllText.VerticalAlignment = VerticalAlignment.Center;

        var chevron = new FontIcon
        {
            Glyph = RecentDrivesListProjection.ViewAllGlyph,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(chevron, AccessibilityView.Raw);

        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        content.Children.Add(_viewAllText);
        content.Children.Add(chevron);

        _viewAll.Content = content;
        _viewAll.Background = Transparent();
        _viewAll.BorderThickness = new Thickness(0);
        _viewAll.Padding = new Thickness(4, 2, 4, 2);
        _viewAll.VerticalAlignment = VerticalAlignment.Center;
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
        NavigationRequested?.Invoke(this, new RecentDrivesListNavigationEventArgs(_viewModel.Display.ViewAllRoute));

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
        if (_viewModel.State == RecentDrivesListState.Loading)
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
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _viewAllText.Text = _viewModel.ViewAllLabel;
        AutomationProperties.SetName(_viewAll, _viewModel.ViewAllLabel);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        var display = _viewModel.Display;
        return display.HasData ? BuildList(display) : BuildEmpty();
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 10, Padding = new Thickness(12, 12, 12, 12) };
        for (int i = 0; i < 4; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 36 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.recentDrivesList.loading", "Loading recent drives"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = RecentDrivesListProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private StackPanel BuildList(RecentDrivesListDisplay display)
    {
        var column = new StackPanel { Spacing = 6 };
        foreach (var row in display.Items)
        {
            column.Children.Add(BuildRow(row, display.IsWide));
        }

        return column;
    }

    private Button BuildRow(RecentDriveRow row, bool isWide)
    {
        var grid = new Grid { ColumnSpacing = 12, Padding = new Thickness(8, 8, 8, 8) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        if (isWide)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var distanceColumn = BuildDistanceColumn(row);
        Grid.SetColumn(distanceColumn, 0);
        grid.Children.Add(distanceColumn);

        int rightColumn = 1;
        if (isWide)
        {
            var addressColumn = BuildAddressColumn(row);
            Grid.SetColumn(addressColumn, 1);
            grid.Children.Add(addressColumn);
            rightColumn = 2;
        }

        var batteryColumn = BuildBatteryColumn(row);
        Grid.SetColumn(batteryColumn, rightColumn);
        grid.Children.Add(batteryColumn);

        var button = new Button
        {
            Content = grid,
            Background = Transparent(),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            MinHeight = 44,
        };
        AutomationProperties.SetName(button, row.AutomationName);
        button.Click += (_, _) => NavigationRequested?.Invoke(this, new RecentDrivesListNavigationEventArgs(row.DetailRoute));
        return button;
    }

    private static StackPanel BuildDistanceColumn(RecentDriveRow row)
    {
        var column = new StackPanel { Spacing = 2, MinWidth = 76, VerticalAlignment = VerticalAlignment.Top };
        column.Children.Add(new TextBlock
        {
            Text = row.DistanceText,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        var durationRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 3, VerticalAlignment = VerticalAlignment.Center };
        durationRow.Children.Add(MutedGlyph(RecentDrivesListProjection.ClockGlyph));
        durationRow.Children.Add(new TextBlock
        {
            Text = row.DurationText,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        column.Children.Add(durationRow);
        return column;
    }

    private static StackPanel BuildAddressColumn(RecentDriveRow row)
    {
        var column = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        column.Children.Add(AddressRow(row.StartAddress, "TsColorSuccessBrush"));
        column.Children.Add(AddressRow(row.EndAddress, "TsColorDangerBrush"));
        return column;
    }

    private static StackPanel AddressRow(string address, string pinBrushKey)
    {
        var pin = new FontIcon
        {
            Glyph = RecentDrivesListProjection.MapPinGlyph,
            FontSize = 10,
            Foreground = DisplayTokens.Brush(pinBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(pin, AccessibilityView.Raw);

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(pin);
        row.Children.Add(new TextBlock
        {
            Text = address,
            FontSize = 11,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        return row;
    }

    private static StackPanel BuildBatteryColumn(RecentDriveRow row)
    {
        var column = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top };

        var batteryRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, HorizontalAlignment = HorizontalAlignment.Right };
        batteryRow.Children.Add(MutedGlyph(RecentDrivesListProjection.BatteryGlyph));
        batteryRow.Children.Add(new TextBlock
        {
            Text = row.BatteryText,
            FontSize = 11,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        column.Children.Add(batteryRow);

        var metaRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, HorizontalAlignment = HorizontalAlignment.Right };
        if (!string.IsNullOrEmpty(row.BatteryUsedText))
        {
            metaRow.Children.Add(new TextBlock
            {
                Text = row.BatteryUsedText,
                FontSize = 11,
                Foreground = DisplayTokens.Accent,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            });
        }

        metaRow.Children.Add(new TextBlock
        {
            Text = row.DateText,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        column.Children.Add(metaRow);
        return column;
    }

    private static FontIcon MutedGlyph(string glyph)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
