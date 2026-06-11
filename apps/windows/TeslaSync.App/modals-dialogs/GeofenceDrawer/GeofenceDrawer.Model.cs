using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The lifecycle state the <see cref="GeofenceDrawerViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the geofence-editing surface renders.
/// The web <c>GeofenceDrawer</c> (web/src/components/maps/GeofenceDrawer.tsx) is a controlled overlay
/// fed by its parent <c>GeofencesPage</c>, which loads <c>GET /geofences</c>; the native modal owns
/// that read itself through the shared cache-then-network layer. Every branch maps onto a visible
/// surface; none is ever hidden.
/// </summary>
public enum GeofenceDrawerState
{
    /// <summary>Initial fetch with no cached fences — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh fences from the network (or non-stale cache).</summary>
    Loaded,

    /// <summary>The request resolved with no fences — render the draw-to-start empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached fences exist — render the retry affordance.</summary>
    Error,

    /// <summary>Cached fences older than the freshness window — render fences plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached fences remain — render fences plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Null-tolerant parser for the <c>GET /geofences</c> payload (generated operation
/// <c>get_api_v1_geofences</c>). The Go API's <c>MarshalJSON</c> augments each geofence with the
/// derived <c>latitude</c>, <c>longitude</c> and <c>radius</c> (centroid + max-vertex metres), which
/// the web <c>Geofence</c> type and <c>GeofencesPage</c> consume as a circle. This projects each row
/// onto the canonical <see cref="DrawableGeofence"/> circle (id + name + centre + metre radius),
/// skipping any row that is not renderable so a partial payload never throws.
/// </summary>
public static class GeofenceDrawerParser
{
    /// <summary>Parse a <c>GET /geofences</c> JSON array into a tolerant list of renderable fences.</summary>
    public static IReadOnlyList<DrawableGeofence> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<DrawableGeofence>();
        }

        var list = new List<DrawableGeofence>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (FromJson(item) is { } fence)
            {
                list.Add(fence);
            }
        }

        return list;
    }

    /// <summary>Project a single geofence JSON object, or <see langword="null"/> when not renderable.</summary>
    public static DrawableGeofence? FromJson(JsonElement obj)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        string name = GetString(obj, "name") ?? string.Empty;
        var fence = new DrawableGeofence(
            Id: GetIdString(obj, "id") ?? string.Empty,
            Lat: GetDouble(obj, "latitude"),
            Lng: GetDouble(obj, "longitude"),
            RadiusMeters: GetDouble(obj, "radius"),
            Name: string.IsNullOrWhiteSpace(name) ? null : name);

        return GeofenceGeometry.IsRenderable(fence) ? fence : null;
    }

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static string? GetIdString(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Number when v.TryGetInt64(out var n) => n.ToString(CultureInfo.InvariantCulture),
            JsonValueKind.Number => v.GetRawText(),
            _ => null,
        };
    }

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var d) => d,
            JsonValueKind.String when double.TryParse(
                v.GetString(),
                NumberStyles.Float | NumberStyles.AllowThousands,
                CultureInfo.InvariantCulture,
                out var d) => d,
            _ => null,
        };
    }
}

/// <summary>
/// One projected, display-ready geofence row consumed by the WinUI view's accessible fence list. Holds
/// the localized display name, the geometry description (a faithful port of the web
/// <c>describeFence</c> via <see cref="GeofenceGeometry.Describe"/>), a Narrator automation name, and
/// the underlying <see cref="DrawableGeofence"/> the map overlay renders. Pure data — no WinUI types.
/// </summary>
public sealed record GeofenceRow(
    string Id,
    string Name,
    string Description,
    string AutomationName,
    DrawableGeofence Fence);

/// <summary>
/// Pure projection from parsed fences to display rows: it skips any fence that is not renderable
/// (matching the map overlay's <see cref="GeofenceGeometry.IsRenderable"/> filter and the web
/// <c>fenceToLayer</c>), resolves the localized unnamed-fence fallback, builds the per-fence geometry
/// description, and sorts the rows by name for a stable list. Kept headless so the projection is
/// unit-tested without a WinUI host.
/// </summary>
public static class GeofenceDrawerProjection
{
    /// <summary>Project + name-sort the renderable <paramref name="fences"/> into accessible display rows.</summary>
    public static IReadOnlyList<GeofenceRow> Project(IReadOnlyList<DrawableGeofence> fences, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(fences);
        ArgumentNullException.ThrowIfNull(localizer);

        string unnamed = localizer.GetString("geofences.unnamed", "Geofence");
        var rows = new List<GeofenceRow>(fences.Count);
        foreach (var fence in fences)
        {
            if (!GeofenceGeometry.IsRenderable(fence))
            {
                continue;
            }

            string name = string.IsNullOrWhiteSpace(fence.Name) ? unnamed : fence.Name!;
            string description = GeofenceGeometry.Describe(fence);
            rows.Add(new GeofenceRow(fence.Id, name, description, description, fence));
        }

        rows.Sort(static (a, b) => string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase));
        return rows;
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;DrawableGeofence&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept
/// pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class GeofenceDrawerResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<DrawableGeofence>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<DrawableGeofence> Parse() =>
            raw.HasValue ? GeofenceDrawerParser.ParseList(raw.Value) : Array.Empty<DrawableGeofence>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<DrawableGeofence>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<DrawableGeofence>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<DrawableGeofence>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<DrawableGeofence>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<DrawableGeofence>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<DrawableGeofence>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<IReadOnlyList<DrawableGeofence>> ToLoadedOrEmpty(
        IReadOnlyList<DrawableGeofence> parsed,
        DateTimeOffset? fetchedAt)
        => parsed.Count == 0
            ? RepositoryResult<IReadOnlyList<DrawableGeofence>>.Empty(fetchedAt)
            : RepositoryResult<IReadOnlyList<DrawableGeofence>>.Loaded(parsed, fetchedAt ?? DateTimeOffset.UtcNow);
}
