using System.Collections.Generic;
using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the RangePicker surface's UI-thread-free logic — the registration slug + i18n keys
/// (<see cref="RangePickerRegistration"/>), the pure range/format/staging maths (<see cref="RangePickerLogic"/>),
/// the controlled props + commit/stage/compare logic (<see cref="RangePickerViewModel"/>), the change seam
/// (<see cref="IRangePickerSink"/> with its delegate-backed and inert implementations) and the PII-safe
/// diagnostics. Mirrors the web spec one-for-one (web/src/components/forms/RangePicker.tsx +
/// web/src/lib/datePresets.ts). The WinUI view (RangePicker.cs, which composes a TsButton trigger + a Flyout
/// popover + a preset list + a CalendarView + an Apply/Cancel footer) is exercised by the app build.
/// </summary>
public sealed class RangePickerTests
{
    private static readonly DateOnly Today = new(2026, 6, 5); // a Friday, matching DateRangePresetTests.
    private static readonly CultureInfo EnUs = CultureInfo.GetCultureInfo("en-US");

    // ── recording doubles ────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingSink : IRangePickerSink
    {
        public List<(DateRange Range, string? PresetId)> Changes { get; } = new();

        public List<bool> Compares { get; } = new();

        public void OnChange(DateRange value, string? presetId) => Changes.Add((value, presetId));

        public void OnCompareChange(bool next) => Compares.Add(next);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static RangePickerViewModel NewViewModel(
        RecordingSink? sink = null,
        ILocalizer? localizer = null,
        DateRange? value = null,
        IReadOnlyList<string>? presetIds = null,
        DateOnly? minDate = null,
        bool enableCompare = false,
        bool compare = false,
        bool presetsOnly = false) =>
        new(
            sink ?? new RecordingSink(),
            localizer ?? new RecordingLocalizer(),
            value ?? DatePresets.Get("7d")!.Resolve(Today),
            presetIds,
            minDate,
            maxDate: null,
            enableCompare: enableCompare,
            compare: compare,
            presetsOnly: presetsOnly,
            today: Today,
            culture: EnUs);

    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_ExposesTheCanonicalSlug()
    {
        Assert.Equal("RangePicker", RangePickerRegistration.Slug);
    }

    [Fact]
    public void Registration_ExposesTheWebKeysAndFallbacks()
    {
        Assert.Equal("translation.date.range.trigger", RangePickerRegistration.TriggerKey);
        Assert.Equal("Date range", RangePickerRegistration.TriggerFallback);
        Assert.Equal("translation.date.range.popoverLabel", RangePickerRegistration.PopoverLabelKey);
        Assert.Equal("Date range picker", RangePickerRegistration.PopoverLabelFallback);
        Assert.Equal("translation.date.preset.label", RangePickerRegistration.PresetListKey);
        Assert.Equal("Quick date range", RangePickerRegistration.PresetListFallback);
        Assert.Equal("translation.date.range.pickRange", RangePickerRegistration.PickRangeKey);
        Assert.Equal("Custom range", RangePickerRegistration.PickRangeFallback);
        Assert.Equal("translation.date.range.compare", RangePickerRegistration.CompareKey);
        Assert.Equal("Compare to previous period", RangePickerRegistration.CompareFallback);
        Assert.Equal("translation.date.range.cancel", RangePickerRegistration.CancelKey);
        Assert.Equal("Cancel", RangePickerRegistration.CancelFallback);
        Assert.Equal("translation.date.range.apply", RangePickerRegistration.ApplyKey);
        Assert.Equal("Apply", RangePickerRegistration.ApplyFallback);
    }

    [Fact]
    public void Registration_MapsPresetLabelKeyIntoTheCatalogNamespace()
    {
        DatePreset today = DatePresets.Get("today")!;
        Assert.Equal("translation.date.preset.today", RangePickerRegistration.PresetLabelKey(today));
    }

    [Theory]
    [InlineData(1, "1 day")]
    [InlineData(2, "2 days")]
    [InlineData(7, "7 days")]
    [InlineData(30, "30 days")]
    public void Registration_FormatDayCount_SelectsPluralAndInterpolates(int count, string expected)
    {
        Assert.Equal(expected, RangePickerRegistration.FormatDayCount(PassthroughLocalizer.Instance, count));
    }

    [Fact]
    public void Registration_FormatDayCount_ResolvesThePluralCatalogKey()
    {
        var localizer = new RecordingLocalizer();

        RangePickerRegistration.FormatDayCount(localizer, 1);
        RangePickerRegistration.FormatDayCount(localizer, 5);

        Assert.Contains(RangePickerRegistration.SummaryDaysOneKey, localizer.RequestedKeys);
        Assert.Contains(RangePickerRegistration.SummaryDaysOtherKey, localizer.RequestedKeys);
    }

    // ── logic: formatRange ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void FormatRange_SingleDay_ShowsOneDateWithYear()
    {
        var range = new DateRange(new DateOnly(2026, 6, 5), new DateOnly(2026, 6, 5));
        Assert.Equal("Jun 5, 2026", RangePickerLogic.FormatRange(range, EnUs));
    }

    [Fact]
    public void FormatRange_SameYear_DropsTheStartYear()
    {
        var range = new DateRange(new DateOnly(2026, 6, 5), new DateOnly(2026, 6, 10));
        Assert.Equal("Jun 5 \u2013 Jun 10, 2026", RangePickerLogic.FormatRange(range, EnUs));
    }

    [Fact]
    public void FormatRange_CrossYear_CarriesBothYears()
    {
        var range = new DateRange(new DateOnly(2025, 12, 30), new DateOnly(2026, 1, 2));
        Assert.Equal("Dec 30, 2025 \u2013 Jan 2, 2026", RangePickerLogic.FormatRange(range, EnUs));
    }

    // ── logic: resolveAllTimeStart ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void ResolveAllTimeStart_NoFloor_UsesBaseline()
    {
        Assert.Equal(new DateOnly(2015, 1, 1), RangePickerLogic.ResolveAllTimeStart(null));
    }

    [Fact]
    public void ResolveAllTimeStart_FloorBeforeBaseline_UsesBaseline()
    {
        Assert.Equal(new DateOnly(2015, 1, 1), RangePickerLogic.ResolveAllTimeStart(new DateOnly(2010, 5, 1)));
    }

    [Fact]
    public void ResolveAllTimeStart_FloorAfterBaseline_UsesFloor()
    {
        Assert.Equal(new DateOnly(2024, 3, 10), RangePickerLogic.ResolveAllTimeStart(new DateOnly(2024, 3, 10)));
    }

    // ── logic: resolvePreset ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ResolvePreset_Normal_DefersToCatalogue()
    {
        DateRange expected = DatePresets.Get("7d")!.Resolve(Today);
        Assert.Equal(expected, RangePickerLogic.ResolvePreset(DatePresets.Get("7d")!, Today, minDate: null));
    }

    [Fact]
    public void ResolvePreset_All_FloorsStartAtMinDate()
    {
        DateRange range = RangePickerLogic.ResolvePreset(DatePresets.Get("all")!, Today, new DateOnly(2024, 3, 10));
        Assert.Equal(new DateOnly(2024, 3, 10), range.Start);
        Assert.Equal(Today, range.End);
    }

    [Fact]
    public void ResolvePreset_All_NoMinDate_UsesBaseline()
    {
        DateRange range = RangePickerLogic.ResolvePreset(DatePresets.Get("all")!, Today, minDate: null);
        Assert.Equal(new DateOnly(2015, 1, 1), range.Start);
    }

    // ── logic: staging (react-day-picker range contract) ─────────────────────────────────────────────────

    [Fact]
    public void StageDay_FirstTap_StartsRange()
    {
        var staged = RangePickerLogic.StageDay((null, null), new DateOnly(2026, 6, 5));
        Assert.Equal(new DateOnly(2026, 6, 5), staged.From);
        Assert.Null(staged.To);
    }

    [Fact]
    public void StageDay_SecondTapForward_CompletesRange()
    {
        var staged = RangePickerLogic.StageDay((new DateOnly(2026, 6, 5), null), new DateOnly(2026, 6, 10));
        Assert.Equal(new DateOnly(2026, 6, 5), staged.From);
        Assert.Equal(new DateOnly(2026, 6, 10), staged.To);
    }

    [Fact]
    public void StageDay_SecondTapBackward_NormalizesOrder()
    {
        var staged = RangePickerLogic.StageDay((new DateOnly(2026, 6, 10), null), new DateOnly(2026, 6, 5));
        Assert.Equal(new DateOnly(2026, 6, 5), staged.From);
        Assert.Equal(new DateOnly(2026, 6, 10), staged.To);
    }

    [Fact]
    public void StageDay_SameDay_YieldsSingleDayRange()
    {
        var staged = RangePickerLogic.StageDay((new DateOnly(2026, 6, 5), null), new DateOnly(2026, 6, 5));
        Assert.Equal(new DateOnly(2026, 6, 5), staged.From);
        Assert.Equal(new DateOnly(2026, 6, 5), staged.To);
    }

    [Fact]
    public void StageDay_AfterComplete_RestartsRange()
    {
        var staged = RangePickerLogic.StageDay((new DateOnly(2026, 6, 5), new DateOnly(2026, 6, 10)), new DateOnly(2026, 6, 20));
        Assert.Equal(new DateOnly(2026, 6, 20), staged.From);
        Assert.Null(staged.To);
    }

    [Fact]
    public void IsStagedDirty_IncompleteOrUnchanged_IsFalse()
    {
        var value = new DateRange(new DateOnly(2026, 6, 1), new DateOnly(2026, 6, 5));
        Assert.False(RangePickerLogic.IsStagedDirty((null, null), value));
        Assert.False(RangePickerLogic.IsStagedDirty((new DateOnly(2026, 6, 1), null), value));
        Assert.False(RangePickerLogic.IsStagedDirty((new DateOnly(2026, 6, 1), new DateOnly(2026, 6, 5)), value));
    }

    [Fact]
    public void IsStagedDirty_CompleteAndChanged_IsTrue()
    {
        var value = new DateRange(new DateOnly(2026, 6, 1), new DateOnly(2026, 6, 5));
        Assert.True(RangePickerLogic.IsStagedDirty((new DateOnly(2026, 6, 2), new DateOnly(2026, 6, 5)), value));
    }

    // ── view-model: construction guards ──────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_NullSink_Throws()
    {
        Assert.Throws<ArgumentNullException>(() => new RangePickerViewModel(null!, new RecordingLocalizer()));
    }

    [Fact]
    public void ViewModel_NullLocalizer_Throws()
    {
        Assert.Throws<ArgumentNullException>(() => new RangePickerViewModel(new RecordingSink(), null!));
    }

    // ── view-model: trigger projections ──────────────────────────────────────────────────────────────────

    [Fact]
    public void TriggerLabel_MatchingPreset_ShowsThePresetLabel()
    {
        RangePickerViewModel vm = NewViewModel(value: DatePresets.Get("7d")!.Resolve(Today));

        Assert.Equal("7d", vm.ActivePresetId);
        Assert.Equal("Last 7 days", vm.TriggerLabel);
    }

    [Fact]
    public void TriggerLabel_CustomRange_ShowsTheFallbackLabel()
    {
        RangePickerViewModel vm = NewViewModel(
            value: new DateRange(new DateOnly(2026, 6, 1), new DateOnly(2026, 6, 4)));

        Assert.Null(vm.ActivePresetId);
        Assert.Equal("Custom range", vm.TriggerLabel);
    }

    [Fact]
    public void TriggerSubLabel_AndDayCount_ProjectTheCommittedRange()
    {
        RangePickerViewModel vm = NewViewModel(value: DatePresets.Get("7d")!.Resolve(Today));

        Assert.Equal("May 30 \u2013 Jun 5, 2026", vm.TriggerSubLabel);
        Assert.Equal("7 days", vm.DayCountLabel);
        Assert.Equal("May 30 \u2013 Jun 5, 2026 \u00b7 7 days", vm.TriggerTooltip);
    }

    [Fact]
    public void AccessibleNames_ResolveTheWebKeys()
    {
        var localizer = new RecordingLocalizer();
        RangePickerViewModel vm = NewViewModel(localizer: localizer);

        Assert.Equal("Date range", vm.TriggerAccessibleName);
        Assert.Equal("Date range picker", vm.PopoverLabel);
        Assert.Equal("Quick date range", vm.PresetListLabel);
        Assert.Contains(RangePickerRegistration.TriggerKey, localizer.RequestedKeys);
        Assert.Contains(RangePickerRegistration.PopoverLabelKey, localizer.RequestedKeys);
        Assert.Contains(RangePickerRegistration.PresetListKey, localizer.RequestedKeys);
    }

    [Fact]
    public void FooterLabels_ResolveTheWebKeys()
    {
        RangePickerViewModel vm = NewViewModel(enableCompare: true);

        Assert.Equal("Compare to previous period", vm.CompareLabel);
        Assert.Equal("Cancel", vm.CancelLabel);
        Assert.Equal("Apply", vm.ApplyLabel);
    }

    // ── view-model: preset projection ────────────────────────────────────────────────────────────────────

    [Fact]
    public void Presets_Default_AreTheDefaultIdsInCanonicalOrder()
    {
        RangePickerViewModel vm = NewViewModel();

        Assert.Equal(new[] { "today", "7d", "30d", "mtd", "ytd", "all" }, vm.Presets.Select(p => p.Id));
        Assert.Equal("Today", vm.Presets[0].Label);
        Assert.Equal("All time", vm.Presets[^1].Label);
    }

    [Fact]
    public void Presets_CustomIds_RenderInCanonicalOrderNotInputOrder()
    {
        // Web filters the canonical DATE_PRESETS table, so order follows the catalogue, not the requested ids.
        RangePickerViewModel vm = NewViewModel(presetIds: new[] { "all", "today" });

        Assert.Equal(new[] { "today", "all" }, vm.Presets.Select(p => p.Id));
    }

    [Fact]
    public void PresetIds_Reassignment_RebuildsThePresetProjection()
    {
        RangePickerViewModel vm = NewViewModel();

        vm.PresetIds = new[] { "today", "30d" };

        Assert.Equal(new[] { "today", "30d" }, vm.Presets.Select(p => p.Id));
    }

    [Fact]
    public void PresetsOnly_HidesTheCalendar()
    {
        RangePickerViewModel vm = NewViewModel(presetsOnly: true);

        Assert.False(vm.ShowCalendar);
    }

    [Fact]
    public void EnableCompare_TogglesTheCompareSection()
    {
        Assert.True(NewViewModel(enableCompare: true).ShowCompare);
        Assert.False(NewViewModel(enableCompare: false).ShowCompare);
    }

    // ── view-model: open resets staging ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Open_ResetsStagedToTheCommittedValueAndOpens()
    {
        var value = DatePresets.Get("7d")!.Resolve(Today);
        RangePickerViewModel vm = NewViewModel(value: value);

        vm.Open();

        Assert.True(vm.IsOpen);
        Assert.Equal(value.Start, vm.StagedFrom);
        Assert.Equal(value.End, vm.StagedTo);
        Assert.False(vm.IsApplyEnabled); // staged == value, not dirty.
    }

    // ── view-model: preset click commits immediately ─────────────────────────────────────────────────────

    [Fact]
    public void SelectPreset_AnnouncesTheResolvedRangeAndPresetIdAndCloses()
    {
        var sink = new RecordingSink();
        RangePickerViewModel vm = NewViewModel(sink, value: new DateRange(new DateOnly(2026, 6, 1), new DateOnly(2026, 6, 4)));
        vm.Open();

        vm.SelectPreset("30d");

        DateRange expected = DatePresets.Get("30d")!.Resolve(Today);
        Assert.Single(sink.Changes);
        Assert.Equal(expected, sink.Changes[0].Range);
        Assert.Equal("30d", sink.Changes[0].PresetId);
        Assert.False(vm.IsOpen);
    }

    [Fact]
    public void SelectPreset_All_FloorsStartAtMinDate()
    {
        var sink = new RecordingSink();
        RangePickerViewModel vm = NewViewModel(sink, minDate: new DateOnly(2024, 3, 10));

        vm.SelectPreset("all");

        Assert.Single(sink.Changes);
        Assert.Equal(new DateOnly(2024, 3, 10), sink.Changes[0].Range.Start);
        Assert.Equal(Today, sink.Changes[0].Range.End);
        Assert.Equal("all", sink.Changes[0].PresetId);
    }

    [Fact]
    public void SelectPreset_UnknownId_IsInert()
    {
        var sink = new RecordingSink();
        RangePickerViewModel vm = NewViewModel(sink);

        vm.SelectPreset("does-not-exist");

        Assert.Empty(sink.Changes);
    }

    // ── view-model: calendar staging + apply ─────────────────────────────────────────────────────────────

    [Fact]
    public void StageDay_StagesWithoutAnnouncing_AndTracksDirtyAndDayCount()
    {
        var sink = new RecordingSink();
        RangePickerViewModel vm = NewViewModel(sink, value: new DateRange(new DateOnly(2026, 6, 1), new DateOnly(2026, 6, 5)));
        vm.Open();

        vm.StageDay(new DateOnly(2026, 6, 2));
        Assert.False(vm.IsApplyEnabled); // start only, incomplete.

        vm.StageDay(new DateOnly(2026, 6, 8));
        Assert.True(vm.IsApplyEnabled);  // complete and different from value.
        Assert.Equal(new DateRange(new DateOnly(2026, 6, 2), new DateOnly(2026, 6, 8)), vm.StagedRange);
        Assert.Equal("7 days", vm.StagedDaysLabel);
        Assert.Empty(sink.Changes); // staging never announces.
    }

    [Fact]
    public void Apply_AnnouncesTheStagedRangeWithNoPresetIdAndCloses()
    {
        var sink = new RecordingSink();
        RangePickerViewModel vm = NewViewModel(sink, value: new DateRange(new DateOnly(2026, 6, 1), new DateOnly(2026, 6, 5)));
        vm.Open();
        vm.StageDay(new DateOnly(2026, 6, 2));
        vm.StageDay(new DateOnly(2026, 6, 8));

        vm.Apply();

        Assert.Single(sink.Changes);
        Assert.Equal(new DateRange(new DateOnly(2026, 6, 2), new DateOnly(2026, 6, 8)), sink.Changes[0].Range);
        Assert.Null(sink.Changes[0].PresetId);
        Assert.False(vm.IsOpen);
        Assert.Null(vm.StagedFrom);
    }

    [Fact]
    public void Apply_WhenNotDirty_IsInert()
    {
        var sink = new RecordingSink();
        RangePickerViewModel vm = NewViewModel(sink, value: DatePresets.Get("7d")!.Resolve(Today));
        vm.Open(); // staged == value.

        vm.Apply();

        Assert.Empty(sink.Changes);
    }

    [Fact]
    public void Cancel_DiscardsStagedAndCloses_WithoutAnnouncing()
    {
        var sink = new RecordingSink();
        RangePickerViewModel vm = NewViewModel(sink);
        vm.Open();
        vm.StageDay(new DateOnly(2026, 6, 2));

        vm.Cancel();

        Assert.False(vm.IsOpen);
        Assert.Null(vm.StagedFrom);
        Assert.Empty(sink.Changes);
    }

    [Fact]
    public void NotifyClosed_DiscardsStaged()
    {
        var sink = new RecordingSink();
        RangePickerViewModel vm = NewViewModel(sink);
        vm.Open();
        vm.StageDay(new DateOnly(2026, 6, 2));

        vm.NotifyClosed();

        Assert.False(vm.IsOpen);
        Assert.Null(vm.StagedFrom);
        Assert.Empty(sink.Changes);
    }

    // ── view-model: compare toggle ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void SetCompare_AnnouncesThroughTheSeam()
    {
        var sink = new RecordingSink();
        RangePickerViewModel vm = NewViewModel(sink, enableCompare: true);

        vm.SetCompare(true);
        vm.SetCompare(false);

        Assert.Equal(new[] { true, false }, sink.Compares);
    }

    // ── view-model: controlled-prop echo ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Value_Reassignment_ReprojectsWithoutAnnouncing()
    {
        var sink = new RecordingSink();
        RangePickerViewModel vm = NewViewModel(sink, value: new DateRange(new DateOnly(2026, 6, 1), new DateOnly(2026, 6, 4)));
        Assert.Null(vm.ActivePresetId);

        vm.Value = DatePresets.Get("today")!.Resolve(Today);

        Assert.Equal("today", vm.ActivePresetId);
        Assert.Equal("Today", vm.TriggerLabel);
        Assert.Empty(sink.Changes);
    }

    [Fact]
    public void StageDay_RaisesApplyEnabledChangeNotification()
    {
        RangePickerViewModel vm = NewViewModel(value: new DateRange(new DateOnly(2026, 6, 1), new DateOnly(2026, 6, 5)));
        vm.Open();
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.StageDay(new DateOnly(2026, 6, 2));
        vm.StageDay(new DateOnly(2026, 6, 9));

        Assert.Contains(nameof(RangePickerViewModel.IsApplyEnabled), raised);
        Assert.Contains(nameof(RangePickerViewModel.StagedDaysLabel), raised);
    }

    // ── change seam ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void DelegateSink_ForwardsBothChannels()
    {
        (DateRange Range, string? PresetId)? captured = null;
        bool? compared = null;
        var sink = new DelegateRangePickerSink((r, id) => captured = (r, id), c => compared = c);

        var range = new DateRange(new DateOnly(2026, 6, 1), new DateOnly(2026, 6, 5));
        sink.OnChange(range, "7d");
        sink.OnCompareChange(true);

        Assert.Equal(range, captured!.Value.Range);
        Assert.Equal("7d", captured.Value.PresetId);
        Assert.True(compared);
    }

    [Fact]
    public void DelegateSink_NullDelegates_AreInert()
    {
        var sink = new DelegateRangePickerSink(null);

        sink.OnChange(new DateRange(Today, Today), null); // must not throw.
        sink.OnCompareChange(true);                       // must not throw.
    }

    [Fact]
    public void NoOpSink_IsASharedInertSingleton()
    {
        Assert.Same(NoOpRangePickerSink.Instance, NoOpRangePickerSink.Instance);

        NoOpRangePickerSink.Instance.OnChange(new DateRange(Today, Today), "7d"); // must not throw.
        NoOpRangePickerSink.Instance.OnCompareChange(false);
    }

    // ── diagnostics ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_RecordViewOpened_EmitsTheSluggedEvent()
    {
        var lines = new List<string>();
        var diagnostics = new RangePickerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(new[] { "view.opened slug=RangePicker" }, lines);
    }

    [Fact]
    public void Diagnostics_CountsRepeatedOpens()
    {
        var diagnostics = new RangePickerDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_NullSink_StillCounts()
    {
        var diagnostics = new RangePickerDiagnostics();

        diagnostics.RecordViewOpened(); // must not throw.

        Assert.Equal(1, diagnostics.ViewsOpened);
    }
}
