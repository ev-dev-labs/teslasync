using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SignalSelector</c> surface's UI-thread-free logic — the label / option / cap
/// projection (web <c>ComboboxMulti</c> wiring), the controlled state-holder view-model's full state matrix
/// (empty / ready, none / some / at-cap selection), the cap enforcement and backspace-removes-last behaviour,
/// the registry metadata, the i18n facade coverage, the accessibility copy, and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/features/telemetry/components/SignalSelector.tsx). The WinUI view itself
/// (SignalSelector.cs) is exercised by the app build; its per-state branch selection is driven entirely by the
/// view-model state asserted here.
/// </summary>
public sealed class SignalSelectorTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ---- Projection: label composition (web `Signals (N / max)`) --------------------

    [Fact]
    public void ComposeLabel_with_a_cap_shows_count_and_cap()
    {
        Assert.Equal("Signals (2 / 5)", SignalSelectorProjection.ComposeLabel(null, "Signals", 2, 5));
    }

    [Fact]
    public void ComposeLabel_without_a_cap_shows_only_the_count()
    {
        Assert.Equal("Signals (3)", SignalSelectorProjection.ComposeLabel(null, "Signals", 3, null));
    }

    [Fact]
    public void ComposeLabel_override_wins_over_the_count_but_blank_falls_through()
    {
        Assert.Equal("Custom", SignalSelectorProjection.ComposeLabel("Custom", "Signals", 2, 5));
        Assert.Equal("Signals (1 / 5)", SignalSelectorProjection.ComposeLabel(string.Empty, "Signals", 1, 5));
    }

    [Fact]
    public void ComposeLabel_clamps_a_negative_count_to_zero()
    {
        Assert.Equal("Signals (0 / 5)", SignalSelectorProjection.ComposeLabel(null, "Signals", -4, 5));
    }

    // ---- Projection: option mapping (web getOptionLabel / getOptionKey identity) -----

    [Fact]
    public void ToOptions_maps_each_name_to_an_identity_option()
    {
        var options = SignalSelectorProjection.ToOptions(new[] { "drive_state.speed", "charge_state.soc" });

        Assert.Equal(2, options.Count);
        Assert.Equal("drive_state.speed", options[0].Value);
        Assert.Equal("drive_state.speed", options[0].Label);
        Assert.False(options[0].Disabled);
    }

    [Fact]
    public void ToOptions_drops_blanks_and_collapses_duplicates_preserving_order()
    {
        var options = SignalSelectorProjection.ToOptions(new[] { "a", "  ", "b", "a", string.Empty, "c" });

        Assert.Equal(new[] { "a", "b", "c" }, options.Select(o => o.Value));
    }

    [Fact]
    public void ToOptions_of_null_or_empty_is_empty()
    {
        Assert.Empty(SignalSelectorProjection.ToOptions(null));
        Assert.Empty(SignalSelectorProjection.ToOptions(Array.Empty<string>()));
    }

    // ---- Projection: cap (web onChange slice) ---------------------------------------

    [Fact]
    public void Cap_keeps_the_first_max_values()
    {
        Assert.Equal(new[] { "a", "b" }, SignalSelectorProjection.Cap(new[] { "a", "b", "c" }, 2));
    }

    [Fact]
    public void Cap_with_a_null_max_is_uncapped()
    {
        Assert.Equal(new[] { "a", "b", "c" }, SignalSelectorProjection.Cap(new[] { "a", "b", "c" }, null));
    }

    [Fact]
    public void Cap_drops_blanks_and_duplicates_before_counting_toward_the_cap()
    {
        Assert.Equal(new[] { "a", "b" }, SignalSelectorProjection.Cap(new[] { "a", "a", "  ", "b", "c" }, 2));
    }

    [Theory]
    [InlineData(5, 5, true)]
    [InlineData(4, 5, false)]
    [InlineData(3, null, false)]
    [InlineData(0, 0, true)]
    public void IsAtMax_only_when_capped_and_full(int count, int? max, bool expected)
    {
        Assert.Equal(expected, SignalSelectorProjection.IsAtMax(count, max));
    }

    // ---- Projection: dropdown hides already-selected rows (web filteredOptions) ------

    [Fact]
    public void Available_removes_already_selected_options()
    {
        var options = SignalSelectorProjection.ToOptions(new[] { "a", "b", "c" });

        var available = SignalSelectorProjection.Available(options, new[] { "b" });

        Assert.Equal(new[] { "a", "c" }, available.Select(o => o.Value));
    }

    [Fact]
    public void Available_with_no_selection_returns_every_option()
    {
        var options = SignalSelectorProjection.ToOptions(new[] { "a", "b" });

        Assert.Equal(2, SignalSelectorProjection.Available(options, Array.Empty<string>()).Count);
    }

    // ---- View-model state matrix: empty / ready -------------------------------------

    [Fact]
    public void ViewModel_starts_empty_with_no_options_and_no_selection()
    {
        var vm = NewViewModel();

        Assert.Equal(SignalSelectorState.Empty, vm.State);
        Assert.False(vm.HasOptions);
        Assert.Empty(vm.Options);
        Assert.Empty(vm.SelectedValues);
        Assert.Equal(0, vm.SelectedCount);
        Assert.Equal(5, vm.Max);
        Assert.True(vm.ShowLayerHelp);
        Assert.Equal("Signals (0 / 5)", vm.Label);
        Assert.Equal("No results", vm.StatusAnnouncement);
    }

    [Fact]
    public void ViewModel_becomes_ready_once_signals_are_supplied()
    {
        var vm = NewViewModel();

        vm.SetOptions(new[] { "a", "b", "c" });

        Assert.Equal(SignalSelectorState.Ready, vm.State);
        Assert.True(vm.HasOptions);
        Assert.Equal(3, vm.Options.Count);
        Assert.Equal(3, vm.AvailableOptions.Count);
        Assert.Null(vm.StatusAnnouncement);
    }

    // ---- View-model: add / remove / controlled value --------------------------------

    [Fact]
    public void ViewModel_add_commits_a_known_option_and_updates_the_label_and_dropdown()
    {
        var vm = NewViewModel();
        vm.SetOptions(new[] { "a", "b", "c" });

        Assert.True(vm.Add("a"));

        Assert.Equal(new[] { "a" }, vm.SelectedValues);
        Assert.Equal(1, vm.SelectedCount);
        Assert.Equal("Signals (1 / 5)", vm.Label);
        Assert.DoesNotContain(vm.AvailableOptions, o => o.Value == "a");
    }

    [Fact]
    public void ViewModel_add_ignores_unknown_duplicate_and_blank_values()
    {
        var vm = NewViewModel();
        vm.SetOptions(new[] { "a", "b" });

        Assert.False(vm.Add("nope"));   // not an offered option
        Assert.True(vm.Add("a"));
        Assert.False(vm.Add("a"));      // already selected
        Assert.False(vm.Add(" "));      // blank
        Assert.Equal(new[] { "a" }, vm.SelectedValues);
    }

    [Fact]
    public void ViewModel_enforces_the_cap_and_announces_when_full()
    {
        var vm = NewViewModel();
        vm.SetOptions(new[] { "a", "b", "c", "d", "e", "f" });

        foreach (string s in new[] { "a", "b", "c", "d", "e" })
        {
            Assert.True(vm.Add(s));
        }

        Assert.True(vm.IsAtMax);
        Assert.False(vm.Add("f")); // cap reached
        Assert.Equal(5, vm.SelectedCount);
        Assert.Equal("Maximum reached", vm.StatusAnnouncement);
    }

    [Fact]
    public void ViewModel_remove_and_remove_last_shrink_the_selection()
    {
        var vm = NewViewModel();
        vm.SetOptions(new[] { "a", "b", "c" });
        vm.Add("a");
        vm.Add("b");

        Assert.True(vm.Remove("a"));
        Assert.Equal(new[] { "b" }, vm.SelectedValues);

        Assert.Equal("b", vm.RemoveLast());
        Assert.Empty(vm.SelectedValues);
        Assert.Null(vm.RemoveLast()); // nothing left to remove
    }

    [Fact]
    public void ViewModel_set_selected_replaces_the_value_and_applies_the_cap()
    {
        var vm = NewViewModel();
        vm.SetOptions(new[] { "a", "b", "c", "d", "e", "f" });

        vm.SetSelected(new[] { "a", "b", "c", "d", "e", "f" }); // 6 supplied, cap 5

        Assert.Equal(new[] { "a", "b", "c", "d", "e" }, vm.SelectedValues);
        Assert.True(vm.IsAtMax);
    }

    [Fact]
    public void ViewModel_set_max_recaps_the_existing_selection()
    {
        var vm = NewViewModel();
        vm.SetOptions(new[] { "a", "b", "c" });
        vm.SetSelected(new[] { "a", "b", "c" });

        vm.SetMax(2);

        Assert.Equal(new[] { "a", "b" }, vm.SelectedValues);
        Assert.Equal(2, vm.Max);
        Assert.True(vm.IsAtMax);
    }

    [Fact]
    public void ViewModel_set_max_null_or_negative_is_uncapped()
    {
        var vm = NewViewModel();
        vm.SetOptions(new[] { "a", "b", "c" });
        vm.SetSelected(new[] { "a", "b", "c" });

        vm.SetMax(null);
        Assert.Null(vm.Max);
        Assert.Equal("Signals (3)", vm.Label);
        Assert.False(vm.IsAtMax);

        vm.SetMax(-1);
        Assert.Null(vm.Max);
    }

    [Fact]
    public void ViewModel_label_override_and_layer_help_toggle()
    {
        var vm = NewViewModel();

        vm.SetLabelOverride("Pick signals");
        Assert.Equal("Pick signals", vm.Label);

        vm.SetLabelOverride(null);
        Assert.Equal("Signals (0 / 5)", vm.Label);

        vm.SetShowLayerHelp(false);
        Assert.False(vm.ShowLayerHelp);
    }

    [Fact]
    public void ViewModel_clear_empties_the_selection()
    {
        var vm = NewViewModel();
        vm.SetOptions(new[] { "a", "b" });
        vm.Add("a");

        vm.Clear();

        Assert.Empty(vm.SelectedValues);
        Assert.Equal("Signals (0 / 5)", vm.Label);
    }

    // ---- View-model: change notifications (web onChange + re-render) -----------------

    [Fact]
    public void ViewModel_raises_selection_changed_with_a_snapshot()
    {
        var vm = NewViewModel();
        vm.SetOptions(new[] { "a", "b" });
        IReadOnlyList<string>? last = null;
        vm.SelectionChanged += (_, e) => last = e;

        vm.Add("a");

        Assert.NotNull(last);
        Assert.Equal(new[] { "a" }, last!);
    }

    [Fact]
    public void ViewModel_raises_property_changed_for_state_and_selection()
    {
        var vm = NewViewModel();
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.SetOptions(new[] { "a" });
        vm.Add("a");

        Assert.Contains(nameof(SignalSelectorViewModel.State), raised);
        Assert.Contains(nameof(SignalSelectorViewModel.SelectedValues), raised);
        Assert.Contains(nameof(SignalSelectorViewModel.Label), raised);
    }

    // ---- i18n facade coverage + accessibility copy ----------------------------------

    [Fact]
    public void Component_strings_resolve_through_the_facade_with_the_source_keys()
    {
        var recorder = new RecordingLocalizer();

        _ = SignalSelectorRegistration.Signals(recorder);
        _ = SignalSelectorRegistration.SearchPrompt(recorder);
        _ = SignalSelectorRegistration.LayerHelp(recorder);
        _ = SignalSelectorRegistration.LayerHelpAria(recorder);
        _ = SignalSelectorRegistration.NoResults(recorder);
        _ = SignalSelectorRegistration.MaxReached(recorder);
        _ = SignalSelectorRegistration.RemoveChipLabel(recorder, "drive_state.speed");

        Assert.Contains("Signals", recorder.Keys);
        Assert.Contains("Search signals\u2026", recorder.Keys);
        Assert.Contains("help.signal.layers", recorder.Keys);
        Assert.Contains("help.signal.layers.aria", recorder.Keys);
        Assert.Contains("combobox.noResults", recorder.Keys);
        Assert.Contains("combobox.maxReached", recorder.Keys);
        Assert.Contains("combobox.removeChip", recorder.Keys);
    }

    [Fact]
    public void Component_strings_have_accessible_fallbacks_matching_the_web()
    {
        Assert.Equal("Signals", SignalSelectorRegistration.Signals(Localizer));
        Assert.Equal("Search signals\u2026", SignalSelectorRegistration.SearchPrompt(Localizer));
        Assert.Equal("More info about signal layers (L1, L2, log)", SignalSelectorRegistration.LayerHelpAria(Localizer));
        Assert.Equal("No results", SignalSelectorRegistration.NoResults(Localizer));
        Assert.Equal("Maximum reached", SignalSelectorRegistration.MaxReached(Localizer));
        Assert.StartsWith("TeslaSync exposes three live-state layers", SignalSelectorRegistration.LayerHelp(Localizer), StringComparison.Ordinal);
    }

    [Fact]
    public void RemoveChipLabel_substitutes_the_signal_name_into_the_template()
    {
        Assert.Equal("Remove drive_state.speed", SignalSelectorRegistration.RemoveChipLabel(Localizer, "drive_state.speed"));
    }

    [Fact]
    public void ViewModel_exposes_localized_accessibility_strings()
    {
        var vm = NewViewModel();

        Assert.Equal("Signals", vm.SignalsWord);
        Assert.Equal("Search signals\u2026", vm.SearchPrompt);
        Assert.Equal("More info about signal layers (L1, L2, log)", vm.LayerHelpAria);
        Assert.Equal("Remove sig.a", vm.RemoveChipLabel("sig.a"));
    }

    // ---- Registry metadata + diagnostics (view.opened, PII-safe) --------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_defaults()
    {
        Assert.Equal("signal-selector", SignalSelectorRegistration.Id);
        Assert.Equal("SignalSelector", SignalSelectorRegistration.Slug);
        Assert.Equal(5, SignalSelectorRegistration.DefaultMax);
        Assert.False(string.IsNullOrEmpty(SignalSelectorRegistration.SearchGlyph));
        Assert.False(string.IsNullOrEmpty(SignalSelectorRegistration.RemoveGlyph));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new SignalSelectorDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SignalSelector", Assert.Single(sink));
    }

    // ---- helpers --------------------------------------------------------------------

    private static SignalSelectorViewModel NewViewModel() => new(Localizer);

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
