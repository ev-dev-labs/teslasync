using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>FSMTimelineChart</c> feature surface's UI-thread-free logic — the branch
/// projection (empty / ready), the web bucket-size selection (≤6h → 10m, ≤24h → 30m, else 2h), the
/// epoch-aligned windowed bucketing of transitions by <c>fsm_name</c>, the sorted distinct FSM types (collected
/// across every transition), the busiest-bucket <c>MaxTotal</c>, the local <c>HH:mm</c> bucket labels, the
/// optional <c>emptyMessage</c> override, the resolved i18n labels, the accessible names, and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/features/system/components/FSMTimelineChart.tsx). The WinUI view
/// itself (FSMTimelineChart.cs) is exercised by the app build.
/// </summary>
public sealed class FSMTimelineChartTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // A fixed UTC reference instant so the windowed bucketing and HH:mm labels are deterministic.
    private static readonly DateTimeOffset NowUtc = new(2026, 6, 10, 12, 0, 0, TimeSpan.Zero);

    private static FSMTimelineTransition Tr(string fsm, string ts) => new(fsm, ts);

    private static FSMTimelineChartModel Model(int hours, params FSMTimelineTransition[] transitions) =>
        new(transitions, hours);

    private static FSMTimelineChartDisplay Project(FSMTimelineChartModel model, DateTimeOffset? now = null) =>
        FSMTimelineChartProjection.Project(model, Localizer, now ?? NowUtc);

    private static FSMTimelineBucket Bucket(FSMTimelineChartDisplay display, string label) =>
        display.Buckets.First(b => b.TimeLabel == label);

    // ── Bucket-size selection (web `hours <= 6 ? 10·60_000 : hours <= 24 ? 30·60_000 : 2·60·60_000`) ──────

    [Theory]
    [InlineData(0, 600_000)]
    [InlineData(1, 600_000)]
    [InlineData(6, 600_000)]
    [InlineData(7, 1_800_000)]
    [InlineData(24, 1_800_000)]
    [InlineData(25, 7_200_000)]
    [InlineData(168, 7_200_000)]
    [InlineData(2160, 7_200_000)]
    public void Bucket_size_matches_the_web_window_thresholds(int hours, long expectedMs) =>
        Assert.Equal(expectedMs, FSMTimelineChartProjection.BucketSizeMs(hours));

    // ── Branch selection: web `transitions.length === 0 ? empty : (buckets.length > 0 ? chart : …)` ───────

    [Fact]
    public void Empty_when_no_transitions()
    {
        var display = Project(FSMTimelineChartModel.Empty);

        Assert.Equal(FSMTimelineChartState.Empty, display.State);
        Assert.Empty(display.Buckets);
        Assert.Empty(display.FsmTypes);
        Assert.Empty(display.SeriesColorIndices);
        Assert.Equal(0, display.MaxTotal);
    }

    [Fact]
    public void Ready_when_any_transition_present()
    {
        var display = Project(Model(6, Tr("vehicle", "2026-06-10T11:55:00Z")));

        Assert.Equal(FSMTimelineChartState.Ready, display.State);
        Assert.NotEmpty(display.Buckets);
    }

    [Fact]
    public void Ready_is_gated_on_transition_count_not_on_in_window_landings()
    {
        // Web parity: the empty branch is `transitions.length === 0`, computed before bucketing. A transition
        // whose timestamp falls entirely outside the window still promotes to the charted (flat-zero) state.
        var display = Project(Model(6, Tr("vehicle", "2026-06-10T03:00:00Z")));

        Assert.Equal(FSMTimelineChartState.Ready, display.State);
        Assert.Equal(0, display.MaxTotal);
        Assert.Contains("vehicle", display.FsmTypes);
    }

    // ── Windowed bucketing + counts (web floor(ts/bucketMs)·bucketMs, in-window only) ────────────────────

    [Fact]
    public void Buckets_span_the_aligned_window_inclusive()
    {
        // 6h window at 10-minute buckets over [06:00, 12:00] → 37 aligned buckets.
        var display = Project(Model(6, Tr("vehicle", "2026-06-10T11:55:00Z")));

        Assert.Equal(37, display.Buckets.Count);
        Assert.Equal("06:00", display.Buckets[0].TimeLabel);
        Assert.Equal("12:00", display.Buckets[^1].TimeLabel);
    }

    [Fact]
    public void Transitions_increment_their_aligned_bucket_per_type()
    {
        var display = Project(Model(
            6,
            Tr("vehicle", "2026-06-10T11:55:00Z"),
            Tr("vehicle", "2026-06-10T11:52:00Z"),
            Tr("telemetry_connection", "2026-06-10T11:53:00Z")));

        // Sorted distinct types (web Array.from(set).sort()): telemetry_connection < vehicle (ordinal).
        Assert.Equal(new[] { "telemetry_connection", "vehicle" }, display.FsmTypes);

        // All three timestamps floor to the 11:50 bucket.
        var bucket = Bucket(display, "11:50");
        Assert.Equal(1, bucket.Counts[0]); // telemetry_connection
        Assert.Equal(2, bucket.Counts[1]); // vehicle
        Assert.Equal(3, bucket.Total);
    }

    [Fact]
    public void Max_total_is_the_busiest_bucket_height()
    {
        var display = Project(Model(
            6,
            Tr("vehicle", "2026-06-10T11:55:00Z"),
            Tr("vehicle", "2026-06-10T11:52:00Z"),
            Tr("vehicle", "2026-06-10T10:05:00Z")));

        Assert.Equal(2, Bucket(display, "11:50").Total);
        Assert.Equal(1, Bucket(display, "10:00").Total);
        Assert.Equal(2, display.MaxTotal);
    }

    [Fact]
    public void Empty_buckets_carry_a_zero_for_every_type()
    {
        var display = Project(Model(
            6,
            Tr("vehicle", "2026-06-10T11:55:00Z"),
            Tr("telemetry_connection", "2026-06-10T11:53:00Z")));

        var quiet = Bucket(display, "07:00");
        Assert.Equal(2, quiet.Counts.Count);
        Assert.Equal(0, quiet.Counts[0]);
        Assert.Equal(0, quiet.Counts[1]);
        Assert.Equal(0, quiet.Total);
    }

    [Fact]
    public void Out_of_window_transitions_are_dropped_but_still_seed_their_type()
    {
        var display = Project(Model(
            6,
            Tr("vehicle", "2026-06-10T11:55:00Z"), // in-window
            Tr("sleep", "2026-06-10T01:00:00Z")));  // before the 06:00 window start → dropped

        Assert.Equal(new[] { "sleep", "vehicle" }, display.FsmTypes);
        Assert.Equal(1, display.MaxTotal); // only the in-window vehicle transition counts
        Assert.Equal(1, Bucket(display, "11:50").Counts[1]);
    }

    [Fact]
    public void Unparseable_timestamps_are_dropped()
    {
        var display = Project(Model(6, Tr("vehicle", "not-a-timestamp")));

        Assert.Equal(FSMTimelineChartState.Ready, display.State);
        Assert.Contains("vehicle", display.FsmTypes);
        Assert.Equal(0, display.MaxTotal);
    }

    [Fact]
    public void Types_are_collected_across_all_transitions_and_sorted_ordinally()
    {
        var display = Project(Model(
            6,
            Tr("vehicle", "2026-06-10T11:55:00Z"),
            Tr("apex", "2026-06-10T11:50:00Z"),
            Tr("telemetry_connection", "2026-06-10T01:00:00Z"))); // out of window, but its type still appears

        Assert.Equal(new[] { "apex", "telemetry_connection", "vehicle" }, display.FsmTypes);
        Assert.Equal(new[] { 0, 1, 2 }, display.SeriesColorIndices);
    }

    [Fact]
    public void Single_bucket_window_counts_only_the_current_interval()
    {
        // hours = 0 → start = now, one aligned bucket at the current 10-minute slot (12:00).
        var display = Project(Model(0, Tr("vehicle", "2026-06-10T12:00:00Z")));

        Assert.Single(display.Buckets);
        Assert.Equal("12:00", display.Buckets[0].TimeLabel);
        Assert.Equal(1, display.Buckets[0].Total);
        Assert.Equal(1, display.MaxTotal);
    }

    [Fact]
    public void Single_bucket_window_drops_a_transition_in_a_different_interval()
    {
        var display = Project(Model(0, Tr("vehicle", "2026-06-10T11:55:00Z")));

        Assert.Equal(FSMTimelineChartState.Ready, display.State);
        Assert.Single(display.Buckets);
        Assert.Equal(0, display.MaxTotal);
    }

    // ── Local-time bucket labels (web `new Date(key).getHours()/getMinutes()` — the runtime's local clock) ─

    [Fact]
    public void Bucket_labels_render_in_the_reference_instants_local_offset()
    {
        var nowPlusTwo = new DateTimeOffset(2026, 6, 10, 12, 0, 0, TimeSpan.FromHours(2));
        var display = Project(Model(1, Tr("vehicle", "2026-06-10T12:00:00+02:00")), nowPlusTwo);

        // The transition instant (10:00Z) buckets to the 12:00 local wall-clock label, not 10:00.
        var busy = display.Buckets.First(b => b.Total > 0);
        Assert.Equal("12:00", busy.TimeLabel);
    }

    // ── Empty message (web `emptyMessage ?? t('fsm.noTimelineData', …)`) ──────────────────────────────────

    [Fact]
    public void Empty_message_falls_back_to_the_localized_default() =>
        Assert.Equal("No transition data for timeline", Project(FSMTimelineChartModel.Empty).EmptyMessage);

    [Fact]
    public void Empty_message_prefers_the_parent_override()
    {
        var display = Project(new FSMTimelineChartModel(
            Array.Empty<FSMTimelineTransition>(), 6, "No transitions in the last 7 days"));

        Assert.Equal(FSMTimelineChartState.Empty, display.State);
        Assert.Equal("No transitions in the last 7 days", display.EmptyMessage);
    }

    // ── Resolved labels (i18n facade fallbacks mirror the web `t(...)` defaults) ─────────────────────────

    [Fact]
    public void Resolves_title_and_aria_label_from_the_facade()
    {
        var display = Project(Model(6, Tr("vehicle", "2026-06-10T11:55:00Z")));

        Assert.Equal("Transitions Over Time", display.Title);
        Assert.Equal("FSM transitions over time stacked area chart", display.AriaLabel);
    }

    [Fact]
    public void Title_renders_in_both_branches()
    {
        Assert.Equal("Transitions Over Time", Project(FSMTimelineChartModel.Empty).Title);
        Assert.Equal("Transitions Over Time", Project(Model(6, Tr("v", "2026-06-10T11:55:00Z"))).Title);
    }

    // ── Accessibility: every state + every bucket exposes a meaningful Narrator name ─────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(FSMTimelineChartModel.Empty),
                Project(Model(6, Tr("vehicle", "2026-06-10T11:55:00Z"))),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Ready_automation_name_carries_the_title_and_aria_label()
    {
        var display = Project(Model(6, Tr("vehicle", "2026-06-10T11:55:00Z")));

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.AriaLabel, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_title_and_empty_message()
    {
        var display = Project(FSMTimelineChartModel.Empty);

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Populated_bucket_exposes_a_descriptive_automation_name()
    {
        var display = Project(Model(
            6,
            Tr("vehicle", "2026-06-10T11:55:00Z"),
            Tr("vehicle", "2026-06-10T11:52:00Z"),
            Tr("telemetry_connection", "2026-06-10T11:53:00Z")));

        var name = Bucket(display, "11:50").AutomationName;
        Assert.Contains("11:50", name, StringComparison.Ordinal);
        Assert.Contains("vehicle 2", name, StringComparison.Ordinal);
        Assert.Contains("telemetry_connection 1", name, StringComparison.Ordinal);
    }

    [Fact]
    public void Quiet_bucket_automation_name_states_there_were_no_transitions()
    {
        var display = Project(Model(6, Tr("vehicle", "2026-06-10T11:55:00Z")));

        var name = Bucket(display, "07:00").AutomationName;
        Assert.Contains("07:00", name, StringComparison.Ordinal);
        Assert.Contains("No transitions", name, StringComparison.Ordinal);
    }

    [Fact]
    public void Blank_type_name_renders_an_em_dash_in_the_bucket_summary()
    {
        var display = Project(Model(6, Tr(string.Empty, "2026-06-10T11:55:00Z")));

        Assert.Contains(EmDash, Bucket(display, "11:50").AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=FSMTimelineChart, PII-safe ────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new FSMTimelineChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FSMTimelineChart", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_transition_or_timestamp_data()
    {
        var captured = new List<string>();
        var diagnostics = new FSMTimelineChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=FSMTimelineChart", line);
        Assert.DoesNotContain("vehicle", line, StringComparison.Ordinal);
        Assert.DoesNotContain("2026", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("FSMTimelineChart", FSMTimelineChartRegistration.Slug);

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => FSMTimelineChartProjection.Project(null!, Localizer, NowUtc));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => FSMTimelineChartProjection.Project(FSMTimelineChartModel.Empty, null!, NowUtc));
}
