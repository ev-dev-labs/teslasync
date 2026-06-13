using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Trips;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TripDetailPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/trips/pages/TripDetailPage.tsx), the tolerant trip parser, the four-state matrix
/// (loading / empty / error / success), the four headline stat cards + six detail rows, the SI distance /
/// efficiency formatting and the currency formatting at the display boundary, and the generated-client feed's
/// request shaping (web <c>useTrip GET /trips/{id}</c>). The WinUI view is exercised by the app build; its
/// per-region visibility is driven entirely by the <see cref="TripDetailDisplay"/> flags asserted here.
/// </summary>
public sealed class TripDetailPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 12 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "trips.detail.charges",
        "trips.detail.cost",
        "trips.detail.distance",
        "trips.detail.drives",
        "trips.detail.efficiency",
        "trips.detail.ended",
        "trips.detail.energy",
        "trips.detail.name",
        "trips.detail.notFound",
        "trips.detail.started",
        "trips.detail.title",
        "trips.detail.tripId",
    ];

    private static TripData Trip(
        long id = 42,
        string? name = "Office Run",
        DateTimeOffset? startDate = null,
        DateTimeOffset? endDate = null,
        double totalDistanceM = 12_000,
        double totalEnergyWh = 3_000,
        double totalDurationS = 1_800,
        double totalCost = 4.5,
        long driveCount = 3,
        long chargeCount = 1) =>
        new(
            Id: id,
            VehicleId: 7,
            Name: name,
            StartDate: startDate ?? new DateTimeOffset(2026, 1, 1, 10, 0, 0, TimeSpan.Zero),
            EndDate: endDate ?? new DateTimeOffset(2026, 1, 1, 11, 0, 0, TimeSpan.Zero),
            TotalDistanceM: totalDistanceM,
            TotalEnergyWh: totalEnergyWh,
            TotalDurationS: totalDurationS,
            TotalCost: totalCost,
            DriveCount: driveCount,
            ChargeCount: chargeCount);

    private static TripDetailModel SuccessModel(TripData? trip = null) =>
        new(new TripDetailSnapshot(trip ?? Trip()), false, null);

    private static TripDetailDisplay Project(TripDetailModel model, UnitPref? units = null) =>
        TripDetailProjection.Project(model, units ?? UnitPref.Metric, Localizer, Now, "$");

    // ---- i18n key coverage (all 12 manifest strings) -------------------------------

    [Fact]
    public void Required_string_key_set_has_exactly_twelve_unique_keys() =>
        Assert.Equal(12, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = TripDetailProjection.Project(SuccessModel(), UnitPref.Metric, recorder, Now, "$");

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = TripDetailProjection.Project(TripDetailModel.Initial, UnitPref.Metric, recorder, Now, "$");

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_trip_query_in_flight()
    {
        var display = Project(TripDetailModel.Initial);

        Assert.Equal(TripDetailState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_empty_when_resolved_without_a_trip()
    {
        var display = Project(new TripDetailModel(TripDetailSnapshot.Empty, false, null));

        Assert.Equal(TripDetailState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.Equal("Trip not found", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_read_failed()
    {
        var display = Project(new TripDetailModel(TripDetailSnapshot.Empty, false, "boom"));

        Assert.Equal(TripDetailState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Contains("boom", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_trip_resolved()
    {
        var display = Project(SuccessModel());

        Assert.Equal(TripDetailState.Success, display.State);
        Assert.True(display.ShowContent);
    }

    // ---- Panels (four stat cards + detail rows) ------------------------------------

    [Fact]
    public void Success_renders_four_stat_cards_in_web_order()
    {
        var display = Project(SuccessModel());

        Assert.Equal(4, display.StatCards.Count);
        Assert.Equal("Distance", display.StatCards[0].Label);
        Assert.Equal("Energy Used", display.StatCards[1].Label);
        Assert.Equal("Efficiency", display.StatCards[2].Label);
        Assert.Equal("Cost", display.StatCards[3].Label);
    }

    [Fact]
    public void Success_renders_six_detail_rows_in_web_order()
    {
        var display = Project(SuccessModel());

        Assert.Equal(6, display.DetailRows.Count);
        Assert.Equal("Trip ID", display.DetailRows[0].Label);
        Assert.Equal("42", display.DetailRows[0].Value);
        Assert.Equal("Name", display.DetailRows[1].Label);
        Assert.Equal("Office Run", display.DetailRows[1].Value);
        Assert.Equal("Started", display.DetailRows[2].Label);
        Assert.Equal("Ended", display.DetailRows[3].Label);
        Assert.Equal("Drives", display.DetailRows[4].Label);
        Assert.Equal("3", display.DetailRows[4].Value);
        Assert.Equal("Charges", display.DetailRows[5].Label);
        Assert.Equal("1", display.DetailRows[5].Value);
    }

    [Fact]
    public void Loading_and_empty_states_render_no_panels()
    {
        var loading = Project(TripDetailModel.Initial);
        var empty = Project(new TripDetailModel(TripDetailSnapshot.Empty, false, null));

        Assert.Empty(loading.StatCards);
        Assert.Empty(loading.DetailRows);
        Assert.Empty(empty.StatCards);
        Assert.Empty(empty.DetailRows);
    }

    // ---- Derived formatting (web helpers at the SI boundary) -----------------------

    [Fact]
    public void Metric_distance_card_converts_meters_to_kilometers()
    {
        var display = Project(SuccessModel(Trip(totalDistanceM: 12_000)));

        Assert.Equal("12 km", display.StatCards[0].Value);
    }

    [Fact]
    public void Imperial_distance_card_converts_meters_to_miles()
    {
        var display = Project(SuccessModel(Trip(totalDistanceM: 16_093.44)), UnitPref.Imperial);

        Assert.Equal("10 mi", display.StatCards[0].Value);
    }

    [Fact]
    public void Energy_card_formats_watt_hours_at_global_precision()
    {
        var display = Project(SuccessModel(Trip(totalEnergyWh: 3_000)));

        Assert.Equal("3,000.00 Wh", display.StatCards[1].Value);
    }

    [Fact]
    public void Metric_efficiency_is_wh_per_km()
    {
        // 3000 Wh / 12 km = 250 Wh/km
        var display = Project(SuccessModel(Trip(totalDistanceM: 12_000, totalEnergyWh: 3_000)));

        Assert.Equal("250 Wh/km", display.StatCards[2].Value);
    }

    [Fact]
    public void Imperial_efficiency_scales_wh_per_km_by_km_per_mile()
    {
        // 250 Wh/km * 1.609344 = 402.336 -> 402 Wh/mi
        var display = Project(SuccessModel(Trip(totalDistanceM: 12_000, totalEnergyWh: 3_000)), UnitPref.Imperial);

        Assert.Equal("402 Wh/mi", display.StatCards[2].Value);
    }

    [Fact]
    public void Efficiency_is_zero_when_distance_is_zero()
    {
        var display = Project(SuccessModel(Trip(totalDistanceM: 0, totalEnergyWh: 3_000)));

        Assert.Equal("0 Wh/km", display.StatCards[2].Value);
    }

    [Fact]
    public void Cost_card_prefixes_the_currency_symbol()
    {
        var display = Project(SuccessModel(Trip(totalCost: 4.5)));

        Assert.Equal("$4.50", display.StatCards[3].Value);
    }

    [Fact]
    public void Subtitle_is_the_trip_name_when_present()
    {
        var display = Project(SuccessModel(Trip(name: "Weekend Getaway")));

        Assert.Equal("Weekend Getaway", display.Subtitle);
        Assert.True(display.ShowSubtitle);
    }

    [Fact]
    public void Subtitle_falls_back_to_trip_number_when_unnamed()
    {
        var display = Project(SuccessModel(Trip(id: 77, name: null)));

        Assert.Equal("Trip #77", display.Subtitle);
    }

    [Fact]
    public void Unnamed_trip_renders_dash_in_the_name_row()
    {
        var display = Project(SuccessModel(Trip(name: null)));

        Assert.Equal("\u2014", display.DetailRows[1].Value);
    }

    [Fact]
    public void Open_ended_trip_renders_dash_for_the_ended_row()
    {
        var trip = Trip(name: "Live trip") with { EndDate = null };
        var display = Project(SuccessModel(trip));

        Assert.Equal("\u2014", display.DetailRows[3].Value);
        Assert.NotEqual("\u2014", display.DetailRows[2].Value);
    }

    // ---- Tolerant parser -----------------------------------------------------------

    [Fact]
    public void Parser_reads_the_snake_case_wire_shape()
    {
        var trip = TripData.FromJson(Json(
            "{\"id\":42,\"vehicle_id\":7,\"name\":\"Office Run\",\"start_date\":\"2026-01-01T10:00:00Z\"," +
            "\"end_date\":\"2026-01-01T11:00:00Z\",\"total_distance_m\":12000,\"total_energy_wh\":3000," +
            "\"total_duration_s\":1800,\"total_cost\":4.5,\"drive_count\":3,\"charge_count\":1}"));

        Assert.NotNull(trip);
        Assert.Equal(42, trip!.Id);
        Assert.Equal("Office Run", trip.Name);
        Assert.Equal(12_000, trip.TotalDistanceM);
        Assert.Equal(3, trip.DriveCount);
        Assert.Equal(1, trip.ChargeCount);
    }

    [Fact]
    public void Parser_returns_null_for_a_non_object_body()
    {
        Assert.Null(TripData.FromJson(Json("[]")));
        Assert.Null(TripData.FromJson(Json("null")));
    }

    // ---- Generated-client feed request shaping -------------------------------------

    [Fact]
    public async Task Client_feed_reads_the_trip_by_id()
    {
        var api = new FakeApiClient()
            .ReturnsValue(Json("{\"id\":42,\"vehicle_id\":7,\"total_distance_m\":12000}"));
        var feed = new TripDetailPageClientFeed(api);

        var snapshot = await feed.FetchAsync(42, CancellationToken.None);

        Assert.NotNull(snapshot.Trip);
        Assert.Single(api.Requests);
        Assert.Equal(TripDetailPageRegistration.DetailOperation, api.Requests[0].OperationId);
        Assert.Equal("42", api.Requests[0].PathParams!["trip_id"]);
    }

    [Fact]
    public async Task Client_feed_propagates_the_primary_read_failure()
    {
        // The web useTrip hook is 404-bound on the current Go router; the feed surfaces that as the error branch.
        var api = new FakeApiClient().Throws(new ApiException("not found", 404));
        var feed = new TripDetailPageClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(42, CancellationToken.None));
    }

    [Fact]
    public async Task Empty_feed_resolves_to_the_empty_snapshot()
    {
        var snapshot = await EmptyTripDetailPageFeed.Instance.FetchAsync(42, CancellationToken.None);

        Assert.False(snapshot.HasTrip);
    }

    // ---- View-model state folding --------------------------------------------------

    [Fact]
    public async Task View_model_folds_a_resolved_trip_into_the_success_state()
    {
        var vm = new TripDetailPageViewModel(new StubFeed(new TripDetailSnapshot(Trip())), Localizer, 42, clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(TripDetailState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task View_model_surfaces_a_failed_read_as_the_error_state()
    {
        var vm = new TripDetailPageViewModel(new ThrowingFeed(), Localizer, 42, clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(TripDetailState.Error, vm.State);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task View_model_folds_a_missing_trip_into_the_empty_state()
    {
        var vm = new TripDetailPageViewModel(new StubFeed(TripDetailSnapshot.Empty), Localizer, 42, clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(TripDetailState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public void Diagnostics_records_view_opened_without_pii()
    {
        var lines = new List<string>();
        var diagnostics = new TripDetailPageDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TripDetailPage", Assert.Single(lines));
    }

    private static JsonElement Json(string raw) => JsonSerializer.Deserialize<JsonElement>(raw);

    private sealed class StubFeed(TripDetailSnapshot snapshot) : ITripDetailPageFeed
    {
        public Task<TripDetailSnapshot> FetchAsync(long tripId, CancellationToken cancellationToken) =>
            Task.FromResult(snapshot);
    }

    private sealed class ThrowingFeed : ITripDetailPageFeed
    {
        public Task<TripDetailSnapshot> FetchAsync(long tripId, CancellationToken cancellationToken) =>
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
