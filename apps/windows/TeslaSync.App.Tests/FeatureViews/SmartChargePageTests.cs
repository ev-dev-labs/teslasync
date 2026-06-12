using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews.Charging;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the WinUI <c>SmartChargePage</c>'s UI-thread-free logic — the rate-plan / plan-history
/// / optimizer / apply JSON parse adapters, the projection (cost tiles, recommended-schedule details, alternative
/// windows, the 24-hour rate-timeline bars and the plan-history table), the interactive state-holder view-model's
/// per-state transitions (loading / ready / empty / error) and its optimize/apply mutation flows, the i18n key
/// coverage, the generated-client-backed sources, the registration metadata and the diagnostics. Mirrors the web
/// spec (web/src/features/charging/pages/SmartChargePage.tsx + web/src/features/charging/components/RateTimeline.tsx).
/// </summary>
public sealed class SmartChargePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    /// <summary>Every required visible literal (web key names) — parity string coverage (33).</summary>
    private static readonly string[] RequiredStringKeys =
    [
        "chargePlanner.alternatives", "chargePlanner.applied", "chargePlanner.applyError",
        "chargePlanner.applySchedule", "chargePlanner.batteryCapacity", "chargePlanner.chargeNowCost",
        "chargePlanner.cost_decimal", "chargePlanner.currentRate", "chargePlanner.currentSoc",
        "chargePlanner.date", "chargePlanner.departBy", "chargePlanner.endTime", "chargePlanner.history",
        "chargePlanner.maxAmps", "chargePlanner.noHistory", "chargePlanner.optimize",
        "chargePlanner.optimizeError", "chargePlanner.optimizedCost", "chargePlanner.plan",
        "chargePlanner.ratePlan", "chargePlanner.rateTimeline", "chargePlanner.savedAmount",
        "chargePlanner.savings", "chargePlanner.schedule", "chargePlanner.settings", "chargePlanner.startTime",
        "chargePlanner.status", "chargePlanner.subtitle", "chargePlanner.targetSoc",
        "chargePlanner.targetSocLabel", "chargePlanner.title", "chargePlanner.window", "chargePlanner.windowInfo",
    ];

    private static IReadOnlyList<HourlyRateRecord> SampleHours()
    {
        var list = new List<HourlyRateRecord>();
        for (int h = 0; h < 24; h++)
        {
            list.Add(new HourlyRateRecord(h, h % 6 == 0 ? 50 : 20, h < 6 ? "OFF_PEAK" : "ON_PEAK"));
        }

        return list;
    }

    private static OptimizeChargeResult SampleResult() => new(
        PlanId: 101,
        CurrentSoc: 55,
        TargetSoc: 80,
        KwhNeeded: 18.5,
        EstimatedDurationHours: 3.2,
        Schedule: new ChargeWindowRecord(
            new DateTimeOffset(2026, 6, 13, 1, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 6, 13, 5, 0, 0, TimeSpan.Zero),
            18.0,
            3.33,
            "OFF_PEAK"),
        Comparison: new CostComparisonRecord(8.0, 3.33, 4.67, 58.0),
        AlternativeWindows:
        [
            new ChargeWindowRecord(
                new DateTimeOffset(2026, 6, 13, 2, 0, 0, TimeSpan.Zero),
                new DateTimeOffset(2026, 6, 13, 6, 0, 0, TimeSpan.Zero),
                20,
                4.0,
                "MID_PEAK"),
        ],
        HourlyRates: SampleHours());

    private static IReadOnlyList<ChargePlanRecord> SamplePlans() =>
    [
        new ChargePlanRecord(
            1,
            80,
            new DateTimeOffset(2026, 6, 12, 1, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 6, 12, 5, 0, 0, TimeSpan.Zero),
            "PG&E EV2-A",
            3.5,
            4.2,
            "scheduled",
            new DateTimeOffset(2026, 6, 11, 12, 0, 0, TimeSpan.Zero)),
    ];

    private static SmartChargeDisplay Project(
        OptimizeChargeResult? result = null,
        IReadOnlyList<ChargePlanRecord>? plans = null,
        ILocalizer? localizer = null) =>
        SmartChargeProjection.Project(result, plans ?? System.Array.Empty<ChargePlanRecord>(), localizer ?? Localizer, "$", 2, Now);

    // ---- Parse adapters ------------------------------------------------------------

    [Fact]
    public void RatePlans_FromJson_reads_bare_array_and_builds_label()
    {
        const string json = """[{"id":"pge-ev2a","name":"PG&E EV2-A","utility":"PG&E"},{"id":"x","name":"X"}]""";
        using var doc = JsonDocument.Parse(json);

        var plans = RatePlanOption.ListFromJson(doc.RootElement);

        Assert.Equal(2, plans.Count);
        Assert.Equal("pge-ev2a", plans[0].Id);
        Assert.Equal("PG&E EV2-A (PG&E)", plans[0].DisplayLabel);
        Assert.Equal("X", plans[1].DisplayLabel);
    }

    [Fact]
    public void RatePlans_FromJson_unwraps_data_envelope_and_skips_idless_rows()
    {
        using var doc = JsonDocument.Parse("""{"data":[{"name":"no id"},{"id":"ok","name":"OK","utility":"U"}]}""");

        var plans = RatePlanOption.ListFromJson(doc.RootElement);

        var only = Assert.Single(plans);
        Assert.Equal("ok", only.Id);
    }

    [Fact]
    public void ChargePlan_FromJson_reads_snake_case_fields()
    {
        const string json = """
        [{"id":7,"target_soc":80,"scheduled_start":"2026-06-12T01:00:00Z","scheduled_end":"2026-06-12T05:00:00Z",
          "rate_plan":"PG&E EV2-A","estimated_cost":3.5,"savings":4.2,"status":"completed","created_at":"2026-06-11T12:00:00Z"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var plans = ChargePlanRecord.ListFromJson(doc.RootElement);

        var plan = Assert.Single(plans);
        Assert.Equal(7, plan.Id);
        Assert.Equal(80, plan.TargetSoc);
        Assert.Equal("PG&E EV2-A", plan.RatePlan);
        Assert.Equal(3.5, plan.EstimatedCost);
        Assert.Equal(4.2, plan.Savings);
        Assert.Equal("completed", plan.Status);
    }

    [Fact]
    public void ChargePlan_FromJson_tolerates_missing_optionals()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"status":"cancelled"}]""");

        var plan = Assert.Single(ChargePlanRecord.ListFromJson(doc.RootElement));

        Assert.Null(plan.EstimatedCost);
        Assert.Null(plan.Savings);
        Assert.Equal("cancelled", plan.Status);
    }

    [Fact]
    public void OptimizeResult_FromJson_reads_schedule_comparison_alternatives_and_hours()
    {
        const string json = """
        {"plan_id":101,"current_soc":55,"target_soc":80,"kwh_needed":18.5,"estimated_duration_hours":3.2,
         "schedule":{"start_time":"2026-06-13T01:00:00Z","end_time":"2026-06-13T05:00:00Z","rate_cents_kwh":18,"estimated_cost":3.33,"rate_tier":"OFF_PEAK"},
         "comparison":{"charge_now_cost":8,"optimized_cost":3.33,"savings":4.67,"savings_percent":58},
         "alternative_windows":[{"start_time":"2026-06-13T02:00:00Z","end_time":"2026-06-13T06:00:00Z","rate_cents_kwh":20,"estimated_cost":4,"rate_tier":"MID_PEAK"}],
         "hourly_rates":[{"hour":0,"rate_cents":50,"tier":"OFF_PEAK"},{"hour":1,"rate_cents":20,"tier":"OFF_PEAK"}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var result = OptimizeChargeResult.FromJson(doc.RootElement);

        Assert.Equal(101, result.PlanId);
        Assert.Equal(55, result.CurrentSoc);
        Assert.Equal(18.5, result.KwhNeeded);
        Assert.Equal("OFF_PEAK", result.Schedule.RateTier);
        Assert.Equal(4.67, result.Comparison.Savings);
        Assert.Equal(58, result.Comparison.SavingsPercent);
        Assert.Single(result.AlternativeWindows);
        Assert.Equal(2, result.HourlyRates.Count);
    }

    [Fact]
    public void ApplyResult_FromJson_reads_status_plan_and_message()
    {
        using var doc = JsonDocument.Parse("""{"status":"scheduled","plan_id":101,"message":"Charging scheduled at 01:00"}""");

        var apply = ApplyScheduleResult.FromJson(doc.RootElement);

        Assert.Equal("scheduled", apply.Status);
        Assert.Equal(101, apply.PlanId);
        Assert.Equal("Charging scheduled at 01:00", apply.Message);
    }

    // ---- Pure projection helpers ---------------------------------------------------

    [Theory]
    [InlineData("scheduled", StatusKind.Info)]
    [InlineData("completed", StatusKind.Success)]
    [InlineData("cancelled", StatusKind.Danger)]
    [InlineData("other", StatusKind.Neutral)]
    public void StatusFor_maps_plan_status_to_color(string status, StatusKind expected) =>
        Assert.Equal(expected, SmartChargeProjection.StatusFor(status));

    [Theory]
    [InlineData("OFF_PEAK", StatusKind.Success)]
    [InlineData("SUPER_OFF_PEAK", StatusKind.Success)]
    [InlineData("MID_PEAK", StatusKind.Warning)]
    [InlineData("ON_PEAK", StatusKind.Danger)]
    [InlineData("unknown", StatusKind.Neutral)]
    public void TierColor_maps_tier_to_color(string tier, StatusKind expected) =>
        Assert.Equal(expected, SmartChargeProjection.TierColor(tier));

    [Theory]
    [InlineData(0, "12a")]
    [InlineData(12, "12p")]
    [InlineData(9, "9a")]
    [InlineData(15, "3p")]
    [InlineData(24, "12a")]
    public void FormatHour_matches_web_timeline(int hour, string expected) =>
        Assert.Equal(expected, SmartChargeProjection.FormatHour(hour));

    // ---- Projection: i18n coverage -------------------------------------------------

    [Fact]
    public async Task Resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        // The projection resolves every panel label (and windowInfo, given a result).
        SmartChargeProjection.Project(SampleResult(), SamplePlans(), recorder, "$", 2, Now);

        // The optimize/apply error keys resolve only on the view-model's failure paths.
        var failingOptimize = NewViewModel(localizer: recorder, optimize: new ThrowingOptimizeClient(), vehicle: new WidgetVehicleSnapshot { VehicleId = 1 });
        await failingOptimize.OptimizeAsync();

        var failingApply = NewViewModel(localizer: recorder, optimize: new FakeOptimizeClient(SampleResult()), apply: new ThrowingApplyClient(), vehicle: new WidgetVehicleSnapshot { VehicleId = 1 });
        await failingApply.OptimizeAsync();
        await failingApply.ApplyAsync();

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }

        Assert.Equal(33, RequiredStringKeys.Length);
    }

    // ---- Projection: cost tiles (Charge-Now / Optimized-Cost / Savings) ------------

    [Fact]
    public void Projection_cost_tiles_show_em_dash_before_a_result()
    {
        var view = Project(result: null);

        Assert.Equal(3, view.CostStats.Count);
        Assert.False(view.HasResult);
        Assert.Equal("\u2014", view.CostStats[0].Value);
        Assert.Equal("\u2014", view.CostStats[1].Value);
        Assert.Equal("\u2014", view.CostStats[2].Value);
    }

    [Fact]
    public void Projection_cost_tiles_format_currency_after_a_result()
    {
        var view = Project(result: SampleResult());

        Assert.True(view.HasResult);
        Assert.Equal("$8.00", view.CostStats[0].Value);
        Assert.Equal("$3.33", view.CostStats[1].Value);
        Assert.Equal("$4.67", view.CostStats[2].Value);
        Assert.Contains("OFF_PEAK", view.CostStats[1].Sublabel, StringComparison.Ordinal);
        Assert.Contains("18.0", view.CostStats[1].Sublabel, StringComparison.Ordinal);
        Assert.Contains("58%", view.CostStats[2].Sublabel, StringComparison.Ordinal);
    }

    // ---- Projection: recommended schedule (GlassPanel6) ----------------------------

    [Fact]
    public void Projection_schedule_details_are_em_dash_before_a_result()
    {
        var view = Project(result: null);

        Assert.Equal(4, view.ScheduleDetails.Count);
        Assert.All(view.ScheduleDetails, d => Assert.Equal("\u2014", d.Value));
        Assert.Empty(view.AlternativeWindows);
        Assert.False(view.HasAlternatives);
    }

    [Fact]
    public void Projection_schedule_details_and_alternatives_after_a_result()
    {
        var view = Project(result: SampleResult());

        Assert.Equal("55%", view.ScheduleDetails[0].Value);
        Assert.Equal("80%", view.ScheduleDetails[1].Value);
        Assert.NotEqual("\u2014", view.ScheduleDetails[2].Value);
        Assert.NotEqual("\u2014", view.ScheduleDetails[3].Value);

        var alt = Assert.Single(view.AlternativeWindows);
        Assert.Equal("MID_PEAK", alt.Tier);
        Assert.Equal("$4.00", alt.Cost);
        Assert.Contains("\u2014", alt.Window, StringComparison.Ordinal);
    }

    // ---- Projection: rate timeline (GlassPanel2) -----------------------------------

    [Fact]
    public void Projection_rate_timeline_has_no_bars_before_a_result()
    {
        var view = Project(result: null);

        Assert.False(view.HasRateBars);
        Assert.Empty(view.RateBars);
        Assert.Equal(string.Empty, view.WindowInfoText);
    }

    [Fact]
    public void Projection_rate_timeline_builds_twenty_four_bars_and_window_info()
    {
        var view = Project(result: SampleResult());

        Assert.True(view.HasRateBars);
        Assert.Equal(24, view.RateBars.Count);
        Assert.All(view.RateBars, b => Assert.InRange(b.HeightFraction, 0.05, 1.0));
        Assert.Equal(StatusKind.Success, view.RateBars[0].Status);
        Assert.True(view.RateBars[0].ShowLabel);
        Assert.False(view.RateBars[1].ShowLabel);
        Assert.DoesNotContain("{{start}}", view.WindowInfoText, StringComparison.Ordinal);
        Assert.NotEqual(string.Empty, view.WindowInfoText);
    }

    // ---- Projection: plan history (GlassPanel7) ------------------------------------

    [Fact]
    public void Projection_history_columns_match_web_table()
    {
        var view = Project();

        Assert.Equal(6, view.HistoryColumns.Count);
        Assert.Equal("date", view.HistoryColumns[0].Key);
        Assert.Equal("cost", view.HistoryColumns[3].Key);
        Assert.True(view.HistoryColumns[3].IsNumeric);
        Assert.True(view.HistoryColumns[4].IsNumeric);
        Assert.False(view.HistoryColumns[5].IsNumeric);
    }

    [Fact]
    public void Projection_history_rows_format_cells_and_carry_status_color()
    {
        var view = Project(plans: SamplePlans());

        Assert.True(view.HasHistory);
        var row = Assert.Single(view.HistoryRows);
        Assert.Equal("PG&E EV2-A", row.Plan);
        Assert.Equal("$3.50", row.Cost);
        Assert.Equal("$4.20", row.Saved);
        Assert.Equal("scheduled", row.Status);
        Assert.Equal(StatusKind.Info, row.StatusKind);
        Assert.Contains("\u2014", row.Window, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_history_saved_is_em_dash_when_not_positive()
    {
        var plans = new[]
        {
            new ChargePlanRecord(2, 80, Now, Now, "SCE", null, 0, "completed", Now),
        };

        var row = Assert.Single(Project(plans: plans).HistoryRows);

        Assert.Equal("\u2014", row.Cost);
        Assert.Equal("\u2014", row.Saved);
    }

    // ---- View-model: history state machine -----------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        var vm = NewViewModel(plans: [RepositoryResult<IReadOnlyList<ChargePlanRecord>>.Loading()]);

        await vm.LoadAsync();

        Assert.Equal(SmartChargeState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_plans_render_ready_with_rows()
    {
        var vm = NewViewModel(plans: [RepositoryResult<IReadOnlyList<ChargePlanRecord>>.Loaded(SamplePlans(), Now)]);

        await vm.LoadAsync();

        Assert.Equal(SmartChargeState.Ready, vm.State);
        Assert.True(vm.Display.HasHistory);
        Assert.False(vm.IsError);
        Assert.Equal(Now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_plans_render_empty_state()
    {
        var vm = NewViewModel(plans: [RepositoryResult<IReadOnlyList<ChargePlanRecord>>.Empty(Now)]);

        await vm.LoadAsync();

        Assert.Equal(SmartChargeState.Empty, vm.State);
        Assert.False(vm.Display.HasHistory);
    }

    [Fact]
    public async Task ViewModel_failed_history_renders_error()
    {
        var vm = NewViewModel(plans: [RepositoryResult<IReadOnlyList<ChargePlanRecord>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))]);

        await vm.LoadAsync();

        Assert.Equal(SmartChargeState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
    }

    // ---- View-model: rate-plan options ---------------------------------------------

    [Fact]
    public async Task ViewModel_falls_back_to_default_rate_plans_when_none_returned()
    {
        var vm = NewViewModel(ratePlans: [RepositoryResult<IReadOnlyList<RatePlanOption>>.Empty(Now)]);

        await vm.LoadAsync();

        Assert.Equal(3, vm.RatePlanOptions.Count);
        Assert.Equal("pge-ev2a", vm.RatePlanOptions[0].Id);
    }

    [Fact]
    public async Task ViewModel_uses_backend_rate_plans_when_returned()
    {
        IReadOnlyList<RatePlanOption> backend = [new RatePlanOption("a", "Plan A", "Util")];
        var vm = NewViewModel(ratePlans: [RepositoryResult<IReadOnlyList<RatePlanOption>>.Loaded(backend, Now)]);

        await vm.LoadAsync();

        var only = Assert.Single(vm.RatePlanOptions);
        Assert.Equal("a", only.Id);
    }

    // ---- View-model: optimize flow -------------------------------------------------

    [Fact]
    public async Task ViewModel_optimize_requires_a_vehicle()
    {
        var vm = NewViewModel(vehicle: null);

        await vm.OptimizeAsync();

        Assert.False(vm.HasVehicle);
        Assert.False(vm.HasResult);
    }

    [Fact]
    public async Task ViewModel_optimize_success_populates_result_panels()
    {
        var vm = NewViewModel(optimize: new FakeOptimizeClient(SampleResult()), vehicle: new WidgetVehicleSnapshot { VehicleId = 5 });

        await vm.LoadAsync();
        Assert.True(vm.CanOptimize);

        await vm.OptimizeAsync();

        Assert.True(vm.HasResult);
        Assert.True(vm.Display.HasResult);
        Assert.False(vm.IsOptimizing);
        Assert.Null(vm.OptimizeErrorMessage);
        Assert.Equal("$8.00", vm.Display.CostStats[0].Value);
        Assert.True(vm.CanApply);
    }

    [Fact]
    public async Task ViewModel_optimize_failure_surfaces_error()
    {
        var vm = NewViewModel(optimize: new ThrowingOptimizeClient(), vehicle: new WidgetVehicleSnapshot { VehicleId = 5 });

        await vm.OptimizeAsync();

        Assert.False(vm.HasResult);
        Assert.False(vm.IsOptimizing);
        Assert.False(string.IsNullOrEmpty(vm.OptimizeErrorMessage));
    }

    // ---- View-model: apply flow ----------------------------------------------------

    [Fact]
    public async Task ViewModel_apply_success_sets_applied_chip()
    {
        var vm = NewViewModel(
            optimize: new FakeOptimizeClient(SampleResult()),
            apply: new FakeApplyClient(new ApplyScheduleResult("scheduled", 101, "ok")),
            vehicle: new WidgetVehicleSnapshot { VehicleId = 5 });

        await vm.OptimizeAsync();
        await vm.ApplyAsync();

        Assert.True(vm.Applied);
        Assert.False(vm.CanApply);
        Assert.Null(vm.ApplyErrorMessage);
    }

    [Fact]
    public async Task ViewModel_apply_failure_surfaces_error()
    {
        var vm = NewViewModel(
            optimize: new FakeOptimizeClient(SampleResult()),
            apply: new ThrowingApplyClient(),
            vehicle: new WidgetVehicleSnapshot { VehicleId = 5 });

        await vm.OptimizeAsync();
        await vm.ApplyAsync();

        Assert.False(vm.Applied);
        Assert.False(string.IsNullOrEmpty(vm.ApplyErrorMessage));
    }

    [Fact]
    public async Task ViewModel_apply_without_a_result_is_a_no_op()
    {
        var vm = NewViewModel(vehicle: new WidgetVehicleSnapshot { VehicleId = 5 });

        await vm.ApplyAsync();

        Assert.False(vm.Applied);
        Assert.Null(vm.ApplyErrorMessage);
    }

    [Fact]
    public void ViewModel_form_values_clamp_to_web_ranges()
    {
        var vm = NewViewModel();

        vm.TargetSoc = 5;
        Assert.Equal(20, vm.TargetSoc);
        vm.TargetSoc = 150;
        Assert.Equal(100, vm.TargetSoc);
        vm.MaxAmps = 2;
        Assert.Equal(8, vm.MaxAmps);
        vm.MaxAmps = 200;
        Assert.Equal(80, vm.MaxAmps);
    }

    [Fact]
    public void ViewModel_default_depart_is_tomorrow_morning()
    {
        var vm = NewViewModel();

        Assert.Equal(Now.AddDays(1).Date, vm.DepartBy.Date);
        Assert.Equal(7, vm.DepartBy.Hour);
        Assert.Equal(30, vm.DepartBy.Minute);
    }

    [Fact]
    public void ViewModel_records_view_opened()
    {
        var diagnostics = new SmartChargeDiagnostics();
        var vm = new SmartChargePageViewModel(
            EmptyRatePlansSource.Instance,
            EmptyChargePlansSource.Instance,
            NoopOptimizeChargeClient.Instance,
            NoopApplyScheduleClient.Instance,
            NoVehicleSource.Instance,
            Localizer,
            diagnostics: diagnostics);

        vm.NotifyOpened();

        Assert.Equal(1, diagnostics.ViewOpenedCount);
    }

    // ---- Sources -------------------------------------------------------------------

    [Fact]
    public async Task RatePlansSource_parses_loaded_options()
    {
        var api = new StubApiClient("""[{"id":"pge-ev2a","name":"PG&E EV2-A","utility":"PG&E"}]""");
        var source = new RatePlansClientSource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source.StreamAsync());

        var loaded = Assert.Single(results, r => r.Status == LoadStatus.Loaded);
        Assert.Single(loaded.Value!);
        Assert.Equal("get_api_v1_charge_planner_rate_plans", api.LastRequest!.OperationId);
    }

    [Fact]
    public async Task ChargePlansSource_sends_snake_case_vehicle_id_and_parses_rows()
    {
        var api = new StubApiClient("""[{"id":1,"status":"scheduled","scheduled_start":"2026-06-12T01:00:00Z","scheduled_end":"2026-06-12T05:00:00Z","rate_plan":"PG&E"}]""");
        var source = new ChargePlansClientSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source.StreamAsync());

        var loaded = Assert.Single(results, r => r.Status == LoadStatus.Loaded);
        Assert.Single(loaded.Value!);
        Assert.Equal("get_api_v1_charge_planner_history", api.LastRequest!.OperationId);
        Assert.Equal(7L, api.LastRequest.Query!["vehicle_id"]);
    }

    [Fact]
    public async Task ChargePlansSource_short_circuits_without_a_vehicle()
    {
        var api = new StubApiClient("[]");
        var source = new ChargePlansClientSource(new FakeVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Null(api.LastRequest);
    }

    [Fact]
    public async Task OptimizeClient_posts_snake_case_body_and_parses_result()
    {
        var api = new StubApiClient("""{"plan_id":101,"current_soc":55,"target_soc":80,"schedule":{"rate_tier":"OFF_PEAK"},"comparison":{"savings":4.67}}""");
        var client = new OptimizeChargeClient(api);

        var result = await client.OptimizeAsync(new OptimizeChargeRequestModel(7, 80, "2026-06-13T07:30:00Z", "pge-ev2a", 32, 75));

        Assert.Equal(101, result.PlanId);
        Assert.Equal("post_api_v1_charge_planner_optimize", api.LastRequest!.OperationId);
        var body = Assert.IsType<Dictionary<string, object?>>(api.LastRequest.Body);
        Assert.Equal(7L, body["vehicle_id"]);
        Assert.Equal(80, body["target_soc"]);
        Assert.Equal("2026-06-13T07:30:00Z", body["depart_by"]);
        Assert.Equal("pge-ev2a", body["rate_plan_id"]);
        Assert.Equal(32, body["max_amps"]);
        Assert.Equal(75.0, body["battery_capacity_kwh"]);
    }

    [Fact]
    public async Task ApplyClient_posts_plan_id_and_parses_result()
    {
        var api = new StubApiClient("""{"status":"scheduled","plan_id":101,"message":"ok"}""");
        var client = new ApplyScheduleClient(api);

        var result = await client.ApplyAsync(101);

        Assert.Equal("scheduled", result.Status);
        Assert.Equal("post_api_v1_charge_planner_apply", api.LastRequest!.OperationId);
        var body = Assert.IsType<Dictionary<string, object?>>(api.LastRequest.Body);
        Assert.Equal(101L, body["plan_id"]);
    }

    // ---- Registration --------------------------------------------------------------

    [Fact]
    public void Registration_exposes_route_name_and_localized_metadata()
    {
        Assert.Equal("SmartCharge", SmartChargeRegistration.RouteName);
        Assert.Equal("Smart Charge", SmartChargeRegistration.Title(Localizer));
        Assert.Equal("Optimize charging schedule for the cheapest TOU rates", SmartChargeRegistration.Subtitle(Localizer));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<T>>> Drain<T>(IAsyncEnumerable<RepositoryResult<T>> stream)
    {
        var list = new List<RepositoryResult<T>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private static SmartChargePageViewModel NewViewModel(
        RepositoryResult<IReadOnlyList<ChargePlanRecord>>[]? plans = null,
        RepositoryResult<IReadOnlyList<RatePlanOption>>[]? ratePlans = null,
        IOptimizeChargeClient? optimize = null,
        IApplyScheduleClient? apply = null,
        WidgetVehicleSnapshot? vehicle = null,
        ILocalizer? localizer = null) =>
        new(
            new FakeRatePlansSource(ratePlans ?? [RepositoryResult<IReadOnlyList<RatePlanOption>>.Empty(Now)]),
            new FakeChargePlansSource(plans ?? [RepositoryResult<IReadOnlyList<ChargePlanRecord>>.Empty(Now)]),
            optimize ?? new FakeOptimizeClient(SampleResult()),
            apply ?? new FakeApplyClient(new ApplyScheduleResult("scheduled", 1, "ok")),
            new FakeVehicleSource(vehicle),
            localizer ?? Localizer,
            clock: () => Now);

    private sealed class FakeRatePlansSource(params RepositoryResult<IReadOnlyList<RatePlanOption>>[] emissions) : IRatePlansSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<RatePlanOption>>> StreamAsync(
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

    private sealed class FakeChargePlansSource(params RepositoryResult<IReadOnlyList<ChargePlanRecord>>[] emissions) : IChargePlansSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ChargePlanRecord>>> StreamAsync(
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

    private sealed class FakeOptimizeClient(OptimizeChargeResult result) : IOptimizeChargeClient
    {
        public Task<OptimizeChargeResult> OptimizeAsync(OptimizeChargeRequestModel request, CancellationToken cancellationToken = default) =>
            Task.FromResult(result);
    }

    private sealed class ThrowingOptimizeClient : IOptimizeChargeClient
    {
        public Task<OptimizeChargeResult> OptimizeAsync(OptimizeChargeRequestModel request, CancellationToken cancellationToken = default) =>
            Task.FromException<OptimizeChargeResult>(new InvalidOperationException("optimize failed"));
    }

    private sealed class FakeApplyClient(ApplyScheduleResult result) : IApplyScheduleClient
    {
        public Task<ApplyScheduleResult> ApplyAsync(long planId, CancellationToken cancellationToken = default) =>
            Task.FromResult(result);
    }

    private sealed class ThrowingApplyClient : IApplyScheduleClient
    {
        public Task<ApplyScheduleResult> ApplyAsync(long planId, CancellationToken cancellationToken = default) =>
            Task.FromException<ApplyScheduleResult>(new InvalidOperationException("apply failed"));
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }

    private sealed class StubApiClient(string json) : IApiClient
    {
        private readonly JsonElement _element = JsonDocument.Parse(json).RootElement.Clone();

        public ApiRequest? LastRequest { get; private set; }

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            throw new NotSupportedException("The Smart Charge source tests never resolve endpoint descriptors directly.");

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            LastRequest = request;
            return Task.FromResult((T)(object)_element);
        }
    }
}
