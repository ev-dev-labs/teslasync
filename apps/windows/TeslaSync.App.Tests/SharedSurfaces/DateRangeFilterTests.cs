using System.Collections.Generic;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the DateRangeFilter surface's UI-thread-free logic — the registration slug + i18n
/// keys/fallbacks (<see cref="DateRangeFilterRegistration"/>), the ISO date adapter (<see cref="IsoDate"/>),
/// the active-preset matching + chip projection + selection routing + apply lifecycle
/// (<see cref="DateRangeFilterViewModel"/>), the atomic range-writer seam (<see cref="IDateRangeUrlWriter"/>
/// with its inert / recording doubles) and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/forms/DateRangeFilter.tsx + web/src/components/forms/DatePresetChips.tsx +
/// web/src/lib/datePresets.ts). The WinUI view (DateRangeFilter.cs, which composes a tokenized pill with two
/// CalendarDatePickers + a TsButton apply + TsButton chips) is exercised by the app build.
/// </summary>
public sealed class DateRangeFilterTests
{
    private static readonly DateOnly Today = new(2026, 6, 11);

    // ── recording double ─────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static DateRangeFilterViewModel NewViewModel(
        ILocalizer? localizer = null,
        string startDate = "",
        string endDate = "",
        IReadOnlyList<string>? presetIds = null,
        bool showPresets = true,
        bool hasApply = false,
        bool atomicRangeUpdate = false,
        IDateRangeUrlWriter? urlWriter = null) =>
        new(
            localizer ?? PassthroughLocalizer.Instance,
            startDate,
            endDate,
            presetIds,
            showPresets,
            hasApply,
            atomicRangeUpdate,
            urlWriter,
            Today);

    private static (string Start, string End) ResolvedIso(string presetId)
    {
        DateRange range = DatePresets.Get(presetId)!.Resolve(Today);
        return (IsoDate.ToIso(range.Start), IsoDate.ToIso(range.End));
    }

    // ── registration (diagnostics slug + i18n keys/fallbacks, web verbatim) ──────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("DateRangeFilter", DateRangeFilterRegistration.Slug);

    [Theory]
    [InlineData(DateRangeFilterRegistration.StartLabelKey, "translation.date.range.start")]
    [InlineData(DateRangeFilterRegistration.EndLabelKey, "translation.date.range.end")]
    [InlineData(DateRangeFilterRegistration.ApplyKey, "translation.date.range.apply")]
    [InlineData(DateRangeFilterRegistration.PresetGroupLabelKey, "translation.date.preset.label")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(DateRangeFilterRegistration.StartLabelFallback, "Start date")]
    [InlineData(DateRangeFilterRegistration.EndLabelFallback, "End date")]
    [InlineData(DateRangeFilterRegistration.ApplyFallback, "Apply")]
    [InlineData(DateRangeFilterRegistration.PresetGroupLabelFallback, "Quick date range")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Fact]
    public void Preset_label_key_prepends_the_translation_prefix_to_the_catalogue_key() =>
        Assert.Equal("translation.date.preset.today", DateRangeFilterRegistration.PresetLabelKey("date.preset.today"));

    [Fact]
    public void Preset_label_key_is_idempotent_when_already_prefixed() =>
        Assert.Equal(
            "translation.date.preset.today",
            DateRangeFilterRegistration.PresetLabelKey("translation.date.preset.today"));

    [Fact]
    public void Preset_label_key_resolves_from_a_catalogue_preset() =>
        Assert.Equal(
            "translation.date.preset.last7",
            DateRangeFilterRegistration.PresetLabelKey(DatePresets.Get("7d")!));

    // ── adapter: ISO date parse / format (web <input type=date> / iso()) ──────────────────────────────────

    [Fact]
    public void Iso_round_trips_a_calendar_day()
    {
        Assert.True(IsoDate.TryParse("2026-06-11", out DateOnly date));
        Assert.Equal(new DateOnly(2026, 6, 11), date);
        Assert.Equal("2026-06-11", IsoDate.ToIso(date));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-date")]
    [InlineData("2026-13-40")]
    public void Iso_rejects_empty_and_malformed_values(string value)
    {
        Assert.False(IsoDate.TryParse(value, out _));
        Assert.False(IsoDate.IsValid(value));
    }

    // ── adapter: active preset matching (web matchPresetId) ───────────────────────────────────────────────

    [Fact]
    public void Active_id_matches_the_preset_whose_resolved_range_equals_the_window()
    {
        (string start, string end) = ResolvedIso("7d");
        DateRangeFilterViewModel vm = NewViewModel(startDate: start, endDate: end);

        Assert.Equal("7d", vm.ActiveId);
    }

    [Fact]
    public void Active_id_is_null_when_no_preset_matches()
    {
        DateRangeFilterViewModel vm = NewViewModel(startDate: "2001-02-03", endDate: "2001-02-09");

        Assert.Null(vm.ActiveId);
    }

    [Fact]
    public void Active_id_is_null_when_the_window_is_unset_or_malformed()
    {
        Assert.Null(NewViewModel(startDate: "", endDate: "").ActiveId);
        Assert.Null(NewViewModel(startDate: "2026-06-11", endDate: "").ActiveId);
        Assert.Null(NewViewModel(startDate: "garbage", endDate: "2026-06-11").ActiveId);
    }

    // ── state: chip projection (web DATE_PRESETS.filter, catalogue order) ─────────────────────────────────

    [Fact]
    public void Default_chips_are_the_catalogue_default_set_in_order()
    {
        DateRangeFilterViewModel vm = NewViewModel();

        Assert.Equal(
            new[] { "today", "7d", "30d", "mtd", "ytd", "all" },
            vm.Chips.Select(c => c.Id).ToArray());
    }

    [Fact]
    public void Chips_render_in_catalogue_order_regardless_of_requested_id_order()
    {
        // Requested out of catalogue order; the web filters DATE_PRESETS so catalogue order wins.
        DateRangeFilterViewModel vm = NewViewModel(presetIds: new[] { "all", "today" });

        Assert.Equal(new[] { "today", "all" }, vm.Chips.Select(c => c.Id).ToArray());
    }

    [Fact]
    public void Chips_drop_unknown_ids()
    {
        DateRangeFilterViewModel vm = NewViewModel(presetIds: new[] { "today", "bogus", "30d" });

        Assert.Equal(new[] { "today", "30d" }, vm.Chips.Select(c => c.Id).ToArray());
    }

    [Fact]
    public void Active_chip_is_flagged_when_the_window_matches_a_visible_preset()
    {
        (string start, string end) = ResolvedIso("30d");
        DateRangeFilterViewModel vm = NewViewModel(startDate: start, endDate: end);

        DatePresetChip active = Assert.Single(vm.Chips, c => c.IsActive);
        Assert.Equal("30d", active.Id);
    }

    [Fact]
    public void No_chip_is_active_when_the_window_matches_a_preset_outside_the_visible_set()
    {
        // "yesterday" is not in the default chip set, but matchPresetId still resolves it for activeId.
        (string start, string end) = ResolvedIso("yesterday");
        DateRangeFilterViewModel vm = NewViewModel(startDate: start, endDate: end);

        Assert.Equal("yesterday", vm.ActiveId);
        Assert.DoesNotContain(vm.Chips, c => c.IsActive);
    }

    [Fact]
    public void Chip_labels_resolve_through_the_preset_translation_keys()
    {
        var localizer = new RecordingLocalizer();
        DateRangeFilterViewModel vm = NewViewModel(localizer: localizer);

        _ = vm.Chips;

        Assert.Contains("translation.date.preset.today", localizer.RequestedKeys);
        Assert.Contains("translation.date.preset.last7", localizer.RequestedKeys);
        Assert.Contains("translation.date.preset.all", localizer.RequestedKeys);
    }

    // ── state: preset row + apply visibility (web {presets && ...} / {onApply && ...}) ────────────────────

    [Fact]
    public void Preset_row_is_shown_by_default_and_hideable()
    {
        Assert.True(NewViewModel().ShowPresets);
        Assert.False(NewViewModel(showPresets: false).ShowPresets);
    }

    [Fact]
    public void Apply_is_absent_by_default_and_present_when_wired()
    {
        Assert.False(NewViewModel().HasApply);
        Assert.True(NewViewModel(hasApply: true).HasApply);
    }

    // ── projection: chip button variant (web variant={active ? 'primary' : 'ghost'}) ──────────────────────

    [Theory]
    [InlineData(true, ButtonVariant.Primary)]
    [InlineData(false, ButtonVariant.Subtle)]
    public void Chip_variant_maps_active_to_primary_and_inactive_to_subtle(bool active, ButtonVariant expected) =>
        Assert.Equal(expected, DateRangeFilterViewModel.ChipVariantFor(active));

    // ── selection: granular path (web onStartDateChange + onEndDateChange) ────────────────────────────────

    [Fact]
    public void Granular_preset_selection_fires_both_setters_and_updates_the_window()
    {
        DateRangeFilterViewModel vm = NewViewModel();
        var starts = new List<string>();
        var ends = new List<string>();
        var ranges = new List<DateRangeSelection>();
        vm.StartDateChanged += (_, v) => starts.Add(v);
        vm.EndDateChanged += (_, v) => ends.Add(v);
        vm.RangeChanged += (_, r) => ranges.Add(r);

        vm.SelectPreset("7d");

        (string start, string end) = ResolvedIso("7d");
        Assert.Equal(new[] { start }, starts);
        Assert.Equal(new[] { end }, ends);
        Assert.Empty(ranges); // granular path does NOT raise the atomic event
        Assert.Equal(start, vm.StartDate);
        Assert.Equal(end, vm.EndDate);
        Assert.Equal("7d", vm.ActiveId);
    }

    [Fact]
    public void Granular_selection_is_the_default_path()
    {
        Assert.False(NewViewModel().UsesAtomicRangeUpdate);
    }

    // ── selection: atomic path (web onRangeChange → useUrlBatch) ──────────────────────────────────────────

    [Fact]
    public void Atomic_preset_selection_writes_the_range_once_and_skips_the_granular_setters()
    {
        var writer = new RecordingDateRangeUrlWriter();
        DateRangeFilterViewModel vm = NewViewModel(urlWriter: writer);
        var starts = new List<string>();
        var ends = new List<string>();
        var ranges = new List<DateRangeSelection>();
        vm.StartDateChanged += (_, v) => starts.Add(v);
        vm.EndDateChanged += (_, v) => ends.Add(v);
        vm.RangeChanged += (_, r) => ranges.Add(r);

        vm.SelectPreset("30d");

        (string start, string end) = ResolvedIso("30d");
        Assert.True(vm.UsesAtomicRangeUpdate);
        DateRangeSelection write = Assert.Single(writer.Writes);
        Assert.Equal(new DateRangeSelection(start, end), write);
        DateRangeSelection raised = Assert.Single(ranges);
        Assert.Equal(new DateRangeSelection(start, end), raised);
        Assert.Empty(starts); // atomic path does NOT fire the granular setters
        Assert.Empty(ends);
        Assert.Equal(start, vm.StartDate);
        Assert.Equal(end, vm.EndDate);
    }

    [Fact]
    public void Atomic_path_can_be_forced_without_a_writer()
    {
        DateRangeFilterViewModel vm = NewViewModel(atomicRangeUpdate: true);
        var ranges = new List<DateRangeSelection>();
        vm.RangeChanged += (_, r) => ranges.Add(r);

        vm.SelectPreset("today");

        Assert.True(vm.UsesAtomicRangeUpdate);
        Assert.Single(ranges);
    }

    // ── selection: apply lifecycle (web onApply?.()) ──────────────────────────────────────────────────────

    [Fact]
    public void Preset_selection_requests_apply_only_when_an_apply_handler_is_wired()
    {
        DateRangeFilterViewModel withApply = NewViewModel(hasApply: true);
        int withCount = 0;
        withApply.ApplyRequested += (_, _) => withCount++;
        withApply.SelectPreset("today");
        Assert.Equal(1, withCount);

        DateRangeFilterViewModel withoutApply = NewViewModel(hasApply: false);
        int withoutCount = 0;
        withoutApply.ApplyRequested += (_, _) => withoutCount++;
        withoutApply.SelectPreset("today");
        Assert.Equal(0, withoutCount);
    }

    [Fact]
    public void Request_apply_raises_the_apply_event()
    {
        DateRangeFilterViewModel vm = NewViewModel();
        bool raised = false;
        vm.ApplyRequested += (_, _) => raised = true;

        vm.RequestApply();

        Assert.True(raised);
    }

    [Fact]
    public void Unknown_preset_selection_is_a_no_op()
    {
        DateRangeFilterViewModel vm = NewViewModel();
        bool changed = false;
        vm.StartDateChanged += (_, _) => changed = true;
        vm.RangeChanged += (_, _) => changed = true;

        vm.SelectPreset("not-a-preset");

        Assert.False(changed);
        Assert.Equal(string.Empty, vm.StartDate);
    }

    // ── controlled setters (web onChange forwarding + re-render) ──────────────────────────────────────────

    [Fact]
    public void Set_start_date_updates_value_and_raises_change_plus_property_changed()
    {
        DateRangeFilterViewModel vm = NewViewModel();
        string? changed = null;
        bool propertyChanged = false;
        vm.StartDateChanged += (_, v) => changed = v;
        vm.PropertyChanged += (_, _) => propertyChanged = true;

        vm.SetStartDate("2026-06-01");

        Assert.Equal("2026-06-01", vm.StartDate);
        Assert.Equal("2026-06-01", changed);
        Assert.True(propertyChanged);
    }

    [Fact]
    public void Set_end_date_updates_value_and_raises_change()
    {
        DateRangeFilterViewModel vm = NewViewModel();
        string? changed = null;
        vm.EndDateChanged += (_, v) => changed = v;

        vm.SetEndDate("2026-06-30");

        Assert.Equal("2026-06-30", vm.EndDate);
        Assert.Equal("2026-06-30", changed);
    }

    [Fact]
    public void Setting_today_re_projects_and_raises_property_changed()
    {
        DateRangeFilterViewModel vm = NewViewModel();
        bool propertyChanged = false;
        vm.PropertyChanged += (_, _) => propertyChanged = true;

        vm.Today = new DateOnly(2025, 1, 1);

        Assert.True(propertyChanged);
        Assert.Equal(new DateOnly(2025, 1, 1), vm.Today);
    }

    // ── accessibility: every visible label resolves through the i18n facade (P1/S10) ──────────────────────

    [Fact]
    public void Accessible_labels_resolve_through_the_localizer_keys()
    {
        var localizer = new RecordingLocalizer();
        DateRangeFilterViewModel vm = NewViewModel(localizer: localizer);

        Assert.Equal("Start date", vm.StartLabel);
        Assert.Equal("End date", vm.EndLabel);
        Assert.Equal("Apply", vm.ApplyLabel);
        Assert.Equal("Quick date range", vm.PresetGroupLabel);

        Assert.Contains("translation.date.range.start", localizer.RequestedKeys);
        Assert.Contains("translation.date.range.end", localizer.RequestedKeys);
        Assert.Contains("translation.date.range.apply", localizer.RequestedKeys);
        Assert.Contains("translation.date.preset.label", localizer.RequestedKeys);
    }

    // ── atomic range-writer seam doubles (web useUrlBatch presence/absence) ───────────────────────────────

    [Fact]
    public void Inert_writer_is_a_no_op()
    {
        // The inert writer simply must not throw; it carries no observable side effect.
        InertDateRangeUrlWriter.Instance.WriteRange("2026-06-01", "2026-06-30");
    }

    [Fact]
    public void Recording_writer_captures_each_range_write()
    {
        var writer = new RecordingDateRangeUrlWriter();

        writer.WriteRange("2026-06-01", "2026-06-30");

        DateRangeSelection write = Assert.Single(writer.Writes);
        Assert.Equal("2026-06-01", write.Start);
        Assert.Equal("2026-06-30", write.End);
    }

    // ── diagnostics (P1/S11): view.opened with the surface slug ───────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_the_slug()
    {
        string? captured = null;
        var diagnostics = new DateRangeFilterDiagnostics(value => captured = value);

        diagnostics.RecordViewOpened();

        Assert.Equal("view.opened slug=DateRangeFilter", captured);
        Assert.Equal(1, diagnostics.ViewsOpened);
    }
}
