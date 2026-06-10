using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Maps;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using ShapeEllipse = Microsoft.UI.Xaml.Shapes.Ellipse;
using ShapeRectangle = Microsoft.UI.Xaml.Shapes.Rectangle;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>RouteMapSection</c> feature surface — a parity port of
/// web/src/features/driving/components/drive-detail/RouteMapSection.tsx. It is presentational: assign a
/// <see cref="Model"/> and it renders the web composition inside a <see cref="TsFadeIn"/> (the web <c>FadeIn</c>) — a
/// <see cref="TsGlassPanel"/> (the web <c>GlassPanel</c>) headed by the cyan map-pin glyph + the localized "Route"
/// title, over the state body. A meaningful GPS trail renders the slippy <see cref="TsMapControl"/> (the web Leaflet
/// <c>MapContainer</c>) with a <see cref="TsMapLayerSwitcher"/> (the web <c>MapLayerSwitcher</c>), one speed-coloured
/// <see cref="TsMapPolyline"/> per leg (the web <c>Polyline</c> set), the green start and red end circle markers (the
/// web <c>CircleMarker</c>s, each carrying its popup copy as a Narrator label), and the speed legend whose thresholds
/// are converted to the user's display unit at this render boundary. A stationary single-fix drive renders one cyan
/// anchor marker plus the "route can't be plotted" <see cref="TsAlertBanner"/> (the web <c>AlertBanner</c>) instead of
/// a collapsed dot, and a drive with no trail renders the "no route data" empty state — never a blank box. While the
/// parent has not resolved the drive the surface renders skeleton chrome. All branch selection, unit conversion and
/// label resolution happen in the WinUI-free <see cref="RouteMapSectionProjection"/>; the view never performs HTTP.
/// Every string resolves through the i18n facade, decorative glyphs are hidden from Narrator, and the motion is the
/// system-honoured <see cref="TsFadeIn"/> so reduced-motion is respected by construction.
/// </summary>
public sealed partial class RouteMapSection : ContentControl
{
    private const double MapHeight = 320;        // web `h-80`
    private const double CornerRadiusPx = 8;     // web `rounded-lg`
    private const double HeaderIconSize = 16;    // web MapPin `h-4 w-4`
    private const double FlagIconSize = 12;      // web Flag `h-3 w-3`
    private const double EmptyIconSize = 40;     // web MapPin `h-10 w-10`
    private const double LegendChipWidth = 14;
    private const double LegendChipHeight = 4;
    private const double LegendFontSize = 12;    // web `text-xs`

    private const string StartColorHex = "#10b981";   // web emerald start marker
    private const string EndColorHex = "#ef4444";     // web red end marker
    private const string AnchorColorHex = "#22d3ee";  // web cyan "last known" marker
    private const string SpeedLowColorHex = "#10b981";   // web emerald (below low)
    private const string SpeedMedColorHex = "#00f0ff";   // web neon-cyan (low–med)
    private const string SpeedHighColorHex = "#f59e0b";  // web amber (med–high)
    private const string SpeedOverColorHex = "#ef4444";  // web red (above high)

    private const string DashSeparator = "\u2013"; // en dash between the speed-band bounds
    private const string LessThan = "<";
    private const string GreaterThan = ">";

    private readonly ILocalizer _localizer;
    private readonly UnitPref _unitPref;
    private readonly RouteMapSectionDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private RouteMapSectionModel _model;
    private bool _opened;

    private TsMapControl? _map;
    private IReadOnlyList<GeoPoint>? _fitTrail;

    /// <summary>Creates the surface over its i18n facade, unit prefs, an initial model, diagnostics and clock.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="unitPref">The user's display-unit preferences (web <c>useUnits().unitPrefs</c>).</param>
    /// <param name="model">The initial render model; defaults to <see cref="RouteMapSectionModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">The clock used to format the popup / legend times; defaults to <see cref="DateTimeOffset.Now"/>.</param>
    public RouteMapSection(
        ILocalizer localizer,
        UnitPref unitPref,
        RouteMapSectionModel? model = null,
        RouteMapSectionDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(unitPref);

        _localizer = localizer;
        _unitPref = unitPref;
        _model = model ?? RouteMapSectionModel.Pending;
        _diagnostics = diagnostics ?? new RouteMapSectionDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>RouteMapSection</c>).</summary>
    public static string Slug => RouteMapSectionRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public RouteMapSectionModel Model
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
        var display = RouteMapSectionProjection.Project(_model, _localizer, _unitPref, _clock());
        AutomationProperties.SetName(this, display.AutomationName);

        // web `<GlassPanel className="overflow-hidden">`: the heading over the state body.
        var column = new StackPanel { Spacing = 0 };
        column.Children.Add(BuildHeader(display));
        column.Children.Add(BuildBody(display));

        var panel = new TsGlassPanel { Glow = GlassGlow.None, Content = column };

        // web `<FadeIn>` wrapper — system-honoured entrance (reduced-motion shows the content immediately).
        Content = new TsFadeIn { Content = panel };
    }

    // ── Heading (web `<h3><MapPin/> Route</h3>`) ───────────────────────────────────────────────────────────
    private static StackPanel BuildHeader(RouteMapSectionDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Padding = new Thickness(16, 16, 16, 12),
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = RouteMapSectionRegistration.MapPinGlyph,
            FontSize = HeaderIconSize,
            Foreground = DisplayTokens.Brush("TsColorInfoBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        row.Children.Add(icon);

        row.Children.Add(new PanelTitle
        {
            Value = display.Title,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return row;
    }

    private UIElement BuildBody(RouteMapSectionDisplay display) => display.State switch
    {
        RouteMapSectionState.Loading => BuildLoading(display),
        RouteMapSectionState.Empty => BuildEmpty(display),
        _ => BuildMapBody(display),
    };

    // ── Loading (parent still resolving the drive — skeleton chrome) ───────────────────────────────────────
    private static Border BuildLoading(RouteMapSectionDisplay display)
    {
        var skeleton = new TsSkeleton
        {
            BlockHeight = MapHeight,
            Radius = CornerRadiusPx,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        var host = new Border
        {
            Margin = new Thickness(16, 0, 16, 16),
            CornerRadius = new CornerRadius(CornerRadiusPx),
            Height = MapHeight,
            Child = skeleton,
        };

        AutomationProperties.SetName(host, display.LoadingLabel);
        LiveRegion.Configure(host);
        LiveRegion.Announce(host);
        return host;
    }

    // ── Empty (web `trail.length === 0` — "No route data available for this drive") ────────────────────────
    private static TsEmptyState BuildEmpty(RouteMapSectionDisplay display) => new()
    {
        IconGlyph = RouteMapSectionRegistration.MapPinGlyph,
        Message = display.EmptyMessage,
        MinHeight = 256,
        Margin = new Thickness(16, 0, 16, 16),
    };

    // ── Map + legend (web map container over the legend row) ───────────────────────────────────────────────
    private StackPanel BuildMapBody(RouteMapSectionDisplay display)
    {
        var body = new StackPanel { Spacing = 0 };
        body.Children.Add(BuildMapHost(display));
        body.Children.Add(BuildLegend(display));
        return body;
    }

    private Border BuildMapHost(RouteMapSectionDisplay display)
    {
        var map = new TsMapControl
        {
            MapStyle = MapStyleKind.Dark,            // web initial mapStyle = 'dark'
            CenterLat = display.Center.Lat,
            CenterLng = display.Center.Lng,
            Zoom = display.Zoom,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        _map = map;

        AddOverlays(map, display);

        // web `<MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />` — floating top-right.
        var switcher = new TsMapLayerSwitcher
        {
            SelectedStyle = MapStyleKind.Dark,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 12, 12, 0),
        };
        switcher.StyleSelected += (_, style) => map.MapStyle = style;

        var grid = new Grid();
        grid.Children.Add(map);
        grid.Children.Add(switcher);

        // web stationary overlay: the AlertBanner pinned across the top of the map.
        if (display.State == RouteMapSectionState.Stationary)
        {
            var banner = new TsAlertBanner
            {
                Variant = CalloutVariant.Info,
                Dismissible = false,
                Title = display.StationaryTitle,
                Message = display.StationaryBody,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(12, 12, 12, 0),
            };
            grid.Children.Add(banner);
        }

        // web FitBounds: fit to the trail once the map has a measured size.
        _fitTrail = display.FitToTrail ? display.Trail : null;
        map.SizeChanged += (_, _) => TryFitBounds();
        map.Loaded += (_, _) => TryFitBounds();

        return new Border
        {
            Margin = new Thickness(16, 0, 16, 0),
            Height = MapHeight,
            CornerRadius = new CornerRadius(CornerRadiusPx),
            Child = grid,
        };
    }

    private static void AddOverlays(TsMapControl map, RouteMapSectionDisplay display)
    {
        bool hasGeometry = false;

        // web: hasRoute && speedSegments.map(seg => <Polyline color=seg.color weight=4 opacity=0.8 />).
        foreach (var segment in display.SpeedSegments)
        {
            if (segment.Positions.Count == 0)
            {
                continue;
            }

            var line = new TsMapPolyline();
            line.SetPoints(segment.Positions);
            line.SetStroke(DisplayPrimitives.HexBrush(segment.ColorHex));
            map.AddOverlay(line);
            hasGeometry = true;
        }

        if (display.StartMarker is { } start)
        {
            map.AddOverlay(BuildMarker(start, StartColorHex, 1.0, $"{display.StartLabel}. {display.StartPopupDetail}"));
            hasGeometry = true;
        }

        if (display.EndMarker is { } end)
        {
            map.AddOverlay(BuildMarker(end, EndColorHex, 1.0, $"{display.EndLabel}. {display.EndPopupDetail}"));
            hasGeometry = true;
        }

        if (display.AnchorMarker is { } anchor)
        {
            map.AddOverlay(BuildMarker(anchor, AnchorColorHex, 0.9, display.AnchorLabel));
            hasGeometry = true;
        }

        map.SetHasGeometry(hasGeometry);
    }

    private static RouteCircleMarker BuildMarker(GeoPoint location, string colorHex, double fillOpacity, string accessibleName)
    {
        var marker = new RouteCircleMarker(DisplayPrimitives.HexBrush(colorHex), fillOpacity, accessibleName)
        {
            Location = location,
        };
        return marker;
    }

    private void TryFitBounds()
    {
        if (_map is not { } map || _fitTrail is not { Count: > 1 } trail)
        {
            return;
        }

        if (map.ActualWidth <= 0 || map.ActualHeight <= 0)
        {
            return;
        }

        map.FitBounds(trail);
        _fitTrail = null; // one-shot, so the user can pan/zoom freely afterwards (web parity)
    }

    // ── Legend row (web `flex items-center justify-between`) ───────────────────────────────────────────────
    private static Grid BuildLegend(RouteMapSectionDisplay display)
    {
        var grid = new Grid { Padding = new Thickness(16, 12, 16, 12) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        // web: <span className="text-green-400"><Flag/> Start: {formatTime(startTs)}</span> — always shown.
        var start = BuildLegendEndpoint(
            display.StartLabel, display.StartLegendTime, DisplayTokens.Brush("TsColorSuccessBrush"));
        Grid.SetColumn(start, 0);
        grid.Children.Add(start);

        if (display.ShowSpeedLegend)
        {
            var legend = BuildSpeedLegend(display);
            Grid.SetColumn(legend, 1);
            grid.Children.Add(legend);
        }

        // web: {drive.endTs && <span className="text-red-400"><Flag/> End: {formatTime(endTs)}</span>}.
        if (display.ShowEndLegend)
        {
            var end = BuildLegendEndpoint(
                display.EndLabel, display.EndLegendTime, DisplayTokens.Brush("TsColorDangerBrush"));
            end.HorizontalAlignment = HorizontalAlignment.Right;
            Grid.SetColumn(end, 2);
            grid.Children.Add(end);
        }

        return grid;
    }

    private static StackPanel BuildLegendEndpoint(string label, string time, Brush accent)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var flag = new FontIcon
        {
            Glyph = RouteMapSectionRegistration.FlagGlyph,
            FontSize = FlagIconSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(flag, AccessibilityView.Raw);
        row.Children.Add(flag);

        row.Children.Add(new TextBlock
        {
            Text = string.Concat(label, ": ", time),
            FontSize = LegendFontSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return row;
    }

    private static StackPanel BuildSpeedLegend(RouteMapSectionDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(BuildSpeedChip(SpeedLowColorHex, string.Concat(LessThan, display.SpeedLowDisplay)));
        row.Children.Add(BuildSpeedChip(SpeedMedColorHex, string.Concat(display.SpeedLowDisplay, DashSeparator, display.SpeedMedDisplay)));
        row.Children.Add(BuildSpeedChip(SpeedHighColorHex, string.Concat(display.SpeedMedDisplay, DashSeparator, display.SpeedHighDisplay)));
        row.Children.Add(BuildSpeedChip(SpeedOverColorHex, string.Concat(GreaterThan, display.SpeedHighDisplay)));

        row.Children.Add(new Caption
        {
            Value = display.SpeedUnitLabel,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return row;
    }

    private static StackPanel BuildSpeedChip(string colorHex, string text)
    {
        var chip = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };

        chip.Children.Add(new ShapeRectangle
        {
            Width = LegendChipWidth,
            Height = LegendChipHeight,
            RadiusX = 2,
            RadiusY = 2,
            Fill = DisplayPrimitives.HexBrush(colorHex),
            VerticalAlignment = VerticalAlignment.Center,
        });

        chip.Children.Add(new TextBlock
        {
            Text = text,
            FontSize = LegendFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return chip;
    }
}

/// <summary>
/// A fixed-pixel-radius circle marker pinned to a geographic coordinate — the native analogue of the web Leaflet
/// <c>CircleMarker</c> the route map uses for the start / end / anchor dots (an 8-px-radius coloured circle, not a
/// metre-radius geofence). It repositions itself on the map's overlay canvas on every projection change and carries
/// the web popup copy as its Narrator name + tooltip so the location detail is available to assistive technology.
/// </summary>
internal sealed partial class RouteCircleMarker : ContentControl, IMapOverlay
{
    private const double DiameterPx = 16; // web CircleMarker radius={8}

    private GeoPoint _location;

    /// <summary>Creates the marker over its fill brush, fill opacity and accessible name.</summary>
    /// <param name="fill">The dot fill brush (the web <c>fillColor</c>).</param>
    /// <param name="fillOpacity">The dot fill opacity (the web <c>fillOpacity</c>).</param>
    /// <param name="accessibleName">The Narrator name carrying the web popup copy.</param>
    public RouteCircleMarker(Brush fill, double fillOpacity, string accessibleName)
    {
        ArgumentNullException.ThrowIfNull(fill);

        IsTabStop = false;
        Width = DiameterPx;
        Height = DiameterPx;

        var dot = new ShapeEllipse
        {
            Width = DiameterPx,
            Height = DiameterPx,
            Fill = fill,
            Opacity = fillOpacity,
            Stroke = DisplayTokens.Surface,
            StrokeThickness = 2,
        };
        Content = dot;

        if (!string.IsNullOrEmpty(accessibleName))
        {
            AutomationProperties.SetName(this, accessibleName);
            ToolTipService.SetToolTip(this, accessibleName);
        }
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
        Canvas.SetLeft(this, screen.X - (DiameterPx / 2));
        Canvas.SetTop(this, screen.Y - (DiameterPx / 2));
    }
}
