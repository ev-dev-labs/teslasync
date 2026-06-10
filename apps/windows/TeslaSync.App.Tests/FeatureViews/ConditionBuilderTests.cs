using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Automations;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the ConditionBuilder surface's UI-thread-free logic — the ported pure transforms
/// (<c>createDefaultCondition</c>, <c>conditionValueFromInput</c>, the operator/signal change handlers,
/// <c>numericValue</c>), the option catalogs + projection (condition types, signals, operator filtering for
/// boolean signals, geofence/other-automation states, timezones, days, the prompt-first geofence options),
/// the geofence JSON adapter (cached → projection), the state-holder view-model's condition mutations and the
/// geofence loading / ready / empty / stale / offline / error matrix, the i18n key + fallback contract, the
/// a11y label sources and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/automations/pages/ConditionBuilder.tsx). The WinUI view itself (ConditionBuilder.cs) is
/// exercised by the app build.
/// </summary>
public sealed class ConditionBuilderTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 10, 12, 0, 0, TimeSpan.Zero);

    private static AutomationCondition.SignalCondition Signal(
        string signal = "battery_level",
        AutomationConditionSignalOp op = AutomationConditionSignalOp.LessThan,
        double? num = 20,
        string? text = null,
        bool? boolean = null,
        double? min = null,
        double? max = null) =>
        new(signal, op, num, text, boolean, min, max);

    // ── Defaults (web createDefaultCondition) ───────────────────────────────────────────────────────────

    [Fact]
    public void CreateDefault_signal_is_battery_level_less_than_20()
    {
        var condition = Assert.IsType<AutomationCondition.SignalCondition>(
            ConditionBuilderLogic.CreateDefault(AutomationConditionKind.Signal));

        Assert.Equal("battery_level", condition.Signal);
        Assert.Equal(AutomationConditionSignalOp.LessThan, condition.Op);
        Assert.Equal(20, condition.ValueNum);
    }

    [Fact]
    public void CreateDefault_time_window_matches_web_seed()
    {
        var condition = Assert.IsType<AutomationCondition.TimeWindowCondition>(
            ConditionBuilderLogic.CreateDefault(AutomationConditionKind.TimeWindow));

        Assert.Equal("06:00", condition.StartTime);
        Assert.Equal("09:00", condition.EndTime);
        Assert.Equal("UTC", condition.Timezone);
        Assert.Equal(new[] { 1, 2, 3, 4, 5 }, condition.DaysOfWeek.ToArray());
    }

    [Fact]
    public void CreateDefault_geofence_and_other_automation_seed_zero_ids()
    {
        var geofence = Assert.IsType<AutomationCondition.GeofenceCondition>(
            ConditionBuilderLogic.CreateDefault(AutomationConditionKind.Geofence));
        Assert.Equal(0, geofence.PlaceId);
        Assert.Equal(AutomationGeofenceState.Inside, geofence.State);

        var other = Assert.IsType<AutomationCondition.OtherAutomationCondition>(
            ConditionBuilderLogic.CreateDefault(AutomationConditionKind.OtherAutomation));
        Assert.Equal(0, other.OtherAutomationId);
        Assert.Equal(AutomationOtherAutomationState.Enabled, other.State);
    }

    // ── Signal change handler (web signal-select onChange) ──────────────────────────────────────────────

    [Fact]
    public void ChangeSignal_boolean_sets_equals_true()
    {
        var condition = ConditionBuilderLogic.ChangeSignal("is_locked");

        Assert.Equal("is_locked", condition.Signal);
        Assert.Equal(AutomationConditionSignalOp.Equal, condition.Op);
        Assert.True(condition.ValueBool);
        Assert.Null(condition.ValueNum);
    }

    [Fact]
    public void ChangeSignal_state_sets_equals_online_text()
    {
        var condition = ConditionBuilderLogic.ChangeSignal("state");

        Assert.Equal(AutomationConditionSignalOp.Equal, condition.Op);
        Assert.Equal("online", condition.ValueText);
    }

    [Fact]
    public void ChangeSignal_numeric_sets_less_than_20()
    {
        var condition = ConditionBuilderLogic.ChangeSignal("speed");

        Assert.Equal(AutomationConditionSignalOp.LessThan, condition.Op);
        Assert.Equal(20, condition.ValueNum);
    }

    // ── Operator change handler (web operator-select onChange) ──────────────────────────────────────────

    [Fact]
    public void ChangeOperator_to_between_seeds_min_from_value_and_max_100()
    {
        var condition = ConditionBuilderLogic.ChangeOperator(
            Signal(num: 35), AutomationConditionSignalOp.Between);

        Assert.Equal(AutomationConditionSignalOp.Between, condition.Op);
        Assert.Equal(35, condition.ValueMin);
        Assert.Equal(100, condition.ValueMax);
    }

    [Fact]
    public void ChangeOperator_between_prefers_existing_min()
    {
        var condition = ConditionBuilderLogic.ChangeOperator(
            Signal(num: 35, min: 10, max: 90, op: AutomationConditionSignalOp.Between),
            AutomationConditionSignalOp.Between);

        Assert.Equal(10, condition.ValueMin);
        Assert.Equal(90, condition.ValueMax);
    }

    [Fact]
    public void ChangeOperator_numeric_reflows_current_value()
    {
        var condition = ConditionBuilderLogic.ChangeOperator(
            Signal(num: 42), AutomationConditionSignalOp.GreaterThanOrEqual);

        Assert.Equal(AutomationConditionSignalOp.GreaterThanOrEqual, condition.Op);
        Assert.Equal(42, condition.ValueNum);
    }

    [Fact]
    public void ChangeOperator_to_in_moves_value_to_text()
    {
        var condition = ConditionBuilderLogic.ChangeOperator(
            Signal(num: 42), AutomationConditionSignalOp.In);

        Assert.Equal(AutomationConditionSignalOp.In, condition.Op);
        Assert.Equal("42", condition.ValueText);
    }

    // ── Value handler (web conditionValueFromInput) ─────────────────────────────────────────────────────

    [Fact]
    public void WithValue_boolean_signal_sets_value_bool()
    {
        var condition = ConditionBuilderLogic.WithValue(
            Signal(signal: "sentry_mode", op: AutomationConditionSignalOp.Equal, num: null, boolean: true), "false");

        Assert.False(condition.ValueBool);
        Assert.Null(condition.ValueNum);
        Assert.Null(condition.ValueText);
    }

    [Fact]
    public void WithValue_state_or_in_sets_value_text()
    {
        var state = ConditionBuilderLogic.WithValue(
            Signal(signal: "state", op: AutomationConditionSignalOp.Equal, num: null, text: "online"), "asleep");
        Assert.Equal("asleep", state.ValueText);

        var inOp = ConditionBuilderLogic.WithValue(Signal(op: AutomationConditionSignalOp.In), "1,2,3");
        Assert.Equal("1,2,3", inOp.ValueText);
    }

    [Fact]
    public void WithValue_numeric_parses_value_num_and_defaults_to_zero()
    {
        Assert.Equal(15.5, ConditionBuilderLogic.WithValue(Signal(), "15.5").ValueNum);
        Assert.Equal(0, ConditionBuilderLogic.WithValue(Signal(), "not-a-number").ValueNum);
    }

    [Fact]
    public void WithMin_and_WithMax_parse_range_bounds()
    {
        var min = ConditionBuilderLogic.WithMin(Signal(op: AutomationConditionSignalOp.Between), "12.5");
        Assert.Equal(12.5, min.ValueMin);

        var max = ConditionBuilderLogic.WithMax(Signal(op: AutomationConditionSignalOp.Between), "88");
        Assert.Equal(88, max.ValueMax);
    }

    // ── Field plan (web ConditionFields value derivation) ───────────────────────────────────────────────

    [Fact]
    public void PlanSignal_numeric_is_scalar_with_numeric_value_string()
    {
        var plan = ConditionBuilderLogic.PlanSignal(Signal(num: 20));

        Assert.Equal(SignalValueEditor.Scalar, plan.Editor);
        Assert.False(plan.IsText);
        Assert.Equal("20", plan.ValueString);
    }

    [Fact]
    public void PlanSignal_boolean_is_boolean_editor_defaulting_true()
    {
        var plan = ConditionBuilderLogic.PlanSignal(
            Signal(signal: "is_charging", op: AutomationConditionSignalOp.Equal, num: null));

        Assert.Equal(SignalValueEditor.Boolean, plan.Editor);
        Assert.Equal("true", plan.ValueString);
    }

    [Fact]
    public void PlanSignal_state_is_text_scalar()
    {
        var plan = ConditionBuilderLogic.PlanSignal(
            Signal(signal: "state", op: AutomationConditionSignalOp.Equal, num: null, text: "online"));

        Assert.Equal(SignalValueEditor.Scalar, plan.Editor);
        Assert.True(plan.IsText);
        Assert.Equal("online", plan.ValueString);
    }

    [Fact]
    public void PlanSignal_between_is_range_with_defaults()
    {
        var plan = ConditionBuilderLogic.PlanSignal(Signal(op: AutomationConditionSignalOp.Between, num: null));

        Assert.Equal(SignalValueEditor.Range, plan.Editor);
        Assert.Equal(0, plan.Min);
        Assert.Equal(100, plan.Max);
    }

    [Fact]
    public void NumericValue_rejects_nan_and_infinity()
    {
        Assert.Equal(7, ConditionBuilderLogic.NumericValue(7, 0));
        Assert.Equal(5, ConditionBuilderLogic.NumericValue(null, 5));
        Assert.Equal(5, ConditionBuilderLogic.NumericValue(double.NaN, 5));
        Assert.Equal(5, ConditionBuilderLogic.NumericValue(double.PositiveInfinity, 5));
    }

    [Theory]
    [InlineData("5", 5)]
    [InlineData("0", 0)]
    [InlineData("abc", 0)]
    [InlineData("", 0)]
    public void ParseId_matches_web_parse_int_or_zero(string raw, long expected) =>
        Assert.Equal(expected, ConditionBuilderLogic.ParseId(raw));

    // ── Operator filtering for boolean signals (web numericOnly guard) ──────────────────────────────────

    [Fact]
    public void OperatorOptions_for_boolean_signal_drops_numeric_only_operators()
    {
        var options = ConditionBuilderProjection.OperatorOptions("is_locked", Localizer);

        Assert.Equal(new[] { "=", "!=", "in" }, options.Select(o => o.Value).ToArray());
    }

    [Fact]
    public void OperatorOptions_for_numeric_signal_keeps_all_eight()
    {
        var options = ConditionBuilderProjection.OperatorOptions("battery_level", Localizer);

        Assert.Equal(8, options.Count);
        Assert.Contains("between", options.Select(o => o.Value));
    }

    // ── Wire round-trips (server literals) ──────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(AutomationConditionKind.Signal, "condition_signal")]
    [InlineData(AutomationConditionKind.TimeWindow, "condition_time_window")]
    [InlineData(AutomationConditionKind.Geofence, "condition_geofence")]
    [InlineData(AutomationConditionKind.OtherAutomation, "condition_other_automation")]
    public void Kind_wire_round_trips(AutomationConditionKind kind, string wire)
    {
        Assert.Equal(wire, ConditionCatalog.KindWire(kind));
        Assert.Equal(kind, ConditionCatalog.KindFromWire(wire));
    }

    [Theory]
    [InlineData(AutomationConditionSignalOp.Equal, "=")]
    [InlineData(AutomationConditionSignalOp.NotEqual, "!=")]
    [InlineData(AutomationConditionSignalOp.LessThanOrEqual, "<=")]
    [InlineData(AutomationConditionSignalOp.Between, "between")]
    [InlineData(AutomationConditionSignalOp.In, "in")]
    public void Operator_wire_round_trips(AutomationConditionSignalOp op, string wire)
    {
        Assert.Equal(wire, ConditionCatalog.OperatorWire(op));
        Assert.Equal(op, ConditionCatalog.OperatorFromWire(wire));
    }

    [Fact]
    public void Geofence_and_other_automation_states_round_trip()
    {
        Assert.Equal("outside", ConditionCatalog.GeofenceStateWire(AutomationGeofenceState.Outside));
        Assert.Equal(AutomationGeofenceState.Dwell, ConditionCatalog.GeofenceStateFromWire("dwell"));
        Assert.Equal("recently_triggered",
            ConditionCatalog.OtherAutomationStateWire(AutomationOtherAutomationState.RecentlyTriggered));
        Assert.Equal(AutomationOtherAutomationState.Disabled,
            ConditionCatalog.OtherAutomationStateFromWire("disabled"));
    }

    [Fact]
    public void Catalogs_match_the_web_option_counts()
    {
        Assert.Equal(9, ConditionCatalog.Signals.Count);
        Assert.Equal(8, ConditionCatalog.Operators.Count);
        Assert.Equal(4, ConditionCatalog.ConditionTypes.Count);
        Assert.Equal(3, ConditionCatalog.GeofenceStates.Count);
        Assert.Equal(3, ConditionCatalog.OtherAutomationStates.Count);
        Assert.Equal(11, ConditionCatalog.Timezones.Count);
        Assert.Equal(7, ConditionCatalog.DayFallbacks.Count);
        Assert.Equal(new[] { 1, 2, 3, 4, 5 }, ConditionCatalog.DefaultDays.ToArray());
    }

    [Theory]
    [InlineData("is_locked", true)]
    [InlineData("sentry_mode", true)]
    [InlineData("battery_level", false)]
    [InlineData("state", false)]
    [InlineData("unknown", false)]
    public void IsBooleanSignal_matches_bool_field_keys(string key, bool expected) =>
        Assert.Equal(expected, ConditionCatalog.IsBooleanSignal(key));

    // ── Geofence JSON adapter (web useGeofences mapping) ────────────────────────────────────────────────

    [Fact]
    public void ParseList_reads_numeric_id_and_name_from_a_bare_array()
    {
        using var doc = JsonDocument.Parse("""[{"id":7,"name":"Home"},{"id":8,"name":"Work"}]""");

        var options = GeofenceOption.ParseList(doc.RootElement);

        Assert.Equal(2, options.Count);
        Assert.Equal("7", options[0].Id);
        Assert.Equal("Home", options[0].Name);
        Assert.Equal("8", options[1].Id);
    }

    [Fact]
    public void ParseList_tolerates_envelope_string_id_and_missing_name()
    {
        using var doc = JsonDocument.Parse(
            """{"geofences":[{"id":"abc","name":"Garage"},{"id":9}]}""");

        var options = GeofenceOption.ParseList(doc.RootElement);

        Assert.Equal(2, options.Count);
        Assert.Equal("abc", options[0].Id);
        Assert.Equal("9", options[1].Id);
        Assert.Equal("9", options[1].Name); // name falls back to the id
    }

    [Fact]
    public void ParseList_skips_entries_without_an_id_and_non_arrays()
    {
        using var noId = JsonDocument.Parse("""[{"name":"Nameless"}]""");
        Assert.Empty(GeofenceOption.ParseList(noId.RootElement));

        using var notArray = JsonDocument.Parse("{}");
        Assert.Empty(GeofenceOption.ParseList(notArray.RootElement));
    }

    [Fact]
    public void Source_map_preserves_status_and_parses_value()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"name":"Home"}]""");
        var loaded = ConditionBuilderSource.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal("Home", Assert.Single(loaded.Value!).Name);
        Assert.Equal(Now, loaded.FetchedAt);

        var loading = ConditionBuilderSource.Map(RepositoryResult<JsonElement>.Loading());
        Assert.Equal(LoadStatus.Loading, loading.Status);
        Assert.Null(loading.Value);

        var error = new RepositoryError(RepositoryErrorKind.Server, "boom");
        var failed = ConditionBuilderSource.Map(RepositoryResult<JsonElement>.Failure(error));
        Assert.Equal(LoadStatus.Error, failed.Status);
        Assert.Equal(error, failed.Error);
    }

    // ── Geofence picker projection (every state renders) ────────────────────────────────────────────────

    [Fact]
    public void ProjectGeofencePicker_ready_lists_prompt_first_then_places()
    {
        var display = ConditionBuilderProjection.ProjectGeofencePicker(
            ConditionGeofenceState.Ready,
            new[] { new GeofenceOption("7", "Home"), new GeofenceOption("8", "Work") },
            Localizer);

        Assert.Equal(ConditionGeofenceState.Ready, display.State);
        Assert.Equal(3, display.Options.Count);
        Assert.Equal(string.Empty, display.Options[0].Value);
        Assert.Equal("Select geofence...", display.Options[0].Label);
        Assert.Equal("Home", display.Options[1].Label);
        Assert.Null(display.StatusChip);
        Assert.Null(display.Hint);
        Assert.Null(display.RetryLabel);
    }

    [Fact]
    public void ProjectGeofencePicker_loading_and_empty_and_error_show_hints()
    {
        var loading = ConditionBuilderProjection.ProjectGeofencePicker(
            ConditionGeofenceState.Loading, Array.Empty<GeofenceOption>(), Localizer);
        Assert.False(string.IsNullOrWhiteSpace(loading.Hint));
        Assert.Single(loading.Options); // just the prompt

        var empty = ConditionBuilderProjection.ProjectGeofencePicker(
            ConditionGeofenceState.Empty, Array.Empty<GeofenceOption>(), Localizer);
        Assert.False(string.IsNullOrWhiteSpace(empty.Hint));

        var error = ConditionBuilderProjection.ProjectGeofencePicker(
            ConditionGeofenceState.Error, Array.Empty<GeofenceOption>(), Localizer);
        Assert.False(string.IsNullOrWhiteSpace(error.Hint));
        Assert.False(string.IsNullOrWhiteSpace(error.RetryLabel));
    }

    [Fact]
    public void ProjectGeofencePicker_stale_and_offline_show_chips()
    {
        var stale = ConditionBuilderProjection.ProjectGeofencePicker(
            ConditionGeofenceState.Stale, new[] { new GeofenceOption("1", "Home") }, Localizer);
        Assert.Equal("Stale", stale.StatusChip);
        Assert.Equal(StatusKind.Warning, stale.StatusChipKind);

        var offline = ConditionBuilderProjection.ProjectGeofencePicker(
            ConditionGeofenceState.Offline, new[] { new GeofenceOption("1", "Home") }, Localizer);
        Assert.Equal("Offline", offline.StatusChip);
        Assert.Equal(StatusKind.Danger, offline.StatusChipKind);
    }

    // ── Other projections + a11y label sources ──────────────────────────────────────────────────────────

    [Fact]
    public void Option_projections_resolve_localized_labels()
    {
        Assert.Equal(4, ConditionBuilderProjection.ConditionTypeOptions(Localizer).Count);
        Assert.Equal(9, ConditionBuilderProjection.SignalOptions(Localizer).Count);
        Assert.Equal(3, ConditionBuilderProjection.GeofenceStateOptions(Localizer).Count);
        Assert.Equal(3, ConditionBuilderProjection.OtherAutomationStateOptions(Localizer).Count);
        Assert.Equal(11, ConditionBuilderProjection.TimezoneOptions(Localizer).Count);

        var boolOptions = ConditionBuilderProjection.BooleanValueOptions(Localizer);
        Assert.Equal(new[] { "true", "false" }, boolOptions.Select(o => o.Value).ToArray());
        Assert.Equal("True", boolOptions[0].Label);
    }

    [Fact]
    public void Every_option_label_and_picker_field_label_is_non_empty()
    {
        Assert.All(ConditionBuilderProjection.ConditionTypeOptions(Localizer),
            o => Assert.False(string.IsNullOrWhiteSpace(o.Label)));
        Assert.All(ConditionBuilderProjection.SignalOptions(Localizer),
            o => Assert.False(string.IsNullOrWhiteSpace(o.Label)));

        var display = ConditionBuilderProjection.ProjectGeofencePicker(
            ConditionGeofenceState.Ready, Array.Empty<GeofenceOption>(), Localizer);
        Assert.False(string.IsNullOrWhiteSpace(display.Label));
        Assert.False(string.IsNullOrWhiteSpace(display.Prompt));
        Assert.False(string.IsNullOrWhiteSpace(display.HelpText));
    }

    [Fact]
    public void DayLabel_resolves_each_weekday()
    {
        Assert.Equal("Sun", ConditionBuilderProjection.DayLabel(0, Localizer));
        Assert.Equal("Sat", ConditionBuilderProjection.DayLabel(6, Localizer));
    }

    // ── View-model: condition list mutations (web controlled onChange) ──────────────────────────────────

    [Fact]
    public void ViewModel_starts_empty_and_loading_geofences()
    {
        using var vm = NewViewModel(out _);

        Assert.Empty(vm.Conditions);
        Assert.Equal(ConditionGeofenceState.Loading, vm.GeofenceState);
        Assert.False(string.IsNullOrWhiteSpace(vm.Title));
    }

    [Fact]
    public void ViewModel_seeds_initial_conditions()
    {
        using var vm = NewViewModel(out _, Signal(), ConditionBuilderLogic.CreateDefault(AutomationConditionKind.Geofence));

        Assert.Equal(2, vm.Conditions.Count);
    }

    [Fact]
    public void ViewModel_add_condition_appends_default_signal_and_raises_changed()
    {
        using var vm = NewViewModel(out _);
        IReadOnlyList<AutomationCondition>? raised = null;
        vm.ConditionsChanged += (_, c) => raised = c;

        vm.AddCondition();

        var condition = Assert.IsType<AutomationCondition.SignalCondition>(Assert.Single(vm.Conditions));
        Assert.Equal("battery_level", condition.Signal);
        Assert.NotNull(raised);
        Assert.Single(raised!);
    }

    [Fact]
    public void ViewModel_remove_condition_drops_the_row()
    {
        using var vm = NewViewModel(out _, Signal(), Signal(signal: "speed"));

        vm.RemoveCondition(0);

        var remaining = Assert.IsType<AutomationCondition.SignalCondition>(Assert.Single(vm.Conditions));
        Assert.Equal("speed", remaining.Signal);
    }

    [Fact]
    public void ViewModel_remove_condition_ignores_out_of_range_index()
    {
        using var vm = NewViewModel(out _, Signal());

        vm.RemoveCondition(5);

        Assert.Single(vm.Conditions);
    }

    [Fact]
    public void ViewModel_replace_condition_swaps_in_place()
    {
        using var vm = NewViewModel(out _, Signal(), Signal());

        vm.ReplaceCondition(1, ConditionBuilderLogic.CreateDefault(AutomationConditionKind.Geofence));

        Assert.IsType<AutomationCondition.GeofenceCondition>(vm.Conditions[1]);
        Assert.IsType<AutomationCondition.SignalCondition>(vm.Conditions[0]);
    }

    [Fact]
    public void ViewModel_change_condition_kind_seeds_the_default()
    {
        using var vm = NewViewModel(out _, Signal());

        vm.ChangeConditionKind(0, AutomationConditionKind.TimeWindow);

        var window = Assert.IsType<AutomationCondition.TimeWindowCondition>(Assert.Single(vm.Conditions));
        Assert.Equal("06:00", window.StartTime);
    }

    [Fact]
    public void ViewModel_set_conditions_replaces_the_whole_list()
    {
        using var vm = NewViewModel(out _, Signal());

        vm.SetConditions(new AutomationCondition[]
        {
            ConditionBuilderLogic.CreateDefault(AutomationConditionKind.Geofence),
            ConditionBuilderLogic.CreateDefault(AutomationConditionKind.OtherAutomation),
        });

        Assert.Equal(2, vm.Conditions.Count);
    }

    // ── View-model: geofence load matrix (loading / ready / empty / stale / offline / error) ────────────

    [Fact]
    public async Task ViewModel_geofences_loading_until_resolved()
    {
        using var vm = NewViewModel(Script(RepositoryResult<IReadOnlyList<GeofenceOption>>.Loading()));
        await vm.LoadGeofencesAsync();

        Assert.Equal(ConditionGeofenceState.Loading, vm.GeofenceState);
        Assert.False(string.IsNullOrWhiteSpace(vm.GeofenceDisplay.Hint));
    }

    [Fact]
    public async Task ViewModel_geofences_ready_with_places()
    {
        using var vm = NewViewModel(Script(Geofences(new GeofenceOption("1", "Home"))));
        await vm.LoadGeofencesAsync();

        Assert.Equal(ConditionGeofenceState.Ready, vm.GeofenceState);
        Assert.Single(vm.Geofences);
        Assert.NotNull(vm.GeofenceUpdatedAt);
        Assert.Equal(2, vm.GeofenceDisplay.Options.Count); // prompt + 1
    }

    [Fact]
    public async Task ViewModel_geofences_loaded_but_empty_is_empty_state()
    {
        using var vm = NewViewModel(Script(Geofences()));
        await vm.LoadGeofencesAsync();

        Assert.Equal(ConditionGeofenceState.Empty, vm.GeofenceState);
        Assert.False(string.IsNullOrWhiteSpace(vm.GeofenceDisplay.Hint));
    }

    [Fact]
    public async Task ViewModel_geofences_empty_status_is_empty_state()
    {
        using var vm = NewViewModel(Script(RepositoryResult<IReadOnlyList<GeofenceOption>>.Empty(Now)));
        await vm.LoadGeofencesAsync();

        Assert.Equal(ConditionGeofenceState.Empty, vm.GeofenceState);
    }

    [Fact]
    public async Task ViewModel_geofences_error_with_no_cache()
    {
        using var vm = NewViewModel(Script(RepositoryResult<IReadOnlyList<GeofenceOption>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom"))));
        await vm.LoadGeofencesAsync();

        Assert.Equal(ConditionGeofenceState.Error, vm.GeofenceState);
        Assert.False(string.IsNullOrWhiteSpace(vm.GeofenceDisplay.RetryLabel));
        Assert.True(vm.GeofenceAttempts >= 1);
    }

    [Fact]
    public async Task ViewModel_geofences_stale_cache_keeps_places()
    {
        using var vm = NewViewModel(Script(RepositoryResult<IReadOnlyList<GeofenceOption>>.Cached(
            new[] { new GeofenceOption("1", "Home") }, Now, stale: true)));
        await vm.LoadGeofencesAsync();

        Assert.Equal(ConditionGeofenceState.Stale, vm.GeofenceState);
        Assert.Equal("Stale", vm.GeofenceDisplay.StatusChip);
        Assert.Single(vm.Geofences);
    }

    [Fact]
    public async Task ViewModel_geofences_offline_keeps_places_and_shows_chip()
    {
        using var vm = NewViewModel(Script(RepositoryResult<IReadOnlyList<GeofenceOption>>.OfflineCached(
            new[] { new GeofenceOption("1", "Home") }, Now, new RepositoryError(RepositoryErrorKind.Network, "offline"))));
        await vm.LoadGeofencesAsync();

        Assert.Equal(ConditionGeofenceState.Offline, vm.GeofenceState);
        Assert.Equal("Offline", vm.GeofenceDisplay.StatusChip);
        Assert.Equal(StatusKind.Danger, vm.GeofenceDisplay.StatusChipKind);
    }

    [Fact]
    public async Task ViewModel_retry_reruns_the_load()
    {
        var source = new FakeSource(() => Script(Geofences(new GeofenceOption("1", "Home"))));
        using var vm = new ConditionBuilderViewModel(source, Localizer);

        await vm.LoadGeofencesAsync();
        await vm.RetryGeofencesAsync();

        Assert.Equal(2, source.Calls);
        Assert.Equal(ConditionGeofenceState.Ready, vm.GeofenceState);
    }

    // ── i18n key + fallback contract ────────────────────────────────────────────────────────────────────

    [Fact]
    public void Title_resolves_through_the_localizer()
    {
        var prefix = new PrefixLocalizer();
        using var vm = new ConditionBuilderViewModel(new FakeSource(() => Script()), prefix);

        Assert.Equal("L:automations.builder.title", vm.Title);
    }

    [Fact]
    public void Every_web_i18n_key_and_fallback_is_requested_from_the_catalog()
    {
        var recording = new RecordingLocalizer();

        _ = ConditionBuilderProjection.ConditionTypeOptions(recording);
        _ = ConditionBuilderProjection.SignalOptions(recording);
        _ = ConditionBuilderProjection.OperatorOptions("battery_level", recording);
        _ = ConditionBuilderProjection.GeofenceStateOptions(recording);
        _ = ConditionBuilderProjection.OtherAutomationStateOptions(recording);
        _ = ConditionBuilderProjection.TimezoneOptions(recording);
        _ = ConditionBuilderProjection.BooleanValueOptions(recording);
        _ = ConditionBuilderProjection.ProjectGeofencePicker(
            ConditionGeofenceState.Error, Array.Empty<GeofenceOption>(), recording);
        _ = ConditionBuilderProjection.DayLabel(0, recording);
        _ = ConditionBuilderRegistration.Name(recording);

        Assert.Equal("Signal Check", recording.Fallback("automations.conditions.signal"));
        Assert.Equal("Battery Level", recording.Fallback("automations.signals.battery_level"));
        Assert.Equal("Between", recording.Fallback("automations.operators.between"));
        Assert.Equal("Inside", recording.Fallback("automations.geofence.inside"));
        Assert.Equal("Recently Triggered", recording.Fallback("automations.otherAutomation.recentlyTriggered"));
        Assert.Equal("UTC (Default)", recording.Fallback("timezones.utc"));
        Assert.Equal("True", recording.Fallback("common.true"));
        Assert.Equal("Select geofence...", recording.Fallback("automations.builder.selectGeofence"));
        Assert.Equal("Couldn\u2019t load geofences", recording.Fallback("automations.builder.geofenceError"));
        Assert.Equal("Conditions", recording.Fallback("automations.builder.title"));
    }

    // ── Diagnostics (view.opened, PII-safe) ─────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ConditionBuilderDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ConditionBuilder", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_slug_carries_no_user_data() =>
        Assert.Equal("ConditionBuilder", ConditionBuilderRegistration.Slug);

    [Fact]
    public void ViewModel_dispose_is_idempotent()
    {
        var vm = NewViewModel(out _);
        vm.Dispose();
        vm.Dispose();
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────

    private static ConditionBuilderViewModel NewViewModel(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeofenceOption>>> script) =>
        new(new FakeSource(() => script), Localizer);

    private static ConditionBuilderViewModel NewViewModel(out FakeSource source, params AutomationCondition[] initial)
    {
        source = new FakeSource(() => Script(Geofences()));
        return new ConditionBuilderViewModel(source, Localizer, initial.Length == 0 ? null : initial);
    }

    private static RepositoryResult<IReadOnlyList<GeofenceOption>> Geofences(params GeofenceOption[] geofences) =>
        RepositoryResult<IReadOnlyList<GeofenceOption>>.Loaded(geofences, Now);

    private static async IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeofenceOption>>> Script(
        params RepositoryResult<IReadOnlyList<GeofenceOption>>[] results)
    {
        foreach (var result in results)
        {
            yield return result;
        }

        await Task.CompletedTask;
    }

    private sealed class FakeSource : IConditionBuilderSource
    {
        private readonly Func<IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeofenceOption>>>> _factory;

        public FakeSource(Func<IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeofenceOption>>>> factory) =>
            _factory = factory;

        public int Calls { get; private set; }

        public IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeofenceOption>>> StreamGeofencesAsync(
            CancellationToken cancellationToken = default)
        {
            Calls++;
            return _factory();
        }
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly Dictionary<string, string> _calls = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            _calls[key] = fallback;
            return fallback;
        }

        public string Fallback(string key) => _calls.TryGetValue(key, out var f) ? f : null!;
    }
}
