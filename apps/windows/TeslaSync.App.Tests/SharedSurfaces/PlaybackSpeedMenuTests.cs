using System.Collections.Generic;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the PlaybackSpeedMenu surface's UI-thread-free logic — the registration slug + i18n
/// key (<see cref="PlaybackSpeedMenuRegistration"/>), the pure replay-speed scale maths
/// (<see cref="PlaybackSpeeds"/>), the controlled speed state + per-step announcement logic
/// (<see cref="PlaybackSpeedMenuViewModel"/>), the change seam (<see cref="IPlaybackSpeedSink"/> with its
/// delegate-backed and inert implementations) and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/data-display/PlaybackSpeedMenu.tsx + the <c>ReplaySpeed</c> scale from
/// web/src/hooks/useTripReplay.ts). The WinUI view (PlaybackSpeedMenu.cs, which composes a TsButton + monospace
/// badge + ChevronDown and wires left-click cycle / right-click step-back) is exercised by the app build.
/// </summary>
public sealed class PlaybackSpeedMenuTests
{
    // ── recording doubles ────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingSink : IPlaybackSpeedSink
    {
        public List<int> Changes { get; } = new();

        public void OnSpeedChanged(int speed) => Changes.Add(speed);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static PlaybackSpeedMenuViewModel NewViewModel(
        RecordingSink? sink = null,
        ILocalizer? localizer = null,
        int initialSpeed = 1) =>
        new(sink ?? new RecordingSink(), localizer ?? new RecordingLocalizer(), initialSpeed);

    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_ExposesTheCanonicalSlug()
    {
        Assert.Equal("PlaybackSpeedMenu", PlaybackSpeedMenuRegistration.Slug);
    }

    [Fact]
    public void Registration_ExposesTheWebSpeedKeyAndFallback()
    {
        Assert.Equal("translation.replay.controls.speed", PlaybackSpeedMenuRegistration.SpeedKey);
        Assert.Equal("Playback speed", PlaybackSpeedMenuRegistration.SpeedFallback);
    }

    // ── scale maths ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Ordered_IsTheWebReplaySpeedScale()
    {
        Assert.Equal(new[] { 1, 10, 25, 50, 100 }, PlaybackSpeeds.Ordered);
    }

    [Theory]
    [InlineData(1, 10)]
    [InlineData(10, 25)]
    [InlineData(25, 50)]
    [InlineData(50, 100)]
    [InlineData(100, 1)] // wraps past the top back to the slowest
    [InlineData(7, 1)]   // unknown speed (web indexOf === -1) resumes from the first slot
    [InlineData(0, 1)]
    public void Next_CyclesAndWraps(int current, int expected)
    {
        Assert.Equal(expected, PlaybackSpeeds.Next(current));
    }

    [Theory]
    [InlineData(1, -1, 1)]    // clamp at the slowest
    [InlineData(1, 1, 10)]
    [InlineData(10, -1, 1)]
    [InlineData(10, 1, 25)]
    [InlineData(50, 1, 100)]
    [InlineData(100, 1, 100)] // clamp at the fastest
    [InlineData(100, -1, 50)]
    [InlineData(1, 2, 25)]    // multi-slot step
    [InlineData(100, -2, 25)]
    [InlineData(7, 1, 10)]    // unknown speed anchors at slot 0 (web safeIdx = 0)
    [InlineData(7, -1, 1)]
    [InlineData(7, 0, 1)]
    public void Shift_StepsAndClamps(int current, int delta, int expected)
    {
        Assert.Equal(expected, PlaybackSpeeds.Shift(current, delta));
    }

    [Theory]
    [InlineData(1, "1x")]
    [InlineData(10, "10x")]
    [InlineData(25, "25x")]
    [InlineData(100, "100x")]
    public void Format_RendersTheBadgeText(int speed, string expected)
    {
        Assert.Equal(expected, PlaybackSpeeds.Format(speed));
    }

    // ── view-model: construction + projection ────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_NullSink_Throws()
    {
        Assert.Throws<ArgumentNullException>(() => new PlaybackSpeedMenuViewModel(null!, new RecordingLocalizer()));
    }

    [Fact]
    public void ViewModel_NullLocalizer_Throws()
    {
        Assert.Throws<ArgumentNullException>(() => new PlaybackSpeedMenuViewModel(new RecordingSink(), null!));
    }

    [Fact]
    public void ViewModel_DefaultsToTheSlowestSpeed()
    {
        PlaybackSpeedMenuViewModel vm = NewViewModel();

        Assert.Equal(1, vm.Speed);
        Assert.Equal("1x", vm.SpeedLabel);
    }

    [Fact]
    public void ViewModel_ProjectsTheInitialSpeedBadge()
    {
        PlaybackSpeedMenuViewModel vm = NewViewModel(initialSpeed: 25);

        Assert.Equal(25, vm.Speed);
        Assert.Equal("25x", vm.SpeedLabel);
    }

    [Fact]
    public void ViewModel_AccessibleName_ResolvesTheWebAriaLabelKey()
    {
        var localizer = new RecordingLocalizer();
        PlaybackSpeedMenuViewModel vm = NewViewModel(localizer: localizer);

        Assert.Equal("Playback speed", vm.AccessibleName);
        Assert.Contains(PlaybackSpeedMenuRegistration.SpeedKey, localizer.RequestedKeys);
    }

    // ── view-model: user steps announce through the seam ─────────────────────────────────────────────────

    [Fact]
    public void Cycle_AdvancesBadgeAndAnnouncesNextSpeed()
    {
        var sink = new RecordingSink();
        PlaybackSpeedMenuViewModel vm = NewViewModel(sink, initialSpeed: 10);

        vm.Cycle();

        Assert.Equal(25, vm.Speed);
        Assert.Equal("25x", vm.SpeedLabel);
        Assert.Equal(new[] { 25 }, sink.Changes);
    }

    [Fact]
    public void Cycle_WrapsFromTheFastestBackToTheSlowest()
    {
        var sink = new RecordingSink();
        PlaybackSpeedMenuViewModel vm = NewViewModel(sink, initialSpeed: 100);

        vm.Cycle();

        Assert.Equal(1, vm.Speed);
        Assert.Equal(new[] { 1 }, sink.Changes);
    }

    [Fact]
    public void StepBackward_StepsOneSlotSlowerAndAnnounces()
    {
        var sink = new RecordingSink();
        PlaybackSpeedMenuViewModel vm = NewViewModel(sink, initialSpeed: 25);

        vm.StepBackward();

        Assert.Equal(10, vm.Speed);
        Assert.Equal(new[] { 10 }, sink.Changes);
    }

    [Fact]
    public void StepBackward_AtTheSlowest_AnnouncesUnchangedSpeed()
    {
        var sink = new RecordingSink();
        PlaybackSpeedMenuViewModel vm = NewViewModel(sink, initialSpeed: 1);

        vm.StepBackward();

        // web onChange fires even when the clamped shift lands on the same speed.
        Assert.Equal(1, vm.Speed);
        Assert.Equal(new[] { 1 }, sink.Changes);
    }

    [Fact]
    public void Shift_StepsMultipleSlotsAndAnnounces()
    {
        var sink = new RecordingSink();
        PlaybackSpeedMenuViewModel vm = NewViewModel(sink, initialSpeed: 1);

        vm.Shift(2);

        Assert.Equal(25, vm.Speed);
        Assert.Equal(new[] { 25 }, sink.Changes);
    }

    // ── view-model: controlled-prop echo never re-announces ──────────────────────────────────────────────

    [Fact]
    public void Speed_ProgrammaticAssignment_ReRendersButDoesNotAnnounce()
    {
        var sink = new RecordingSink();
        PlaybackSpeedMenuViewModel vm = NewViewModel(sink, initialSpeed: 10);

        vm.Speed = 50;

        Assert.Equal(50, vm.Speed);
        Assert.Equal("50x", vm.SpeedLabel);
        Assert.Empty(sink.Changes);
    }

    [Fact]
    public void Speed_AssigningTheSameValue_RaisesNoChange()
    {
        var sink = new RecordingSink();
        PlaybackSpeedMenuViewModel vm = NewViewModel(sink, initialSpeed: 10);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Speed = 10;

        Assert.Empty(raised);
        Assert.Empty(sink.Changes);
    }

    [Fact]
    public void Cycle_RaisesSpeedAndLabelChangeNotifications()
    {
        PlaybackSpeedMenuViewModel vm = NewViewModel(initialSpeed: 10);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Cycle();

        Assert.Contains(nameof(PlaybackSpeedMenuViewModel.Speed), raised);
        Assert.Contains(nameof(PlaybackSpeedMenuViewModel.SpeedLabel), raised);
    }

    // ── change seam ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void DelegateSink_ForwardsTheSpeedToTheDelegate()
    {
        int? captured = null;
        var sink = new DelegatePlaybackSpeedSink(speed => captured = speed);

        sink.OnSpeedChanged(25);

        Assert.Equal(25, captured);
    }

    [Fact]
    public void DelegateSink_NullDelegate_IsInert()
    {
        var sink = new DelegatePlaybackSpeedSink(null);

        sink.OnSpeedChanged(10); // must not throw
    }

    [Fact]
    public void NoOpSink_IsASharedInertSingleton()
    {
        Assert.Same(NoOpPlaybackSpeedSink.Instance, NoOpPlaybackSpeedSink.Instance);

        NoOpPlaybackSpeedSink.Instance.OnSpeedChanged(50); // must not throw
    }

    // ── diagnostics ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_RecordViewOpened_EmitsTheSluggedEvent()
    {
        var lines = new List<string>();
        var diagnostics = new PlaybackSpeedMenuDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(new[] { "view.opened slug=PlaybackSpeedMenu" }, lines);
    }

    [Fact]
    public void Diagnostics_CountsRepeatedOpens()
    {
        var diagnostics = new PlaybackSpeedMenuDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_NullSink_StillCounts()
    {
        var diagnostics = new PlaybackSpeedMenuDiagnostics();

        diagnostics.RecordViewOpened(); // must not throw

        Assert.Equal(1, diagnostics.ViewsOpened);
    }
}
