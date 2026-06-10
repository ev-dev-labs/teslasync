using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.StateMachine;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>StateTimeline</c> feature surface's UI-thread-free logic — the tolerant JSON
/// parse adapter (<c>StateTransition.FromJson</c> / <c>ParseList</c>), the timeline / empty branch projection,
/// the web-faithful windowing math (sort, <c>leftPct</c>), the FSM colour resolver (<c>getStateColor</c> port,
/// vehicle + telemetry tables, overrides + fallbacks), the gated widen / jump affordances, the
/// <c>presetLabel</c> and <c>formatRelative</c> formatting, the composed Narrator names, the localized keys and
/// the diagnostics. Mirrors the web spec
/// (web/src/features/system/components/state-machine/StateTimeline.tsx + its __tests__). The WinUI view itself
/// (feature-views\StateTimeline\StateTimeline.cs) is exercised by the app build.
/// </summary>
public sealed class StateTimelineTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2025, 1, 15, 12, 0, 0, TimeSpan.Zero);

    private static StateTransition Transition(
        long id = 1,
        DateTimeOffset? ts = null,
        string from = "parked",
        string to = "driving") =>
        new(id, ts ?? Now.AddMinutes(-5), from, to);

    private static StateTimelineDisplay Project(StateTimelineModel model) =>
        StateTimelineProjection.Project(model, Localizer, Now);

    // ── Parse adapter (cached JSON → transition) ────────────────────────────────────────────────────

    [Fact]
    public void FromJson_reads_snake_case_object()
    {
        const string json = """
        { "id": 42, "ts": "2025-01-15T11:55:00Z", "from_state": "parked", "to_state": "driving" }
        """;
        using var doc = JsonDocument.Parse(json);

        var tr = StateTransition.FromJson(doc.RootElement);

        Assert.Equal(42, tr.Id);
        Assert.Equal(new DateTimeOffset(2025, 1, 15, 11, 55, 0, TimeSpan.Zero), tr.Ts);
        Assert.Equal("parked", tr.FromState);
        Assert.Equal("driving", tr.ToState);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"id":7}""");

        var tr = StateTransition.FromJson(doc.RootElement);

        Assert.Equal(7, tr.Id);
        Assert.Equal(DateTimeOffset.UnixEpoch, tr.Ts);
        Assert.Equal(string.Empty, tr.FromState);
        Assert.Equal(string.Empty, tr.ToState);
    }

    [Fact]
    public void FromJson_accepts_numeric_epoch_timestamp()
    {
        using var doc = JsonDocument.Parse("""{"id":"9","ts":1736942100,"from_state":"online","to_state":"asleep"}""");

        var tr = StateTransition.FromJson(doc.RootElement);

        Assert.Equal(9, tr.Id);
        Assert.Equal(DateTimeOffset.FromUnixTimeSeconds(1736942100), tr.Ts);
    }

    [Fact]
    public void ParseList_reads_array_and_skips_non_objects()
    {
        const string json = """
        [ {"id":1,"to_state":"driving"}, 5, "x", {"id":2,"to_state":"parked"} ]
        """;
        using var doc = JsonDocument.Parse(json);

        var list = StateTransition.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].Id);
        Assert.Equal(2, list[1].Id);
    }

    [Fact]
    public void ParseList_unwraps_data_envelope()
    {
        const string json = """{ "data": [ {"id":3}, {"id":4} ], "total": 2 }""";
        using var doc = JsonDocument.Parse(json);

        var list = StateTransition.ParseList(doc.RootElement);

        Assert.Equal(new long[] { 3, 4 }, list.Select(t => t.Id));
    }

    [Theory]
    [InlineData("null")]
    [InlineData("123")]
    [InlineData("\"x\"")]
    [InlineData("{}")]
    public void ParseList_maps_non_array_to_empty(string json)
    {
        using var doc = JsonDocument.Parse(json);

        Assert.Empty(StateTransition.ParseList(doc.RootElement));
    }

    // ── Empty projection (no transitions in window) ─────────────────────────────────────────────────

    [Fact]
    public void Project_empty_without_hint_shows_only_the_message()
    {
        var display = Project(StateTimelineModel.Empty);

        Assert.Equal(StateTimelineState.Empty, display.State);
        Assert.Equal(StateTimelineProjection.EmptyFallback, display.EmptyMessage);
        Assert.False(display.HasHint);
        Assert.False(display.ShowWiden);
        Assert.False(display.ShowJump);
        Assert.Equal(display.EmptyMessage, display.AutomationName);
        Assert.Empty(display.Ticks);
    }

    [Fact]
    public void Project_empty_with_hint_renders_last_seen_and_both_buttons()
    {
        var last = Transition(id: 88, ts: Now.AddMinutes(-30));
        var model = new StateTimelineModel(
            Array.Empty<StateTransition>(),
            "vehicle",
            WindowMinutes: 10,
            LastTransition: last,
            WiderPreset: 30,
            CanWidenWindow: true,
            CanJumpToLast: true);

        var display = Project(model);

        Assert.Equal(StateTimelineState.Empty, display.State);
        Assert.True(display.HasHint);
        Assert.Contains("Last transition", display.LastSeenText, StringComparison.Ordinal);
        Assert.Contains("30m ago", display.LastSeenText, StringComparison.Ordinal);
        Assert.True(display.ShowWiden);
        Assert.Equal("Widen window to 30 min", display.WidenText);
        Assert.True(display.ShowJump);
        Assert.Equal("Jump to last transition", display.JumpText);
        Assert.Contains(display.LastSeenText, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_empty_hides_widen_when_no_preset_fits_but_keeps_jump()
    {
        var model = new StateTimelineModel(
            Array.Empty<StateTransition>(),
            "vehicle",
            LastTransition: Transition(id: 88, ts: Now.AddDays(-2)),
            WiderPreset: null,
            CanWidenWindow: true,
            CanJumpToLast: true);

        var display = Project(model);

        Assert.False(display.ShowWiden);
        Assert.True(display.ShowJump);
    }

    [Theory]
    [InlineData(true, true, true)]    // preset + handler → shown
    [InlineData(false, true, false)]  // no preset → hidden
    [InlineData(true, false, false)]  // no handler → hidden
    public void Project_widen_visibility_requires_preset_and_handler(bool hasPreset, bool canWiden, bool expected)
    {
        var model = new StateTimelineModel(
            Array.Empty<StateTransition>(),
            "vehicle",
            LastTransition: Transition(id: 5, ts: Now.AddMinutes(-20)),
            WiderPreset: hasPreset ? 30 : null,
            CanWidenWindow: canWiden,
            CanJumpToLast: false);

        Assert.Equal(expected, Project(model).ShowWiden);
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, false)]
    public void Project_jump_visibility_requires_handler(bool canJump, bool expected)
    {
        var model = new StateTimelineModel(
            Array.Empty<StateTransition>(),
            "vehicle",
            LastTransition: Transition(id: 5, ts: Now.AddMinutes(-20)),
            CanJumpToLast: canJump);

        Assert.Equal(expected, Project(model).ShowJump);
    }

    [Fact]
    public void Project_empty_jump_hidden_without_last_transition()
    {
        var model = new StateTimelineModel(Array.Empty<StateTransition>(), "vehicle", CanJumpToLast: true);

        Assert.False(Project(model).ShowJump);
    }

    // ── Timeline projection (ticks) ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_timeline_sorts_ticks_and_positions_them()
    {
        var anchor = new DateTimeOffset(2025, 1, 15, 12, 0, 0, TimeSpan.Zero);
        var later = Transition(id: 12, ts: new DateTimeOffset(2025, 1, 15, 11, 58, 0, TimeSpan.Zero));
        var earlier = Transition(id: 11, ts: new DateTimeOffset(2025, 1, 15, 11, 55, 0, TimeSpan.Zero));

        var model = new StateTimelineModel(
            new[] { later, earlier },
            "vehicle",
            WindowMinutes: 10,
            Anchor: anchor);

        var display = Project(model);

        Assert.Equal(StateTimelineState.Timeline, display.State);
        Assert.Equal(new long[] { 11, 12 }, display.Ticks.Select(t => t.Id)); // sorted ascending by ts
        Assert.Equal(50.0, display.Ticks[0].LeftPercent, 3);                  // 11:55 is the window midpoint
        Assert.Equal(80.0, display.Ticks[1].LeftPercent, 3);                  // 11:58 → 8/10 of the window
    }

    [Theory]
    [InlineData("11:50:00", 0.0)]   // window start
    [InlineData("11:55:00", 50.0)]  // midpoint
    [InlineData("12:00:00", 100.0)] // window end (anchor)
    public void Project_timeline_left_percent_matches_window_position(string time, double expected)
    {
        var anchor = new DateTimeOffset(2025, 1, 15, 12, 0, 0, TimeSpan.Zero);
        var ts = DateTimeOffset.Parse($"2025-01-15T{time}Z", CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AdjustToUniversal);

        var display = Project(new StateTimelineModel(
            new[] { Transition(id: 1, ts: ts) },
            "vehicle",
            WindowMinutes: 10,
            Anchor: anchor));

        Assert.Equal(expected, display.Ticks[0].LeftPercent, 3);
    }

    [Fact]
    public void Project_timeline_marks_the_selected_tick()
    {
        var t1 = Transition(id: 21, ts: Now.AddMinutes(-5));
        var t2 = Transition(id: 22, ts: Now.AddMinutes(-3));

        var display = Project(new StateTimelineModel(
            new[] { t1, t2 },
            "vehicle",
            SelectedId: 22,
            Anchor: Now,
            WindowMinutes: 10));

        Assert.False(display.Ticks.Single(t => t.Id == 21).IsSelected);
        Assert.True(display.Ticks.Single(t => t.Id == 22).IsSelected);
    }

    [Fact]
    public void Project_timeline_tick_carries_tooltip_and_aria()
    {
        var display = Project(new StateTimelineModel(
            new[] { Transition(id: 1, ts: Now.AddMinutes(-5), from: "parked", to: "driving") },
            "vehicle",
            Anchor: Now,
            WindowMinutes: 10));

        var tick = display.Ticks[0];
        Assert.Contains("parked", tick.TooltipText, StringComparison.Ordinal);
        Assert.Contains("driving", tick.TooltipText, StringComparison.Ordinal);
        Assert.Contains("\u2192", tick.TooltipText, StringComparison.Ordinal); // → arrow
        Assert.Equal("parked to driving", tick.AutomationName);
    }

    [Fact]
    public void Project_timeline_resolves_tick_colour_from_destination_state()
    {
        var display = Project(new StateTimelineModel(
            new[] { Transition(id: 1, to: "charging") },
            "vehicle",
            Anchor: Now,
            WindowMinutes: 10));

        Assert.Equal(StateColorResolver.InfoDotKey, display.Ticks[0].DotColorKey); // charging → override dot cyan
    }

    [Fact]
    public void Project_timeline_automation_name_is_non_empty()
    {
        var display = Project(new StateTimelineModel(
            new[] { Transition(id: 1) },
            "vehicle",
            Anchor: Now,
            WindowMinutes: 10));

        Assert.False(string.IsNullOrEmpty(display.AutomationName));
        Assert.Contains("Window", display.AutomationName, StringComparison.Ordinal);
    }

    // ── Preset label (web presetLabel) ──────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(10, "10 min")]
    [InlineData(30, "30 min")]
    [InlineData(59, "59 min")]
    [InlineData(60, "1 h")]
    [InlineData(90, "2 h")]   // Math.round(1.5) == 2
    [InlineData(120, "2 h")]
    [InlineData(720, "12 h")]
    [InlineData(1439, "24 h")]
    [InlineData(1440, "24 h")]
    public void PresetLabel_matches_web(int minutes, string expected)
    {
        Assert.Equal(expected, StateTimelineProjection.PresetLabel(minutes, Localizer));
    }

    // ── Relative formatting (web formatRelative) ────────────────────────────────────────────────────

    [Fact]
    public void FormatRelative_under_a_minute_is_just_now() =>
        Assert.Equal("just now", StateTimelineProjection.FormatRelative(Now.AddSeconds(-30), Now));

    [Theory]
    [InlineData(-30, "30m ago")]
    [InlineData(-59, "59m ago")]
    public void FormatRelative_minutes(int minutes, string expected) =>
        Assert.Equal(expected, StateTimelineProjection.FormatRelative(Now.AddMinutes(minutes), Now));

    [Theory]
    [InlineData(-2, "2h ago")]
    [InlineData(-23, "23h ago")]
    public void FormatRelative_hours(int hours, string expected) =>
        Assert.Equal(expected, StateTimelineProjection.FormatRelative(Now.AddHours(hours), Now));

    [Theory]
    [InlineData(-1, "1d ago")]
    [InlineData(-6, "6d ago")]
    public void FormatRelative_days(int days, string expected) =>
        Assert.Equal(expected, StateTimelineProjection.FormatRelative(Now.AddDays(days), Now));

    [Fact]
    public void FormatRelative_beyond_a_week_is_an_absolute_date()
    {
        var rel = StateTimelineProjection.FormatRelative(Now.AddDays(-9), Now);

        Assert.DoesNotContain("ago", rel, StringComparison.Ordinal);
        Assert.Contains("2025", rel, StringComparison.Ordinal);
    }

    // ── Colour resolver (web getStateColor) ─────────────────────────────────────────────────────────

    [Theory]
    [InlineData("online", StateColorVariant.Success, StateColorResolver.SuccessDotKey)]
    [InlineData("driving", StateColorVariant.Success, StateColorResolver.SuccessDotKey)]
    [InlineData("charging", StateColorVariant.Warning, StateColorResolver.InfoDotKey)]
    [InlineData("parked", StateColorVariant.Info, StateColorResolver.VioletDotKey)]
    [InlineData("updating", StateColorVariant.Info, StateColorResolver.VioletDotKey)]
    [InlineData("asleep", StateColorVariant.Neutral, StateColorResolver.NeutralDotKey)]
    [InlineData("offline", StateColorVariant.Danger, StateColorResolver.NeutralDotKey)]
    public void Resolve_vehicle_states(string state, StateColorVariant variant, string dotKey)
    {
        var color = StateColorResolver.Resolve("vehicle", state);

        Assert.Equal(variant, color.Variant);
        Assert.Equal(dotKey, color.DotColorKey);
    }

    [Theory]
    [InlineData("unknown", StateColorVariant.Neutral, StateColorResolver.NeutralDotKey)]
    [InlineData("connecting", StateColorVariant.Warning, StateColorResolver.WarningDotKey)]
    [InlineData("streaming", StateColorVariant.Success, StateColorResolver.SuccessDotKey)]
    [InlineData("stale", StateColorVariant.Warning, StateColorResolver.WarningDotKey)]
    [InlineData("disconnected", StateColorVariant.Danger, StateColorResolver.DangerDotKey)]
    [InlineData("polling_only", StateColorVariant.Info, StateColorResolver.InfoDotKey)]
    public void Resolve_telemetry_connection_states(string state, StateColorVariant variant, string dotKey)
    {
        var color = StateColorResolver.Resolve("telemetry_connection", state);

        Assert.Equal(variant, color.Variant);
        Assert.Equal(dotKey, color.DotColorKey);
    }

    [Fact]
    public void Resolve_is_case_insensitive()
    {
        Assert.Equal(StateColorVariant.Success, StateColorResolver.Resolve("Vehicle", "ONLINE").Variant);
    }

    [Fact]
    public void Resolve_unknown_fsm_falls_back_to_vehicle_table()
    {
        // Web: FSM_REGISTRY[fsmType] ?? FSM_REGISTRY.vehicle — an unknown domain resolves vehicle states.
        Assert.Equal(StateColorResolver.SuccessDotKey, StateColorResolver.Resolve("drive_session", "online").DotColorKey);
    }

    [Fact]
    public void Resolve_unknown_state_is_neutral_default()
    {
        Assert.Equal(StateColorResolver.Default, StateColorResolver.Resolve("vehicle", "made_up_state"));
        Assert.Equal(StateColorResolver.Default, StateColorResolver.Resolve("telemetry_connection", "nope"));
    }

    // ── i18n keys (every key resolves through the facade) ───────────────────────────────────────────

    [Fact]
    public void Projection_requests_every_catalog_key()
    {
        var recorder = new RecordingLocalizer();

        // Empty branch with a hint + widen + jump exercises empty / lastSeen / widenTo / jumpToLast.
        StateTimelineProjection.Project(
            new StateTimelineModel(
                Array.Empty<StateTransition>(),
                "vehicle",
                LastTransition: Transition(id: 1, ts: Now.AddMinutes(-20)),
                WiderPreset: 30,
                CanWidenWindow: true,
                CanJumpToLast: true),
            recorder,
            Now);

        // Timeline branch exercises windowLabel + tickAria.
        StateTimelineProjection.Project(
            new StateTimelineModel(new[] { Transition(id: 2) }, "vehicle", Anchor: Now, WindowMinutes: 10),
            recorder,
            Now);

        // Preset label tiers exercise the three window.* keys.
        StateTimelineProjection.PresetLabel(30, recorder);
        StateTimelineProjection.PresetLabel(120, recorder);
        StateTimelineProjection.PresetLabel(1440, recorder);

        Assert.Contains(StateTimelineProjection.EmptyKey, recorder.Keys);
        Assert.Contains(StateTimelineProjection.LastSeenKey, recorder.Keys);
        Assert.Contains(StateTimelineProjection.WidenToKey, recorder.Keys);
        Assert.Contains(StateTimelineProjection.JumpToLastKey, recorder.Keys);
        Assert.Contains(StateTimelineProjection.WindowLabelKey, recorder.Keys);
        Assert.Contains(StateTimelineProjection.TickAriaKey, recorder.Keys);
        Assert.Contains(StateTimelineProjection.WindowMinutesKey, recorder.Keys);
        Assert.Contains(StateTimelineProjection.WindowHoursKey, recorder.Keys);
        Assert.Contains(StateTimelineProjection.WindowDayKey, recorder.Keys);
    }

    [Fact]
    public void Catalog_keys_match_the_web_source()
    {
        Assert.Equal("debugger.window.minutes", StateTimelineProjection.WindowMinutesKey);
        Assert.Equal("debugger.window.hours", StateTimelineProjection.WindowHoursKey);
        Assert.Equal("debugger.window.day", StateTimelineProjection.WindowDayKey);
        Assert.Equal("debugger.timeline.empty", StateTimelineProjection.EmptyKey);
        Assert.Equal("debugger.timeline.lastSeen", StateTimelineProjection.LastSeenKey);
        Assert.Equal("debugger.timeline.widenTo", StateTimelineProjection.WidenToKey);
        Assert.Equal("debugger.timeline.jumpToLast", StateTimelineProjection.JumpToLastKey);
        Assert.Equal("debugger.timeline.windowLabel", StateTimelineProjection.WindowLabelKey);
        Assert.Equal("debugger.timeline.tickAria", StateTimelineProjection.TickAriaKey);
    }

    // ── Diagnostics (PII-safe view.opened) ──────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened()
    {
        var emitted = new List<string>();
        var diagnostics = new StateTimelineDiagnostics(emitted.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=StateTimeline", Assert.Single(emitted));
    }

    [Fact]
    public void Registration_exposes_the_slug()
    {
        Assert.Equal("StateTimeline", StateTimelineRegistration.Slug);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
