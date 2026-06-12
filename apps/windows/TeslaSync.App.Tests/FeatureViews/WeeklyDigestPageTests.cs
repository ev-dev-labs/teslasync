using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Analytics;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>WeeklyDigestPage</c> surface's Microsoft.UI-free logic — the projection +
/// SI-aware aggregation (web/src/features/analytics/components/weekly-digest/useWeeklyDigest.ts and
/// WeeklyDigestPage.tsx), the tolerant row parsers, the view-model's data-state matrix (loading / empty / error /
/// ready) with vehicle selection and week navigation, and the generated-client feed's request shaping (web
/// <c>useVehicles</c> + the per-vehicle drives / charging / alerts reads). The WinUI view is exercised by the app
/// build; its per-region visibility is driven entirely by the <see cref="WeeklyDigestDisplay"/> flags asserted here.
/// </summary>
public sealed class WeeklyDigestPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // Wednesday 2026-06-10 → the active (offset 0) week is Monday 2026-06-08 .. Sunday 2026-06-14.
    private static readonly DateTimeOffset Now = new(2026, 6, 10, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset InWeek = new(2026, 6, 9, 10, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset InWeekEnd = new(2026, 6, 9, 11, 0, 0, TimeSpan.Zero);

    // The five i18n keys the manifest requires the page shell to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "analytics.weeklyDigest.noData",
        "analytics.weeklyDigest.noDataMessage",
        "analytics.weeklyDigest.selectVehicle",
        "analytics.weeklyDigest.subtitle",
        "analytics.weeklyDigest.title",
    ];

    private static WeeklyDigestModel ReadyModel() => new(
        Loading: false,
        HasError: false,
        ErrorDetail: null,
        Vehicles: [new WeeklyDigestVehicleOption("1", "Model 3"), new WeeklyDigestVehicleOption("2", "Model Y")],
        SelectedVehicleId: "1",
        WeekOffset: 0,
        Drives: [new DigestDriveRow(InWeek, 20000, 1800, 3000)],
        Charging: [new DigestChargeRow(InWeek, InWeekEnd, 10000, 5.5, 20, 80)],
        Alerts: [new DigestAlertRow("warning", InWeek)]);

    private static WeeklyDigestModel EmptyModel() => ReadyModel() with
    {
        Drives = Array.Empty<DigestDriveRow>(),
        Charging = Array.Empty<DigestChargeRow>(),
        Alerts = Array.Empty<DigestAlertRow>(),
    };

    private static WeeklyDigestSnapshot ReadySnapshot() => new(
        [new WeeklyDigestVehicleOption("1", "Model 3"), new WeeklyDigestVehicleOption("2", "Model Y")],
        "1",
        [new DigestDriveRow(InWeek, 20000, 1800, 3000)],
        [new DigestChargeRow(InWeek, InWeekEnd, 10000, 5.5, 20, 80)],
        [new DigestAlertRow("warning", InWeek)]);

    // ---- i18n key coverage (all five manifest strings) -----------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = WeeklyDigestProjection.Project(ReadyModel(), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        // Chrome strings are resolved on every projection regardless of data state (visibility is gated separately).
        _ = WeeklyDigestProjection.Project(WeeklyDigestModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Data states (loading / empty / error / ready) -----------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = WeeklyDigestProjection.Project(WeeklyDigestModel.Initial, Localizer, Now);

        Assert.Equal(WeeklyDigestState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_activity()
    {
        var display = WeeklyDigestProjection.Project(EmptyModel(), Localizer, Now);

        Assert.Equal(WeeklyDigestState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
        Assert.Equal("No Data", display.EmptyTitle);
        Assert.Equal("No driving or charging data found for this week.", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_query_failed_shows_retry()
    {
        var model = EmptyModel() with { HasError = true, ErrorDetail = "network down" };
        var display = WeeklyDigestProjection.Project(model, Localizer, Now);

        Assert.Equal(WeeklyDigestState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_ready_when_week_has_activity()
    {
        var display = WeeklyDigestProjection.Project(ReadyModel(), Localizer, Now);

        Assert.Equal(WeeklyDigestState.Ready, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    [Fact]
    public void Loading_precedence_beats_error_and_empty()
    {
        var model = WeeklyDigestModel.Initial with { HasError = true };
        Assert.Equal(WeeklyDigestState.Loading, WeeklyDigestProjection.Project(model, Localizer, Now).State);
    }

    // ---- Header + vehicle picker ---------------------------------------------------

    [Fact]
    public void Header_resolves_title_subtitle_and_vehicle_placeholder()
    {
        var display = WeeklyDigestProjection.Project(ReadyModel(), Localizer, Now);

        Assert.Equal("Weekly Digest", display.Title);
        Assert.Equal("Your driving and charging summary for the week", display.Subtitle);
        Assert.Equal("Select vehicle", display.SelectVehicleHint);
        Assert.True(display.HasVehicles);
        Assert.Equal(2, display.VehicleOptions.Count);
        Assert.Equal("1", display.SelectedVehicleId);
    }

    // ---- SI → display-unit aggregation (web useWeeklyDigest) ------------------------

    [Fact]
    public void Aggregation_converts_si_inputs_to_display_units()
    {
        var display = WeeklyDigestProjection.Project(ReadyModel(), Localizer, Now);

        // distance_m 20000 → 20 km; energy_used_wh 3000 → 3 kWh; efficiency 3000 / 20 = 150 Wh/km.
        Assert.Equal(20, display.WeekOverWeek.DistanceKm, 3);
        Assert.Equal(3, display.WeekOverWeek.EnergyKwh, 3);
        Assert.Equal(150, display.WeekOverWeek.EfficiencyWhKm, 3);
        Assert.Equal(1, display.WeekOverWeek.Drives, 3);

        // duration_s 1800 → 30 min.
        Assert.Equal(30, display.DrivingModel.TotalDurationMinutes, 3);
        Assert.Equal(1L, display.DrivingModel.TotalDrives);

        // charging: total_energy_added_wh 10000 → 10 kWh; 10 kWh over 1 h → 10 kW; soc 20→80.
        Assert.Equal(10, display.ChargingModel.ChargeEnergyAdded, 3);
        Assert.Equal(10, display.ChargingModel.AvgChargeRate, 3);
        Assert.Equal(1L, display.ChargingModel.ChargingSessionCount);
        Assert.Equal(5.5, display.ChargingModel.ChargingCost, 3);
        Assert.Equal(1L, display.AlertsModel.AlertTotal);
        Assert.Equal(1L, display.BatteryModel.ChargingSessionCount);
    }

    [Fact]
    public void HeroCards_include_fun_fact_when_distance_meets_threshold()
    {
        var display = WeeklyDigestProjection.Project(ReadyModel(), Localizer, Now);

        // Five core metrics + the fun fact (totalDistance 20 km ≥ 10 km threshold).
        Assert.Equal(6, display.HeroCards.Count);
        Assert.Equal("20.0 km", display.HeroCards[0].Value);
        Assert.Equal("Week Summary", display.WeekSummaryTitle);
    }

    [Fact]
    public void HeroCards_omit_fun_fact_below_threshold()
    {
        var model = ReadyModel() with { Drives = [new DigestDriveRow(InWeek, 2000, 600, 300)] };
        var display = WeeklyDigestProjection.Project(model, Localizer, Now);

        // 2 km < 10 km threshold → only the five core hero cards.
        Assert.Equal(5, display.HeroCards.Count);
    }

    [Fact]
    public void Week_filtering_excludes_other_weeks()
    {
        // The same drive viewed one week earlier (offset -1) falls outside the range → empty.
        var model = ReadyModel() with { WeekOffset = -1 };
        var display = WeeklyDigestProjection.Project(model, Localizer, Now);

        Assert.Equal(WeeklyDigestState.Empty, display.State);
    }

    [Fact]
    public void Week_label_reflects_offset_and_current_flag()
    {
        Assert.True(WeeklyDigestProjection.Project(ReadyModel(), Localizer, Now).IsCurrentWeek);
        Assert.False(WeeklyDigestProjection.Project(ReadyModel() with { WeekOffset = -1 }, Localizer, Now).IsCurrentWeek);
    }

    [Theory]
    [InlineData(100, 0, 100)]   // zero baseline, positive current → 100%
    [InlineData(0, 0, 0)]       // zero/zero → 0%
    [InlineData(150, 100, 50)]  // +50%
    [InlineData(50, 100, -50)]  // -50%
    public void PctChange_matches_web(double current, double previous, double expected) =>
        Assert.Equal(expected, WeeklyDigestProjection.PctChange(current, previous), 3);

    // ---- Tolerant row parsing ------------------------------------------------------

    [Fact]
    public void DriveRow_parses_si_fields_and_tolerates_gaps()
    {
        using var doc = JsonDocument.Parse(
            "{\"start_ts\":\"2026-06-09T10:00:00Z\",\"distance_m\":15000,\"duration_s\":900,\"energy_used_wh\":2200}");
        var drive = DigestDriveRow.FromJson(doc.RootElement);

        Assert.Equal(15, drive.DistanceKm, 3);
        Assert.Equal(15, drive.DurationMinutes, 3);
        Assert.Equal(2.2, drive.EnergyUsedKwh, 3);

        using var partial = JsonDocument.Parse("{\"distance_m\":1000}");
        var sparse = DigestDriveRow.FromJson(partial.RootElement);
        Assert.Equal(1, sparse.DistanceKm, 3);
        Assert.Equal(0, sparse.EnergyUsedWh, 3);
    }

    [Fact]
    public void ChargeRow_derives_duration_from_start_and_end()
    {
        using var doc = JsonDocument.Parse(
            "{\"started_at\":\"2026-06-09T10:00:00Z\",\"ended_at\":\"2026-06-09T10:30:00Z\"," +
            "\"total_energy_added_wh\":5000,\"cost_decimal\":2.5,\"start_soc_pct\":40,\"end_soc_pct\":70}");
        var charge = DigestChargeRow.FromJson(doc.RootElement);

        Assert.Equal(5, charge.EnergyAddedKwh, 3);
        Assert.Equal(30, charge.DurationMinutes, 3);
        Assert.Equal(2.5, charge.CostDecimal, 3);
        Assert.Equal(40, charge.StartSocPct, 3);
        Assert.Equal(70, charge.EndSocPct, 3);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_activity_into_the_ready_state()
    {
        using var vm = new WeeklyDigestPageViewModel(new FakeFeed(ReadySnapshot()), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(WeeklyDigestState.Ready, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_empty_state()
    {
        using var vm = new WeeklyDigestPageViewModel(EmptyWeeklyDigestFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(WeeklyDigestState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new WeeklyDigestPageViewModel(new ThrowingFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(WeeklyDigestState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.Contains("Failed to load data", vm.Display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeFeed(ReadySnapshot());
        using var vm = new WeeklyDigestPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    [Fact]
    public async Task ViewModel_select_vehicle_refetches_for_the_new_vehicle()
    {
        var feed = new FakeFeed(ReadySnapshot());
        using var vm = new WeeklyDigestPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.SelectVehicleAsync("2");

        Assert.Equal(2, feed.FetchCount);
        Assert.Equal("2", feed.LastRequested);
    }

    [Fact]
    public async Task ViewModel_week_navigation_reprojects_without_refetching()
    {
        var feed = new FakeFeed(ReadySnapshot());
        using var vm = new WeeklyDigestPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        Assert.Equal(WeeklyDigestState.Ready, vm.State);

        vm.PreviousWeek(); // the prior week has no activity → empty, no extra fetch
        Assert.Equal(-1, vm.WeekOffset);
        Assert.Equal(WeeklyDigestState.Empty, vm.State);

        vm.NextWeek(); // back to the current week → ready again
        Assert.Equal(0, vm.WeekOffset);
        Assert.Equal(WeeklyDigestState.Ready, vm.State);

        vm.NextWeek(); // capped at the current week (web goToNextWeek guard)
        Assert.Equal(0, vm.WeekOffset);

        Assert.Equal(1, feed.FetchCount);
    }

    // ---- Generated-client feed (web useWeeklyDigest) -------------------------------

    [Fact]
    public async Task ClientFeed_reads_vehicles_then_the_selected_vehicle_data_in_order()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":1,\"display_name\":\"Model 3\",\"vin\":\"V1\"}]"));
        api.ReturnsValue(Json("[{\"start_ts\":\"2026-06-09T10:00:00Z\",\"distance_m\":20000,\"duration_s\":1800,\"energy_used_wh\":3000}]"));
        api.ReturnsValue(Json("[{\"started_at\":\"2026-06-09T10:00:00Z\",\"ended_at\":\"2026-06-09T11:00:00Z\",\"total_energy_added_wh\":10000,\"cost_decimal\":5.5,\"start_soc_pct\":20,\"end_soc_pct\":80}]"));
        api.ReturnsValue(Json("[{\"severity\":\"warning\",\"created_at\":\"2026-06-09T09:00:00Z\"}]"));
        var feed = new WeeklyDigestClientFeed(api);

        var snapshot = await feed.FetchAsync(null, default);

        Assert.Equal("1", snapshot.SelectedVehicleId);
        Assert.Equal("Model 3", Assert.Single(snapshot.Vehicles).Label);
        Assert.Single(snapshot.Drives);
        Assert.Single(snapshot.Charging);
        Assert.Single(snapshot.Alerts);

        Assert.Equal(4, api.Requests.Count);
        Assert.Equal("get_api_v1_vehicles", api.Requests[0].OperationId);
        Assert.Equal("get_api_v1_drives", api.Requests[1].OperationId);
        Assert.Equal(1L, api.Requests[1].Query!["vehicle_id"]);
        Assert.Equal("get_api_v1_charging_sessions", api.Requests[2].OperationId);
        Assert.Equal("get_api_v1_alerts", api.Requests[3].OperationId);
    }

    [Fact]
    public async Task ClientFeed_with_no_vehicles_short_circuits_to_empty()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[]"));
        var feed = new WeeklyDigestClientFeed(api);

        var snapshot = await feed.FetchAsync(null, default);

        Assert.Empty(snapshot.Vehicles);
        Assert.Equal(string.Empty, snapshot.SelectedVehicleId);
        Assert.Empty(snapshot.Drives);
        Assert.Single(api.Requests); // only the vehicle read; the per-vehicle queries are skipped
    }

    [Fact]
    public async Task ClientFeed_labels_vehicle_by_vin_when_display_name_missing()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":7,\"vin\":\"5YJ\"}]"));
        api.ReturnsValue(Json("[]"));
        api.ReturnsValue(Json("[]"));
        api.ReturnsValue(Json("[]"));
        var feed = new WeeklyDigestClientFeed(api);

        var snapshot = await feed.FetchAsync(null, default);

        Assert.Equal("5YJ", Assert.Single(snapshot.Vehicles).Label);
        Assert.Equal("7", snapshot.SelectedVehicleId);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new WeeklyDigestDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WeeklyDigestPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("WeeklyDigest", WeeklyDigestRegistration.RouteName);
        Assert.Equal("get_api_v1_vehicles", WeeklyDigestRegistration.VehiclesOperation);
        Assert.Equal("get_api_v1_drives", WeeklyDigestRegistration.DrivesOperation);
        Assert.Equal("get_api_v1_charging_sessions", WeeklyDigestRegistration.ChargingOperation);
        Assert.Equal("get_api_v1_alerts", WeeklyDigestRegistration.AlertsOperation);
        Assert.Equal("Weekly Digest", WeeklyDigestRegistration.Title(Localizer));
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeFeed : IWeeklyDigestFeed
    {
        private readonly WeeklyDigestSnapshot _snapshot;

        public FakeFeed(WeeklyDigestSnapshot snapshot) => _snapshot = snapshot;

        public int FetchCount { get; private set; }

        public string? LastRequested { get; private set; }

        public Task<WeeklyDigestSnapshot> FetchAsync(string? requestedVehicleId, CancellationToken cancellationToken)
        {
            FetchCount++;
            LastRequested = requestedVehicleId;
            return Task.FromResult(_snapshot);
        }
    }

    private sealed class ThrowingFeed : IWeeklyDigestFeed
    {
        public Task<WeeklyDigestSnapshot> FetchAsync(string? requestedVehicleId, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");
    }
}
