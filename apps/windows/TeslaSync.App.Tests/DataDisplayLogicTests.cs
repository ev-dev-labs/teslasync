using System.Collections.Generic;
using TeslaSync.App.Core.DataDisplay;
using Xunit;

namespace TeslaSync.App.Tests;

/// <summary>Tests for the freshness / live-state logic and the 2-minute contract.</summary>
public sealed class FreshnessLogicTests
{
    private static readonly DateTimeOffset Now = new(2026, 6, 5, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void ComputeAge_NullTimestamp_ReturnsNull()
    {
        Assert.Null(FreshnessLogic.ComputeAge(null, Now));
    }

    [Fact]
    public void ComputeAge_FloorsAndClampsToZero()
    {
        Assert.Equal(0, FreshnessLogic.ComputeAge(Now.AddSeconds(5), Now));
        Assert.Equal(90, FreshnessLogic.ComputeAge(Now.AddSeconds(-90.7), Now));
    }

    [Theory]
    [InlineData(0, FreshnessStatus.Fresh)]
    [InlineData(119, FreshnessStatus.Fresh)]
    [InlineData(120, FreshnessStatus.Stale)]
    [InlineData(599, FreshnessStatus.Stale)]
    [InlineData(600, FreshnessStatus.Offline)]
    public void GetStatus_HonorsTwoMinuteContract(int age, FreshnessStatus expected)
    {
        Assert.Equal(expected, FreshnessLogic.GetStatus(age));
    }

    [Fact]
    public void GetStatus_NullAge_IsUnknown()
    {
        Assert.Equal(FreshnessStatus.Unknown, FreshnessLogic.GetStatus((int?)null));
    }

    [Fact]
    public void DefaultThresholds_AreTheTwoMinuteContract()
    {
        Assert.Equal(120, FreshnessLogic.DefaultStaleSeconds);
        Assert.Equal(600, FreshnessLogic.DefaultOfflineSeconds);
    }

    [Fact]
    public void IsStale_IsOffline_TrackTimestamp()
    {
        Assert.False(FreshnessLogic.IsStale(Now.AddSeconds(-60), Now));
        Assert.True(FreshnessLogic.IsStale(Now.AddSeconds(-120), Now));
        Assert.False(FreshnessLogic.IsOffline(Now.AddSeconds(-300), Now));
        Assert.True(FreshnessLogic.IsOffline(Now.AddSeconds(-600), Now));
    }

    [Theory]
    [InlineData(5, "just now")]
    [InlineData(42, "42s ago")]
    [InlineData(120, "2m ago")]
    [InlineData(7200, "2h ago")]
    public void FormatAge_TiersMatchWeb(int age, string expected)
    {
        Assert.Equal(expected, FreshnessLogic.FormatAge(age));
    }

    [Fact]
    public void FormatAge_Null_ReturnsEmDash()
    {
        Assert.Equal("\u2014", FreshnessLogic.FormatAge(null));
    }

    [Fact]
    public void FormatSourceAge_Tiers()
    {
        Assert.Equal("450 ms", FreshnessLogic.FormatSourceAge(450));
        Assert.Equal("3.2 s", FreshnessLogic.FormatSourceAge(3200));
        Assert.Equal("5 min", FreshnessLogic.FormatSourceAge(300_000));
        Assert.Null(FreshnessLogic.FormatSourceAge(null));
    }

    [Fact]
    public void AccentBrushKeys_AreTokenized()
    {
        Assert.Equal("TsColorSuccessBrush", FreshnessLogic.AccentBrushKey(FreshnessStatus.Fresh));
        Assert.Equal("TsColorWarningBrush", FreshnessLogic.AccentBrushKey(FreshnessStatus.Stale));
        Assert.Equal("TsColorDangerBrush", FreshnessLogic.AccentBrushKey(FreshnessStatus.Offline));
        Assert.Equal("TsColorTextMutedBrush", FreshnessLogic.AccentBrushKey(FreshnessStatus.Unknown));
    }
}

/// <summary>Tests for the live-connection presentation mapping.</summary>
public sealed class LiveConnectionTests
{
    [Theory]
    [InlineData(LiveConnectionState.Connected, "TsColorSuccessBrush", "Live", false)]
    [InlineData(LiveConnectionState.Reconnecting, "TsColorWarningBrush", "Reconnecting\u2026", true)]
    [InlineData(LiveConnectionState.Disconnected, "TsColorDangerBrush", "Offline", false)]
    [InlineData(LiveConnectionState.Unknown, "TsColorTextMutedBrush", "Unknown", false)]
    public void Presentation_MapsState(LiveConnectionState state, string brush, string label, bool animate)
    {
        Assert.Equal(brush, LiveConnectionPresentation.AccentBrushKey(state));
        Assert.Equal(label, LiveConnectionPresentation.DefaultLabel(state));
        Assert.Equal(animate, LiveConnectionPresentation.ShouldAnimate(state));
    }
}

/// <summary>Tests for the A–F score scale.</summary>
public sealed class ScoreScaleTests
{
    [Theory]
    [InlineData(95, "A+")]
    [InlineData(90, "A+")]
    [InlineData(85, "A")]
    [InlineData(70, "B")]
    [InlineData(55, "C")]
    [InlineData(40, "D")]
    [InlineData(10, "F")]
    [InlineData(0, "F")]
    public void NumericToGrade_DefaultThresholds(double score, string label)
    {
        Assert.Equal(label, ScoreScale.NumericToGrade(score).Label);
    }

    [Fact]
    public void NumericToGrade_NullOrNonFinite_NoData()
    {
        Assert.Equal("\u2014", ScoreScale.NumericToGrade(null).Label);
        Assert.Null(ScoreScale.NumericToGrade(null).Numeric);
        Assert.Equal("\u2014", ScoreScale.NumericToGrade(double.NaN).Label);
    }

    [Fact]
    public void GradeColors_AreStable()
    {
        Assert.Equal("#10b981", ScoreScale.Info(ScoreGrade.A).ColorHex);
        Assert.Equal("#00f0ff", ScoreScale.Info(ScoreGrade.B).ColorHex);
    }

    [Fact]
    public void AverageGrade_SkipsNullAndMapsBack()
    {
        var avg = ScoreScale.AverageGrade(new double?[] { 4.0, 3.0, null, 4.5 });
        Assert.Equal("A", avg.Label);
        Assert.Equal("\u2014", ScoreScale.AverageGrade(new double?[] { null, null }).Label);
    }
}

/// <summary>Tests for direction-aware delta computation.</summary>
public sealed class DeltaLogicTests
{
    [Fact]
    public void MissingInputs_NoComparison()
    {
        var r = DeltaLogic.Compute(null, 10, MetricDirection.HigherBetter);
        Assert.False(r.HasComparison);
    }

    [Fact]
    public void Increase_HigherBetter_IsPositive()
    {
        var r = DeltaLogic.Compute(110, 100, MetricDirection.HigherBetter);
        Assert.True(r.HasComparison);
        Assert.Equal(10, r.SignedDelta);
        Assert.Equal(DeltaArrow.Up, r.Arrow);
        Assert.Equal(DeltaTone.Positive, r.Tone);
        Assert.Equal(10, r.AbsolutePercent);
    }

    [Fact]
    public void Increase_LowerBetter_IsNegative()
    {
        var r = DeltaLogic.Compute(110, 100, MetricDirection.LowerBetter);
        Assert.Equal(DeltaTone.Negative, r.Tone);
    }

    [Fact]
    public void ZeroChange_IsMuted()
    {
        var r = DeltaLogic.Compute(100, 100, MetricDirection.HigherBetter);
        Assert.Equal(DeltaArrow.Flat, r.Arrow);
        Assert.Equal(DeltaTone.Muted, r.Tone);
    }

    [Fact]
    public void NeutralDirection_NeverGoodOrBad()
    {
        var r = DeltaLogic.Compute(110, 100, MetricDirection.Neutral);
        Assert.Equal(DeltaTone.Neutral, r.Tone);
    }

    [Fact]
    public void PreviousZero_PercentIsNull()
    {
        var r = DeltaLogic.Compute(50, 0, MetricDirection.HigherBetter);
        Assert.Null(r.SignedPercent);
        Assert.Null(r.AbsolutePercent);
        Assert.Equal(50, r.AbsoluteDelta);
    }
}

/// <summary>Tests for severity normalization and tokens.</summary>
public sealed class SeverityTests
{
    [Theory]
    [InlineData("warning", SeverityLevel.Warn)]
    [InlineData("WARN", SeverityLevel.Warn)]
    [InlineData("error", SeverityLevel.Critical)]
    [InlineData("fatal", SeverityLevel.Critical)]
    [InlineData("ok", SeverityLevel.Success)]
    [InlineData("success", SeverityLevel.Success)]
    [InlineData("info", SeverityLevel.Info)]
    [InlineData("nonsense", SeverityLevel.Info)]
    [InlineData(null, SeverityLevel.Info)]
    public void Normalize_MapsAliases(string? input, SeverityLevel expected)
    {
        Assert.Equal(expected, SeverityLevels.Normalize(input));
    }

    [Fact]
    public void Tokens_AreTokenized()
    {
        Assert.Equal("TsColorDangerBrush", SeverityLevels.TokensFor("error").AccentBrushKey);
        Assert.Equal("TsColorSuccessBrush", SeverityLevels.TokensFor("ok").AccentBrushKey);
    }
}

/// <summary>Tests for avatar hashing + initials.</summary>
public sealed class AvatarLogicTests
{
    [Fact]
    public void ColorIndex_IsDeterministicAndInRange()
    {
        int a = AvatarLogic.ColorIndex("user-42");
        int b = AvatarLogic.ColorIndex("user-42");
        Assert.Equal(a, b);
        Assert.InRange(a, 0, AvatarLogic.ColorPalette.Count - 1);
    }

    [Theory]
    [InlineData("John Doe", "JD")]
    [InlineData("Cher", "CH")]
    [InlineData("X", "X")]
    [InlineData("  ", "?")]
    [InlineData(null, "?")]
    [InlineData("alice wonderland smith", "AW")]
    public void Initials_MatchWeb(string? name, string expected)
    {
        Assert.Equal(expected, AvatarLogic.Initials(name));
    }
}

/// <summary>Tests for playback speed stepping.</summary>
public sealed class PlaybackSpeedTests
{
    [Fact]
    public void Speeds_AreCanonical()
    {
        Assert.Equal(new[] { 1, 10, 25, 50, 100 }, PlaybackSpeed.Speeds);
    }

    [Fact]
    public void Next_WrapsAround()
    {
        Assert.Equal(10, PlaybackSpeed.Next(1));
        Assert.Equal(1, PlaybackSpeed.Next(100));
    }

    [Fact]
    public void Shift_ClampsAtBounds()
    {
        Assert.Equal(1, PlaybackSpeed.Shift(1, -1));
        Assert.Equal(100, PlaybackSpeed.Shift(100, 1));
        Assert.Equal(25, PlaybackSpeed.Shift(10, 1));
    }
}

/// <summary>Tests for FSM domain mapping.</summary>
public sealed class FsmTypeTests
{
    [Theory]
    [InlineData("drive_session", "Drive", SeverityLevel.Success, false)]
    [InlineData("charge_session", "Charge", SeverityLevel.Warn, false)]
    [InlineData("notification", "Notify", SeverityLevel.Info, true)]
    [InlineData("mystery", "mystery", SeverityLevel.Info, true)]
    public void Mapping(string type, string label, SeverityLevel variant, bool neutral)
    {
        Assert.Equal(label, FsmType.Label(type));
        Assert.Equal(variant, FsmType.Variant(type));
        Assert.Equal(neutral, FsmType.IsNeutral(type));
    }
}

/// <summary>Tests for source-layer parsing + tokens.</summary>
public sealed class SourceLayerTests
{
    [Theory]
    [InlineData("l1", SourceLayer.L1, "L1", "TsColorSuccessBrush")]
    [InlineData("L2", SourceLayer.L2, "L2", "TsColorInfoBrush")]
    [InlineData("log", SourceLayer.Log, "LOG", "TsColorTextSecondaryBrush")]
    [InlineData("stale", SourceLayer.Stale, "STALE", "TsColorWarningBrush")]
    [InlineData("???", SourceLayer.Unknown, "\u2014", "TsColorTextMutedBrush")]
    public void ParseAndTokens(string wire, SourceLayer layer, string label, string brush)
    {
        Assert.Equal(layer, SourceLayers.Parse(wire));
        var tokens = SourceLayers.TokensFor(wire);
        Assert.Equal(label, tokens.Label);
        Assert.Equal(brush, tokens.AccentBrushKey);
    }
}

/// <summary>Tests for route resolution.</summary>
public sealed class RouteLogicTests
{
    [Fact]
    public void EndpointLabel_PrefersAddress()
    {
        Assert.Equal("123 Main St", RouteLogic.EndpointLabel(new RouteEndpoint("123 Main St")));
    }

    [Fact]
    public void EndpointLabel_FallsBackToCoords()
    {
        Assert.Equal("\uD83D\uDCCD 37.42, -122.08", RouteLogic.EndpointLabel(new RouteEndpoint(Lat: 37.42, Lon: -122.08)));
    }

    [Fact]
    public void EndpointLabel_NoneAvailable_Null()
    {
        Assert.Null(RouteLogic.EndpointLabel(new RouteEndpoint()));
    }

    [Fact]
    public void Resolve_NoEndpoints_None()
    {
        Assert.Equal(RouteKind.None, RouteLogic.Resolve(new RouteEndpoint()).Kind);
    }

    [Fact]
    public void Resolve_SingleStart_RoundTrip()
    {
        var r = RouteLogic.Resolve(new RouteEndpoint("Home"));
        Assert.Equal(RouteKind.RoundTrip, r.Kind);
        Assert.True(r.IsExplicitSingle);
    }

    [Fact]
    public void Resolve_MatchingAddresses_RoundTrip()
    {
        var r = RouteLogic.Resolve(new RouteEndpoint("Home"), new RouteEndpoint("Home"));
        Assert.Equal(RouteKind.RoundTrip, r.Kind);
        Assert.False(r.IsExplicitSingle);
    }

    [Fact]
    public void Resolve_CloseCoords_RoundTrip()
    {
        var start = new RouteEndpoint(Lat: 37.0000, Lon: -122.0000);
        var end = new RouteEndpoint(Lat: 37.0001, Lon: -122.0001);
        Assert.Equal(RouteKind.RoundTrip, RouteLogic.Resolve(start, end).Kind);
    }

    [Fact]
    public void Resolve_DistinctEndpoints_PointToPoint()
    {
        var r = RouteLogic.Resolve(new RouteEndpoint("Home"), new RouteEndpoint("Office"));
        Assert.Equal(RouteKind.PointToPoint, r.Kind);
    }

    [Fact]
    public void Haversine_KnownDistance()
    {
        // ~1 degree of latitude ≈ 111 km.
        double d = RouteLogic.HaversineMeters(0, 0, 1, 0);
        Assert.InRange(d, 111_000, 111_500);
    }
}

/// <summary>Tests for the animated-number model, including reduced motion.</summary>
public sealed class AnimatedNumberModelTests
{
    [Fact]
    public void ReducedMotion_SnapsToTargetImmediately()
    {
        var m = new AnimatedNumberModel(0, 100, durationSeconds: 1, reduceMotion: true);
        Assert.Equal(100, m.ValueAt(0));
        Assert.True(m.MotionReduced);
        Assert.True(m.IsComplete(0));
    }

    [Fact]
    public void Tween_StartsAtFrom_EndsAtTarget()
    {
        var m = new AnimatedNumberModel(0, 100, durationSeconds: 1);
        Assert.Equal(0, m.ValueAt(0), 6);
        Assert.Equal(100, m.ValueAt(1), 6);
        Assert.Equal(100, m.ValueAt(5), 6);
    }

    [Fact]
    public void Tween_IsMonotonicEaseOut()
    {
        var m = new AnimatedNumberModel(0, 100, durationSeconds: 1);
        double quarter = m.ValueAt(0.25);
        double half = m.ValueAt(0.5);
        // Ease-out: more than half progress is covered by the halfway point.
        Assert.True(half > 50);
        Assert.True(quarter < half);
    }

    [Fact]
    public void ZeroDuration_SnapsToTarget()
    {
        var m = new AnimatedNumberModel(0, 42, durationSeconds: 0);
        Assert.Equal(42, m.ValueAt(0));
    }

    [Fact]
    public void EaseOutQuad_ClampsDomain()
    {
        Assert.Equal(0, AnimatedNumberModel.EaseOutQuad(-1));
        Assert.Equal(1, AnimatedNumberModel.EaseOutQuad(2));
    }
}
