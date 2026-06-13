using TeslaSync.App.Core.DataDisplay;
using Xunit;

namespace TeslaSync.App.Tests;

/// <summary>
/// Headless verification of the <see cref="TripReplayEngine"/> — the native port of the web <c>useTripReplay</c>
/// hook (web/src/hooks/useTripReplay.ts): the timeline build, the closest-sample lookup, the per-frame tick, the
/// auto-stop at the end, and every seek / speed control. WinUI-free, so the replay clock is asserted without a UI
/// host.
/// </summary>
public sealed class TripReplayEngineTests
{
    private static readonly DateTimeOffset T0 = new(2026, 1, 1, 10, 0, 0, TimeSpan.Zero);

    private static DateTimeOffset?[] Timeline(params int[] secondsOffsets)
    {
        var stamps = new DateTimeOffset?[secondsOffsets.Length];
        for (int i = 0; i < secondsOffsets.Length; i++)
        {
            stamps[i] = T0.AddSeconds(secondsOffsets[i]);
        }

        return stamps;
    }

    [Fact]
    public void SetTimeline_builds_offsets_and_total()
    {
        var engine = new TripReplayEngine();
        engine.SetTimeline(Timeline(0, 30, 60));

        Assert.Equal(3, engine.PositionCount);
        Assert.Equal(60_000, engine.TotalMs);
        Assert.Equal(0, engine.CurrentIndex);
        Assert.False(engine.IsPlaying);
    }

    [Fact]
    public void SetTimeline_with_no_finite_timestamp_is_empty()
    {
        var engine = new TripReplayEngine();
        engine.SetTimeline(new DateTimeOffset?[] { null, null });

        Assert.Equal(0, engine.PositionCount);
        Assert.Equal(0, engine.TotalMs);
        Assert.False(engine.Tick());
    }

    [Fact]
    public void IndexAtTime_picks_the_closest_sample()
    {
        var engine = new TripReplayEngine();
        engine.SetTimeline(Timeline(0, 30, 60));

        Assert.Equal(0, engine.IndexAtTime(0));
        Assert.Equal(1, engine.IndexAtTime(31_000)); // closer to 30s than 60s
        Assert.Equal(2, engine.IndexAtTime(46_000)); // closer to 60s than 30s
        Assert.Equal(2, engine.IndexAtTime(999_999)); // clamps to last
    }

    [Fact]
    public void SeekToProgress_maps_progress_to_index()
    {
        var engine = new TripReplayEngine();
        engine.SetTimeline(Timeline(0, 30, 60));

        engine.SeekToProgress(0.5);
        Assert.Equal(1, engine.CurrentIndex);
        Assert.Equal(30_000.0, engine.ElapsedMs);
        Assert.Equal(0.5, engine.Progress, 3);
    }

    [Fact]
    public void SeekTo_clamps_to_range()
    {
        var engine = new TripReplayEngine();
        engine.SetTimeline(Timeline(0, 30, 60));

        engine.SeekTo(99);
        Assert.Equal(2, engine.CurrentIndex);

        engine.SeekTo(-5);
        Assert.Equal(0, engine.CurrentIndex);
    }

    [Fact]
    public void StepFrame_moves_one_sample()
    {
        var engine = new TripReplayEngine();
        engine.SetTimeline(Timeline(0, 30, 60));

        engine.StepFrame(1);
        Assert.Equal(1, engine.CurrentIndex);
        engine.StepFrame(-1);
        Assert.Equal(0, engine.CurrentIndex);
    }

    [Fact]
    public void Tick_advances_and_auto_stops_at_end()
    {
        var engine = new TripReplayEngine();
        engine.SetTimeline(Timeline(0, 30, 60));
        engine.SetSpeed(100);
        engine.Play();
        Assert.True(engine.IsPlaying);

        bool advanced = false;
        for (int i = 0; i < 200 && engine.IsPlaying; i++)
        {
            advanced |= engine.Tick();
        }

        Assert.True(advanced);
        Assert.False(engine.IsPlaying); // stopped at the end
        Assert.Equal(engine.PositionCount - 1, engine.CurrentIndex);
        Assert.Equal(1.0, engine.Progress, 3);
    }

    [Fact]
    public void Play_at_end_restarts_from_the_beginning()
    {
        var engine = new TripReplayEngine();
        engine.SetTimeline(Timeline(0, 30, 60));
        engine.SeekTo(2); // park at end

        engine.Play();

        Assert.True(engine.IsPlaying);
        Assert.Equal(0, engine.CurrentIndex);
        Assert.Equal(0.0, engine.ElapsedMs);
    }

    [Fact]
    public void Stop_rewinds_and_pauses()
    {
        var engine = new TripReplayEngine();
        engine.SetTimeline(Timeline(0, 30, 60));
        engine.SeekTo(2);
        engine.Play();

        engine.Stop();

        Assert.False(engine.IsPlaying);
        Assert.Equal(0, engine.CurrentIndex);
        Assert.Equal(0.0, engine.ElapsedMs);
    }

    [Fact]
    public void SetSpeedRelative_steps_through_the_known_slots()
    {
        var engine = new TripReplayEngine();
        Assert.Equal(1, engine.Speed);

        engine.SetSpeedRelative(1);
        Assert.Equal(10, engine.Speed);

        engine.SetSpeedRelative(-1);
        Assert.Equal(1, engine.Speed);

        engine.SetSpeedRelative(-1); // clamped at the slowest slot
        Assert.Equal(1, engine.Speed);
    }
}
