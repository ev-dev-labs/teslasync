using System.Globalization;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive surface state for the <c>TripPlannerMap</c> feature view — the native port of
/// web/src/features/driving/components/TripPlannerMap.tsx. The web source is a pure presentational component: it
/// receives the already-resolved <c>origin</c>, <c>destination</c>, <c>legs</c> and <c>chargeStops</c> props from
/// the parent trip-planner page (the page owns the plan mutation) and performs no fetching, so there is deliberately
/// no fetch-driven error / stale / offline branch to reproduce here — those belong to the parent page, not this
/// section (the same precedent the sibling <c>RouteMapSection</c> surface follows). The web component's own
/// conditional render maps to <see cref="Route"/> (<c>hasData</c> — an origin and/or destination is set) and
/// <see cref="Empty"/> (neither is set). The defensive <see cref="Loading"/> branch renders skeleton chrome while the
/// parent has not handed the section a model yet, so the surface is never a blank box.
/// </summary>
public enum TripPlannerMapState
{
    /// <summary>The parent has not supplied a model yet — render skeleton chrome.</summary>
    Loading,

    /// <summary>An origin and/or destination is set (web <c>hasData</c>) — render the map with its route geometry.</summary>
    Route,

    /// <summary>Neither origin nor destination is set — render the "enter origin and destination" empty state.</summary>
    Empty,
}

/// <summary>
/// One geographic place on the planned trip — the native analogue of the web <c>TripLocation</c> (<c>lat</c> /
/// <c>lng</c> / <c>name</c>). Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Lat">Latitude in degrees (web <c>lat</c>).</param>
/// <param name="Lng">Longitude in degrees (web <c>lng</c>).</param>
/// <param name="Name">The place label shown in the marker popup (web <c>name</c>); may be empty.</param>
public sealed record TripLocationInput(double Lat, double Lng, string? Name)
{
    /// <summary>This location as a shared <see cref="GeoPoint"/>.</summary>
    public GeoPoint ToGeoPoint() => new(Lat, Lng);
}

/// <summary>
/// One leg of the planned route — the native analogue of the web <c>TripLeg</c>. Only the endpoints the polyline is
/// drawn from are modelled (web reads <c>leg.from</c> / <c>leg.to</c>); the leg's SI distance / duration / energy
/// belong to the sibling summary surfaces, not this map. Pure data — unit-tested without a UI host.
/// </summary>
/// <param name="From">The leg's start coordinate (web <c>leg.from</c>).</param>
/// <param name="To">The leg's end coordinate (web <c>leg.to</c>).</param>
public sealed record TripLegInput(TripLocationInput From, TripLocationInput To);

/// <summary>
/// One charge stop on the planned route — the native analogue of the web <c>TripChargeStop</c>. Carries the site
/// name, the stop location and the SI charge window the popup renders (web <c>charge_from_soc</c> →
/// <c>charge_to_soc</c> over <c>charge_duration_s</c>). Pure data — unit-tested without a UI host.
/// </summary>
/// <param name="Name">The charger site name (web <c>stop.name</c>); the popup heading.</param>
/// <param name="Location">The stop coordinate (web <c>stop.location</c>).</param>
/// <param name="ChargeFromSoc">State of charge on arrival, percent (web <c>charge_from_soc</c>).</param>
/// <param name="ChargeToSoc">State of charge on departure, percent (web <c>charge_to_soc</c>).</param>
/// <param name="ChargeDurationS">Time charging, SI seconds (web <c>charge_duration_s</c>).</param>
public sealed record TripChargeStopInput(
    string Name,
    TripLocationInput Location,
    double ChargeFromSoc,
    double ChargeToSoc,
    double ChargeDurationS);

/// <summary>
/// The already-resolved route inputs the web component receives as props — the native analogue of the
/// <c>TripPlannerMapProps</c> bundle the parent trip-planner page builds from its plan. The page owns the plan
/// mutation and feeds these resolved values (a null origin / destination and empty leg / stop lists before a place is
/// picked). Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Origin">The trip origin (web <c>origin</c>), or null.</param>
/// <param name="Destination">The trip destination (web <c>destination</c>), or null.</param>
/// <param name="Legs">The planned legs the polyline is built from (web <c>legs</c>); never null.</param>
/// <param name="ChargeStops">The planned charge stops (web <c>chargeStops</c>); never null.</param>
public sealed record TripPlannerRoute(
    TripLocationInput? Origin,
    TripLocationInput? Destination,
    IReadOnlyList<TripLegInput> Legs,
    IReadOnlyList<TripChargeStopInput> ChargeStops);

/// <summary>
/// The render-time data model the <c>TripPlannerMap</c> view binds to. The section is presentational: the parent
/// trip-planner page owns the plan and feeds the resolved <see cref="Route"/> (or null while it has not handed the
/// section a model). Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Route">The resolved route inputs the section reads, or null while the parent has not supplied them.</param>
public sealed record TripPlannerMapModel(TripPlannerRoute? Route)
{
    /// <summary>The initial model: the parent has not supplied a route yet, so the skeleton branch renders.</summary>
    public static TripPlannerMapModel Pending { get; } = new((TripPlannerRoute?)null);
}

/// <summary>
/// One render-ready circle marker — the native projection of one web Leaflet <c>CircleMarker</c> (the green origin,
/// the red destination, or a blue charge stop). Carries the geographic position, the dot colour and pixel diameter,
/// the Narrator label, and the popup content (web <c>Popup</c>) decomposed into a bold heading plus the secondary
/// detail lines, already localized and formatted so the view stays a thin renderer. Pure data — unit-tested headlessly.
/// </summary>
/// <param name="Location">The marker coordinate.</param>
/// <param name="ColorHex">The dot fill / stroke colour as a <c>#rrggbb</c> hex string (the web marker colour).</param>
/// <param name="DiameterPx">The dot diameter in pixels (web <c>radius</c> × 2).</param>
/// <param name="AriaLabel">The Narrator label carrying the popup copy.</param>
/// <param name="PopupTitle">The popup heading (web popup first line).</param>
/// <param name="PopupDetailLines">The popup body lines (web popup secondary text); empty for origin / destination.</param>
public sealed record TripPlannerMapMarker(
    GeoPoint Location,
    string ColorHex,
    double DiameterPx,
    string AriaLabel,
    string PopupTitle,
    IReadOnlyList<string> PopupDetailLines);

/// <summary>
/// The fully projected, render-ready view of the section for one input model — the native analogue of what the web
/// <c>TripPlannerMap</c> returns. Carries the resolved <see cref="State"/>, the map viewport (centre + zoom), the
/// route polyline and its colour, the origin / destination / charge-stop markers and their popup copy, and the
/// localized chrome (map label, empty message, loading announcement). Every string is produced here so the view is a
/// thin renderer and every branch is asserted headlessly.
/// </summary>
public sealed record TripPlannerMapDisplay
{
    /// <summary>The mutually-exclusive surface state.</summary>
    public required TripPlannerMapState State { get; init; }

    /// <summary>The initial map centre (web <c>center</c> memo: midpoint, the origin, or the US centre).</summary>
    public GeoPoint Center { get; init; }

    /// <summary>The initial integer zoom (web <c>zoom</c> memo over the origin↔destination spread).</summary>
    public int Zoom { get; init; }

    /// <summary>The route polyline path (web <c>polylinePoints</c>); drawn only when it has two or more points.</summary>
    public IReadOnlyList<GeoPoint> PolylinePoints { get; init; } = Array.Empty<GeoPoint>();

    /// <summary>The polyline stroke colour as a <c>#rrggbb</c> hex string (web blue <c>#3b82f6</c>).</summary>
    public string PolylineColorHex { get; init; } = string.Empty;

    /// <summary>True when the polyline has enough points to draw (web <c>polylinePoints.length &gt;= 2</c>).</summary>
    public bool ShowPolyline => PolylinePoints.Count >= 2;

    /// <summary>The origin / destination / charge-stop markers in web render order.</summary>
    public IReadOnlyList<TripPlannerMapMarker> Markers { get; init; } = Array.Empty<TripPlannerMapMarker>();

    /// <summary>True when the map has any geometry to draw (a marker or a polyline), driving the empty overlay.</summary>
    public bool HasGeometry => Markers.Count > 0 || ShowPolyline;

    /// <summary>The accessible name of the map region (native a11y affordance for the web Leaflet container).</summary>
    public string MapLabel { get; init; } = string.Empty;

    /// <summary>The empty-state copy (web <c>t('tripPlanner.map.empty', …)</c>).</summary>
    public string EmptyMessage { get; init; } = string.Empty;

    /// <summary>The Narrator announcement while the skeleton renders.</summary>
    public string LoadingLabel { get; init; } = string.Empty;

    /// <summary>The Narrator name for the whole surface.</summary>
    public string AutomationName { get; init; } = string.Empty;
}

/// <summary>
/// Pure projection from a <see cref="TripPlannerMapModel"/> to its <see cref="TripPlannerMapDisplay"/> — the native
/// port of web/src/features/driving/components/TripPlannerMap.tsx. Reproduces the web derivations exactly: the
/// whole-surface empty when neither origin nor destination is set; the <c>polylinePoints</c> memo (the two-point
/// origin↔destination fallback when there are no legs, otherwise the from/to walk over the legs); the <c>center</c>
/// memo (midpoint, the origin, or the geographic centre of the US); the <c>zoom</c> memo over the origin↔destination
/// spread; and the green origin / red destination / blue charge-stop markers with their popup copy (the charge-stop
/// line mirrors the web <c>{from}% → {to}% ({min} min)</c>, rounded half-up like JS <c>Math.round</c>). Every label
/// resolves through the i18n facade with the same keys the web source feeds into <c>t()</c>. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class TripPlannerMapProjection
{
    /// <summary>The geographic centre of the contiguous US — the web <c>center</c> fallback (<c>[39.8283, -98.5795]</c>).</summary>
    public static readonly GeoPoint UnitedStatesCenter = new(39.8283, -98.5795);

    /// <summary>The default zoom when an endpoint is missing (web <c>if (!origin || !destination) return 5</c>).</summary>
    public const int DefaultZoom = 5;

    /// <summary>The origin marker diameter in pixels (web <c>radius={8}</c> × 2).</summary>
    public const double EndpointMarkerDiameter = 16;

    /// <summary>The charge-stop marker diameter in pixels (web <c>radius={7}</c> × 2).</summary>
    public const double ChargeStopMarkerDiameter = 14;

    /// <summary>The arrow between the SoC bounds in a charge-stop popup (web <c>→</c>).</summary>
    public const string SocArrow = "\u2192";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade for every label.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static TripPlannerMapDisplay Project(TripPlannerMapModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string mapLabel = localizer.GetString(
            TripPlannerMapRegistration.MapLabelKey, TripPlannerMapRegistration.MapLabelFallback);
        string loadingLabel = localizer.GetString(
            TripPlannerMapRegistration.LoadingKey, TripPlannerMapRegistration.LoadingFallback);

        if (model.Route is not { } route)
        {
            return new TripPlannerMapDisplay
            {
                State = TripPlannerMapState.Loading,
                MapLabel = mapLabel,
                LoadingLabel = loadingLabel,
                AutomationName = loadingLabel,
            };
        }

        TripLocationInput? origin = route.Origin;
        TripLocationInput? destination = route.Destination;

        // Web: hasData = origin != null || destination != null. Neither set -> the whole-surface empty state.
        if (origin is null && destination is null)
        {
            string emptyMessage = localizer.GetString(
                TripPlannerMapRegistration.EmptyKey, TripPlannerMapRegistration.EmptyFallback);
            return new TripPlannerMapDisplay
            {
                State = TripPlannerMapState.Empty,
                MapLabel = mapLabel,
                EmptyMessage = emptyMessage,
                LoadingLabel = loadingLabel,
                AutomationName = emptyMessage,
            };
        }

        return new TripPlannerMapDisplay
        {
            State = TripPlannerMapState.Route,
            Center = ComputeCenter(origin, destination),
            Zoom = ComputeZoom(origin, destination),
            PolylinePoints = ComputePolyline(route.Legs ?? Array.Empty<TripLegInput>(), origin, destination),
            PolylineColorHex = TripPlannerMapRegistration.PolylineColorHex,
            Markers = BuildMarkers(origin, destination, route.ChargeStops ?? Array.Empty<TripChargeStopInput>(), localizer),
            MapLabel = mapLabel,
            LoadingLabel = loadingLabel,
            AutomationName = mapLabel,
        };
    }

    /// <summary>The web <c>center</c> memo: the midpoint of both endpoints, the origin alone, else the US centre.</summary>
    public static GeoPoint ComputeCenter(TripLocationInput? origin, TripLocationInput? destination)
    {
        if (origin is { } o && destination is { } d)
        {
            return new GeoPoint((o.Lat + d.Lat) / 2, (o.Lng + d.Lng) / 2);
        }

        if (origin is { } only)
        {
            return new GeoPoint(only.Lat, only.Lng);
        }

        return UnitedStatesCenter;
    }

    /// <summary>The web <c>zoom</c> memo: 5 unless both endpoints are set, then a step over their lat/lng spread.</summary>
    public static int ComputeZoom(TripLocationInput? origin, TripLocationInput? destination)
    {
        if (origin is not { } o || destination is not { } d)
        {
            return DefaultZoom;
        }

        double maxDiff = Math.Max(Math.Abs(o.Lat - d.Lat), Math.Abs(o.Lng - d.Lng));
        return maxDiff switch
        {
            > 20 => 4,
            > 10 => 5,
            > 5 => 6,
            > 2 => 7,
            _ => 9,
        };
    }

    /// <summary>
    /// The web <c>polylinePoints</c> memo: the two-point origin↔destination fallback when there are no legs, otherwise
    /// the ordered from/to walk over the legs (the first leg contributes its <c>from</c>, every leg its <c>to</c>).
    /// </summary>
    public static IReadOnlyList<GeoPoint> ComputePolyline(
        IReadOnlyList<TripLegInput> legs, TripLocationInput? origin, TripLocationInput? destination)
    {
        ArgumentNullException.ThrowIfNull(legs);

        if (legs.Count == 0 && origin is { } o && destination is { } d)
        {
            return new[] { o.ToGeoPoint(), d.ToGeoPoint() };
        }

        var points = new List<GeoPoint>(legs.Count + 1);
        foreach (var leg in legs)
        {
            if (points.Count == 0)
            {
                points.Add(leg.From.ToGeoPoint());
            }

            points.Add(leg.To.ToGeoPoint());
        }

        return points;
    }

    private static List<TripPlannerMapMarker> BuildMarkers(
        TripLocationInput? origin,
        TripLocationInput? destination,
        IReadOnlyList<TripChargeStopInput> chargeStops,
        ILocalizer localizer)
    {
        var markers = new List<TripPlannerMapMarker>(2 + chargeStops.Count);

        if (origin is { } o)
        {
            string label = string.IsNullOrEmpty(o.Name)
                ? localizer.GetString(TripPlannerMapRegistration.OriginKey, TripPlannerMapRegistration.OriginFallback)
                : o.Name!;
            markers.Add(new TripPlannerMapMarker(
                o.ToGeoPoint(),
                TripPlannerMapRegistration.OriginColorHex,
                EndpointMarkerDiameter,
                label,
                label,
                Array.Empty<string>()));
        }

        if (destination is { } d)
        {
            string label = string.IsNullOrEmpty(d.Name)
                ? localizer.GetString(TripPlannerMapRegistration.DestinationKey, TripPlannerMapRegistration.DestinationFallback)
                : d.Name!;
            markers.Add(new TripPlannerMapMarker(
                d.ToGeoPoint(),
                TripPlannerMapRegistration.DestinationColorHex,
                EndpointMarkerDiameter,
                label,
                label,
                Array.Empty<string>()));
        }

        foreach (var stop in chargeStops)
        {
            string detail = string.Create(
                CultureInfo.InvariantCulture,
                $"{RoundHalfUp(stop.ChargeFromSoc)}% {SocArrow} {RoundHalfUp(stop.ChargeToSoc)}% ({RoundHalfUp(stop.ChargeDurationS / 60)} min)");
            string title = stop.Name ?? string.Empty;
            string aria = string.IsNullOrEmpty(title) ? detail : string.Concat(title, ". ", detail);
            markers.Add(new TripPlannerMapMarker(
                stop.Location.ToGeoPoint(),
                TripPlannerMapRegistration.ChargeStopColorHex,
                ChargeStopMarkerDiameter,
                aria,
                title,
                new[] { detail }));
        }

        return markers;
    }

    /// <summary>Round half away from zero to a whole number, matching JavaScript <c>Math.round</c> over the SI domain.</summary>
    private static long RoundHalfUp(double value) => (long)Math.Round(value, MidpointRounding.AwayFromZero);
}

/// <summary>
/// Canonical metadata for the <c>TripPlannerMap</c> feature surface — the native mirror of the web component at
/// web/src/features/driving/components/TripPlannerMap.tsx: the stable diagnostics slug, the i18n keys + English
/// fallbacks the web source feeds into <c>t()</c> (plus the shared <c>common.loading</c> key backing the defensive
/// skeleton's Narrator label and a native-only map-region accessibility label), the web Leaflet marker colours, and
/// the Segoe Fluent glyph standing in for the web Lucide map-pin. The <c>tripPlanner.map.*</c> keys resolve to the
/// verbatim web <c>t()</c> fallback when absent from the en catalog, exactly matching the web render. UI-free so the
/// metadata is asserted in tests.
/// </summary>
public static class TripPlannerMapRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "TripPlannerMap";

    /// <summary>i18n key for the origin marker popup (web <c>t('tripPlanner.map.origin', 'Origin')</c>).</summary>
    public const string OriginKey = "tripPlanner.map.origin";

    /// <summary>English fallback for the origin label — verbatim from the web source.</summary>
    public const string OriginFallback = "Origin";

    /// <summary>i18n key for the destination marker popup (web <c>t('tripPlanner.map.destination', 'Destination')</c>).</summary>
    public const string DestinationKey = "tripPlanner.map.destination";

    /// <summary>English fallback for the destination label — verbatim from the web source.</summary>
    public const string DestinationFallback = "Destination";

    /// <summary>i18n key for the empty-state copy (web <c>t('tripPlanner.map.empty', …)</c>).</summary>
    public const string EmptyKey = "tripPlanner.map.empty";

    /// <summary>English fallback for the empty-state copy — verbatim from the web source.</summary>
    public const string EmptyFallback = "Enter origin and destination to see the route";

    /// <summary>i18n key for the native map-region accessibility label.</summary>
    public const string MapLabelKey = "tripPlanner.map.label";

    /// <summary>English fallback for the map-region accessibility label.</summary>
    public const string MapLabelFallback = "Trip route map";

    /// <summary>i18n key for the defensive skeleton's Narrator announcement.</summary>
    public const string LoadingKey = "common.loading";

    /// <summary>English fallback for the skeleton's Narrator announcement.</summary>
    public const string LoadingFallback = "Loading";

    /// <summary>The green origin marker colour (web <c>#22c55e</c>).</summary>
    public const string OriginColorHex = "#22c55e";

    /// <summary>The red destination marker colour (web <c>#ef4444</c>).</summary>
    public const string DestinationColorHex = "#ef4444";

    /// <summary>The blue charge-stop marker colour (web <c>#3b82f6</c>).</summary>
    public const string ChargeStopColorHex = "#3b82f6";

    /// <summary>The blue route polyline colour (web <c>#3b82f6</c>).</summary>
    public const string PolylineColorHex = "#3b82f6";

    /// <summary>Segoe Fluent "MapPin" glyph — the web Lucide <c>MapPin</c> icon backing the empty state.</summary>
    public const string MapPinGlyph = "\uE707";
}

/// <summary>
/// PII-safe diagnostics for the <c>TripPlannerMap</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a coordinate, address or charge value — so a
/// diagnostics line can never leak a user's planned route. Thread-safe.
/// </summary>
public sealed class TripPlannerMapDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public TripPlannerMapDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TripPlannerMap</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={TripPlannerMapRegistration.Slug}"));
    }
}
