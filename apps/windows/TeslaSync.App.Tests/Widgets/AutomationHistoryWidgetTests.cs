using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the AutomationHistoryWidget's UI-thread-free logic — the JSON parse adapter,
/// the status→presentation map, the duration formatter, the projection (success-rate hero / badge tone /
/// run feed sort + cap + subtitles + labels), the cache-then-network result mapper, the footprint flags,
/// the registry metadata, the diagnostics, and the state-holder view-model's per-state transitions
/// (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/AutomationHistoryWidget.tsx).
/// </summary>
public sealed class AutomationHistoryWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static AutomationRun Run(
        long id = 1,
        string status = "success",
        string? automationName = "Automation",
        double? durationMs = 1000,
        string? triggeredAt = "2026-06-06T12:00:00Z") =>
        new(id, automationName, status, durationMs, triggeredAt);

    private static AutomationHistorySummary Summary(double successRate = 91.5, int totalExecutions = 120) =>
        new(totalExecutions, successRate);

    private static AutomationHistorySnapshot Snapshot(
        AutomationHistorySummary? summary,
        params AutomationRun[] runs) =>
        new(runs, summary);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_items_and_summary()
    {
        const string json = """
        {"items":[
            {"id":1,"automation_id":7,"automation_name":"Morning Charge","status":"success",
             "duration_ms":1500,"triggered_at":"2026-06-06T12:00:00Z","completed_at":"2026-06-06T12:00:01Z"}
          ],
          "summary":{"total_executions":120,"succeeded":110,"failed":10,"partial":0,"success_rate":91.5,"avg_duration_ms":1200},
          "total":120,"limit":20,"offset":0}
        """;
        using var doc = JsonDocument.Parse(json);

        var snapshot = AutomationHistorySnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        var run = Assert.Single(snapshot.Items);
        Assert.Equal(1, run.Id);
        Assert.Equal("Morning Charge", run.AutomationName);
        Assert.Equal("success", run.Status);
        Assert.Equal(1500, run.DurationMs);
        Assert.NotNull(run.TriggeredAtTime);

        Assert.NotNull(snapshot.Summary);
        Assert.Equal(120, snapshot.Summary!.TotalExecutions);
        Assert.Equal(91.5, snapshot.Summary.SuccessRate);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"items":[{"id":2}]}""");

        var snapshot = AutomationHistorySnapshot.FromJson(doc.RootElement);

        var run = Assert.Single(snapshot.Items);
        Assert.Equal(2, run.Id);
        Assert.Null(run.AutomationName);
        Assert.Equal(string.Empty, run.Status);
        Assert.Null(run.DurationMs);
        Assert.Null(run.TriggeredAtTime);
        Assert.Null(snapshot.Summary);     // no summary object
        Assert.True(snapshot.HasData);     // a present object renders
    }

    [Fact]
    public void FromJson_missing_items_yields_empty_list_not_null()
    {
        using var doc = JsonDocument.Parse("""{"summary":{"total_executions":0,"success_rate":0}}""");

        var snapshot = AutomationHistorySnapshot.FromJson(doc.RootElement);

        Assert.Empty(snapshot.Items);
        Assert.NotNull(snapshot.Summary);
        Assert.True(snapshot.HasData);
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        var snapshot = AutomationHistorySnapshot.FromJson(doc.RootElement);
        Assert.False(snapshot.HasData);
        Assert.Empty(snapshot.Items);
    }

    [Fact]
    public void FromJson_accepts_numeric_strings()
    {
        using var doc = JsonDocument.Parse(
            """{"items":[{"id":"3","duration_ms":"250","status":"failed","triggered_at":"2026-06-06T12:00:00Z"}],"summary":{"total_executions":"5","success_rate":"80.0"}}""");

        var snapshot = AutomationHistorySnapshot.FromJson(doc.RootElement);

        var run = Assert.Single(snapshot.Items);
        Assert.Equal(3, run.Id);
        Assert.Equal(250, run.DurationMs);
        Assert.Equal(5, snapshot.Summary!.TotalExecutions);
        Assert.Equal(80.0, snapshot.Summary.SuccessRate);
    }

    [Fact]
    public void Empty_snapshot_has_no_data()
    {
        Assert.False(AutomationHistorySnapshot.Empty.HasData);
        Assert.Empty(AutomationHistorySnapshot.Empty.Items);
    }

    // ---- Duration formatter (port of lib/dateFormat formatDurationMs) --------------

    [Theory]
    [InlineData(0, "0ms")]
    [InlineData(250, "250ms")]
    [InlineData(999, "999ms")]
    [InlineData(1000, "1.0s")]
    [InlineData(1500, "1.5s")]
    [InlineData(2000, "2.0s")]
    [InlineData(12500, "12.5s")]
    public void FormatDurationMs_matches_web(double ms, string expected) =>
        Assert.Equal(expected, AutomationHistoryProjection.FormatDurationMs(ms));

    [Fact]
    public void FormatDurationMs_null_is_em_dash() =>
        Assert.Equal("\u2014", AutomationHistoryProjection.FormatDurationMs(null));

    // ---- Size / footprint flags (web isCompact, maxItems) --------------------------

    [Theory]
    [InlineData(1, 2, true)]   // compact (single column)
    [InlineData(2, 4, false)]  // default — not compact
    [InlineData(4, 40, false)] // wide — not compact
    public void Size_compact_flag_matches_web(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new AutomationHistorySize(cols, rows).IsCompact);

    [Fact]
    public void Size_feed_cap_is_ten_regardless_of_footprint() =>
        Assert.Equal(10, AutomationHistorySize.MaxFeedItems);

    // ---- Status → presentation map (port of STATUS_MAP) ----------------------------

    [Theory]
    [InlineData("success", AutomationRunStatus.CheckGlyph, "TsColorSuccessBrush")]
    [InlineData("failed", AutomationRunStatus.ErrorGlyph, "TsColorDangerBrush")]
    [InlineData("partial", AutomationRunStatus.ClockGlyph, "TsColorWarningBrush")]
    [InlineData("running", AutomationRunStatus.ClockGlyph, "TsColorInfoBrush")]
    [InlineData("skipped", AutomationRunStatus.ClockGlyph, "TsColorTextMutedBrush")]
    [InlineData("cancelled", AutomationRunStatus.ErrorGlyph, "TsColorTextMutedBrush")]
    [InlineData("test", AutomationRunStatus.PlayGlyph, "TsColorAccentBrush")]
    [InlineData("undo", AutomationRunStatus.ClockGlyph, "TsColorTextMutedBrush")]
    public void Status_tokens_match_web(string status, string glyph, string brushKey)
    {
        var (g, key) = AutomationRunStatus.Tokens(status);
        Assert.Equal(glyph, g);
        Assert.Equal(brushKey, key);
    }

    [Fact]
    public void Status_tokens_unknown_falls_back_to_play_muted()
    {
        var (glyph, key) = AutomationRunStatus.Tokens("mysterious");
        Assert.Equal(AutomationRunStatus.PlayGlyph, glyph);
        Assert.Equal("TsColorTextMutedBrush", key);
    }

    [Fact]
    public void Status_tokens_are_case_insensitive()
    {
        var (glyph, key) = AutomationRunStatus.Tokens("SUCCESS");
        Assert.Equal(AutomationRunStatus.CheckGlyph, glyph);
        Assert.Equal("TsColorSuccessBrush", key);
    }

    // ---- Projection: success-rate hero / badge -------------------------------------

    [Fact]
    public void Project_formats_success_rate_text_and_badge()
    {
        var display = Project(Snapshot(Summary(successRate: 91.5, totalExecutions: 120)));

        Assert.Equal("91.5", display.SuccessRateText);
        Assert.Equal("91.5%", display.CompactValueText);
        Assert.Equal("91.5% Success Rate", display.BadgeText);
        Assert.Equal("Success Rate", display.SuccessRateLabel);
        Assert.True(display.HasSummary);
        Assert.Equal("120 runs", display.TotalRunsText);
    }

    [Theory]
    [InlineData(100.0, StatusKind.Success)]
    [InlineData(90.0, StatusKind.Success)]
    [InlineData(89.9, StatusKind.Warning)]
    [InlineData(50.0, StatusKind.Warning)]
    [InlineData(49.9, StatusKind.Danger)]
    [InlineData(0.0, StatusKind.Danger)]
    public void Project_badge_tone_matches_web_variants(double rate, StatusKind expected) =>
        Assert.Equal(expected, AutomationHistoryProjection.SuccessRateStatusFor(rate));

    [Fact]
    public void Project_groups_total_runs()
    {
        var display = Project(Snapshot(Summary(successRate: 95, totalExecutions: 1234)));
        Assert.Equal("1,234 runs", display.TotalRunsText);
    }

    [Fact]
    public void Project_without_summary_is_zero_rate_danger_and_no_runs_text()
    {
        var display = Project(Snapshot(summary: null, Run(id: 1)));

        Assert.Equal("0.0", display.SuccessRateText);
        Assert.Equal("0.0%", display.CompactValueText);
        Assert.Equal(StatusKind.Danger, display.SuccessRateStatus);
        Assert.False(display.HasSummary);
        Assert.Equal(string.Empty, display.TotalRunsText);
    }

    // ---- Projection: run feed ------------------------------------------------------

    [Fact]
    public void Project_sorts_rows_newest_first_and_caps_to_ten()
    {
        var runs = new List<AutomationRun>();
        for (int i = 0; i < 12; i++)
        {
            // i=0 oldest … i=11 newest
            var ts = new DateTimeOffset(2026, 6, 6, 11, i, 0, TimeSpan.Zero);
            runs.Add(Run(id: i, triggeredAt: ts.ToString("o", CultureInfo.InvariantCulture)));
        }

        var display = Project(new AutomationHistorySnapshot(runs, Summary()));

        Assert.Equal(10, display.Items.Count);     // web maxItems = 10
        Assert.Equal(11, display.Items[0].Id);      // newest first
        Assert.Equal(2, display.Items[^1].Id);      // 10 newest of 0..11 -> ids 11..2
    }

    [Fact]
    public void Project_builds_status_dot_duration_subtitle()
    {
        var success = Project(Snapshot(Summary(), Run(status: "success", durationMs: 1500))).Items[0];
        var failed = Project(Snapshot(Summary(), Run(status: "failed", durationMs: 250))).Items[0];

        Assert.Equal("success \u00b7 1.5s", success.Subtitle);
        Assert.Equal("failed \u00b7 250ms", failed.Subtitle);
    }

    [Fact]
    public void Project_falls_back_to_em_dash_title_and_status()
    {
        var nullName = Project(Snapshot(Summary(), Run(automationName: null, status: ""))).Items[0];
        Assert.Equal("\u2014", nullName.Title);
        Assert.StartsWith("\u2014 \u00b7", nullName.Subtitle, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_resolves_row_glyph_brush_and_relative_time()
    {
        var row = Project(Snapshot(Summary(), Run(status: "failed", triggeredAt: "2026-06-06T12:00:00Z"))).Items[0];

        Assert.Equal(AutomationRunStatus.ErrorGlyph, row.Glyph);
        Assert.Equal("TsColorDangerBrush", row.AccentBrushKey);
        Assert.Equal("5m ago", row.RelativeTime);
    }

    [Fact]
    public void Project_row_has_non_empty_accessibility_name()
    {
        var row = Project(Snapshot(Summary(), Run(automationName: "Morning Charge", status: "success"))).Items[0];

        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("Morning Charge", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("success", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("5m ago", row.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_last_run_uses_raw_first_item_and_names_the_hero()
    {
        // items[0] (raw order) is the head used for the compact "last run" time — not the sorted feed head.
        var display = Project(Snapshot(
            Summary(successRate: 95),
            Run(id: 1, triggeredAt: "2026-06-06T12:00:00Z"),
            Run(id: 2, triggeredAt: "2026-06-06T09:00:00Z")));

        Assert.Equal("5m ago", display.LastRunRelative);
        Assert.Contains("95.0%", display.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("Success Rate", display.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("5m ago", display.CompactAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_last_run_is_blank_when_no_items()
    {
        var display = Project(Snapshot(Summary(successRate: 80)));
        Assert.Equal(string.Empty, display.LastRunRelative);
        Assert.False(display.HasItems);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(
            """{"items":[{"id":1,"status":"success","triggered_at":"2026-06-06T12:00:00Z"}],"summary":{"total_executions":1,"success_rate":100}}""");

        var cached = AutomationHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!.Items);

        var offline = AutomationHistoryResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(100, offline.Value!.Summary!.SuccessRate);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"items":[],"summary":{"total_executions":0,"success_rate":0}}""");

        Assert.Equal(LoadStatus.Loaded, AutomationHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, AutomationHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, AutomationHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<AutomationHistorySnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(AutomationHistoryState.Loading, vm.State);
        Assert.False(vm.HasItems);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_rows()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Summary(), Run(id: 1), Run(id: 2))));
        await vm.LoadAsync();

        Assert.Equal(AutomationHistoryState.Loaded, vm.State);
        Assert.True(vm.HasItems);
        Assert.Equal(2, vm.Display.Items.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_rows_is_empty_but_keeps_success_header()
    {
        // Web parity: an idle fleet (summary present, items empty) still renders the success-rate header in
        // the wide footprint — the empty branch is a within-content condition, not a hidden surface.
        using var vm = NewViewModel(Loaded(Snapshot(Summary(successRate: 80, totalExecutions: 50))));
        await vm.LoadAsync();

        Assert.Equal(AutomationHistoryState.Empty, vm.State);
        Assert.False(vm.HasItems);
        Assert.True(vm.Display.HasSummary);
        Assert.Equal("80.0", vm.Display.SuccessRateText);
        Assert.Equal("50 runs", vm.Display.TotalRunsText);
        Assert.Equal(StatusKind.Warning, vm.Display.SuccessRateStatus);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<AutomationHistorySnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(AutomationHistoryState.Empty, vm.State);
        Assert.False(vm.HasItems);
        Assert.Equal("No automation runs yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<AutomationHistorySnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(AutomationHistoryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_rows()
    {
        using var vm = NewViewModel(
            RepositoryResult<AutomationHistorySnapshot>.Cached(Snapshot(Summary(), Run(id: 1)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(AutomationHistoryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasItems);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_rows()
    {
        using var vm = NewViewModel(RepositoryResult<AutomationHistorySnapshot>.OfflineCached(
            Snapshot(Summary(), Run(id: 1)), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(AutomationHistoryState.Offline, vm.State);
        Assert.True(vm.HasItems);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<AutomationHistorySnapshot>.Loading(),
            RepositoryResult<AutomationHistorySnapshot>.Cached(Snapshot(Summary(), Run(id: 1)), Now, stale: false),
            RepositoryResult<AutomationHistorySnapshot>.Loaded(Snapshot(Summary(), Run(id: 1), Run(id: 2)), Now));
        await vm.LoadAsync();

        Assert.Equal(AutomationHistoryState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Items.Count);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new AutomationHistorySize(2, 4), Loaded(Snapshot(Summary(), Run(id: 1))));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new AutomationHistorySize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(AutomationHistoryState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<AutomationHistorySnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Automation History", vm.Title);
        Assert.Equal("No automation runs yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Summary(), Run(id: 1))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(AutomationHistoryViewModel.State), changed);
        Assert.Contains(nameof(AutomationHistoryViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("automation-history", AutomationHistoryRegistration.Id);
        Assert.Equal("automations", AutomationHistoryRegistration.Category);
        Assert.Equal("AutomationHistoryWidget", AutomationHistoryRegistration.Slug);
        Assert.Equal(20, AutomationHistoryRegistration.DefaultLimit);
        Assert.Equal(new AutomationHistorySize(2, 4), AutomationHistoryRegistration.DefaultSize);
        Assert.Equal(new AutomationHistorySize(1, 2), AutomationHistoryRegistration.MinSize);
        Assert.Equal(new AutomationHistorySize(4, 40), AutomationHistoryRegistration.MaxSize);
        Assert.Equal("Automation History", AutomationHistoryRegistration.Name(Localizer));
        Assert.Contains("execution times", AutomationHistoryRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 4, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 1, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, AutomationHistoryRegistration.IsWithinBounds(new AutomationHistorySize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new AutomationHistorySize(1, 2), AutomationHistoryRegistration.Clamp(new AutomationHistorySize(0, 0)));
        Assert.Equal(new AutomationHistorySize(4, 40), AutomationHistoryRegistration.Clamp(new AutomationHistorySize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AutomationHistoryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AutomationHistoryWidget", Assert.Single(lines));
    }

    // ---- Constants (web parity) ----------------------------------------------------

    [Fact]
    public void Projection_success_thresholds_match_web_constants()
    {
        Assert.Equal(90.0, AutomationHistoryProjection.HighSuccessThreshold);
        Assert.Equal(50.0, AutomationHistoryProjection.MidSuccessThreshold);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static AutomationHistoryDisplay Project(AutomationHistorySnapshot snapshot) =>
        AutomationHistoryProjection.Project(snapshot, AutomationHistorySize.Default, Localizer, Now);

    private static RepositoryResult<AutomationHistorySnapshot> Loaded(AutomationHistorySnapshot snapshot) =>
        RepositoryResult<AutomationHistorySnapshot>.Loaded(snapshot, Now);

    private static AutomationHistoryViewModel NewViewModel(params RepositoryResult<AutomationHistorySnapshot>[] emissions) =>
        NewViewModel(AutomationHistorySize.Default, emissions);

    private static AutomationHistoryViewModel NewViewModel(
        AutomationHistorySize size,
        params RepositoryResult<AutomationHistorySnapshot>[] emissions) =>
        new(new FakeAutomationHistorySource(emissions), Localizer, size, () => Now);

    private sealed class FakeAutomationHistorySource(params RepositoryResult<AutomationHistorySnapshot>[] emissions)
        : IAutomationHistorySource
    {
        public async IAsyncEnumerable<RepositoryResult<AutomationHistorySnapshot>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }
}
