using Microsoft.UI.Dispatching;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Maps;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>MapTileLayer</c> shared surface — a parity port of the web <c>MapTileLayer</c>
/// (web/src/components/maps/MapTileLayer.tsx). The web component renders a Leaflet <c>TileLayer</c> whose URL +
/// attribution are selected from the <c>useQuery(['map-config'], getMapConfig)</c> result (free community tiles by
/// default; Azure / Google tiles when a provider + key are configured). Natively the base tiles are painted by the
/// shared <see cref="TsMapControl"/> (the Leaflet <c>MapContainer</c> analogue) configured from the resolved
/// <see cref="MapConfig"/>, while this surface adds the data-binding layer and the full state matrix on top: a
/// busy overlay while the config loads, an error overlay with a retry affordance, stale / offline chips over the
/// cached tiles, and an empty note when no provider is configured. It binds the <see cref="MapTileLayerViewModel"/>
/// (over the P1/S8 <see cref="IMapTileLayerSource"/>), reads no query itself, never surfaces the provider key, and
/// emits the <c>view.opened</c> diagnostic once when shown.
/// </summary>
public sealed partial class MapTileLayer : ContentControl, IDisposable
{
    private const double ChipSpacing = 6;
    private const double ChipIconSize = 14;
    private const double Inset = 8;
    private const double ScrimPadding = 16;
    private const double ScrimRadius = 8;
    private const double ChipRadius = 6;

    private readonly ILocalizer _localizer;
    private readonly MapTileLayerViewModel _viewModel;
    private readonly MapTileLayerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly TsMapControl _map = new();

    private readonly Border _statusChip = new()
    {
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Top,
        Margin = new Thickness(Inset),
        Padding = new Thickness(8, 4, 8, 4),
        CornerRadius = new CornerRadius(ChipRadius),
        Visibility = Visibility.Collapsed,
    };

    private readonly FontIcon _chipIcon = new() { FontSize = ChipIconSize, VerticalAlignment = VerticalAlignment.Center };
    private readonly Text _chipText = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly Caption _emptyNote = new()
    {
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Bottom,
        Margin = new Thickness(Inset),
        Visibility = Visibility.Collapsed,
    };

    private readonly TsFullscreenButton _fullscreen = new()
    {
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Top,
        Margin = new Thickness(Inset),
    };

    private readonly Border _loadingScrim = new()
    {
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
        Padding = new Thickness(ScrimPadding),
        CornerRadius = new CornerRadius(ScrimRadius),
        Visibility = Visibility.Collapsed,
    };

    private readonly TsSpinner _spinner = new() { Size = ControlSize.Medium };

    private readonly Border _errorScrim = new()
    {
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
        Padding = new Thickness(ScrimPadding),
        CornerRadius = new CornerRadius(ScrimRadius),
        Visibility = Visibility.Collapsed,
    };

    private readonly TsErrorDisplay _error = new() { IconGlyph = MapTileLayerRegistration.OfflineGlyph };

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the surface with no composition root (the designer / parameterless host entry point): it binds a
    /// static, ready free-tile snapshot so the surface renders its visible state. Supply an explicit
    /// <see cref="ILocalizer"/> and a bound <see cref="IMapTileLayerSource"/> via the other constructor to drive
    /// i18n and the map configuration from the composition root.
    /// </summary>
    public MapTileLayer()
        : this(
            PassthroughLocalizer.Instance,
            new StaticMapTileLayerSource(MapTileLayerSnapshot.Ready(MapStyleKind.Dark)),
            diagnostics: null)
    {
    }

    /// <summary>Creates the surface over the i18n facade and a bound map-config seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="source">The map-config state-holder seam (web <c>useQuery(['map-config'])</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public MapTileLayer(
        ILocalizer localizer,
        IMapTileLayerSource source,
        MapTileLayerDiagnostics? diagnostics = null)
        : this(localizer, new MapTileLayerViewModel(localizer, source), diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="localizer">The i18n facade the static chrome resolves through.</param>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public MapTileLayer(
        ILocalizer localizer,
        MapTileLayerViewModel viewModel,
        MapTileLayerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(viewModel);

        _localizer = localizer;
        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new MapTileLayerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        MinHeight = 240;

        // The base tiles are the surface's content, so suppress the map's own "no geometry" empty state and let
        // the configured raster tiles render as the always-present base layer (the web TileLayer).
        _map.SetHasGeometry(true);
        AutomationProperties.SetAutomationId(_map, MapTileLayerRegistration.MapAutomationId);

        _statusChip.Background = DisplayTokens.Surface;
        _statusChip.BorderBrush = DisplayTokens.Border;
        _statusChip.BorderThickness = new Thickness(1);
        var chipRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = ChipSpacing };
        chipRow.Children.Add(_chipIcon);
        chipRow.Children.Add(_chipText);
        _statusChip.Child = chipRow;
        AutomationProperties.SetAutomationId(_statusChip, MapTileLayerRegistration.StatusChipAutomationId);
        LiveRegion.Configure(_statusChip);

        _loadingScrim.Background = DisplayTokens.Surface;
        _loadingScrim.Child = _spinner;
        AutomationProperties.SetAutomationId(_loadingScrim, MapTileLayerRegistration.LoadingAutomationId);

        _errorScrim.Background = DisplayTokens.Surface;
        _errorScrim.Child = _error;
        _error.ActionInvoked += OnRetryInvoked;
        AutomationProperties.SetAutomationId(_errorScrim, MapTileLayerRegistration.ErrorAutomationId);

        AutomationProperties.SetAutomationId(_fullscreen, MapTileLayerRegistration.FullscreenAutomationId);
        string fullscreenLabel = _localizer.GetString(
            MapTileLayerRegistration.FullscreenKey, MapTileLayerRegistration.FullscreenFallback);
        AutomationProperties.SetName(_fullscreen, fullscreenLabel);
        ToolTipService.SetToolTip(_fullscreen, fullscreenLabel);

        _root.Children.Add(_map);
        _root.Children.Add(_emptyNote);
        _root.Children.Add(_statusChip);
        _root.Children.Add(_fullscreen);
        _root.Children.Add(_loadingScrim);
        _root.Children.Add(_errorScrim);
        Content = _root;

        AutomationProperties.SetAutomationId(this, MapTileLayerRegistration.RootAutomationId);

        // Honour the OS reduce-motion preference: a subtle entrance transition only when animations are enabled
        // (the web component's motion-safe mount), snapping to the final state otherwise.
        if (!MotionPreference.ReduceMotion)
        {
            _root.Transitions = new TransitionCollection { new EntranceThemeTransition() };
        }

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>MapTileLayer</c>).</summary>
    public static string Slug => MapTileLayerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public MapTileLayerViewModel ViewModel => _viewModel;

    /// <summary>
    /// The window the fullscreen toggle drives (the web <c>MapFullscreenControl</c> target). Null leaves the
    /// toggle inert; the composition root wires it to the hosting window so the map can go fullscreen.
    /// </summary>
    public AppWindow? FullscreenWindow
    {
        get => _fullscreen.AppWindow;
        set => _fullscreen.AppWindow = value;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _error.ActionInvoked -= OnRetryInvoked;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnRetryInvoked(object? sender, EventArgs e) => _viewModel.RequestRefresh();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        var projection = _viewModel.Projection;

        // The base tiles always render (free fallback while the provider config loads / fails), matching the web
        // component which renders the TileLayer immediately and swaps providers when the query resolves.
        _map.SetConfig(projection.Config);
        _map.MapStyle = projection.Style;

        _spinner.Label = projection.LoadingLabel;
        _loadingScrim.Visibility = projection.ShowLoading ? Visibility.Visible : Visibility.Collapsed;

        _error.Title = projection.ErrorTitle;
        _error.Message = projection.ErrorMessage;
        _error.ActionText = projection.RetryLabel;
        _errorScrim.Visibility = projection.ShowError ? Visibility.Visible : Visibility.Collapsed;

        _emptyNote.Value = projection.EmptyNote;
        _emptyNote.Visibility = projection.ShowEmptyNote ? Visibility.Visible : Visibility.Collapsed;

        RenderStatusChip(projection);

        AutomationProperties.SetName(this, projection.AccessibleName);
    }

    private void RenderStatusChip(MapTileLayerProjection projection)
    {
        if (!projection.ShowStaleChip && !projection.ShowOfflineChip)
        {
            _statusChip.Visibility = Visibility.Collapsed;
            return;
        }

        bool offline = projection.ShowOfflineChip;
        _chipIcon.Glyph = offline ? MapTileLayerRegistration.OfflineGlyph : MapTileLayerRegistration.StaleGlyph;
        _chipIcon.Foreground = DisplayTokens.Brush(offline ? "TsColorDangerBrush" : "TsColorWarningBrush");
        _chipText.Value = offline ? projection.OfflineLabel : projection.StaleLabel;

        AutomationProperties.SetName(_statusChip, _chipText.Value);
        _statusChip.Visibility = Visibility.Visible;
        LiveRegion.Announce(_statusChip);
    }

    private void Marshal(Action action)
    {
        if (_dispatcher is null || _dispatcher.HasThreadAccess)
        {
            action();
        }
        else
        {
            _dispatcher.TryEnqueue(() => action());
        }
    }
}
