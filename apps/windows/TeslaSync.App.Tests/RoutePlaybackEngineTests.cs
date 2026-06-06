using TeslaSync.App.Core.Maps;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class RoutePlaybackEngineTests
{
    private static readonly PlaybackPoint[] Trip =
    [
        new(37.0000, -122.0000, 1_000_000),
        new(37.0100, -122.0000, 1_010_000),
        new(37.0200, -122.0000, 1_030_000),
        new(37.0300, -122.0000, 1_060_000),
    ];

    [Fact]
    public void BuildOffsets_AreRelativeToFirstSample()
    {
        double[] offsets = RoutePlaybackEngine.BuildOffsets(Trip);
        Assert.Equal([0, 10_000, 30_000, 60_000], offsets);
    }

    [Fact]
    public void BuildOffsets_Empty_IsEmpty() =>
        Assert.Empty(RoutePlaybackEngine.BuildOffsets([]));

    [Theory]
    [InlineData(0, 0)]
    [InlineData(9_000, 1)]
    [InlineData(11_000, 1)]
    [InlineData(44_000, 2)]
    [InlineData(46_000, 3)]
    [InlineData(60_000, 3)]
    public void IndexAtTime_SnapsToNearestOffset(double targetMs, int expected)
    {
        double[] offsets = RoutePlaybackEngine.BuildOffsets(Trip);
        Assert.Equal(expected, RoutePlaybackEngine.IndexAtTime(offsets, targetMs));
    }

    [Fact]
    public void TotalMs_IsLastOffset()
    {
        var engine = new RoutePlaybackEngine(Trip);
        Assert.Equal(60_000, engine.TotalMs);
    }

    [Fact]
    public void Advance_ReachesEnd_AndSnapsToFinalSample()
    {
        var engine = new RoutePlaybackEngine(Trip);
        bool done = false;
        for (int i = 0; i < 100_000 && !done; i++)
        {
            done = engine.Advance(100);
        }

        Assert.True(done);
        Assert.Equal(engine.TotalMs, engine.ElapsedMs);
        Assert.Equal(Trip.Length - 1, engine.CurrentIndex);
        Assert.True(engine.AtEnd);
    }

    [Fact]
    public void SeekToProgress_SetsCursorProportionally()
    {
        var engine = new RoutePlaybackEngine(Trip);
        engine.SeekToProgress(0.5);
        Assert.Equal(30_000, engine.ElapsedMs);
        Assert.InRange(engine.Progress, 0.49, 0.51);
    }

    [Fact]
    public void Empty_Trip_IsEmpty_AndAdvanceCompletes()
    {
        var engine = new RoutePlaybackEngine([]);
        Assert.True(engine.IsEmpty);
        Assert.True(engine.Advance(1));
        Assert.Null(engine.Current);
    }

    [Fact]
    public void NonFinite_OnlyTrip_IsEmpty()
    {
        var engine = new RoutePlaybackEngine(
        [
            new(double.NaN, double.NaN, 0),
        ]);
        Assert.True(engine.IsEmpty);
    }

    [Fact]
    public void ComputeHeading_DueNorth_IsZero()
    {
        double h = RoutePlaybackEngine.ComputeHeading(
            new PlaybackPoint(37.00, -122.00, 0),
            new PlaybackPoint(37.01, -122.00, 0));
        Assert.InRange(h, 0, 0.5);
    }

    [Fact]
    public void ComputeHeading_DueEast_IsNinety()
    {
        double h = RoutePlaybackEngine.ComputeHeading(
            new PlaybackPoint(0.0, 0.0, 0),
            new PlaybackPoint(0.0, 0.01, 0));
        Assert.InRange(h, 89.5, 90.5);
    }

    [Theory]
    [InlineData(0, "00:00")]
    [InlineData(5_000, "00:05")]
    [InlineData(65_000, "01:05")]
    [InlineData(3_725_000, "1:02:05")]
    public void FormatDuration_FormatsClock(double ms, string expected) =>
        Assert.Equal(expected, RoutePlaybackEngine.FormatDuration(ms));

    [Fact]
    public void Trail_DropsNonFinitePoints()
    {
        var engine = new RoutePlaybackEngine(
        [
            new(37.0, -122.0, 0),
            new(double.NaN, -122.0, 10),
            new(37.1, -122.0, 20),
        ]);
        Assert.Equal(2, engine.Trail().Count);
    }
}

public sealed class MarkerClusterEngineTests
{
    [Fact]
    public void Cluster_NearbyPoints_CollapseToOneBubble()
    {
        var center = new GeoPoint(37.7749, -122.4194);
        var points = new List<ClusterPoint>
        {
            new("a", 37.7749, -122.4194),
            new("b", 37.77491, -122.41941),
            new("c", 37.77492, -122.41939),
        };

        var bubbles = MarkerClusterEngine.Cluster(points, center, 12, 800, 600);

        Assert.Single(bubbles);
        Assert.Equal(3, bubbles[0].Count);
        Assert.False(bubbles[0].IsSingle);
    }

    [Fact]
    public void Cluster_DisabledAtHighZoom_AllSingletons()
    {
        var center = new GeoPoint(37.7749, -122.4194);
        var points = new List<ClusterPoint>
        {
            new("a", 37.7749, -122.4194),
            new("b", 37.77491, -122.41941),
        };

        var bubbles = MarkerClusterEngine.Cluster(points, center, 19, 800, 600);

        Assert.Equal(2, bubbles.Count);
        Assert.All(bubbles, b => Assert.True(b.IsSingle));
    }

    [Fact]
    public void Cluster_SkipsNonFiniteAndOffscreen()
    {
        var center = new GeoPoint(0, 0);
        var points = new List<ClusterPoint>
        {
            new("nan", double.NaN, 0),
            new("far", 80, 170),
            new("here", 0, 0),
        };

        var bubbles = MarkerClusterEngine.Cluster(points, center, 10, 400, 400);

        Assert.Single(bubbles);
        Assert.Equal("here", bubbles[0].Children[0].Id);
    }

    [Fact]
    public void Cluster_ZeroViewport_IsEmpty() =>
        Assert.Empty(MarkerClusterEngine.Cluster([], new GeoPoint(0, 0), 10, 0, 0));

    [Theory]
    [InlineData(150, "#f43f5e")]
    [InlineData(100, "#f43f5e")]
    [InlineData(40, "#fbbf24")]
    [InlineData(25, "#fbbf24")]
    [InlineData(12, "#a855f7")]
    [InlineData(10, "#a855f7")]
    [InlineData(3, "#22d3ee")]
    [InlineData(1, "#22d3ee")]
    public void DensityColor_FollowsThresholds(int count, string expected) =>
        Assert.Equal(expected, MarkerClusterEngine.DensityColor(count));
}
