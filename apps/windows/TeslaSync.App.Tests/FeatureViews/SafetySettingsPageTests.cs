using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.VehicleSystems;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SafetySettingsPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx), the tolerant safety-enum parsers (the
/// web/src/lib/SafetyEnumClassifier.ts choke point), the four-state matrix (loading / empty / error / success), the SI distance
/// formatting at the display boundary, and the generated-client feed's three-read request shaping (web
/// <c>/safety/latest</c> + <c>/safety</c> + <c>useSecurityLatest</c>). The WinUI view is exercised by the app build; its
/// per-region visibility is driven entirely by the <see cref="SafetySettingsDisplay"/> flags asserted here.
/// </summary>
public sealed class SafetySettingsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 59 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "ADAS Features", "ADAS features, safety score, and driving stats", "AEB", "Adaptive cruise headway setting",
        "Alerts for blind-spot hazards", "Alerts when exceeding speed limit", "Auto Emergency Braking",
        "Automatic collision mitigation", "BSC", "BSCW", "Blind Spot Camera", "Blind Spot Collision Warning", "CFD",
        "Camera view when signaling", "Cruise Follow Distance", "Disabled", "ELDA", "Emergency Lane Departure Avoidance",
        "Enabled", "FCW", "Forward Collision Warning", "LDA", "Lane Departure Avoidance", "No history records found.",
        "No safety data available for this vehicle.", "No safety state history to chart yet.", "Off", "On", "PIN",
        "Pin to Drive", "Prevents unintentional lane changes", "Requires PIN before driving", "SLW", "Safety Score",
        "Safety Settings", "Safety Settings History", "Safety States Over Time", "Speed Limit Warning",
        "Steers back on unintentional departure", "Time", "Total Features", "Warns of potential frontal collisions",
        "enabled", "error.loadFailed", "safety.buckled", "safety.distanceAutopilot", "safety.distanceSinceReset",
        "safety.driverBelt", "safety.driverSeat", "safety.drivingStats", "safety.empty", "safety.liveSignals",
        "safety.locked", "safety.occupied", "safety.passengerBelt", "safety.selfDrivingDistance", "safety.unbuckled",
        "safety.unlocked", "safety.vehicleLock",
    ];

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private static SafetySnapshot Row(string json) => SafetySnapshot.FromJson(Json(json));

    private static SafetySnapshot AllEnabled(string date = "2026-01-01T10:00:00Z") => Row(
        "{\"id\":1,\"automatic_emergency_braking_off\":false,\"automatic_blind_spot_camera\":true," +
        "\"blind_spot_collision_warning\":true,\"emergency_lane_departure_avoidance\":true,\"pin_to_drive_enabled\":true," +
        "\"forward_collision_warning\":true,\"lane_departure_avoidance\":true,\"speed_limit_warning\":true," +
        "\"cruise_follow_distance\":\"FollowDistance3\",\"miles_since_reset\":16093.44,\"self_driving_miles_since_reset\":8046.72," +
        "\"created_at\":\"" + date + "\"}");

    private static SafetySettingsModel SuccessModel(
        SafetySnapshot? latest = null,
        IReadOnlyList<SafetySnapshot>? history = null,
        SecuritySafetySnapshot? security = null) =>
        new(SafetySettingsSnapshot.Compose(latest ?? AllEnabled(), history, security), false, null);

    private static SafetySettingsDisplay Project(SafetySettingsModel model, UnitPref? units = null) =>
        SafetySettingsProjection.Project(model, units ?? UnitPref.Metric, Localizer, Now);

    // ---- i18n key coverage (all 59 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = SafetySettingsProjection.Project(SuccessModel(), UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = SafetySettingsProjection.Project(SafetySettingsModel.Initial, UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_fifty_nine_unique_keys() =>
        Assert.Equal(59, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(SafetySettingsModel.Initial);

        Assert.Equal(SafetySettingsState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_latest()
    {
        var model = new SafetySettingsModel(SafetySettingsSnapshot.Empty, false, null);

        var display = Project(model);

        Assert.Equal(SafetySettingsState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.Equal("No safety data available for this vehicle.", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_primary_query_failed()
    {
        var model = new SafetySettingsModel(SafetySettingsSnapshot.Empty, false, "boom");

        var display = Project(model);

        Assert.Equal(SafetySettingsState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Contains("boom", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_latest_resolved()
    {
        var display = Project(SuccessModel());

        Assert.Equal(SafetySettingsState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowLoading);
    }

    // ---- Score / counts / gauge ----------------------------------------------------

    [Fact]
    public void All_nine_features_enabled_scores_full()
    {
        var display = Project(SuccessModel(AllEnabled()));

        Assert.Equal("100%", display.SummaryMetrics[0].Value);
        Assert.Equal("9", display.SummaryMetrics[1].Value);
        Assert.Equal("9", display.SummaryMetrics[2].Value);
        Assert.Equal("0", display.SummaryMetrics[3].Value);
        Assert.Equal(100, display.GaugeValue);
        Assert.Equal(StatusKind.Success, display.EnabledBadgeStatus);
        Assert.Equal("9/9 enabled", display.EnabledBadgeText);
    }

    [Fact]
    public void Aeb_uses_inverted_off_flag()
    {
        // off=true means AEB is DISABLED — only the 8 remaining toggles count.
        var snap = Row(
            "{\"automatic_emergency_braking_off\":true,\"automatic_blind_spot_camera\":true," +
            "\"blind_spot_collision_warning\":true,\"emergency_lane_departure_avoidance\":true,\"pin_to_drive_enabled\":true," +
            "\"forward_collision_warning\":true,\"lane_departure_avoidance\":true,\"speed_limit_warning\":true," +
            "\"cruise_follow_distance\":true}");

        Assert.False(snap.AebEnabled);
        Assert.Equal(8, snap.EnabledCount);

        var display = Project(SuccessModel(snap));
        Assert.Equal("8", display.SummaryMetrics[2].Value);
        Assert.Equal("1", display.SummaryMetrics[3].Value);
    }

    [Fact]
    public void Empty_snapshot_renders_low_score_status()
    {
        var snap = Row("{\"automatic_emergency_braking_off\":true}");

        // Only AEB-off → 0 of 9 enabled.
        Assert.Equal(0, snap.EnabledCount);

        var display = Project(SuccessModel(snap));
        Assert.Equal("0%", display.SummaryMetrics[0].Value);
        Assert.Equal(StatusKind.Danger, display.EnabledBadgeStatus);
    }

    // ---- Safety-enum cleaning + classification (web SafetyEnumClassifier.ts) ------------------

    [Fact]
    public void Clean_strips_prefix_and_classifies_active()
    {
        var fcw = new SafetyRawValue(SafetyValueKind.Text, false, 0, "ForwardCollisionSensitivityMedium");
        Assert.Equal("Medium", SafetyEnumClassifier.Clean(fcw, SafetyEnumField.ForwardCollisionWarning, "On", "Off", "—"));
        Assert.True(SafetyEnumClassifier.IsActive(fcw, SafetyEnumField.ForwardCollisionWarning));
    }

    [Fact]
    public void Speed_limit_warning_none_suffix_is_off_and_inactive()
    {
        var slw = new SafetyRawValue(SafetyValueKind.Text, false, 0, "SpeedAssistLevelNone");
        Assert.Equal("Off", SafetyEnumClassifier.Clean(slw, SafetyEnumField.SpeedLimitWarning, "On", "Off", "—"));
        Assert.False(SafetyEnumClassifier.IsActive(slw, SafetyEnumField.SpeedLimitWarning));
    }

    [Fact]
    public void Boolean_enum_is_never_string_coerced()
    {
        var off = new SafetyRawValue(SafetyValueKind.Bool, false, 0, string.Empty);
        Assert.Equal("Off", SafetyEnumClassifier.Clean(off, SafetyEnumField.LaneDepartureAvoidance, "On", "Off", "—"));
        Assert.False(SafetyEnumClassifier.IsActive(off, SafetyEnumField.LaneDepartureAvoidance));
    }

    [Fact]
    public void Numeric_zero_enum_is_inactive()
    {
        var zero = new SafetyRawValue(SafetyValueKind.Number, false, 0, string.Empty);
        Assert.Equal("0", SafetyEnumClassifier.Clean(zero, SafetyEnumField.CruiseFollowDistance, "On", "Off", "—"));
        Assert.False(SafetyEnumClassifier.IsActive(zero, SafetyEnumField.CruiseFollowDistance));
    }

    // ---- Feature cards -------------------------------------------------------------

    [Fact]
    public void Builds_all_nine_feature_cards_in_web_order()
    {
        var display = Project(SuccessModel(AllEnabled()));

        var keys = display.FeatureCards.Select(c => c.Key).ToArray();
        Assert.Equal(new[] { "aeb", "bsc", "fcw", "lda", "cfd", "slw", "ptd", "bscw", "elda" }, keys);
        Assert.All(display.FeatureCards, c => Assert.True(c.Enabled));
        Assert.Equal("3", display.FeatureCards[4].ValueText); // FollowDistance3 → "3"
    }

    // ---- Live safety signals -------------------------------------------------------

    [Fact]
    public void Live_signals_reflect_security_polarity()
    {
        var security = new SecuritySafetySnapshot(DriverSeatBelt: false, PassengerSeatBelt: null, DriverSeatOccupied: true, Locked: true);
        var display = Project(SuccessModel(security: security));

        Assert.Equal("Unbuckled", display.SignalCards[0].Value);
        Assert.Equal(StatusKind.Danger, display.SignalCards[0].Tone);
        Assert.Equal("\u2014", display.SignalCards[1].Value);
        Assert.Null(display.SignalCards[1].Tone);
        Assert.Equal("Occupied", display.SignalCards[2].Value);
        Assert.Equal("Locked", display.SignalCards[3].Value);
        Assert.Equal(StatusKind.Success, display.SignalCards[3].Tone);
    }

    // ---- Driving statistics (SI distance at the display boundary) ------------------

    [Fact]
    public void Distance_since_reset_formats_in_active_units()
    {
        var metric = Project(SuccessModel(AllEnabled()), UnitPref.Metric);
        Assert.Equal("16", metric.DrivingStats[0].Value);
        Assert.Equal("km", metric.DrivingStats[0].Sublabel);

        var imperial = Project(SuccessModel(AllEnabled()), UnitPref.Imperial);
        Assert.Equal("10", imperial.DrivingStats[0].Value);
        Assert.Equal("mi", imperial.DrivingStats[0].Sublabel);
        Assert.Contains("mi", imperial.DrivingStats[1].Sublabel, StringComparison.Ordinal);
    }

    [Fact]
    public void Missing_distance_renders_em_dash()
    {
        var snap = Row("{\"automatic_emergency_braking_off\":false}");
        var display = Project(SuccessModel(snap));
        Assert.Equal("\u2014", display.DrivingStats[0].Value);
    }

    // ---- Safety-states chart -------------------------------------------------------

    [Fact]
    public void Chart_builds_three_step_series_sorted_ascending()
    {
        var older = AllEnabled("2026-01-01T08:00:00Z");
        var newer = Row("{\"automatic_emergency_braking_off\":true,\"blind_spot_collision_warning\":false,\"emergency_lane_departure_avoidance\":false,\"created_at\":\"2026-01-02T08:00:00Z\"}");
        var display = Project(SuccessModel(AllEnabled(), history: new[] { newer, older }));

        Assert.Equal(ChartState.Ready, display.ChartState);
        Assert.Equal(3, display.ChartSeries.Count);
        Assert.Equal(new[] { "AEB", "BSCW", "ELDA" }, display.ChartSeries.Select(x => x.Name).ToArray());

        var aeb = display.ChartSeries[0].Points;
        Assert.Equal(2, aeb.Count);
        Assert.Equal(1, aeb[0].Y); // older row sorts first, AEB on
        Assert.Equal(0, aeb[1].Y); // newer row, AEB off
    }

    [Fact]
    public void Chart_empty_when_no_history()
    {
        var display = Project(SuccessModel(AllEnabled(), history: Array.Empty<SafetySnapshot>()));

        Assert.Equal(ChartState.Empty, display.ChartState);
        Assert.Empty(display.ChartSeries);
        Assert.Equal("No safety state history to chart yet.", display.ChartEmptyMessage);
    }

    // ---- History table -------------------------------------------------------------

    [Fact]
    public void History_table_has_ten_columns_and_newest_first_rows()
    {
        var older = AllEnabled("2026-01-01T08:00:00Z");
        var newer = Row("{\"id\":2,\"automatic_emergency_braking_off\":true,\"created_at\":\"2026-01-02T08:00:00Z\"}");
        var display = Project(SuccessModel(AllEnabled(), history: new[] { older, newer }));

        Assert.Equal(10, display.HistoryColumns.Count);
        Assert.Equal("time", display.HistoryColumns[0].Key);
        Assert.Equal(2, display.HistoryRows.Count);
        Assert.Equal("2", display.HistoryRows[0].Id);      // newer row sorts first
        Assert.Equal("Off", display.HistoryRows[0].Aeb);   // newer AEB off
        Assert.Equal("On", display.HistoryRows[1].Aeb);    // older AEB on
    }

    [Fact]
    public void History_table_empty_message_when_no_rows()
    {
        var display = Project(SuccessModel(AllEnabled(), history: Array.Empty<SafetySnapshot>()));

        Assert.Empty(display.HistoryRows);
        Assert.Equal("No history records found.", display.HistoryEmptyMessage);
    }

    // ---- Generated-client feed request shaping -------------------------------------

    [Fact]
    public async Task Feed_issues_three_scoped_reads()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"automatic_emergency_braking_off\":false}"));
        api.ReturnsValue(Json("[]"));
        api.ReturnsValue(Json("{\"locked\":true}"));
        var feed = new SafetySettingsClientFeed(api, vehicleId: 7);

        var snapshot = await feed.FetchAsync(default);

        Assert.NotNull(snapshot.Latest);
        Assert.Equal(3, api.Requests.Count);
        Assert.Equal(SafetySettingsRegistration.LatestOperation, api.Requests[0].OperationId);
        Assert.Equal(SafetySettingsRegistration.HistoryOperation, api.Requests[1].OperationId);
        Assert.Equal(SafetySettingsRegistration.SecurityOperation, api.Requests[2].OperationId);
        Assert.Equal(7L, api.Requests[0].Query!["vehicle_id"]);
        Assert.Equal(100, api.Requests[1].Query!["limit"]);
        Assert.True(snapshot.Security?.Locked);
    }

    [Fact]
    public async Task Feed_propagates_primary_failure()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new SafetySettingsClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    [Fact]
    public async Task Feed_degrades_when_history_and_security_fail()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"automatic_emergency_braking_off\":false}"));
        api.Throws(new ApiException("history down", 503));
        api.Throws(new ApiException("security down", 503));
        var feed = new SafetySettingsClientFeed(api, vehicleId: 3);

        var snapshot = await feed.FetchAsync(default);

        Assert.NotNull(snapshot.Latest);
        Assert.Empty(snapshot.History);
        Assert.Null(snapshot.Security);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new SafetySettingsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SafetySettingsPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("SafetySettings", SafetySettingsRegistration.RouteName);
        Assert.Equal("get_api_v1_safety_latest", SafetySettingsRegistration.LatestOperation);
        Assert.Equal("get_api_v1_safety", SafetySettingsRegistration.HistoryOperation);
        Assert.Equal("get_api_v1_security_latest", SafetySettingsRegistration.SecurityOperation);
        Assert.Equal("Safety Settings", SafetySettingsRegistration.Title(Localizer));
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
}
