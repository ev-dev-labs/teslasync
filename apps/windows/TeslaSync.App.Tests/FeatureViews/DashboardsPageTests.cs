using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.PowerUser;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DashboardsPage</c> surface's Microsoft.UI-free logic — the curated catalog
/// and its ordering, the composer projection (every visible literal resolved through the i18n facade with the
/// exact web key names), the copy-status branch matrix, the draft-persistence seam, and the state-holder
/// view-model's transitions (seed / edit / clear / copy). Mirrors the web spec
/// (web/src/features/power-user/pages/DashboardsPage.tsx). The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class DashboardsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 13 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "powerDashboards.title",
        "powerDashboards.intro",
        "powerDashboards.editor.title",
        "powerDashboards.editor.placeholder", // parity:allow web i18n key name (verbatim)
        "powerDashboards.editor.label",
        "powerDashboards.editor.copy",
        "powerDashboards.editor.clear",
        "powerDashboards.editor.copyEmpty",
        "powerDashboards.editor.copyUnavailable",
        "powerDashboards.editor.copySuccess",
        "powerDashboards.editor.copyFailed",
        "powerDashboards.panels.title",
        "powerDashboards.panels.intro",
    ];

    private static DashboardComposerDisplay Project(string? json = "", ILocalizer? localizer = null) =>
        DashboardComposerProjection.Project(DashboardComposerInput.From(json), localizer ?? Localizer);

    private static DashboardsPageViewModel BuildViewModel(
        string? seed = null,
        IDashboardClipboard? clipboard = null,
        IDashboardDraftStore? store = null,
        ILocalizer? localizer = null) =>
        new(
            store ?? new InMemoryDashboardDraftStore(seed),
            clipboard ?? new FakeClipboard(),
            localizer ?? Localizer);

    // ── i18n key coverage (all 13 manifest strings) ──────────────────────────────────────────────

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();
        _ = DashboardComposerProjection.Project(DashboardComposerInput.Blank, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_when_the_editor_has_content()
    {
        var recorder = new RecordingLocalizer();
        _ = DashboardComposerProjection.Project(DashboardComposerInput.From("{\"a\":1}"), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_routes_every_label_through_the_localizer()
    {
        var display = Project(localizer: new PrefixLocalizer());

        Assert.Equal("L:powerDashboards.title", display.Title);
        Assert.Equal("L:powerDashboards.intro", display.Intro);
        Assert.Equal("L:powerDashboards.editor.title", display.EditorTitle);
        Assert.Equal("L:powerDashboards.editor.label", display.EditorLabel);
        Assert.Equal("L:powerDashboards.editor.copy", display.CopyLabel);
        Assert.Equal("L:powerDashboards.editor.clear", display.ClearLabel);
        Assert.Equal("L:powerDashboards.editor.copyEmpty", display.CopyEmptyMessage);
        Assert.Equal("L:powerDashboards.editor.copyUnavailable", display.CopyUnavailableMessage);
        Assert.Equal("L:powerDashboards.editor.copySuccess", display.CopySuccessMessage);
        Assert.Equal("L:powerDashboards.editor.copyFailed", display.CopyFailedMessage);
        Assert.Equal("L:powerDashboards.panels.title", display.PanelsTitle);
        Assert.Equal("L:powerDashboards.panels.intro", display.PanelsIntro);
    }

    [Fact]
    public void Projection_falls_back_to_the_verbatim_web_defaults()
    {
        var display = Project();

        Assert.Equal("Dashboard Composer", display.Title);
        Assert.Equal("Manual dashboard JSON editor", display.EditorTitle);
        Assert.Equal("Dashboard JSON editor", display.EditorLabel);
        Assert.Equal("Copy to clipboard", display.CopyLabel);
        Assert.Equal("Clear", display.ClearLabel);
        Assert.Equal("Curated panel catalog", display.PanelsTitle);
        Assert.StartsWith("Compose a Grafana dashboard JSON envelope", display.Intro, StringComparison.Ordinal);
        Assert.Contains("Helix natural-language composer", display.PanelsIntro, StringComparison.Ordinal);
        Assert.Contains("drives_per_day_timeseries", display.EditorHint, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => DashboardComposerProjection.Project(null!, Localizer));
        Assert.Throws<ArgumentNullException>(
            () => DashboardComposerProjection.Project(DashboardComposerInput.Blank, null!));
    }

    // ── Curated catalog (GlassPanel2) ────────────────────────────────────────────────────────────

    [Fact]
    public void Catalog_exposes_the_six_curated_panels()
    {
        Assert.Equal(6, DashboardComposerCatalog.Panels.Count);
        Assert.Equal("drives_per_day_timeseries", DashboardComposerCatalog.Panels[0].Name);
    }

    [Fact]
    public void Catalog_sorted_is_ascending_by_name()
    {
        var sorted = DashboardComposerCatalog.Sorted();
        var names = sorted.Select(p => p.Name).ToArray();

        Assert.Equal(
            new[]
            {
                "alerts_count_stat",
                "battery_soc_stat",
                "charging_sessions_table",
                "drives_per_day_timeseries",
                "energy_used_per_day_barchart",
                "vehicles_table",
            },
            names);
    }

    [Fact]
    public void Catalog_descriptions_match_the_web_catalog()
    {
        var byName = DashboardComposerCatalog.Panels.ToDictionary(p => p.Name, p => p.Description, StringComparer.Ordinal);

        Assert.Equal("Stat panel: latest BatteryLevel sample from signal_log_view", byName["battery_soc_stat"]);
        Assert.Equal("Barchart panel: SUM(energy_used_wh)/day from the drives table", byName["energy_used_per_day_barchart"]);
    }

    [Fact]
    public void Projection_exposes_the_sorted_catalog()
    {
        var display = Project();

        Assert.Equal(6, display.Panels.Count);
        Assert.Equal("alerts_count_stat", display.Panels[0].Name);
    }

    // ── Input + CanCopy (web canCopy = dashboardJson.trim().length > 0) ───────────────────────────

    [Theory]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("\t\n ", false)]
    [InlineData("{}", true)]
    [InlineData("  x  ", true)]
    public void Input_can_copy_tracks_trimmed_content(string json, bool expected) =>
        Assert.Equal(expected, DashboardComposerInput.From(json).CanCopy);

    [Fact]
    public void Input_from_null_is_blank() =>
        Assert.Equal(string.Empty, DashboardComposerInput.From(null).Json);

    // ── Copy-status branch matrix (Display.StatusFor) ────────────────────────────────────────────

    [Fact]
    public void Display_status_for_maps_each_outcome_to_its_message()
    {
        var display = Project();

        Assert.Equal(display.CopyEmptyMessage, display.StatusFor(DashboardCopyOutcome.Empty));
        Assert.Equal(display.CopyUnavailableMessage, display.StatusFor(DashboardCopyOutcome.Unavailable));
        Assert.Equal(display.CopySuccessMessage, display.StatusFor(DashboardCopyOutcome.Success));
        Assert.Equal(display.CopyFailedMessage, display.StatusFor(DashboardCopyOutcome.Failed));
    }

    // ── View-model: seed + edit + persist ────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_seeds_from_the_draft_store()
    {
        var vm = BuildViewModel(seed: "{\"seeded\":true}");

        Assert.Equal("{\"seeded\":true}", vm.Json);
        Assert.True(vm.CanCopy);
    }

    [Fact]
    public void ViewModel_set_text_updates_state_persists_and_raises()
    {
        var store = new InMemoryDashboardDraftStore();
        var vm = BuildViewModel(store: store);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.SetText("{\"x\":1}");

        Assert.Equal("{\"x\":1}", vm.Json);
        Assert.True(vm.CanCopy);
        Assert.Equal("{\"x\":1}", store.Load());
        Assert.Equal(1, store.SaveCount);
        Assert.Contains(nameof(DashboardsPageViewModel.Display), raised);
        Assert.Contains(nameof(DashboardsPageViewModel.Json), raised);
        Assert.Contains(nameof(DashboardsPageViewModel.CanCopy), raised);
    }

    [Fact]
    public void ViewModel_set_text_null_is_blank()
    {
        var vm = BuildViewModel(seed: "{\"x\":1}");
        vm.SetText(null);

        Assert.Equal(string.Empty, vm.Json);
        Assert.False(vm.CanCopy);
    }

    [Fact]
    public void ViewModel_clear_resets_editor_status_and_persists_empty()
    {
        var store = new InMemoryDashboardDraftStore("{\"x\":1}");
        var vm = BuildViewModel(store: store);

        vm.Clear();

        Assert.Equal(string.Empty, vm.Json);
        Assert.False(vm.CanCopy);
        Assert.Equal(string.Empty, vm.StatusMessage);
        Assert.Equal(string.Empty, store.Load());
    }

    // ── View-model: copy branch matrix (web handleCopy precedence) ────────────────────────────────

    [Fact]
    public async Task Copy_blank_editor_yields_empty_status()
    {
        var clipboard = new FakeClipboard();
        var vm = BuildViewModel(seed: "   ", clipboard: clipboard);

        var outcome = await vm.CopyAsync();

        Assert.Equal(DashboardCopyOutcome.Empty, outcome);
        Assert.Equal(DashboardComposerProjection.CopyEmptyDefault, vm.StatusMessage);
        Assert.Equal(0, clipboard.WriteCount);
    }

    [Fact]
    public async Task Copy_without_clipboard_yields_unavailable_status()
    {
        var clipboard = new FakeClipboard { Available = false };
        var vm = BuildViewModel(seed: "{\"x\":1}", clipboard: clipboard);

        var outcome = await vm.CopyAsync();

        Assert.Equal(DashboardCopyOutcome.Unavailable, outcome);
        Assert.Equal(DashboardComposerProjection.CopyUnavailableDefault, vm.StatusMessage);
        Assert.Equal(0, clipboard.WriteCount);
    }

    [Fact]
    public async Task Copy_success_writes_trimmed_json_and_reports_success()
    {
        var clipboard = new FakeClipboard();
        var vm = BuildViewModel(seed: "  {\"x\":1}  ", clipboard: clipboard);

        var outcome = await vm.CopyAsync();

        Assert.Equal(DashboardCopyOutcome.Success, outcome);
        Assert.Equal(DashboardComposerProjection.CopySuccessDefault, vm.StatusMessage);
        Assert.Equal("{\"x\":1}", clipboard.LastText);
        Assert.Equal(1, clipboard.WriteCount);
    }

    [Fact]
    public async Task Copy_failure_reports_failed_status()
    {
        var clipboard = new FakeClipboard { Throw = true };
        var vm = BuildViewModel(seed: "{\"x\":1}", clipboard: clipboard);

        var outcome = await vm.CopyAsync();

        Assert.Equal(DashboardCopyOutcome.Failed, outcome);
        Assert.Equal(DashboardComposerProjection.CopyFailedDefault, vm.StatusMessage);
        Assert.Equal(DashboardCopyOutcome.Failed, vm.LastCopyOutcome);
    }

    [Fact]
    public async Task Editing_after_a_copy_keeps_the_status_line()
    {
        var vm = BuildViewModel(seed: "{\"x\":1}");
        _ = await vm.CopyAsync();
        Assert.Equal(DashboardComposerProjection.CopySuccessDefault, vm.StatusMessage);

        // Web parity: typing does not clear the last status (only Clear / a new copy does).
        vm.SetText("{\"x\":2}");

        Assert.Equal(DashboardComposerProjection.CopySuccessDefault, vm.StatusMessage);
    }

    [Fact]
    public void ViewModel_rejects_null_arguments()
    {
        var store = new InMemoryDashboardDraftStore();
        var clipboard = new FakeClipboard();

        Assert.Throws<ArgumentNullException>(() => new DashboardsPageViewModel(null!, clipboard, Localizer));
        Assert.Throws<ArgumentNullException>(() => new DashboardsPageViewModel(store, null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => new DashboardsPageViewModel(store, clipboard, null!));
    }

    // ── Draft store seam ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void InMemoryStore_round_trips_and_counts_saves()
    {
        var store = new InMemoryDashboardDraftStore("seed");
        Assert.Equal("seed", store.Load());

        store.Save("next");
        Assert.Equal("next", store.Load());
        Assert.Equal(1, store.SaveCount);
    }

    [Fact]
    public void InMemoryStore_rejects_null_save() =>
        Assert.Throws<ArgumentNullException>(() => new InMemoryDashboardDraftStore().Save(null!));

    // ── Registration + diagnostics ───────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_route_name_matches_the_route_table() =>
        Assert.Equal("PowerDashboards", DashboardsRegistration.RouteName);

    [Fact]
    public void Registration_slug_matches_diagnostics_event() =>
        Assert.Equal("DashboardsPage", DashboardsRegistration.Slug);

    [Fact]
    public void Registration_title_routes_through_localizer() =>
        Assert.Equal("L:powerDashboards.title", DashboardsRegistration.Title(new PrefixLocalizer()));

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DashboardsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DashboardsPage", Assert.Single(lines));
    }

    [Fact]
    public void ViewModel_notify_opened_increments_diagnostics()
    {
        var lines = new List<string>();
        var diagnostics = new DashboardsDiagnostics(lines.Add);
        var vm = new DashboardsPageViewModel(
            new InMemoryDashboardDraftStore(), new FakeClipboard(), Localizer, diagnostics);

        vm.NotifyOpened();

        Assert.Single(lines);
    }

    // ── Helpers / test doubles ───────────────────────────────────────────────────────────────────

    private sealed class FakeClipboard : IDashboardClipboard
    {
        public bool Available { get; init; } = true;

        public bool Throw { get; init; }

        public string? LastText { get; private set; }

        public int WriteCount { get; private set; }

        public bool IsAvailable => Available;

        public Task WriteTextAsync(string text)
        {
            ArgumentNullException.ThrowIfNull(text);
            WriteCount++;
            if (Throw)
            {
                throw new InvalidOperationException("clipboard locked");
            }

            LastText = text;
            return Task.CompletedTask;
        }
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
