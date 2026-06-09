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
/// Headless verification of the DashboardStatsWidget's UI-thread-free logic — the JSON parse adapters
/// (dashboard counters, FSM state, the state-timeline transitions), the projection (four stat tiles, the
/// compact active-trips hero, the current-state badge + tone, and the wide recent-transitions list with
/// relative-time tiers), the multi-source combine mapper (dashboard-stats load-bearing; FSM + timeline
/// enriching with the freshness union), the footprint flags, the registry metadata, the diagnostics, and
/// the state-holder view-model's per-state transitions (loading / loaded / empty / error / stale /
/// offline). Mirrors the web spec (web/src/features/dashboard/widgets/DashboardStatsWidget.tsx).
/// </summary>
public sealed class DashboardStatsWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    // ---- Dashboard-stats parse adapter ---------------------------------------------

    [Fact]
    public void StatsFromJson_reads_camelCase_fields()
    {
        const string json = """{"totalVehicles":2,"totalM":1234.5,"totalChargingSessions":30,"totalTrips":50}""";
        using var doc = JsonDocument.Parse(json);

        var stats = DashboardStatsData.FromJson(doc.RootElement);

        Assert.Equal(2, stats.TotalVehicles);
        Assert.Equal(50, stats.TotalTrips);
        Assert.Equal(30, stats.TotalChargingSessions);
        Assert.True(stats.HasData);
    }

    [Fact]
    public void StatsFromJson_falls_back_to_snake_case()
    {
        using var doc = JsonDocument.Parse("""{"total_vehicles":3,"total_trips":9,"total_charging_sessions":4}""");

        var stats = DashboardStatsData.FromJson(doc.RootElement);

        Assert.Equal(3, stats.TotalVehicles);
        Assert.Equal(9, stats.TotalTrips);
        Assert.Equal(4, stats.TotalChargingSessions);
    }

    [Fact]
    public void StatsFromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"totalTrips":7}""");

        var stats = DashboardStatsData.FromJson(doc.RootElement);

        Assert.Equal(0, stats.TotalVehicles);
        Assert.Equal(7, stats.TotalTrips);
        Assert.Equal(0, stats.TotalChargingSessions);
        Assert.True(stats.HasData); // a present object renders (web shows zeros, not empty)
    }

    [Fact]
    public void StatsFromJson_accepts_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"totalTrips":"42","totalVehicles":"2"}""");
        var stats = DashboardStatsData.FromJson(doc.RootElement);
        Assert.Equal(42, stats.TotalTrips);
        Assert.Equal(2, stats.TotalVehicles);
    }

    [Fact]
    public void StatsFromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        var stats = DashboardStatsData.FromJson(doc.RootElement);
        Assert.False(stats.HasData);
        Assert.Equal(0, stats.TotalTrips);
    }

    [Fact]
    public void StatsEmpty_snapshot_has_no_data()
    {
        Assert.False(DashboardStatsData.Empty.HasData);
        Assert.True(new DashboardStatsData(1, 1, 1).HasData);
    }

    // ---- FSM state + timeline parse ------------------------------------------------

    [Fact]
    public void ReadFsmState_reads_top_level_state_string()
    {
        using var doc = JsonDocument.Parse("""{"state":"online","battery_level":64}""");
        Assert.Equal("online", StateTransitionItem.ReadFsmState(doc.RootElement));
    }

    [Fact]
    public void ReadFsmState_returns_null_when_absent_or_non_string()
    {
        using var missing = JsonDocument.Parse("""{"battery_level":64}""");
        using var nested = JsonDocument.Parse("""{"state":{"inner":1}}""");
        Assert.Null(StateTransitionItem.ReadFsmState(missing.RootElement));
        Assert.Null(StateTransitionItem.ReadFsmState(nested.RootElement));
    }

    [Fact]
    public void TransitionsParseList_reads_state_and_started_at()
    {
        const string json = """
        {"transitions":[
          {"state":"driving","startedAt":"2026-06-06T11:50:00Z"},
          {"state":"charging","started_at":"2026-06-06T09:00:00Z"}
        ]}
        """;
        using var doc = JsonDocument.Parse(json);

        var rows = StateTransitionItem.ParseList(doc.RootElement);

        Assert.Equal(2, rows.Count);
        Assert.Equal("driving", rows[0].State);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 50, 0, TimeSpan.Zero), rows[0].StartedAt);
        Assert.Equal("charging", rows[1].State);          // camelCase + snake_case both parse
        Assert.NotNull(rows[1].StartedAt);
    }

    [Fact]
    public void TransitionsParseList_returns_empty_when_absent_or_non_object()
    {
        using var noKey = JsonDocument.Parse("""{"foo":1}""");
        using var array = JsonDocument.Parse("[]");
        Assert.Empty(StateTransitionItem.ParseList(noKey.RootElement));
        Assert.Empty(StateTransitionItem.ParseList(array.RootElement));
    }

    // ---- Size / footprint flags (web isCompact / isWide) ---------------------------

    [Theory]
    [InlineData(1, 2, true, false)]   // compact
    [InlineData(2, 2, false, false)]  // standard
    [InlineData(3, 2, false, true)]   // wide at 3 cols (web isWide = cols >= 3)
    [InlineData(4, 2, false, true)]   // wide
    public void Size_flags_match_web(int cols, int rows, bool compact, bool wide)
    {
        var size = new DashboardStatsSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_builds_four_stats_in_web_order()
    {
        var view = DashboardStatsProjection.Project(
            new DashboardStatsReading(new DashboardStatsData(2, 12345, 30), "online", Array.Empty<StateTransitionItem>()),
            new DashboardStatsSize(2, 2), Localizer, Now);

        Assert.Equal(4, view.Stats.Count);
        Assert.Equal("Vehicles", view.Stats[0].Label);
        Assert.Equal("2", view.Stats[0].Value);
        Assert.Equal("Trips", view.Stats[1].Label);
        Assert.Equal("12,345", view.Stats[1].Value); // en-US grouping (web fmtInt)
        Assert.Equal("Charge Sessions", view.Stats[2].Label);
        Assert.Equal("30", view.Stats[2].Value);
        Assert.Equal("FSM State", view.Stats[3].Label);
        Assert.Equal("online", view.Stats[3].Value);
    }

    [Fact]
    public void Project_unknown_fsm_state_renders_em_dash()
    {
        var view = DashboardStatsProjection.Project(
            new DashboardStatsReading(new DashboardStatsData(1, 1, 1), null, Array.Empty<StateTransitionItem>()),
            new DashboardStatsSize(2, 2), Localizer, Now);

        Assert.Equal("\u2014", view.Stats[3].Value);     // web fsm.data?.state ?? '—'
        Assert.Equal("\u2014", view.FsmStateLabel);
        Assert.Equal(StatusKind.Neutral, view.FsmTone);
    }

    [Fact]
    public void Project_compact_reads_total_trips_and_active_label()
    {
        var view = DashboardStatsProjection.Project(
            new DashboardStatsReading(new DashboardStatsData(2, 1234, 30), "online", Array.Empty<StateTransitionItem>()),
            new DashboardStatsSize(1, 2), Localizer, Now);

        Assert.True(view.IsCompact);
        Assert.Equal("1,234", view.CompactValue);        // web fmtInt(totalTrips)
        Assert.Equal("active", view.CompactLabel);
    }

    [Fact]
    public void Project_current_state_badge_is_capitalized_with_tone()
    {
        var view = DashboardStatsProjection.Project(
            new DashboardStatsReading(new DashboardStatsData(1, 1, 1), "charging", Array.Empty<StateTransitionItem>()),
            new DashboardStatsSize(2, 2), Localizer, Now);

        Assert.Equal("Current State", view.CurrentStateLabel);
        Assert.Equal("Charging", view.FsmStateLabel);    // web CSS capitalize
        Assert.Equal(StatusKind.Info, view.FsmTone);
        Assert.Contains("Current State", view.CurrentStateAutomationName, StringComparison.Ordinal);
        Assert.Contains("Charging", view.CurrentStateAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_recent_transitions_only_when_wide()
    {
        var transitions = new[]
        {
            new StateTransitionItem("driving", Now.AddMinutes(-3)),
            new StateTransitionItem("charging", Now.AddHours(-2)),
        };

        var standard = DashboardStatsProjection.Project(
            new DashboardStatsReading(new DashboardStatsData(1, 1, 1), "online", transitions),
            new DashboardStatsSize(2, 2), Localizer, Now);
        Assert.Empty(standard.RecentTransitions);        // web: rows only render at isWide

        var wide = DashboardStatsProjection.Project(
            new DashboardStatsReading(new DashboardStatsData(1, 1, 1), "online", transitions),
            new DashboardStatsSize(3, 2), Localizer, Now);

        Assert.Equal(2, wide.RecentTransitions.Count);
        Assert.Equal("Driving", wide.RecentTransitions[0].StateLabel);
        Assert.Equal("3m ago", wide.RecentTransitions[0].RelativeTime);
        Assert.Equal("2h ago", wide.RecentTransitions[1].RelativeTime);
        Assert.Equal("Recent Transitions", wide.RecentTransitionsLabel);
    }

    [Fact]
    public void Project_recent_transitions_caps_at_five()
    {
        var transitions = new List<StateTransitionItem>();
        for (int i = 0; i < 9; i++)
        {
            transitions.Add(new StateTransitionItem("driving", Now.AddMinutes(-i)));
        }

        var wide = DashboardStatsProjection.Project(
            new DashboardStatsReading(new DashboardStatsData(1, 1, 1), "online", transitions),
            new DashboardStatsSize(4, 4), Localizer, Now);

        Assert.Equal(DashboardStatsProjection.MaxTransitions, wide.RecentTransitions.Count); // web slice(0, 5)
    }

    [Fact]
    public void Project_transition_with_null_state_renders_em_dash()
    {
        var wide = DashboardStatsProjection.Project(
            new DashboardStatsReading(new DashboardStatsData(1, 1, 1), "online",
                new[] { new StateTransitionItem(null, null) }),
            new DashboardStatsSize(3, 2), Localizer, Now);

        Assert.Equal("\u2014", wide.RecentTransitions[0].StateLabel);
        Assert.Equal("\u2014", wide.RecentTransitions[0].RelativeTime); // null startedAt -> em-dash
    }

    [Fact]
    public void Project_stats_have_non_empty_accessibility_names()
    {
        var view = DashboardStatsProjection.Project(
            new DashboardStatsReading(new DashboardStatsData(2, 50, 30), "online", Array.Empty<StateTransitionItem>()),
            new DashboardStatsSize(2, 2), Localizer, Now);

        foreach (var stat in view.Stats)
        {
            Assert.False(string.IsNullOrWhiteSpace(stat.AutomationName));
            Assert.Contains(stat.Label, stat.AutomationName, StringComparison.Ordinal);
            Assert.Contains(stat.Value, stat.AutomationName, StringComparison.Ordinal);
        }

        Assert.Contains("active", view.CompactAutomationName, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("online", StatusKind.Success)]
    [InlineData("driving", StatusKind.Success)]
    [InlineData("charging", StatusKind.Info)]
    [InlineData("updating", StatusKind.Warning)]
    [InlineData("asleep", StatusKind.Neutral)]
    [InlineData("offline", StatusKind.Neutral)]
    [InlineData("", StatusKind.Neutral)]
    [InlineData(null, StatusKind.Neutral)]
    public void ToneFor_maps_state_to_semantic_kind(string? state, StatusKind expected) =>
        Assert.Equal(expected, DashboardStatsProjection.ToneFor(state));

    [Fact]
    public void Capitalize_uppercases_each_word()
    {
        Assert.Equal("Online", DashboardStatsProjection.Capitalize("online"));
        Assert.Equal("Software Update", DashboardStatsProjection.Capitalize("software update"));
        Assert.Equal("\u2014", DashboardStatsProjection.Capitalize("\u2014"));
        Assert.Equal(string.Empty, DashboardStatsProjection.Capitalize(null));
    }

    // ---- Combine mapper (multi-source, stats load-bearing) -------------------------

    [Fact]
    public void Combine_merges_stats_fsm_and_timeline()
    {
        using var stats = JsonDocument.Parse("""{"totalVehicles":2,"totalTrips":50,"totalChargingSessions":30}""");
        using var fsm = JsonDocument.Parse("""{"state":"online"}""");
        using var timeline = JsonDocument.Parse("""{"transitions":[{"state":"driving","startedAt":"2026-06-06T11:00:00Z"}]}""");

        var result = DashboardStatsResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(stats.RootElement, Now.AddMinutes(-1)),
            RepositoryResult<JsonElement>.Loaded(fsm.RootElement, Now),
            RepositoryResult<JsonElement>.Loaded(timeline.RootElement, Now.AddMinutes(-2)));

        Assert.Equal(LoadStatus.Loaded, result.Status);
        var reading = result.Value!;
        Assert.Equal(50, reading.Stats.TotalTrips);
        Assert.Equal("online", reading.FsmState);
        Assert.Single(reading.Transitions);
        Assert.Equal(Now, result.FetchedAt); // web Math.max(...dataUpdatedAt)
    }

    [Fact]
    public void Combine_stats_failure_is_the_retry_surface()
    {
        var result = DashboardStatsResultMapper.Combine(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            null,
            null);

        Assert.Equal(LoadStatus.Error, result.Status);
    }

    [Fact]
    public void Combine_absent_stats_body_is_empty()
    {
        var result = DashboardStatsResultMapper.Combine(
            RepositoryResult<JsonElement>.Empty(Now), null, null);

        Assert.Equal(LoadStatus.Empty, result.Status); // web hasData = stats.data != null
    }

    [Fact]
    public void Combine_without_vehicle_degrades_fsm_and_timeline()
    {
        using var stats = JsonDocument.Parse("""{"totalVehicles":1,"totalTrips":3,"totalChargingSessions":2}""");

        var result = DashboardStatsResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(stats.RootElement, Now), null, null);

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.Null(result.Value!.FsmState);           // web fsm disabled -> '—'
        Assert.Empty(result.Value!.Transitions);       // web timeline disabled -> []
    }

    [Fact]
    public void Combine_failed_fsm_and_timeline_still_render_stats()
    {
        using var stats = JsonDocument.Parse("""{"totalVehicles":1,"totalTrips":3,"totalChargingSessions":2}""");

        var result = DashboardStatsResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(stats.RootElement, Now),
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "fsm down")),
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.NotFound, "timeline 404")));

        Assert.Equal(LoadStatus.Loaded, result.Status); // stats load-bearing; enrichment failures degrade
        Assert.Null(result.Value!.FsmState);
        Assert.Empty(result.Value!.Transitions);
    }

    [Fact]
    public void Combine_stale_enrichment_marks_the_union_stale()
    {
        using var stats = JsonDocument.Parse("""{"totalVehicles":1,"totalTrips":3,"totalChargingSessions":2}""");
        using var fsm = JsonDocument.Parse("""{"state":"asleep"}""");

        var result = DashboardStatsResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(stats.RootElement, Now),
            RepositoryResult<JsonElement>.Cached(fsm.RootElement, Now, stale: true), // web isStale OR
            null);

        Assert.Equal(LoadStatus.Cached, result.Status);
        Assert.True(result.IsStale);
        Assert.Equal("asleep", result.Value!.FsmState);
    }

    [Fact]
    public void Combine_offline_stats_is_offline_cached()
    {
        using var stats = JsonDocument.Parse("""{"totalVehicles":1,"totalTrips":3,"totalChargingSessions":2}""");

        var result = DashboardStatsResultMapper.Combine(
            RepositoryResult<JsonElement>.OfflineCached(stats.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")),
            null, null);

        Assert.Equal(LoadStatus.Offline, result.Status);
        Assert.Equal(3, result.Value!.Stats.TotalTrips);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<DashboardStatsReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(DashboardStatsState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();

        Assert.Equal(DashboardStatsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal(4, vm.Display!.Stats.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty_message()
    {
        using var vm = NewViewModel(RepositoryResult<DashboardStatsReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(DashboardStatsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No dashboard stats available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<DashboardStatsReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(DashboardStatsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<DashboardStatsReading>.Cached(Reading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(DashboardStatsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<DashboardStatsReading>.OfflineCached(
            Reading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(DashboardStatsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<DashboardStatsReading>.Loading(),
            RepositoryResult<DashboardStatsReading>.Cached(Reading(fsm: "asleep"), Now, stale: false),
            RepositoryResult<DashboardStatsReading>.Loaded(Reading(fsm: "online"), Now));
        await vm.LoadAsync();

        Assert.Equal(DashboardStatsState.Loaded, vm.State);
        Assert.Equal("Online", vm.Display!.FsmStateLabel);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new DashboardStatsSize(2, 2), Loaded(Reading()));
        await vm.LoadAsync();
        Assert.False(vm.Display!.IsCompact);

        vm.Size = new DashboardStatsSize(1, 2);
        Assert.True(vm.Display!.IsCompact);
        Assert.Equal(DashboardStatsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_wide_transitions()
    {
        var reading = Reading(fsm: "online",
            new StateTransitionItem("driving", Now.AddMinutes(-5)));

        using var vm = NewViewModel(new DashboardStatsSize(2, 2), Loaded(reading));
        await vm.LoadAsync();
        Assert.Empty(vm.Display!.RecentTransitions);

        vm.Size = new DashboardStatsSize(3, 2);
        Assert.True(vm.Display!.IsWide);
        Assert.Single(vm.Display!.RecentTransitions);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<DashboardStatsReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Dashboard Stats", vm.Title);
        Assert.Equal("No dashboard stats available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(DashboardStatsViewModel.State), changed);
        Assert.Contains(nameof(DashboardStatsViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("dashboard-stats", DashboardStatsRegistration.Id);
        Assert.Equal("system", DashboardStatsRegistration.Category);
        Assert.Equal("DashboardStatsWidget", DashboardStatsRegistration.Slug);
        Assert.Equal(new DashboardStatsSize(2, 2), DashboardStatsRegistration.DefaultSize);
        Assert.Equal(new DashboardStatsSize(1, 2), DashboardStatsRegistration.MinSize);
        Assert.Equal(new DashboardStatsSize(4, 40), DashboardStatsRegistration.MaxSize);
        Assert.Equal("Dashboard Stats", DashboardStatsRegistration.Name(Localizer));
        Assert.Contains("FSM", DashboardStatsRegistration.Description(Localizer), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(2, 2, true)]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 1, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, DashboardStatsRegistration.IsWithinBounds(new DashboardStatsSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new DashboardStatsSize(1, 2), DashboardStatsRegistration.Clamp(new DashboardStatsSize(0, 0)));
        Assert.Equal(new DashboardStatsSize(4, 40), DashboardStatsRegistration.Clamp(new DashboardStatsSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DashboardStatsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DashboardStatsWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static DashboardStatsReading Reading(string? fsm = "online", params StateTransitionItem[] transitions) =>
        new(new DashboardStatsData(2, 50, 30), fsm, transitions);

    private static RepositoryResult<DashboardStatsReading> Loaded(DashboardStatsReading reading) =>
        RepositoryResult<DashboardStatsReading>.Loaded(reading, Now);

    private static DashboardStatsViewModel NewViewModel(params RepositoryResult<DashboardStatsReading>[] emissions) =>
        NewViewModel(DashboardStatsSize.Default, emissions);

    private static DashboardStatsViewModel NewViewModel(
        DashboardStatsSize size,
        params RepositoryResult<DashboardStatsReading>[] emissions) =>
        new(new FakeDashboardStatsSource(emissions), Localizer, size, () => Now);

    private sealed class FakeDashboardStatsSource(params RepositoryResult<DashboardStatsReading>[] emissions)
        : IDashboardStatsSource
    {
        public async IAsyncEnumerable<RepositoryResult<DashboardStatsReading>> StreamAsync(
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
