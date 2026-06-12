using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the ActiveFilterChips surface's UI-thread-free logic — the registration slug + i18n
/// keys/fallbacks (<see cref="ActiveFilterChipsRegistration"/>), the count / label interpolation adapters, the
/// per-state chip logic (hidden / empty-but-shown / inline / overflow split / clear-all), the polite removal +
/// clear-all announcement routing with the web's rotating zero-width suffix, the overflow open-state machine and
/// the PII-safe diagnostics (<see cref="ActiveFilterChipsViewModel"/> + <see cref="ActiveFilterChipsDiagnostics"/>).
/// Mirrors the web spec one-for-one (web/src/components/forms/ActiveFilterChips.tsx). The WinUI view
/// (ActiveFilterChips.cs, which composes a wrapping chip group + remove buttons + a "+N more" flyout + a hidden
/// TsAnnouncerRegion) is exercised by the app build.
/// </summary>
public sealed class ActiveFilterChipsTests
{
    // ── recording doubles ────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private sealed class RecordingAnnouncer : IFilterChipAnnouncer
    {
        public List<string> Messages { get; } = new();

        public void Announce(string message) => Messages.Add(message);
    }

    private static ActiveFilterChipsViewModel NewViewModel(
        ILocalizer? localizer = null,
        IFilterChipAnnouncer? announcer = null) =>
        new(localizer ?? PassthroughLocalizer.Instance, announcer ?? NullFilterChipAnnouncer.Instance);

    private static FilterChipDescriptor Chip(string key, string label, string value, Action? onRemove = null) =>
        new(key, label, value, onRemove ?? (() => { }));

    private static IReadOnlyList<FilterChipDescriptor> Chips(int count)
    {
        var chips = new FilterChipDescriptor[count];
        for (int i = 0; i < count; i++)
        {
            chips[i] = Chip($"k{i}", $"Label{i}", $"Value{i}");
        }

        return chips;
    }

    // ── registration (diagnostics slug + i18n keys/fallbacks, web verbatim) ──────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("ActiveFilterChips", ActiveFilterChipsRegistration.Slug);

    [Theory]
    [InlineData(ActiveFilterChipsRegistration.ActiveLabelKey, "translation.filters.activeLabel")]
    [InlineData(ActiveFilterChipsRegistration.RemovedKey, "translation.filters.removed")]
    [InlineData(ActiveFilterChipsRegistration.ClearedAllKey, "translation.filters.clearedAll")]
    [InlineData(ActiveFilterChipsRegistration.MoreCountKey, "translation.filters.moreCount")]
    [InlineData(ActiveFilterChipsRegistration.MoreLabelKey, "translation.filters.moreLabel")]
    [InlineData(ActiveFilterChipsRegistration.ClearAllKey, "translation.filters.clearAll")]
    [InlineData(ActiveFilterChipsRegistration.RemoveAriaKey, "translation.filters.removeAria")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(ActiveFilterChipsRegistration.ActiveLabelFallback, "Active filters")]
    [InlineData(ActiveFilterChipsRegistration.RemovedFallback, "Filter removed")]
    [InlineData(ActiveFilterChipsRegistration.ClearedAllFallback, "All filters cleared")]
    [InlineData(ActiveFilterChipsRegistration.MoreCountFallback, "+{{count}} more")]
    [InlineData(ActiveFilterChipsRegistration.MoreLabelFallback, "Additional active filters")]
    [InlineData(ActiveFilterChipsRegistration.ClearAllFallback, "Clear all")]
    [InlineData(ActiveFilterChipsRegistration.RemoveAriaFallback, "Remove filter {{label}}")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    // ── adapter: count / label interpolation (web i18next {{count}} / {{label}}) ──────────────────────────

    [Fact]
    public void FormatMoreCount_interpolates_the_i18next_count_token() =>
        Assert.Equal("+4 more", ActiveFilterChipsRegistration.FormatMoreCount("+{{count}} more", 4));

    [Fact]
    public void FormatMoreCount_interpolates_the_native_positional_token() =>
        Assert.Equal("+7 more", ActiveFilterChipsRegistration.FormatMoreCount("+{0} more", 7));

    [Fact]
    public void FormatRemoveAria_interpolates_the_i18next_label_token() =>
        Assert.Equal("Remove filter Vehicle", ActiveFilterChipsRegistration.FormatRemoveAria("Remove filter {{label}}", "Vehicle"));

    [Fact]
    public void ComposeRemoval_joins_the_prefix_and_the_filter_label() =>
        Assert.Equal("Filter removed: Vehicle", ActiveFilterChipsRegistration.ComposeRemoval("Filter removed", "Vehicle"));

    // ── descriptor (web FilterChipDescriptor) ─────────────────────────────────────────────────────────────

    [Fact]
    public void Descriptor_exposes_key_label_value_and_callback()
    {
        bool removed = false;
        var chip = new FilterChipDescriptor("vehicle_id", "Vehicle", "Model 3", () => removed = true);

        Assert.Equal("vehicle_id", chip.Key);
        Assert.Equal("Vehicle", chip.Label);
        Assert.Equal("Model 3", chip.Value);

        chip.OnRemove();
        Assert.True(removed);
    }

    [Fact]
    public void Descriptor_rejects_an_empty_key() =>
        Assert.Throws<ArgumentException>(() => new FilterChipDescriptor("", "Vehicle", "Model 3", () => { }));

    // ── state: hidden vs shown (web hideWhenEmpty && isEmpty ? null) ──────────────────────────────────────

    [Fact]
    public void Surface_is_hidden_when_empty_and_hide_when_empty_is_the_default()
    {
        ActiveFilterChipsViewModel vm = NewViewModel();

        Assert.True(vm.IsEmpty);
        Assert.False(vm.IsRendered);
    }

    [Fact]
    public void Surface_renders_the_empty_group_when_hide_when_empty_is_false()
    {
        ActiveFilterChipsViewModel vm = NewViewModel();
        vm.HideWhenEmpty = false;

        Assert.True(vm.IsEmpty);
        Assert.True(vm.IsRendered);
    }

    [Fact]
    public void Surface_renders_once_a_filter_is_present()
    {
        ActiveFilterChipsViewModel vm = NewViewModel();
        vm.SetFilters(Chips(1));

        Assert.False(vm.IsEmpty);
        Assert.True(vm.IsRendered);
        Assert.Equal(1, vm.Count);
    }

    // ── state: overflow split (web useMemo) ───────────────────────────────────────────────────────────────

    [Fact]
    public void All_chips_are_inline_when_at_or_below_the_cap()
    {
        ActiveFilterChipsViewModel vm = NewViewModel();
        vm.MaxVisible = 8;
        vm.SetFilters(Chips(3));

        Assert.Equal(3, vm.Visible.Count);
        Assert.Empty(vm.Overflow);
        Assert.False(vm.HasOverflow);
    }

    [Fact]
    public void Over_the_cap_reserves_one_slot_for_the_more_trigger_and_overflows_the_rest()
    {
        ActiveFilterChipsViewModel vm = NewViewModel();
        vm.MaxVisible = 2;
        vm.SetFilters(Chips(5));

        // web: visibleCount = max(0, maxVisible - 1) = 1 inline chip + 4 collapsed.
        Assert.Single(vm.Visible);
        Assert.Equal("Label0", vm.Visible[0].Label);
        Assert.Equal(4, vm.Overflow.Count);
        Assert.Equal("Label1", vm.Overflow[0].Label);
        Assert.Equal("Label4", vm.Overflow[3].Label);
        Assert.True(vm.HasOverflow);
    }

    [Fact]
    public void More_count_label_interpolates_the_overflow_count()
    {
        ActiveFilterChipsViewModel vm = NewViewModel();
        vm.MaxVisible = 2;
        vm.SetFilters(Chips(5));

        Assert.Equal("+4 more", vm.MoreCountLabel);
    }

    [Fact]
    public void Max_visible_zero_pushes_every_chip_into_overflow()
    {
        ActiveFilterChipsViewModel vm = NewViewModel();
        vm.MaxVisible = 0;
        vm.SetFilters(Chips(2));

        Assert.Empty(vm.Visible);
        Assert.Equal(2, vm.Overflow.Count);
        Assert.Equal("+2 more", vm.MoreCountLabel);
    }

    // ── state: clear-all affordance (web onClearAll && filters.length > 0) ────────────────────────────────

    [Fact]
    public void Clear_all_is_hidden_when_no_callback_is_supplied()
    {
        ActiveFilterChipsViewModel vm = NewViewModel();
        vm.SetFilters(Chips(2));

        Assert.False(vm.HasClearAll);
        Assert.False(vm.ShowClearAll);
    }

    [Fact]
    public void Clear_all_is_hidden_when_there_are_no_chips()
    {
        ActiveFilterChipsViewModel vm = NewViewModel();
        vm.OnClearAll = () => { };

        Assert.True(vm.HasClearAll);
        Assert.False(vm.ShowClearAll);
    }

    [Fact]
    public void Clear_all_is_shown_when_a_callback_is_supplied_and_chips_are_present()
    {
        ActiveFilterChipsViewModel vm = NewViewModel();
        vm.OnClearAll = () => { };
        vm.SetFilters(Chips(2));

        Assert.True(vm.ShowClearAll);
    }

    // ── behaviour: remove (web handleRemove) ──────────────────────────────────────────────────────────────

    [Fact]
    public void Remove_invokes_the_descriptor_callback_exactly_once()
    {
        int removed = 0;
        FilterChipDescriptor chip = Chip("vehicle_id", "Vehicle", "Model 3", () => removed++);
        ActiveFilterChipsViewModel vm = NewViewModel();
        vm.SetFilters(new[] { chip });

        vm.Remove(chip);

        Assert.Equal(1, removed);
    }

    [Fact]
    public void Remove_announces_the_removal_politely_with_the_filter_label()
    {
        var announcer = new RecordingAnnouncer();
        FilterChipDescriptor chip = Chip("vehicle_id", "Vehicle", "Model 3");
        ActiveFilterChipsViewModel vm = NewViewModel(announcer: announcer);
        vm.SetFilters(new[] { chip });

        vm.Remove(chip);

        Assert.Single(announcer.Messages);
        Assert.Contains("Filter removed", announcer.Messages[0], StringComparison.Ordinal);
        Assert.Contains("Vehicle", announcer.Messages[0], StringComparison.Ordinal);
    }

    [Fact]
    public void Repeated_removals_produce_distinct_announcement_strings_so_at_re_reads_them()
    {
        var announcer = new RecordingAnnouncer();
        ActiveFilterChipsViewModel vm = NewViewModel(announcer: announcer);
        FilterChipDescriptor first = Chip("a", "Alpha", "1");
        FilterChipDescriptor second = Chip("b", "Alpha", "2");
        vm.SetFilters(new[] { first, second });

        vm.Remove(first);
        vm.Remove(second);

        // web: the rotating zero-width-space suffix forces a fresh string even for an identical label.
        Assert.Equal(2, announcer.Messages.Count);
        Assert.NotEqual(announcer.Messages[0], announcer.Messages[1]);
    }

    // ── behaviour: clear-all (web handleClearAll) ─────────────────────────────────────────────────────────

    [Fact]
    public void Request_clear_all_is_a_no_op_without_a_callback()
    {
        var announcer = new RecordingAnnouncer();
        ActiveFilterChipsViewModel vm = NewViewModel(announcer: announcer);
        vm.SetFilters(Chips(2));

        vm.RequestClearAll();

        Assert.Empty(announcer.Messages);
    }

    [Fact]
    public void Request_clear_all_announces_and_invokes_the_callback_once()
    {
        var announcer = new RecordingAnnouncer();
        int cleared = 0;
        ActiveFilterChipsViewModel vm = NewViewModel(announcer: announcer);
        vm.OnClearAll = () => cleared++;
        vm.SetFilters(Chips(2));

        vm.RequestClearAll();

        Assert.Equal(1, cleared);
        Assert.Single(announcer.Messages);
        Assert.Contains("All filters cleared", announcer.Messages[0], StringComparison.Ordinal);
    }

    // ── behaviour: overflow open-state machine (web overflowOpen + filters-drop-to-zero effect) ───────────

    [Fact]
    public void Toggle_overflow_flips_the_open_state_and_raises_the_event()
    {
        ActiveFilterChipsViewModel vm = NewViewModel();
        int changes = 0;
        vm.OverflowOpenChanged += (_, _) => changes++;

        vm.ToggleOverflow();
        Assert.True(vm.OverflowOpen);

        vm.ToggleOverflow();
        Assert.False(vm.OverflowOpen);
        Assert.Equal(2, changes);
    }

    [Fact]
    public void Dropping_filters_to_zero_collapses_an_open_overflow_popover()
    {
        ActiveFilterChipsViewModel vm = NewViewModel();
        vm.MaxVisible = 2;
        vm.SetFilters(Chips(5));
        vm.OverflowOpen = true;

        vm.SetFilters(Array.Empty<FilterChipDescriptor>());

        Assert.False(vm.OverflowOpen);
    }

    [Fact]
    public void Set_filters_raises_property_changed()
    {
        ActiveFilterChipsViewModel vm = NewViewModel();
        bool raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        vm.SetFilters(Chips(1));

        Assert.True(raised);
    }

    // ── accessibility: every visible label resolves through the i18n facade (P1/S10) ──────────────────────

    [Fact]
    public void Accessible_labels_resolve_through_the_localizer_keys()
    {
        var localizer = new RecordingLocalizer();
        ActiveFilterChipsViewModel vm = NewViewModel(localizer: localizer);
        vm.OnClearAll = () => { };
        vm.MaxVisible = 2;
        vm.SetFilters(Chips(5));

        Assert.Equal("Active filters", vm.ActiveLabel);
        Assert.Equal("Clear all", vm.ClearAllLabel);
        Assert.Equal("Additional active filters", vm.MoreLabel);
        Assert.Equal("+4 more", vm.MoreCountLabel);
        Assert.Equal("Remove filter Label0", vm.RemoveAriaFor(vm.Visible[0]));

        Assert.Contains("translation.filters.activeLabel", localizer.RequestedKeys);
        Assert.Contains("translation.filters.clearAll", localizer.RequestedKeys);
        Assert.Contains("translation.filters.moreLabel", localizer.RequestedKeys);
        Assert.Contains("translation.filters.moreCount", localizer.RequestedKeys);
        Assert.Contains("translation.filters.removeAria", localizer.RequestedKeys);
    }

    [Fact]
    public void Removal_announcement_resolves_the_removed_key()
    {
        var localizer = new RecordingLocalizer();
        ActiveFilterChipsViewModel vm = NewViewModel(localizer: localizer);
        FilterChipDescriptor chip = Chip("vehicle_id", "Vehicle", "Model 3");
        vm.SetFilters(new[] { chip });

        vm.Remove(chip);

        Assert.Contains("translation.filters.removed", localizer.RequestedKeys);
    }

    [Fact]
    public void Clear_all_announcement_resolves_the_cleared_all_key()
    {
        var localizer = new RecordingLocalizer();
        ActiveFilterChipsViewModel vm = NewViewModel(localizer: localizer);
        vm.OnClearAll = () => { };
        vm.SetFilters(Chips(1));

        vm.RequestClearAll();

        Assert.Contains("translation.filters.clearedAll", localizer.RequestedKeys);
    }

    // ── diagnostics (P1/S11): view.opened with the surface slug ───────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_the_slug()
    {
        string? captured = null;
        var diagnostics = new ActiveFilterChipsDiagnostics(value => captured = value);

        diagnostics.RecordViewOpened();

        Assert.Equal("view.opened slug=ActiveFilterChips", captured);
        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    // ── seam: inert announcer (web local live region absent) ──────────────────────────────────────────────

    [Fact]
    public void Null_announcer_drops_messages_without_throwing()
    {
        NullFilterChipAnnouncer.Instance.Announce("anything");
        // No assertion needed: the inert sink must not throw when no live region is mounted.
    }
}
