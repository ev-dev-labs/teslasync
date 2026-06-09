using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Maps;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>TeslaChargingSessionsMap</c> feature surface — a parity port of
/// <c>web/src/features/charging/pages/TeslaChargingSessionsMap.tsx</c>. It renders the fleet charging-sessions on a
/// slippy map: a <see cref="TsMapControl"/> (the web Leaflet <c>MapContainer</c>) centred on the mean session
/// coordinate at zoom 5, with a <see cref="TsMarkerCluster"/> (the web <c>MarkerCluster</c>, <c>maxClusterRadius</c>
/// 60, cyan markers) whose single markers open a popup of the session's site / time / energy / cost / charger — the
/// web <c>popupHtml</c>. All data flows through the shared <see cref="TeslaChargingSessionsMapViewModel"/>; the view
/// never performs HTTP. It reproduces every state from the web data flow — a skeleton while loading, a retryable
/// error surface on a hard failure, the map (with a "no location data" overlay when no session has coordinates) once
/// resolved, and a stale / offline freshness chip while a cached payload is shown. Every string resolves through the
/// i18n facade, the map region carries the web <c>aria-label</c>, and each marker carries its own Narrator label.
/// </summary>
public sealed partial class TeslaChargingSessionsMap : ContentControl, IDisposable
{
    private const double MapHeight = 350;       // web h-[350px]
    private const double CornerRadiusPx = 8;    // web rounded-lg
    private const double ClusterRadiusPx = 60;  // web maxClusterRadius={60}
    private const double PopupSpacing = 4;
    private const double PopupMinWidth = 168;
    private const double DetailFontSize = 12;    // web popup font-size:12px
    private const double SiteNameFontSize = 13;

    private readonly TeslaChargingSessionsMapViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly TeslaChargingSessionsMapDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Border _mapHost = new() { CornerRadius = new CornerRadius(CornerRadiusPx), Height = MapHeight };
    private readonly Grid _mapGrid = new();
    private readonly TsMapControl _map = new();
    private readonly TsMarkerCluster _cluster = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Border _freshnessHolder = new();
    private readonly Dictionary<string, TeslaChargingSessionMapPoint> _pointsById = new(StringComparer.Ordinal);

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, currency symbol and diagnostics.</summary>
    /// <param name="source">The cache-then-network charging-sessions data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The active currency symbol for the popup cost line (default "$").</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TeslaChargingSessionsMap(
        ITeslaChargingSessionsMapSource source,
        ILocalizer localizer,
        string? currencySymbol = null,
        TeslaChargingSessionsMapDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new TeslaChargingSessionsMapDiagnostics();
        _viewModel = new TeslaChargingSessionsMapViewModel(source, localizer, currencySymbol);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildMapChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>TeslaChargingSessionsMap</c>).</summary>
    public static string Slug => TeslaChargingSessionsMapRegistration.Slug;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="TeslaChargingSessionsMapSource"/> from the
    /// shared data layer (the host's P2-core dependencies).
    /// </summary>
    public static TeslaChargingSessionsMap Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        string? currencySymbol = null,
        TeslaChargingSessionsMapDiagnostics? diagnostics = null)
    {
        var source = new TeslaChargingSessionsMapSource(api, engine, options);
        return new TeslaChargingSessionsMap(source, localizer, currencySymbol, diagnostics);
    }

    private void BuildMapChrome()
    {
        _map.HorizontalAlignment = HorizontalAlignment.Stretch;
        _map.VerticalAlignment = VerticalAlignment.Stretch;
        _cluster.SetClusterRadius(ClusterRadiusPx);
        _cluster.PointActivated += OnPointActivated;

        _freshnessHolder.HorizontalAlignment = HorizontalAlignment.Right;
        _freshnessHolder.VerticalAlignment = VerticalAlignment.Top;
        _freshnessHolder.Margin = new Thickness(0, 8, 8, 0);
        _freshnessHolder.Padding = new Thickness(8, 4, 8, 4);
        _freshnessHolder.CornerRadius = new CornerRadius(CornerRadiusPx);
        _freshnessHolder.Background = DisplayTokens.Surface;
        _freshnessHolder.Child = _freshness;
        _freshnessHolder.Visibility = Visibility.Collapsed;

        _mapGrid.Children.Add(_map);
        _mapGrid.Children.Add(_freshnessHolder);
        _mapHost.Child = _mapGrid;

        // Web parity: role="application" + aria-label on the map container.
        AutomationProperties.SetName(_mapHost, _viewModel.MapLabel);
        AutomationProperties.SetLandmarkType(_mapHost, AutomationLandmarkType.Main);
        AutomationProperties.SetName(this, _viewModel.MapLabel);
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
        _cluster.PointActivated -= OnPointActivated;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
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
            case TeslaChargingSessionsMapState.Loading:
                Content = BuildLoading();
                break;

            case TeslaChargingSessionsMapState.Error:
                Content = BuildError();
                break;

            default:
                UpdateMap();
                Content = _mapHost;
                break;
        }
    }

    // ── Map (web MapContainer + MarkerCluster) ──────────────────────────────────────────────────────────
    private void UpdateMap()
    {
        var display = _viewModel.Display;

        AutomationProperties.SetName(_mapHost, display.MapLabel);
        AutomationProperties.SetName(this, display.MapLabel);

        _map.CenterLat = display.CenterLatitude;
        _map.CenterLng = display.CenterLongitude;
        _map.Zoom = display.Zoom;
        _map.EmptyMessage = display.EmptyMessage;

        _map.ClearOverlays();
        _pointsById.Clear();

        if (display.HasPoints)
        {
            var clusterPoints = new List<ClusterPoint>(display.Points.Count);
            foreach (var point in display.Points)
            {
                _pointsById[point.Id] = point;
                clusterPoints.Add(new ClusterPoint(
                    point.Id, point.Latitude, point.Longitude, point.MarkerColor, point.AriaLabel));
            }

            _cluster.SetPoints(clusterPoints);
            _map.AddOverlay(_cluster);
            _map.SetHasGeometry(true);
        }
        else
        {
            // No marker has coordinates — let the map render its built-in "no location data" empty overlay.
            _cluster.SetPoints(Array.Empty<ClusterPoint>());
            _map.SetHasGeometry(false);
        }

        UpdateFreshness();
    }

    private void UpdateFreshness()
    {
        bool show = _viewModel.IsStale || _viewModel.IsOffline;
        _freshnessHolder.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        if (!show)
        {
            return;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        AutomationProperties.SetName(
            _freshnessHolder, _viewModel.IsOffline ? _viewModel.OfflineLabel : _viewModel.StaleLabel);
    }

    // ── Marker popup (web Leaflet popup) ────────────────────────────────────────────────────────────────
    private void OnPointActivated(object? sender, ClusterPoint clusterPoint)
    {
        if (!_pointsById.TryGetValue(clusterPoint.Id, out var point))
        {
            return;
        }

        var column = new StackPanel { Spacing = PopupSpacing, MinWidth = PopupMinWidth };
        column.Children.Add(new TextBlock
        {
            Text = point.SiteName,
            FontSize = SiteNameFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        });

        foreach (var line in point.DetailLines)
        {
            column.Children.Add(new TextBlock
            {
                Text = line,
                FontSize = DetailFontSize,
                Foreground = DisplayTokens.TextSecondary,
                TextWrapping = TextWrapping.Wrap,
            });
        }

        AutomationProperties.SetName(column, point.AriaLabel);

        var flyout = new Flyout
        {
            Content = new TsGlassPanel
            {
                Glow = GlassGlow.Cyan,
                Padding = new Thickness(12),
                Content = column,
            },
        };
        flyout.ShowAt(_map);
    }

    // ── Loading (the parent query still resolving) ──────────────────────────────────────────────────────
    private Border BuildLoading()
    {
        var skeleton = new TsSkeleton
        {
            BlockHeight = MapHeight,
            Radius = CornerRadiusPx,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        var host = new Border
        {
            CornerRadius = new CornerRadius(CornerRadiusPx),
            Height = MapHeight,
            Child = skeleton,
        };

        AutomationProperties.SetName(host, _viewModel.LoadingLabel);
        LiveRegion.Configure(host);
        LiveRegion.Announce(host);
        return host;
    }

    // ── Error (hard failure, no cache — web QueryError) ─────────────────────────────────────────────────
    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorText,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            MinHeight = MapHeight,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();
}
