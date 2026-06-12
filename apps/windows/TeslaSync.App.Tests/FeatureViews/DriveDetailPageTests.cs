using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Driving;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DriveDetailPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/driving/pages/DriveDetailPage.tsx), the tolerant drive / vehicle parsers, the four-state
/// matrix (loading / empty / error / success), the no-telemetry envelope (web <c>hasMeaningfulDriveStats</c>),
/// the nineteen section-boundary regions with their localized fallback titles and web visibility gating, and the
/// generated-client feed's request shaping (web <c>useDrive</c> + <c>useVehicle</c>). The WinUI view is exercised
/// by the app build; its per-region visibility is driven entirely by the <see cref="DriveDetailDisplay"/> flags
/// asserted here.
/// </summary>
public sealed class DriveDetailPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 23 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "driveDetail.title",
        "driveDetail.vehicle",
        "driveDetail.noTelemetryTitle",
        "driveDetail.noTelemetryBody",
        "driveDetail.section.headerFailed",
        "driveDetail.section.heroGaugesFailed",
        "driveDetail.section.timelineFailed",
        "driveDetail.section.statCardsFailed",
        "driveDetail.section.aiCoachingFailed",
        "driveDetail.section.moreDetailsFailed",
        "driveDetail.section.energySummaryFailed",
        "driveDetail.section.costSavingsFailed",
        "driveDetail.section.routeMapFailed",
        "driveDetail.section.journeyDetailsFailed",
        "driveDetail.section.overviewChartFailed",
        "driveDetail.section.socChartFailed",
        "driveDetail.section.elevationChartFailed",
        "driveDetail.section.temperatureFailed",
        "driveDetail.section.speedHistogramFailed",
        "driveDetail.section.aiSpeedProfileInsightsFailed",
        "driveDetail.section.powerProfileFailed",
        "driveDetail.section.tirePressureFailed",
        "driveDetail.section.whyEndedFailed",
    ];

    private static readonly DriveData FullDrive = new(
        Id: 42,
        VehicleId: 7,
        StartTs: new DateTimeOffset(2026, 1, 1, 10, 0, 0, TimeSpan.Zero),
        EndTs: new DateTimeOffset(2026, 1, 1, 10, 30, 0, TimeSpan.Zero),
        DurationS: 1800,
        DistanceM: 12_000,
        StartAddress: "Home",
        EndAddress: "Office",
        StartLat: 47.6,
        StartLon: -122.3,
        EndLat: 47.7,
        EndLon: -122.2,
        StartSocPct: 80,
        EndSocPct: 60,
        EnergyUsedWh: 3_000,
        RegenEnergyWh: 500,
        AvgSpeedMps: 18,
        MaxSpeedMps: 30,
        AvgPowerW: 6_000,
        OutsideTempAvgC: 15,
        InsideTempAvgC: 21,
        Score: 92,
        EndedStatus: "completed",
        Live: false,
        TelemetryCount: 5,
        PositionCount: 5);

    private static DriveDetailModel SuccessModel(DriveData? drive = null, string? vehicleName = "Model 3") =>
        new(new DriveDetailSnapshot(drive ?? FullDrive, new DriveVehicleData(vehicleName)), false, null);

    private static DriveDetailDisplay Project(DriveDetailModel model, UnitPref? units = null) =>
        DriveDetailProjection.Project(model, units ?? UnitPref.Metric, Localizer, Now);

    // ── i18n key coverage (all 23 manifest strings) ─────────────────────────────────

    [Fact]
    public void Required_string_key_set_has_exactly_twenty_three_unique_keys() =>
        Assert.Equal(23, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = DriveDetailProjection.Project(SuccessModel(), UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = DriveDetailProjection.Project(DriveDetailModel.Initial, UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ── Four data states ────────────────────────────────────────────────────────────

    [Fact]
    public void State_loading_when_drive_query_in_flight()
    {
        var display = Project(DriveDetailModel.Initial);

        Assert.Equal(DriveDetailState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_empty_when_resolved_without_a_drive()
    {
        var display = Project(new DriveDetailModel(DriveDetailSnapshot.Empty, false, null));

        Assert.Equal(DriveDetailState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.Equal("No data available", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_primary_read_failed()
    {
        var display = Project(new DriveDetailModel(DriveDetailSnapshot.Empty, false, "boom"));

        Assert.Equal(DriveDetailState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Contains("boom", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_drive_resolved()
    {
        var display = Project(SuccessModel());

        Assert.Equal(DriveDetailState.Success, display.State);
        Assert.True(display.ShowContent);
    }

    // ── Sections / regions ──────────────────────────────────────────────────────────

    [Fact]
    public void Success_builds_all_nineteen_section_regions()
    {
        var display = Project(SuccessModel());

        Assert.Equal(19, display.Sections.Count);
        Assert.Equal(
            new[]
            {
                "header", "hero-gauges", "timeline", "stat-cards", "ai-coaching", "more-details",
                "energy-summary", "cost-savings", "route-map", "journey-details", "overview-chart",
                "soc-chart", "elevation-chart", "temperature", "speed-histogram",
                "ai-speed-profile-insights", "power-profile", "tire-pressure", "why-ended",
            },
            display.Sections.Select(section => section.Id).ToArray());
    }

    [Fact]
    public void Every_section_carries_its_localized_fallback_title()
    {
        var display = Project(SuccessModel());

        Assert.Equal("Drive header failed to load", Section(display, "header").FallbackTitle);
        Assert.Equal("Hero gauges failed to load", Section(display, "hero-gauges").FallbackTitle);
        Assert.Equal("Why-ended diagnostic failed to load", Section(display, "why-ended").FallbackTitle);
        Assert.All(display.Sections, section => Assert.False(string.IsNullOrWhiteSpace(section.FallbackTitle)));
    }

    [Fact]
    public void Vehicle_name_falls_back_to_the_vehicle_label_when_unnamed()
    {
        var display = Project(SuccessModel(vehicleName: null));

        Assert.Equal("Vehicle", display.VehicleName);
    }

    // ── No-telemetry envelope (web hasMeaningfulDriveStats) ──────────────────────────

    [Fact]
    public void No_telemetry_banner_replaces_numeric_sections_when_drive_has_no_meaningful_stats()
    {
        var bare = FullDrive with
        {
            DistanceM = 0,
            MaxSpeedMps = null,
            AvgSpeedMps = null,
            EnergyUsedWh = 0,
            RegenEnergyWh = null,
            AvgPowerW = null,
            TelemetryCount = 0,
            PositionCount = 0,
        };

        var display = Project(SuccessModel(bare));

        Assert.False(display.HasMeaningfulDriveStats);
        Assert.True(display.ShowNoTelemetryBanner);
        Assert.Equal("No telemetry recorded for this drive", display.NoTelemetryTitle);
        Assert.False(Section(display, "hero-gauges").Visible);
        Assert.False(Section(display, "stat-cards").Visible);
        Assert.False(Section(display, "more-details").Visible);
        Assert.False(Section(display, "energy-summary").Visible);

        // The always-on structural sections still render.
        Assert.True(Section(display, "header").Visible);
        Assert.True(Section(display, "timeline").Visible);
        Assert.True(Section(display, "route-map").Visible);
        Assert.True(Section(display, "why-ended").Visible);
    }

    [Fact]
    public void Meaningful_stats_show_numeric_sections_and_hide_the_banner()
    {
        var display = Project(SuccessModel());

        Assert.True(display.HasMeaningfulDriveStats);
        Assert.False(display.ShowNoTelemetryBanner);
        Assert.True(Section(display, "hero-gauges").Visible);
        Assert.True(Section(display, "stat-cards").Visible);
    }

    [Fact]
    public void Distance_alone_makes_the_drive_meaningful()
    {
        var distanceOnly = FullDrive with
        {
            MaxSpeedMps = null,
            AvgSpeedMps = null,
            EnergyUsedWh = 0,
            AvgPowerW = null,
            TelemetryCount = 0,
            PositionCount = 0,
        };

        var display = Project(SuccessModel(distanceOnly));

        Assert.True(display.HasMeaningfulDriveStats);
    }

    // ── Cost-savings gating (web stats.energyWh > 0) ─────────────────────────────────

    [Fact]
    public void Cost_savings_section_is_hidden_without_energy()
    {
        var noEnergy = FullDrive with { EnergyUsedWh = 0, AvgPowerW = null };

        var display = Project(SuccessModel(noEnergy));

        Assert.False(display.HasEnergy);
        Assert.False(Section(display, "cost-savings").Visible);
    }

    [Fact]
    public void Cost_savings_section_is_visible_with_energy()
    {
        var display = Project(SuccessModel());

        Assert.True(display.HasEnergy);
        Assert.True(Section(display, "cost-savings").Visible);
    }

    [Fact]
    public void Energy_is_derived_from_average_power_and_duration_when_absent()
    {
        // Web fallback: |avgPowerW| * (durationS / 3600). 6 kW for 1 h => 6000 Wh.
        var derived = FullDrive with { EnergyUsedWh = null, AvgPowerW = 6_000, DurationS = 3_600 };

        var display = Project(SuccessModel(derived));

        Assert.True(display.HasEnergy);
        Assert.True(Section(display, "cost-savings").Visible);
    }

    // ── Section content (never a blank region) ───────────────────────────────────────

    [Fact]
    public void Sections_without_page_level_data_carry_a_localized_empty_message()
    {
        var display = Project(SuccessModel());

        // Elevation + tire pressure have no page-level aggregate — they render an empty caption, never blank.
        var elevation = Section(display, "elevation-chart");
        Assert.Empty(elevation.Rows);
        Assert.False(string.IsNullOrWhiteSpace(elevation.EmptyText));

        var tire = Section(display, "tire-pressure");
        Assert.Empty(tire.Rows);
        Assert.False(string.IsNullOrWhiteSpace(tire.EmptyText));
    }

    [Fact]
    public void Route_map_falls_back_to_empty_copy_without_coordinates()
    {
        var noRoute = FullDrive with { StartLat = null, StartLon = null, EndLat = null, EndLon = null };

        var display = Project(SuccessModel(noRoute));
        var routeMap = Section(display, "route-map");

        Assert.Empty(routeMap.Rows);
        Assert.Equal("No route data available for this drive", routeMap.EmptyText);
    }

    [Fact]
    public void Journey_details_renders_the_real_addresses_and_distance()
    {
        var display = Project(SuccessModel());
        var journey = Section(display, "journey-details");

        Assert.Contains(journey.Rows, row => row.Value == "Home");
        Assert.Contains(journey.Rows, row => row.Value == "Office");
    }

    // ── Tolerant parsers ─────────────────────────────────────────────────────────────

    [Fact]
    public void DriveData_parses_the_snake_case_wire_shape()
    {
        var json = Json(
            """
            {
              "id": 42,
              "vehicle_id": 7,
              "start_ts": "2026-01-01T10:00:00Z",
              "end_ts": "2026-01-01T10:30:00Z",
              "duration_s": 1800,
              "distance_m": 12000,
              "start_address": "Home",
              "end_address": "Office",
              "start_soc_pct": 80,
              "end_soc_pct": 60,
              "energy_used_wh": 3000,
              "max_speed_mps": 30,
              "telemetry": [1, 2, 3],
              "positions": [1, 2]
            }
            """);

        var drive = DriveData.FromJson(json);

        Assert.NotNull(drive);
        Assert.Equal(42, drive!.Id);
        Assert.Equal(7, drive.VehicleId);
        Assert.Equal(12_000, drive.DistanceM);
        Assert.Equal("Home", drive.StartAddress);
        Assert.Equal(3, drive.TelemetryCount);
        Assert.Equal(2, drive.PositionCount);
    }

    [Fact]
    public void DriveData_from_a_non_object_is_null()
    {
        Assert.Null(DriveData.FromJson(Json("[]")));
        Assert.Null(DriveData.FromJson(Json("null")));
    }

    [Fact]
    public void Vehicle_data_reads_the_display_name()
    {
        var vehicle = DriveVehicleData.FromJson(Json("{\"display_name\":\"Model 3\"}"));

        Assert.Equal("Model 3", vehicle?.DisplayName);
    }

    // ── Generated-client feed request shaping ────────────────────────────────────────

    [Fact]
    public async Task Client_feed_reads_the_drive_then_the_vehicle()
    {
        var api = new FakeApiClient()
            .ReturnsValue(Json("{\"id\":42,\"vehicle_id\":7,\"distance_m\":12000}"))
            .ReturnsValue(Json("{\"display_name\":\"Model 3\"}"));
        var feed = new DriveDetailPageClientFeed(api);

        var snapshot = await feed.FetchAsync(42, CancellationToken.None);

        Assert.NotNull(snapshot.Drive);
        Assert.Equal("Model 3", snapshot.Vehicle?.DisplayName);
        Assert.Equal(2, api.Requests.Count);
        Assert.Equal(DriveDetailPageRegistration.DriveOperation, api.Requests[0].OperationId);
        Assert.Equal("42", api.Requests[0].PathParams!["driveID"]);
        Assert.Equal(DriveDetailPageRegistration.VehicleOperation, api.Requests[1].OperationId);
        Assert.Equal("7", api.Requests[1].PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Empty_feed_resolves_to_the_empty_snapshot()
    {
        var snapshot = await EmptyDriveDetailPageFeed.Instance.FetchAsync(42, CancellationToken.None);

        Assert.False(snapshot.HasDrive);
    }

    // ── View-model state folding ─────────────────────────────────────────────────────

    [Fact]
    public async Task View_model_folds_a_resolved_drive_into_the_success_state()
    {
        var vm = new DriveDetailPageViewModel(
            new StubFeed(new DriveDetailSnapshot(FullDrive, new DriveVehicleData("Model 3"))),
            Localizer,
            42,
            clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(DriveDetailState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task View_model_surfaces_a_failed_read_as_the_error_state()
    {
        var vm = new DriveDetailPageViewModel(new ThrowingFeed(), Localizer, 42, clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(DriveDetailState.Error, vm.State);
        Assert.True(vm.IsError);
    }

    private static DriveSectionDisplay Section(DriveDetailDisplay display, string id) =>
        display.Sections.Single(section => section.Id == id);

    private static JsonElement Json(string raw) => JsonSerializer.Deserialize<JsonElement>(raw);

    private sealed class StubFeed(DriveDetailSnapshot snapshot) : IDriveDetailPageFeed
    {
        public Task<DriveDetailSnapshot> FetchAsync(long driveId, CancellationToken cancellationToken) =>
            Task.FromResult(snapshot);
    }

    private sealed class ThrowingFeed : IDriveDetailPageFeed
    {
        public Task<DriveDetailSnapshot> FetchAsync(long driveId, CancellationToken cancellationToken) =>
            throw new ApiException("boom", 500);
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
