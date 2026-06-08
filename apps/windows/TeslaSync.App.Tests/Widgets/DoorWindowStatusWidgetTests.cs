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
/// Headless verification of the DoorWindowStatusWidget's UI-thread-free logic — the JSON parse adapter (the
/// useSecurityLatest read), the web-faithful <c>parseWindowState</c> / <c>parseDoorStates</c> parsers, the
/// status / value mapping, the open-door / open-window counts, the compact-badge + grid projection, the
/// Narrator names, the result mapper, the single-endpoint per-vehicle data source (primary resolution + the
/// query-scoped security read), the registry metadata, the diagnostics, and the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline) plus footprint re-projection.
/// Mirrors the web spec (web/src/features/dashboard/widgets/DoorWindowStatusWidget.tsx).
/// </summary>
public sealed class DoorWindowStatusWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string ClosedJson =
        """{"vehicle_id":7,"ts":"2026-06-06T12:00:00Z","door_state":"all_closed","fd_window":"closed","fp_window":"closed","rd_window":"closed","rp_window":"closed","locked":true}""";

    private const string OpenJson =
        """{"vehicle_id":7,"door_state":"driver_front_open","fd_window":"open","fp_window":"vent","rd_window":false,"rp_window":"closed"}""";

    // ---- Parse adapter (web useSecurityLatest read) --------------------------------

    [Fact]
    public void FromResponse_parses_closed_doors_and_windows()
    {
        using var doc = JsonDocument.Parse(ClosedJson);

        var reading = DoorWindowReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(DoorWindowSet.All(DoorWindowState.Closed), reading!.Doors);
        Assert.Equal(DoorWindowSet.All(DoorWindowState.Closed), reading.Windows);
    }

    [Fact]
    public void FromResponse_parses_mixed_open_doors_and_windows()
    {
        using var doc = JsonDocument.Parse(OpenJson);

        var reading = DoorWindowReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        // door_state "driver_front_open" → fl open, others default closed.
        Assert.Equal(new DoorWindowSet(DoorWindowState.Open, DoorWindowState.Closed, DoorWindowState.Closed, DoorWindowState.Closed), reading!.Doors);
        // fd=open, fp=vent→partial, rd=false→closed, rp="closed"→closed.
        Assert.Equal(new DoorWindowSet(DoorWindowState.Open, DoorWindowState.Partial, DoorWindowState.Closed, DoorWindowState.Closed), reading.Windows);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_door_window_fields()
    {
        // Web parity: securityData is truthy but door_state / windows are undefined → all "unknown".
        using var doc = JsonDocument.Parse("""{"ts":"t","locked":true}""");

        var reading = DoorWindowReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(DoorWindowSet.All(DoorWindowState.Unknown), reading!.Doors);
        Assert.Equal(DoorWindowSet.All(DoorWindowState.Unknown), reading.Windows);
    }

    [Fact]
    public void FromResponse_reads_native_boolean_door_state()
    {
        using var open = JsonDocument.Parse("""{"door_state":true}""");
        using var closed = JsonDocument.Parse("""{"door_state":false}""");

        Assert.Equal(DoorWindowSet.All(DoorWindowState.Open), DoorWindowReading.FromResponse(open.RootElement)!.Doors);
        Assert.Equal(DoorWindowSet.All(DoorWindowState.Closed), DoorWindowReading.FromResponse(closed.RootElement)!.Doors);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("\"x\"")]
    [InlineData("5")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(DoorWindowReading.FromResponse(doc.RootElement));
    }

    // ---- DoorWindowScalar narrowing (web typeof boolean / asNonEmptyString) ---------

    [Fact]
    public void Scalar_read_narrows_each_json_kind()
    {
        using var doc = JsonDocument.Parse("""{"b":true,"s":"open","empty":"","n":3,"z":null}""");
        var obj = doc.RootElement;

        Assert.Equal(DoorWindowScalarKind.Boolean, DoorWindowScalar.Read(obj, "b").Kind);
        Assert.Equal(DoorWindowScalarKind.Text, DoorWindowScalar.Read(obj, "s").Kind);
        Assert.Equal(DoorWindowScalarKind.None, DoorWindowScalar.Read(obj, "empty").Kind); // empty string → None (web asNonEmptyString)
        Assert.Equal(DoorWindowScalarKind.None, DoorWindowScalar.Read(obj, "n").Kind);     // number → None
        Assert.Equal(DoorWindowScalarKind.None, DoorWindowScalar.Read(obj, "z").Kind);     // null → None
        Assert.Equal(DoorWindowScalarKind.None, DoorWindowScalar.Read(obj, "missing").Kind); // absent → None
    }

    // ---- parseWindowState (web) ----------------------------------------------------

    [Fact]
    public void ParseWindowState_handles_native_boolean()
    {
        Assert.Equal(DoorWindowState.Open, DoorWindowStatusProjection.ParseWindowState(DoorWindowScalar.FromBoolean(true)));
        Assert.Equal(DoorWindowState.Closed, DoorWindowStatusProjection.ParseWindowState(DoorWindowScalar.FromBoolean(false)));
    }

    [Theory]
    [InlineData("closed", DoorWindowState.Closed)]
    [InlineData("CLOSED", DoorWindowState.Closed)]
    [InlineData("vent", DoorWindowState.Partial)]
    [InlineData("Vented", DoorWindowState.Partial)]
    [InlineData("partial", DoorWindowState.Partial)]
    [InlineData("open", DoorWindowState.Open)]
    [InlineData("ajar", DoorWindowState.Open)]
    public void ParseWindowState_matches_web_string_rules(string raw, DoorWindowState expected) =>
        Assert.Equal(expected, DoorWindowStatusProjection.ParseWindowState(DoorWindowScalar.FromText(raw)));

    [Fact]
    public void ParseWindowState_none_is_unknown() =>
        Assert.Equal(DoorWindowState.Unknown, DoorWindowStatusProjection.ParseWindowState(DoorWindowScalar.None));

    // ---- parseDoorStates (web) -----------------------------------------------------

    [Fact]
    public void ParseDoorStates_native_boolean_opens_or_closes_all()
    {
        Assert.Equal(DoorWindowSet.All(DoorWindowState.Open), DoorWindowStatusProjection.ParseDoorStates(DoorWindowScalar.FromBoolean(true)));
        Assert.Equal(DoorWindowSet.All(DoorWindowState.Closed), DoorWindowStatusProjection.ParseDoorStates(DoorWindowScalar.FromBoolean(false)));
    }

    [Theory]
    [InlineData("all_closed")]
    [InlineData("allclosed")]
    [InlineData("ALL_CLOSED")]
    public void ParseDoorStates_all_closed_literal_closes_all(string raw) =>
        Assert.Equal(DoorWindowSet.All(DoorWindowState.Closed), DoorWindowStatusProjection.ParseDoorStates(DoorWindowScalar.FromText(raw)));

    [Fact]
    public void ParseDoorStates_opens_named_corners_and_defaults_rest_closed()
    {
        Assert.Equal(
            new DoorWindowSet(DoorWindowState.Open, DoorWindowState.Closed, DoorWindowState.Closed, DoorWindowState.Closed),
            DoorWindowStatusProjection.ParseDoorStates(DoorWindowScalar.FromText("driver_front_open")));

        Assert.Equal(
            new DoorWindowSet(DoorWindowState.Closed, DoorWindowState.Closed, DoorWindowState.Closed, DoorWindowState.Open),
            DoorWindowStatusProjection.ParseDoorStates(DoorWindowScalar.FromText("passenger_rear_open")));

        // Multiple comma-separated parts, geometric naming (front/left, rear/right).
        Assert.Equal(
            new DoorWindowSet(DoorWindowState.Open, DoorWindowState.Closed, DoorWindowState.Closed, DoorWindowState.Open),
            DoorWindowStatusProjection.ParseDoorStates(DoorWindowScalar.FromText("front_left_open, rear_right_open")));
    }

    [Fact]
    public void ParseDoorStates_bare_open_opens_all()
    {
        Assert.Equal(DoorWindowSet.All(DoorWindowState.Open), DoorWindowStatusProjection.ParseDoorStates(DoorWindowScalar.FromText("open")));
    }

    [Fact]
    public void ParseDoorStates_none_or_blank_is_all_unknown()
    {
        Assert.Equal(DoorWindowSet.All(DoorWindowState.Unknown), DoorWindowStatusProjection.ParseDoorStates(DoorWindowScalar.None));
        // A non-empty but all-whitespace string splits to zero parts → all unknown (web filter(Boolean)).
        Assert.Equal(DoorWindowSet.All(DoorWindowState.Unknown), DoorWindowStatusProjection.ParseDoorStates(DoorWindowScalar.FromText("   ")));
    }

    // ---- status + value mapping (web toGridStatus / toValueLabel) -------------------

    [Theory]
    [InlineData(DoorWindowState.Closed, StatusKind.Success)]
    [InlineData(DoorWindowState.Open, StatusKind.Warning)]
    [InlineData(DoorWindowState.Partial, StatusKind.Warning)]
    [InlineData(DoorWindowState.Unknown, StatusKind.Neutral)]
    public void ToStatusKind_matches_web(DoorWindowState state, StatusKind expected) =>
        Assert.Equal(expected, DoorWindowStatusProjection.ToStatusKind(state));

    [Theory]
    [InlineData(DoorWindowState.Closed, "Closed")]
    [InlineData(DoorWindowState.Open, "Open")]
    [InlineData(DoorWindowState.Partial, "Partial")]
    [InlineData(DoorWindowState.Unknown, "\u2014")]
    public void ValueLabel_matches_web(DoorWindowState state, string expected) =>
        Assert.Equal(expected, DoorWindowStatusProjection.ValueLabel(state, Localizer));

    // ---- open counts (web openDoorCount / openWindowCount) -------------------------

    [Fact]
    public void OpenDoorCount_counts_only_open_corners()
    {
        var doors = new DoorWindowSet(DoorWindowState.Open, DoorWindowState.Open, DoorWindowState.Closed, DoorWindowState.Unknown);
        Assert.Equal(2, DoorWindowStatusProjection.OpenDoorCount(doors));
    }

    [Fact]
    public void OpenWindowCount_counts_open_and_partial_but_not_closed_or_unknown()
    {
        var windows = new DoorWindowSet(DoorWindowState.Open, DoorWindowState.Partial, DoorWindowState.Closed, DoorWindowState.Unknown);
        Assert.Equal(2, DoorWindowStatusProjection.OpenWindowCount(windows));
    }

    // ---- Projection: grid cells ----------------------------------------------------

    [Fact]
    public void Project_builds_four_door_and_four_window_cells()
    {
        var display = DoorWindowStatusProjection.Project(Reading(), new DoorWindowStatusSize(2, 2), Localizer);

        Assert.False(display.IsCompact);
        Assert.Equal("Doors", display.DoorsHeading);
        Assert.Equal("Windows", display.WindowsHeading);
        Assert.Equal(4, display.DoorCells.Count);
        Assert.Equal(4, display.WindowCells.Count);

        Assert.Equal("door-fl", display.DoorCells[0].Id);
        Assert.Equal("Front Left", display.DoorCells[0].Label);
        Assert.Equal("Open", display.DoorCells[0].Value);
        Assert.Equal(StatusKind.Warning, display.DoorCells[0].Status);

        Assert.Equal("Closed", display.DoorCells[1].Value);
        Assert.Equal(StatusKind.Success, display.DoorCells[1].Status);

        Assert.Equal("window-fr", display.WindowCells[1].Id);
        Assert.Equal("Partial", display.WindowCells[1].Value);
        Assert.Equal(StatusKind.Warning, display.WindowCells[1].Status);
    }

    [Fact]
    public void Project_unknown_corner_uses_em_dash_and_neutral()
    {
        var reading = new DoorWindowReading(DoorWindowSet.All(DoorWindowState.Unknown), DoorWindowSet.All(DoorWindowState.Unknown));

        var display = DoorWindowStatusProjection.Project(reading, new DoorWindowStatusSize(2, 2), Localizer);

        Assert.All(display.DoorCells, c =>
        {
            Assert.Equal("\u2014", c.Value);
            Assert.Equal(StatusKind.Neutral, c.Status);
        });
    }

    [Fact]
    public void Project_tall_flag_tracks_rows()
    {
        Assert.True(DoorWindowStatusProjection.Project(Reading(), new DoorWindowStatusSize(2, 2), Localizer).IsTall);
        Assert.False(DoorWindowStatusProjection.Project(Reading(), new DoorWindowStatusSize(2, 1), Localizer).IsTall);
    }

    // ---- Projection: compact badges ------------------------------------------------

    [Fact]
    public void Project_compact_badges_warn_when_open()
    {
        var display = DoorWindowStatusProjection.Project(Reading(), new DoorWindowStatusSize(1, 1), Localizer);

        Assert.True(display.IsCompact);
        Assert.Equal(1, display.OpenDoorCount);
        Assert.Equal(2, display.OpenWindowCount);
        Assert.Equal("1 door(s) open", display.DoorBadgeText);
        Assert.Equal(StatusKind.Warning, display.DoorBadgeStatus);
        Assert.Equal("2 window(s) open", display.WindowBadgeText);
        Assert.Equal(StatusKind.Warning, display.WindowBadgeStatus);
    }

    [Fact]
    public void Project_compact_badges_succeed_when_all_closed()
    {
        var reading = new DoorWindowReading(DoorWindowSet.All(DoorWindowState.Closed), DoorWindowSet.All(DoorWindowState.Closed));

        var display = DoorWindowStatusProjection.Project(reading, new DoorWindowStatusSize(1, 1), Localizer);

        Assert.Equal("Doors \u2713", display.DoorBadgeText);
        Assert.Equal(StatusKind.Success, display.DoorBadgeStatus);
        Assert.Equal("Windows \u2713", display.WindowBadgeText);
        Assert.Equal(StatusKind.Success, display.WindowBadgeStatus);
    }

    // ---- Accessibility (Narrator names) --------------------------------------------

    [Fact]
    public void Project_cell_automation_name_combines_label_and_value()
    {
        var display = DoorWindowStatusProjection.Project(Reading(), new DoorWindowStatusSize(2, 2), Localizer);

        Assert.Equal("Front Left Open", display.DoorCells[0].AutomationName);
        Assert.Equal("Front Right Partial", display.WindowCells[1].AutomationName);
    }

    [Fact]
    public void Project_grid_automation_name_summarises_both_sections()
    {
        var display = DoorWindowStatusProjection.Project(Reading(), new DoorWindowStatusSize(2, 2), Localizer);

        Assert.Contains("Doors:", display.AutomationName);
        Assert.Contains("Windows:", display.AutomationName);
        Assert.Contains("Front Left Open", display.AutomationName);
    }

    [Fact]
    public void Project_compact_automation_name_combines_both_badges()
    {
        var display = DoorWindowStatusProjection.Project(Reading(), new DoorWindowStatusSize(1, 1), Localizer);

        Assert.Equal("1 door(s) open, 2 window(s) open", display.AutomationName);
    }

    // ---- Result mapper (parse + preserve status) -----------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_reading()
    {
        using var doc = JsonDocument.Parse(OpenJson);

        var cached = DoorWindowStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(DoorWindowState.Open, cached.Value!.Doors.Fl);

        var offline = DoorWindowStatusResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));

        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(DoorWindowState.Partial, offline.Value!.Windows.Fr);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(ClosedJson);

        Assert.Equal(LoadStatus.Loaded, DoorWindowStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, DoorWindowStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, DoorWindowStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_null_body_to_empty()
    {
        // Web parity: a successful response with no security object (securityData == null) → the empty surface.
        using var doc = JsonDocument.Parse("null");

        var mapped = DoorWindowStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<DoorWindowReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(DoorWindowStatusState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_grid_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();

        Assert.Equal(DoorWindowStatusState.Loaded, vm.State);
        Assert.True(vm.HasReading);
        Assert.NotNull(vm.Display);
        Assert.False(vm.Display!.IsCompact);
        Assert.Equal(4, vm.Display.DoorCells.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<DoorWindowReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(DoorWindowStatusState.Empty, vm.State);
        Assert.False(vm.HasReading);
        Assert.Null(vm.Display);
        Assert.Equal("No door/window data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<DoorWindowReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(DoorWindowStatusState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<DoorWindowReading>.Cached(Reading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(DoorWindowStatusState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasReading);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<DoorWindowReading>.OfflineCached(
            Reading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(DoorWindowStatusState.Offline, vm.State);
        Assert.True(vm.HasReading);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<DoorWindowReading>.Loading(),
            RepositoryResult<DoorWindowReading>.Cached(new DoorWindowReading(DoorWindowSet.All(DoorWindowState.Closed), DoorWindowSet.All(DoorWindowState.Closed)), Now, stale: false),
            RepositoryResult<DoorWindowReading>.Loaded(Reading(), Now));
        await vm.LoadAsync();

        Assert.Equal(DoorWindowStatusState.Loaded, vm.State);
        Assert.Equal(1, vm.Display!.OpenDoorCount);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_layout()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();
        Assert.False(vm.Display!.IsCompact);

        vm.Size = new DoorWindowStatusSize(1, 1); // → compact badge layout
        Assert.True(vm.Display!.IsCompact);
        Assert.Equal(DoorWindowStatusState.Loaded, vm.State);
        Assert.Equal("1 door(s) open", vm.Display.DoorBadgeText);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<DoorWindowReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Door & Window Status", vm.Title);
        Assert.Equal("No door/window data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(DoorWindowStatusViewModel.State), changed);
        Assert.Contains(nameof(DoorWindowStatusViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("door-window-status", DoorWindowStatusRegistration.Id);
        Assert.Equal("security", DoorWindowStatusRegistration.Category);
        Assert.Equal("DoorWindowStatusWidget", DoorWindowStatusRegistration.Slug);
        Assert.Equal(new DoorWindowStatusSize(2, 2), DoorWindowStatusRegistration.DefaultSize);
        Assert.Equal(new DoorWindowStatusSize(1, 2), DoorWindowStatusRegistration.MinSize);
        Assert.Equal(new DoorWindowStatusSize(4, 40), DoorWindowStatusRegistration.MaxSize);
        Assert.Equal("Door & Window Status", DoorWindowStatusRegistration.Name(Localizer));
        Assert.Equal("Grid showing 4 doors + 4 windows with open/closed/partial badges", DoorWindowStatusRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(4, 40, true)]   // max
    [InlineData(2, 2, true)]    // default
    [InlineData(5, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(4, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, DoorWindowStatusRegistration.IsWithinBounds(new DoorWindowStatusSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new DoorWindowStatusSize(1, 2), DoorWindowStatusRegistration.Clamp(new DoorWindowStatusSize(0, 0)));
        Assert.Equal(new DoorWindowStatusSize(4, 40), DoorWindowStatusRegistration.Clamp(new DoorWindowStatusSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DoorWindowStatusDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DoorWindowStatusWidget", Assert.Single(lines));
    }

    // ---- Source (single-endpoint per-vehicle adapter) ------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new DoorWindowStatusSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_security()
    {
        using var security = JsonDocument.Parse(OpenJson);
        var api = new FakeApiClient().ReturnsValue(security.RootElement);
        var source = new DoorWindowStatusSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(DoorWindowState.Open, terminal.Value!.Doors.Fl);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_security_latest", request.OperationId);
        Assert.Equal(7L, Assert.IsType<long>(request.Query!["vehicle_id"]));
        Assert.True(request.PathParams is null || request.PathParams.Count == 0);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var security = JsonDocument.Parse(ClosedJson);
        var api = new FakeApiClient().ReturnsValue(security.RootElement);
        var source = new DoorWindowStatusSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(42L, Assert.IsType<long>(api.Requests[^1].Query!["vehicle_id"]));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(DoorWindowSet.All(DoorWindowState.Closed), results[^1].Value!.Doors);
    }

    [Fact]
    public async Task Source_null_body_collapses_to_empty()
    {
        using var nullBody = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(nullBody.RootElement);
        var source = new DoorWindowStatusSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    // fl door open; fr/rl/rr closed. fl window open, fr window partial, rl/rr closed.
    private static DoorWindowReading Reading() => new(
        new DoorWindowSet(DoorWindowState.Open, DoorWindowState.Closed, DoorWindowState.Closed, DoorWindowState.Closed),
        new DoorWindowSet(DoorWindowState.Open, DoorWindowState.Partial, DoorWindowState.Closed, DoorWindowState.Closed));

    private static async Task<List<RepositoryResult<DoorWindowReading>>> Drain(IDoorWindowStatusSource source)
    {
        var list = new List<RepositoryResult<DoorWindowReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<DoorWindowReading> Loaded(DoorWindowReading reading) =>
        RepositoryResult<DoorWindowReading>.Loaded(reading, Now);

    private static DoorWindowStatusViewModel NewViewModel(params RepositoryResult<DoorWindowReading>[] emissions) =>
        new(new FakeDoorWindowStatusSource(emissions), Localizer, DoorWindowStatusRegistration.DefaultSize);

    private sealed class FakeDoorWindowStatusSource(params RepositoryResult<DoorWindowReading>[] emissions) : IDoorWindowStatusSource
    {
        public async IAsyncEnumerable<RepositoryResult<DoorWindowReading>> StreamAsync(
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
