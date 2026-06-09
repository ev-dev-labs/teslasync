using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="GeofenceViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>GeofenceWidget</c> renders through
/// <c>WidgetShell</c> (web/src/features/dashboard/widgets/GeofenceWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>isEmpty = fences.length === 0</c> gate —
/// the geofences read carried no configured fences — the "No geofences configured" surface. A resolved fence list
/// always renders (whether or not a vehicle position is known); the optional map and the inside/outside status are
/// projection details, not separate states.
/// </summary>
public enum GeofenceState
{
    /// <summary>Initial fetch with no cached content — render the skeleton chrome (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh fence list (or non-stale cache) to render.</summary>
    Loaded,

    /// <summary>The geofences read resolved with no fences — render the "No geofences configured" empty surface.</summary>
    Empty,

    /// <summary>The geofences read failed and no cached list exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached fence list older than the freshness window — render the body plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached fence list remains — render the body plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The vehicle's current position slice read from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of
/// the exact fields the web <c>useVehicleState</c> query exposes to the widget (<c>state.latitude</c> /
/// <c>state.longitude</c>). The canonical response nests the state under <c>res.state</c>, so
/// <see cref="FromStateResponse"/> unwraps that envelope exactly like the web hook's normalisation. A missing
/// coordinate parses to <c>0</c> like the web <c>?? 0</c> coalescing; <see cref="HasCoordinates"/> reproduces the
/// web <c>hasCoords = vLat !== 0 || vLon !== 0</c> gate that decides whether distances (and the map) are computed.
/// </summary>
/// <param name="Latitude">The vehicle latitude in degrees (web <c>state.latitude</c>, defaulted to 0).</param>
/// <param name="Longitude">The vehicle longitude in degrees (web <c>state.longitude</c>, defaulted to 0).</param>
public sealed record GeofenceVehiclePosition(double Latitude, double Longitude)
{
    /// <summary>The "no fix" position (origin), used when no vehicle state is available.</summary>
    public static GeofenceVehiclePosition None { get; } = new(0, 0);

    /// <summary>True when a non-origin fix is present (web <c>vLat !== 0 || vLon !== 0</c>).</summary>
    public bool HasCoordinates => Latitude != 0 || Longitude != 0;

    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the position slice, unwrapping the
    /// <c>state</c> envelope (web <c>useVehicleState</c> normalisation). A non-object body, or one without finite
    /// coordinates, yields <see cref="None"/>.
    /// </summary>
    public static GeofenceVehiclePosition FromStateResponse(JsonElement root)
    {
        JsonElement state = ExtractState(root);
        double lat = GeofenceJson.ReadDouble(state, "latitude") ?? 0;
        double lon = GeofenceJson.ReadDouble(state, "longitude") ?? 0;
        return new GeofenceVehiclePosition(lat, lon);
    }

    // Web parity: the canonical response nests the state under res.state; a flat body is used as-is.
    private static JsonElement ExtractState(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("state", out var inner) &&
            inner.ValueKind == JsonValueKind.Object)
        {
            return inner;
        }

        return root;
    }
}

/// <summary>
/// One configured geofence from <c>GET /geofences</c> (web <c>useGeofences</c>, shape <c>Geofence</c> in
/// web/src/types/location.ts). Field names mirror the Go API's JSON tags and parsing is null-tolerant so a partial
/// row never throws: <see cref="Name"/> is nullable (web <c>g.name ?? '—'</c> is applied at projection),
/// <see cref="RadiusMeters"/> coalesces to <c>0</c> (web <c>g.radius ?? 0</c>) and <see cref="Enabled"/> defaults
/// to <see langword="true"/> (web <c>g.enabled ?? true</c>). Coordinates are SI degrees, used both to compute the
/// inside/outside status and to draw the fence circle on the map.
/// </summary>
/// <param name="Id">Stable identity (web <c>g.id</c>, used as the list key).</param>
/// <param name="Name">The fence name, or null (web <c>g.name</c>).</param>
/// <param name="Latitude">The fence-centre latitude in degrees (web <c>g.latitude</c>).</param>
/// <param name="Longitude">The fence-centre longitude in degrees (web <c>g.longitude</c>).</param>
/// <param name="RadiusMeters">The fence radius in SI metres (web <c>g.radius</c>, defaulted to 0).</param>
/// <param name="Enabled">Whether the fence is enabled (web <c>g.enabled ?? true</c>).</param>
public sealed record GeofenceItem(
    string Id,
    string? Name,
    double Latitude,
    double Longitude,
    double RadiusMeters,
    bool Enabled)
{
    /// <summary>Parse a <c>GET /geofences</c> JSON array into a tolerant list of fences (non-arrays → empty).</summary>
    public static IReadOnlyList<GeofenceItem> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var list = new List<GeofenceItem>(element.GetArrayLength());
        int index = 0;
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item, index));
            }

            index++;
        }

        return list;
    }

    /// <summary>Project a single geofence JSON object into a <see cref="GeofenceItem"/>.</summary>
    public static GeofenceItem FromJson(JsonElement obj, int index) => new(
        Id: GeofenceJson.ReadId(obj, "id", index),
        Name: GeofenceJson.ReadString(obj, "name"),
        Latitude: GeofenceJson.ReadDouble(obj, "latitude") ?? 0,
        Longitude: GeofenceJson.ReadDouble(obj, "longitude") ?? 0,
        RadiusMeters: GeofenceJson.ReadDouble(obj, "radius") ?? 0,
        Enabled: GeofenceJson.ReadBool(obj, "enabled") ?? true);
}

/// <summary>
/// The combined read backing the widget: the vehicle position (which decides the inside/outside status and the map
/// centre) plus the configured fences. The native analogue of the web component's
/// <c>useVehicleState</c> + <c>useGeofences</c> composition — the two are merged in the data source so the view
/// binds a single stream.
/// </summary>
/// <param name="Position">The vehicle position slice (origin when no vehicle/fix is available).</param>
/// <param name="Fences">The configured fences (possibly empty).</param>
public sealed record GeofenceWidgetReading(
    GeofenceVehiclePosition Position,
    IReadOnlyList<GeofenceItem> Fences);

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c>. The web
/// <c>GeofenceWidget</c> branches on <c>size.cols &lt;= 1</c> (compact crosshair badge vs the standard titled list)
/// and shows the map only when <c>size.rows &gt;= 3</c>, so the footprint is observable.
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct GeofenceSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static GeofenceSize Default => new(2, 4);

    /// <summary>True at the compact footprint (web <c>size.cols &lt;= 1</c>).</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True when the standard layout should draw the map (web <c>size.rows &gt;= 3</c>).</summary>
    public bool AllowsMap => Rows >= 3;
}

/// <summary>The status a single fence renders, in the web's priority: disabled wins, then inside, else outside.</summary>
public enum GeofenceFenceStatus
{
    /// <summary>The vehicle is inside an enabled fence (web green "Inside" badge with a dot).</summary>
    Inside,

    /// <summary>The vehicle is outside an enabled fence (web neutral "Outside" badge).</summary>
    Outside,

    /// <summary>The fence is disabled (web neutral "Disabled" badge).</summary>
    Disabled,
}

/// <summary>
/// The fully projected, render-ready view of one fence row — the native analogue of everything the web component
/// computes per fence before returning JSX (the em-dash name fallback, the unit-converted radius string, the
/// inside/outside/disabled badge and the inside-highlight). Pure data so the projection is unit-tested without a UI
/// host.
/// </summary>
/// <param name="Id">Stable identity (web list key).</param>
/// <param name="Name">The fence name, or the em dash (web <c>g.name ?? '—'</c>).</param>
/// <param name="RadiusDetail">The localized "Radius: 12.3 km" detail line (web <c>Radius: {fmtRadius}</c>).</param>
/// <param name="Status">The semantic fence status driving the badge.</param>
/// <param name="StatusLabel">The localized status label (Inside / Outside / Disabled).</param>
/// <param name="Inside">The raw inside flag, independent of enabled (web <c>f.inside</c>, drives the map circle colour).</param>
/// <param name="Highlighted">Whether the row is highlighted (web <c>inside &amp;&amp; enabled</c>).</param>
/// <param name="Latitude">The fence-centre latitude (for the map circle).</param>
/// <param name="Longitude">The fence-centre longitude (for the map circle).</param>
/// <param name="RadiusMeters">The fence radius in SI metres (for the map circle).</param>
/// <param name="AutomationName">Narrator name summarising the row.</param>
public sealed record GeofenceFenceDisplay(
    string Id,
    string Name,
    string RadiusDetail,
    GeofenceFenceStatus Status,
    string StatusLabel,
    bool Inside,
    bool Highlighted,
    double Latitude,
    double Longitude,
    double RadiusMeters,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the geofence surface for one unit preference — the native analogue of
/// everything the web component computes before returning JSX (the per-fence rows, the current-zone badge for the
/// compact layout, and the vehicle position used to centre the map). Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Fences">The projected fence rows, in source order.</param>
/// <param name="HasCoordinates">Whether the vehicle has a position fix (web <c>hasCoords</c>).</param>
/// <param name="VehicleLatitude">The vehicle latitude (map centre + marker).</param>
/// <param name="VehicleLongitude">The vehicle longitude (map centre + marker).</param>
/// <param name="CurrentZoneName">The name of the enabled fence the vehicle is inside, or null (web <c>currentZone</c>).</param>
/// <param name="CompactBadgeLabel">The compact-layout badge text — the current zone name, else the localized "No zone".</param>
/// <param name="HasCurrentZone">Whether a current zone exists (drives the compact badge's success vs neutral status).</param>
/// <param name="AutomationName">Narrator name summarising the surface.</param>
public sealed record GeofenceDisplay(
    IReadOnlyList<GeofenceFenceDisplay> Fences,
    bool HasCoordinates,
    double VehicleLatitude,
    double VehicleLongitude,
    string? CurrentZoneName,
    string CompactBadgeLabel,
    bool HasCurrentZone,
    string AutomationName);

/// <summary>
/// Pure projection from a raw <see cref="GeofenceWidgetReading"/> to the display model — the native port of the web
/// component's inline computation in web/src/features/dashboard/widgets/GeofenceWidget.tsx. The per-fence distance
/// uses the same haversine formula as the web (<see cref="HaversineMeters"/>); a fence is "inside" when that
/// distance is within its radius (web <c>dist &lt;= (g.radius ?? 0)</c>, with no fix → <see cref="double.PositiveInfinity"/>
/// so nothing is inside); the radius honours the user's distance preference exactly like the web
/// <c>fmtNumber(convertDistanceFromSI(meters, unit), 1)</c>; the current zone is the first enabled fence the
/// vehicle is inside (web <c>fences.find(f =&gt; f.inside &amp;&amp; f.enabled)</c>). Every label resolves through
/// the i18n facade.
/// </summary>
public static class GeofenceProjection
{
    /// <summary>The em dash the web renders for an absent fence name (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Radius fraction digits (web <c>fmtNumber(convertDistanceFromSI(meters, unit), 1)</c>).</summary>
    public const int RadiusPrecision = 1;

    /// <summary>Earth radius in metres used by the haversine (web <c>R = 6_371_000</c>).</summary>
    public const double EarthRadiusMeters = 6_371_000;

    private const double DegToRad = Math.PI / 180.0;

    /// <summary>Project <paramref name="reading"/> for <paramref name="units"/> using the localizer for every label.</summary>
    public static GeofenceDisplay Project(GeofenceWidgetReading reading, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        bool hasCoords = reading.Position.HasCoordinates;
        double vLat = reading.Position.Latitude;
        double vLon = reading.Position.Longitude;

        string radiusLabel = localizer.GetString("widget.geofence.radius", "Radius");
        string insideLabel = localizer.GetString("widget.geofence.inside", "Inside");
        string outsideLabel = localizer.GetString("widget.geofence.outside", "Outside");
        string disabledLabel = localizer.GetString("widget.geofence.disabled", "Disabled");
        string noZoneLabel = localizer.GetString("widget.geofence.noZone", "No zone");

        var rows = new List<GeofenceFenceDisplay>(reading.Fences.Count);
        string? currentZone = null;

        foreach (var fence in reading.Fences)
        {
            double distance = hasCoords
                ? HaversineMeters(vLat, vLon, fence.Latitude, fence.Longitude)
                : double.PositiveInfinity;
            bool inside = distance <= fence.RadiusMeters;
            bool highlighted = inside && fence.Enabled;

            GeofenceFenceStatus status = !fence.Enabled
                ? GeofenceFenceStatus.Disabled
                : inside ? GeofenceFenceStatus.Inside : GeofenceFenceStatus.Outside;
            string statusLabel = status switch
            {
                GeofenceFenceStatus.Disabled => disabledLabel,
                GeofenceFenceStatus.Inside => insideLabel,
                _ => outsideLabel,
            };

            string name = string.IsNullOrEmpty(fence.Name) ? EmDash : fence.Name!;
            string radiusText = FormatRadius(fence.RadiusMeters, units);
            string radiusDetail = $"{radiusLabel}: {radiusText}";

            if (highlighted)
            {
                currentZone ??= name;
            }

            rows.Add(new GeofenceFenceDisplay(
                Id: fence.Id,
                Name: name,
                RadiusDetail: radiusDetail,
                Status: status,
                StatusLabel: statusLabel,
                Inside: inside,
                Highlighted: highlighted,
                Latitude: fence.Latitude,
                Longitude: fence.Longitude,
                RadiusMeters: fence.RadiusMeters,
                AutomationName: $"{name}, {statusLabel}, {radiusDetail}"));
        }

        bool hasCurrentZone = currentZone is not null;
        string compactBadge = currentZone ?? noZoneLabel;
        string automation = hasCurrentZone
            ? compactBadge
            : $"{noZoneLabel}, {ScalarFormatters.FormatNumber(rows.Count, 0)}";

        return new GeofenceDisplay(
            Fences: rows,
            HasCoordinates: hasCoords,
            VehicleLatitude: vLat,
            VehicleLongitude: vLon,
            CurrentZoneName: currentZone,
            CompactBadgeLabel: compactBadge,
            HasCurrentZone: hasCurrentZone,
            AutomationName: automation);
    }

    /// <summary>
    /// Format a fence radius the way the web does — <c>fmtNumber(convertDistanceFromSI(metres, unit), 1) + ' ' + unit</c>.
    /// The radius is SI metres (Phase-48), converted at the display boundary only.
    /// </summary>
    public static string FormatRadius(double meters, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        double display = UnitConverters.DistanceFromSi(meters, units.Distance);
        return $"{ScalarFormatters.FormatNumber(display, RadiusPrecision)} {UnitLabels.Label(units.Distance)}";
    }

    /// <summary>
    /// Great-circle distance in metres between two lat/lon points, a 1:1 port of the web component's
    /// <c>haversineMeters</c> helper (mean Earth radius 6,371,000 m).
    /// </summary>
    public static double HaversineMeters(double lat1, double lon1, double lat2, double lon2)
    {
        double dLat = (lat2 - lat1) * DegToRad;
        double dLon = (lon2 - lon1) * DegToRad;
        double a = (Math.Sin(dLat / 2) * Math.Sin(dLat / 2)) +
            (Math.Cos(lat1 * DegToRad) * Math.Cos(lat2 * DegToRad) *
                Math.Sin(dLon / 2) * Math.Sin(dLon / 2));
        return EarthRadiusMeters * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }
}

/// <summary>
/// Merges the engine's two raw <c>RepositoryResult&lt;JsonElement&gt;</c> streams (vehicle state + geofences) into
/// one parsed <c>RepositoryResult&lt;GeofenceWidgetReading&gt;</c>, preserving every freshness flag. The geofences
/// read drives the content: when it hard-fails with no value the surface is the retry affordance; when it resolves
/// to no fences the surface is the "No geofences configured" empty state (web <c>isEmpty</c>); otherwise the fence
/// list renders and a stale / offline / errored secondary read only tints the freshness chip (the body still
/// shows, mirroring the web passing <c>isError</c>/<c>isStale</c> to <c>WidgetShell</c> without hiding the body).
/// Kept pure so the contract is unit-tested without a network or cache.
/// </summary>
public static class GeofenceCombiner
{
    /// <summary>Combine the <paramref name="state"/> (position) and <paramref name="fences"/> reads.</summary>
    public static RepositoryResult<GeofenceWidgetReading> Combine(
        RepositoryResult<JsonElement> state,
        RepositoryResult<JsonElement> fences)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(fences);

        // The geofences read is the content. With no usable value (a hard failure) there is nothing to render.
        if (fences.Status == LoadStatus.Error)
        {
            return RepositoryResult<GeofenceWidgetReading>.Failure(
                fences.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load geofences"));
        }

        var position = state.Status is LoadStatus.Loading or LoadStatus.Empty
            ? GeofenceVehiclePosition.None
            : GeofenceVehiclePosition.FromStateResponse(state.Value);
        IReadOnlyList<GeofenceItem> fenceList = GeofenceItem.ParseList(fences.Value);
        var reading = new GeofenceWidgetReading(position, fenceList);

        DateTimeOffset? updatedAt = Latest(state.FetchedAt, fences.FetchedAt);

        // Web parity: isEmpty = fences.length === 0 → the "No geofences configured" surface.
        if (fenceList.Count == 0)
        {
            return RepositoryResult<GeofenceWidgetReading>.Empty(updatedAt);
        }

        bool offline = state.Status == LoadStatus.Offline || fences.Status == LoadStatus.Offline;
        bool errored = state.Status == LoadStatus.Error; // a partial (position-only) failure; fences still rendered
        bool stale = state.IsStale || fences.IsStale;

        if (offline || errored)
        {
            return RepositoryResult<GeofenceWidgetReading>.OfflineCached(
                reading,
                updatedAt ?? DateTimeOffset.UtcNow,
                state.Error ?? fences.Error ?? new RepositoryError(RepositoryErrorKind.Network, "A live read is unavailable"));
        }

        if (stale)
        {
            return RepositoryResult<GeofenceWidgetReading>.Cached(reading, updatedAt ?? DateTimeOffset.UtcNow, stale: true);
        }

        return RepositoryResult<GeofenceWidgetReading>.Loaded(reading, updatedAt ?? DateTimeOffset.UtcNow);
    }

    private static DateTimeOffset? Latest(DateTimeOffset? a, DateTimeOffset? b)
    {
        if (a is null)
        {
            return b;
        }

        if (b is null)
        {
            return a;
        }

        return a.Value >= b.Value ? a : b;
    }
}

/// <summary>
/// Null-tolerant JSON readers shared by the geofence parse adapters. Each returns <see langword="null"/> (or a
/// supplied default) rather than throwing on an absent / mistyped field, so a partial API body never crashes the
/// surface — the native analogue of the web's <c>?? 0</c> / <c>?? true</c> coalescing.
/// </summary>
internal static class GeofenceJson
{
    public static string? ReadString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    public static double? ReadDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static bool? ReadBool(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when v.TryGetDouble(out var n) => n != 0,
            JsonValueKind.String when bool.TryParse(v.GetString(), out var b) => b,
            _ => null,
        };
    }

    public static string ReadId(JsonElement obj, string name, int index)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v))
        {
            switch (v.ValueKind)
            {
                case JsonValueKind.String when !string.IsNullOrEmpty(v.GetString()):
                    return v.GetString()!;
                case JsonValueKind.Number when v.TryGetInt64(out var n):
                    return n.ToString(CultureInfo.InvariantCulture);
                case JsonValueKind.Number:
                    return v.GetRawText();
            }
        }

        return index.ToString(CultureInfo.InvariantCulture);
    }
}
