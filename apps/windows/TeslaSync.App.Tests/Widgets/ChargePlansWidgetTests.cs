using System.Globalization;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the ChargePlansWidget's UI-thread-free logic — the charge-plan / rate-plan
/// JSON parse adapters, the active-plan selection, the status-badge mapping, the projection into the
/// compact target-SOC layout and the standard stat-grid + detail-list layout (the native port of the
/// web <c>planEntries</c>/<c>rateEntries</c> memos and <c>useFormatting</c>/<c>useDateFormat</c>
/// helpers), the two-source cache-then-network merge (<see cref="ChargePlansResultMapper.Combine"/>),
/// the registry metadata, the diagnostics, and the state-holder view-model's per-state transitions
/// (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/ChargePlansWidget.tsx).
/// </summary>
public sealed class ChargePlansWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string EmDash = "\u2014";

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ChargePlan_FromJson_reads_snake_case_fields()
    {
        using var doc = JsonDocument.Parse("""
        {"id":7,"target_soc":90,"status":"scheduled","estimated_kwh":20.5,"estimated_cost":5.25,
         "savings":2.0,"rate_plan":"SCE TOU-D","scheduled_start":"2026-06-06T22:00:00Z",
         "scheduled_end":"2026-06-07T03:00:00Z","depart_by":"2026-06-07T07:30:00Z"}
        """);

        var plan = ChargePlan.FromJson(doc.RootElement);

        Assert.Equal(7, plan.Id);
        Assert.Equal(90, plan.TargetSoc);
        Assert.Equal("scheduled", plan.Status);
        Assert.Equal(20.5, plan.EstimatedKwh);
        Assert.Equal(5.25, plan.EstimatedCost);
        Assert.Equal(2.0, plan.Savings);
        Assert.Equal("SCE TOU-D", plan.RatePlan);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 22, 0, 0, TimeSpan.Zero), plan.ScheduledStart);
        Assert.Equal(new DateTimeOffset(2026, 6, 7, 3, 0, 0, TimeSpan.Zero), plan.ScheduledEnd);
        Assert.Equal(new DateTimeOffset(2026, 6, 7, 7, 30, 0, TimeSpan.Zero), plan.DepartBy);
    }

    [Fact]
    public void ChargePlan_FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":1}""");

        var plan = ChargePlan.FromJson(doc.RootElement);

        Assert.Equal(0, plan.Id);
        Assert.Equal(0, plan.TargetSoc);
        Assert.Equal(string.Empty, plan.Status);
        Assert.Null(plan.EstimatedKwh);
        Assert.Null(plan.EstimatedCost);
        Assert.Null(plan.Savings);
        Assert.Null(plan.RatePlan);
        Assert.Null(plan.ScheduledStart);
        Assert.Null(plan.DepartBy);
    }

    [Fact]
    public void ChargePlan_ParseList_reads_array_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse("""
        [{"id":1,"status":"active"}, 42, {"id":2,"status":"completed"}]
        """);

        var list = ChargePlan.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].Id);
        Assert.Equal("completed", list[1].Status);
    }

    [Fact]
    public void RatePlanInfo_FromJson_reads_fields_and_tolerates_missing()
    {
        using var full = JsonDocument.Parse("""{"id":"pge-ev2a","name":"EV2-A","utility":"PG&E"}""");
        var rate = RatePlanInfo.FromJson(full.RootElement);
        Assert.Equal("pge-ev2a", rate.Id);
        Assert.Equal("EV2-A", rate.Name);
        Assert.Equal("PG&E", rate.Utility);

        using var partial = JsonDocument.Parse("""{"name":"Only name"}""");
        var sparse = RatePlanInfo.FromJson(partial.RootElement);
        Assert.Null(sparse.Id);
        Assert.Equal("Only name", sparse.Name);
        Assert.Null(sparse.Utility);
    }

    [Fact]
    public void RatePlanInfo_ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"not":"an array"}""");
        Assert.Empty(RatePlanInfo.ParseList(doc.RootElement));
    }

    // ---- Active-plan selection (web plans.find(active|scheduled) ?? plans[0]) -------

    [Fact]
    public void SelectActivePlan_prefers_active_then_scheduled_then_first()
    {
        Assert.Equal(2, ChargePlansProjection.SelectActivePlan(
            new[] { Plan(status: "completed", id: 1), Plan(status: "active", id: 2) })!.Id);

        Assert.Equal(3, ChargePlansProjection.SelectActivePlan(
            new[] { Plan(status: "completed", id: 1), Plan(status: "scheduled", id: 3) })!.Id);

        // No active/scheduled — falls back to the first row.
        Assert.Equal(1, ChargePlansProjection.SelectActivePlan(
            new[] { Plan(status: "completed", id: 1), Plan(status: "failed", id: 9) })!.Id);

        Assert.Null(ChargePlansProjection.SelectActivePlan(Array.Empty<ChargePlan>()));
    }

    [Theory]
    [InlineData("completed", StatusKind.Success)]
    [InlineData("active", StatusKind.Warning)]
    [InlineData("scheduled", StatusKind.Warning)]
    [InlineData("failed", StatusKind.Danger)]
    [InlineData("cancelled", StatusKind.Danger)]
    [InlineData("queued", StatusKind.Neutral)]
    [InlineData("", StatusKind.Neutral)]
    public void StatusKindFor_maps_web_badge_variants(string status, StatusKind expected) =>
        Assert.Equal(expected, ChargePlansProjection.StatusKindFor(status));

    // ---- Projection (standard) -----------------------------------------------------

    [Fact]
    public void Project_standard_exposes_active_plan_stats_and_sliced_details()
    {
        var display = ChargePlansProjection.Project(
            Snapshot(plans: new[] { Plan() }, rates: new[] { Rate() }),
            ChargePlansSettings.Default,
            new ChargePlansSize(2, 4),
            Localizer,
            Now);

        Assert.True(display.HasData);
        Assert.True(display.HasActivePlan);
        Assert.False(display.IsCompact);
        Assert.Equal("active", display.StatusText);
        Assert.Equal(StatusKind.Warning, display.StatusKind);
        Assert.Equal("PG&E EV2-A", display.RatePlanText);
        Assert.Equal("80%", display.TargetSocValue);
        Assert.Equal("Target SOC", display.TargetSocLabel);
        Assert.Equal("Departure", display.DepartureLabel);

        // Web parity: planEntries.slice(2) — Target SOC + Departure are surfaced as stat cards.
        Assert.Equal(6, display.PlanEntries.Count);
        Assert.DoesNotContain(display.PlanEntries, e => e.Label == "Target SOC");
        Assert.DoesNotContain(display.PlanEntries, e => e.Label == "Departure");

        Assert.Equal("12.5 kWh", Entry(display.PlanEntries, "Est. Energy").Value);
        Assert.Equal("$3.50", Entry(display.PlanEntries, "Est. Cost").Value);
        Assert.Equal("PG&E EV2-A", Entry(display.PlanEntries, "Rate Plan").Value);

        var savings = Entry(display.PlanEntries, "Savings");
        Assert.Equal("$1.25", savings.Value);
        Assert.NotNull(savings.Badge);
        Assert.Equal("saved", savings.Badge!.Text);
        Assert.Equal(StatusKind.Success, savings.Badge.Kind);
    }

    [Fact]
    public void Project_omits_savings_entry_when_not_positive()
    {
        var display = ChargePlansProjection.Project(
            Snapshot(plans: new[] { Plan(savings: 0) }),
            ChargePlansSettings.Default,
            new ChargePlansSize(2, 4),
            Localizer,
            Now);

        Assert.Equal(5, display.PlanEntries.Count);
        Assert.DoesNotContain(display.PlanEntries, e => e.Label == "Savings");
    }

    [Fact]
    public void Project_full_entries_lead_with_target_soc_badge_and_handle_null_schedule()
    {
        var entries = ChargePlansProjection.BuildFullPlanEntries(
            Plan(status: "scheduled", schedStart: null, schedEnd: null, departBy: null, estimatedKwh: null, estimatedCost: null),
            ChargePlansSettings.Default,
            Localizer,
            Now);

        Assert.Equal("Target SOC", entries[0].Label);
        Assert.NotNull(entries[0].Badge);
        Assert.Equal("scheduled", entries[0].Badge!.Text);
        Assert.Equal(StatusKind.Warning, entries[0].Badge!.Kind);

        Assert.Equal(EmDash, Entry(entries, "Departure").Value);
        Assert.Equal($"{EmDash} {EmDash}", Entry(entries, "Scheduled Start").Value);
        Assert.Equal($"{EmDash} {EmDash}", Entry(entries, "Scheduled End").Value);
        Assert.Equal(EmDash, Entry(entries, "Est. Energy").Value);
        Assert.Equal(EmDash, Entry(entries, "Est. Cost").Value);
    }

    [Fact]
    public void Project_scheduled_times_render_when_present()
    {
        var entries = ChargePlansProjection.BuildFullPlanEntries(
            Plan(schedStart: Now, schedEnd: Now.AddHours(5)),
            ChargePlansSettings.Default,
            Localizer,
            Now);

        // Timezone-independent: a real instant must not render the null "— —" placeholder.
        Assert.NotEqual($"{EmDash} {EmDash}", Entry(entries, "Scheduled Start").Value);
        Assert.NotEqual($"{EmDash} {EmDash}", Entry(entries, "Scheduled End").Value);
        Assert.Contains(" ", Entry(entries, "Scheduled Start").Value, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_rate_entries_map_utility_name_id_mono()
    {
        var display = ChargePlansProjection.Project(
            Snapshot(rates: new[] { Rate(id: "pge-ev2a", name: "EV2-A", utility: "PG&E") }),
            ChargePlansSettings.Default,
            new ChargePlansSize(2, 4),
            Localizer,
            Now);

        Assert.True(display.HasRates);
        Assert.Equal("Rate Plans", display.RatePlansHeading);
        var rate = Assert.Single(display.RateEntries);
        Assert.Equal("PG&E", rate.Label);
        Assert.Equal("EV2-A", rate.Value);
        Assert.True(rate.Mono);
        Assert.NotNull(rate.Badge);
        Assert.Equal("pge-ev2a", rate.Badge!.Text);
        Assert.Equal(StatusKind.Neutral, rate.Badge.Kind);
    }

    [Fact]
    public void Project_currency_honours_settings_symbol_and_precision()
    {
        var display = ChargePlansProjection.Project(
            Snapshot(plans: new[] { Plan(estimatedCost: 3.5, savings: 0) }),
            ChargePlansSettings.Default with { CurrencySymbol = "\u00A3" }, // £
            new ChargePlansSize(2, 4),
            Localizer,
            Now);

        Assert.StartsWith("\u00A3", Entry(display.PlanEntries, "Est. Cost").Value, StringComparison.Ordinal);
    }

    // ---- Projection (compact) ------------------------------------------------------

    [Fact]
    public void Project_compact_shows_target_soc_and_departure()
    {
        var display = ChargePlansProjection.Project(
            Snapshot(plans: new[] { Plan(targetSoc: 75, departBy: Now.AddHours(8)) }),
            ChargePlansSettings.Default,
            new ChargePlansSize(1, 2),
            Localizer,
            Now);

        Assert.True(display.IsCompact);
        Assert.True(display.HasActivePlan);
        Assert.Equal("75%", display.CompactTargetValue);
        Assert.Equal("Target SOC", display.CompactTargetLabel);
        Assert.NotNull(display.CompactDeparture);
    }

    [Fact]
    public void Project_compact_without_plan_carries_no_plans_message()
    {
        var display = ChargePlansProjection.Project(
            Snapshot(rates: new[] { Rate() }),
            ChargePlansSettings.Default,
            new ChargePlansSize(1, 2),
            Localizer,
            Now);

        Assert.True(display.IsCompact);
        Assert.False(display.HasActivePlan);
        Assert.Null(display.CompactDeparture);
        Assert.Equal("No charge plans", display.NoPlansMessage);
    }

    // ---- Accessibility names -------------------------------------------------------

    [Fact]
    public void Project_detail_entries_have_non_empty_accessibility_names()
    {
        var display = ChargePlansProjection.Project(
            Snapshot(plans: new[] { Plan() }, rates: new[] { Rate() }),
            ChargePlansSettings.Default,
            new ChargePlansSize(2, 4),
            Localizer,
            Now);

        foreach (var entry in display.PlanEntries.Concat(display.RateEntries))
        {
            Assert.False(string.IsNullOrWhiteSpace(entry.AutomationName));
            Assert.Contains(entry.Label, entry.AutomationName, StringComparison.Ordinal);
            Assert.Contains(entry.Value, entry.AutomationName, StringComparison.Ordinal);
        }

        Assert.Contains(display.CompactTargetValue, display.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains(display.CompactTargetLabel, display.CompactAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (two-source cache-then-network merge) ------------------------

    [Fact]
    public void Combine_null_sides_are_loading()
    {
        var result = ChargePlansResultMapper.Combine(null, null);
        Assert.Equal(LoadStatus.Loading, result.Status);
    }

    [Fact]
    public void Combine_merges_loaded_plans_and_rates()
    {
        var result = ChargePlansResultMapper.Combine(
            LoadedJson("""[{"id":1,"status":"active","target_soc":80}]"""),
            LoadedJson("""[{"id":"pge","name":"EV2-A","utility":"PG&E"}]"""));

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.True(result.Value!.HasData);
        Assert.Single(result.Value.Plans);
        Assert.Single(result.Value.Rates);
    }

    [Fact]
    public void Combine_two_empty_arrays_are_loaded_without_data()
    {
        var result = ChargePlansResultMapper.Combine(LoadedJson("[]"), LoadedJson("[]"));

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.False(result.Value!.HasData);
    }

    [Fact]
    public void Combine_empty_statuses_are_empty()
    {
        var result = ChargePlansResultMapper.Combine(
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Empty, result.Status);
    }

    [Fact]
    public void Combine_both_failures_surface_error()
    {
        var result = ChargePlansResultMapper.Combine(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        Assert.Equal(LoadStatus.Error, result.Status);
    }

    [Fact]
    public void Combine_failure_plus_data_keeps_the_data()
    {
        var result = ChargePlansResultMapper.Combine(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Network, "down")),
            LoadedJson("""[{"id":"pge","name":"EV2-A","utility":"PG&E"}]"""));

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.Single(result.Value!.Rates);
    }

    [Fact]
    public void Combine_offline_side_surfaces_offline()
    {
        var result = ChargePlansResultMapper.Combine(
            RepositoryResult<JsonElement>.OfflineCached(
                Json("""[{"id":1,"status":"active"}]"""), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")),
            LoadedJson("[]"));

        Assert.Equal(LoadStatus.Offline, result.Status);
        Assert.True(result.Value!.HasData);
    }

    [Fact]
    public void Combine_stale_cache_is_reported_stale()
    {
        var result = ChargePlansResultMapper.Combine(
            RepositoryResult<JsonElement>.Cached(Json("""[{"id":1,"status":"active"}]"""), Now, stale: true),
            LoadedJson("[]"));

        Assert.Equal(LoadStatus.Cached, result.Status);
        Assert.True(result.IsStale);
    }

    [Fact]
    public void Combine_one_pending_side_holds_cached_content()
    {
        var result = ChargePlansResultMapper.Combine(
            RepositoryResult<JsonElement>.Loading(),
            LoadedJson("""[{"id":"pge","name":"EV2-A","utility":"PG&E"}]"""));

        Assert.Equal(LoadStatus.Cached, result.Status);
        Assert.False(result.IsStale);
        Assert.Single(result.Value!.Rates);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<ChargePlansSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ChargePlansState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_active_plan()
    {
        using var vm = NewViewModel(Loaded(Snapshot(plans: new[] { Plan() }, rates: new[] { Rate() })));
        await vm.LoadAsync();

        Assert.Equal(ChargePlansState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.Display.HasActivePlan);
        Assert.Equal("80%", vm.Display.TargetSocValue);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_data_renders_empty()
    {
        using var vm = NewViewModel(Loaded(ChargePlansSnapshot.Empty));
        await vm.LoadAsync();

        Assert.Equal(ChargePlansState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No charge plans or rate data", vm.Display.NoDataMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<ChargePlansSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ChargePlansState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargePlansSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ChargePlansState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargePlansSnapshot>.Cached(Snapshot(plans: new[] { Plan() }), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ChargePlansState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<ChargePlansSnapshot>.OfflineCached(
            Snapshot(plans: new[] { Plan() }), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ChargePlansState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargePlansSnapshot>.Loading(),
            RepositoryResult<ChargePlansSnapshot>.Cached(Snapshot(plans: new[] { Plan(targetSoc: 60) }), Now, stale: false),
            Loaded(Snapshot(plans: new[] { Plan(targetSoc: 90) })));
        await vm.LoadAsync();

        Assert.Equal(ChargePlansState.Loaded, vm.State);
        Assert.Equal("90%", vm.Display.TargetSocValue);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new ChargePlansSize(2, 4), Loaded(Snapshot(plans: new[] { Plan() })));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new ChargePlansSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(ChargePlansState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_settings_change_reprojects_currency()
    {
        using var vm = NewViewModel(Loaded(Snapshot(plans: new[] { Plan(estimatedCost: 3.5, savings: 0) })));
        await vm.LoadAsync();
        Assert.StartsWith("$", Entry(vm.Display.PlanEntries, "Est. Cost").Value, StringComparison.Ordinal);

        vm.Settings = ChargePlansSettings.Default with { CurrencySymbol = "\u00A3" }; // £
        Assert.StartsWith("\u00A3", Entry(vm.Display.PlanEntries, "Est. Cost").Value, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<ChargePlansSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Charge Plans", vm.Title);
        Assert.Equal("No charge plans or rate data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Snapshot(plans: new[] { Plan() })));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ChargePlansViewModel.State), changed);
        Assert.Contains(nameof(ChargePlansViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("charge-plans", ChargePlansRegistration.Id);
        Assert.Equal("charging", ChargePlansRegistration.Category);
        Assert.Equal("ChargePlansWidget", ChargePlansRegistration.Slug);
        Assert.Equal(new ChargePlansSize(2, 4), ChargePlansRegistration.DefaultSize);
        Assert.Equal(new ChargePlansSize(1, 2), ChargePlansRegistration.MinSize);
        Assert.Equal(new ChargePlansSize(4, 40), ChargePlansRegistration.MaxSize);
        Assert.Equal("Charge Plans", ChargePlansRegistration.Name(Localizer));
        Assert.Contains("rate", ChargePlansRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
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
        Assert.Equal(within, ChargePlansRegistration.IsWithinBounds(new ChargePlansSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new ChargePlansSize(1, 2), ChargePlansRegistration.Clamp(new ChargePlansSize(0, 0)));
        Assert.Equal(new ChargePlansSize(4, 40), ChargePlansRegistration.Clamp(new ChargePlansSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChargePlansDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargePlansWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static ChargePlan Plan(
        string status = "active",
        double targetSoc = 80,
        double? estimatedKwh = 12.5,
        double? estimatedCost = 3.5,
        double? savings = 1.25,
        string? ratePlan = "PG&E EV2-A",
        DateTimeOffset? departBy = null,
        DateTimeOffset? schedStart = null,
        DateTimeOffset? schedEnd = null,
        long id = 1) =>
        new(id, targetSoc, departBy, schedStart, schedEnd, ratePlan, estimatedKwh, estimatedCost, savings, status);

    private static RatePlanInfo Rate(string id = "pge-ev2a", string name = "EV2-A", string utility = "PG&E") =>
        new(id, name, utility);

    private static ChargePlansSnapshot Snapshot(
        IEnumerable<ChargePlan>? plans = null,
        IEnumerable<RatePlanInfo>? rates = null) =>
        new(
            (plans ?? Array.Empty<ChargePlan>()).ToList(),
            (rates ?? Array.Empty<RatePlanInfo>()).ToList());

    private static DetailEntry Entry(IReadOnlyList<DetailEntry> entries, string label) =>
        entries.First(e => e.Label == label);

    private static JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement.Clone();

    private static RepositoryResult<JsonElement> LoadedJson(string raw) =>
        RepositoryResult<JsonElement>.Loaded(Json(raw), Now);

    private static RepositoryResult<ChargePlansSnapshot> Loaded(ChargePlansSnapshot snapshot) =>
        RepositoryResult<ChargePlansSnapshot>.Loaded(snapshot, Now);

    private static ChargePlansViewModel NewViewModel(params RepositoryResult<ChargePlansSnapshot>[] emissions) =>
        NewViewModel(ChargePlansSize.Default, emissions);

    private static ChargePlansViewModel NewViewModel(
        ChargePlansSize size,
        params RepositoryResult<ChargePlansSnapshot>[] emissions) =>
        new(new FakeChargePlansSource(emissions), Localizer, size, ChargePlansSettings.Default, () => Now);

    private sealed class FakeChargePlansSource(params RepositoryResult<ChargePlansSnapshot>[] emissions) : IChargePlansSource
    {
        public async IAsyncEnumerable<RepositoryResult<ChargePlansSnapshot>> StreamAsync(
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
