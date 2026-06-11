using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the <c>DashboardSettingsModal</c> overlay surface's UI-thread-free logic — the
/// localized projection (vehicle / refresh option lists, icon + settings defaulting, the save diff), the reactive
/// controlled-form view-model (open-time reset, the editable fields, the save / cancel commands, the i18n reload),
/// the accessible label set and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/dashboard/components/DashboardSettingsModal.tsx +
/// web/src/features/dashboard/widgets/types.ts). The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class DashboardSettingsModalTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static readonly IReadOnlyList<VehicleOption> TwoVehicles =
    [
        new VehicleOption(1, "Garage 3"),
        new VehicleOption(2, "Road Y"),
    ];

    // ── Projection: icon + settings defaulting (web ?? fallbacks) ─────────────────────────────────────────

    [Fact]
    public void NormalizeIcon_falls_back_to_the_default_glyph_when_unset()
    {
        Assert.Equal(DashboardSettingsModalRegistration.DefaultIcon, DashboardSettingsModalProjection.NormalizeIcon(null));
        Assert.Equal("🔋", DashboardSettingsModalProjection.NormalizeIcon("🔋"));
    }

    [Fact]
    public void ResolveSettings_falls_back_to_the_defaults_when_unset()
    {
        Assert.Equal(DashboardSettingsValues.Default, DashboardSettingsModalProjection.ResolveSettings(null));

        var custom = new DashboardSettingsValues(30, 7, true, true);
        Assert.Equal(custom, DashboardSettingsModalProjection.ResolveSettings(custom));
    }

    [Fact]
    public void DefaultSettings_match_the_web_DEFAULT_DASHBOARD_SETTINGS()
    {
        DashboardSettingsValues defaults = DashboardSettingsValues.Default;

        Assert.Equal(0, defaults.RefreshIntervalSeconds);
        Assert.Null(defaults.VehicleId);
        Assert.False(defaults.ShowWidgetBorders);
        Assert.False(defaults.CompactMode);
    }

    // ── Projection: the icon picker grid ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Emojis_are_the_sixteen_web_glyphs_in_order()
    {
        IReadOnlyList<string> emojis = DashboardSettingsModalProjection.Emojis();

        Assert.Equal(16, emojis.Count);
        Assert.Equal("📊", emojis[0]);
        Assert.Equal("⭐", emojis[^1]);
        Assert.Equal(emojis.Count, new HashSet<string>(emojis).Count);
        Assert.Contains(DashboardSettingsModalRegistration.DefaultIcon, emojis);
    }

    // ── Projection: vehicle-filter options (web vehicleOptions) ───────────────────────────────────────────

    [Fact]
    public void VehicleOptions_lead_with_all_vehicles_then_one_per_vehicle()
    {
        IReadOnlyList<DashboardSelectOption> options =
            DashboardSettingsModalProjection.VehicleOptions(TwoVehicles, Localizer);

        Assert.Equal(3, options.Count);
        Assert.Equal(string.Empty, options[0].Value);
        Assert.Equal("All Vehicles", options[0].Label);
        Assert.Equal("1", options[1].Value);
        Assert.Equal("Garage 3", options[1].Label);
        Assert.Equal("2", options[2].Value);
        Assert.Equal("Road Y", options[2].Label);
    }

    [Fact]
    public void VehicleOptions_with_no_vehicles_is_just_all_vehicles()
    {
        IReadOnlyList<DashboardSelectOption> options =
            DashboardSettingsModalProjection.VehicleOptions(Array.Empty<VehicleOption>(), Localizer);

        DashboardSelectOption only = Assert.Single(options);
        Assert.Equal(string.Empty, only.Value);
        Assert.Equal("All Vehicles", only.Label);
    }

    [Fact]
    public void VehicleOptions_reject_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() =>
            DashboardSettingsModalProjection.VehicleOptions(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() =>
            DashboardSettingsModalProjection.VehicleOptions(TwoVehicles, null!));
    }

    // ── Projection: auto-refresh options (web REFRESH_OPTIONS) ────────────────────────────────────────────

    [Fact]
    public void RefreshOptions_are_the_six_web_cadences_in_order()
    {
        IReadOnlyList<DashboardSelectOption> options = DashboardSettingsModalProjection.RefreshOptions(Localizer);

        Assert.Equal(6, options.Count);
        Assert.Equal(new[] { "0", "5", "10", "30", "60", "300" }, options.Select(o => o.Value).ToArray());
        Assert.Equal("Default (per widget)", options[0].Label);
        Assert.Equal("Every 5 seconds", options[1].Label);
        Assert.Equal("Every 10 seconds", options[2].Label);
        Assert.Equal("Every 30 seconds", options[3].Label);
        Assert.Equal("Every minute", options[4].Label);
        Assert.Equal("Every 5 minutes", options[5].Label);
    }

    [Fact]
    public void RefreshOptions_reject_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => DashboardSettingsModalProjection.RefreshOptions(null!));

    // ── Projection: the save diff (web handleSave) ────────────────────────────────────────────────────────

    private static SavedDashboardInput Sample(
        string name = "My Dashboard",
        string? icon = "📊",
        DashboardSettingsValues? settings = null) =>
        new("dash-1", name, icon, settings);

    [Fact]
    public void BuildSaveResult_renames_only_when_the_trimmed_name_changed()
    {
        DashboardSettingsValues settings = DashboardSettingsValues.Default;

        DashboardSettingsSaveResult changed = DashboardSettingsModalProjection.BuildSaveResult(
            Sample(name: "Old"), "  New  ", "📊", settings);
        Assert.Equal("New", changed.RenameTo);

        DashboardSettingsSaveResult unchanged = DashboardSettingsModalProjection.BuildSaveResult(
            Sample(name: "Old"), "Old", "📊", settings);
        Assert.Null(unchanged.RenameTo);
    }

    [Fact]
    public void BuildSaveResult_does_not_rename_to_an_empty_name()
    {
        DashboardSettingsSaveResult result = DashboardSettingsModalProjection.BuildSaveResult(
            Sample(name: "Old"), "   ", "📊", DashboardSettingsValues.Default);

        Assert.Null(result.RenameTo);
    }

    [Fact]
    public void BuildSaveResult_changes_the_icon_only_when_it_changed()
    {
        DashboardSettingsValues settings = DashboardSettingsValues.Default;

        DashboardSettingsSaveResult changed = DashboardSettingsModalProjection.BuildSaveResult(
            Sample(icon: "📊"), "My Dashboard", "🔋", settings);
        Assert.Equal("🔋", changed.IconTo);

        DashboardSettingsSaveResult unchanged = DashboardSettingsModalProjection.BuildSaveResult(
            Sample(icon: "📊"), "My Dashboard", "📊", settings);
        Assert.Null(unchanged.IconTo);
    }

    [Fact]
    public void BuildSaveResult_treats_a_normalized_default_icon_over_an_unset_one_as_a_change()
    {
        // Web parity: icon state is normalized to '📊' while dashboard.icon is undefined, so they differ.
        DashboardSettingsSaveResult result = DashboardSettingsModalProjection.BuildSaveResult(
            Sample(icon: null), "My Dashboard", "📊", DashboardSettingsValues.Default);

        Assert.Equal("📊", result.IconTo);
    }

    [Fact]
    public void BuildSaveResult_always_carries_the_settings()
    {
        var settings = new DashboardSettingsValues(60, 3, true, true);

        DashboardSettingsSaveResult result = DashboardSettingsModalProjection.BuildSaveResult(
            Sample(), "My Dashboard", "📊", settings);

        Assert.Equal(settings, result.Settings);
    }

    [Fact]
    public void BuildSaveResult_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() =>
            DashboardSettingsModalProjection.BuildSaveResult(null!, "n", "📊", DashboardSettingsValues.Default));
        Assert.Throws<ArgumentNullException>(() =>
            DashboardSettingsModalProjection.BuildSaveResult(Sample(), "n", "📊", null!));
    }

    // ── Projection: i18n keys flow through the facade ─────────────────────────────────────────────────────

    [Fact]
    public void Option_projections_flow_through_the_i18n_keys()
    {
        var localizer = new KeyCapturingLocalizer();

        DashboardSettingsModalProjection.VehicleOptions(TwoVehicles, localizer);
        DashboardSettingsModalProjection.RefreshOptions(localizer);

        Assert.Contains("dashSettings.allVehicles", localizer.RequestedKeys);
        Assert.Contains("dashSettings.refresh0", localizer.RequestedKeys);
        Assert.Contains("dashSettings.refresh300", localizer.RequestedKeys);
    }

    // ── Registration: stable metadata + ordering ──────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("DashboardSettingsModal", DashboardSettingsModalRegistration.Slug);

    [Fact]
    public void Registration_refresh_order_matches_the_web_options() =>
        Assert.Equal(new[] { 0, 5, 10, 30, 60, 300 }, DashboardSettingsModalRegistration.RefreshSecondsOrder.ToArray());

    [Fact]
    public void Registration_resolves_every_label_to_its_web_fallback()
    {
        Assert.Equal("Dashboard Settings", DashboardSettingsModalRegistration.Title(Localizer));
        Assert.Equal("Identity", DashboardSettingsModalRegistration.Identity(Localizer));
        Assert.Equal("Name", DashboardSettingsModalRegistration.NameLabel(Localizer));
        Assert.Equal("Dashboard name", DashboardSettingsModalRegistration.NamePrompt(Localizer));
        Assert.Equal("Icon", DashboardSettingsModalRegistration.IconLabel(Localizer));
        Assert.Equal("Vehicle Filter", DashboardSettingsModalRegistration.VehicleFilter(Localizer));
        Assert.Equal("All Vehicles", DashboardSettingsModalRegistration.AllVehicles(Localizer));
        Assert.Equal("Auto-Refresh", DashboardSettingsModalRegistration.Refresh(Localizer));
        Assert.Equal("Display", DashboardSettingsModalRegistration.Display(Localizer));
        Assert.Equal("Show widget borders", DashboardSettingsModalRegistration.ShowBorders(Localizer));
        Assert.Equal("Compact mode (smaller gaps)", DashboardSettingsModalRegistration.CompactMode(Localizer));
        Assert.Equal("Cancel", DashboardSettingsModalRegistration.Cancel(Localizer));
        Assert.Equal("Save", DashboardSettingsModalRegistration.Save(Localizer));
    }

    // ── ViewModel: initial (closed) state ─────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_starts_closed_with_the_static_options_resolved()
    {
        using var vm = new DashboardSettingsModalViewModel(Localizer);

        Assert.Equal(DashboardSettingsModalState.Closed, vm.State);
        Assert.False(vm.IsOpen);
        Assert.Equal(6, vm.RefreshOptions.Count);
        Assert.Equal(16, vm.Emojis.Count);
        Assert.Empty(vm.VehicleOptions);
        Assert.False(vm.HasVehicles);
    }

    // ── ViewModel: open seeds the form (web useEffect reset) ──────────────────────────────────────────────

    [Fact]
    public void Open_seeds_every_field_from_the_dashboard_and_records_the_view()
    {
        var captured = new List<string>();
        using var vm = NewViewModel(captured);

        var settings = new DashboardSettingsValues(30, 2, true, true);
        vm.Open(Sample(name: "Trips", icon: "🚗", settings: settings), TwoVehicles);

        Assert.Equal(DashboardSettingsModalState.Ready, vm.State);
        Assert.True(vm.IsOpen);
        Assert.Equal("Trips", vm.Name);
        Assert.Equal("🚗", vm.Icon);
        Assert.Equal(2, vm.VehicleId);
        Assert.Equal(30, vm.RefreshIntervalSeconds);
        Assert.True(vm.ShowWidgetBorders);
        Assert.True(vm.CompactMode);
        Assert.Equal(3, vm.VehicleOptions.Count);
        Assert.True(vm.HasVehicles);
        Assert.Equal("view.opened slug=DashboardSettingsModal", Assert.Single(captured));
    }

    [Fact]
    public void Open_without_settings_uses_the_defaults()
    {
        using var vm = new DashboardSettingsModalViewModel(Localizer);

        vm.Open(Sample(settings: null), TwoVehicles);

        Assert.Equal(0, vm.RefreshIntervalSeconds);
        Assert.Null(vm.VehicleId);
        Assert.False(vm.ShowWidgetBorders);
        Assert.False(vm.CompactMode);
    }

    [Fact]
    public void Open_without_an_icon_uses_the_default_glyph()
    {
        using var vm = new DashboardSettingsModalViewModel(Localizer);

        vm.Open(Sample(icon: null), TwoVehicles);

        Assert.Equal(DashboardSettingsModalRegistration.DefaultIcon, vm.Icon);
    }

    [Fact]
    public void Open_with_no_vehicles_degrades_to_the_all_vehicles_option()
    {
        using var vm = new DashboardSettingsModalViewModel(Localizer);

        vm.Open(Sample(), Array.Empty<VehicleOption>());

        Assert.False(vm.HasVehicles);
        DashboardSelectOption only = Assert.Single(vm.VehicleOptions);
        Assert.Equal(string.Empty, only.Value);
    }

    [Fact]
    public void Open_reseeds_the_form_when_a_different_dashboard_is_opened()
    {
        using var vm = new DashboardSettingsModalViewModel(Localizer);

        vm.Open(Sample(name: "First", icon: "🚗"), TwoVehicles);
        vm.Open(Sample(name: "Second", icon: "🔋"), Array.Empty<VehicleOption>());

        Assert.Equal("Second", vm.Name);
        Assert.Equal("🔋", vm.Icon);
        Assert.False(vm.HasVehicles);
    }

    // ── ViewModel: save (web handleSave) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Save_raises_the_diff_records_the_event_and_requests_close()
    {
        var captured = new List<string>();
        using var vm = NewViewModel(captured);
        vm.Open(Sample(name: "Old", icon: "📊"), TwoVehicles);
        captured.Clear();

        DashboardSettingsSaveResult? raised = null;
        var order = new List<string>();
        vm.SaveRequested += (_, r) =>
        {
            raised = r;
            order.Add("save");
        };
        vm.CloseRequested += (_, _) => order.Add("close");

        vm.Name = "New";
        vm.Icon = "🔋";
        vm.RefreshIntervalSeconds = 30;
        vm.VehicleId = 2;
        vm.ShowWidgetBorders = true;
        vm.CompactMode = true;

        DashboardSettingsSaveResult result = vm.Save();

        Assert.NotNull(raised);
        Assert.Equal("New", result.RenameTo);
        Assert.Equal("🔋", result.IconTo);
        Assert.Equal(new DashboardSettingsValues(30, 2, true, true), result.Settings);
        Assert.Equal(raised, result);
        Assert.Equal(new[] { "save", "close" }, order);
        Assert.Equal("settings.saved slug=DashboardSettingsModal", Assert.Single(captured));
        Assert.Equal(DashboardSettingsModalState.Closed, vm.State);
        Assert.False(vm.IsOpen);
    }

    [Fact]
    public void Save_without_edits_carries_no_rename_or_icon_change()
    {
        using var vm = new DashboardSettingsModalViewModel(Localizer);
        vm.Open(Sample(name: "Keep", icon: "🚗"), TwoVehicles);

        DashboardSettingsSaveResult result = vm.Save();

        Assert.Null(result.RenameTo);
        Assert.Null(result.IconTo);
        Assert.Equal(DashboardSettingsValues.Default, result.Settings);
    }

    [Fact]
    public void Cancel_requests_close_without_saving()
    {
        var captured = new List<string>();
        using var vm = NewViewModel(captured);
        vm.Open(Sample(), TwoVehicles);
        captured.Clear();

        bool saved = false;
        bool closed = false;
        vm.SaveRequested += (_, _) => saved = true;
        vm.CloseRequested += (_, _) => closed = true;

        vm.Cancel();

        Assert.False(saved);
        Assert.True(closed);
        Assert.Empty(captured);
        Assert.Equal(DashboardSettingsModalState.Closed, vm.State);
    }

    [Fact]
    public void Editing_a_field_raises_property_changed()
    {
        using var vm = new DashboardSettingsModalViewModel(Localizer);
        vm.Open(Sample(), TwoVehicles);

        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Name = "Renamed";
        vm.CompactMode = true;

        Assert.Contains(nameof(DashboardSettingsModalViewModel.Name), changed);
        Assert.Contains(nameof(DashboardSettingsModalViewModel.CompactMode), changed);
    }

    // ── ViewModel: i18n reload ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Reload_reprojects_the_labels_and_options_after_a_language_change()
    {
        var localizer = new MutableLocalizer { Suffix = string.Empty };
        using var vm = new DashboardSettingsModalViewModel(localizer);
        vm.Open(Sample(), TwoVehicles);

        Assert.Equal("Dashboard Settings", vm.Title);
        Assert.Equal("All Vehicles", vm.VehicleOptions[0].Label);

        localizer.Suffix = " (es)";
        vm.Reload();

        Assert.Equal("Dashboard Settings (es)", vm.Title);
        Assert.Equal("All Vehicles (es)", vm.VehicleOptions[0].Label);
        Assert.Equal("Default (per widget) (es)", vm.RefreshOptions[0].Label);
    }

    // ── ViewModel: argument guards + dispose ──────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => new DashboardSettingsModalViewModel(null!));

    [Fact]
    public void Open_rejects_null_arguments()
    {
        using var vm = new DashboardSettingsModalViewModel(Localizer);

        Assert.Throws<ArgumentNullException>(() => vm.Open(null!, TwoVehicles));
        Assert.Throws<ArgumentNullException>(() => vm.Open(Sample(), null!));
    }

    [Fact]
    public void Dispose_is_idempotent()
    {
        var vm = new DashboardSettingsModalViewModel(Localizer);

        vm.Dispose();
        vm.Dispose();
    }

    // ── Accessibility: every visible label resolves and flows through an i18n key ─────────────────────────

    [Fact]
    public void Every_label_is_non_empty()
    {
        using var vm = new DashboardSettingsModalViewModel(Localizer);
        vm.Open(Sample(), TwoVehicles);

        foreach (string label in new[]
        {
            vm.Title, vm.IdentityLabel, vm.NameLabel, vm.NamePrompt, vm.IconLabel, vm.VehicleFilterLabel,
            vm.VehicleFilterDescription, vm.RefreshLabel, vm.DisplayLabel, vm.ShowBordersLabel,
            vm.CompactModeLabel, vm.CancelLabel, vm.SaveLabel,
        })
        {
            Assert.False(string.IsNullOrWhiteSpace(label));
        }
    }

    [Fact]
    public void Every_label_flows_through_an_i18n_key()
    {
        var localizer = new KeyCapturingLocalizer();
        using var vm = new DashboardSettingsModalViewModel(localizer);
        vm.Open(Sample(), TwoVehicles);

        _ = vm.Title;
        _ = vm.IdentityLabel;
        _ = vm.NameLabel;
        _ = vm.NamePrompt;
        _ = vm.IconLabel;
        _ = vm.VehicleFilterLabel;
        _ = vm.VehicleFilterDescription;
        _ = vm.RefreshLabel;
        _ = vm.DisplayLabel;
        _ = vm.ShowBordersLabel;
        _ = vm.CompactModeLabel;
        _ = vm.CancelLabel;
        _ = vm.SaveLabel;

        foreach (string key in new[]
        {
            "dashSettings.title", "dashSettings.identity", "dashSettings.nameLabel", "dashSettings.name",
            "dashSettings.iconLabel", "dashSettings.vehicleFilter", "dashSettings.vehicleFilterDesc",
            "dashSettings.refresh", "dashSettings.display", "dashSettings.showBorders",
            "dashSettings.compactMode", "common.cancel", "common.save",
        })
        {
            Assert.Contains(key, localizer.RequestedKeys);
        }
    }

    // ── Diagnostics (P1/S11): slug-only counters, never dashboard data ────────────────────────────────────

    [Fact]
    public void Diagnostics_count_each_operational_event()
    {
        var captured = new List<string>();
        var diagnostics = new DashboardSettingsModalDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordSettingsSaved();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.SettingsSaved);
        string[] expected =
        [
            "view.opened slug=DashboardSettingsModal",
            "settings.saved slug=DashboardSettingsModal",
        ];
        Assert.Equal(expected, captured);
    }

    // ── Helpers / test doubles ────────────────────────────────────────────────────────────────────────────

    private static DashboardSettingsModalViewModel NewViewModel(List<string> sink) =>
        new(Localizer, new DashboardSettingsModalDiagnostics(sink.Add));

    private sealed class KeyCapturingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = [];

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private sealed class MutableLocalizer : ILocalizer
    {
        public string Suffix { get; set; } = string.Empty;

        public string GetString(string key, string fallback) => fallback + Suffix;
    }
}
