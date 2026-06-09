using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the StateTimelineWidget's UI-thread-free logic — the JSON parse adapters
/// (state summary + 24-hour timeline), the segment / stripe projection (percentages, durations, token
/// colours, capped legend, sub-0.5% stripe filter), the load-bearing cache-then-network combine mapper,
/// the registry metadata, the diagnostics, the repository source's vehicle resolution + request shapes, and
/// the state-holder view-model's per-state transitions (loading / loaded / empty / error / stale /
/// offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/StateTimelineWidget.tsx + api/hooks/useAnalytics.ts).
/// </summary>
public sealed class StateTimelineWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static StateSummaryEntry Entry(string state, double totalMin, int count = 1) => new(state, totalMin, count);

    private static StateTimelineTransition Transition(string state, double durationMin, string? start = null) =>
        new(state, start, durationMin);

    private static StateTimelineReading Reading(
        IReadOnlyList<StateSummaryEntry>? summary = null,
        IReadOnlyList<StateTimelineTransition>? transitions = null) =>
        new(summary ?? Array.Empty<StateSummaryEntry>(), transitions ?? Array.Empty<StateTimelineTransition>());

    // ---- Parse adapter: state summary ----------------------------------------------

    [Fact]
    public void StateSummary_parses_snake_case_array()
    {
        const string json = """
        [{"state":"driving","total_min":120.0,"count":4},
         {"state":"charging","total_min":60.0,"count":2}]
        """;
        using var doc = JsonDocument.Parse(json);

        var rows = StateSummaryEntry.ParseList(doc.RootElement);

        Assert.Equal(2, rows.Count);
        Assert.Equal("driving", rows[0].State);
        Assert.Equal(120.0, rows[0].TotalMinutes);
        Assert.Equal(4, rows[0].Count);
        Assert.Equal("charging", rows[1].State);
        Assert.Equal(60.0, rows[1].TotalMinutes);
    }

    [Fact]
    public void StateSummary_falls_back_to_camel_case_total_min()
    {
        using var doc = JsonDocument.Parse("""[{"state":"idle","totalMin":30,"count":1}]""");
        var row = Assert.Single(StateSummaryEntry.ParseList(doc.RootElement));
        Assert.Equal("idle", row.State);
        Assert.Equal(30.0, row.TotalMinutes);
    }

    [Fact]
    public void StateSummary_tolerates_missing_fields_and_envelope()
    {
        using var doc = JsonDocument.Parse("""{"summary":[{"state":"asleep"}]}""");
        var row = Assert.Single(StateSummaryEntry.ParseList(doc.RootElement));
        Assert.Equal("asleep", row.State);
        Assert.Equal(0, row.TotalMinutes);
        Assert.Equal(0, row.Count);
    }

    [Fact]
    public void StateSummary_skips_non_object_items_and_non_array()
    {
        using var doc = JsonDocument.Parse("""[1,"x",{"state":"driving","total_min":5}]""");
        Assert.Single(StateSummaryEntry.ParseList(doc.RootElement));

        using var scalar = JsonDocument.Parse("42");
        Assert.Empty(StateSummaryEntry.ParseList(scalar.RootElement));
    }

    // ---- Parse adapter: timeline ---------------------------------------------------

    [Fact]
    public void Timeline_parses_transitions_envelope_snake_case()
    {
        const string json = """
        {"transitions":[{"id":"a","state":"driving","start_date":"2026-06-06T10:00:00Z","duration_min":45.0}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var row = Assert.Single(StateTimelineTransition.ParseList(doc.RootElement));
        Assert.Equal("driving", row.State);
        Assert.Equal("2026-06-06T10:00:00Z", row.StartDate);
        Assert.Equal(45.0, row.DurationMinutes);
    }

    [Fact]
    public void Timeline_falls_back_to_camel_case_duration_min()
    {
        using var doc = JsonDocument.Parse("""{"transitions":[{"state":"idle","durationMin":12}]}""");
        var row = Assert.Single(StateTimelineTransition.ParseList(doc.RootElement));
        Assert.Equal(12.0, row.DurationMinutes);
        Assert.Null(row.StartDate);
    }

    [Fact]
    public void Timeline_tolerates_bare_array_and_non_object()
    {
        using var bare = JsonDocument.Parse("""[{"state":"charging","duration_min":5}]""");
        Assert.Single(StateTimelineTransition.ParseList(bare.RootElement));

        using var scalar = JsonDocument.Parse("null");
        Assert.Empty(StateTimelineTransition.ParseList(scalar.RootElement));
    }

    // ---- Reading.HasData (web hasData = segments.length > 0) ------------------------

    [Fact]
    public void Reading_HasData_true_only_when_minutes_present()
    {
        Assert.True(Reading(new[] { Entry("driving", 10) }).HasData);
        Assert.False(Reading(new[] { Entry("driving", 0), Entry("idle", 0) }).HasData);
        Assert.False(StateTimelineReading.Empty.HasData);
    }

    // ---- Size / footprint flags (web isCompact / isWide) ---------------------------

    [Theory]
    [InlineData(1, 2, true, false)]   // compact
    [InlineData(2, 4, false, false)]  // standard (default)
    [InlineData(3, 4, false, true)]   // wide
    [InlineData(4, 40, false, true)]  // wide (max)
    public void Size_flags_match_web(int cols, int rows, bool compact, bool wide)
    {
        var size = new StateTimelineSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
    }

    // ---- Colours (web STATE_COLORS → token brush keys) -----------------------------

    [Theory]
    [InlineData("driving", "TsColorInfoBrush")]
    [InlineData("Charging", "TsColorSuccessBrush")] // case-insensitive
    [InlineData("asleep", "TsChart07Brush")]
    [InlineData("idle", "TsColorWarningBrush")]
    [InlineData("offline", "TsColorDangerBrush")]
    [InlineData("nonsense", "TsColorTextMutedBrush")]
    [InlineData(null, "TsColorTextMutedBrush")]
    public void StateColors_map_to_token_keys(string? state, string expected) =>
        Assert.Equal(expected, StateTimelineColors.KeyFor(state));

    // ---- Projection: buildSegments -------------------------------------------------

    [Fact]
    public void BuildSegments_computes_percentages_and_keeps_order()
    {
        var segments = StateTimelineProjection.BuildSegments(
            new[] { Entry("driving", 60), Entry("charging", 30), Entry("idle", 30) }, Localizer);

        Assert.Equal(3, segments.Count);
        Assert.Equal(50.0, segments[0].Percent, 3);
        Assert.Equal(25.0, segments[1].Percent, 3);
        Assert.Equal("50.0%", segments[0].PercentText);
        Assert.Equal("50%", segments[0].PercentTextCompact);
        Assert.Equal("TsColorInfoBrush", segments[0].ColorKey);
        Assert.Equal("TsColorSuccessBrush", segments[1].ColorKey);
        Assert.Equal("TsColorWarningBrush", segments[2].ColorKey);
    }

    [Fact]
    public void BuildSegments_empty_when_total_minutes_zero()
    {
        Assert.Empty(StateTimelineProjection.BuildSegments(
            new[] { Entry("driving", 0), Entry("idle", 0) }, Localizer));
        Assert.Empty(StateTimelineProjection.BuildSegments(Array.Empty<StateSummaryEntry>(), Localizer));
    }

    [Fact]
    public void BuildSegments_blank_state_falls_back_to_em_dash_and_capitalizes()
    {
        var segment = Assert.Single(StateTimelineProjection.BuildSegments(new[] { Entry("  ", 10) }, Localizer));
        Assert.Equal("\u2014", segment.StateRaw);
        Assert.Equal("TsColorTextMutedBrush", segment.ColorKey);

        var driving = Assert.Single(StateTimelineProjection.BuildSegments(new[] { Entry("driving", 10) }, Localizer));
        Assert.Equal("Driving", driving.Label); // web `capitalize`
    }

    [Fact]
    public void BuildSegments_durations_match_web_fmtDuration()
    {
        var segments = StateTimelineProjection.BuildSegments(
            new[] { Entry("driving", 150), Entry("idle", 45) }, Localizer);

        Assert.Equal("2h 30m", segments[0].DurationText);
        Assert.Equal("45m", segments[1].DurationText);
    }

    // ---- Projection: FormatDuration tiers ------------------------------------------

    [Theory]
    [InlineData(0, "0m")]
    [InlineData(45, "45m")]
    [InlineData(60, "1h 0m")]
    [InlineData(150, "2h 30m")]
    [InlineData(-10, "0m")]
    public void FormatDuration_matches_web(double minutes, string expected) =>
        Assert.Equal(expected, StateTimelineProjection.FormatDuration(minutes, Localizer));

    // ---- Projection: footprint composition -----------------------------------------

    [Fact]
    public void Project_standard_has_segments_no_stripe()
    {
        var display = StateTimelineProjection.Project(
            Reading(new[] { Entry("driving", 60), Entry("idle", 60) }),
            new StateTimelineSize(2, 4),
            Localizer);

        Assert.True(display.HasData);
        Assert.False(display.IsCompact);
        Assert.False(display.IsWide);
        Assert.Equal(2, display.Segments.Count);
    }

    [Fact]
    public void Project_compact_caps_legend_at_five()
    {
        var entries = new[]
        {
            Entry("driving", 10), Entry("charging", 10), Entry("asleep", 10),
            Entry("idle", 10), Entry("offline", 10), Entry("updating", 10),
        };

        var display = StateTimelineProjection.Project(Reading(entries), new StateTimelineSize(1, 2), Localizer);

        Assert.True(display.IsCompact);
        Assert.Equal(6, display.Segments.Count);          // bar keeps all
        Assert.Equal(StateTimelineProjection.MaxLegend, display.LegendSegments.Count); // legend capped at 5
    }

    [Fact]
    public void Project_wide_builds_stripe_and_filters_sub_half_percent()
    {
        var reading = Reading(
            new[] { Entry("driving", 60) },
            new[] { Transition("driving", 600), Transition("charging", 1) }); // charging ≈0.17% → dropped

        var display = StateTimelineProjection.Project(reading, new StateTimelineSize(3, 4), Localizer);

        Assert.True(display.IsWide);
        Assert.True(display.HasStripe);
        var cell = Assert.Single(display.Stripe);
        Assert.Equal("TsColorInfoBrush", cell.ColorKey);
        Assert.Equal("24h Timeline", display.TimelineLabel);
    }

    [Fact]
    public void Project_stripe_empty_when_no_duration()
    {
        var display = StateTimelineProjection.Project(
            Reading(new[] { Entry("driving", 60) }, new[] { Transition("driving", 0) }),
            new StateTimelineSize(3, 4),
            Localizer);

        Assert.False(display.HasStripe);
        Assert.Empty(display.Stripe);
    }

    [Fact]
    public void Project_segments_have_non_empty_accessibility_names()
    {
        var segment = Assert.Single(
            StateTimelineProjection.Project(Reading(new[] { Entry("driving", 60) }), new StateTimelineSize(2, 4), Localizer).Segments);

        Assert.False(string.IsNullOrWhiteSpace(segment.BarAutomationName));
        Assert.False(string.IsNullOrWhiteSpace(segment.RowAutomationName));
        Assert.False(string.IsNullOrWhiteSpace(segment.LegendAutomationName));
        Assert.Contains(segment.Label, segment.RowAutomationName, StringComparison.Ordinal);
        Assert.Contains(segment.PercentText, segment.RowAutomationName, StringComparison.Ordinal);
        Assert.Contains(segment.DurationText, segment.RowAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (load-bearing summary + enrichment timeline) ----------------

    [Fact]
    public void Combine_summary_error_is_failure()
    {
        var result = StateTimelineResultMapper.Combine(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            null);

        Assert.Equal(LoadStatus.Error, result.Status);
    }

    [Fact]
    public void Combine_summary_with_data_and_null_timeline_is_loaded()
    {
        using var summary = JsonDocument.Parse("""[{"state":"driving","total_min":60}]""");

        var result = StateTimelineResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(summary.RootElement, Now), null);

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.Single(result.Value!.Summary);
        Assert.Empty(result.Value!.Transitions);
    }

    [Fact]
    public void Combine_all_zero_summary_collapses_to_empty()
    {
        using var summary = JsonDocument.Parse("""[{"state":"driving","total_min":0}]""");

        var result = StateTimelineResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(summary.RootElement, Now), null);

        Assert.Equal(LoadStatus.Empty, result.Status);
    }

    [Fact]
    public void Combine_merges_timeline_transitions()
    {
        using var summary = JsonDocument.Parse("""[{"state":"driving","total_min":60}]""");
        using var timeline = JsonDocument.Parse("""{"transitions":[{"state":"driving","duration_min":30}]}""");

        var result = StateTimelineResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(summary.RootElement, Now),
            RepositoryResult<JsonElement>.Loaded(timeline.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.Single(result.Value!.Transitions);
    }

    [Fact]
    public void Combine_stale_summary_or_timeline_yields_stale()
    {
        using var summary = JsonDocument.Parse("""[{"state":"driving","total_min":60}]""");
        using var timeline = JsonDocument.Parse("""{"transitions":[]}""");

        var result = StateTimelineResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(summary.RootElement, Now),
            RepositoryResult<JsonElement>.Cached(timeline.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, result.Status);
        Assert.True(result.IsStale);
    }

    [Fact]
    public void Combine_offline_summary_yields_offline_cached()
    {
        using var summary = JsonDocument.Parse("""[{"state":"driving","total_min":60}]""");

        var result = StateTimelineResultMapper.Combine(
            RepositoryResult<JsonElement>.OfflineCached(
                summary.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")),
            null);

        Assert.Equal(LoadStatus.Offline, result.Status);
        Assert.True(result.IsStale);
        Assert.Single(result.Value!.Summary);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<StateTimelineReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(StateTimelineState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_segments()
    {
        using var vm = NewViewModel(Loaded(Reading(new[] { Entry("driving", 60), Entry("idle", 60) })));
        await vm.LoadAsync();

        Assert.Equal(StateTimelineState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(2, vm.Display.Segments.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_with_zero_minutes_renders_empty()
    {
        using var vm = NewViewModel(
            RepositoryResult<StateTimelineReading>.Loaded(Reading(new[] { Entry("driving", 0) }), Now));
        await vm.LoadAsync();

        Assert.Equal(StateTimelineState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No state data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<StateTimelineReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(StateTimelineState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<StateTimelineReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(StateTimelineState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_content()
    {
        using var vm = NewViewModel(
            RepositoryResult<StateTimelineReading>.Cached(Reading(new[] { Entry("driving", 60) }), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(StateTimelineState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_content()
    {
        using var vm = NewViewModel(RepositoryResult<StateTimelineReading>.OfflineCached(
            Reading(new[] { Entry("driving", 60) }), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(StateTimelineState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<StateTimelineReading>.Loading(),
            RepositoryResult<StateTimelineReading>.Cached(Reading(new[] { Entry("idle", 30) }), Now, stale: false),
            RepositoryResult<StateTimelineReading>.Loaded(Reading(new[] { Entry("driving", 90), Entry("idle", 30) }), Now));
        await vm.LoadAsync();

        Assert.Equal(StateTimelineState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Segments.Count);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_wide_stripe()
    {
        var reading = Reading(
            new[] { Entry("driving", 60) },
            new[] { Transition("driving", 60) });

        using var vm = NewViewModel(new StateTimelineSize(2, 4), Loaded(reading));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsWide);

        vm.Size = new StateTimelineSize(3, 4);
        Assert.True(vm.Display.IsWide);
        Assert.True(vm.Display.HasStripe);
        Assert.Equal(StateTimelineState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<StateTimelineReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("State Timeline", vm.Title);
        Assert.Equal("No state data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Reading(new[] { Entry("driving", 60) })));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(StateTimelineViewModel.State), changed);
        Assert.Contains(nameof(StateTimelineViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("state-timeline", StateTimelineRegistration.Id);
        Assert.Equal("analytics", StateTimelineRegistration.Category);
        Assert.Equal("StateTimelineWidget", StateTimelineRegistration.Slug);
        Assert.Equal(new StateTimelineSize(2, 4), StateTimelineRegistration.DefaultSize);
        Assert.Equal(new StateTimelineSize(1, 2), StateTimelineRegistration.MinSize);
        Assert.Equal(new StateTimelineSize(4, 40), StateTimelineRegistration.MaxSize);
        Assert.Equal("State Timeline", StateTimelineRegistration.Name(Localizer));
        Assert.Contains("state distribution", StateTimelineRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 1, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, StateTimelineRegistration.IsWithinBounds(new StateTimelineSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new StateTimelineSize(1, 2), StateTimelineRegistration.Clamp(new StateTimelineSize(0, 0)));
        Assert.Equal(new StateTimelineSize(4, 40), StateTimelineRegistration.Clamp(new StateTimelineSize(9, 99)));
    }

    [Fact]
    public void RegistryId_is_exposed_on_the_view_type() =>
        Assert.Equal("state-timeline", StateTimelineRegistration.Id);

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new StateTimelineDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=StateTimelineWidget", Assert.Single(lines));
    }

    // ---- Source: vehicle resolution + request shape --------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new StateTimelineSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_both_endpoints()
    {
        using var doc = JsonDocument.Parse("""[{"state":"driving","total_min":60}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement).ReturnsValue(doc.RootElement);
        var source = new StateTimelineSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(2, api.Requests.Count);
        Assert.Contains(api.Requests, r => r.OperationId == "get_api_v1_vehicle_states_summary");
        Assert.Contains(api.Requests, r => r.OperationId == "get_api_v1_vehicle_states_timeline");
        Assert.All(api.Requests, r => Assert.Equal(7L, Convert.ToInt64(r.Query!["vehicle_id"], CultureInfo.InvariantCulture)));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins()
    {
        using var doc = JsonDocument.Parse("""[{"state":"idle","total_min":15}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement).ReturnsValue(doc.RootElement);
        var source = new StateTimelineSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.All(api.Requests, r => Assert.Equal(42L, Convert.ToInt64(r.Query!["vehicle_id"], CultureInfo.InvariantCulture)));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new FakeCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<StateTimelineReading>>> Drain(IStateTimelineSource source)
    {
        var list = new List<RepositoryResult<StateTimelineReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<StateTimelineReading> Loaded(StateTimelineReading reading) =>
        RepositoryResult<StateTimelineReading>.Loaded(reading, Now);

    private static StateTimelineViewModel NewViewModel(params RepositoryResult<StateTimelineReading>[] emissions) =>
        NewViewModel(StateTimelineSize.Default, emissions);

    private static StateTimelineViewModel NewViewModel(
        StateTimelineSize size,
        params RepositoryResult<StateTimelineReading>[] emissions) =>
        new(new FakeStateTimelineSource(emissions), Localizer, size, () => Now);

    private sealed class FakeStateTimelineSource(params RepositoryResult<StateTimelineReading>[] emissions) : IStateTimelineSource
    {
        public async IAsyncEnumerable<RepositoryResult<StateTimelineReading>> StreamAsync(
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

    private sealed class FakeWidgetVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }
}
