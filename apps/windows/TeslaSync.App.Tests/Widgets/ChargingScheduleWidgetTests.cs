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
/// Headless verification of the ChargingScheduleWidget's UI-thread-free logic — the live-signals parse adapter
/// (the web <c>parseScheduleSignals</c> type guards + the <c>hasScheduleData</c> gate, including the
/// departure-only quirk), the supplementary <c>useVehicleState</c> normalisation, the mode label / badge variant,
/// the timeline composition (Start Charging / Departure / Target Limit, ordering + colours + the time / percent
/// formatters), the compact + tall projection branches, the parse-combine result mapper, the two-endpoint
/// per-vehicle data source (primary resolution, the best-effort state read, the path-scoped live read, the
/// generated operation ids), the registry metadata, the diagnostics, the Narrator labels, and the state-holder
/// view-model's per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/ChargingScheduleWidget.tsx).
/// </summary>
public sealed class ChargingScheduleWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string EmDash = "\u2014";

    // A full live-signals body: every schedule field present (web res.signals map of { value, timestamp }).
    private const string FullSignalsJson =
        """
        {"signals":{
          "ScheduledChargingMode":{"value":"StartAt","timestamp":"2026-06-06T00:00:00Z"},
          "ScheduledChargingPending":{"value":true,"timestamp":"2026-06-06T00:00:00Z"},
          "ScheduledChargingStartTime":{"value":"2026-06-07T03:00:00Z","timestamp":"2026-06-06T00:00:00Z"},
          "ScheduledDepartureTime":{"value":"2026-06-07T08:00:00Z","timestamp":"2026-06-06T00:00:00Z"},
          "ChargeLimitSoc":{"value":80,"timestamp":"2026-06-06T00:00:00Z"}
        }}
        """;

    private const string StateJson =
        """{"state":{"vehicle_id":7,"battery_level":80,"is_charging":true}}""";

    // ---- Live-signals parse adapter (web parseScheduleSignals) ----------------------

    [Fact]
    public void FromLiveResponse_reads_every_schedule_signal()
    {
        using var doc = JsonDocument.Parse(FullSignalsJson);

        var schedule = ScheduleReading.FromLiveResponse(doc.RootElement);

        Assert.Equal("StartAt", schedule.Mode);
        Assert.True(schedule.Pending);
        Assert.Equal("2026-06-07T03:00:00Z", schedule.StartTime);
        Assert.Equal("2026-06-07T08:00:00Z", schedule.DepartureTime);
        Assert.Equal(80, schedule.ChargeLimit);
        Assert.True(schedule.HasScheduleData);
    }

    [Fact]
    public void FromLiveResponse_applies_web_type_guards()
    {
        // Mode/start/departure are kept only when JSON strings; pending honours true/"true"; limit only a number.
        using var doc = JsonDocument.Parse(
            """
            {"signals":{
              "ScheduledChargingMode":{"value":123},
              "ScheduledChargingPending":{"value":"true"},
              "ScheduledChargingStartTime":{"value":true},
              "ChargeLimitSoc":{"value":"90"}
            }}
            """);

        var schedule = ScheduleReading.FromLiveResponse(doc.RootElement);

        Assert.Null(schedule.Mode);          // number → null
        Assert.True(schedule.Pending);       // "true" string → true
        Assert.Null(schedule.StartTime);     // bool → null
        Assert.Null(schedule.ChargeLimit);   // "90" string → null (web typeof === 'number')
        Assert.False(schedule.HasScheduleData);
    }

    [Fact]
    public void FromLiveResponse_tolerates_absent_or_empty_signals_map()
    {
        using var noSignals = JsonDocument.Parse("""{"live":true}""");
        using var emptySignals = JsonDocument.Parse("""{"signals":{}}""");

        foreach (var root in new[] { noSignals.RootElement, emptySignals.RootElement })
        {
            var schedule = ScheduleReading.FromLiveResponse(root);
            Assert.Null(schedule.Mode);
            Assert.Null(schedule.StartTime);
            Assert.Null(schedule.DepartureTime);
            Assert.Null(schedule.ChargeLimit);
            Assert.False(schedule.Pending);
            Assert.False(schedule.HasScheduleData);
        }
    }

    [Theory]
    [InlineData("""{"signals":{"ScheduledChargingMode":{"value":"Off"}}}""", true)]   // mode alone
    [InlineData("""{"signals":{"ScheduledChargingStartTime":{"value":"x"}}}""", true)] // startTime alone
    [InlineData("""{"signals":{"ChargeLimitSoc":{"value":70}}}""", true)]              // limit alone
    [InlineData("""{"signals":{"ScheduledDepartureTime":{"value":"x"}}}""", false)]    // departure alone → web quirk: NOT data
    public void HasScheduleData_mirrors_the_web_gate_including_departure_only_quirk(string json, bool expected)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expected, ScheduleReading.FromLiveResponse(doc.RootElement).HasScheduleData);
    }

    [Fact]
    public void FromLiveResponse_keeps_empty_string_start_time_as_present_for_the_gate()
    {
        // Web parity: startTime === '' is a string, so `startTime != null` is true (hasScheduleData true) even
        // though `if (schedule.startTime)` is falsy (no timeline row).
        using var doc = JsonDocument.Parse("""{"signals":{"ScheduledChargingStartTime":{"value":""}}}""");

        var schedule = ScheduleReading.FromLiveResponse(doc.RootElement);

        Assert.Equal(string.Empty, schedule.StartTime);
        Assert.True(schedule.HasScheduleData);
        Assert.Empty(ChargingScheduleProjection.BuildTimeline(schedule, Localizer));
    }

    // ---- Supplementary vehicle-state adapter (web useVehicleState) ------------------

    [Fact]
    public void State_FromResponse_reads_primary_state_object()
    {
        using var doc = JsonDocument.Parse(StateJson);

        var state = VehicleScheduleState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(80, state!.BatteryLevel);
        Assert.True(state.IsCharging);
    }

    [Fact]
    public void State_FromResponse_falls_back_to_position_battery_and_top_level_charging()
    {
        using var doc = JsonDocument.Parse(
            """{"vehicle":{"id":5},"position":{"battery_level":33},"is_charging":true}""");

        var state = VehicleScheduleState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(33, state!.BatteryLevel);
        Assert.True(state.IsCharging);
    }

    [Fact]
    public void State_FromResponse_returns_null_when_no_state()
    {
        using var doc = JsonDocument.Parse("""{"live":true}""");
        Assert.Null(VehicleScheduleState.FromResponse(doc.RootElement));
    }

    // ---- Mode label / badge variant (web modeLabel / modeBadgeVariant) -------------

    [Theory]
    [InlineData("StartAt", "Start At")]
    [InlineData("DepartBy", "Depart By")]
    [InlineData("Off", "Off")]
    [InlineData("SomethingElse", "SomethingElse")] // web: mode ?? 'Unknown'
    public void ModeLabel_maps_known_modes_and_passes_through_unknown(string mode, string expected) =>
        Assert.Equal(expected, ChargingScheduleProjection.ModeLabel(mode, Localizer));

    [Fact]
    public void ModeLabel_null_mode_is_unknown() =>
        Assert.Equal("Unknown", ChargingScheduleProjection.ModeLabel(null, Localizer));

    [Theory]
    [InlineData("StartAt", StatusKind.Success)]
    [InlineData("DepartBy", StatusKind.Success)]
    [InlineData("Off", StatusKind.Neutral)]
    [InlineData("Weird", StatusKind.Warning)]
    [InlineData(null, StatusKind.Warning)]
    public void ModeStatus_maps_the_web_badge_variant(string? mode, StatusKind expected) =>
        Assert.Equal(expected, ChargingScheduleProjection.ModeStatus(mode));

    // ---- Timeline composition (web timelineItems memo) -----------------------------

    [Fact]
    public void BuildTimeline_orders_start_departure_limit_with_web_colours()
    {
        var schedule = new ScheduleReading("StartAt", Pending: true, StartTime: "2026-06-07T03:00:00Z", DepartureTime: "2026-06-07T08:00:00Z", ChargeLimit: 80);

        var entries = ChargingScheduleProjection.BuildTimeline(schedule, Localizer);

        Assert.Equal(3, entries.Count);

        Assert.Equal("Start Charging", entries[0].Title);
        Assert.Equal("Pending", entries[0].Subtitle);          // pending → subtitle
        Assert.Equal(StatusKind.Success, entries[0].Accent);   // web #22c55e green
        Assert.NotEqual(EmDash, entries[0].TimeText);

        Assert.Equal("Departure", entries[1].Title);
        Assert.Null(entries[1].Subtitle);
        Assert.Equal(StatusKind.Info, entries[1].Accent);      // web #3b82f6 blue

        Assert.Equal("Target Limit", entries[2].Title);
        Assert.Equal("80%", entries[2].TimeText);              // web `${chargeLimit}%`
        Assert.Equal(StatusKind.Warning, entries[2].Accent);   // web #f59e0b amber
    }

    [Fact]
    public void BuildTimeline_omits_pending_subtitle_when_not_pending()
    {
        var schedule = new ScheduleReading("StartAt", Pending: false, StartTime: "2026-06-07T03:00:00Z", DepartureTime: null, ChargeLimit: null);

        var entries = ChargingScheduleProjection.BuildTimeline(schedule, Localizer);

        Assert.Single(entries);
        Assert.Equal("Start Charging", entries[0].Title);
        Assert.Null(entries[0].Subtitle);
    }

    [Fact]
    public void BuildTimeline_target_limit_row_only_when_charge_limit_is_numeric()
    {
        var withLimit = new ScheduleReading("Off", false, null, null, 90);
        var withoutLimit = new ScheduleReading("Off", false, null, null, null);

        Assert.Contains(ChargingScheduleProjection.BuildTimeline(withLimit, Localizer), e => e.Title == "Target Limit");
        Assert.DoesNotContain(ChargingScheduleProjection.BuildTimeline(withoutLimit, Localizer), e => e.Title == "Target Limit");
    }

    // ---- Scalar formatters ----------------------------------------------------------

    [Theory]
    [InlineData(80, "80%")]
    [InlineData(0, "0%")]
    [InlineData(72.5, "72.5%")]
    public void FormatPercent_matches_the_web_interpolation(double value, string expected) =>
        Assert.Equal(expected, ChargingScheduleProjection.FormatPercent(value));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-date")]
    [InlineData("480")] // minutes-since-midnight string → new Date('480') is Invalid → em dash
    public void FormatScheduleTime_returns_em_dash_for_absent_or_unparseable(string? value) =>
        Assert.Equal(EmDash, ChargingScheduleProjection.FormatScheduleTime(value));

    [Fact]
    public void FormatScheduleTime_formats_a_parseable_timestamp_as_time_of_day()
    {
        var formatted = ChargingScheduleProjection.FormatScheduleTime("2026-06-07T15:30:00Z");

        Assert.NotEqual(EmDash, formatted);
        Assert.Matches(@"^\d{2}:\d{2} (AM|PM)$", formatted);
    }

    // ---- Projection composition (compact / tall branches, a11y) --------------------

    [Fact]
    public void Project_full_size_builds_badge_timeline_and_detail_row()
    {
        var display = ChargingScheduleProjection.Project(FullSnapshot(), ChargingScheduleSize.Default, Localizer);

        Assert.False(display.IsCompact);
        Assert.True(display.IsTall);
        Assert.Equal("Start At", display.ModeLabel);
        Assert.Equal(StatusKind.Success, display.ModeStatus);
        Assert.True(display.Pending);
        Assert.True(display.HasTimelineEntries);
        Assert.Equal(3, display.TimelineEntries.Count);
        Assert.True(display.ShowDetailRow);
        Assert.Equal("80%", display.CurrentLevelText);
        Assert.Equal("Charging", display.StatusText);
    }

    [Fact]
    public void Project_compact_size_builds_the_big_limit_readout()
    {
        var display = ChargingScheduleProjection.Project(FullSnapshot(), new ChargingScheduleSize(1, 1), Localizer);

        Assert.True(display.IsCompact);
        Assert.False(display.IsTall);
        Assert.Equal("80%", display.CompactLimitText);
        Assert.False(display.ShowDetailRow); // not tall
    }

    [Fact]
    public void Project_compact_limit_is_em_dash_when_no_charge_limit()
    {
        var snapshot = new ChargingScheduleSnapshot(new ScheduleReading("StartAt", false, "2026-06-07T03:00:00Z", null, null), null);

        var display = ChargingScheduleProjection.Project(snapshot, new ChargingScheduleSize(1, 1), Localizer);

        Assert.Equal(EmDash, display.CompactLimitText);
    }

    [Fact]
    public void Project_hides_detail_row_when_state_is_absent()
    {
        var display = ChargingScheduleProjection.Project(SnapshotNoState(), ChargingScheduleSize.Default, Localizer);

        Assert.False(display.ShowDetailRow);
    }

    [Fact]
    public void Project_status_text_reflects_not_charging()
    {
        var snapshot = new ChargingScheduleSnapshot(FullSchedule(), new VehicleScheduleState(55, IsCharging: false));

        var display = ChargingScheduleProjection.Project(snapshot, ChargingScheduleSize.Default, Localizer);

        Assert.Equal("55%", display.CurrentLevelText);
        Assert.Equal("Not Charging", display.StatusText);
    }

    [Fact]
    public void Project_builds_a_narrator_summary_and_per_row_labels()
    {
        var display = ChargingScheduleProjection.Project(FullSnapshot(), ChargingScheduleSize.Default, Localizer);

        Assert.False(string.IsNullOrWhiteSpace(display.AutomationName));
        Assert.Contains("Start At", display.AutomationName);
        Assert.Contains("Current Level", display.AutomationName);
        Assert.All(display.TimelineEntries, e => Assert.False(string.IsNullOrWhiteSpace(e.AutomationName)));
    }

    // ---- Result mapper (parse + combine + preserve) --------------------------------

    [Fact]
    public void Map_loaded_with_schedule_attaches_state()
    {
        using var doc = JsonDocument.Parse(FullSignalsJson);
        var state = new VehicleScheduleState(80, true);

        var mapped = ChargingScheduleResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now), state);

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.Equal("StartAt", mapped.Value!.Schedule.Mode);
        Assert.Same(state, mapped.Value.State);
    }

    [Fact]
    public void Map_loaded_without_schedule_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("""{"signals":{}}""");

        var mapped = ChargingScheduleResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now), null);

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    [Fact]
    public void Map_preserves_cached_stale_and_offline()
    {
        using var doc = JsonDocument.Parse(FullSignalsJson);

        var cached = ChargingScheduleResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true), null);
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);

        var offline = ChargingScheduleResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "x")), null);
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.NotNull(offline.Value);
    }

    [Fact]
    public void Map_failure_propagates_error()
    {
        var mapped = ChargingScheduleResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")), null);

        Assert.Equal(LoadStatus.Error, mapped.Status);
        Assert.NotNull(mapped.Error);
    }

    // ---- View-model state transitions (web WidgetShell branches) --------------------

    [Fact]
    public async Task ViewModel_loaded_schedule_renders_loaded_with_display()
    {
        using var vm = NewViewModel(Loaded(FullSnapshot()));
        await vm.LoadAsync();

        Assert.Equal(ChargingScheduleState.Loaded, vm.State);
        Assert.True(vm.HasSchedule);
        Assert.Equal("Start At", vm.Display!.ModeLabel);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingScheduleSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ChargingScheduleState.Empty, vm.State);
        Assert.False(vm.HasSchedule);
        Assert.Null(vm.Display);
        Assert.Equal("No schedule data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingScheduleSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ChargingScheduleState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingScheduleSnapshot>.Cached(FullSnapshot(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ChargingScheduleState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasSchedule);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingScheduleSnapshot>.OfflineCached(
            FullSnapshot(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ChargingScheduleState.Offline, vm.State);
        Assert.True(vm.HasSchedule);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingScheduleSnapshot>.Loading(),
            RepositoryResult<ChargingScheduleSnapshot>.Cached(SnapshotNoState(), Now, stale: false),
            RepositoryResult<ChargingScheduleSnapshot>.Loaded(FullSnapshot(), Now));
        await vm.LoadAsync();

        Assert.Equal(ChargingScheduleState.Loaded, vm.State);
        Assert.True(vm.Display!.ShowDetailRow);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(ChargingScheduleSize.Default, Loaded(FullSnapshot()));
        await vm.LoadAsync();
        Assert.False(vm.Display!.IsCompact);
        Assert.True(vm.Display.ShowDetailRow);

        vm.Size = new ChargingScheduleSize(1, 1);
        Assert.True(vm.Display!.IsCompact);
        Assert.False(vm.Display.ShowDetailRow);
        Assert.Equal(ChargingScheduleState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingScheduleSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Charging Schedule", vm.Title);
        Assert.Equal("No schedule data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(FullSnapshot()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ChargingScheduleViewModel.State), changed);
        Assert.Contains(nameof(ChargingScheduleViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("charging-schedule", ChargingScheduleRegistration.Id);
        Assert.Equal("charging", ChargingScheduleRegistration.Category);
        Assert.Equal("ChargingScheduleWidget", ChargingScheduleRegistration.Slug);
        Assert.Equal(new ChargingScheduleSize(2, 2), ChargingScheduleRegistration.DefaultSize);
        Assert.Equal(new ChargingScheduleSize(1, 2), ChargingScheduleRegistration.MinSize);
        Assert.Equal(new ChargingScheduleSize(4, 40), ChargingScheduleRegistration.MaxSize);
        Assert.Equal("Charging Schedule", ChargingScheduleRegistration.Name(Localizer));
        Assert.Contains("scheduled charge", ChargingScheduleRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(4, 40, true)]   // max
    [InlineData(2, 10, true)]   // inside
    [InlineData(5, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, ChargingScheduleRegistration.IsWithinBounds(new ChargingScheduleSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new ChargingScheduleSize(1, 2), ChargingScheduleRegistration.Clamp(new ChargingScheduleSize(0, 0)));
        Assert.Equal(new ChargingScheduleSize(4, 40), ChargingScheduleRegistration.Clamp(new ChargingScheduleSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChargingScheduleDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargingScheduleWidget", Assert.Single(lines));
    }

    // ---- Source (two-endpoint per-vehicle adapter) ---------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new ChargingScheduleSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_then_state_then_live_signals()
    {
        using var state = JsonDocument.Parse(StateJson);
        using var signals = JsonDocument.Parse(FullSignalsJson);
        var api = new FakeApiClient()
            .ReturnsValue(state.RootElement)   // supplementary state read happens first
            .ReturnsValue(signals.RootElement);
        var source = new ChargingScheduleSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal("StartAt", terminal.Value!.Schedule.Mode);
        Assert.NotNull(terminal.Value.State);
        Assert.Equal(80, terminal.Value.State!.BatteryLevel);
        Assert.True(terminal.Value.State.IsCharging);

        Assert.Equal(2, api.Requests.Count);
        Assert.Equal("get_api_v1_vehicles_vehicleID_state", api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].PathParams!["vehicleID"]);
        Assert.Equal("get_api_v1_signals_vehicleID_live", api.Requests[1].OperationId);
        Assert.Equal("7", api.Requests[1].PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var state = JsonDocument.Parse("""{"state":{"vehicle_id":42,"battery_level":50,"is_charging":false}}""");
        using var signals = JsonDocument.Parse(FullSignalsJson);
        var api = new FakeApiClient().ReturnsValue(state.RootElement).ReturnsValue(signals.RootElement);
        var source = new ChargingScheduleSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal("42", api.Requests[^1].PathParams!["vehicleID"]);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_schedule_less_signals_collapses_to_empty()
    {
        using var state = JsonDocument.Parse(StateJson);
        using var signals = JsonDocument.Parse("""{"signals":{}}""");
        var api = new FakeApiClient().ReturnsValue(state.RootElement).ReturnsValue(signals.RootElement);
        var source = new ChargingScheduleSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public async Task Source_state_failure_does_not_fail_the_surface()
    {
        using var signals = JsonDocument.Parse(FullSignalsJson);
        var api = new FakeApiClient()
            .Throws(new HttpRequestException("state down")) // best-effort state read fails
            .ReturnsValue(signals.RootElement);
        var source = new ChargingScheduleSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status); // schedule still loads
        Assert.Equal("StartAt", terminal.Value!.Schedule.Mode);
        Assert.Null(terminal.Value.State); // state collapses to null, never throws
        Assert.Equal(2, api.Requests.Count);
    }

    [Theory]
    [InlineData("get_api_v1_signals_vehicleID_live")]
    [InlineData("get_api_v1_vehicles_vehicleID_state")]
    public void Source_operation_ids_resolve_against_the_generated_endpoint_table(string operationId)
    {
        // Contract-drift guard: the operation ids the source sends must exist in the generated endpoint table.
        var api = new FakeApiClient();
        Assert.Equal(operationId, api.ResolveEndpoint(operationId).OperationId);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ScheduleReading FullSchedule() =>
        new("StartAt", Pending: true, StartTime: "2026-06-07T03:00:00Z", DepartureTime: "2026-06-07T08:00:00Z", ChargeLimit: 80);

    private static ChargingScheduleSnapshot FullSnapshot() =>
        new(FullSchedule(), new VehicleScheduleState(80, IsCharging: true));

    private static ChargingScheduleSnapshot SnapshotNoState() => new(FullSchedule(), null);

    private static RepositoryResult<ChargingScheduleSnapshot> Loaded(ChargingScheduleSnapshot snapshot) =>
        RepositoryResult<ChargingScheduleSnapshot>.Loaded(snapshot, Now);

    private static async Task<List<RepositoryResult<ChargingScheduleSnapshot>>> Drain(IChargingScheduleSource source)
    {
        var list = new List<RepositoryResult<ChargingScheduleSnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static ChargingScheduleViewModel NewViewModel(params RepositoryResult<ChargingScheduleSnapshot>[] emissions) =>
        NewViewModel(ChargingScheduleSize.Default, emissions);

    private static ChargingScheduleViewModel NewViewModel(
        ChargingScheduleSize size,
        params RepositoryResult<ChargingScheduleSnapshot>[] emissions) =>
        new(new FakeChargingScheduleSource(emissions), Localizer, size);

    private sealed class FakeChargingScheduleSource(params RepositoryResult<ChargingScheduleSnapshot>[] emissions) : IChargingScheduleSource
    {
        public async IAsyncEnumerable<RepositoryResult<ChargingScheduleSnapshot>> StreamAsync(
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
