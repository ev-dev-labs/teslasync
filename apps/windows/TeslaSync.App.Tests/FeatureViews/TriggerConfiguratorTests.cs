using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Automations;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the TriggerConfigurator surface's UI-thread-free logic — the trigger union and
/// its defaults (web <c>createDefaultTrigger</c>), the cron build/parse/day-toggle helpers (web
/// <c>buildCronExpr</c> / <c>parseCronExpr</c> / day handler), the signal value coercion (web
/// <c>signalValueFromInput</c>), the canonical catalogs (web <c>SIGNAL_FIELDS</c> / <c>SIGNAL_OPERATORS</c> /
/// <c>VEHICLE_EVENTS</c> / <c>GEOFENCE_EVENTS</c> / <c>TRIGGER_TYPES</c> / <c>DAYS</c> /
/// <c>COMMON_TIMEZONES</c>), the geofence parse + cache-then-network projection adapter, the registry +
/// diagnostics metadata, and the state-holder view-model's per-state geofence transitions
/// (loading / loaded / empty / error / stale / offline) plus every edit mutator. Mirrors the web spec
/// (web/src/features/automations/pages/TriggerConfigurator.tsx + web/src/lib/signals.ts +
/// web/src/lib/constants.ts).
/// </summary>
public sealed class TriggerConfiguratorTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // ---- Trigger defaults (web createDefaultTrigger) -------------------------------

    [Fact]
    public void CreateDefault_schedule_matches_web()
    {
        var trigger = Assert.IsType<ScheduleTrigger>(AutomationTrigger.CreateDefault(AutomationTriggerKind.Schedule));
        Assert.Equal("0 8 * * *", trigger.CronExpr);
        Assert.Equal("UTC", trigger.Timezone);
    }

    [Fact]
    public void CreateDefault_event_is_online()
    {
        var trigger = Assert.IsType<EventTrigger>(AutomationTrigger.CreateDefault(AutomationTriggerKind.Event));
        Assert.Equal(AutomationEventType.Online, trigger.EventType);
    }

    [Fact]
    public void CreateDefault_geofence_is_unset_enter()
    {
        var trigger = Assert.IsType<GeofenceTrigger>(AutomationTrigger.CreateDefault(AutomationTriggerKind.Geofence));
        Assert.Equal(0, trigger.PlaceId);
        Assert.Equal(AutomationGeofenceEvent.Enter, trigger.GeofenceEvent);
        Assert.Null(trigger.DwellMinutes);
    }

    [Fact]
    public void CreateDefault_signal_is_battery_below_20()
    {
        var trigger = Assert.IsType<SignalTrigger>(AutomationTrigger.CreateDefault(AutomationTriggerKind.Signal));
        Assert.Equal("battery_level", trigger.Signal);
        Assert.Equal(AutomationTriggerSignalOp.LessThan, trigger.Op);
        Assert.Equal(20, trigger.ValueNum);
    }

    [Theory]
    [InlineData(AutomationTriggerKind.Schedule, "trigger_schedule")]
    [InlineData(AutomationTriggerKind.Event, "trigger_event")]
    [InlineData(AutomationTriggerKind.Geofence, "trigger_geofence")]
    [InlineData(AutomationTriggerKind.Signal, "trigger_signal")]
    public void Kind_wire_round_trips(AutomationTriggerKind kind, string wire) =>
        Assert.Equal(wire, kind.ToWire());

    // ---- Wire mapping (web event_type / event / op literals) ------------------------

    [Theory]
    [InlineData(AutomationEventType.DriveStart, "drive_start")]
    [InlineData(AutomationEventType.ChargeEnd, "charge_end")]
    [InlineData(AutomationEventType.Online, "online")]
    [InlineData(AutomationEventType.SentryAlert, "sentry_alert")]
    public void EventType_wire_round_trips(AutomationEventType value, string wire)
    {
        Assert.Equal(wire, value.ToWire());
        Assert.True(TriggerWire.TryParseEventType(wire, out var parsed));
        Assert.Equal(value, parsed);
    }

    [Theory]
    [InlineData(AutomationGeofenceEvent.Enter, "enter")]
    [InlineData(AutomationGeofenceEvent.Exit, "exit")]
    [InlineData(AutomationGeofenceEvent.Dwell, "dwell")]
    public void GeofenceEvent_wire_round_trips(AutomationGeofenceEvent value, string wire)
    {
        Assert.Equal(wire, value.ToWire());
        Assert.True(TriggerWire.TryParseGeofenceEvent(wire, out var parsed));
        Assert.Equal(value, parsed);
    }

    [Theory]
    [InlineData(AutomationTriggerSignalOp.Equal, "=")]
    [InlineData(AutomationTriggerSignalOp.LessThanOrEqual, "<=")]
    [InlineData(AutomationTriggerSignalOp.Changed, "changed")]
    [InlineData(AutomationTriggerSignalOp.CrossedAbove, "crossed_above")]
    public void SignalOp_wire_round_trips(AutomationTriggerSignalOp op, string wire)
    {
        Assert.Equal(wire, op.ToWire());
        Assert.True(TriggerWire.TryParseSignalOp(wire, out var parsed));
        Assert.Equal(op, parsed);
    }

    [Fact]
    public void Wire_parse_rejects_unknown_literal()
    {
        Assert.False(TriggerWire.TryParseSignalOp("~", out _));
        Assert.False(TriggerWire.TryParseEventType("nope", out _));
        Assert.False(TriggerWire.TryParseGeofenceEvent("nope", out _));
    }

    // ---- Cron build (web buildCronExpr) --------------------------------------------

    [Fact]
    public void BuildCron_every_day_uses_wildcard()
    {
        Assert.Equal("0 8 * * *", TriggerCron.Build(8, 0, Array.Empty<int>()));
        Assert.Equal("0 8 * * *", TriggerCron.Build(8, 0, new[] { 0, 1, 2, 3, 4, 5, 6 }));
    }

    [Fact]
    public void BuildCron_joins_selected_days() =>
        Assert.Equal("30 8 * * 1,2,3,4,5", TriggerCron.Build(8, 30, new[] { 1, 2, 3, 4, 5 }));

    // ---- Cron parse (web parseCronExpr) --------------------------------------------

    [Fact]
    public void ParseCron_reads_time_and_days()
    {
        var parsed = TriggerCron.Parse("30 8 * * 1,2,3");
        Assert.NotNull(parsed);
        Assert.Equal(8, parsed!.Hour);
        Assert.Equal(30, parsed.Minute);
        Assert.Equal(new[] { 1, 2, 3 }, parsed.Days);
    }

    [Fact]
    public void ParseCron_wildcard_days_is_empty()
    {
        var parsed = TriggerCron.Parse("0 8 * * *");
        Assert.NotNull(parsed);
        Assert.Empty(parsed!.Days);
    }

    [Theory]
    [InlineData("*/5 * * * *")]   // minute not an integer
    [InlineData("0 8 1 * *")]     // day-of-month not wildcard
    [InlineData("0 8 * 6 *")]     // month not wildcard
    [InlineData("0 8 * *")]       // four fields
    [InlineData("")]
    public void ParseCron_rejects_non_simple(string expr) =>
        Assert.Null(TriggerCron.Parse(expr));

    // ---- Day toggle (web handleDayToggle) ------------------------------------------

    [Fact]
    public void ToggleDay_from_all_selects_all_but_one() =>
        Assert.Equal(new[] { 0, 1, 2, 4, 5, 6 }, TriggerCron.ToggleDay(Array.Empty<int>(), 3));

    [Fact]
    public void ToggleDay_adds_and_sorts() =>
        Assert.Equal(new[] { 1, 2, 3 }, TriggerCron.ToggleDay(new[] { 1, 2 }, 3));

    [Fact]
    public void ToggleDay_removes_existing() =>
        Assert.Equal(new[] { 1, 3 }, TriggerCron.ToggleDay(new[] { 1, 2, 3 }, 2));

    [Fact]
    public void ToggleDay_completing_week_collapses_to_empty() =>
        Assert.Empty(TriggerCron.ToggleDay(new[] { 0, 1, 2, 3, 4, 5 }, 6));

    // ---- Signal value coercion (web signalValueFromInput) --------------------------

    [Fact]
    public void Signal_with_value_numeric()
    {
        var next = new SignalTrigger("battery_level", AutomationTriggerSignalOp.LessThan, ValueNum: 20).WithValue("35");
        Assert.Equal(35, next.ValueNum);
        Assert.Null(next.ValueBool);
        Assert.Null(next.ValueText);
    }

    [Fact]
    public void Signal_with_value_bool()
    {
        var next = new SignalTrigger("is_locked", AutomationTriggerSignalOp.Equal, ValueBool: true).WithValue("false");
        Assert.False(next.ValueBool);
    }

    [Fact]
    public void Signal_with_value_text_for_state()
    {
        var next = new SignalTrigger("state", AutomationTriggerSignalOp.Equal, ValueText: "online").WithValue("driving");
        Assert.Equal("driving", next.ValueText);
    }

    [Fact]
    public void Signal_changed_drops_value()
    {
        var next = new SignalTrigger("battery_level", AutomationTriggerSignalOp.Changed, ValueNum: 20).WithValue("35");
        Assert.Null(next.ValueNum);
        Assert.Equal(AutomationTriggerSignalOp.Changed, next.Op);
    }

    [Fact]
    public void Signal_non_numeric_value_is_zero()
    {
        var next = new SignalTrigger("speed", AutomationTriggerSignalOp.GreaterThan).WithValue("abc");
        Assert.Equal(0, next.ValueNum);
    }

    [Theory]
    [InlineData("is_locked", true, false, null)]
    [InlineData("state", false, true, null)]
    [InlineData("speed", false, false, 20.0)]
    public void Signal_for_signal_defaults(string key, bool boolDefault, bool textDefault, double? numDefault)
    {
        var trigger = SignalTrigger.ForSignal(key);
        Assert.Equal(key, trigger.Signal);
        Assert.Equal(boolDefault, trigger.ValueBool is not null);
        Assert.Equal(textDefault, trigger.ValueText is not null);
        Assert.Equal(numDefault, trigger.ValueNum);
    }

    [Fact]
    public void Signal_current_value_string_defaults()
    {
        Assert.Equal("true", new SignalTrigger("is_locked", AutomationTriggerSignalOp.Equal).CurrentValueString);
        Assert.Equal("online", new SignalTrigger("state", AutomationTriggerSignalOp.Equal).CurrentValueString);
        Assert.Equal("20", new SignalTrigger("battery_level", AutomationTriggerSignalOp.LessThan).CurrentValueString);
    }

    [Theory]
    [InlineData("battery_level", false, false, true)]
    [InlineData("is_charging", true, false, true)]
    [InlineData("state", false, true, true)]
    public void Signal_shape_flags(string key, bool isBool, bool isState, bool showValue)
    {
        var trigger = SignalTrigger.ForSignal(key);
        Assert.Equal(isBool, trigger.IsBool);
        Assert.Equal(isState, trigger.IsState);
        Assert.Equal(showValue, trigger.ShowValueField);
    }

    [Fact]
    public void Signal_changed_hides_value_field() =>
        Assert.False(new SignalTrigger("battery_level", AutomationTriggerSignalOp.Changed).ShowValueField);

    // ---- Catalogs (web SIGNAL_FIELDS / operators / events / DAYS / timezones) -------

    [Fact]
    public void SignalFields_match_web_order()
    {
        var keys = TriggerSignalCatalog.SignalFields.Select(f => f.Key).ToArray();
        Assert.Equal(
            new[] { "battery_level", "inside_temp", "outside_temp", "speed", "is_locked", "is_charging", "is_climate_on", "sentry_mode", "state" },
            keys);
    }

    [Fact]
    public void BoolFieldKeys_match_web()
    {
        Assert.Equal(4, TriggerSignalCatalog.BoolFieldKeys.Count);
        Assert.Contains("is_locked", TriggerSignalCatalog.BoolFieldKeys);
        Assert.Contains("sentry_mode", TriggerSignalCatalog.BoolFieldKeys);
        Assert.DoesNotContain("battery_level", TriggerSignalCatalog.BoolFieldKeys);
    }

    [Fact]
    public void Operators_match_web()
    {
        Assert.Equal(9, TriggerSignalCatalog.Operators.Count);
        Assert.Equal(AutomationTriggerSignalOp.Equal, TriggerSignalCatalog.Operators[0].Op);
        Assert.Equal(AutomationTriggerSignalOp.CrossedBelow, TriggerSignalCatalog.Operators[^1].Op);
    }

    [Fact]
    public void VehicleEvents_match_web()
    {
        Assert.Equal(9, TriggerEventCatalog.VehicleEvents.Count);
        Assert.Equal(AutomationEventType.DriveStart, TriggerEventCatalog.VehicleEvents[0].Value);
        Assert.Equal(AutomationEventType.SentryAlert, TriggerEventCatalog.VehicleEvents[^1].Value);
    }

    [Fact]
    public void GeofenceEvents_offer_enter_exit_dwell()
    {
        Assert.Equal(
            new[] { AutomationGeofenceEvent.Enter, AutomationGeofenceEvent.Exit, AutomationGeofenceEvent.Dwell },
            TriggerEventCatalog.GeofenceEvents.Select(e => e.Value).ToArray());
    }

    [Fact]
    public void TriggerTypes_match_web()
    {
        Assert.Equal(
            new[] { AutomationTriggerKind.Schedule, AutomationTriggerKind.Event, AutomationTriggerKind.Geofence, AutomationTriggerKind.Signal },
            TriggerEventCatalog.TriggerTypes.Select(t => t.Value).ToArray());
    }

    [Fact]
    public void Days_are_sun_first()
    {
        Assert.Equal(7, TriggerScheduleCatalog.Days.Count);
        Assert.Equal("Sun", TriggerScheduleCatalog.Days[0]);
        Assert.Equal("Sat", TriggerScheduleCatalog.Days[6]);
    }

    [Fact]
    public void Timezones_lead_with_utc_default()
    {
        Assert.Equal(11, TriggerScheduleCatalog.CommonTimezones.Count);
        Assert.Equal(string.Empty, TriggerScheduleCatalog.CommonTimezones[0].Value);
        Assert.Equal("timezones.utc", TriggerScheduleCatalog.TimezoneKey(string.Empty));
        Assert.Equal("timezones.America/New_York", TriggerScheduleCatalog.TimezoneKey("America/New_York"));
    }

    // ---- Geofence parse adapter (web useGeofences read) -----------------------------

    [Fact]
    public void ParseList_reads_id_and_name()
    {
        using var doc = JsonDocument.Parse("""[{"id":"7","name":"Home"},{"id":9,"name":"Work"}]""");
        var fences = TriggerGeofence.ParseList(doc.RootElement);

        Assert.Equal(2, fences.Count);
        Assert.Equal("7", fences[0].Id);
        Assert.Equal("Home", fences[0].Name);
        Assert.Equal("9", fences[1].Id);   // numeric id coerced to string (web String(g.id))
    }

    [Fact]
    public void ParseList_tolerates_missing_name()
    {
        using var doc = JsonDocument.Parse("""[{"id":"1"}]""");
        Assert.Null(Assert.Single(TriggerGeofence.ParseList(doc.RootElement)).Name);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("{}")]
    [InlineData("[]")]
    public void ParseList_returns_empty_for_non_array_or_empty(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Empty(TriggerGeofence.ParseList(doc.RootElement));
    }

    // ---- Source projection adapter (cached -> projection) ---------------------------

    [Fact]
    public void Source_project_parses_loaded_value()
    {
        using var doc = JsonDocument.Parse("""[{"id":"1","name":"Home"}]""");
        var projected = TriggerGeofenceSource.Project(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, projected.Status);
        Assert.Equal("Home", Assert.Single(projected.Value!).Name);
        Assert.Equal(Now, projected.FetchedAt);
    }

    [Fact]
    public void Source_project_preserves_cached_freshness()
    {
        using var doc = JsonDocument.Parse("""[{"id":"1","name":"Home"}]""");
        var projected = TriggerGeofenceSource.Project(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, projected.Status);
        Assert.True(projected.IsStale);
        Assert.Single(projected.Value!);
    }

    [Fact]
    public void Source_project_loading_carries_no_value()
    {
        var projected = TriggerGeofenceSource.Project(RepositoryResult<JsonElement>.Loading());
        Assert.Equal(LoadStatus.Loading, projected.Status);
        Assert.Null(projected.Value);
    }

    [Fact]
    public void Source_project_empty_carries_no_value()
    {
        var projected = TriggerGeofenceSource.Project(RepositoryResult<JsonElement>.Empty(Now));
        Assert.Equal(LoadStatus.Empty, projected.Status);
        Assert.Null(projected.Value);
    }

    [Fact]
    public void Source_project_preserves_failure_error()
    {
        var error = new RepositoryError(RepositoryErrorKind.Server, "boom");
        var projected = TriggerGeofenceSource.Project(RepositoryResult<JsonElement>.Failure(error));

        Assert.Equal(LoadStatus.Error, projected.Status);
        Assert.Same(error, projected.Error);
        Assert.Null(projected.Value);
    }

    [Fact]
    public void Source_project_offline_keeps_cached_value()
    {
        using var doc = JsonDocument.Parse("""[{"id":"1","name":"Home"}]""");
        var error = new RepositoryError(RepositoryErrorKind.Network, "down");
        var projected = TriggerGeofenceSource.Project(RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, error));

        Assert.Equal(LoadStatus.Offline, projected.Status);
        Assert.Single(projected.Value!);
        Assert.Same(error, projected.Error);
    }

    // ---- View-model geofence state matrix ------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = Vm(RepositoryResult<IReadOnlyList<TriggerGeofence>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(TriggerGeofenceLoadState.Loading, vm.GeofenceState);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_geofences()
    {
        using var vm = Vm(RepositoryResult<IReadOnlyList<TriggerGeofence>>.Loaded(Fences(("1", "Home"), ("2", "Work")), Now));
        await vm.LoadAsync();

        Assert.Equal(TriggerGeofenceLoadState.Loaded, vm.GeofenceState);
        Assert.Equal(2, vm.Geofences.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty_without_geofences()
    {
        using var vm = Vm(RepositoryResult<IReadOnlyList<TriggerGeofence>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(TriggerGeofenceLoadState.Empty, vm.GeofenceState);
        Assert.Empty(vm.Geofences);
        Assert.False(string.IsNullOrWhiteSpace(vm.GeofenceEmptyMessage));
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = Vm(RepositoryResult<IReadOnlyList<TriggerGeofence>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(TriggerGeofenceLoadState.Error, vm.GeofenceState);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale()
    {
        using var vm = Vm(RepositoryResult<IReadOnlyList<TriggerGeofence>>.Cached(Fences(("1", "Home")), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(TriggerGeofenceLoadState.Stale, vm.GeofenceState);
        Assert.True(vm.IsStale);
        Assert.Single(vm.Geofences);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_cache()
    {
        using var vm = Vm(RepositoryResult<IReadOnlyList<TriggerGeofence>>.OfflineCached(
            Fences(("1", "Home")), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(TriggerGeofenceLoadState.Offline, vm.GeofenceState);
        Assert.True(vm.IsStale);
        Assert.Single(vm.Geofences);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = Vm(
            RepositoryResult<IReadOnlyList<TriggerGeofence>>.Loading(),
            RepositoryResult<IReadOnlyList<TriggerGeofence>>.Cached(Fences(("1", "Home")), Now, stale: false),
            RepositoryResult<IReadOnlyList<TriggerGeofence>>.Loaded(Fences(("1", "Home"), ("2", "Work")), Now));
        await vm.LoadAsync();

        Assert.Equal(TriggerGeofenceLoadState.Loaded, vm.GeofenceState);
        Assert.Equal(2, vm.Geofences.Count);
    }

    [Fact]
    public async Task ViewModel_geofence_options_lead_with_prompt()
    {
        using var vm = Vm(RepositoryResult<IReadOnlyList<TriggerGeofence>>.Loaded(Fences(("1", "Home"), ("2", "Work")), Now));
        await vm.LoadAsync();

        var options = vm.GeofenceOptions;
        Assert.Equal(3, options.Count);
        Assert.Equal(string.Empty, options[0].Value);            // "Select geofence..."
        Assert.Equal("1", options[1].Value);
        Assert.Equal("Home", options[1].Label);
    }

    [Fact]
    public async Task ViewModel_geofence_option_uses_em_dash_for_missing_name()
    {
        using var vm = Vm(RepositoryResult<IReadOnlyList<TriggerGeofence>>.Loaded(Fences(("1", null)), Now));
        await vm.LoadAsync();

        Assert.Equal("—", vm.GeofenceOptions[1].Label);
    }

    [Fact]
    public async Task ViewModel_retry_re_runs_load()
    {
        using var vm = Vm(RepositoryResult<IReadOnlyList<TriggerGeofence>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();
        int first = vm.Attempts;
        await vm.RetryAsync();

        Assert.True(vm.Attempts > first);
    }

    // ---- View-model edit mutators (web onChange handlers) --------------------------

    [Fact]
    public void ViewModel_select_kind_resets_to_default_and_raises_change()
    {
        using var vm = Vm();
        AutomationTrigger? emitted = null;
        vm.TriggerChanged += (_, t) => emitted = t;

        vm.SelectKind(AutomationTriggerKind.Signal);

        var signal = Assert.IsType<SignalTrigger>(vm.Trigger);
        Assert.Equal("battery_level", signal.Signal);
        Assert.Same(vm.Trigger, emitted);
    }

    [Fact]
    public void ViewModel_set_schedule_time_rebuilds_cron()
    {
        using var vm = VmWith(new ScheduleTrigger("0 8 * * *", "UTC"));
        vm.SetScheduleTime(9, 15);

        Assert.Equal("15 9 * * *", Assert.IsType<ScheduleTrigger>(vm.Trigger).CronExpr);
    }

    [Fact]
    public void ViewModel_toggle_day_rebuilds_cron()
    {
        using var vm = VmWith(new ScheduleTrigger("0 8 * * *", "UTC"));
        vm.ToggleScheduleDay(3);  // from "all" -> all but Wed

        Assert.Equal("0 8 * * 0,1,2,4,5,6", Assert.IsType<ScheduleTrigger>(vm.Trigger).CronExpr);
        Assert.False(vm.IsDayActive(3));
    }

    [Fact]
    public void ViewModel_set_cron_switches_to_advanced()
    {
        using var vm = VmWith(new ScheduleTrigger("0 8 * * *", "UTC"));
        vm.SetCronExpr("*/5 * * * *");

        Assert.False(vm.IsSimpleSchedule);
        Assert.Equal("*/5 * * * *", vm.ScheduleCronExpr);
    }

    [Fact]
    public void ViewModel_toggle_mode_from_advanced_seeds_simple()
    {
        using var vm = VmWith(new ScheduleTrigger("*/5 * * * *", "UTC"));
        Assert.False(vm.IsSimpleSchedule);

        vm.ToggleScheduleMode();

        Assert.True(vm.IsSimpleSchedule);
        Assert.Equal("0 8 * * *", vm.ScheduleCronExpr);
    }

    [Fact]
    public void ViewModel_toggle_mode_from_simple_keeps_expression()
    {
        // Web parity: the simple-side toggle sets cron_expr to its current (already-simple) value.
        using var vm = VmWith(new ScheduleTrigger("15 9 * * *", "UTC"));
        vm.ToggleScheduleMode();

        Assert.True(vm.IsSimpleSchedule);
        Assert.Equal("15 9 * * *", vm.ScheduleCronExpr);
    }

    [Fact]
    public void ViewModel_set_timezone()
    {
        using var vm = VmWith(new ScheduleTrigger("0 8 * * *", "UTC"));
        vm.SetTimezone("America/New_York");

        Assert.Equal("America/New_York", Assert.IsType<ScheduleTrigger>(vm.Trigger).Timezone);
    }

    [Fact]
    public void ViewModel_set_event_type()
    {
        using var vm = VmWith(new EventTrigger(AutomationEventType.Online));
        vm.SetEventType("charge_start");

        Assert.Equal(AutomationEventType.ChargeStart, Assert.IsType<EventTrigger>(vm.Trigger).EventType);
    }

    [Fact]
    public void ViewModel_set_geofence_place()
    {
        using var vm = VmWith(new GeofenceTrigger(0, AutomationGeofenceEvent.Enter));
        vm.SetGeofencePlace("5");
        Assert.Equal(5, Assert.IsType<GeofenceTrigger>(vm.Trigger).PlaceId);

        vm.SetGeofencePlace(string.Empty);
        Assert.Equal(0, Assert.IsType<GeofenceTrigger>(vm.Trigger).PlaceId);
    }

    [Fact]
    public void ViewModel_set_geofence_event_dwell_seeds_minutes()
    {
        using var vm = VmWith(new GeofenceTrigger(1, AutomationGeofenceEvent.Enter));
        vm.SetGeofenceEvent("dwell");

        var geofence = Assert.IsType<GeofenceTrigger>(vm.Trigger);
        Assert.Equal(AutomationGeofenceEvent.Dwell, geofence.GeofenceEvent);
        Assert.Equal(5, geofence.DwellMinutes);
        Assert.True(vm.ShowDwellMinutes);
    }

    [Fact]
    public void ViewModel_set_geofence_event_non_dwell_clears_minutes()
    {
        using var vm = VmWith(new GeofenceTrigger(1, AutomationGeofenceEvent.Dwell, DwellMinutes: 12));
        vm.SetGeofenceEvent("enter");

        Assert.Null(Assert.IsType<GeofenceTrigger>(vm.Trigger).DwellMinutes);
        Assert.False(vm.ShowDwellMinutes);
    }

    [Fact]
    public void ViewModel_set_dwell_minutes_clamps_floor()
    {
        using var vm = VmWith(new GeofenceTrigger(1, AutomationGeofenceEvent.Dwell, DwellMinutes: 5));
        vm.SetDwellMinutes(0);

        Assert.Equal(1, Assert.IsType<GeofenceTrigger>(vm.Trigger).DwellMinutes);
    }

    [Fact]
    public void ViewModel_set_signal_resets_defaults()
    {
        using var vm = VmWith(new SignalTrigger("battery_level", AutomationTriggerSignalOp.LessThan, ValueNum: 20));
        vm.SetSignal("is_locked");

        var signal = Assert.IsType<SignalTrigger>(vm.Trigger);
        Assert.Equal("is_locked", signal.Signal);
        Assert.True(signal.ValueBool);
        Assert.True(vm.SignalIsBool);
    }

    [Fact]
    public void ViewModel_set_signal_op_changed_drops_value()
    {
        using var vm = VmWith(new SignalTrigger("battery_level", AutomationTriggerSignalOp.LessThan, ValueNum: 20));
        vm.SetSignalOp("changed");

        Assert.True(vm.SignalChangedOnly);
        Assert.False(vm.SignalShowValue);
    }

    [Fact]
    public void ViewModel_set_signal_value()
    {
        using var vm = VmWith(new SignalTrigger("battery_level", AutomationTriggerSignalOp.LessThan, ValueNum: 20));
        vm.SetSignalValue("42");

        Assert.Equal(42, Assert.IsType<SignalTrigger>(vm.Trigger).ValueNum);
    }

    [Fact]
    public void ViewModel_changed_only_toggle_round_trips()
    {
        using var vm = VmWith(new SignalTrigger("battery_level", AutomationTriggerSignalOp.LessThan, ValueNum: 25));
        vm.SetChangedOnly(true);
        Assert.Equal(AutomationTriggerSignalOp.Changed, Assert.IsType<SignalTrigger>(vm.Trigger).Op);

        vm.SetChangedOnly(false);
        var signal = Assert.IsType<SignalTrigger>(vm.Trigger);
        Assert.Equal(AutomationTriggerSignalOp.Equal, signal.Op);

        // Web parity: entering "changed" mode drops the value, so toggling back re-coerces the default 20
        // (web String(value_num ?? 20)), not the prior 25 — the prior value is intentionally not preserved.
        Assert.Equal(20, signal.ValueNum);
    }

    [Fact]
    public void ViewModel_mutator_ignores_wrong_kind()
    {
        using var vm = VmWith(new EventTrigger(AutomationEventType.Online));
        vm.SetScheduleTime(9, 0);   // not a schedule trigger -> no-op

        Assert.IsType<EventTrigger>(vm.Trigger);
    }

    // ---- StructureKey (focus-preserving render gate) -------------------------------

    [Fact]
    public void StructureKey_changes_on_kind_switch()
    {
        using var vm = Vm();
        string before = vm.StructureKey;
        vm.SelectKind(AutomationTriggerKind.Signal);

        Assert.NotEqual(before, vm.StructureKey);
    }

    [Fact]
    public void StructureKey_changes_on_schedule_mode_flip()
    {
        using var vm = VmWith(new ScheduleTrigger("0 8 * * *", "UTC"));
        string before = vm.StructureKey;
        vm.SetCronExpr("*/5 * * * *");

        Assert.NotEqual(before, vm.StructureKey);
    }

    [Fact]
    public void StructureKey_changes_on_signal_shape_flip()
    {
        using var vm = VmWith(new SignalTrigger("battery_level", AutomationTriggerSignalOp.LessThan, ValueNum: 20));
        string before = vm.StructureKey;
        vm.SetSignal("is_locked");   // numeric -> boolean shape

        Assert.NotEqual(before, vm.StructureKey);
    }

    [Fact]
    public void StructureKey_stable_on_numeric_value_edit()
    {
        using var vm = VmWith(new SignalTrigger("battery_level", AutomationTriggerSignalOp.LessThan, ValueNum: 20));
        string before = vm.StructureKey;
        vm.SetSignalValue("40");   // same shape -> view keeps its text field focused

        Assert.Equal(before, vm.StructureKey);
    }

    // ---- Accessibility / i18n (labels + options route through the localizer) --------

    [Fact]
    public void ViewModel_labels_are_non_empty()
    {
        using var vm = Vm();
        foreach (string label in new[]
        {
            vm.TimeLabel, vm.DaysLabel, vm.CronExprLabel, vm.CronHint, vm.CronHelp, vm.AdvancedCronLabel,
            vm.SimpleCronLabel, vm.TimezoneLabel, vm.EventLabel, vm.GeofenceLabel, vm.SelectGeofenceLabel,
            vm.GeofenceEventLabel, vm.DwellMinutesLabel, vm.DwellHint, vm.DwellHelp, vm.SignalLabel,
            vm.OperatorLabel, vm.ValueLabel, vm.TrueLabel, vm.FalseLabel, vm.StateExample,
            vm.ChangedOnlyLabel, vm.GeofenceLoadingLabel, vm.GeofenceEmptyMessage, vm.RetryLabel, vm.OfflineLabel,
        })
        {
            Assert.False(string.IsNullOrWhiteSpace(label));
        }
    }

    [Fact]
    public void ViewModel_option_lists_are_complete_and_localized()
    {
        using var vm = new TriggerConfiguratorViewModel(new FakeTriggerGeofenceSource(), new PrefixLocalizer());

        Assert.Equal(4, vm.TriggerTypeOptions.Count);
        Assert.Equal(9, vm.EventOptions.Count);
        Assert.Equal(3, vm.GeofenceEventOptions.Count);
        Assert.Equal(9, vm.OperatorOptions.Count);
        Assert.Equal(9, vm.SignalFieldOptions.Count);
        Assert.Equal(11, vm.TimezoneOptions.Count);
        Assert.Equal(2, vm.BoolValueOptions.Count);

        // Every option label flowed through the i18n facade (prefixed), not a hard-coded literal.
        Assert.All(vm.EventOptions, o => Assert.StartsWith("L:", o.Label, StringComparison.Ordinal));
        Assert.All(vm.OperatorOptions, o => Assert.StartsWith("L:", o.Label, StringComparison.Ordinal));
        Assert.StartsWith("L:", vm.TimeLabel, StringComparison.Ordinal);
        Assert.StartsWith("L:", vm.DayLabel(0), StringComparison.Ordinal);
    }

    [Fact]
    public void ViewModel_signal_field_labels_route_through_localizer()
    {
        using var vm = new TriggerConfiguratorViewModel(new FakeTriggerGeofenceSource(), new PrefixLocalizer());
        Assert.All(vm.SignalFieldOptions, o => Assert.False(string.IsNullOrWhiteSpace(o.Label)));
        Assert.Equal("battery_level", vm.SignalFieldOptions[0].Value);
    }

    // ---- Registry + diagnostics ----------------------------------------------------

    [Fact]
    public void Registration_metadata_is_stable()
    {
        Assert.Equal("trigger-configurator", TriggerConfiguratorRegistration.Id);
        Assert.Equal("TriggerConfigurator", TriggerConfiguratorRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TriggerConfiguratorDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TriggerConfigurator", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new TriggerConfiguratorDiagnostics();
        diagnostics.RecordViewOpened();
        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    // ---- Test doubles --------------------------------------------------------------

    private static IReadOnlyList<TriggerGeofence> Fences(params (string Id, string? Name)[] items) =>
        items.Select(i => new TriggerGeofence(i.Id, i.Name)).ToArray();

    private static TriggerConfiguratorViewModel Vm(params RepositoryResult<IReadOnlyList<TriggerGeofence>>[] emissions) =>
        new(new FakeTriggerGeofenceSource(emissions), Localizer);

    private static TriggerConfiguratorViewModel VmWith(
        AutomationTrigger trigger,
        params RepositoryResult<IReadOnlyList<TriggerGeofence>>[] emissions) =>
        new(new FakeTriggerGeofenceSource(emissions), Localizer, trigger);

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }

    private sealed class FakeTriggerGeofenceSource(params RepositoryResult<IReadOnlyList<TriggerGeofence>>[] emissions) : ITriggerGeofenceSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<TriggerGeofence>>> StreamAsync(
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
}
