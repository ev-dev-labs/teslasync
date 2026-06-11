using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Maps;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 Geofence drawer modal — a parity port of
/// web/src/components/maps/GeofenceDrawer.tsx (and the data composition of its parent
/// <c>GeofencesPage</c>). It renders the saved geofences on a <see cref="TsMapControl"/> via the shared
/// <see cref="TsGeofenceDrawer"/> overlay, lists them with accessible per-fence edit/remove affordances,
/// and offers an accessible "new geofence" create intent (a centre circle, matching the web circle
/// create) — drag-to-draw is replaced by keyboard-reachable affordances so the surface is fully
/// operable without a pointer. All data flows through the shared <see cref="GeofenceDrawerViewModel"/>;
/// the view never performs HTTP. The overlay carries dialog semantics (a close affordance, an
/// <c>Escape</c> accelerator and a <see cref="ShowAsync"/> that hosts it in a focus-trapping
/// <see cref="ContentDialog"/>). Every string resolves through the i18n facade and every interactive
/// element carries a Narrator name.
/// </summary>
public sealed partial class GeofenceDrawer : ContentControl, IDisposable
{
    private const string MapGlyph = "\uE707";      // Segoe Fluent — Map pin
    private const string AddGlyph = "\uE710";      // Add
    private const string EditGlyph = "\uE70F";     // Edit
    private const string DeleteGlyph = "\uE74D";   // Delete
    private const string RefreshGlyph = "\uE72C";  // Refresh
    private const string CloseGlyph = "\uE711";    // Close
    private const double DefaultRadiusMeters = 100; // Web EMPTY_FORM radius.

    private readonly GeofenceDrawerViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly GeofenceDrawerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly TextBlock _titleText = new();
    private readonly TextBlock _subtitleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly TsButton _newButton = new() { Variant = ButtonVariant.Primary };
    private readonly TsButton _refresh = new() { Variant = ButtonVariant.Subtle };
    private readonly TsButton _close = new() { Variant = ButtonVariant.Icon, IconGlyph = CloseGlyph };
    private readonly TsMapControl _map = new();
    private readonly TsGeofenceDrawer _fenceLayer = new();
    private readonly TsLiveStaleDataBanner _staleBanner = new() { IsOpen = false };
    private readonly TsOfflineBanner _offlineBanner = new() { IsOpen = false };
    private readonly TextBlock _listHeading = new();
    private readonly StackPanel _listColumn = new() { Spacing = 4 };
    private readonly ScrollViewer _listHost = new();
    private readonly ContentControl _listSlot = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    private IReadOnlyList<GeoPoint> _fenceCenters = Array.Empty<GeoPoint>();
    private bool _needsFit;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and diagnostics.</summary>
    public GeofenceDrawer(
        IGeofenceDrawerSource source,
        ILocalizer localizer,
        GeofenceDrawerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new GeofenceDrawerDiagnostics();
        _viewModel = new GeofenceDrawerViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        MinWidth = 480;
        MinHeight = 420;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        _map.AddOverlay(_fenceLayer);
        _map.SizeChanged += OnMapSizeChanged;

        var escape = new KeyboardAccelerator { Key = Windows.System.VirtualKey.Escape };
        escape.Invoked += OnEscapeInvoked;
        KeyboardAccelerators.Add(escape);

        AutomationProperties.SetName(this, _viewModel.Title);
        AutomationProperties.SetLandmarkType(this, AutomationLandmarkType.Main);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>Raised when the user asks to dismiss the surface (close affordance or <c>Escape</c>).</summary>
    public event EventHandler? CloseRequested;

    /// <summary>Raised when the user starts creating a geofence; carries the proposed geometry.</summary>
    public event EventHandler<NewGeofence>? GeofenceCreateRequested;

    /// <summary>Raised when the user asks to edit a geofence; carries its id.</summary>
    public event EventHandler<string>? GeofenceEditRequested;

    /// <summary>Raised when the user asks to remove a geofence; carries its id.</summary>
    public event EventHandler<string>? GeofenceDeleteRequested;

    /// <summary>The canonical surface id this registers under (<c>geofence-drawer</c>).</summary>
    public static string RegistryId => GeofenceDrawerRegistration.Id;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="GeofenceDrawerSource"/> from the
    /// shared data layer (the host's P2-core dependencies).
    /// </summary>
    public static GeofenceDrawer Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        GeofenceDrawerDiagnostics? diagnostics = null)
    {
        var source = new GeofenceDrawerSource(api, engine, options);
        return new GeofenceDrawer(source, localizer, diagnostics);
    }

    /// <summary>
    /// Present the surface as a modal dialog: a <see cref="ContentDialog"/> supplies the focus trap,
    /// light-dismiss handling and focus restoration to the invoking element. Resolves when dismissed.
    /// </summary>
    public async Task ShowAsync(XamlRoot xamlRoot)
    {
        ArgumentNullException.ThrowIfNull(xamlRoot);
        var dialog = new ContentDialog
        {
            XamlRoot = xamlRoot,
            Content = this,
            CloseButtonText = _localizer.GetString("common.close", "Close"),
        };
        AutomationProperties.SetName(dialog, _viewModel.Title);

        void OnClose(object? sender, EventArgs e) => dialog.Hide();
        CloseRequested += OnClose;
        try
        {
            await dialog.ShowAsync();
        }
        finally
        {
            CloseRequested -= OnClose;
        }
    }

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

    private void BuildChrome()
    {
        var mapIcon = new FontIcon { Glyph = MapGlyph, FontSize = 16, Foreground = DisplayTokens.Accent, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(mapIcon, AccessibilityView.Raw);

        _titleText.FontSize = 18;
        _titleText.FontWeight = FontWeights.SemiBold;
        _titleText.Foreground = DisplayTokens.TextPrimary;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _subtitleText.FontSize = 12;
        _subtitleText.Foreground = DisplayTokens.TextMuted;
        _subtitleText.TextWrapping = TextWrapping.Wrap;

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(mapIcon);
        titleRow.Children.Add(_titleText);

        var titleColumn = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        titleColumn.Children.Add(titleRow);
        titleColumn.Children.Add(_subtitleText);

        _newButton.IconGlyph = AddGlyph;
        _newButton.Text = _localizer.GetString("geofences.drawer.new", "New geofence");
        AutomationProperties.SetName(_newButton, _localizer.GetString("geofences.drawer.new", "New geofence"));
        _newButton.Click += OnNewClick;

        _refresh.IconGlyph = RefreshGlyph;
        AutomationProperties.SetName(_refresh, _localizer.GetString("geofences.drawer.refresh", "Refresh geofences"));
        _refresh.Click += OnRefreshClick;

        AutomationProperties.SetName(_close, _localizer.GetString("common.close", "Close"));
        _close.Click += OnCloseClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_newButton);
        actions.Children.Add(_refresh);
        actions.Children.Add(_close);

        var header = new Grid { Padding = new Thickness(16, 14, 12, 10), ColumnSpacing = 12 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(titleColumn, 0);
        Grid.SetColumn(actions, 1);
        header.Children.Add(titleColumn);
        header.Children.Add(actions);

        _staleBanner.ActionText = _localizer.GetString("geofences.drawer.refresh", "Refresh geofences");
        _staleBanner.ActionInvoked += OnRefreshClick;
        _offlineBanner.ActionText = _localizer.GetString("geofences.drawer.retry", "Retry");
        _offlineBanner.ActionInvoked += OnRefreshClick;

        var banners = new StackPanel { Spacing = 6, Padding = new Thickness(16, 0, 16, 0) };
        banners.Children.Add(_staleBanner);
        banners.Children.Add(_offlineBanner);

        _map.MapStyle = MapStyleKind.Dark;
        _map.EmptyMessage = _viewModel.EmptyMessage;
        _map.MinWidth = 280;

        _listHeading.FontSize = 11;
        _listHeading.FontWeight = FontWeights.Medium;
        _listHeading.CharacterSpacing = 80;
        _listHeading.Foreground = DisplayTokens.TextMuted;
        _listHeading.Text = _localizer.GetString("geofences.drawer.listHeading", "Geofences").ToUpper(CultureInfo.CurrentCulture);

        _listHost.VerticalScrollMode = ScrollMode.Auto;
        _listHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _listHost.HorizontalScrollMode = ScrollMode.Disabled;
        _listHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _listHost.Content = _listColumn;
        _listSlot.Content = _listHost;
        AutomationProperties.SetName(_listColumn, _localizer.GetString("geofences.drawer.listHeading", "Geofences"));

        var listPanel = new StackPanel { Spacing = 8, Padding = new Thickness(12, 12, 16, 16) };
        listPanel.Children.Add(_listHeading);
        listPanel.Children.Add(_listSlot);

        var body = new Grid { ColumnSpacing = 0 };
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(320) });
        Grid.SetColumn(_map, 0);
        Grid.SetColumn(listPanel, 1);
        body.Children.Add(_map);
        body.Children.Add(listPanel);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(header, 0);
        Grid.SetRow(banners, 1);
        Grid.SetRow(body, 2);
        _root.Children.Add(header);
        _root.Children.Add(banners);
        _root.Children.Add(body);
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

    private void OnEscapeInvoked(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args)
    {
        args.Handled = true;
        CloseRequested?.Invoke(this, EventArgs.Empty);
    }

    private void OnCloseClick(object sender, RoutedEventArgs e) => CloseRequested?.Invoke(this, EventArgs.Empty);

    private void OnRefreshClick(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnNewClick(object sender, RoutedEventArgs e)
    {
        var proposed = new NewGeofence(
            GeofenceShape.Circle,
            Lat: _map.CenterLat,
            Lng: _map.CenterLng,
            RadiusMeters: DefaultRadiusMeters);
        GeofenceCreateRequested?.Invoke(this, proposed);
    }

    private void OnMapSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (_needsFit)
        {
            FitMap();
        }
    }

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
            case GeofenceDrawerState.Loading:
                Content = BuildLoading();
                break;

            case GeofenceDrawerState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                UpdateBanners();
                UpdateMap();
                UpdateList();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        _titleText.Text = _viewModel.Title;
        _subtitleText.Text = _viewModel.Description;
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private void UpdateBanners()
    {
        _staleBanner.Message = _localizer.GetString(
            "geofences.drawer.stale",
            "These geofences may be out of date. Refresh for the latest.");
        _staleBanner.IsOpen = _viewModel.State == GeofenceDrawerState.Stale;

        _offlineBanner.Message = _viewModel.ErrorMessage ?? _localizer.GetString(
            "geofences.drawer.error.offline",
            "You're offline — showing the last cached geofences");
        _offlineBanner.IsOpen = _viewModel.State == GeofenceDrawerState.Offline;
    }

    private void UpdateMap()
    {
        _fenceLayer.SetGeofences(_viewModel.Fences);
        _map.SetHasGeometry(_viewModel.Fences.Count > 0);

        var centers = new List<GeoPoint>(_viewModel.Fences.Count);
        foreach (var fence in _viewModel.Fences)
        {
            if (fence is { Lat: { } lat, Lng: { } lng })
            {
                centers.Add(new GeoPoint(lat, lng));
            }
        }

        _fenceCenters = centers;
        FitMap();
    }

    private void FitMap()
    {
        if (_fenceCenters.Count == 0)
        {
            _needsFit = false;
            _map.Invalidate();
            return;
        }

        if (_map.ViewWidth > 0 && _map.ViewHeight > 0)
        {
            _needsFit = false;
            _map.FitBounds(_fenceCenters);
        }
        else
        {
            // Defer the fit until the map has been measured (handled in OnMapSizeChanged).
            _needsFit = true;
        }
    }

    private void UpdateList()
    {
        _listColumn.Children.Clear();
        if (_viewModel.HasFences)
        {
            foreach (var row in _viewModel.Rows)
            {
                _listColumn.Children.Add(BuildFenceRow(row));
            }
        }
        else
        {
            _listColumn.Children.Add(new TsEmptyState
            {
                IconGlyph = MapGlyph,
                Message = _viewModel.EmptyMessage,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            });
        }
    }

    private Border BuildFenceRow(GeofenceRow row)
    {
        var name = new TextBlock
        {
            Text = row.Name,
            FontSize = 14,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };
        var description = new TextBlock
        {
            Text = row.Description,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };
        var text = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(name);
        text.Children.Add(description);

        var edit = new TsButton { Variant = ButtonVariant.Subtle, IconGlyph = EditGlyph, Tag = row.Id };
        AutomationProperties.SetName(edit, $"{_localizer.GetString("geofences.drawer.edit", "Edit")} {row.Name}");
        edit.Click += OnEditClick;

        var delete = new TsButton { Variant = ButtonVariant.Destructive, IconGlyph = DeleteGlyph, Tag = row.Id };
        AutomationProperties.SetName(delete, $"{_localizer.GetString("geofences.drawer.delete", "Remove")} {row.Name}");
        delete.Click += OnDeleteClick;

        var rowActions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        rowActions.Children.Add(edit);
        rowActions.Children.Add(delete);

        var grid = new Grid { ColumnSpacing = 8, Padding = new Thickness(8, 6, 6, 6) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(text, 0);
        Grid.SetColumn(rowActions, 1);
        grid.Children.Add(text);
        grid.Children.Add(rowActions);

        var surface = new Border
        {
            Child = grid,
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
        };
        AutomationProperties.SetName(surface, row.AutomationName);
        return surface;
    }

    private void OnEditClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { Tag: string id } && !string.IsNullOrEmpty(id))
        {
            GeofenceEditRequested?.Invoke(this, id);
        }
    }

    private void OnDeleteClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { Tag: string id } && !string.IsNullOrEmpty(id))
        {
            GeofenceDeleteRequested?.Invoke(this, id);
        }
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(16) };
        column.Children.Add(new TsSkeleton { BlockHeight = 220 });
        for (int i = 0; i < 3; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("geofences.drawer.loading", "Loading geofences"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Title = _localizer.GetString("geofences.drawer.error.title", "Couldn't load geofences"),
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("geofences.drawer.error", "Couldn't load geofences"),
            ActionText = _localizer.GetString("geofences.drawer.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRefreshClick;
        return error;
    }
}
