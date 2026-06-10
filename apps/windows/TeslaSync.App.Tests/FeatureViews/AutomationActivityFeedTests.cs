using System;
using System.Collections.Generic;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Automations;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AutomationActivityFeed</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / populated / empty history), the live-connection chip (connected / reconnecting → label,
/// glyph and accent), the optional statistics strip (the verbatim total, the <c>fmtPercent(_, 0)</c> success rate and
/// the <c>formatDurationMs</c> average, gated on <c>total_executions &gt; 0</c>), the live-event strip (the five-row
/// cap, the type → icon / accent / badge mapping, the name / <c>#id</c> fallback and the error / reason detail), the
/// history rows (the status → icon / accent mapping, the inline error, the <c>timeAgo</c> tiers, the
/// <c>formatDurationMs</c> duration and the actions ratio), the i18n key resolution, the per-state accessible names,
/// and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/automations/pages/AutomationActivityFeed.tsx). The WinUI view itself
/// (AutomationActivityFeed.cs) is exercised by the app build.
/// </summary>
public sealed class AutomationActivityFeedTests
{
    private const string ActivityGlyph = "\uE9D2";
    private const string WifiGlyph = "\uE701";
    private const string SyncGlyph = "\uE895";
    private const string CheckGlyph = "\uE930";
    private const string ErrorGlyph = "\uEA39";
    private const string SkipGlyph = "\uE893";
    private const string ZapGlyph = "\uE945";
    private const string ClockGlyph = "\uE823";
    private const string EmDash = "\u2014";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Base = new(2026, 6, 1, 12, 0, 0, TimeSpan.Zero);

    private static AutomationHistoryEntry Entry(
        long id = 1,
        string name = "Morning Charge",
        string status = "success",
        string? error = null,
        int minutesAgo = 5,
        double? durationMs = 1500,
        int actionsTotal = 3,
        int actionsSucceeded = 3) =>
        new(id, name, status, error, Base.AddMinutes(-minutesAgo), durationMs, actionsTotal, actionsSucceeded);

    private static AutomationLiveEvent Live(
        string id = "ae-1",
        string type = "automation.triggered",
        long automationId = 7,
        string? name = "Morning Charge",
        string? error = null,
        string? reason = null) =>
        new(id, type, automationId, name, error, reason);

    private static AutomationHistorySummary Stats(long total = 42, double rate = 95.6, double avgMs = 1500) =>
        new(total, rate, avgMs);

    private static AutomationActivityFeedModel Ready(
        IReadOnlyList<AutomationHistoryEntry>? history = null,
        AutomationHistorySummary? stats = null,
        IReadOnlyList<AutomationLiveEvent>? live = null,
        AutomationFeedConnection connection = AutomationFeedConnection.Connected) =>
        new(false,
            history ?? Array.Empty<AutomationHistoryEntry>(),
            stats,
            live ?? Array.Empty<AutomationLiveEvent>(),
            connection);

    private static AutomationActivityFeedDisplay Project(AutomationActivityFeedModel model) =>
        AutomationActivityFeedProjection.Project(model, Localizer, Base);

    // ── Branch precedence: loading → populated → empty (web data lifecycle) ──────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(AutomationHistorySection.Loading, Project(AutomationActivityFeedModel.Pending).HistorySection);

    [Fact]
    public void Loading_takes_precedence_over_present_history()
    {
        var model = new AutomationActivityFeedModel(
            true, new[] { Entry() }, Stats(), new[] { Live() }, AutomationFeedConnection.Connected);

        Assert.Equal(AutomationHistorySection.Loading, Project(model).HistorySection);
    }

    [Fact]
    public void Populated_when_resolved_with_history()
    {
        var display = Project(Ready(history: new[] { Entry() }));

        Assert.Equal(AutomationHistorySection.Populated, display.HistorySection);
        Assert.True(display.HasHistory);
    }

    [Fact]
    public void Empty_when_resolved_without_history()
    {
        var display = Project(AutomationActivityFeedModel.Empty);

        Assert.Equal(AutomationHistorySection.Empty, display.HistorySection);
        Assert.False(display.HasHistory);
    }

    [Fact]
    public void Skeleton_row_count_matches_the_web_five() =>
        Assert.Equal(5, Project(AutomationActivityFeedModel.Pending).SkeletonRows);

    // ── Live-connection chip (web connectionState) ──────────────────────────────────────────────────────

    [Fact]
    public void Connected_chip_is_live_wifi_and_success()
    {
        var display = Project(Ready(connection: AutomationFeedConnection.Connected));

        Assert.Equal("Live", display.ConnectionLabel);
        Assert.Equal(WifiGlyph, display.ConnectionGlyph);
        Assert.Equal(StatusKind.Success, display.ConnectionAccent);
    }

    [Fact]
    public void Reconnecting_chip_is_reconnecting_sync_and_warning()
    {
        var display = Project(Ready(connection: AutomationFeedConnection.Reconnecting));

        Assert.Equal("Reconnecting", display.ConnectionLabel);
        Assert.Equal(SyncGlyph, display.ConnectionGlyph);
        Assert.Equal(StatusKind.Warning, display.ConnectionAccent);
    }

    // ── Statistics strip (web historyStats && total_executions > 0) ─────────────────────────────────────

    [Fact]
    public void Stats_hidden_without_a_summary() =>
        Assert.False(Project(Ready(stats: null)).ShowStats);

    [Fact]
    public void Stats_hidden_when_no_executions() =>
        Assert.False(Project(Ready(stats: Stats(total: 0))).ShowStats);

    [Fact]
    public void Stats_shown_when_executions_present() =>
        Assert.True(Project(Ready(stats: Stats(total: 1))).ShowStats);

    [Fact]
    public void Stat_labels_use_the_web_formatting()
    {
        var display = Project(Ready(stats: Stats(total: 1234, rate: 95.6, avgMs: 1500)));

        Assert.Equal("1234 total", display.TotalLabel);   // web `${total_executions}` — verbatim, no grouping
        Assert.Equal("96% success", display.SuccessLabel); // web fmtPercent(95.6, 0) → "96%"
        Assert.Equal("1.5s avg", display.AvgLabel);        // web formatDurationMs(1500) → "1.5s"
    }

    [Fact]
    public void Stat_success_rate_rounds_half_up()
    {
        Assert.Equal("96% success", Project(Ready(stats: Stats(rate: 95.6))).SuccessLabel);
        Assert.Equal("95% success", Project(Ready(stats: Stats(rate: 95.4))).SuccessLabel);
    }

    [Fact]
    public void Stat_non_finite_success_rate_formats_as_zero() =>
        Assert.Equal("0% success", Project(Ready(stats: Stats(rate: double.NaN))).SuccessLabel);

    [Fact]
    public void Stat_average_uses_milliseconds_below_one_second() =>
        Assert.Equal("500ms avg", Project(Ready(stats: Stats(avgMs: 500))).AvgLabel);

    // ── Live-event strip (web LiveEventRow + slice(0, 5)) ───────────────────────────────────────────────

    [Fact]
    public void Live_strip_is_capped_at_five_rows()
    {
        var events = new List<AutomationLiveEvent>();
        for (int i = 0; i < 9; i++)
        {
            events.Add(Live(id: $"ae-{i}"));
        }

        var display = Project(Ready(live: events));

        Assert.Equal(5, display.LiveEvents.Count);
        Assert.True(display.HasLiveEvents);
    }

    [Fact]
    public void Live_strip_preserves_input_order()
    {
        var display = Project(Ready(live: new[]
        {
            Live(id: "first", name: "Alpha"),
            Live(id: "second", name: "Beta"),
        }));

        Assert.Equal("Alpha", display.LiveEvents[0].Name);
        Assert.Equal("Beta", display.LiveEvents[1].Name);
    }

    [Fact]
    public void Live_name_falls_back_to_hash_id_when_missing()
    {
        var display = Project(Ready(live: new[] { Live(name: null, automationId: 42) }));

        Assert.Equal("#42", display.LiveEvents[0].Name);
    }

    [Theory]
    [InlineData("automation.triggered", ZapGlyph, StatusKind.Info, "triggered")]
    [InlineData("automation.succeeded", CheckGlyph, StatusKind.Success, "succeeded")]
    [InlineData("automation.failed", ErrorGlyph, StatusKind.Danger, "failed")]
    [InlineData("automation.skipped", SkipGlyph, StatusKind.Neutral, "skipped")]
    [InlineData("automation.state_changed", ActivityGlyph, StatusKind.Info, "state_changed")]
    public void Live_type_maps_to_glyph_accent_and_badge(
        string type, string glyph, StatusKind accent, string badge)
    {
        var row = Project(Ready(live: new[] { Live(type: type) })).LiveEvents[0];

        Assert.Equal(glyph, row.Glyph);
        Assert.Equal(accent, row.Accent);
        Assert.Equal(badge, row.BadgeLabel);
    }

    [Fact]
    public void Live_unknown_type_falls_back_to_the_triggered_visual()
    {
        var row = Project(Ready(live: new[] { Live(type: "automation.mystery") })).LiveEvents[0];

        Assert.Equal(ZapGlyph, row.Glyph);
        Assert.Equal(StatusKind.Info, row.Accent);
        Assert.Equal("mystery", row.BadgeLabel);
    }

    [Fact]
    public void Live_failed_event_carries_the_error_detail()
    {
        var row = Project(Ready(live: new[]
        {
            Live(type: "automation.failed", error: "action 2 timed out"),
        })).LiveEvents[0];

        Assert.Equal("action 2 timed out", row.Detail);
        Assert.True(row.DetailIsError);
    }

    [Fact]
    public void Live_skipped_event_carries_the_reason_detail()
    {
        var row = Project(Ready(live: new[]
        {
            Live(type: "automation.skipped", reason: "conditions not met"),
        })).LiveEvents[0];

        Assert.Equal("conditions not met", row.Detail);
        Assert.False(row.DetailIsError);
    }

    [Fact]
    public void Live_event_without_detail_has_none()
    {
        var row = Project(Ready(live: new[] { Live(type: "automation.triggered") })).LiveEvents[0];

        Assert.Null(row.Detail);
    }

    [Fact]
    public void Live_row_automation_name_carries_name_detail_and_badge()
    {
        var row = Project(Ready(live: new[]
        {
            Live(type: "automation.failed", name: "Morning Charge", error: "timeout"),
        })).LiveEvents[0];

        Assert.Equal($"Morning Charge {EmDash} timeout. failed", row.AutomationName);
    }

    // ── History rows: status icon, error, relative time, duration, actions (web HistoryRow) ─────────────

    [Theory]
    [InlineData("success", CheckGlyph, StatusKind.Success)]
    [InlineData("partial", CheckGlyph, StatusKind.Warning)]
    [InlineData("failed", ErrorGlyph, StatusKind.Danger)]
    [InlineData("skipped", SkipGlyph, StatusKind.Neutral)]
    [InlineData("test", ZapGlyph, StatusKind.Info)]
    [InlineData("undo", ClockGlyph, StatusKind.Info)]
    [InlineData("cancelled", ErrorGlyph, StatusKind.Neutral)]
    [InlineData("running", ActivityGlyph, StatusKind.Info)]
    public void History_status_maps_to_glyph_and_accent(string status, string glyph, StatusKind accent)
    {
        var row = Project(Ready(history: new[] { Entry(status: status) })).History[0];

        Assert.Equal(glyph, row.Glyph);
        Assert.Equal(accent, row.Accent);
    }

    [Fact]
    public void History_unknown_status_falls_back_to_the_running_visual()
    {
        var row = Project(Ready(history: new[] { Entry(status: "weird") })).History[0];

        Assert.Equal(ActivityGlyph, row.Glyph);
        Assert.Equal(StatusKind.Info, row.Accent);
    }

    [Fact]
    public void History_row_carries_name_and_error()
    {
        var row = Project(Ready(history: new[]
        {
            Entry(name: "Nightly Backup", status: "failed", error: "disk full"),
        })).History[0];

        Assert.Equal("Nightly Backup", row.Name);
        Assert.Equal("disk full", row.Error);
    }

    [Fact]
    public void History_row_has_no_error_when_absent() =>
        Assert.Null(Project(Ready(history: new[] { Entry(error: null) })).History[0].Error);

    [Fact]
    public void History_actions_ratio_shows_when_actions_attempted()
    {
        var row = Project(Ready(history: new[]
        {
            Entry(actionsTotal: 3, actionsSucceeded: 2),
        })).History[0];

        Assert.Equal("2/3", row.Actions);
    }

    [Fact]
    public void History_actions_ratio_is_absent_without_actions() =>
        Assert.Null(Project(Ready(history: new[] { Entry(actionsTotal: 0) })).History[0].Actions);

    [Fact]
    public void History_row_automation_name_carries_name_time_and_duration()
    {
        var row = Project(Ready(history: new[]
        {
            Entry(name: "Morning Charge", status: "success", error: null, minutesAgo: 5,
                  durationMs: 1500, actionsTotal: 3, actionsSucceeded: 3),
        })).History[0];

        Assert.Equal("Morning Charge. 5m ago. 1.5s. 3/3", row.AutomationName);
    }

    [Fact]
    public void History_row_automation_name_includes_the_error()
    {
        var row = Project(Ready(history: new[]
        {
            Entry(name: "Backup", status: "failed", error: "disk full", minutesAgo: 5,
                  durationMs: 1500, actionsTotal: 0),
        })).History[0];

        Assert.Equal($"Backup {EmDash} disk full. 5m ago. 1.5s", row.AutomationName);
    }

    // ── Relative-time tiers (web timeAgo) ───────────────────────────────────────────────────────────────

    [Fact]
    public void Time_ago_just_now_under_a_minute() =>
        Assert.Equal("just now", Row(Entry(minutesAgo: 0)).RelativeTime);

    [Fact]
    public void Time_ago_minutes() =>
        Assert.Equal("5m ago", Row(Entry(minutesAgo: 5)).RelativeTime);

    [Fact]
    public void Time_ago_hours() =>
        Assert.Equal("2h ago", Row(Entry(minutesAgo: 125)).RelativeTime);

    [Fact]
    public void Time_ago_days() =>
        Assert.Equal("3d ago", Row(Entry(minutesAgo: 3 * 24 * 60)).RelativeTime);

    // ── Duration formatting (web formatDurationMs) ──────────────────────────────────────────────────────

    [Fact]
    public void Duration_null_is_the_em_dash() =>
        Assert.Equal(EmDash, Row(Entry(durationMs: null)).Duration);

    [Fact]
    public void Duration_non_finite_is_the_em_dash() =>
        Assert.Equal(EmDash, Row(Entry(durationMs: double.PositiveInfinity)).Duration);

    [Fact]
    public void Duration_below_one_second_is_milliseconds() =>
        Assert.Equal("500ms", Row(Entry(durationMs: 500)).Duration);

    [Fact]
    public void Duration_at_one_second_is_seconds() =>
        Assert.Equal("1.0s", Row(Entry(durationMs: 1000)).Duration);

    [Fact]
    public void Duration_above_one_second_is_one_decimal_seconds() =>
        Assert.Equal("2.3s", Row(Entry(durationMs: 2340)).Duration);

    // ── Fixed copy / i18n keys ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Header_title_and_glyph_resolve_from_the_facade()
    {
        var display = Project(Ready());

        Assert.Equal("Recent Activity", display.Title);
        Assert.Equal(ActivityGlyph, display.Glyph);
    }

    [Fact]
    public void Empty_message_uses_the_automations_catalog_key() =>
        Assert.Equal("No execution history yet", Project(AutomationActivityFeedModel.Empty).EmptyMessage);

    // ── Accessibility: every state exposes a meaningful Narrator name ───────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name() =>
        Assert.All(
            new[]
            {
                Project(AutomationActivityFeedModel.Pending),
                Project(AutomationActivityFeedModel.Empty),
                Project(Ready(history: new[] { Entry() }, stats: Stats(), live: new[] { Live() })),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));

    [Fact]
    public void Loading_automation_name_carries_title_connection_and_loading()
    {
        var name = Project(AutomationActivityFeedModel.Pending).AutomationName;

        Assert.StartsWith("Recent Activity", name, StringComparison.Ordinal);
        Assert.Contains("Live", name, StringComparison.Ordinal);
        Assert.Contains("Loading", name, StringComparison.Ordinal);
    }

    [Fact]
    public void Populated_automation_name_carries_the_title_connection_and_stats()
    {
        var name = Project(Ready(
            history: new[] { Entry() },
            stats: Stats(total: 42, rate: 95.6, avgMs: 1500),
            connection: AutomationFeedConnection.Reconnecting)).AutomationName;

        Assert.StartsWith("Recent Activity", name, StringComparison.Ordinal);
        Assert.Contains("Reconnecting", name, StringComparison.Ordinal);
        Assert.Contains("42 total", name, StringComparison.Ordinal);
        Assert.Contains("96% success", name, StringComparison.Ordinal);
        Assert.Contains("1.5s avg", name, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_empty_message() =>
        Assert.Contains(
            "No execution history yet",
            Project(AutomationActivityFeedModel.Empty).AutomationName,
            StringComparison.Ordinal);

    // ── Diagnostics (P1/S11): view.opened slug=AutomationActivityFeed, PII-safe ─────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new AutomationActivityFeedDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AutomationActivityFeed", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_automation_detail()
    {
        var captured = new List<string>();
        var diagnostics = new AutomationActivityFeedDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=AutomationActivityFeed", line);
        Assert.DoesNotContain('%', line);
        Assert.DoesNotContain("ago", line, StringComparison.Ordinal);
        Assert.DoesNotContain("Charge", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("AutomationActivityFeed", AutomationActivityFeedRegistration.Slug);

    // ── Argument validation ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => AutomationActivityFeedProjection.Project(null!, Localizer, Base));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => AutomationActivityFeedProjection.Project(AutomationActivityFeedModel.Pending, null!, Base));

    private static AutomationHistoryRow Row(AutomationHistoryEntry entry) =>
        Project(Ready(history: new[] { entry })).History[0];
}
