using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
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
/// Headless verification of the SafetyFeaturesWidget's UI-thread-free logic — the JSON parse adapter (the
/// useSafety read), the verbatim <c>cleanSafetyEnum</c> / <c>isSafetyEnumActive</c> ports (lib/safetyEnum.ts),
/// the web-faithful <c>boolStatus</c> / <c>invertedBoolStatus</c> / <c>safetyEnumStatus</c> mapping, the
/// Enabled/Disabled value rendering, the active-feature count, the compact-count + eight-cell grid projection,
/// the Narrator names, the result mapper, the single-endpoint per-vehicle data source (primary resolution +
/// the query-scoped safety read), the registry metadata, the diagnostics, and the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline) plus footprint re-projection.
/// Mirrors the web spec (web/src/features/dashboard/widgets/SafetyFeaturesWidget.tsx).
/// </summary>
public sealed class SafetyFeaturesWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    // fcw enum active, aeb off-flag false (⇒ enabled), lda enum active, elda true, bsc false, bscw true,
    // slw "None" (⇒ off), cfd numeric 3 (⇒ active). Six features active.
    private const string MixedJson =
        """{"vehicle_id":7,"forward_collision_warning":"ForwardCollisionSensitivityHigh","automatic_emergency_braking_off":false,"lane_departure_avoidance":"LaneAssistLevelWarning","emergency_lane_departure_avoidance":true,"automatic_blind_spot_camera":false,"blind_spot_collision_warning":true,"speed_limit_warning":"SpeedAssistLevelNone","cruise_follow_distance":3}""";

    // ---- Parse adapter (web useSafety read) ----------------------------------------

    [Fact]
    public void FromResponse_parses_all_eight_fields()
    {
        using var doc = JsonDocument.Parse(MixedJson);

        var snapshot = SafetySnapshot.FromResponse(doc.RootElement);

        Assert.NotNull(snapshot);
        Assert.Equal(SafetyValueKind.Text, snapshot!.ForwardCollisionWarning.Kind);
        Assert.Equal(SafetyValueKind.Bool, snapshot.AutomaticEmergencyBrakingOff.Kind);
        Assert.False(snapshot.AutomaticEmergencyBrakingOff.BoolValue);
        Assert.Equal(SafetyValueKind.Number, snapshot.CruiseFollowDistance.Kind);
        Assert.Equal(3, snapshot.CruiseFollowDistance.NumberValue);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        // Web parity: data is truthy but every ADAS field is undefined → all "unknown" / em dash.
        using var doc = JsonDocument.Parse("""{"vehicle_id":7}""");

        var snapshot = SafetySnapshot.FromResponse(doc.RootElement);

        Assert.NotNull(snapshot);
        Assert.Equal(SafetyValueKind.None, snapshot!.ForwardCollisionWarning.Kind);
        Assert.Equal(SafetyValueKind.None, snapshot.AutomaticEmergencyBrakingOff.Kind);
        Assert.Equal(SafetyValueKind.None, snapshot.CruiseFollowDistance.Kind);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("\"x\"")]
    [InlineData("5")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(SafetySnapshot.FromResponse(doc.RootElement));
    }

    // ---- SafetyValue narrowing (web typeof boolean / asFiniteNumber / asNonEmptyString) ----

    [Fact]
    public void Value_read_narrows_each_json_kind()
    {
        using var doc = JsonDocument.Parse("""{"b":true,"f":false,"s":"x","empty":"","n":3,"z":null,"o":{}}""");
        var obj = doc.RootElement;

        Assert.Equal(SafetyValueKind.Bool, SafetyValue.Read(obj, "b").Kind);
        Assert.True(SafetyValue.Read(obj, "b").BoolValue);
        Assert.Equal(SafetyValueKind.Bool, SafetyValue.Read(obj, "f").Kind);
        Assert.Equal(SafetyValueKind.Text, SafetyValue.Read(obj, "s").Kind);
        Assert.Equal(SafetyValueKind.None, SafetyValue.Read(obj, "empty").Kind); // empty string → None (web asNonEmptyString)
        Assert.Equal(SafetyValueKind.Number, SafetyValue.Read(obj, "n").Kind);
        Assert.Equal(SafetyValueKind.None, SafetyValue.Read(obj, "z").Kind);     // null → None
        Assert.Equal(SafetyValueKind.None, SafetyValue.Read(obj, "o").Kind);     // object → None
        Assert.Equal(SafetyValueKind.None, SafetyValue.Read(obj, "missing").Kind); // absent → None
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, false)]
    public void Value_truthiness_for_bool(bool input, bool truthy) =>
        Assert.Equal(truthy, SafetyValue.FromBool(input).IsTruthy);

    [Theory]
    [InlineData(0, false)]
    [InlineData(3, true)]
    [InlineData(-1, true)]
    public void Value_truthiness_for_number(double input, bool truthy) =>
        Assert.Equal(truthy, SafetyValue.FromNumber(input).IsTruthy);

    // ---- cleanSafetyEnum (verbatim web port) ---------------------------------------

    [Fact]
    public void CleanSafetyEnum_boolean_renders_on_off()
    {
        Assert.Equal("On", SafetyFeaturesProjection.CleanSafetyEnum(SafetyValue.FromBool(true), SafetyEnumField.ForwardCollisionWarning, "—"));
        Assert.Equal("Off", SafetyFeaturesProjection.CleanSafetyEnum(SafetyValue.FromBool(false), SafetyEnumField.ForwardCollisionWarning, "—"));
    }

    [Theory]
    [InlineData(3, "3")]
    [InlineData(3.5, "3.5")]
    [InlineData(0, "0")]
    public void CleanSafetyEnum_number_renders_decimal(double value, string expected) =>
        Assert.Equal(expected, SafetyFeaturesProjection.CleanSafetyEnum(SafetyValue.FromNumber(value), SafetyEnumField.CruiseFollowDistance, "—"));

    [Theory]
    [InlineData(SafetyEnumField.ForwardCollisionWarning, "ForwardCollisionSensitivityHigh", "High")]
    [InlineData(SafetyEnumField.LaneDepartureAvoidance, "LaneAssistLevelWarning", "Warning")]
    [InlineData(SafetyEnumField.SpeedLimitWarning, "SpeedAssistLevelChime", "Chime")]
    [InlineData(SafetyEnumField.CruiseFollowDistance, "FollowDistance3", "3")]
    public void CleanSafetyEnum_strips_known_prefixes(SafetyEnumField field, string raw, string expected) =>
        Assert.Equal(expected, SafetyFeaturesProjection.CleanSafetyEnum(SafetyValue.FromText(raw), field, "—"));

    [Fact]
    public void CleanSafetyEnum_speed_limit_none_maps_to_off() =>
        Assert.Equal("Off", SafetyFeaturesProjection.CleanSafetyEnum(SafetyValue.FromText("SpeedAssistLevelNone"), SafetyEnumField.SpeedLimitWarning, "—"));

    [Fact]
    public void CleanSafetyEnum_unprefixed_string_passes_through() =>
        Assert.Equal("Late", SafetyFeaturesProjection.CleanSafetyEnum(SafetyValue.FromText("Late"), SafetyEnumField.ForwardCollisionWarning, "—"));

    [Fact]
    public void CleanSafetyEnum_none_returns_fallback() =>
        Assert.Equal("—", SafetyFeaturesProjection.CleanSafetyEnum(SafetyValue.None, SafetyEnumField.ForwardCollisionWarning, "—"));

    // ---- isSafetyEnumActive (verbatim web port) ------------------------------------

    [Fact]
    public void IsSafetyEnumActive_none_and_bool()
    {
        Assert.False(SafetyFeaturesProjection.IsSafetyEnumActive(SafetyValue.None, SafetyEnumField.ForwardCollisionWarning));
        Assert.True(SafetyFeaturesProjection.IsSafetyEnumActive(SafetyValue.FromBool(true), SafetyEnumField.ForwardCollisionWarning));
        Assert.False(SafetyFeaturesProjection.IsSafetyEnumActive(SafetyValue.FromBool(false), SafetyEnumField.ForwardCollisionWarning));
    }

    [Theory]
    [InlineData("off")]
    [InlineData("OFF")]
    [InlineData("none")]
    [InlineData("disabled")]
    [InlineData("0")]
    public void IsSafetyEnumActive_inactive_words_are_false(string raw) =>
        Assert.False(SafetyFeaturesProjection.IsSafetyEnumActive(SafetyValue.FromText(raw), SafetyEnumField.LaneDepartureAvoidance));

    [Fact]
    public void IsSafetyEnumActive_speed_limit_none_is_inactive() =>
        Assert.False(SafetyFeaturesProjection.IsSafetyEnumActive(SafetyValue.FromText("SpeedAssistLevelNone"), SafetyEnumField.SpeedLimitWarning));

    [Theory]
    [InlineData("FollowDistance3")]
    [InlineData("Chime")]
    public void IsSafetyEnumActive_meaningful_values_are_active(string raw) =>
        Assert.True(SafetyFeaturesProjection.IsSafetyEnumActive(SafetyValue.FromText(raw), SafetyEnumField.CruiseFollowDistance));

    [Theory]
    [InlineData(0, false)]
    [InlineData(3, true)]
    public void IsSafetyEnumActive_numbers(double value, bool active) =>
        Assert.Equal(active, SafetyFeaturesProjection.IsSafetyEnumActive(SafetyValue.FromNumber(value), SafetyEnumField.CruiseFollowDistance));

    // ---- status mapping (web boolStatus / invertedBoolStatus / safetyEnumStatus) ---

    [Fact]
    public void BoolStatus_matches_web()
    {
        Assert.Equal(SafetyStatus.Unknown, SafetyFeaturesProjection.BoolStatus(SafetyValue.None));
        Assert.Equal(SafetyStatus.Ok, SafetyFeaturesProjection.BoolStatus(SafetyValue.FromBool(true)));
        Assert.Equal(SafetyStatus.Inactive, SafetyFeaturesProjection.BoolStatus(SafetyValue.FromBool(false)));
    }

    [Fact]
    public void InvertedBoolStatus_matches_web()
    {
        Assert.Equal(SafetyStatus.Unknown, SafetyFeaturesProjection.InvertedBoolStatus(SafetyValue.None));
        // The off-flag being true means the feature is OFF → inactive.
        Assert.Equal(SafetyStatus.Inactive, SafetyFeaturesProjection.InvertedBoolStatus(SafetyValue.FromBool(true)));
        Assert.Equal(SafetyStatus.Ok, SafetyFeaturesProjection.InvertedBoolStatus(SafetyValue.FromBool(false)));
    }

    [Fact]
    public void SafetyEnumStatus_matches_web()
    {
        Assert.Equal(SafetyStatus.Unknown, SafetyFeaturesProjection.SafetyEnumStatus(SafetyValue.None, SafetyEnumField.SpeedLimitWarning));
        Assert.Equal(SafetyStatus.Ok, SafetyFeaturesProjection.SafetyEnumStatus(SafetyValue.FromText("Chime"), SafetyEnumField.SpeedLimitWarning));
        Assert.Equal(SafetyStatus.Inactive, SafetyFeaturesProjection.SafetyEnumStatus(SafetyValue.FromText("SpeedAssistLevelNone"), SafetyEnumField.SpeedLimitWarning));
    }

    [Theory]
    [InlineData(SafetyStatus.Ok, StatusKind.Success)]
    [InlineData(SafetyStatus.Inactive, StatusKind.Neutral)]
    [InlineData(SafetyStatus.Unknown, StatusKind.Neutral)]
    public void ToStatusKind_matches_web(SafetyStatus status, StatusKind expected) =>
        Assert.Equal(expected, SafetyFeaturesProjection.ToStatusKind(status));

    // ---- Projection: eight ADAS cells ----------------------------------------------

    [Fact]
    public void Project_builds_eight_cells_in_web_order()
    {
        var display = Project(MixedSnapshot(), new SafetyFeaturesSize(2, 4));

        Assert.False(display.IsCompact);
        Assert.Equal(8, display.Cells.Count);
        Assert.Equal(new[] { "fcw", "aeb", "lda", "elda", "bsc", "bscw", "slw", "cfd" }, display.Cells.Select(c => c.Id).ToArray());

        Assert.Equal("Forward Collision Warning", display.Cells[0].Label);
        Assert.Equal("High", display.Cells[0].Value);
        Assert.Equal(SafetyStatus.Ok, display.Cells[0].Status);
    }

    [Fact]
    public void Project_inverted_aeb_flag_false_is_enabled()
    {
        var display = Project(MixedSnapshot(), new SafetyFeaturesSize(2, 4));

        var aeb = display.Cells[1];
        Assert.Equal("aeb", aeb.Id);
        Assert.Equal("Enabled", aeb.Value);
        Assert.Equal(SafetyStatus.Ok, aeb.Status);
    }

    [Fact]
    public void Project_plain_bool_false_is_disabled_and_inactive()
    {
        var display = Project(MixedSnapshot(), new SafetyFeaturesSize(2, 4));

        var bsc = display.Cells[4];
        Assert.Equal("bsc", bsc.Id);
        Assert.Equal("Disabled", bsc.Value);
        Assert.Equal(SafetyStatus.Inactive, bsc.Status);
    }

    [Fact]
    public void Project_speed_limit_none_renders_off_inactive()
    {
        var display = Project(MixedSnapshot(), new SafetyFeaturesSize(2, 4));

        var slw = display.Cells[6];
        Assert.Equal("slw", slw.Id);
        Assert.Equal("Off", slw.Value);
        Assert.Equal(SafetyStatus.Inactive, slw.Status);
    }

    [Fact]
    public void Project_counts_six_active_features()
    {
        var display = Project(MixedSnapshot(), new SafetyFeaturesSize(2, 4));
        Assert.Equal(6, display.ActiveCount);
    }

    [Fact]
    public void Project_missing_fields_render_em_dash_and_unknown()
    {
        var display = Project(EmptySnapshot(), new SafetyFeaturesSize(2, 4));

        Assert.Equal(0, display.ActiveCount);
        Assert.All(display.Cells, c =>
        {
            Assert.Equal("\u2014", c.Value);
            Assert.Equal(SafetyStatus.Unknown, c.Status);
        });
    }

    [Fact]
    public void Project_grid_columns_track_width()
    {
        Assert.Equal(2, Project(MixedSnapshot(), new SafetyFeaturesSize(2, 4)).GridColumns);
        Assert.Equal(4, Project(MixedSnapshot(), new SafetyFeaturesSize(3, 4)).GridColumns);
        Assert.Equal(4, Project(MixedSnapshot(), new SafetyFeaturesSize(4, 4)).GridColumns);
    }

    // ---- Projection: compact count -------------------------------------------------

    [Fact]
    public void Project_compact_exposes_active_count_and_label()
    {
        var display = Project(MixedSnapshot(), new SafetyFeaturesSize(1, 4));

        Assert.True(display.IsCompact);
        Assert.Equal(6, display.ActiveCount);
        Assert.Equal("6", display.ActiveCountText);
        Assert.Equal("Active Features", display.ActiveFeaturesLabel);
    }

    // ---- Accessibility (Narrator names) --------------------------------------------

    [Fact]
    public void Project_cell_automation_name_combines_label_and_value()
    {
        var display = Project(MixedSnapshot(), new SafetyFeaturesSize(2, 4));

        Assert.Equal("Forward Collision Warning High", display.Cells[0].AutomationName);
        Assert.Equal("Auto Emergency Braking Enabled", display.Cells[1].AutomationName);
    }

    [Fact]
    public void Project_grid_automation_name_lists_every_cell()
    {
        var display = Project(MixedSnapshot(), new SafetyFeaturesSize(2, 4));

        Assert.Contains("Forward Collision Warning High", display.AutomationName);
        Assert.Contains("Speed Limit Warning Off", display.AutomationName);
        Assert.Contains("Cruise Follow Distance 3", display.AutomationName);
    }

    [Fact]
    public void Project_compact_automation_name_combines_count_and_label()
    {
        var display = Project(MixedSnapshot(), new SafetyFeaturesSize(1, 4));
        Assert.Equal("6 Active Features", display.AutomationName);
    }

    // ---- Result mapper (parse + preserve status) -----------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_snapshot()
    {
        using var doc = JsonDocument.Parse(MixedJson);

        var cached = SafetyFeaturesResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(SafetyValueKind.Number, cached.Value!.CruiseFollowDistance.Kind);

        var offline = SafetyFeaturesResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));

        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.False(offline.Value!.AutomaticEmergencyBrakingOff.BoolValue);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(MixedJson);

        Assert.Equal(LoadStatus.Loaded, SafetyFeaturesResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, SafetyFeaturesResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, SafetyFeaturesResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_null_body_to_empty()
    {
        // Web parity: a successful response with no safety object (data == null) → the empty surface.
        using var doc = JsonDocument.Parse("null");

        var mapped = SafetyFeaturesResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<SafetySnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SafetyFeaturesState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_grid_display()
    {
        using var vm = NewViewModel(Loaded(MixedSnapshot()));
        await vm.LoadAsync();

        Assert.Equal(SafetyFeaturesState.Loaded, vm.State);
        Assert.True(vm.HasSnapshot);
        Assert.NotNull(vm.Display);
        Assert.False(vm.Display!.IsCompact);
        Assert.Equal(8, vm.Display.Cells.Count);
        Assert.Equal(6, vm.Display.ActiveCount);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<SafetySnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SafetyFeaturesState.Empty, vm.State);
        Assert.False(vm.HasSnapshot);
        Assert.Null(vm.Display);
        Assert.Equal("No safety data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<SafetySnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SafetyFeaturesState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<SafetySnapshot>.Cached(MixedSnapshot(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SafetyFeaturesState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasSnapshot);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<SafetySnapshot>.OfflineCached(
            MixedSnapshot(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SafetyFeaturesState.Offline, vm.State);
        Assert.True(vm.HasSnapshot);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<SafetySnapshot>.Loading(),
            RepositoryResult<SafetySnapshot>.Cached(EmptySnapshot(), Now, stale: false),
            RepositoryResult<SafetySnapshot>.Loaded(MixedSnapshot(), Now));
        await vm.LoadAsync();

        Assert.Equal(SafetyFeaturesState.Loaded, vm.State);
        Assert.Equal(6, vm.Display!.ActiveCount);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_layout()
    {
        using var vm = NewViewModel(Loaded(MixedSnapshot()));
        await vm.LoadAsync();
        Assert.False(vm.Display!.IsCompact);

        vm.Size = new SafetyFeaturesSize(1, 4); // → compact count layout
        Assert.True(vm.Display!.IsCompact);
        Assert.Equal(SafetyFeaturesState.Loaded, vm.State);
        Assert.Equal("6", vm.Display.ActiveCountText);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<SafetySnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Safety Features", vm.Title);
        Assert.Equal("No safety data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(MixedSnapshot()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SafetyFeaturesViewModel.State), changed);
        Assert.Contains(nameof(SafetyFeaturesViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("safety-features", SafetyFeaturesRegistration.Id);
        Assert.Equal("security", SafetyFeaturesRegistration.Category);
        Assert.Equal("SafetyFeaturesWidget", SafetyFeaturesRegistration.Slug);
        Assert.Equal(new SafetyFeaturesSize(2, 4), SafetyFeaturesRegistration.DefaultSize);
        Assert.Equal(new SafetyFeaturesSize(1, 2), SafetyFeaturesRegistration.MinSize);
        Assert.Equal(new SafetyFeaturesSize(4, 40), SafetyFeaturesRegistration.MaxSize);
        Assert.Equal("Safety Features", SafetyFeaturesRegistration.Name(Localizer));
        Assert.Equal("ADAS status: autopilot, collision warning, lane departure, blind spot", SafetyFeaturesRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(4, 40, true)]   // max
    [InlineData(2, 4, true)]    // default
    [InlineData(5, 4, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(4, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, SafetyFeaturesRegistration.IsWithinBounds(new SafetyFeaturesSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new SafetyFeaturesSize(1, 2), SafetyFeaturesRegistration.Clamp(new SafetyFeaturesSize(0, 0)));
        Assert.Equal(new SafetyFeaturesSize(4, 40), SafetyFeaturesRegistration.Clamp(new SafetyFeaturesSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SafetyFeaturesDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SafetyFeaturesWidget", Assert.Single(lines));
    }

    // ---- Source (single-endpoint per-vehicle adapter) ------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new SafetyFeaturesSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_safety()
    {
        using var safety = JsonDocument.Parse(MixedJson);
        var api = new FakeApiClient().ReturnsValue(safety.RootElement);
        var source = new SafetyFeaturesSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(SafetyValueKind.Number, terminal.Value!.CruiseFollowDistance.Kind);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_safety_latest", request.OperationId);
        Assert.Equal(7L, Assert.IsType<long>(request.Query!["vehicle_id"]));
        Assert.True(request.PathParams is null || request.PathParams.Count == 0);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var safety = JsonDocument.Parse(MixedJson);
        var api = new FakeApiClient().ReturnsValue(safety.RootElement);
        var source = new SafetyFeaturesSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(42L, Assert.IsType<long>(api.Requests[^1].Query!["vehicle_id"]));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_null_body_collapses_to_empty()
    {
        using var nullBody = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(nullBody.RootElement);
        var source = new SafetyFeaturesSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static SafetyFeaturesDisplay Project(SafetySnapshot snapshot, SafetyFeaturesSize size) =>
        SafetyFeaturesProjection.Project(snapshot, size, Localizer);

    private static SafetySnapshot MixedSnapshot()
    {
        using var doc = JsonDocument.Parse(MixedJson);
        return SafetySnapshot.FromResponse(doc.RootElement)!;
    }

    private static SafetySnapshot EmptySnapshot()
    {
        using var doc = JsonDocument.Parse("{}");
        return SafetySnapshot.FromResponse(doc.RootElement)!;
    }

    private static async Task<List<RepositoryResult<SafetySnapshot>>> Drain(ISafetyFeaturesSource source)
    {
        var list = new List<RepositoryResult<SafetySnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<SafetySnapshot> Loaded(SafetySnapshot snapshot) =>
        RepositoryResult<SafetySnapshot>.Loaded(snapshot, Now);

    private static SafetyFeaturesViewModel NewViewModel(params RepositoryResult<SafetySnapshot>[] emissions) =>
        new(new FakeSafetyFeaturesSource(emissions), Localizer, SafetyFeaturesRegistration.DefaultSize);

    private sealed class FakeSafetyFeaturesSource(params RepositoryResult<SafetySnapshot>[] emissions) : ISafetyFeaturesSource
    {
        public async IAsyncEnumerable<RepositoryResult<SafetySnapshot>> StreamAsync(
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
