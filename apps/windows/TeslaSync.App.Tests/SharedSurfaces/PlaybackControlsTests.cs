using System.Collections.Generic;
using System.Linq;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the PlaybackControls surface's UI-thread-free logic — the registration slug + i18n
/// keys (<see cref="PlaybackControlsRegistration"/>), the computed inline-toast labels
/// (<see cref="PlaybackToastLabels"/>), the route-scoped cheatsheet builder
/// (<see cref="ReplayShortcutCheatsheet"/>), the transport seam (<see cref="IPlaybackTransportSink"/> with its
/// delegate-backed + inert implementations), the controlled state, projections, button commands, the keyboard
/// interpretation, the toast state machine and the cheatsheet registration
/// (<see cref="PlaybackControlsViewModel"/>), and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/data-display/PlaybackControls.tsx). The WinUI view (PlaybackControls.cs, which composes the
/// TsButton trio + the embedded PlaybackSpeedMenu / TimelineScrubber + the time read-out + the help tooltip + the
/// toast, and forwards button clicks / mapped key presses) is exercised by the app build.
/// </summary>
public sealed class PlaybackControlsTests
{
    // ── recording doubles ────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingTransport : IPlaybackTransportSink
    {
        public List<string> Order { get; } = new();
        public int PlayCount { get; private set; }
        public int PauseCount { get; private set; }
        public int StopCount { get; private set; }
        public List<int> SpeedChanges { get; } = new();
        public List<double> Seeks { get; } = new();
        public List<double> SeekBys { get; } = new();
        public List<int> SpeedRelatives { get; } = new();
        public List<int> Frames { get; } = new();

        public bool CanSeekBy { get; init; }
        public bool CanSpeedRelative { get; init; }
        public bool CanStepFrame { get; init; }

        public void Play()
        {
            PlayCount++;
            Order.Add("play");
        }

        public void Pause()
        {
            PauseCount++;
            Order.Add("pause");
        }

        public void StopPlayback()
        {
            StopCount++;
            Order.Add("stop");
        }

        public void SpeedChange(int speed)
        {
            SpeedChanges.Add(speed);
            Order.Add($"speed:{speed}");
        }

        public void Seek(double progress)
        {
            Seeks.Add(progress);
            Order.Add("seek");
        }

        public void SeekBy(double deltaSeconds)
        {
            SeekBys.Add(deltaSeconds);
            Order.Add("seekBy");
        }

        public void SpeedRelative(int delta)
        {
            SpeedRelatives.Add(delta);
            Order.Add("speedRel");
        }

        public void StepFrame(int delta)
        {
            Frames.Add(delta);
            Order.Add("frame");
        }
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

    private static PlaybackControlsViewModel NewViewModel(
        RecordingTransport? transport = null,
        ILocalizer? localizer = null,
        IShortcutRegistry? shortcuts = null,
        bool keyboard = true) =>
        new(
            transport ?? new RecordingTransport(),
            localizer ?? new RecordingLocalizer(),
            shortcuts ?? new ShortcutRegistry())
        {
            EnableKeyboardShortcuts = keyboard,
        };

    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_ExposesTheCanonicalSlug()
    {
        Assert.Equal("PlaybackControls", PlaybackControlsRegistration.Slug);
    }

    [Fact]
    public void Registration_ExposesTheControlKeysAndFallbacks()
    {
        Assert.Equal("translation.replay.controls.reset", PlaybackControlsRegistration.ResetKey);
        Assert.Equal("Reset", PlaybackControlsRegistration.ResetFallback);
        Assert.Equal("translation.replay.controls.play", PlaybackControlsRegistration.PlayKey);
        Assert.Equal("Play", PlaybackControlsRegistration.PlayFallback);
        Assert.Equal("translation.replay.controls.pause", PlaybackControlsRegistration.PauseKey);
        Assert.Equal("Pause", PlaybackControlsRegistration.PauseFallback);
        Assert.Equal("translation.replay.controls.stop", PlaybackControlsRegistration.StopKey);
        Assert.Equal("Stop", PlaybackControlsRegistration.StopFallback);
    }

    [Fact]
    public void Registration_ExposesTheShortcutKeysAndFallbacks()
    {
        Assert.Equal("translation.replay.shortcuts.help", PlaybackControlsRegistration.HelpKey);
        Assert.Equal("Show keyboard shortcuts", PlaybackControlsRegistration.HelpFallback);
        Assert.Equal("Trip replay shortcuts", PlaybackControlsRegistration.HelpTitleFallback);
        Assert.Equal("Play / Pause", PlaybackControlsRegistration.PlayPauseFallback);
        Assert.Equal("Skip \u00B15s (Shift = \u00B130s)", PlaybackControlsRegistration.Skip5Fallback);
        Assert.Equal("Skip \u00B110s", PlaybackControlsRegistration.Skip10Fallback);
        Assert.Equal("Previous / next frame", PlaybackControlsRegistration.FrameFallback);
        Assert.Equal("Jump to start / end", PlaybackControlsRegistration.StartEndFallback);
        Assert.Equal("Jump to N\u00D710%", PlaybackControlsRegistration.PercentFallback);
        Assert.Equal("Speed up / slow down", PlaybackControlsRegistration.SpeedFallback);
        Assert.Equal("Trip replay", PlaybackControlsRegistration.GroupFallback);
    }

    [Fact]
    public void Registration_ToastFallbacks_MatchTheWebGlyphLabels()
    {
        Assert.Equal("\u23EE frame", PlaybackControlsRegistration.ToastPrevFrameFallback);
        Assert.Equal("\u23ED frame", PlaybackControlsRegistration.ToastNextFrameFallback);
        Assert.Equal("\u23EE start", PlaybackControlsRegistration.ToastStartFallback);
        Assert.Equal("\u23ED end", PlaybackControlsRegistration.ToastEndFallback);
        Assert.Equal("Faster", PlaybackControlsRegistration.ToastSpeedUpFallback);
        Assert.Equal("Slower", PlaybackControlsRegistration.ToastSpeedDownFallback);
    }

    [Fact]
    public void Registration_ToastDuration_MatchesTheWebTimeout()
    {
        Assert.Equal(900, PlaybackControlsRegistration.ToastDurationMs);
    }

    [Theory]
    [InlineData("/drives/abc123/replay", true)]
    [InlineData("/drives/42/replay", true)]
    [InlineData("/drives", false)]
    [InlineData("/charging", false)]
    public void Registration_ReplayRoute_MatchesOnlyTheReplayRoute(string path, bool expected)
    {
        Assert.Equal(expected, PlaybackControlsRegistration.ReplayRoute.IsMatch(path));
    }

    // ── computed toast labels ────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(-5, "\u23EA \u22125s")]
    [InlineData(-30, "\u23EA \u221230s")]
    [InlineData(-10, "\u23EA \u221210s")]
    [InlineData(5, "\u23E9 +5s")]
    [InlineData(30, "\u23E9 +30s")]
    [InlineData(10, "\u23E9 +10s")]
    public void ToastLabels_SeekSeconds_MatchTheWebGlyphLabels(int delta, string expected)
    {
        Assert.Equal(expected, PlaybackToastLabels.SeekSeconds(delta));
    }

    [Theory]
    [InlineData(0.0, "0%")]
    [InlineData(0.5, "50%")]
    [InlineData(0.9, "90%")]
    [InlineData(1.0, "100%")]
    public void ToastLabels_Percent_RoundsToAWholePercent(double normalized, string expected)
    {
        Assert.Equal(expected, PlaybackToastLabels.Percent(normalized));
    }

    // ── cheatsheet builder ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Cheatsheet_Build_NullLocalizer_Throws()
    {
        Assert.Throws<ArgumentNullException>(() => ReplayShortcutCheatsheet.Build(null!));
    }

    [Fact]
    public void Cheatsheet_Build_ProducesTheSevenWebEntriesInOrder()
    {
        IReadOnlyList<ShortcutDefinition> defs = ReplayShortcutCheatsheet.Build(new RecordingLocalizer());

        Assert.Equal(7, defs.Count);
        Assert.Equal(
            new[]
            {
                "replay.scrubber.playPause",
                "replay.scrubber.skip5",
                "replay.scrubber.skip10",
                "replay.scrubber.frame",
                "replay.scrubber.startEnd",
                "replay.scrubber.percent",
                "replay.scrubber.speed",
            },
            defs.Select(d => d.Id).ToArray());
    }

    [Fact]
    public void Cheatsheet_Build_EntriesAreRouteScopedToTheReplayRoute()
    {
        IReadOnlyList<ShortcutDefinition> defs = ReplayShortcutCheatsheet.Build(new RecordingLocalizer());

        Assert.All(defs, d =>
        {
            Assert.Equal(ShortcutScope.Route, d.Scope);
            Assert.Same(PlaybackControlsRegistration.ReplayRoute, d.RoutePattern);
            Assert.Equal("Trip replay", d.Group);
        });
    }

    [Fact]
    public void Cheatsheet_Build_CarriesTheLocalizedKeysAndDescriptions()
    {
        IReadOnlyList<ShortcutDefinition> defs = ReplayShortcutCheatsheet.Build(new RecordingLocalizer());

        ShortcutDefinition skip5 = defs.Single(d => d.Id == "replay.scrubber.skip5");
        Assert.Equal(new[] { "\u2190", "\u2192" }, skip5.Keys.ToArray());
        Assert.Equal("Skip \u00B15s (Shift = \u00B130s)", skip5.Description);

        ShortcutDefinition playPause = defs.Single(d => d.Id == "replay.scrubber.playPause");
        Assert.Equal(new[] { "Space" }, playPause.Keys.ToArray());
        Assert.Equal("Play / Pause", playPause.Description);
    }

    // ── view-model: construction ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_NullTransport_Throws()
    {
        Assert.Throws<ArgumentNullException>(() =>
            new PlaybackControlsViewModel(null!, new RecordingLocalizer(), new ShortcutRegistry()));
    }

    [Fact]
    public void ViewModel_NullLocalizer_Throws()
    {
        Assert.Throws<ArgumentNullException>(() =>
            new PlaybackControlsViewModel(new RecordingTransport(), null!, new ShortcutRegistry()));
    }

    [Fact]
    public void ViewModel_NullShortcuts_Throws()
    {
        Assert.Throws<ArgumentNullException>(() =>
            new PlaybackControlsViewModel(new RecordingTransport(), new RecordingLocalizer(), null!));
    }

    [Fact]
    public void ViewModel_DefaultsAreInert()
    {
        PlaybackControlsViewModel vm = NewViewModel(keyboard: false);

        Assert.False(vm.IsPlaying);
        Assert.Equal(1, vm.Speed);
        Assert.Equal(0, vm.Progress);
        Assert.False(vm.EnableKeyboardShortcuts);
        Assert.False(vm.ShowKeyboardHelp);
        Assert.Null(vm.CurrentToast);
        Assert.Equal(0, vm.ToastSequence);
    }

    // ── view-model: projections (per-state) ──────────────────────────────────────────────────────────────

    [Fact]
    public void TimeText_CombinesElapsedAndTotal()
    {
        PlaybackControlsViewModel vm = NewViewModel();
        vm.Elapsed = "1:23";
        vm.Total = "5:10";

        Assert.Equal("1:23 / 5:10", vm.TimeText);
    }

    [Fact]
    public void DurationSeconds_ConvertsFromMillisecondsAndGuardsZero()
    {
        PlaybackControlsViewModel vm = NewViewModel();

        Assert.Equal(0, vm.DurationSeconds);

        vm.DurationMs = 90_000;
        Assert.Equal(90, vm.DurationSeconds);

        vm.DurationMs = 0;
        Assert.Equal(0, vm.DurationSeconds);
    }

    [Fact]
    public void PlayPauseAccessibleName_TogglesWithPlayState()
    {
        var localizer = new RecordingLocalizer();
        PlaybackControlsViewModel vm = NewViewModel(localizer: localizer);

        Assert.Equal("Play", vm.PlayPauseAccessibleName);

        vm.IsPlaying = true;
        Assert.Equal("Pause", vm.PlayPauseAccessibleName);
    }

    [Fact]
    public void AccessibleNames_ResolveTheWebKeys()
    {
        var localizer = new RecordingLocalizer();
        PlaybackControlsViewModel vm = NewViewModel(localizer: localizer);

        Assert.Equal("Reset", vm.ResetAccessibleName);
        Assert.Equal("Stop", vm.StopAccessibleName);
        Assert.Equal("Show keyboard shortcuts", vm.HelpAccessibleName);
        Assert.Equal("Trip replay shortcuts", vm.HelpTitle);
        Assert.Equal("Trip replay", vm.GroupLabel);

        Assert.Contains(PlaybackControlsRegistration.ResetKey, localizer.RequestedKeys);
        Assert.Contains(PlaybackControlsRegistration.StopKey, localizer.RequestedKeys);
        Assert.Contains(PlaybackControlsRegistration.HelpKey, localizer.RequestedKeys);
    }

    [Fact]
    public void ShowKeyboardHelp_TracksTheEnableFlag()
    {
        PlaybackControlsViewModel vm = NewViewModel(keyboard: false);
        Assert.False(vm.ShowKeyboardHelp);

        vm.EnableKeyboardShortcuts = true;
        Assert.True(vm.ShowKeyboardHelp);
    }

    [Fact]
    public void HelpEntries_AreTheSevenWebRowsWithChipsAndDescriptions()
    {
        PlaybackControlsViewModel vm = NewViewModel();

        IReadOnlyList<PlaybackHelpEntry> entries = vm.HelpEntries;

        Assert.Equal(7, entries.Count);
        Assert.Equal("Space / K", entries[0].Keys);
        Assert.Equal("Play / Pause", entries[0].Description);
        Assert.Equal("\u2190 / \u2192", entries[1].Keys);
        Assert.Equal("+ / \u2212", entries[6].Keys);
        Assert.Equal("Speed up / slow down", entries[6].Description);
    }

    // ── view-model: button commands (announce, never toast) ───────────────────────────────────────────────

    [Fact]
    public void PlayPause_WhenPaused_AnnouncesPlay()
    {
        var transport = new RecordingTransport();
        PlaybackControlsViewModel vm = NewViewModel(transport);

        vm.PlayPause();

        Assert.Equal(1, transport.PlayCount);
        Assert.Equal(0, transport.PauseCount);
        Assert.Null(vm.CurrentToast); // a button click never toasts
    }

    [Fact]
    public void PlayPause_WhenPlaying_AnnouncesPause()
    {
        var transport = new RecordingTransport();
        PlaybackControlsViewModel vm = NewViewModel(transport);
        vm.IsPlaying = true;

        vm.PlayPause();

        Assert.Equal(1, transport.PauseCount);
        Assert.Equal(0, transport.PlayCount);
    }

    [Fact]
    public void ResetAndStop_BothAnnounceStop()
    {
        var transport = new RecordingTransport();
        PlaybackControlsViewModel vm = NewViewModel(transport);

        vm.Reset();
        vm.Stop();

        Assert.Equal(2, transport.StopCount);
    }

    [Fact]
    public void NotifySpeedChanged_RelaysThroughTheSeam()
    {
        var transport = new RecordingTransport();
        PlaybackControlsViewModel vm = NewViewModel(transport);

        vm.NotifySpeedChanged(25);

        Assert.Equal(new[] { 25 }, transport.SpeedChanges);
    }

    [Fact]
    public void NotifySeek_RelaysThroughTheSeam()
    {
        var transport = new RecordingTransport();
        PlaybackControlsViewModel vm = NewViewModel(transport);

        vm.NotifySeek(0.42);

        Assert.Equal(new[] { 0.42 }, transport.Seeks);
    }

    // ── view-model: keyboard interpretation ──────────────────────────────────────────────────────────────

    [Fact]
    public void HandleShortcut_WhenDisabled_IsInert()
    {
        var transport = new RecordingTransport();
        PlaybackControlsViewModel vm = NewViewModel(transport, keyboard: false);

        bool handled = vm.HandleShortcut(PlaybackShortcutKey.Space, shift: false);

        Assert.False(handled);
        Assert.Empty(transport.Order);
        Assert.Null(vm.CurrentToast);
    }

    [Fact]
    public void HandleShortcut_None_IsUnhandled()
    {
        var transport = new RecordingTransport();
        PlaybackControlsViewModel vm = NewViewModel(transport);

        Assert.False(vm.HandleShortcut(PlaybackShortcutKey.None, shift: false));
        Assert.Empty(transport.Order);
    }

    [Theory]
    [InlineData(PlaybackShortcutKey.Space)]
    [InlineData(PlaybackShortcutKey.K)]
    public void HandleShortcut_SpaceOrK_TogglesAndToasts(PlaybackShortcutKey key)
    {
        var transport = new RecordingTransport();
        PlaybackControlsViewModel vm = NewViewModel(transport);

        Assert.True(vm.HandleShortcut(key, shift: false)); // paused -> play
        Assert.Equal(1, transport.PlayCount);
        Assert.Equal("Play", vm.CurrentToast);

        vm.IsPlaying = true;
        Assert.True(vm.HandleShortcut(key, shift: false)); // playing -> pause
        Assert.Equal(1, transport.PauseCount);
        Assert.Equal("Pause", vm.CurrentToast);
    }

    [Theory]
    [InlineData(PlaybackShortcutKey.ArrowLeft, false, "\u23EA \u22125s")]
    [InlineData(PlaybackShortcutKey.ArrowLeft, true, "\u23EA \u221230s")]
    [InlineData(PlaybackShortcutKey.ArrowRight, false, "\u23E9 +5s")]
    [InlineData(PlaybackShortcutKey.ArrowRight, true, "\u23E9 +30s")]
    public void HandleShortcut_Arrows_SeekBySecondsViaDurationAndToast(
        PlaybackShortcutKey key, bool shift, string expectedToast)
    {
        var transport = new RecordingTransport(); // CanSeekBy = false -> duration fallback
        PlaybackControlsViewModel vm = NewViewModel(transport);
        vm.Progress = 0.5;
        vm.DurationMs = 10_000; // 10s, so ±5s == ±0.5 progress

        Assert.True(vm.HandleShortcut(key, shift));
        Assert.Equal(expectedToast, vm.CurrentToast);
        Assert.Single(transport.Seeks);
        Assert.Empty(transport.SeekBys);
    }

    [Fact]
    public void HandleShortcut_ArrowLeft_FiveSeconds_ClampsAndSeeks()
    {
        var transport = new RecordingTransport();
        PlaybackControlsViewModel vm = NewViewModel(transport);
        vm.Progress = 0.5;
        vm.DurationMs = 10_000;

        vm.HandleShortcut(PlaybackShortcutKey.ArrowLeft, shift: false); // 0.5 - 0.5 = 0.0

        Assert.Equal(new[] { 0.0 }, transport.Seeks);
    }

    [Fact]
    public void HandleShortcut_Arrow_PrefersSeekBySeamWhenWired()
    {
        var transport = new RecordingTransport { CanSeekBy = true };
        PlaybackControlsViewModel vm = NewViewModel(transport);
        vm.Progress = 0.5;
        vm.DurationMs = 10_000;

        vm.HandleShortcut(PlaybackShortcutKey.ArrowRight, shift: false);

        Assert.Equal(new[] { 5.0 }, transport.SeekBys);
        Assert.Empty(transport.Seeks); // the duration fallback is not used when onSeekBy is wired
    }

    [Fact]
    public void HandleShortcut_Arrow_NoDurationNoSeekBy_StillToastsAndConsumes()
    {
        var transport = new RecordingTransport(); // no seekBy, no duration
        PlaybackControlsViewModel vm = NewViewModel(transport);

        bool handled = vm.HandleShortcut(PlaybackShortcutKey.ArrowLeft, shift: false);

        Assert.True(handled);
        Assert.Empty(transport.Seeks);
        Assert.Empty(transport.SeekBys);
        Assert.Equal("\u23EA \u22125s", vm.CurrentToast);
    }

    [Theory]
    [InlineData(PlaybackShortcutKey.J, -10.0)]
    [InlineData(PlaybackShortcutKey.L, 10.0)]
    public void HandleShortcut_JAndL_SeekTenSeconds(PlaybackShortcutKey key, double expectedDelta)
    {
        var transport = new RecordingTransport { CanSeekBy = true };
        PlaybackControlsViewModel vm = NewViewModel(transport);

        vm.HandleShortcut(key, shift: false);

        Assert.Equal(new[] { expectedDelta }, transport.SeekBys);
    }

    [Fact]
    public void HandleShortcut_FrameKeys_NoCapability_AreUnhandled()
    {
        var transport = new RecordingTransport { CanStepFrame = false };
        PlaybackControlsViewModel vm = NewViewModel(transport);

        Assert.False(vm.HandleShortcut(PlaybackShortcutKey.Comma, shift: false));
        Assert.False(vm.HandleShortcut(PlaybackShortcutKey.Period, shift: false));
        Assert.Empty(transport.Frames);
        Assert.Null(vm.CurrentToast);
    }

    [Fact]
    public void HandleShortcut_FrameKeys_WithCapability_StepAndToast()
    {
        var transport = new RecordingTransport { CanStepFrame = true };
        PlaybackControlsViewModel vm = NewViewModel(transport);

        Assert.True(vm.HandleShortcut(PlaybackShortcutKey.Comma, shift: false));
        Assert.Equal("\u23EE frame", vm.CurrentToast);

        Assert.True(vm.HandleShortcut(PlaybackShortcutKey.Period, shift: false));
        Assert.Equal("\u23ED frame", vm.CurrentToast);

        Assert.Equal(new[] { -1, 1 }, transport.Frames);
    }

    [Fact]
    public void HandleShortcut_HomeAndEnd_SeekToEndsAndToast()
    {
        var transport = new RecordingTransport();
        PlaybackControlsViewModel vm = NewViewModel(transport);

        Assert.True(vm.HandleShortcut(PlaybackShortcutKey.Home, shift: false));
        Assert.Equal("\u23EE start", vm.CurrentToast);

        Assert.True(vm.HandleShortcut(PlaybackShortcutKey.End, shift: false));
        Assert.Equal("\u23ED end", vm.CurrentToast);

        Assert.Equal(new[] { 0.0, 1.0 }, transport.Seeks);
    }

    [Theory]
    [InlineData(PlaybackShortcutKey.Digit0, 0.0, "0%")]
    [InlineData(PlaybackShortcutKey.Digit5, 0.5, "50%")]
    [InlineData(PlaybackShortcutKey.Digit9, 0.9, "90%")]
    public void HandleShortcut_Digits_SeekToPercentAndToast(
        PlaybackShortcutKey key, double expectedSeek, string expectedToast)
    {
        var transport = new RecordingTransport();
        PlaybackControlsViewModel vm = NewViewModel(transport);

        Assert.True(vm.HandleShortcut(key, shift: false));

        Assert.Equal(new[] { expectedSeek }, transport.Seeks);
        Assert.Equal(expectedToast, vm.CurrentToast);
    }

    [Fact]
    public void HandleShortcut_PlusMinus_NoRelativeSeam_FallBackToShiftSpeed()
    {
        var transport = new RecordingTransport(); // CanSpeedRelative = false
        PlaybackControlsViewModel vm = NewViewModel(transport);
        vm.Speed = 10;

        Assert.True(vm.HandleShortcut(PlaybackShortcutKey.Plus, shift: false));
        Assert.Equal("Faster", vm.CurrentToast);

        Assert.True(vm.HandleShortcut(PlaybackShortcutKey.Minus, shift: false));
        Assert.Equal("Slower", vm.CurrentToast);

        // web shiftSpeed: 10 -> 25 (faster), then re-read speed is still 10 (controlled) -> 1 (slower).
        Assert.Equal(new[] { PlaybackSpeeds.Shift(10, 1), PlaybackSpeeds.Shift(10, -1) }, transport.SpeedChanges);
        Assert.Empty(transport.SpeedRelatives);
    }

    [Fact]
    public void HandleShortcut_PlusMinus_PrefersRelativeSeamWhenWired()
    {
        var transport = new RecordingTransport { CanSpeedRelative = true };
        PlaybackControlsViewModel vm = NewViewModel(transport);

        vm.HandleShortcut(PlaybackShortcutKey.Plus, shift: false);
        vm.HandleShortcut(PlaybackShortcutKey.Minus, shift: false);

        Assert.Equal(new[] { 1, -1 }, transport.SpeedRelatives);
        Assert.Empty(transport.SpeedChanges);
    }

    // ── view-model: toast state machine ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Toast_SetByShortcut_BumpsSequenceAndRaisesChange()
    {
        PlaybackControlsViewModel vm = NewViewModel();
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.HandleShortcut(PlaybackShortcutKey.Home, shift: false);

        Assert.Equal("\u23EE start", vm.CurrentToast);
        Assert.Equal(1, vm.ToastSequence);
        Assert.Contains(nameof(PlaybackControlsViewModel.CurrentToast), raised);
        Assert.Contains(nameof(PlaybackControlsViewModel.ToastSequence), raised);
    }

    [Fact]
    public void Toast_RepeatedSameLabel_StillBumpsSequence()
    {
        PlaybackControlsViewModel vm = NewViewModel();

        vm.HandleShortcut(PlaybackShortcutKey.Home, shift: false);
        long first = vm.ToastSequence;
        vm.HandleShortcut(PlaybackShortcutKey.Home, shift: false);

        Assert.Equal("\u23EE start", vm.CurrentToast);
        Assert.Equal(first + 1, vm.ToastSequence);
    }

    [Fact]
    public void ClearToast_ResetsTheLabel()
    {
        PlaybackControlsViewModel vm = NewViewModel();
        vm.HandleShortcut(PlaybackShortcutKey.Home, shift: false);

        vm.ClearToast();

        Assert.Null(vm.CurrentToast);
    }

    // ── view-model: cheatsheet registration (useShortcut lifecycle) ──────────────────────────────────────

    [Fact]
    public void RegisterShortcuts_PopulatesTheRegistryWithTheSevenEntries()
    {
        var registry = new ShortcutRegistry();
        PlaybackControlsViewModel vm = NewViewModel(shortcuts: registry);

        vm.RegisterShortcuts();

        Assert.Equal(7, registry.Snapshot.Count);
        Assert.All(registry.Snapshot, d => Assert.StartsWith("replay.scrubber.", d.Id, StringComparison.Ordinal));
    }

    [Fact]
    public void RegisterShortcuts_IsIdempotent()
    {
        var registry = new ShortcutRegistry();
        PlaybackControlsViewModel vm = NewViewModel(shortcuts: registry);

        vm.RegisterShortcuts();
        vm.RegisterShortcuts();

        Assert.Equal(7, registry.Snapshot.Count);
    }

    [Fact]
    public void UnregisterShortcuts_RemovesTheEntries()
    {
        var registry = new ShortcutRegistry();
        PlaybackControlsViewModel vm = NewViewModel(shortcuts: registry);
        vm.RegisterShortcuts();

        vm.UnregisterShortcuts();

        Assert.Empty(registry.Snapshot);
    }

    [Fact]
    public void Dispose_UnregistersTheCheatsheet()
    {
        var registry = new ShortcutRegistry();
        PlaybackControlsViewModel vm = NewViewModel(shortcuts: registry);
        vm.RegisterShortcuts();

        vm.Dispose();

        Assert.Empty(registry.Snapshot);
    }

    // ── transport seam ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void DelegateTransport_ForwardsTheWiredHandlersAndAdvertisesCapabilities()
    {
        var log = new List<string>();
        var sink = new DelegatePlaybackTransportSink(
            onPlay: () => log.Add("play"),
            onPause: () => log.Add("pause"),
            onStop: () => log.Add("stop"),
            onSpeedChange: speed => log.Add($"speed:{speed}"),
            onSeek: progress => log.Add($"seek:{progress}"),
            onSeekBy: delta => log.Add($"seekBy:{delta}"),
            onSpeedRelative: delta => log.Add($"speedRel:{delta}"),
            onStepFrame: delta => log.Add($"frame:{delta}"));

        Assert.True(sink.CanSeekBy);
        Assert.True(sink.CanSpeedRelative);
        Assert.True(sink.CanStepFrame);

        sink.Play();
        sink.Pause();
        sink.StopPlayback();
        sink.SpeedChange(25);
        sink.Seek(0.5);
        sink.SeekBy(-5);
        sink.SpeedRelative(1);
        sink.StepFrame(-1);

        Assert.Equal(
            new[] { "play", "pause", "stop", "speed:25", "seek:0.5", "seekBy:-5", "speedRel:1", "frame:-1" },
            log);
    }

    [Fact]
    public void DelegateTransport_OmittedOptionalHandlers_AreNotCapable()
    {
        var sink = new DelegatePlaybackTransportSink(
            onPlay: null,
            onPause: null,
            onStop: null,
            onSpeedChange: null,
            onSeek: null);

        Assert.False(sink.CanSeekBy);
        Assert.False(sink.CanSpeedRelative);
        Assert.False(sink.CanStepFrame);

        // Null required handlers degrade to no-ops rather than throwing.
        sink.Play();
        sink.SpeedChange(10);
        sink.Seek(0.1);
    }

    [Fact]
    public void NoOpTransport_IsASharedInertSingletonWithNoCapabilities()
    {
        Assert.Same(NoOpPlaybackTransportSink.Instance, NoOpPlaybackTransportSink.Instance);
        Assert.False(NoOpPlaybackTransportSink.Instance.CanSeekBy);
        Assert.False(NoOpPlaybackTransportSink.Instance.CanSpeedRelative);
        Assert.False(NoOpPlaybackTransportSink.Instance.CanStepFrame);

        NoOpPlaybackTransportSink.Instance.Play(); // must not throw
        NoOpPlaybackTransportSink.Instance.StopPlayback();
    }

    // ── diagnostics ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_RecordViewOpened_EmitsTheSluggedEvent()
    {
        var lines = new List<string>();
        var diagnostics = new PlaybackControlsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(new[] { "view.opened slug=PlaybackControls" }, lines);
    }

    [Fact]
    public void Diagnostics_CountsRepeatedOpens()
    {
        var diagnostics = new PlaybackControlsDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_NullSink_StillCounts()
    {
        var diagnostics = new PlaybackControlsDiagnostics();

        diagnostics.RecordViewOpened(); // must not throw

        Assert.Equal(1, diagnostics.ViewsOpened);
    }
}
