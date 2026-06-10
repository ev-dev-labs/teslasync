using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Maps;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using ShapeEllipse = Microsoft.UI.Xaml.Shapes.Ellipse;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>TripPlannerMap</c> feature surface — a parity port of
/// web/src/features/driving/components/TripPlannerMap.tsx. It is presentational: assign a <see cref="Model"/> and it
/// renders the web composition inside a <see cref="TsGlassPanel"/> (the web <c>GlassPanel</c>, edge-to-edge and
/// rounded). When an origin and/or destination is set it renders the slippy <see cref="TsMapControl"/> (the web
/// Leaflet <c>MapContainer</c> with the dark tile layer) carrying the blue route <see cref="TsMapPolyline"/> (the web
/// <c>Polyline</c>), the green origin and red destination markers, and a blue marker per charge stop — each the web
/// Leaflet <c>CircleMarker</c>, with its <c>Popup</c> reproduced as an on-activation flyout and its copy mirrored as a
/// Narrator label. When neither endpoint is set it renders the "enter origin and destination" empty state — never a
/// blank box — and while the parent has not supplied a model it renders skeleton chrome. All branch selection,
/// geometry and label resolution happen in the WinUI-free <see cref="TripPlannerMapProjection"/>; the view never
/// performs HTTP. Every string resolves through the i18n facade and the decorative empty glyph is hidden from Narrator.
/// </summary>
public sealed partial class TripPlannerMap : ContentControl
{
    private const double MapHeight = 400;      // web `h-[400px]`
    private const double CornerRadiusPx = 12;  // web `rounded-xl`
    private const double EmptyIconSize = 40;   // web MapPin empty glyph

    private readonly ILocalizer _localizer;
    private readonly TripPlannerMapDiagnostics _diagnostics;

    private TripPlannerMapModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="TripPlannerMapModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TripPlannerMap(
        ILocalizer localizer,
        TripPlannerMapModel? model = null,
        TripPlannerMapDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? TripPlannerMapModel.Pending;
        _diagnostics = diagnostics ?? new TripPlannerMapDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>TripPlannerMap</c>).</summary>
    public static string Slug => TripPlannerMapRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public TripPlannerMapModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void Render()
    {
        var display = TripPlannerMapProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        // web `<GlassPanel className="p-0 overflow-hidden rounded-xl">` wraps every state body.
        Content = new TsGlassPanel
        {
            Glow = GlassGlow.None,
            Padding = new Thickness(0),
            Content = BuildBody(display),
        };
    }

    private static UIElement BuildBody(TripPlannerMapDisplay display) => display.State switch
    {
        TripPlannerMapState.Loading => BuildLoading(display),
        TripPlannerMapState.Empty => BuildEmpty(display),
        _ => BuildMap(display),
    };

    // ── Loading (parent has not supplied a model — skeleton chrome, never a blank box) ──────────────────────
    private static Border BuildLoading(TripPlannerMapDisplay display)
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

        AutomationProperties.SetName(host, display.LoadingLabel);
        LiveRegion.Configure(host);
        LiveRegion.Announce(host);
        return host;
    }

    // ── Empty (web `<div className="h-[400px] flex items-center justify-center"><EmptyState/></div>`) ───────
    private static Grid BuildEmpty(TripPlannerMapDisplay display)
    {
        var host = new Grid { Height = MapHeight };
        host.Children.Add(new TsEmptyState
        {
            IconGlyph = TripPlannerMapRegistration.MapPinGlyph,
            Message = display.EmptyMessage,
            FontSize = EmptyIconSize,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        });
        return host;
    }

    // ── Map (web `<MapContainer>` with the dark tile layer, polyline and markers) ───────────────────────────
    private static Border BuildMap(TripPlannerMapDisplay display)
    {
        var map = new TsMapControl
        {
            MapStyle = MapStyleKind.Dark,        // web `<MapTileLayer style="dark" />`
            CenterLat = display.Center.Lat,
            CenterLng = display.Center.Lng,
            Zoom = display.Zoom,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };

        // web: polylinePoints.length >= 2 && <Polyline color="#3b82f6" weight={3} opacity={0.8} />.
        if (display.ShowPolyline)
        {
            var line = new TsMapPolyline();
            line.SetPoints(display.PolylinePoints);
            line.SetStroke(DisplayPrimitives.HexBrush(display.PolylineColorHex));
            map.AddOverlay(line);
        }

        // web: the origin, destination and charge-stop CircleMarkers (each with its Popup).
        foreach (var marker in display.Markers)
        {
            map.AddOverlay(new TripPlannerCircleMarker(marker));
        }

        map.SetHasGeometry(display.HasGeometry);

        AutomationProperties.SetName(map, display.MapLabel);
        AutomationProperties.SetLandmarkType(map, AutomationLandmarkType.Main);

        return new Border
        {
            Height = MapHeight,
            CornerRadius = new CornerRadius(CornerRadiusPx),
            Child = map,
        };
    }
}

/// <summary>
/// A fixed-pixel-diameter circle marker pinned to a geographic coordinate — the native analogue of the web Leaflet
/// <c>CircleMarker</c> the trip map uses for the origin, destination and charge stops. It repositions itself on the
/// map's overlay canvas on every projection change, carries its popup copy as a Narrator name + tooltip, and opens
/// the web <c>Popup</c> as a flyout when activated by pointer or keyboard so the location detail is reachable by both
/// sighted and assistive-technology users.
/// </summary>
internal sealed partial class TripPlannerCircleMarker : ContentControl, IMapOverlay
{
    private const double PopupSpacing = 2;
    private const double PopupMinWidth = 140;
    private const double PopupPadding = 12;
    private const double TitleFontSize = 13;   // web popup `text-sm font-medium`
    private const double DetailFontSize = 12;

    private readonly double _diameter;
    private readonly TripPlannerMapMarker _data;
    private GeoPoint _location;
    private bool _flyoutOpen;

    /// <summary>Creates the marker from its projected data (location, colour, diameter, label and popup copy).</summary>
    /// <param name="data">The render-ready marker the projection produced.</param>
    public TripPlannerCircleMarker(TripPlannerMapMarker data)
    {
        ArgumentNullException.ThrowIfNull(data);

        _data = data;
        _diameter = data.DiameterPx;
        _location = data.Location;

        IsTabStop = true;
        UseSystemFocusVisuals = true;
        Width = _diameter;
        Height = _diameter;

        Content = new ShapeEllipse
        {
            Width = _diameter,
            Height = _diameter,
            Fill = DisplayPrimitives.HexBrush(data.ColorHex),
            Opacity = 0.9,                       // web `fillOpacity={0.9}`
            Stroke = DisplayTokens.Surface,
            StrokeThickness = 2,
        };

        if (!string.IsNullOrEmpty(data.AriaLabel))
        {
            AutomationProperties.SetName(this, data.AriaLabel);
            ToolTipService.SetToolTip(this, data.AriaLabel);
        }

        Tapped += OnTapped;
        KeyDown += OnKeyDown;
    }

    /// <summary>The marker's geographic location.</summary>
    public GeoPoint Location
    {
        get => _location;
        set => _location = value;
    }

    /// <summary>Reposition against the current projection so the dot stays centred on its coordinate.</summary>
    public void Project(IMapProjection projection)
    {
        ArgumentNullException.ThrowIfNull(projection);
        var screen = projection.ToScreen(_location);
        Canvas.SetLeft(this, screen.X - (_diameter / 2));
        Canvas.SetTop(this, screen.Y - (_diameter / 2));
    }

    private void OnTapped(object sender, TappedRoutedEventArgs e)
    {
        ShowPopup();
        e.Handled = true;
    }

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key is Windows.System.VirtualKey.Enter or Windows.System.VirtualKey.Space)
        {
            ShowPopup();
            e.Handled = true;
        }
    }

    private void ShowPopup()
    {
        if (_flyoutOpen)
        {
            return;
        }

        var column = new StackPanel { Spacing = PopupSpacing, MinWidth = PopupMinWidth };
        column.Children.Add(new TextBlock
        {
            Text = _data.PopupTitle,
            FontSize = TitleFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        });

        foreach (var line in _data.PopupDetailLines)
        {
            column.Children.Add(new TextBlock
            {
                Text = line,
                FontSize = DetailFontSize,
                Foreground = DisplayTokens.TextSecondary,
                TextWrapping = TextWrapping.Wrap,
            });
        }

        AutomationProperties.SetName(column, _data.AriaLabel);

        var flyout = new Flyout
        {
            Content = new TsGlassPanel
            {
                Glow = GlassGlow.None,
                Padding = new Thickness(PopupPadding),
                Content = column,
            },
        };
        flyout.Closed += (_, _) => _flyoutOpen = false;
        _flyoutOpen = true;
        flyout.ShowAt(this);
    }
}
