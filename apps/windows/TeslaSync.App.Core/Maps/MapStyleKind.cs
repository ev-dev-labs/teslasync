namespace TeslaSync.App.Core.Maps;

/// <summary>
/// Base-map raster style (port of the web <c>MapStyle</c> union). Mirrors the four
/// tile styles offered by <c>TsMapLayerSwitcher</c>.
/// </summary>
public enum MapStyleKind
{
    /// <summary>Dark CARTO basemap (default for the app's dark theme).</summary>
    Dark,

    /// <summary>Esri satellite imagery.</summary>
    Satellite,

    /// <summary>OpenStreetMap street map.</summary>
    Streets,

    /// <summary>OpenTopoMap terrain map.</summary>
    Terrain,
}

/// <summary>Presentation metadata for a <see cref="MapStyleKind"/> switcher entry.</summary>
/// <param name="Style">The style this entry selects.</param>
/// <param name="Id">Stable lowercase id ("dark", "satellite", "streets", "terrain").</param>
/// <param name="Glyph">Segoe Fluent / MDL2 glyph approximating the web emoji icon.</param>
/// <param name="DefaultLabel">Fallback English label for the switcher tooltip.</param>
public readonly record struct MapStyleInfo(MapStyleKind Style, string Id, string Glyph, string DefaultLabel);

/// <summary>Lookup helpers for <see cref="MapStyleKind"/>.</summary>
public static class MapStyles
{
    /// <summary>All styles in switcher display order.</summary>
    public static IReadOnlyList<MapStyleInfo> All { get; } =
    [
        // Segoe Fluent glyphs: QuietHours(moon), Streaming(satellite-ish), Street/Map, Mountain.
        new(MapStyleKind.Dark, "dark", "\uE708", "Dark"),
        new(MapStyleKind.Satellite, "satellite", "\uE809", "Satellite"),
        new(MapStyleKind.Streets, "streets", "\uE80A", "Streets"),
        new(MapStyleKind.Terrain, "terrain", "\uE7B7", "Terrain"),
    ];

    /// <summary>Parse a lowercase id back to a style; defaults to <see cref="MapStyleKind.Dark"/>.</summary>
    public static MapStyleKind FromId(string? id) => id?.Trim().ToLowerInvariant() switch
    {
        "satellite" => MapStyleKind.Satellite,
        "streets" => MapStyleKind.Streets,
        "terrain" => MapStyleKind.Terrain,
        _ => MapStyleKind.Dark,
    };

    /// <summary>The stable lowercase id for a style.</summary>
    public static string Id(MapStyleKind style) => style switch
    {
        MapStyleKind.Satellite => "satellite",
        MapStyleKind.Streets => "streets",
        MapStyleKind.Terrain => "terrain",
        _ => "dark",
    };
}
