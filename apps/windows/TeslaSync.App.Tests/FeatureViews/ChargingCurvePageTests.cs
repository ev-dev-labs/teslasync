using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Charging;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ChargingCurvePage</c> surface's Microsoft.UI-free logic — the tolerant
/// charging-sessions parser, the page projection (web/src/features/charging/pages/ChargingCurvePage.tsx) with
/// its loading / empty / success / error matrix, the ported <c>sessionLabel</c> / <c>generateChargingCurve</c>
/// / <c>getChargerLabel</c> helpers, the six manifest i18n keys, the session-selection state-holder, and the
/// generated-client feed's request shaping (web <c>useChargingSessionsPaginated</c>). The WinUI view is
/// exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="ChargingCurveDisplay"/> flags asserted here.
/// </summary>
public sealed class ChargingCurvePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The six i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "charging.curve.empty",
        "charging.curve.emptyHint",
        "charging.curve.selectSession",
        "charging.curve.selectSessionHint",
        "charging.curve.subtitle",
        "charging.curve.title",
    ];

    // ---- Snapshot parsing ----------------------------------------------------------

    [Fact]
    public void Snapshot_parses_a_sessions_array()
    {
        var snapshot = ChargingCurveSnapshot.FromJson(Json(
            "[{\"id\":5,\"started_at\":\"2026-06-01T10:00:00Z\",\"peak_power_w\":150000," +
            "\"charger_type\":\"Tesla\",\"start_soc_pct\":10,\"end_soc_pct\":80," +
            "\"total_energy_added_wh\":50000,\"cost_decimal\":12.5}]"));

        Assert.True(snapshot.HasData);
        var session = Assert.Single(snapshot.Sessions);
        Assert.Equal(5, session.Id);
        Assert.Equal("Tesla", session.ChargerType);
        Assert.Equal(150000, session.PeakPowerW);
        Assert.Equal(50000, session.TotalEnergyAddedWh);
    }

    [Fact]
    public void Snapshot_non_array_is_empty()
    {
        Assert.False(ChargingCurveSnapshot.FromJson(Json("{}")).HasData);
        Assert.False(ChargingCurveSnapshot.FromJson(Json("[]")).HasData);
    }

    // ---- i18n key coverage (the six manifest strings) ------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key_in_success()
    {
        var recorder = new RecordingLocalizer();

        _ = ChargingCurveProjection.Project(SuccessModel(), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_every_required_string_key_in_empty()
    {
        var recorder = new RecordingLocalizer();

        _ = ChargingCurveProjection.Project(
            new ChargingCurveModel(ChargingCurveSnapshot.Empty, null, false, null), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_six_unique_keys() =>
        Assert.Equal(6, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- Data-state matrix ---------------------------------------------------------

    [Fact]
    public void Loading_model_is_the_loading_state()
    {
        var display = ChargingCurveProjection.Project(
            new ChargingCurveModel(ChargingCurveSnapshot.Empty, null, true, null), Localizer, Now);

        Assert.Equal(ChargingCurveState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void Empty_snapshot_is_the_empty_state()
    {
        var display = ChargingCurveProjection.Project(
            new ChargingCurveModel(ChargingCurveSnapshot.Empty, null, false, null), Localizer, Now);

        Assert.Equal(ChargingCurveState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.Equal("No charging sessions to plot a curve.", display.EmptyMessage);
        Assert.Equal("Start a charging session and data will appear here.", display.EmptyHint);
    }

    [Fact]
    public void Populated_snapshot_is_the_success_state()
    {
        var display = ChargingCurveProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal(ChargingCurveState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.Equal(2, display.SessionOptions.Count);
    }

    [Fact]
    public void Error_detail_is_the_error_state()
    {
        var display = ChargingCurveProjection.Project(
            new ChargingCurveModel(ChargingCurveSnapshot.Empty, null, false, "boom"), Localizer, Now);

        Assert.Equal(ChargingCurveState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Equal("boom", display.ErrorText);
    }

    [Fact]
    public void Selecting_a_session_swaps_the_hint_for_the_curve_and_detail()
    {
        var withoutSelection = ChargingCurveProjection.Project(SuccessModel(), Localizer, Now);
        Assert.False(withoutSelection.HasSelectedSession);
        Assert.Equal("Select a session above to view its charging curve", withoutSelection.SelectSessionHint);

        var withSelection = ChargingCurveProjection.Project(
            new ChargingCurveModel(SampleSnapshot(), 2, false, null), Localizer, Now);

        Assert.True(withSelection.HasSelectedSession);
        Assert.Equal(2, withSelection.SelectedSessionId);
        Assert.True(withSelection.SelectedDetailModel.HasSession);
    }

    // ---- Ported helpers (sessionLabel / generateChargingCurve / getChargerLabel) ---

    [Fact]
    public void SessionLabel_formats_date_charger_and_energy()
    {
        string label = ChargingCurveProjection.SessionLabel(
            Session(1, charger: null, peak: 11000, energyWh: 10000), Localizer, Now);

        Assert.Contains("Home / AC", label, StringComparison.Ordinal);
        Assert.Contains("10.0 kWh", label, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("Tesla", 150000.0, "Supercharger")]
    [InlineData("ChargePoint", 50000.0, "DC Fast")]
    [InlineData(null, 25000.0, "DC Fast")]
    [InlineData(null, 5000.0, "Home / AC")]
    public void ChargerLabel_matches_the_web_helper(string? chargerType, double peakW, string expected) =>
        Assert.Equal(expected, ChargingCurveProjection.ChargerLabel(chargerType, peakW, Localizer));

    [Fact]
    public void GenerateChargingCurve_tapers_a_dc_session()
    {
        var curve = ChargingCurveProjection.GenerateChargingCurve(
            Session(1, charger: "Tesla", peak: 150000, startSoc: 0, endSoc: 100));

        Assert.Equal(101, curve.Count);
        Assert.Equal(150, curve[0].Power, 3);
        Assert.True(curve[^1].Power < curve[0].Power);
    }

    [Fact]
    public void GenerateChargingCurve_is_flat_for_an_ac_session()
    {
        var curve = ChargingCurveProjection.GenerateChargingCurve(
            Session(1, charger: null, peak: 11000, startSoc: 20, endSoc: 80));

        Assert.Equal(61, curve.Count);
        Assert.All(curve, point => Assert.Equal(11, point.Power, 3));
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_sessions_into_the_success_state()
    {
        var feed = new FakeChargingCurveFeed(SampleSnapshot());
        using var vm = new ChargingCurvePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ChargingCurveState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.Equal(Now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_empty_state()
    {
        using var vm = new ChargingCurvePageViewModel(EmptyChargingCurveFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ChargingCurveState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new ChargingCurvePageViewModel(new ThrowingChargingCurveFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ChargingCurveState.Error, vm.State);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_select_session_updates_the_selection()
    {
        var feed = new FakeChargingCurveFeed(SampleSnapshot());
        using var vm = new ChargingCurvePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        vm.SelectSession(2);

        Assert.Equal(2, vm.SelectedSessionId);
        Assert.True(vm.Display.HasSelectedSession);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeChargingCurveFeed(SampleSnapshot());
        using var vm = new ChargingCurvePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    // ---- Generated-client feed (web useChargingSessionsPaginated) ------------------

    [Fact]
    public async Task ClientFeed_sends_the_sessions_operation_with_the_vehicle_id()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":3,\"peak_power_w\":11000,\"total_energy_added_wh\":8000}]"));
        var feed = new ChargingCurveClientFeed(api, vehicleId: 7);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_charging_sessions", request.OperationId);
        Assert.Equal("7", request.Query!["vehicle_id"]?.ToString());
    }

    // ---- Fixtures ------------------------------------------------------------------

    private static ChargingCurveModel SuccessModel() => new(SampleSnapshot(), null, false, null);

    private static ChargingCurveSnapshot SampleSnapshot() =>
        new(new[] { Session(1, charger: "Tesla", peak: 150000), Session(2, charger: null, peak: 11000) });

    private static ChargingCurveSession Session(
        long id,
        string? charger = null,
        double? peak = 11000,
        double? startSoc = 20,
        double? endSoc = 80,
        double? energyWh = 10000) =>
        new(
            id,
            new DateTimeOffset(2026, 6, 1, 10, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 6, 1, 11, 0, 0, TimeSpan.Zero),
            charger,
            peak,
            startSoc,
            endSoc,
            energyWh,
            AvgPowerW: null,
            CostDecimal: 5,
            StartPlace: null);

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

    private sealed class FakeChargingCurveFeed(ChargingCurveSnapshot snapshot) : IChargingCurveFeed
    {
        public int FetchCount { get; private set; }

        public Task<ChargingCurveSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingChargingCurveFeed : IChargingCurveFeed
    {
        public Task<ChargingCurveSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }
}
