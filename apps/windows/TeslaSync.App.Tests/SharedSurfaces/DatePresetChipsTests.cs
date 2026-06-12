using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>DatePresetChips</c> shared surface's UI-thread-free logic — the localized
/// projection (id filtering, label resolution, the active highlight), the click-time range resolution + ISO
/// formatting, the state-holder source's defaults and change notifications, the view-model's
/// Populated/Empty branches, selection event and language re-projection, the registration metadata and the
/// PII-safe diagnostics. The numeric / range cases mirror the web spec
/// (web/src/components/forms/DatePresetChips.tsx + web/src/lib/datePresets.ts) and reuse the shared
/// <see cref="DatePresets"/> catalogue as the single source of truth. The WinUI view itself (the wrapping chip
/// row, the toggle/pressed automation, the empty surface and the token brushes) is exercised by the app build.
/// </summary>
public sealed class DatePresetChipsTests
{
    private static readonly ILocalizer Passthrough = PassthroughLocalizer.Instance;

    // A pinned local day so every resolved range is deterministic (mirrors the web passing a fixed `now`).
    private static readonly DateOnly Today = new(2024, 3, 15);

    private static DatePresetChipsSource Source(
        IReadOnlyList<string>? presetIds = null,
        string? activeId = null,
        DatePresetChipSize size = DatePresetChipSize.Sm,
        string? ariaLabel = null) =>
        new(presetIds, activeId, size, ariaLabel, () => Today);

    private static DatePresetChipsDisplay Project(DatePresetChipsSource source, ILocalizer? localizer = null) =>
        DatePresetChipsProjection.Project(source, localizer ?? Passthrough);

    // ── Projection: populated branch ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_default_source_renders_the_six_default_presets_in_order()
    {
        DatePresetChipsDisplay display = Project(Source());

        Assert.Equal(DatePresetChipsState.Populated, display.State);
        Assert.True(display.HasItems);
        Assert.Equal(new[] { "today", "7d", "30d", "mtd", "ytd", "all" }, display.Items.Select(i => i.Id));
        Assert.Collection(
            display.Items,
            i => AssertChip(i, "today", "Today", active: false),
            i => AssertChip(i, "7d", "Last 7 days", active: false),
            i => AssertChip(i, "30d", "Last 30 days", active: false),
            i => AssertChip(i, "mtd", "Month to date", active: false),
            i => AssertChip(i, "ytd", "Year to date", active: false),
            i => AssertChip(i, "all", "All time", active: false));
    }

    [Fact]
    public void Project_marks_only_the_active_preset()
    {
        DatePresetChipsDisplay display = Project(Source(activeId: "7d"));

        Assert.Equal(DatePresetChipsState.Populated, display.State);
        DatePresetChipItem active = Assert.Single(display.Items, i => i.IsActive);
        Assert.Equal("7d", active.Id);
        Assert.All(display.Items.Where(i => i.Id != "7d"), i => Assert.False(i.IsActive));
    }

    [Fact]
    public void Project_honours_an_explicit_subset_in_id_order()
    {
        DatePresetChipsDisplay display = Project(Source(presetIds: new[] { "all", "today", "qtd" }));

        Assert.Equal(new[] { "all", "today", "qtd" }, display.Items.Select(i => i.Id));
    }

    [Fact]
    public void Project_drops_unknown_ids()
    {
        DatePresetChipsDisplay display = Project(Source(presetIds: new[] { "today", "not-a-preset", "30d" }));

        Assert.Equal(new[] { "today", "30d" }, display.Items.Select(i => i.Id));
    }

    [Fact]
    public void Project_carries_the_requested_chip_size()
    {
        Assert.Equal(DatePresetChipSize.Md, Project(Source(size: DatePresetChipSize.Md)).Size);
        Assert.Equal(DatePresetChipSize.Sm, Project(Source()).Size);
    }

    // ── Projection: empty branch (never a blank box) ─────────────────────────────────────────────────────

    [Fact]
    public void Project_empty_id_set_renders_the_friendly_empty_state()
    {
        DatePresetChipsDisplay display = Project(Source(presetIds: Array.Empty<string>()));

        Assert.Equal(DatePresetChipsState.Empty, display.State);
        Assert.True(display.IsEmpty);
        Assert.Empty(display.Items);
        Assert.False(string.IsNullOrWhiteSpace(display.EmptyMessage));
    }

    [Fact]
    public void Project_all_unknown_ids_renders_the_empty_state()
    {
        DatePresetChipsDisplay display = Project(Source(presetIds: new[] { "nope", "nada" }));

        Assert.Equal(DatePresetChipsState.Empty, display.State);
        Assert.Empty(display.Items);
    }

    // ── Group accessible name (web role="group" aria-label) ──────────────────────────────────────────────

    [Fact]
    public void GroupName_defaults_to_the_localized_quick_date_range_label()
    {
        Assert.Equal("Quick date range", Project(Source()).GroupName);
    }

    [Fact]
    public void GroupName_uses_the_aria_label_override_when_supplied()
    {
        Assert.Equal("Pick a window", Project(Source(ariaLabel: "Pick a window")).GroupName);
    }

    [Fact]
    public void Project_requests_exactly_the_web_i18n_keys_in_order()
    {
        var recorder = new RecordingLocalizer();

        Project(Source(), recorder);

        Assert.Equal(
            new[]
            {
                "translation.date.preset.label",
                "translation.date.preset.today",
                "translation.date.preset.last7",
                "translation.date.preset.last30",
                "translation.date.preset.mtd",
                "translation.date.preset.ytd",
                "translation.date.preset.all",
                "translation.common.noData",
            },
            recorder.Keys);
    }

    // ── Click-time range resolution + ISO formatting (web onSelect payload) ──────────────────────────────

    [Fact]
    public void Resolve_today_is_a_single_day_in_iso_form()
    {
        DatePresetSelection selection = Assert.IsType<DatePresetSelection>(
            DatePresetChipsProjection.Resolve("today", Today));

        Assert.Equal("today", selection.Id);
        Assert.Equal("2024-03-15", selection.Start);
        Assert.Equal("2024-03-15", selection.End);
    }

    [Fact]
    public void Resolve_last7_spans_six_days_back_to_today()
    {
        DatePresetSelection selection = Assert.IsType<DatePresetSelection>(
            DatePresetChipsProjection.Resolve("7d", Today));

        Assert.Equal("2024-03-09", selection.Start);
        Assert.Equal("2024-03-15", selection.End);
    }

    [Fact]
    public void Resolve_all_time_starts_at_the_data_baseline()
    {
        DatePresetSelection selection = Assert.IsType<DatePresetSelection>(
            DatePresetChipsProjection.Resolve("all", Today));

        Assert.Equal("2015-01-01", selection.Start);
        Assert.Equal("2024-03-15", selection.End);
    }

    [Fact]
    public void Resolve_matches_the_shared_preset_catalogue_for_every_default_id()
    {
        foreach (string id in DatePresets.DefaultIds)
        {
            DateRange expected = DatePresets.Get(id)!.Resolve(Today);
            DatePresetSelection selection = Assert.IsType<DatePresetSelection>(
                DatePresetChipsProjection.Resolve(id, Today));

            Assert.Equal(DatePresetChipsRegistration.Iso(expected.Start), selection.Start);
            Assert.Equal(DatePresetChipsRegistration.Iso(expected.End), selection.End);
        }
    }

    [Fact]
    public void Resolve_unknown_id_is_null()
    {
        Assert.Null(DatePresetChipsProjection.Resolve("not-a-preset", Today));
    }

    [Fact]
    public void Iso_zero_pads_calendar_fields()
    {
        Assert.Equal("2024-01-05", DatePresetChipsRegistration.Iso(new DateOnly(2024, 1, 5)));
    }

    // ── Source: defaults + change notifications ──────────────────────────────────────────────────────────

    [Fact]
    public void Source_null_ids_fall_back_to_the_default_set()
    {
        var source = new DatePresetChipsSource(presetIds: null);
        Assert.Equal(DatePresets.DefaultIds, source.PresetIds);
    }

    [Fact]
    public void Source_empty_ids_are_preserved_so_the_empty_state_is_reachable()
    {
        var source = new DatePresetChipsSource(presetIds: Array.Empty<string>());
        Assert.Empty(source.PresetIds);
    }

    [Fact]
    public void Source_setters_raise_changed()
    {
        var source = Source();
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.SetActiveId("today");
        source.SetSize(DatePresetChipSize.Md);
        source.SetAriaLabel("Range");
        source.SetPresetIds(new[] { "today" });

        Assert.Equal(4, changes);
    }

    [Fact]
    public void Source_setting_the_same_active_id_does_not_notify()
    {
        var source = Source(activeId: "today");
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.SetActiveId("today");

        Assert.Equal(0, changes);
    }

    [Fact]
    public void Source_today_reads_from_the_injected_clock()
    {
        var source = new DatePresetChipsSource(clock: () => Today);
        Assert.Equal(Today, source.Today);
    }

    // ── View-model: state, selection, re-projection ──────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_projects_the_initial_populated_frame()
    {
        var vm = new DatePresetChipsViewModel(Source(), Passthrough);

        Assert.Equal(DatePresetChipsState.Populated, vm.State);
        Assert.False(vm.IsEmpty);
        Assert.Equal(6, vm.Items.Count);
    }

    [Fact]
    public void ViewModel_empty_source_is_empty()
    {
        var vm = new DatePresetChipsViewModel(Source(presetIds: Array.Empty<string>()), Passthrough);

        Assert.Equal(DatePresetChipsState.Empty, vm.State);
        Assert.True(vm.IsEmpty);
        Assert.Empty(vm.Items);
    }

    [Fact]
    public void ViewModel_select_raises_selected_with_the_resolved_range()
    {
        var vm = new DatePresetChipsViewModel(Source(), Passthrough);
        DatePresetSelection? captured = null;
        vm.Selected += (_, e) => captured = e;

        bool handled = vm.Select("today");

        Assert.True(handled);
        Assert.NotNull(captured);
        Assert.Equal("today", captured!.Id);
        Assert.Equal("2024-03-15", captured.Start);
        Assert.Equal("2024-03-15", captured.End);
    }

    [Fact]
    public void ViewModel_select_unknown_id_returns_false_and_raises_nothing()
    {
        var vm = new DatePresetChipsViewModel(Source(), Passthrough);
        bool raised = false;
        vm.Selected += (_, _) => raised = true;

        bool handled = vm.Select("not-a-preset");

        Assert.False(handled);
        Assert.False(raised);
    }

    [Fact]
    public void ViewModel_reprojects_and_notifies_when_the_source_changes()
    {
        var source = Source();
        var vm = new DatePresetChipsViewModel(source, Passthrough);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.SetActiveId("mtd");

        Assert.Single(vm.Items, i => i.IsActive && i.Id == "mtd");
        Assert.Contains(nameof(DatePresetChipsViewModel.Display), changed);
        Assert.Contains(nameof(DatePresetChipsViewModel.State), changed);
        Assert.Contains(nameof(DatePresetChipsViewModel.Items), changed);
    }

    [Fact]
    public void ViewModel_reload_re_resolves_labels()
    {
        var localizer = new SuffixLocalizer();
        var vm = new DatePresetChipsViewModel(Source(), localizer);
        Assert.Equal("Today", vm.Items[0].Label);

        localizer.Suffix = " \u2605";
        vm.Reload();

        Assert.Equal("Today \u2605", vm.Items[0].Label);
        Assert.Equal(DatePresetChipsState.Populated, vm.State);
    }

    [Fact]
    public void ViewModel_dispose_detaches_from_the_source()
    {
        var source = Source();
        var vm = new DatePresetChipsViewModel(source, Passthrough);
        bool notified = false;
        vm.PropertyChanged += (_, _) => notified = true;

        vm.Dispose();
        source.SetActiveId("all");

        Assert.False(notified);
    }

    // ── Accessibility: every interactive element carries a label ─────────────────────────────────────────

    [Fact]
    public void Every_chip_and_the_group_carry_a_non_empty_accessible_name()
    {
        DatePresetChipsDisplay display = Project(Source(activeId: "today"));

        Assert.False(string.IsNullOrWhiteSpace(display.GroupName));
        Assert.All(display.Items, i => Assert.False(string.IsNullOrWhiteSpace(i.Label)));
    }

    [Fact]
    public void Empty_state_still_announces_a_group_name_and_message()
    {
        DatePresetChipsDisplay display = Project(Source(presetIds: Array.Empty<string>()));

        Assert.False(string.IsNullOrWhiteSpace(display.GroupName));
        Assert.False(string.IsNullOrWhiteSpace(display.EmptyMessage));
    }

    // ── Registration + diagnostics ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("DatePresetChips", DatePresetChipsRegistration.Slug);
        Assert.Equal("DatePresetChips", DatePresetChipsViewModel.Slug);
    }

    [Fact]
    public void Registration_keys_match_the_catalog()
    {
        Assert.Equal("translation.date.preset.label", DatePresetChipsRegistration.GroupLabelKey);
        Assert.Equal("translation.common.noData", DatePresetChipsRegistration.EmptyKey);
        Assert.Equal("translation.date.preset.today", DatePresetChipsRegistration.PresetKeyPrefix + DatePresets.Get("today")!.I18nKey);
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        var emitted = new List<string>();
        var diagnostics = new DatePresetChipsDiagnostics(emitted.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(new[] { "view.opened slug=DatePresetChips", "view.opened slug=DatePresetChips" }, emitted);
    }

    [Fact]
    public void Diagnostics_records_preset_selected_with_the_id_token()
    {
        var emitted = new List<string>();
        var diagnostics = new DatePresetChipsDiagnostics(emitted.Add);

        diagnostics.RecordPresetSelected("7d");

        Assert.Equal(1, diagnostics.PresetsSelected);
        Assert.Equal(new[] { "preset.selected slug=DatePresetChips id=7d" }, emitted);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static void AssertChip(DatePresetChipItem item, string id, string label, bool active)
    {
        Assert.Equal(id, item.Id);
        Assert.Equal(label, item.Label);
        Assert.Equal(active, item.IsActive);
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

    private sealed class SuffixLocalizer : ILocalizer
    {
        public string Suffix { get; set; } = string.Empty;

        public string GetString(string key, string fallback) => fallback + Suffix;
    }
}
