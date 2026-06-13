using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the PillFilterBar surface's UI-thread-free logic — the registration slug + automation
/// id + the per-accent brush map + the count formatter (<see cref="PillFilterBarRegistration"/>), the
/// <see cref="PillItemDescriptor"/> projection (validation, accent key, accessible text), the per-state logic
/// (empty vs ready, the enabled-key partition, selection, the controlled <c>activeKey</c> vs the <c>onChange</c>
/// user-gesture split) and the WAI-ARIA Tabs keyboard model (arrow wrap-around + Home/End jump, skipping disabled
/// pills), plus the PII-safe diagnostics (<see cref="PillFilterBarViewModel"/> + <see cref="PillFilterBarDiagnostics"/>).
/// Mirrors the web spec one-for-one (web/src/components/forms/PillFilterBar.tsx). The WinUI view
/// (PillFilterBar.cs, which composes the tab strip + accent fills/dots/underlines + the TabItem/SelectionItem
/// automation peers) is exercised by the app build.
/// </summary>
public sealed class PillFilterBarTests
{
    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static PillItemDescriptor Item(
        string key,
        string? label = null,
        string? icon = null,
        int? count = null,
        PillAccent accent = PillAccent.Cyan,
        bool disabled = false) =>
        new(key, label ?? key, icon, count, accent, disabled);

    private static PillFilterBarViewModel WithItems(params PillItemDescriptor[] items)
    {
        var vm = new PillFilterBarViewModel();
        vm.SetItems(items);
        return vm;
    }

    // ── registration: slug + automation id + defaults (web module constants) ─────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("PillFilterBar", PillFilterBarRegistration.Slug);

    [Fact]
    public void Registration_root_automation_id_is_kebab_case() =>
        Assert.Equal("pill-filter-bar", PillFilterBarRegistration.RootAutomationId);

    [Fact]
    public void Registration_default_accent_is_cyan() =>
        Assert.Equal(PillAccent.Cyan, PillFilterBarRegistration.DefaultAccent);

    [Fact]
    public void Registration_default_variant_is_pills() =>
        Assert.Equal(PillFilterBarVariant.Pills, PillFilterBarRegistration.DefaultVariant);

    [Fact]
    public void Registration_default_scrollable_is_true() =>
        Assert.True(PillFilterBarRegistration.DefaultScrollable);

    [Fact]
    public void Registration_empty_marker_is_the_locale_neutral_em_dash() =>
        Assert.Equal("\u2014", PillFilterBarRegistration.EmptyMarker);

    // ── registration: accent → brand-palette brush keys (web accent map L46-L62) ─────────────────────────

    [Theory]
    [InlineData(PillAccent.Cyan, "TsChartRegenBrush")]
    [InlineData(PillAccent.Green, "TsChartBatteryBrush")]
    [InlineData(PillAccent.Amber, "TsChartEnergyBrush")]
    [InlineData(PillAccent.Red, "TsChartTemperatureBrush")]
    [InlineData(PillAccent.Purple, "TsChartPowerBrush")]
    [InlineData(PillAccent.Blue, "TsChartSpeedBrush")]
    public void Accent_brush_key_maps_each_accent_to_its_palette_brush(PillAccent accent, string expected) =>
        Assert.Equal(expected, PillFilterBarRegistration.AccentBrushKey(accent));

    [Fact]
    public void Accent_brush_keys_are_distinct_for_the_six_accents()
    {
        var keys = new HashSet<string>(StringComparer.Ordinal)
        {
            PillFilterBarRegistration.AccentBrushKey(PillAccent.Cyan),
            PillFilterBarRegistration.AccentBrushKey(PillAccent.Green),
            PillFilterBarRegistration.AccentBrushKey(PillAccent.Amber),
            PillFilterBarRegistration.AccentBrushKey(PillAccent.Red),
            PillFilterBarRegistration.AccentBrushKey(PillAccent.Purple),
            PillFilterBarRegistration.AccentBrushKey(PillAccent.Blue),
        };

        Assert.Equal(6, keys.Count);
    }

    // ── registration: count formatter (web `(${fmtInt(count)})`) ─────────────────────────────────────────

    [Fact]
    public void Format_count_wraps_a_small_integer_in_parentheses() =>
        Assert.Equal("(12)", PillFilterBarRegistration.FormatCount(12));

    [Fact]
    public void Format_count_renders_zero() =>
        Assert.Equal("(0)", PillFilterBarRegistration.FormatCount(0));

    [Fact]
    public void Format_count_groups_thousands_like_fmt_int()
    {
        // web fmtInt → toLocaleString with 0 fraction digits: a locale-grouped integer.
        string expected = "(" + 12345.ToString("N0", CultureInfo.CurrentCulture) + ")";
        Assert.Equal(expected, PillFilterBarRegistration.FormatCount(12345));
    }

    // ── descriptor (web PillItem) ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Descriptor_exposes_key_label_icon_count_accent_and_disabled()
    {
        var item = new PillItemDescriptor("anomalies", "Anomalies", "\uE7BA", 7, PillAccent.Amber, disabled: true);

        Assert.Equal("anomalies", item.Key);
        Assert.Equal("Anomalies", item.Label);
        Assert.Equal("\uE7BA", item.IconGlyph);
        Assert.Equal(7, item.Count);
        Assert.Equal(PillAccent.Amber, item.Accent);
        Assert.True(item.Disabled);
    }

    [Fact]
    public void Descriptor_defaults_match_the_web_optional_props()
    {
        var item = new PillItemDescriptor("all", "All");

        Assert.Null(item.IconGlyph);
        Assert.Null(item.Count);
        Assert.Equal(PillAccent.Cyan, item.Accent);
        Assert.False(item.Disabled);
    }

    [Fact]
    public void Descriptor_normalizes_an_empty_icon_to_null() =>
        Assert.Null(new PillItemDescriptor("all", "All", iconGlyph: "").IconGlyph);

    [Fact]
    public void Descriptor_rejects_an_empty_key() =>
        Assert.Throws<ArgumentException>(() => new PillItemDescriptor("", "All"));

    [Fact]
    public void Descriptor_rejects_a_null_label() =>
        Assert.Throws<ArgumentNullException>(() => new PillItemDescriptor("all", null!));

    [Fact]
    public void Descriptor_accent_brush_key_matches_the_registration_map() =>
        Assert.Equal(
            PillFilterBarRegistration.AccentBrushKey(PillAccent.Purple),
            Item("k", accent: PillAccent.Purple).AccentBrushKey);

    [Fact]
    public void Descriptor_accessible_text_appends_the_count_suffix() =>
        Assert.Equal("Anomalies (7)", Item("a", "Anomalies", count: 7).AccessibleText);

    [Fact]
    public void Descriptor_accessible_text_is_the_label_when_there_is_no_count() =>
        Assert.Equal("All", Item("a", "All").AccessibleText);

    // ── state: empty vs ready (web empty items array → defensive marker) ──────────────────────────────────

    [Fact]
    public void A_fresh_bar_is_empty()
    {
        var vm = new PillFilterBarViewModel();

        Assert.True(vm.IsEmpty);
        Assert.Equal(0, vm.Count);
        Assert.Equal(PillFilterBarState.Empty, vm.State);
    }

    [Fact]
    public void A_bar_with_items_is_ready()
    {
        PillFilterBarViewModel vm = WithItems(Item("a"), Item("b"));

        Assert.False(vm.IsEmpty);
        Assert.Equal(2, vm.Count);
        Assert.Equal(PillFilterBarState.Ready, vm.State);
    }

    // ── state: enabled-key partition (web enabledKeys) ───────────────────────────────────────────────────

    [Fact]
    public void Enabled_keys_skip_disabled_pills()
    {
        PillFilterBarViewModel vm = WithItems(Item("a"), Item("b", disabled: true), Item("c"));

        Assert.Equal(new[] { "a", "c" }, vm.EnabledKeys);
    }

    [Fact]
    public void Enabled_keys_are_empty_when_every_pill_is_disabled()
    {
        PillFilterBarViewModel vm = WithItems(Item("a", disabled: true), Item("b", disabled: true));

        Assert.Empty(vm.EnabledKeys);
    }

    [Fact]
    public void Is_enabled_reflects_presence_and_the_disabled_flag()
    {
        PillFilterBarViewModel vm = WithItems(Item("a"), Item("b", disabled: true));

        Assert.True(vm.IsEnabled("a"));
        Assert.False(vm.IsEnabled("b"));
        Assert.False(vm.IsEnabled("missing"));
        Assert.False(vm.IsEnabled(""));
    }

    // ── selection: controlled activeKey (web activeKey prop) ─────────────────────────────────────────────

    [Fact]
    public void Active_key_setter_updates_selection_without_firing_on_change()
    {
        var fired = new List<string>();
        PillFilterBarViewModel vm = WithItems(Item("a"), Item("b"));
        vm.OnChange = fired.Add;

        vm.ActiveKey = "b";

        Assert.True(vm.IsSelected("b"));
        Assert.False(vm.IsSelected("a"));
        Assert.Empty(fired);
    }

    [Fact]
    public void Selected_item_and_has_selection_track_the_active_key()
    {
        PillFilterBarViewModel vm = WithItems(Item("a", "Alpha"), Item("b", "Bravo"));

        Assert.Null(vm.SelectedItem);
        Assert.False(vm.HasSelection);

        vm.ActiveKey = "b";

        Assert.True(vm.HasSelection);
        Assert.Equal("Bravo", vm.SelectedItem!.Label);
    }

    // ── behaviour: RequestSelect (web onClick / moveFocus target) ────────────────────────────────────────

    [Fact]
    public void Request_select_moves_the_active_key_and_fires_on_change()
    {
        var fired = new List<string>();
        PillFilterBarViewModel vm = WithItems(Item("a"), Item("b"));
        vm.OnChange = fired.Add;

        bool changed = vm.RequestSelect("b");

        Assert.True(changed);
        Assert.True(vm.IsSelected("b"));
        Assert.Equal(new[] { "b" }, fired);
    }

    [Fact]
    public void Request_select_of_the_active_pill_still_fires_on_change_but_reports_no_change()
    {
        var fired = new List<string>();
        PillFilterBarViewModel vm = WithItems(Item("a"), Item("b"));
        vm.ActiveKey = "a";
        vm.OnChange = fired.Add;

        bool changed = vm.RequestSelect("a");

        // web onClick always calls onChange(item.key), even for the already-active pill.
        Assert.False(changed);
        Assert.Equal(new[] { "a" }, fired);
    }

    [Fact]
    public void Request_select_of_a_disabled_pill_is_a_no_op()
    {
        var fired = new List<string>();
        PillFilterBarViewModel vm = WithItems(Item("a"), Item("b", disabled: true));
        vm.ActiveKey = "a";
        vm.OnChange = fired.Add;

        bool changed = vm.RequestSelect("b");

        Assert.False(changed);
        Assert.True(vm.IsSelected("a"));
        Assert.Empty(fired);
    }

    [Fact]
    public void Request_select_of_an_absent_pill_is_a_no_op()
    {
        var fired = new List<string>();
        PillFilterBarViewModel vm = WithItems(Item("a"));
        vm.OnChange = fired.Add;

        Assert.False(vm.RequestSelect("zzz"));
        Assert.Empty(fired);
    }

    // ── behaviour: WAI-ARIA arrow navigation (web handleKeyDown over enabledKeys) ─────────────────────────

    [Fact]
    public void Next_enabled_key_advances_and_skips_disabled_pills()
    {
        PillFilterBarViewModel vm = WithItems(Item("a"), Item("b", disabled: true), Item("c"), Item("d"));

        Assert.Equal("c", vm.NextEnabledKey("a"));
        Assert.Equal("d", vm.NextEnabledKey("c"));
    }

    [Fact]
    public void Next_enabled_key_wraps_past_the_end()
    {
        PillFilterBarViewModel vm = WithItems(Item("a"), Item("b", disabled: true), Item("c"), Item("d"));

        Assert.Equal("a", vm.NextEnabledKey("d"));
    }

    [Fact]
    public void Previous_enabled_key_retreats_and_wraps_past_the_start()
    {
        PillFilterBarViewModel vm = WithItems(Item("a"), Item("b", disabled: true), Item("c"), Item("d"));

        Assert.Equal("a", vm.PreviousEnabledKey("c"));
        Assert.Equal("d", vm.PreviousEnabledKey("a"));
    }

    [Fact]
    public void Arrow_navigation_returns_null_when_the_origin_is_not_enabled()
    {
        PillFilterBarViewModel vm = WithItems(Item("a"), Item("b", disabled: true), Item("c"));

        // web: enabledKeys.indexOf(currentKey) === -1 ? return.
        Assert.Null(vm.NextEnabledKey("b"));
        Assert.Null(vm.PreviousEnabledKey("b"));
        Assert.Null(vm.NextEnabledKey("missing"));
    }

    [Fact]
    public void Arrow_navigation_returns_null_when_no_pill_is_enabled()
    {
        PillFilterBarViewModel vm = WithItems(Item("a", disabled: true));

        Assert.Null(vm.NextEnabledKey("a"));
        Assert.Null(vm.PreviousEnabledKey("a"));
    }

    // ── behaviour: Home / End (web enabledKeys[0] / enabledKeys[length - 1]) ──────────────────────────────

    [Fact]
    public void First_and_last_enabled_keys_jump_to_the_ends_skipping_disabled_edges()
    {
        PillFilterBarViewModel vm = WithItems(
            Item("a", disabled: true), Item("b"), Item("c"), Item("d", disabled: true));

        Assert.Equal("b", vm.FirstEnabledKey);
        Assert.Equal("c", vm.LastEnabledKey);
    }

    [Fact]
    public void First_and_last_enabled_keys_are_null_when_none_are_enabled()
    {
        PillFilterBarViewModel vm = WithItems(Item("a", disabled: true));

        Assert.Null(vm.FirstEnabledKey);
        Assert.Null(vm.LastEnabledKey);
    }

    // ── notifications: every render-affecting input raises PropertyChanged ────────────────────────────────

    [Fact]
    public void Set_items_raises_property_changed()
    {
        var vm = new PillFilterBarViewModel();
        bool raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        vm.SetItems(new[] { Item("a") });

        Assert.True(raised);
    }

    [Fact]
    public void Set_items_rejects_null() =>
        Assert.Throws<ArgumentNullException>(() => new PillFilterBarViewModel().SetItems(null!));

    [Theory]
    [InlineData("active")]
    [InlineData("aria")]
    [InlineData("variant")]
    [InlineData("scrollable")]
    [InlineData("onchange")]
    public void Mutating_a_render_input_raises_property_changed(string which)
    {
        PillFilterBarViewModel vm = WithItems(Item("a"), Item("b"));
        int raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        switch (which)
        {
            case "active":
                vm.ActiveKey = "b";
                break;
            case "aria":
                vm.AriaLabel = "Filter";
                break;
            case "variant":
                vm.Variant = PillFilterBarVariant.Tabs;
                break;
            case "scrollable":
                vm.Scrollable = false;
                break;
            case "onchange":
                vm.OnChange = _ => { };
                break;
            default:
                break;
        }

        Assert.True(raised > 0);
    }

    [Fact]
    public void Re_setting_the_same_value_does_not_raise_property_changed()
    {
        PillFilterBarViewModel vm = WithItems(Item("a"));
        vm.Variant = PillFilterBarVariant.Tabs;
        int raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        vm.Variant = PillFilterBarVariant.Tabs;

        Assert.Equal(0, raised);
    }

    // ── accessibility: the tablist + pill Narrator names (P1/S10 caller-composed) ────────────────────────

    [Fact]
    public void Aria_label_round_trips_for_the_tablist_name()
    {
        var vm = new PillFilterBarViewModel { AriaLabel = "Trend metric" };

        Assert.Equal("Trend metric", vm.AriaLabel);
    }

    [Fact]
    public void Every_pill_exposes_a_non_empty_accessible_name_containing_its_label()
    {
        PillFilterBarViewModel vm = WithItems(Item("all", "All"), Item("anom", "Anomalies", count: 7));

        foreach (PillItemDescriptor item in vm.Items)
        {
            Assert.False(string.IsNullOrWhiteSpace(item.AccessibleText));
            Assert.Contains(item.Label, item.AccessibleText, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Property_changed_uses_the_all_properties_sentinel()
    {
        PillFilterBarViewModel vm = WithItems(Item("a"), Item("b"));
        PropertyChangedEventArgs? captured = null;
        vm.PropertyChanged += (_, e) => captured = e;

        vm.ActiveKey = "b";

        Assert.NotNull(captured);
        Assert.Equal(string.Empty, captured!.PropertyName);
    }

    // ── diagnostics (P1/S11): view.opened + selection-changed with the surface slug ──────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_the_slug()
    {
        string? captured = null;
        var diagnostics = new PillFilterBarDiagnostics(value => captured = value);

        diagnostics.RecordViewOpened();

        Assert.Equal("view.opened slug=PillFilterBar", captured);
        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_records_selection_changed_with_the_slug_and_no_pii()
    {
        string? captured = null;
        var diagnostics = new PillFilterBarDiagnostics(value => captured = value);

        diagnostics.RecordSelectionChanged();

        Assert.Equal("pill-filter-bar.selection-changed slug=PillFilterBar", captured);
        Assert.Equal(1, diagnostics.SelectionChanges);
    }

    [Fact]
    public void Diagnostics_is_inert_without_a_sink()
    {
        var diagnostics = new PillFilterBarDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordSelectionChanged();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.SelectionChanges);
    }
}
