using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Motion;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class GeofenceGeometryTests
{
    [Fact]
    public void RectangleRing_OrdersCornersSwNwNeSe()
    {
        var ring = GeofenceGeometry.RectangleRing(new GeoPoint(10, 40), new GeoPoint(20, 20));
        Assert.Equal(4, ring.Count);
        Assert.Equal(new GeoPoint(10, 20), ring[0]);
        Assert.Equal(new GeoPoint(20, 20), ring[1]);
        Assert.Equal(new GeoPoint(20, 40), ring[2]);
        Assert.Equal(new GeoPoint(10, 40), ring[3]);
    }

    [Fact]
    public void IsRenderable_Circle_RequiresPositiveRadius()
    {
        Assert.True(GeofenceGeometry.IsRenderable(new DrawableGeofence("a", 37, -122, 100)));
        Assert.False(GeofenceGeometry.IsRenderable(new DrawableGeofence("b", 37, -122, 0)));
    }

    [Fact]
    public void IsRenderable_Polygon_RequiresThreeVertices()
    {
        var ring = new List<GeoPoint> { new(0, 0), new(0, 1), new(1, 1) };
        Assert.True(GeofenceGeometry.IsRenderable(new DrawableGeofence("c", Polygon: ring)));
        Assert.False(GeofenceGeometry.IsRenderable(
            new DrawableGeofence("d", Polygon: [new GeoPoint(0, 0), new GeoPoint(1, 1)])));
    }

    [Fact]
    public void PolygonAreaSquareMeters_OneDegreeBox_IsRoughlyExpected()
    {
        // ~1° lat ≈ 111.32 km, ~1° lng at equator ≈ 111.32 km → ~1.24e10 m².
        var ring = GeofenceGeometry.RectangleRing(new GeoPoint(0, 0), new GeoPoint(1, 1));
        double area = GeofenceGeometry.PolygonAreaSquareMeters(ring);
        Assert.InRange(area, 1.2e10, 1.3e10);
    }

    [Fact]
    public void PolygonAreaSquareMeters_TooFewPoints_IsZero() =>
        Assert.Equal(0, GeofenceGeometry.PolygonAreaSquareMeters([new GeoPoint(0, 0)]));

    [Fact]
    public void Describe_Circle_ReportsRadiusAndCentre()
    {
        string text = GeofenceGeometry.Describe(new DrawableGeofence("a", 37.7749, -122.4194, 250, Name: "Home"));
        Assert.Contains("Home", text, StringComparison.Ordinal);
        Assert.Contains("250m circle", text, StringComparison.Ordinal);
        Assert.Contains("37.7749", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Describe_Polygon_ReportsVertexCount()
    {
        var ring = new List<GeoPoint> { new(0, 0), new(0, 1), new(1, 1), new(1, 0) };
        string text = GeofenceGeometry.Describe(new DrawableGeofence("p", Polygon: ring, Name: "Yard"));
        Assert.Contains("Yard", text, StringComparison.Ordinal);
        Assert.Contains("4-vertex polygon", text, StringComparison.Ordinal);
    }
}

public sealed class CoordinateSummaryTests
{
    [Fact]
    public void Coordinate_FormatsWithFixedPrecision() =>
        Assert.Equal("37.77490, -122.41940", CoordinateSummary.Coordinate(new GeoPoint(37.7749, -122.4194)));

    [Fact]
    public void HaversineMeters_OneDegreeLat_IsAbout111Km()
    {
        double m = CoordinateSummary.HaversineMeters(new GeoPoint(0, 0), new GeoPoint(1, 0));
        Assert.InRange(m, 111_000, 111_500);
    }

    [Fact]
    public void TrailLengthMeters_SumsSegments()
    {
        var trail = new List<GeoPoint> { new(0, 0), new(0, 1), new(0, 2) };
        double total = CoordinateSummary.TrailLengthMeters(trail);
        double oneSeg = CoordinateSummary.HaversineMeters(new GeoPoint(0, 0), new GeoPoint(0, 1));
        Assert.InRange(total, (2 * oneSeg) - 1, (2 * oneSeg) + 1);
    }

    [Fact]
    public void Route_Empty_DescribesNoPoints() =>
        Assert.Contains("No GPS points", CoordinateSummary.Route([]), StringComparison.Ordinal);

    [Fact]
    public void Route_Single_DescribesLocation() =>
        Assert.Contains("Single location", CoordinateSummary.Route([new GeoPoint(1, 2)]), StringComparison.Ordinal);

    [Fact]
    public void Route_Multi_ReportsCountLengthAndEndpoints()
    {
        string text = CoordinateSummary.Route([new GeoPoint(0, 0), new GeoPoint(0, 1)]);
        Assert.Contains("Route of 2 points", text, StringComparison.Ordinal);
        Assert.Contains("km", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Position_IsOneBasedAndIncludesCoordinate()
    {
        string text = CoordinateSummary.Position(0, 5, new GeoPoint(1, 2));
        Assert.Contains("Point 1 of 5", text, StringComparison.Ordinal);
    }
}

public sealed class MotionDurationTests
{
    [Fact]
    public void Resolve_ReducedMotion_IsZero() => Assert.Equal(0, MotionDuration.Resolve(reduce: true));

    [Fact]
    public void Resolve_NormalMotion_IsDefault() =>
        Assert.Equal(MotionDuration.DefaultMs, MotionDuration.Resolve(reduce: false));

    [Fact]
    public void Resolve_NegativeDefault_ClampsToZero() =>
        Assert.Equal(0, MotionDuration.Resolve(reduce: false, defaultMs: -10));

    [Fact]
    public void ShouldAnimate_FalseUnderReducedMotion()
    {
        Assert.False(MotionDuration.ShouldAnimate(reduce: true));
        Assert.True(MotionDuration.ShouldAnimate(reduce: false));
    }

    [Fact]
    public void StaggerStepMs_CollapsesUnderReducedMotion()
    {
        Assert.Equal(0, MotionDuration.StaggerStepMs(reduce: true));
        Assert.Equal(60, MotionDuration.StaggerStepMs(reduce: false));
    }
}
