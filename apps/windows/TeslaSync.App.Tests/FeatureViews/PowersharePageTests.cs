using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Charging;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>PowersharePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/charging/pages/PowersharePage.tsx), the tolerant five-signal observation reducers, the
/// status / stop-reason badge-variant ports, the view-model's four-state matrix (loading / empty / error /
/// success) and the generated-client feed's request shaping (web's five <c>useSignalObservations</c> reads).
/// The WinUI view is exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="PowershareDisplay"/> flags asserted here.
/// </summary>
public sealed class PowersharePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 14 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "common.noData", "powershare.hoursLeft", "powershare.hoursLeftSub", "powershare.noData",
        "powershare.noStopReason", "powershare.outputPower", "powershare.outputPowerSub",
        "powershare.statusSection", "powershare.stopReasonHelp", "powershare.stopReasonSection",
        "powershare.subtitle", "powershare.title", "powershare.type", "powershare.typeSub",
    ];

    private static PowershareReading SampleReading(
        string? status = "Active",
        string? shareType = "Home",
        string? stopReason = "User Requested",
        double? hoursLeft = 2.5,
        double? powerKw = 12.34) =>
        new(status, shareType, stopReason, hoursLeft, powerKw);

    private static PowershareModel SuccessModel(PowershareReading? reading = null) =>
        new(VehicleSelected: true, Loading: false, HasError: false, ErrorDetail: null, Reading: reading ?? SampleReading());

    private static PowershareModel EmptyModel() =>
        new(VehicleSelected: true, Loading: false, HasError: false, ErrorDetail: null, Reading: PowershareReading.Empty);

    private static PowershareDisplay Project(PowershareModel model) => PowershareProjection.Project(model, Localizer);

    // ── i18n key coverage (all 14 manifest strings, in every data state) ────────────────────────────────

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();
        _ = PowershareProjection.Project(SuccessModel(), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();
        _ = PowershareProjection.Project(PowershareModel.Initial, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_when_data_is_absent()
    {
        var recorder = new RecordingLocalizer();
        _ = PowershareProjection.Project(EmptyModel(), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_fourteen_unique_keys() =>
        Assert.Equal(14, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ── Four data states ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void State_loading_when_first_load_in_flight()
    {
        var display = Project(PowershareModel.Initial);

        Assert.Equal(PowershareState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowError);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_data()
    {
        var display = Project(EmptyModel());

        Assert.Equal(PowershareState.Empty, display.State);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowError);
        Assert.True(display.ShowContent);
        Assert.False(display.HasData);
    }

    [Fact]
    public void State_success_when_any_value_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(PowershareState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.True(display.HasData);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_error_when_load_failed()
    {
        var model = new PowershareModel(VehicleSelected: true, Loading: false, HasError: true, ErrorDetail: "boom", Reading: PowershareReading.Empty);
        var display = Project(model);

        Assert.Equal(PowershareState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowLoading);
    }

    [Fact]
    public void Both_panels_render_in_empty_and_success_states()
    {
        // Web parity: the two GlassPanels are always shown; only their internal content differs.
        Assert.True(Project(EmptyModel()).ShowContent);
        Assert.True(Project(SuccessModel()).ShowContent);
    }

    // ── GlassPanel1 — status header + stat cards ─────────────────────────────────────────────────────────

    [Fact]
    public void Status_badge_shows_the_status_when_present()
    {
        var display = Project(SuccessModel(SampleReading(status: "Active")));

        Assert.Equal("Active", display.StatusBadgeText);
        Assert.Equal(StatusKind.Success, display.StatusBadgeStatus);
        Assert.Equal("Powershare Status", display.StatusSectionTitle);
    }

    [Fact]
    public void Status_badge_falls_back_to_no_data_when_status_absent()
    {
        var display = Project(SuccessModel(SampleReading(status: null)));

        // common.noData fallback ('—') via PassthroughLocalizer.
        Assert.Equal("\u2014", display.StatusBadgeText);
        Assert.Equal(StatusKind.Neutral, display.StatusBadgeStatus);
    }

    [Fact]
    public void Type_card_shows_share_type_or_em_dash()
    {
        Assert.Equal("Home", Project(SuccessModel(SampleReading(shareType: "Home"))).TypeCard.Value);
        Assert.Equal("\u2014", Project(SuccessModel(SampleReading(shareType: null))).TypeCard.Value);

        var card = Project(SuccessModel()).TypeCard;
        Assert.Equal("Type", card.Label);
        Assert.Equal("Powershare destination", card.Sublabel);
    }

    [Fact]
    public void Output_power_card_formats_kilowatts_with_two_decimals()
    {
        Assert.Equal("12.34 kW", Project(SuccessModel(SampleReading(powerKw: 12.34))).PowerCard.Value);
        Assert.Equal("0.00 kW", Project(SuccessModel(SampleReading(powerKw: 0))).PowerCard.Value);
        Assert.Equal("\u2014", Project(SuccessModel(SampleReading(powerKw: null))).PowerCard.Value);

        var card = Project(SuccessModel()).PowerCard;
        Assert.Equal("Output Power", card.Label);
        Assert.Equal("Instantaneous power draw", card.Sublabel);
    }

    [Fact]
    public void Hours_card_formats_hours_with_one_decimal()
    {
        Assert.Equal("2.5 h", Project(SuccessModel(SampleReading(hoursLeft: 2.5))).HoursCard.Value);
        Assert.Equal("\u2014", Project(SuccessModel(SampleReading(hoursLeft: null))).HoursCard.Value);

        var card = Project(SuccessModel()).HoursCard;
        Assert.Equal("Hours Remaining", card.Label);
        Assert.Equal("Estimated runtime at current output", card.Sublabel);
    }

    [Fact]
    public void Stat_card_automation_name_combines_label_and_value()
    {
        var card = Project(SuccessModel(SampleReading(powerKw: 12.34))).PowerCard;
        Assert.Equal("Output Power: 12.34 kW", card.AutomationName);
    }

    [Fact]
    public void Has_data_is_true_when_only_one_value_present()
    {
        Assert.True(Project(SuccessModel(new PowershareReading(null, null, null, null, 5))).HasData);
        Assert.True(Project(SuccessModel(new PowershareReading(null, "Home", null, null, null))).HasData);
        Assert.False(Project(EmptyModel()).HasData);
    }

    // ── GlassPanel5 — stop reason ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Stop_reason_chip_shown_when_present()
    {
        var display = Project(SuccessModel(SampleReading(stopReason: "User Requested")));

        Assert.True(display.StopReasonPresent);
        Assert.Equal("User Requested", display.StopReasonText);
        Assert.Equal(StatusKind.Warning, display.StopReasonStatus);
        Assert.Equal("Stop Reason", display.StopReasonSectionTitle);
        Assert.Equal("Last recorded reason Powershare was halted.", display.StopReasonHelp);
    }

    [Fact]
    public void Stop_reason_empty_when_absent()
    {
        var display = Project(SuccessModel(SampleReading(stopReason: null)));

        Assert.False(display.StopReasonPresent);
        Assert.Equal(
            "No stop reason recorded. Powershare has not been halted, or the signal has not yet been reported.",
            display.NoStopReasonMessage);
    }

    // ── Badge-variant ports (web statusVariant / stopReasonVariant) ──────────────────────────────────────

    [Theory]
    [InlineData("Active", StatusKind.Success)]
    [InlineData("On", StatusKind.Success)]
    [InlineData("Error", StatusKind.Danger)]
    [InlineData("Failed", StatusKind.Danger)]
    [InlineData("Off", StatusKind.Neutral)]
    [InlineData("Standby", StatusKind.Warning)]
    [InlineData(null, StatusKind.Neutral)]
    public void Status_variant_matches_web(string? status, StatusKind expected) =>
        Assert.Equal(expected, PowershareProjection.StatusVariant(status));

    [Fact]
    public void Status_variant_reproduces_web_inactive_quirk()
    {
        // Web statusVariant checks includes('active') first, so "inactive" matches the success branch.
        Assert.Equal(StatusKind.Success, PowershareProjection.StatusVariant("Inactive"));
    }

    [Theory]
    [InlineData("None", StatusKind.Neutral)]
    [InlineData("", StatusKind.Neutral)]
    [InlineData(null, StatusKind.Neutral)]
    [InlineData("User Requested", StatusKind.Warning)]
    [InlineData("Fault Detected", StatusKind.Danger)]
    [InlineData("Low Battery", StatusKind.Danger)]
    [InlineData("Error", StatusKind.Danger)]
    [InlineData("Scheduled", StatusKind.Warning)]
    public void Stop_reason_variant_matches_web(string? reason, StatusKind expected) =>
        Assert.Equal(expected, PowershareProjection.StopReasonVariant(reason));

    // ── Observation reducers (web latestText / latestNumeric / adaptObservations) ────────────────────────

    [Fact]
    public void Latest_text_reads_string_kinds()
    {
        Assert.Equal("Home", PowershareObservation.LatestText(TextObs("ValueKindString", "Home")));
        Assert.Equal("ShiftStateD", PowershareObservation.LatestText(TextObs("ValueKindEnum", "ShiftStateD")));
    }

    [Fact]
    public void Latest_text_ignores_numeric_kinds()
    {
        Assert.Null(PowershareObservation.LatestText(NumObs("ValueKindFloat", "12.34")));
    }

    [Fact]
    public void Latest_numeric_reads_numeric_kinds()
    {
        Assert.Equal(12.34, PowershareObservation.LatestNumeric(NumObs("ValueKindFloat", "12.34")));
        Assert.Equal(7, PowershareObservation.LatestNumeric(NumObs("ValueKindInt32", "7")));
    }

    [Fact]
    public void Latest_numeric_ignores_text_kinds()
    {
        Assert.Null(PowershareObservation.LatestNumeric(TextObs("ValueKindString", "nope")));
    }

    [Fact]
    public void Reducers_tolerate_camel_case_value_kind_key()
    {
        var camel = Json("{\"observations\":[{\"valueKind\":\"ValueKindString\",\"value\":\"On\"}]}");
        Assert.Equal("On", PowershareObservation.LatestText(camel));
    }

    [Fact]
    public void Reducers_return_null_for_empty_or_missing_observations()
    {
        Assert.Null(PowershareObservation.LatestText(Json("{\"observations\":[]}")));
        Assert.Null(PowershareObservation.LatestNumeric(Json("{\"observations\":[]}")));
        Assert.Null(PowershareObservation.LatestText(Json("{}")));
        Assert.Null(PowershareObservation.LatestNumeric(Json("null")));
    }

    [Fact]
    public void From_observations_composes_all_five_fields()
    {
        var reading = PowershareReading.FromObservations(
            TextObs("ValueKindString", "Active"),
            TextObs("ValueKindString", "Home"),
            TextObs("ValueKindString", "User Requested"),
            NumObs("ValueKindFloat", "2.5"),
            NumObs("ValueKindFloat", "12.34"));

        Assert.Equal("Active", reading.Status);
        Assert.Equal("Home", reading.ShareType);
        Assert.Equal("User Requested", reading.StopReason);
        Assert.Equal(2.5, reading.HoursLeft);
        Assert.Equal(12.34, reading.PowerKw);
        Assert.True(reading.HasData);
    }

    [Fact]
    public void From_observations_is_all_absent_when_every_read_is_empty()
    {
        var reading = PowershareReading.FromObservations(
            EmptyObs(), EmptyObs(), EmptyObs(), EmptyObs(), EmptyObs());

        Assert.False(reading.HasData);
        Assert.Equal(PowershareReading.Empty, reading);
    }

    // ── View-model state matrix ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loads_reading_into_the_success_state()
    {
        var feed = new FakePowershareFeed(SampleReading());
        using var vm = new PowersharePageViewModel(feed, Localizer, vehicleId: "1");

        await vm.LoadAsync();

        Assert.Equal(PowershareState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.True(vm.Display.HasData);
        Assert.False(vm.IsFetching);
        Assert.Equal(1, feed.FetchCount);
        Assert.Equal("1", feed.LastVehicleId);
    }

    [Fact]
    public async Task ViewModel_no_vehicle_is_the_empty_state_without_fetching()
    {
        var feed = new FakePowershareFeed(SampleReading());
        using var vm = new PowersharePageViewModel(feed, Localizer, vehicleId: null);

        await vm.LoadAsync();

        Assert.Equal(PowershareState.Empty, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.Display.HasData);
        Assert.Equal(0, feed.FetchCount);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_empty_state()
    {
        using var vm = new PowersharePageViewModel(EmptyPowershareFeed.Instance, Localizer, vehicleId: "1");

        await vm.LoadAsync();

        Assert.Equal(PowershareState.Empty, vm.State);
        Assert.False(vm.Display.HasData);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new PowersharePageViewModel(new ThrowingPowershareFeed(), Localizer, vehicleId: "1");

        await vm.LoadAsync();

        Assert.Equal(PowershareState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakePowershareFeed(SampleReading());
        using var vm = new PowersharePageViewModel(feed, Localizer, vehicleId: "1");

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    // ── Generated-client feed (web's five useSignalObservations reads) ──────────────────────────────────

    [Fact]
    public async Task ClientFeed_sends_five_observation_reads_with_vehicle_field_and_limit()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(TextObs("ValueKindString", "Active"))
            .ReturnsValue(TextObs("ValueKindString", "Home"))
            .ReturnsValue(TextObs("ValueKindString", "User Requested"))
            .ReturnsValue(NumObs("ValueKindFloat", "2.5"))
            .ReturnsValue(NumObs("ValueKindFloat", "12.34"));
        var feed = new PowershareClientFeed(api);

        var reading = await feed.FetchAsync("42", default);

        Assert.Equal("Active", reading.Status);
        Assert.Equal("Home", reading.ShareType);
        Assert.Equal("User Requested", reading.StopReason);
        Assert.Equal(2.5, reading.HoursLeft);
        Assert.Equal(12.34, reading.PowerKw);

        Assert.Equal(5, api.Requests.Count);
        Assert.All(api.Requests, r => Assert.Equal(PowershareClientFeed.ObservationsOperation, r.OperationId));
        Assert.All(api.Requests, r => Assert.Equal("42", r.Query!["vehicle_id"]?.ToString()));
        Assert.All(api.Requests, r => Assert.Equal("1", r.Query!["limit"]?.ToString()));

        var fields = api.Requests.Select(r => r.Query!["field"]?.ToString()).ToArray();
        Assert.Equal(
            new[]
            {
                PowershareRegistration.StatusField,
                PowershareRegistration.TypeField,
                PowershareRegistration.StopReasonField,
                PowershareRegistration.HoursLeftField,
                PowershareRegistration.PowerField,
            },
            fields);
    }

    [Fact]
    public async Task ClientFeed_swallows_failed_observations_per_web_independence()
    {
        var api = new FakeApiClient();
        for (var i = 0; i < 5; i++)
        {
            api.Throws(new InvalidOperationException("boom"));
        }

        var feed = new PowershareClientFeed(api);

        var reading = await feed.FetchAsync("42", default);

        Assert.False(reading.HasData);
        Assert.Equal(5, api.Requests.Count);
    }

    [Fact]
    public async Task ClientFeed_keeps_other_values_when_one_read_fails()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(TextObs("ValueKindString", "Active"))
            .Throws(new InvalidOperationException("type read failed"))
            .ReturnsValue(EmptyObs())
            .ReturnsValue(EmptyObs())
            .ReturnsValue(NumObs("ValueKindFloat", "12.34"));
        var feed = new PowershareClientFeed(api);

        var reading = await feed.FetchAsync("42", default);

        Assert.Equal("Active", reading.Status);
        Assert.Null(reading.ShareType);
        Assert.Equal(12.34, reading.PowerKw);
        Assert.True(reading.HasData);
    }

    [Fact]
    public void ClientFeed_operation_resolves_against_the_generated_endpoint_table() =>
        Assert.Equal(
            PowershareClientFeed.ObservationsOperation,
            new FakeApiClient().ResolveEndpoint(PowershareClientFeed.ObservationsOperation).OperationId);

    // ── Registration + diagnostics ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_route_signal_fields_and_title()
    {
        Assert.Equal("Powershare", PowershareRegistration.RouteName);
        Assert.Equal("Powershare", PowershareRegistration.Title(Localizer));
        Assert.Equal("PowershareStatus", PowershareRegistration.StatusField);
        Assert.Equal("PowershareType", PowershareRegistration.TypeField);
        Assert.Equal("PowershareStopReason", PowershareRegistration.StopReasonField);
        Assert.Equal("PowershareHoursLeft", PowershareRegistration.HoursLeftField);
        Assert.Equal("PowershareInstantaneousPowerKW", PowershareRegistration.PowerField);
    }

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new PowershareDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=PowersharePage", Assert.Single(lines));
    }

    // ── helpers / fakes ──────────────────────────────────────────────────────────────────────────────────

    private static JsonElement TextObs(string kind, string value) =>
        Json($"{{\"observations\":[{{\"value_kind\":\"{kind}\",\"value\":\"{value}\"}}]}}");

    private static JsonElement NumObs(string kind, string rawValue) =>
        Json($"{{\"observations\":[{{\"value_kind\":\"{kind}\",\"value\":{rawValue}}}]}}");

    private static JsonElement EmptyObs() => Json("{\"observations\":[]}");

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

    private sealed class FakePowershareFeed(PowershareReading reading) : IPowershareFeed
    {
        public int FetchCount { get; private set; }

        public string? LastVehicleId { get; private set; }

        public Task<PowershareReading> FetchAsync(string vehicleId, CancellationToken cancellationToken)
        {
            FetchCount++;
            LastVehicleId = vehicleId;
            return Task.FromResult(reading);
        }
    }

    private sealed class ThrowingPowershareFeed : IPowershareFeed
    {
        public Task<PowershareReading> FetchAsync(string vehicleId, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load Powershare data");
    }
}
