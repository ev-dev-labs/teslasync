using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the AdvancedSettings feature-view's UI-thread-free logic — the pure JSON store
/// adapter (the web <c>confirmSilence</c> <c>load()</c> / <c>save()</c>: null / non-array / malformed → empty,
/// string entries deduped and ordinal-sorted), the in-memory store (list / restore / restore-all), the silence
/// key labeler (the web <c>useSilenceKeyLabel</c>), the per-state projection (empty / populated) with its
/// localized chrome, ordinal ordering and accessibility names, the i18n routing, the state-holder view-model's
/// transitions, the registration metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/settings/components/AdvancedSettings.tsx). The WinUI view and the LocalSettings-backed
/// store are exercised by the app build.
/// </summary>
public sealed class AdvancedSettingsTests
{
    private const string DiscardDraft = "discard-draft";
    private const string UnsavedNavigation = "unsaved-navigation";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static AdvancedSettingsDisplay Project(ILocalizer localizer, params string[] keys) =>
        AdvancedSettingsProjection.Project(keys, localizer);

    private static AdvancedSettingsDisplay Project(params string[] keys) => Project(Localizer, keys);

    // ---- Storage schema parity (web teslasync:confirm-silence:v1) --------------------

    [Fact]
    public void Storage_key_matches_the_web_schema() =>
        Assert.Equal("teslasync:confirm-silence:v1", SilencedPromptsStorage.StorageKey);

    // ---- Codec adapter: parse (web load()) ------------------------------------------

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-json")]
    [InlineData("{}")]            // an object, not an array
    [InlineData("\"a-string\"")] // a bare string, not an array
    [InlineData("123")]          // a number, not an array
    public void Parse_non_array_or_malformed_is_empty(string? json) =>
        Assert.Empty(SilencedPromptsCodec.Parse(json));

    [Fact]
    public void Parse_dedupes_and_ordinal_sorts_string_entries()
    {
        var result = SilencedPromptsCodec.Parse("[\"b\",\"a\",\"a\",\"c\"]");
        Assert.Equal(new[] { "a", "b", "c" }, result);
    }

    [Fact]
    public void Parse_drops_non_string_and_empty_entries()
    {
        var result = SilencedPromptsCodec.Parse("[1, \"x\", true, null, \"\", \"y\"]");
        Assert.Equal(new[] { "x", "y" }, result);
    }

    // ---- Codec adapter: serialize (web save()) + round-trip -------------------------

    [Fact]
    public void Serialize_writes_deduped_sorted_array()
    {
        string json = SilencedPromptsCodec.Serialize(new[] { "b", "a", "a", "" });
        Assert.Equal("[\"a\",\"b\"]", json);
    }

    [Fact]
    public void Serialize_then_parse_round_trips()
    {
        var input = new[] { UnsavedNavigation, DiscardDraft, DiscardDraft };
        var roundTripped = SilencedPromptsCodec.Parse(SilencedPromptsCodec.Serialize(input));
        Assert.Equal(new[] { DiscardDraft, UnsavedNavigation }, roundTripped);
    }

    [Fact]
    public void Serialize_rejects_null() =>
        Assert.Throws<ArgumentNullException>(() => SilencedPromptsCodec.Serialize(null!));

    // ---- In-memory store ------------------------------------------------------------

    [Fact]
    public void Store_seeds_deduped_and_ordinal_sorted()
    {
        var store = new InMemorySilencedPromptsStore(new[] { UnsavedNavigation, DiscardDraft, DiscardDraft });
        Assert.Equal(new[] { DiscardDraft, UnsavedNavigation }, store.List());
    }

    [Fact]
    public void Store_restore_removes_and_counts_only_actual_removals()
    {
        var store = new InMemorySilencedPromptsStore(new[] { DiscardDraft, UnsavedNavigation });

        store.Restore(DiscardDraft);
        Assert.Equal(new[] { UnsavedNavigation }, store.List());
        Assert.Equal(1, store.RestoreCount);

        store.Restore(DiscardDraft); // already gone — no-op
        store.Restore("");            // empty — no-op
        Assert.Equal(1, store.RestoreCount);
    }

    [Fact]
    public void Store_restore_all_clears_and_counts()
    {
        var store = new InMemorySilencedPromptsStore(new[] { DiscardDraft, UnsavedNavigation });

        store.RestoreAll();

        Assert.Empty(store.List());
        Assert.Equal(1, store.RestoreAllCount);
    }

    [Fact]
    public void Store_silence_adds_an_id()
    {
        var store = new InMemorySilencedPromptsStore();
        store.Silence("custom-prompt");
        Assert.Equal(new[] { "custom-prompt" }, store.List());
    }

    // ---- Labeler (web useSilenceKeyLabel) -------------------------------------------

    [Theory]
    [InlineData(DiscardDraft, "Discard unsaved draft")]
    [InlineData(UnsavedNavigation, "Leave page with unsaved changes")]
    public void Labeler_maps_known_ids(string key, string expected) =>
        Assert.Equal(expected, SilencedPromptLabeler.Label(key, Localizer));

    [Fact]
    public void Labeler_falls_back_to_raw_id_for_unknown() =>
        Assert.Equal("brand-new-prompt", SilencedPromptLabeler.Label("brand-new-prompt", Localizer));

    [Fact]
    public void Labeler_routes_known_ids_through_localizer()
    {
        var prefix = new PrefixLocalizer();
        Assert.Equal("L:" + SilencedPromptLabeler.DiscardDraftKey, SilencedPromptLabeler.Label(DiscardDraft, prefix));
        Assert.Equal("L:" + SilencedPromptLabeler.UnsavedNavigationKey, SilencedPromptLabeler.Label(UnsavedNavigation, prefix));
    }

    [Fact]
    public void Labeler_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => SilencedPromptLabeler.Label(DiscardDraft, null!));

    // ---- Projection: empty branch (web silenced.length === 0) -----------------------

    [Fact]
    public void Project_empty_renders_empty_state_chrome()
    {
        var display = Project();

        Assert.Equal(AdvancedSettingsState.Empty, display.State);
        Assert.True(display.IsEmpty);
        Assert.False(display.ShowRestoreAll);
        Assert.Equal(0, display.Count);
        Assert.Empty(display.Rows);
        Assert.Equal("Confirmation prompts", display.Title);
        Assert.Equal("Re-enable \u201CDon\u2019t ask again\u201D prompts you previously silenced.", display.Description);
        Assert.Equal(
            "No silenced prompts. Tick \u201CDon\u2019t ask again\u201D on a confirmation dialog to silence it.",
            display.EmptyMessage);
        Assert.Equal("cyan", display.Accent);
        Assert.False(string.IsNullOrEmpty(display.Glyph));
    }

    // ---- Projection: populated branch (web silenced.map(...)) -----------------------

    [Fact]
    public void Project_populated_lists_rows_ordinal_sorted_with_labels()
    {
        // Seed out of order to prove the projection sorts (web Set + .sort()).
        var display = Project(UnsavedNavigation, DiscardDraft);

        Assert.Equal(AdvancedSettingsState.Populated, display.State);
        Assert.False(display.IsEmpty);
        Assert.True(display.ShowRestoreAll);
        Assert.Equal(2, display.Count);
        Assert.Equal("Restore all", display.RestoreAllText);
        Assert.Equal("Restore", display.RestoreText);

        Assert.Equal(DiscardDraft, display.Rows[0].Key);
        Assert.Equal("Discard unsaved draft", display.Rows[0].Label);
        Assert.Equal(UnsavedNavigation, display.Rows[1].Key);
        Assert.Equal("Leave page with unsaved changes", display.Rows[1].Label);
    }

    [Fact]
    public void Project_populated_with_unknown_id_uses_raw_label()
    {
        var display = Project("custom-prompt");

        Assert.Equal(AdvancedSettingsState.Populated, display.State);
        Assert.Equal("custom-prompt", Assert.Single(display.Rows).Label);
    }

    [Fact]
    public void Project_dedupes_and_drops_empty_keys()
    {
        var display = Project(DiscardDraft, DiscardDraft, "", UnsavedNavigation);
        Assert.Equal(2, display.Count);
    }

    // ---- i18n routing (every owned string flows through the facade) -----------------

    [Fact]
    public void Project_routes_owned_strings_through_localizer()
    {
        var display = Project(new PrefixLocalizer(), DiscardDraft);

        Assert.Equal("L:" + AdvancedSettingsProjection.TitleKey, display.Title);
        Assert.Equal("L:" + AdvancedSettingsProjection.DescriptionKey, display.Description);
        Assert.Equal("L:" + AdvancedSettingsProjection.RestoreAllKey, display.RestoreAllText);
        Assert.Equal("L:" + AdvancedSettingsProjection.RestoreKey, display.RestoreText);
        Assert.Equal("L:" + AdvancedSettingsProjection.EmptyKey, display.EmptyMessage);
        Assert.Equal("L:" + SilencedPromptLabeler.DiscardDraftKey, display.Rows[0].Label);
    }

    // ---- Accessibility (region name + action names) ---------------------------------

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Project_region_name_is_the_localized_title(bool populated)
    {
        var display = populated ? Project(DiscardDraft) : Project();

        Assert.False(string.IsNullOrWhiteSpace(display.RegionName));
        Assert.Equal(display.Title, display.RegionName);
    }

    [Fact]
    public void Project_restore_all_action_name_is_non_empty()
    {
        var display = Project(DiscardDraft);
        Assert.False(string.IsNullOrWhiteSpace(display.RestoreAllActionName));
        Assert.Equal(display.RestoreAllText, display.RestoreAllActionName);
    }

    [Fact]
    public void Project_each_row_restore_name_qualifies_its_label()
    {
        var display = Project(DiscardDraft, UnsavedNavigation);

        foreach (var row in display.Rows)
        {
            Assert.False(string.IsNullOrWhiteSpace(row.RestoreActionName));
            Assert.Contains(row.Label, row.RestoreActionName, StringComparison.Ordinal);
        }
    }

    // ---- Projection guards ----------------------------------------------------------

    [Fact]
    public void Project_rejects_null_keys() =>
        Assert.Throws<ArgumentNullException>(() => AdvancedSettingsProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => AdvancedSettingsProjection.Project(Array.Empty<string>(), null!));

    // ---- View-model: seeding + transitions -----------------------------------------

    [Fact]
    public void ViewModel_seeds_empty_from_empty_store()
    {
        var vm = new AdvancedSettingsViewModel(new InMemorySilencedPromptsStore(), Localizer);

        Assert.Equal(AdvancedSettingsState.Empty, vm.State);
        Assert.True(vm.IsEmpty);
        Assert.False(vm.ShowRestoreAll);
        Assert.Equal(0, vm.Count);
    }

    [Fact]
    public void ViewModel_seeds_populated_from_seeded_store()
    {
        var store = new InMemorySilencedPromptsStore(new[] { DiscardDraft, UnsavedNavigation });
        var vm = new AdvancedSettingsViewModel(store, Localizer);

        Assert.Equal(AdvancedSettingsState.Populated, vm.State);
        Assert.True(vm.ShowRestoreAll);
        Assert.Equal(2, vm.Count);
    }

    [Fact]
    public void ViewModel_restore_removes_row_and_drives_store_and_raises()
    {
        var store = new InMemorySilencedPromptsStore(new[] { DiscardDraft, UnsavedNavigation });
        var vm = new AdvancedSettingsViewModel(store, Localizer);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Restore(DiscardDraft);

        Assert.Equal(1, vm.Count);
        Assert.Equal(UnsavedNavigation, Assert.Single(vm.Rows).Key);
        Assert.Equal(new[] { UnsavedNavigation }, store.List());
        Assert.Equal(1, store.RestoreCount);
        Assert.Contains(nameof(AdvancedSettingsViewModel.Display), raised);
        Assert.Contains(nameof(AdvancedSettingsViewModel.State), raised);
        Assert.Contains(nameof(AdvancedSettingsViewModel.Count), raised);
    }

    [Fact]
    public void ViewModel_restoring_last_prompt_returns_to_empty()
    {
        var store = new InMemorySilencedPromptsStore(new[] { DiscardDraft });
        var vm = new AdvancedSettingsViewModel(store, Localizer);

        vm.Restore(DiscardDraft);

        Assert.Equal(AdvancedSettingsState.Empty, vm.State);
        Assert.True(vm.IsEmpty);
        Assert.False(vm.ShowRestoreAll);
    }

    [Fact]
    public void ViewModel_restore_all_clears_and_drives_store()
    {
        var store = new InMemorySilencedPromptsStore(new[] { DiscardDraft, UnsavedNavigation });
        var vm = new AdvancedSettingsViewModel(store, Localizer);

        vm.RestoreAll();

        Assert.Equal(AdvancedSettingsState.Empty, vm.State);
        Assert.Empty(store.List());
        Assert.Equal(1, store.RestoreAllCount);
    }

    [Fact]
    public void ViewModel_restore_empty_key_is_noop()
    {
        var store = new InMemorySilencedPromptsStore(new[] { DiscardDraft });
        var vm = new AdvancedSettingsViewModel(store, Localizer);

        vm.Restore(string.Empty);

        Assert.Equal(1, vm.Count);
        Assert.Equal(0, store.RestoreCount);
    }

    [Fact]
    public void ViewModel_reload_reprojects_after_external_store_change()
    {
        var store = new InMemorySilencedPromptsStore(new[] { DiscardDraft });
        var vm = new AdvancedSettingsViewModel(store, Localizer);
        Assert.Equal(1, vm.Count);

        store.Silence(UnsavedNavigation);
        vm.Reload();

        Assert.Equal(2, vm.Count);
        Assert.Equal(AdvancedSettingsState.Populated, vm.State);
    }

    [Fact]
    public void ViewModel_rejects_null_store() =>
        Assert.Throws<ArgumentNullException>(() => new AdvancedSettingsViewModel(null!, Localizer));

    [Fact]
    public void ViewModel_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => new AdvancedSettingsViewModel(new InMemorySilencedPromptsStore(), null!));

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AdvancedSettingsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AdvancedSettings", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new AdvancedSettingsDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ---- Registration ---------------------------------------------------------------

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("AdvancedSettings", AdvancedSettingsRegistration.Slug);

    [Fact]
    public void Registration_name_is_the_localized_title()
    {
        Assert.Equal("Confirmation prompts", AdvancedSettingsRegistration.Name(Localizer));
        Assert.Equal("L:" + AdvancedSettingsProjection.TitleKey, AdvancedSettingsRegistration.Name(new PrefixLocalizer()));
    }

    [Fact]
    public void Registration_name_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => AdvancedSettingsRegistration.Name(null!));

    // ---- Helpers / test doubles ----------------------------------------------------

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
