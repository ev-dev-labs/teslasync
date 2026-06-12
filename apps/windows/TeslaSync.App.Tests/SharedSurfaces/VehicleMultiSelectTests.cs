using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the VehicleMultiSelect surface's UI-thread-free logic — the registration slug +
/// i18n keys/fallbacks (<see cref="VehicleMultiSelectRegistration"/>), the summary/unknown interpolation, the
/// JSON → <see cref="VehicleOption"/> projection + fleet source (<see cref="VehicleMultiSelectProjection"/>,
/// <see cref="StaticVehicleMultiSelectFleetSource"/>), and the per-state view-model: the loading / loaded /
/// empty / error / stale / offline fleet matrix, the all / none / one / partial / count trigger summary, the
/// sentinel-restores-subset toggle, the never-dropped "Unknown" rows, the inline validation error, the
/// disabled empty-fleet trigger, open/close, the selection-change announcement and the PII-safe diagnostics
/// (<see cref="VehicleMultiSelectViewModel"/>, <see cref="VehicleMultiSelectDiagnostics"/>). Mirrors the web
/// spec one-for-one (web/src/components/forms/VehicleMultiSelect.tsx). The WinUI view (VehicleMultiSelect.cs)
/// is exercised by the app build.
/// </summary>
public sealed class VehicleMultiSelectTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private static IReadOnlyList<VehicleOption> Fleet =>
    [
        new(1, "Red Three", "5YJ3E1EA1JF000111", "Model 3"),
        new(2, "Blue Y", "7SAYGDEE9PF000222", "Model Y"),
        new(3, "White S", "5YJSA1E26HF000333", "Model S"),
    ];

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = [];

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static VehicleMultiSelectViewModel NewViewModel(
        IVehicleMultiSelectFleetSource? source = null,
        ILocalizer? localizer = null,
        VehicleMultiSelection? initial = null,
        IAnnouncerBus? announcer = null,
        string? validationErrorKey = null,
        bool disabled = false) =>
        new(
            source ?? new StaticVehicleMultiSelectFleetSource(Fleet, () => Now),
            localizer ?? PassthroughLocalizer.Instance,
            initial,
            announcer,
            validationErrorKey,
            disabled);

    private static async Task<VehicleMultiSelectViewModel> LoadedAsync(
        IVehicleMultiSelectFleetSource source,
        VehicleMultiSelection? initial = null,
        ILocalizer? localizer = null,
        IAnnouncerBus? announcer = null)
    {
        var vm = NewViewModel(source, localizer, initial, announcer);
        await vm.LoadVehiclesAsync();
        return vm;
    }

    private static List<string> CaptureAnnouncements(AnnouncerBus bus)
    {
        var captured = new List<string>();
        bus.Subscribe((msg, _) => captured.Add(msg.TrimEnd(AnnouncerText.ZeroWidthSpace)));
        return captured;
    }

    // ── registration: diagnostics slug + i18n keys/fallbacks (web verbatim) ───────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("VehicleMultiSelect", VehicleMultiSelectRegistration.Slug);

    [Theory]
    [InlineData(VehicleMultiSelectRegistration.SummaryAllKey, "translation.notifications.alertStudio.editor.vehiclesSummaryAll")]
    [InlineData(VehicleMultiSelectRegistration.SummaryNoneKey, "translation.notifications.alertStudio.editor.vehiclesSummaryNone")]
    [InlineData(VehicleMultiSelectRegistration.SummaryOneKey, "translation.notifications.alertStudio.editor.vehiclesSummaryOne")]
    [InlineData(VehicleMultiSelectRegistration.SummaryPartialKey, "translation.notifications.alertStudio.editor.vehiclesSummaryPartial")]
    [InlineData(VehicleMultiSelectRegistration.SummaryCountKey, "translation.notifications.alertStudio.editor.vehiclesSummaryCount")]
    [InlineData(VehicleMultiSelectRegistration.AllOptionKey, "translation.notifications.alertStudio.editor.vehiclesAllOption")]
    [InlineData(VehicleMultiSelectRegistration.UnknownLabelKey, "translation.notifications.alertStudio.editor.vehiclesUnknownLabel")]
    [InlineData(VehicleMultiSelectRegistration.UnknownBadgeKey, "translation.notifications.alertStudio.editor.vehiclesUnknownBadge")]
    [InlineData(VehicleMultiSelectRegistration.EmptyFleetHelpKey, "translation.notifications.alertStudio.editor.vehiclesEmptyFleetHelp")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(VehicleMultiSelectRegistration.SummaryAllFallback, "All vehicles")]
    [InlineData(VehicleMultiSelectRegistration.SummaryNoneFallback, "No vehicles selected")]
    [InlineData(VehicleMultiSelectRegistration.SummaryOneFallback, "{{name}}")]
    [InlineData(VehicleMultiSelectRegistration.SummaryPartialFallback, "{{count}} of {{total}} vehicles")]
    [InlineData(VehicleMultiSelectRegistration.SummaryCountFallback, "{{count}} vehicles")]
    [InlineData(VehicleMultiSelectRegistration.AllOptionFallback, "All vehicles (current + future)")]
    [InlineData(VehicleMultiSelectRegistration.UnknownLabelFallback, "Vehicle #{{id}}")]
    [InlineData(VehicleMultiSelectRegistration.UnknownBadgeFallback, "Unknown")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Fact]
    public void EmptyFleetHelp_fallback_keeps_the_web_arrow_copy() =>
        Assert.Equal(
            "Add a vehicle in Settings \u2192 Vehicles to use this rule.",
            VehicleMultiSelectRegistration.EmptyFleetHelpFallback);

    [Fact]
    public void Chrome_keys_reuse_the_canonical_catalog_keys()
    {
        Assert.Equal("translation.common.loading", VehicleMultiSelectRegistration.LoadingKey);
        Assert.Equal("translation.queryError.title", VehicleMultiSelectRegistration.ErrorKey);
        Assert.Equal("translation.common.retry", VehicleMultiSelectRegistration.RetryKey);
        Assert.Equal("translation.common.stale", VehicleMultiSelectRegistration.StaleKey);
        Assert.Equal("translation.common.offline", VehicleMultiSelectRegistration.OfflineKey);
    }

    // ── adapter: summary / unknown interpolation (web i18next + native positional tokens) ─────────────────

    [Fact]
    public void Summary_all_and_none_resolve_the_static_copy()
    {
        Assert.Equal("All vehicles", VehicleMultiSelectRegistration.Summary(
            PassthroughLocalizer.Instance, new SelectionSummary(SelectionSummaryKind.All, null, 3, 3)));
        Assert.Equal("No vehicles selected", VehicleMultiSelectRegistration.Summary(
            PassthroughLocalizer.Instance, new SelectionSummary(SelectionSummaryKind.None, null, 0, 3)));
    }

    [Fact]
    public void Summary_one_interpolates_the_name_token() =>
        Assert.Equal("Red Three", VehicleMultiSelectRegistration.Summary(
            PassthroughLocalizer.Instance, new SelectionSummary(SelectionSummaryKind.One, "Red Three", 1, 3)));

    [Fact]
    public void Summary_partial_interpolates_count_and_total() =>
        Assert.Equal("2 of 3 vehicles", VehicleMultiSelectRegistration.Summary(
            PassthroughLocalizer.Instance, new SelectionSummary(SelectionSummaryKind.Partial, null, 2, 3)));

    [Fact]
    public void Summary_count_interpolates_the_count_token() =>
        Assert.Equal("3 vehicles", VehicleMultiSelectRegistration.Summary(
            PassthroughLocalizer.Instance, new SelectionSummary(SelectionSummaryKind.Count, null, 3, 3)));

    [Fact]
    public void Summary_interpolates_the_native_positional_catalog_tokens()
    {
        // The resw catalog uses {0}/{1}; the projection must fill those too (not just the {{token}} fallback).
        var loc = new StubLocalizer(new()
        {
            [VehicleMultiSelectRegistration.SummaryPartialKey] = "{0} of {1} vehicles",
            [VehicleMultiSelectRegistration.SummaryCountKey] = "{0} vehicles",
        });
        Assert.Equal("2 of 3 vehicles", VehicleMultiSelectRegistration.Summary(
            loc, new SelectionSummary(SelectionSummaryKind.Partial, null, 2, 3)));
        Assert.Equal("3 vehicles", VehicleMultiSelectRegistration.Summary(
            loc, new SelectionSummary(SelectionSummaryKind.Count, null, 3, 3)));
    }

    [Fact]
    public void UnknownLabel_interpolates_the_id_token() =>
        Assert.Equal("Vehicle #99", VehicleMultiSelectRegistration.UnknownLabel(PassthroughLocalizer.Instance, 99));

    private sealed class StubLocalizer(Dictionary<string, string> map) : ILocalizer
    {
        public string GetString(string key, string fallback) => map.TryGetValue(key, out var v) ? v : fallback;
    }

    // ── adapter: JSON projection + empty detection ────────────────────────────────────────────────────────

    [Fact]
    public void ParseVehicles_folds_snake_case_wire_objects()
    {
        using JsonDocument doc = JsonDocument.Parse(
            """[{"id":1,"display_name":"Red Three","vin":"5YJ3E1EA1JF000111","model":"Model 3"},{"id":2,"model":"Model Y"}]""");
        IReadOnlyList<VehicleOption> parsed = VehicleMultiSelectProjection.ParseVehicles(doc.RootElement);
        Assert.Equal(2, parsed.Count);
        Assert.Equal("Red Three", parsed[0].DisplayName);
        Assert.Equal("Model 3", parsed[0].Model);
        Assert.Equal(2, parsed[1].Id);
        Assert.Null(parsed[1].DisplayName);
    }

    [Fact]
    public void ParseVehicles_accepts_camel_case_and_skips_idless_rows()
    {
        using JsonDocument doc = JsonDocument.Parse(
            """[{"id":7,"displayName":"Camel"},{"displayName":"no id"}]""");
        IReadOnlyList<VehicleOption> parsed = VehicleMultiSelectProjection.ParseVehicles(doc.RootElement);
        VehicleOption only = Assert.Single(parsed);
        Assert.Equal(7, only.Id);
        Assert.Equal("Camel", only.DisplayName);
    }

    [Theory]
    [InlineData("[]", true)]
    [InlineData("null", true)]
    [InlineData("[{\"id\":1}]", false)]
    public void IsEmptyArray_matches_the_web_empty_rule(string json, bool expected)
    {
        using JsonDocument doc = JsonDocument.Parse(json);
        Assert.Equal(expected, VehicleMultiSelectProjection.IsEmptyArray(doc.RootElement));
    }

    [Fact]
    public async Task StaticSource_default_emits_loaded_or_empty()
    {
        var loadedVm = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(Fleet, () => Now));
        Assert.Equal(VehicleMultiSelectFleetState.Loaded, loadedVm.FleetState);

        var emptyVm = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(null, () => Now));
        Assert.Equal(VehicleMultiSelectFleetState.Empty, emptyVm.FleetState);
    }

    // ── view-model: the fleet state matrix (loading / loaded / empty / error / stale / offline) ────────────

    [Fact]
    public async Task FleetState_loading_when_no_terminal_snapshot()
    {
        var source = StaticVehicleMultiSelectFleetSource.Emitting(
            RepositoryResult<IReadOnlyList<VehicleOption>>.Loading());
        var vm = await LoadedAsync(source);
        Assert.True(vm.IsLoading);
        Assert.False(vm.HasFleet);
    }

    [Fact]
    public async Task FleetState_loaded_exposes_the_fleet()
    {
        var vm = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(Fleet, () => Now));
        Assert.Equal(VehicleMultiSelectFleetState.Loaded, vm.FleetState);
        Assert.True(vm.HasFleet);
        Assert.Equal(3, vm.Vehicles.Count);
        Assert.False(vm.IsDisabled);
    }

    [Fact]
    public async Task FleetState_empty_disables_the_trigger_and_shows_help()
    {
        var vm = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(Array.Empty<VehicleOption>(), () => Now));
        Assert.True(vm.IsFleetEmpty);
        Assert.True(vm.IsDisabled);   // web disabled || isFleetEmpty
        Assert.False(vm.HasFleet);
    }

    [Fact]
    public async Task FleetState_error_when_failure_with_no_cache()
    {
        var source = StaticVehicleMultiSelectFleetSource.Emitting(
            RepositoryResult<IReadOnlyList<VehicleOption>>.Failure(
                new RepositoryError(RepositoryErrorKind.Network, "boom")));
        var vm = await LoadedAsync(source);
        Assert.True(vm.IsFleetError);
        Assert.False(vm.HasFleet);
    }

    [Fact]
    public async Task FleetState_stale_keeps_the_cached_fleet_visible()
    {
        var source = StaticVehicleMultiSelectFleetSource.Emitting(
            RepositoryResult<IReadOnlyList<VehicleOption>>.Cached(Fleet, Now, stale: true));
        var vm = await LoadedAsync(source);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasFleet);     // cached value never hidden behind a refresh
        Assert.Equal(3, vm.Vehicles.Count);
    }

    [Fact]
    public async Task FleetState_offline_keeps_the_cached_fleet_visible()
    {
        var source = StaticVehicleMultiSelectFleetSource.Emitting(
            RepositoryResult<IReadOnlyList<VehicleOption>>.OfflineCached(
                Fleet, Now, new RepositoryError(RepositoryErrorKind.Offline, "offline")));
        var vm = await LoadedAsync(source);
        Assert.True(vm.IsOffline);
        Assert.True(vm.HasFleet);
        Assert.Equal(3, vm.Vehicles.Count);
    }

    [Fact]
    public async Task RetryVehicles_reloads_after_an_error()
    {
        var source = StaticVehicleMultiSelectFleetSource.Emitting(
            RepositoryResult<IReadOnlyList<VehicleOption>>.Loaded(Fleet, Now));
        var vm = await LoadedAsync(source);
        await vm.RetryVehiclesAsync();
        Assert.Equal(VehicleMultiSelectFleetState.Loaded, vm.FleetState);
    }

    // ── view-model: trigger summary (web triggerSummary ternary) ──────────────────────────────────────────

    [Fact]
    public async Task TriggerSummary_all_none_one_partial_count()
    {
        var all = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(Fleet, () => Now), VehicleMultiSelection.AllSticky);
        Assert.Equal("All vehicles", all.TriggerSummary);

        var none = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(Fleet, () => Now), VehicleMultiSelection.Specific([]));
        Assert.Equal("No vehicles selected", none.TriggerSummary);

        var one = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(Fleet, () => Now), VehicleMultiSelection.Specific([1]));
        Assert.Equal("Red Three", one.TriggerSummary);

        var partial = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(Fleet, () => Now), VehicleMultiSelection.Specific([1, 2]));
        Assert.Equal("2 of 3 vehicles", partial.TriggerSummary);

        var count = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(Fleet, () => Now), VehicleMultiSelection.Specific([1, 2, 3]));
        Assert.Equal("3 vehicles", count.TriggerSummary);
    }

    // ── view-model: selection toggles (web handleToggleAll / handleToggleVehicle) ─────────────────────────

    [Fact]
    public async Task ToggleAll_then_off_restores_the_previous_subset()
    {
        var vm = await LoadedAsync(
            new StaticVehicleMultiSelectFleetSource(Fleet, () => Now), VehicleMultiSelection.Specific([1, 2]));
        vm.ToggleAll();
        Assert.True(vm.Selection.IsAll);
        vm.ToggleAll();
        Assert.Equal(VehicleSelectionKind.Specific, vm.Selection.Kind);
        Assert.Equal([1L, 2L], vm.Selection.VehicleIds);
    }

    [Fact]
    public async Task ToggleVehicle_from_all_becomes_specific()
    {
        var vm = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(Fleet, () => Now), VehicleMultiSelection.AllSticky);
        vm.ToggleVehicle(2);
        Assert.Equal(VehicleSelectionKind.Specific, vm.Selection.Kind);
        Assert.Equal([2L], vm.Selection.VehicleIds);
    }

    [Fact]
    public async Task SelectionChanged_fires_on_toggle()
    {
        var vm = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(Fleet, () => Now), VehicleMultiSelection.AllSticky);
        VehicleMultiSelection? captured = null;
        vm.SelectionChanged += (_, sel) => captured = sel;
        vm.ToggleVehicle(1);
        Assert.NotNull(captured);
        Assert.Equal([1L], captured!.VehicleIds);
    }

    [Fact]
    public async Task Payload_builds_the_wire_shape()
    {
        var all = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(Fleet, () => Now), VehicleMultiSelection.AllSticky);
        Assert.True(all.Payload.AllVehicles);
        Assert.Empty(all.Payload.VehicleIds);

        var some = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(Fleet, () => Now), VehicleMultiSelection.Specific([3, 1]));
        Assert.False(some.Payload.AllVehicles);
        Assert.Equal([1L, 3L], some.Payload.VehicleIds);
    }

    // ── view-model: option rows incl. unknown (web vehicles.map + unknownIds) ─────────────────────────────

    [Fact]
    public async Task Options_lead_with_the_all_sentinel_then_each_vehicle()
    {
        var vm = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(Fleet, () => Now), VehicleMultiSelection.Specific([1]));
        IReadOnlyList<VehicleMultiSelectOption> options = vm.Options;
        Assert.Equal(VehicleMultiSelectOptionKind.AllSentinel, options[0].Kind);
        Assert.False(options[0].IsChecked);
        Assert.Equal("vehicle-multiselect-option-all_sticky_sentinel", options[0].AutomationId);

        VehicleMultiSelectOption row1 = options.Single(o => o.Kind == VehicleMultiSelectOptionKind.Vehicle && o.Id == 1);
        Assert.True(row1.IsChecked);
        Assert.Equal("vehicle-multiselect-option-1", row1.AutomationId);
        Assert.Contains("Red Three", row1.Label);
    }

    [Fact]
    public async Task Options_preserve_unknown_ids_with_a_badge_row()
    {
        var vm = await LoadedAsync(
            new StaticVehicleMultiSelectFleetSource(Fleet, () => Now), VehicleMultiSelection.Specific([1, 99]));
        Assert.Equal([99L], vm.UnknownIds);
        VehicleMultiSelectOption unknown = vm.Options.Single(o => o.Kind == VehicleMultiSelectOptionKind.Unknown);
        Assert.Equal(99, unknown.Id);
        Assert.True(unknown.IsChecked);
        Assert.Equal("Vehicle #99", unknown.Label);
        Assert.Equal("vehicle-multiselect-option-unknown-99", unknown.AutomationId);
    }

    [Fact]
    public async Task Unknown_id_is_not_dropped_until_toggled_off()
    {
        var vm = await LoadedAsync(
            new StaticVehicleMultiSelectFleetSource(Fleet, () => Now), VehicleMultiSelection.Specific([99]));
        Assert.Equal([99L], vm.UnknownIds);
        vm.ToggleVehicle(99);
        Assert.Empty(vm.UnknownIds);
        Assert.Empty(vm.Selection.VehicleIds);
    }

    // ── view-model: open/close + disabled gating ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Open_and_close_toggle_the_listbox_when_pickable()
    {
        var vm = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(Fleet, () => Now));
        vm.Open();
        Assert.True(vm.IsOpen);
        vm.Toggle();
        Assert.False(vm.IsOpen);
    }

    [Fact]
    public async Task Open_is_a_noop_when_fleet_empty()
    {
        var vm = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(Array.Empty<VehicleOption>(), () => Now));
        vm.Open();
        Assert.False(vm.IsOpen);
    }

    [Fact]
    public async Task Disabled_prop_forces_disabled_and_closes()
    {
        var vm = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(Fleet, () => Now));
        vm.Open();
        Assert.True(vm.IsOpen);
        vm.Disabled = true;
        Assert.True(vm.IsDisabled);
        Assert.False(vm.IsOpen);
    }

    // ── view-model: inline validation error (web errorKey) ────────────────────────────────────────────────

    [Fact]
    public async Task ValidationError_resolves_through_the_localizer()
    {
        var loc = new RecordingLocalizer();
        var vm = NewViewModel(
            new StaticVehicleMultiSelectFleetSource(Fleet, () => Now),
            loc,
            validationErrorKey: "notifications.alertStudio.editor.vehiclesEmptyError");
        await vm.LoadVehiclesAsync();
        Assert.True(vm.HasValidationError);
        Assert.Equal("notifications.alertStudio.editor.vehiclesEmptyError", vm.ValidationError);
        Assert.Contains("notifications.alertStudio.editor.vehiclesEmptyError", loc.RequestedKeys);
    }

    [Fact]
    public async Task ValidationError_absent_when_no_key()
    {
        var vm = await LoadedAsync(new StaticVehicleMultiSelectFleetSource(Fleet, () => Now));
        Assert.False(vm.HasValidationError);
        Assert.Null(vm.ValidationError);
    }

    // ── accessibility: labels + selection announcement ────────────────────────────────────────────────────

    [Fact]
    public void Localized_labels_flow_through_the_i18n_facade()
    {
        var loc = new RecordingLocalizer();
        var vm = NewViewModel(localizer: loc);
        _ = vm.Label;
        _ = vm.EmptyFleetHelp;
        _ = vm.UnknownBadge;
        _ = vm.LoadingLabel;
        _ = vm.ErrorTitle;
        _ = vm.RetryLabel;
        _ = vm.StaleLabel;
        _ = vm.OfflineLabel;
        Assert.Contains(VehicleMultiSelectRegistration.LabelKey, loc.RequestedKeys);
        Assert.Contains(VehicleMultiSelectRegistration.EmptyFleetHelpKey, loc.RequestedKeys);
        Assert.Contains(VehicleMultiSelectRegistration.UnknownBadgeKey, loc.RequestedKeys);
        Assert.Contains(VehicleMultiSelectRegistration.LoadingKey, loc.RequestedKeys);
        Assert.Contains(VehicleMultiSelectRegistration.ErrorKey, loc.RequestedKeys);
        Assert.Contains(VehicleMultiSelectRegistration.RetryKey, loc.RequestedKeys);
        Assert.Contains(VehicleMultiSelectRegistration.StaleKey, loc.RequestedKeys);
        Assert.Contains(VehicleMultiSelectRegistration.OfflineKey, loc.RequestedKeys);
    }

    [Fact]
    public async Task Selection_change_is_announced_with_the_new_summary()
    {
        var bus = new AnnouncerBus();
        List<string> announced = CaptureAnnouncements(bus);
        var vm = await LoadedAsync(
            new StaticVehicleMultiSelectFleetSource(Fleet, () => Now),
            VehicleMultiSelection.AllSticky,
            announcer: bus);
        vm.ToggleVehicle(1);
        Assert.Contains("Red Three", announced);
    }

    [Fact]
    public void EveryOption_carries_an_accessible_label_and_automation_id()
    {
        var vm = NewViewModel(initial: VehicleMultiSelection.Specific([1, 99]));
        // Even before the fleet resolves, the sentinel + unknown rows must carry a label + automation id.
        foreach (VehicleMultiSelectOption option in vm.Options)
        {
            Assert.False(string.IsNullOrWhiteSpace(option.Label));
            Assert.StartsWith("vehicle-multiselect-option-", option.AutomationId);
        }
    }

    // ── diagnostics: PII-safe view.opened ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_the_surface_slug()
    {
        var events = new List<string>();
        var diagnostics = new VehicleMultiSelectDiagnostics(events.Add);
        diagnostics.RecordViewOpened();
        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VehicleMultiSelect", Assert.Single(events));
    }
}
