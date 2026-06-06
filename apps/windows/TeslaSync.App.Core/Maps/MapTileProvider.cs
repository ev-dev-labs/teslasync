using System.Globalization;

namespace TeslaSync.App.Core.Maps;

/// <summary>
/// The map tile provider selected by server-side configuration (port of the web
/// <c>getMapConfig</c> response shape). Free tiles need no key; Azure/Google
/// require a runtime <see cref="ApiKey"/> that is supplied by the settings/config
/// surface and is NEVER committed to source.
/// </summary>
public enum MapProvider
{
    /// <summary>Key-less community tiles (CARTO / OSM / Esri / OpenTopoMap).</summary>
    Free,

    /// <summary>Azure Maps (requires a subscription key).</summary>
    Azure,

    /// <summary>Google Maps tiles (requires an API key).</summary>
    Google,
}

/// <summary>
/// Runtime map configuration. Mirrors the web <c>MapConfig</c> ({ provider, api_key }).
/// The key is injected at runtime from the backend config endpoint and must never
/// be hard-coded.
/// </summary>
/// <param name="Provider">Selected provider.</param>
/// <param name="ApiKey">Provider key (null/empty for the free provider).</param>
public sealed record MapConfig(MapProvider Provider = MapProvider.Free, string? ApiKey = null);

/// <summary>A resolved tile source: a URL template plus its required attribution.</summary>
/// <param name="UrlTemplate">Template with <c>{x}</c>, <c>{y}</c>, <c>{z}</c> and optional <c>{s}</c> tokens.</param>
/// <param name="Attribution">Plain-text attribution required by the provider's terms.</param>
public readonly record struct TileSource(string UrlTemplate, string Attribution);

/// <summary>
/// Resolves the tile URL template for a <see cref="MapStyleKind"/> under the active
/// <see cref="MapConfig"/> (port of the web <c>MapTileLayer</c> tile tables). No API
/// key is ever embedded here — keys flow in via <see cref="MapConfig.ApiKey"/>.
/// </summary>
public static class MapTileProvider
{
    private const string FreeSubdomains = "abc";

    /// <summary>Resolve the tile source for a style under the given config.</summary>
    public static TileSource Resolve(MapStyleKind style, MapConfig? config = null)
    {
        config ??= new MapConfig();

        if (config.Provider == MapProvider.Azure && !string.IsNullOrEmpty(config.ApiKey))
        {
            return Azure(style, config.ApiKey);
        }

        if (config.Provider == MapProvider.Google && !string.IsNullOrEmpty(config.ApiKey))
        {
            return Google(style, config.ApiKey);
        }

        return Free(style);
    }

    /// <summary>
    /// Expand a tile source's URL template for a concrete tile, rotating the
    /// <c>{s}</c> subdomain token deterministically across the provider's pool.
    /// </summary>
    public static string BuildUrl(TileSource source, TileCoord tile)
    {
        string subdomain = FreeSubdomains[Math.Abs(tile.X + tile.Y) % FreeSubdomains.Length].ToString();
        var c = CultureInfo.InvariantCulture;
        return source.UrlTemplate
            .Replace("{s}", subdomain, StringComparison.Ordinal)
            .Replace("{z}", tile.Z.ToString(c), StringComparison.Ordinal)
            .Replace("{x}", tile.X.ToString(c), StringComparison.Ordinal)
            .Replace("{y}", tile.Y.ToString(c), StringComparison.Ordinal);
    }

    private static TileSource Free(MapStyleKind style) => style switch
    {
        MapStyleKind.Satellite => new TileSource(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            "© Esri"),
        MapStyleKind.Streets => new TileSource(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "© OpenStreetMap contributors"),
        MapStyleKind.Terrain => new TileSource(
            "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
            "© OpenTopoMap"),
        _ => new TileSource(
            "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
            "© CARTO"),
    };

    private static TileSource Azure(MapStyleKind style, string key)
    {
        string tileset = style switch
        {
            MapStyleKind.Satellite => "microsoft.imagery",
            MapStyleKind.Streets => "microsoft.base.road",
            MapStyleKind.Terrain => "microsoft.base.road",
            _ => "microsoft.base.darkgrey",
        };
        string url =
            "https://atlas.microsoft.com/map/tile?api-version=2024-04-01&subscription-key=" +
            Uri.EscapeDataString(key) +
            "&tilesetId=" + tileset + "&zoom={z}&x={x}&y={y}";
        return new TileSource(url, "© Azure Maps");
    }

    private static TileSource Google(MapStyleKind style, string key)
    {
        string layer = style switch
        {
            MapStyleKind.Satellite => "s",
            MapStyleKind.Streets => "m",
            MapStyleKind.Terrain => "p",
            _ => "r",
        };
        string url =
            "https://mt1.google.com/vt/lyrs=" + layer + "&x={x}&y={y}&z={z}&key=" + Uri.EscapeDataString(key);
        return new TileSource(url, "© Google Maps");
    }
}
