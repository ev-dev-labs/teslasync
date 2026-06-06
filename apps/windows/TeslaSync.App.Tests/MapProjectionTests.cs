using TeslaSync.App.Core.Maps;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class MapProjectionTests
{
    [Theory]
    [InlineData(0.0, 0.0, 3)]
    [InlineData(37.7749, -122.4194, 12)]
    [InlineData(-33.8688, 151.2093, 15)]
    [InlineData(51.5074, -0.1278, 8)]
    public void Project_Unproject_RoundTrips(double lat, double lng, int zoom)
    {
        var origin = new GeoPoint(lat, lng);
        var pixel = WebMercator.Project(origin, zoom);
        var back = WebMercator.Unproject(pixel, zoom);

        Assert.Equal(origin.Lat, back.Lat, 6);
        Assert.Equal(origin.Lng, back.Lng, 6);
    }

    [Fact]
    public void Project_Equator_PrimeMeridian_IsWorldCenter()
    {
        var pixel = WebMercator.Project(new GeoPoint(0, 0), 0);
        Assert.Equal(WebMercator.TileSize / 2.0, pixel.X, 6);
        Assert.Equal(WebMercator.TileSize / 2.0, pixel.Y, 6);
    }

    [Fact]
    public void ClampLatitude_BeyondMercatorRange_IsClamped()
    {
        Assert.Equal(WebMercator.MaxLatitude, WebMercator.ClampLatitude(89.9), 6);
        Assert.Equal(-WebMercator.MaxLatitude, WebMercator.ClampLatitude(-90), 6);
    }

    [Theory]
    [InlineData(190, -170)]
    [InlineData(-190, 170)]
    [InlineData(180, -180)]
    public void WrapLongitude_WrapsIntoRange(double input, double expected)
    {
        Assert.Equal(expected, WebMercator.WrapLongitude(input), 6);
    }

    [Fact]
    public void WorldSize_DoublesPerZoom()
    {
        Assert.Equal(256, WebMercator.WorldSize(0));
        Assert.Equal(512, WebMercator.WorldSize(1));
        Assert.Equal(1024, WebMercator.WorldSize(2));
    }
}

public sealed class GeoBoundsTests
{
    [Fact]
    public void FromPoints_EnclosesAllFinitePoints()
    {
        var bounds = GeoBoundsCalculator.FromPoints(
        [
            new GeoPoint(10, 20),
            new GeoPoint(-5, 40),
            new GeoPoint(15, 5),
        ]);

        Assert.NotNull(bounds);
        Assert.Equal(-5, bounds!.Value.South);
        Assert.Equal(15, bounds.Value.North);
        Assert.Equal(5, bounds.Value.West);
        Assert.Equal(40, bounds.Value.East);
        Assert.True(bounds.Value.IsValid);
    }

    [Fact]
    public void FromPoints_AllNonFinite_ReturnsNull()
    {
        var bounds = GeoBoundsCalculator.FromPoints(
        [
            new GeoPoint(double.NaN, double.NaN),
            new GeoPoint(double.PositiveInfinity, 0),
        ]);

        Assert.Null(bounds);
    }

    [Fact]
    public void Contains_Center_IsTrue()
    {
        var bounds = new GeoBounds(0, 0, 10, 10);
        Assert.True(bounds.Contains(bounds.Center));
        Assert.False(bounds.Contains(new GeoPoint(20, 20)));
    }

    [Fact]
    public void FitZoom_TighterBounds_ProduceHigherZoom()
    {
        var wide = new GeoBounds(-40, -80, 40, 80);
        var tight = new GeoBounds(37.77, -122.43, 37.80, -122.40);

        int wideZoom = GeoBoundsCalculator.FitZoom(wide, 800, 600);
        int tightZoom = GeoBoundsCalculator.FitZoom(tight, 800, 600);

        Assert.True(tightZoom > wideZoom);
        Assert.InRange(wideZoom, 0, 19);
        Assert.InRange(tightZoom, 0, 19);
    }

    [Fact]
    public void FitZoom_ZeroViewport_ReturnsMinZoom()
    {
        var bounds = new GeoBounds(0, 0, 1, 1);
        Assert.Equal(0, GeoBoundsCalculator.FitZoom(bounds, 0, 0));
    }
}

public sealed class TileMathTests
{
    [Fact]
    public void TileAt_Origin_Zoom1_IsTopLeftQuadrantBoundary()
    {
        var tile = TileMath.TileAt(new GeoPoint(0, 0), 1);
        Assert.Equal(1, tile.X);
        Assert.Equal(1, tile.Y);
        Assert.Equal(1, tile.Z);
    }

    [Fact]
    public void TileCountPerAxis_IsPowerOfTwo()
    {
        Assert.Equal(1, TileMath.TileCountPerAxis(0));
        Assert.Equal(4, TileMath.TileCountPerAxis(2));
        Assert.Equal(1024, TileMath.TileCountPerAxis(10));
    }

    [Fact]
    public void TilesForViewport_CoversViewport_WithBleedMargin()
    {
        var tiles = TileMath.TilesForViewport(new GeoPoint(37.77, -122.42), 12, 512, 512);

        Assert.NotEmpty(tiles);
        // 512px viewport = 2 tiles each axis + 1 bleed each side => at least 4x4.
        Assert.True(tiles.Count >= 16);
        Assert.All(tiles, t => Assert.Equal(12, t.Tile.Z));
    }

    [Fact]
    public void TilesForViewport_ZeroSize_IsEmpty()
    {
        Assert.Empty(TileMath.TilesForViewport(new GeoPoint(0, 0), 5, 0, 0));
    }

    [Fact]
    public void ToScreen_Center_LandsAtViewportMiddle()
    {
        var center = new GeoPoint(40, -100);
        var screen = TileMath.ToScreen(center, center, 6, 600, 400);
        Assert.Equal(300, screen.X, 6);
        Assert.Equal(200, screen.Y, 6);
    }
}

public sealed class MapTileProviderTests
{
    [Theory]
    [InlineData(MapStyleKind.Dark, "cartocdn")]
    [InlineData(MapStyleKind.Streets, "openstreetmap")]
    [InlineData(MapStyleKind.Satellite, "arcgisonline")]
    [InlineData(MapStyleKind.Terrain, "opentopomap")]
    public void Resolve_FreeProvider_UsesKeylessTiles(MapStyleKind style, string host)
    {
        var source = MapTileProvider.Resolve(style);
        Assert.Contains(host, source.UrlTemplate, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("subscription-key", source.UrlTemplate, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("key=", source.UrlTemplate, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Resolve_AzureWithoutKey_FallsBackToFree()
    {
        var source = MapTileProvider.Resolve(MapStyleKind.Dark, new MapConfig(MapProvider.Azure, null));
        Assert.Contains("cartocdn", source.UrlTemplate, StringComparison.Ordinal);
    }

    [Fact]
    public void Resolve_AzureWithKey_EmbedsEscapedKey_AtRuntimeOnly()
    {
        var source = MapTileProvider.Resolve(MapStyleKind.Streets, new MapConfig(MapProvider.Azure, "ab cd"));
        Assert.Contains("atlas.microsoft.com", source.UrlTemplate, StringComparison.Ordinal);
        Assert.Contains("subscription-key=ab%20cd", source.UrlTemplate, StringComparison.Ordinal);
    }

    [Fact]
    public void BuildUrl_SubstitutesTileTokens()
    {
        var source = MapTileProvider.Resolve(MapStyleKind.Streets);
        string url = MapTileProvider.BuildUrl(source, new TileCoord(5, 9, 4));
        Assert.Contains("/4/5/9.png", url, StringComparison.Ordinal);
        Assert.DoesNotContain("{", url, StringComparison.Ordinal);
    }

    [Fact]
    public void MapStyles_FromId_RoundTrips()
    {
        foreach (var info in MapStyles.All)
        {
            Assert.Equal(info.Style, MapStyles.FromId(info.Id));
            Assert.Equal(info.Id, MapStyles.Id(info.Style));
        }
    }
}
