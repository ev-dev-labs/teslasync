using System.Globalization;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the TimeMachineBanner shared surface's UI-thread-free logic — the registration
/// metadata (slug, the banner/body/pick/return/picker/input/submit/cancel automation ids mirroring the web
/// data-testids, the ARIA role/live contract, the info variant + History/Clock glyphs, and the eight i18n keys
/// with the verbatim English fallbacks the web t() calls render), the pure RFC 3339 / draft / formatting helpers
/// (the <c>looksLikeIso</c>, <c>useAsOfDate</c> normalize, <c>localInputToRfc3339</c>, <c>toLocalDatetimeStr</c> and
/// command-palette seed ports), the per-state <see cref="TimeMachineBannerProjection"/> (hidden / live-prompt /
/// historical, picker open/closed, submit enablement, accessible-name contract), the
/// <see cref="TimeMachineBannerViewModel"/> state holder (initial projection, reprojection, picker toggle, draft
/// staging + submit, return-to-live, the command-palette reveal-and-seed, subscription cleanup), the
/// <see cref="InMemoryAsOfDateSource"/> + <see cref="TimeMachinePickerTrigger"/> seams, and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/components/feedback/TimeMachineBanner.tsx + web/src/hooks/useAsOfDate.ts).
/// The WinUI view itself (shared-surfaces/TimeMachineBanner/TimeMachineBanner.cs) is exercised by the app build.
/// </summary>
public sealed class TimeMachineBannerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 4, 5, 9, 0, 0, TimeSpan.Zero);
    private const string ValidAnchor = "2026-04-04T21:30:00.000Z";

    private static TimeMachineBannerViewModel NewViewModel(
        out InMemoryAsOfDateSource source,
        out TimeMachinePickerTrigger trigger,
        string? initialAsOf = null,
        bool pickerOpen = false)
    {
        source = new InMemoryAsOfDateSource(initialAsOf);
        trigger = new TimeMachinePickerTrigger();
        return new TimeMachineBannerViewModel(Localizer, source, trigger, pickerOpen, () => Now);
    }

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("TimeMachineBanner", TimeMachineBannerRegistration.Slug);

    [Fact]
    public void Automation_ids_mirror_the_web_test_ids()
    {
        Assert.Equal("time-machine-banner", TimeMachineBannerRegistration.BannerAutomationId);
        Assert.Equal("time-machine-banner-body", TimeMachineBannerRegistration.BodyAutomationId);
        Assert.Equal("time-machine-banner-pick", TimeMachineBannerRegistration.PickAutomationId);
        Assert.Equal("time-machine-banner-return", TimeMachineBannerRegistration.ReturnAutomationId);
        Assert.Equal("time-machine-banner-picker", TimeMachineBannerRegistration.PickerAutomationId);
        Assert.Equal("time-machine-banner-input", TimeMachineBannerRegistration.InputAutomationId);
        Assert.Equal("time-machine-banner-submit", TimeMachineBannerRegistration.SubmitAutomationId);
        Assert.Equal("time-machine-banner-cancel", TimeMachineBannerRegistration.CancelAutomationId);
    }

    [Fact]
    public void Role_and_live_setting_describe_a_polite_status_region()
    {
        Assert.Equal("status", TimeMachineBannerRegistration.StatusRole);
        Assert.Equal("polite", TimeMachineBannerRegistration.LiveSetting);
    }

    [Fact]
    public void Variant_is_info_matching_the_web_alert_banner()
    {
        Assert.Equal(CalloutVariant.Info, TimeMachineBannerRegistration.Variant);
        Assert.Equal(CalloutVariants.AccentBrushKey(CalloutVariant.Info), TimeMachineBannerRegistration.AccentBrushKey);
    }

    [Fact]
    public void Glyphs_map_the_web_lucide_marks_to_segoe_fluent()
    {
        Assert.Equal("\uE81C", TimeMachineBannerRegistration.HistoryGlyph); // web History
        Assert.Equal("\uE121", TimeMachineBannerRegistration.ClockGlyph);   // web Clock
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        Assert.Equal("translation.timeMachine.banner.title", TimeMachineBannerRegistration.TitleKey);
        Assert.Equal("Viewing data as of {0}", TimeMachineBannerRegistration.TitleFallback);
        Assert.Equal("translation.timeMachine.banner.body", TimeMachineBannerRegistration.BodyKey);
        Assert.Equal("Read-only point-in-time mode.", TimeMachineBannerRegistration.BodyFallback);
        Assert.Equal("translation.timeMachine.banner.pickPrompt", TimeMachineBannerRegistration.PickPromptKey);
        Assert.Equal("Pick a point in time to view historical data.", TimeMachineBannerRegistration.PickPromptFallback);
        Assert.Equal("translation.timeMachine.banner.pick", TimeMachineBannerRegistration.PickKey);
        Assert.Equal("Pick a date", TimeMachineBannerRegistration.PickFallback);
        Assert.Equal("translation.timeMachine.banner.returnToLive", TimeMachineBannerRegistration.ReturnToLiveKey);
        Assert.Equal("Return to live", TimeMachineBannerRegistration.ReturnToLiveFallback);
        Assert.Equal("translation.timeMachine.banner.submit", TimeMachineBannerRegistration.SubmitKey);
        Assert.Equal("View as of date", TimeMachineBannerRegistration.SubmitFallback);
        Assert.Equal("translation.timeMachine.banner.cancel", TimeMachineBannerRegistration.CancelKey);
        Assert.Equal("Cancel", TimeMachineBannerRegistration.CancelFallback);
        Assert.Equal("translation.timeMachine.banner.inputLabel", TimeMachineBannerRegistration.InputLabelKey);
        Assert.Equal("Date and time", TimeMachineBannerRegistration.InputLabelFallback);
    }

    // ── RFC 3339 sniff / normalize (web looksLikeIso + useAsOfDate parse) ──────────────────────────────────

    [Theory]
    [InlineData("2026-04-04T21:30:00.000Z")]
    [InlineData("2026-04-04T21:30:00Z")]
    [InlineData("2026-04-04T21:30Z")]
    [InlineData("2024-11-12T14:30:00-07:00")]
    public void LooksLikeIso_accepts_well_formed_rfc3339(string value) =>
        Assert.True(TimeMachineBannerRegistration.LooksLikeIso(value));

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("nonsense")]
    [InlineData("2026-04-04")]
    [InlineData("2026-04-04 21:30:00")]
    [InlineData("2024-02-31T00:00:00Z")] // well-formed shape, impossible calendar date (web Date.parse rejects)
    public void LooksLikeIso_rejects_malformed_or_impossible(string? value) =>
        Assert.False(TimeMachineBannerRegistration.LooksLikeIso(value));

    [Fact]
    public void NormalizeAsOf_collapses_empty_and_malformed_to_null_and_passes_valid_through()
    {
        Assert.Null(TimeMachineBannerRegistration.NormalizeAsOf(null));
        Assert.Null(TimeMachineBannerRegistration.NormalizeAsOf(""));
        Assert.Null(TimeMachineBannerRegistration.NormalizeAsOf("garbage"));
        Assert.Equal(ValidAnchor, TimeMachineBannerRegistration.NormalizeAsOf(ValidAnchor));
    }

    // ── draft / seed helpers (web localInputToRfc3339, toLocalDatetimeStr, seed) ───────────────────────────

    [Fact]
    public void LocalToRfc3339_converts_a_local_instant_to_utc_iso_with_millis()
    {
        var local = new DateTimeOffset(2026, 4, 4, 14, 30, 0, TimeSpan.FromHours(-7));

        var iso = TimeMachineBannerRegistration.LocalToRfc3339(local);

        Assert.Equal("2026-04-04T21:30:00.000Z", iso);
        Assert.True(TimeMachineBannerRegistration.LooksLikeIso(iso)); // round-trips through the sniff
    }

    [Fact]
    public void TryParseAsOf_round_trips_a_valid_anchor()
    {
        Assert.True(TimeMachineBannerRegistration.TryParseAsOf(ValidAnchor, out var instant));
        Assert.Equal(new DateTimeOffset(2026, 4, 4, 21, 30, 0, TimeSpan.Zero), instant.ToUniversalTime());
        Assert.False(TimeMachineBannerRegistration.TryParseAsOf("garbage", out _));
    }

    [Fact]
    public void ToLocalDatetimeStr_renders_local_wall_clock_seconds_with_no_zone()
    {
        var localOffset = TimeZoneInfo.Local.GetUtcOffset(new DateTime(2026, 4, 4, 14, 30, 0));
        var instant = new DateTimeOffset(2026, 4, 4, 14, 30, 0, localOffset);

        Assert.Equal("2026-04-04T14:30:00", TimeMachineBannerRegistration.ToLocalDatetimeStr(instant));
    }

    [Fact]
    public void DefaultPickerSeed_is_yesterday_at_local_noon()
    {
        var seed = TimeMachineBannerRegistration.DefaultPickerSeed(Now);
        var local = seed.ToLocalTime();

        Assert.Equal(Now.ToLocalTime().Date.AddDays(-1), local.Date);
        Assert.Equal(new TimeSpan(12, 0, 0), local.TimeOfDay);
    }

    [Fact]
    public void CombineDraft_merges_a_calendar_day_and_time_into_one_local_instant()
    {
        var date = new DateTimeOffset(2026, 4, 4, 0, 0, 0, TimeSpan.Zero);

        var combined = TimeMachineBannerRegistration.CombineDraft(date, new TimeSpan(14, 30, 0));
        var local = combined.ToLocalTime();

        Assert.Equal(2026, local.Year);
        Assert.Equal(4, local.Month);
        Assert.Equal(4, local.Day);
        Assert.Equal(14, local.Hour);
        Assert.Equal(30, local.Minute);
    }

    [Fact]
    public void FormatWhen_is_empty_without_an_anchor_and_matches_the_shared_formatter_with_one()
    {
        Assert.Equal(string.Empty, TimeMachineBannerRegistration.FormatWhen(null, Now));
        Assert.Equal(string.Empty, TimeMachineBannerRegistration.FormatWhen("garbage", Now));

        TimeMachineBannerRegistration.TryParseAsOf(ValidAnchor, out var instant);
        var expected = DateTimeFormatting.Format(instant, DateTimeVariant.Full, Now);

        Assert.Equal(expected, TimeMachineBannerRegistration.FormatWhen(ValidAnchor, Now));
        Assert.NotEqual(string.Empty, expected);
    }

    // ── projection (per-state) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_is_hidden_in_live_mode_with_the_picker_closed()
    {
        var projection = TimeMachineBannerProjection.Project(null, pickerOpen: false, draftReady: false, Now, Localizer);

        Assert.Equal(TimeMachineBannerMode.Hidden, projection.Mode);
        Assert.False(projection.IsVisible);
        Assert.False(projection.HasAsOf);
        Assert.False(projection.ShowReturnToLive);
        Assert.Equal("polite", projection.LiveSetting);
    }

    [Fact]
    public void Projection_shows_the_pick_prompt_in_live_mode_with_the_picker_open()
    {
        var projection = TimeMachineBannerProjection.Project(null, pickerOpen: true, draftReady: false, Now, Localizer);

        Assert.Equal(TimeMachineBannerMode.LivePrompt, projection.Mode);
        Assert.True(projection.IsVisible);
        Assert.True(projection.PickerOpen);
        Assert.False(projection.ShowReturnToLive);
        Assert.Equal("Pick a point in time to view historical data.", projection.Body);
        Assert.Equal("Viewing data as of ", projection.Title); // web title with an empty {{when}}
        Assert.False(projection.SubmitEnabled);
    }

    [Fact]
    public void Projection_shows_the_historical_notice_when_an_anchor_is_set()
    {
        var projection = TimeMachineBannerProjection.Project(ValidAnchor, pickerOpen: false, draftReady: false, Now, Localizer);

        Assert.Equal(TimeMachineBannerMode.Historical, projection.Mode);
        Assert.True(projection.IsVisible);
        Assert.True(projection.HasAsOf);
        Assert.True(projection.ShowReturnToLive);
        Assert.Equal("Read-only point-in-time mode.", projection.Body);
        Assert.Equal("Pick a date", projection.PickLabel);
        Assert.Equal("Return to live", projection.ReturnLabel);
        Assert.Equal("View as of date", projection.SubmitLabel);
        Assert.Equal("Cancel", projection.CancelLabel);
        Assert.Equal("Date and time", projection.InputLabel);

        var when = TimeMachineBannerRegistration.FormatWhen(ValidAnchor, Now);
        Assert.Equal($"Viewing data as of {when}", projection.Title);
    }

    [Fact]
    public void Projection_enables_submit_only_with_a_complete_draft()
    {
        var without = TimeMachineBannerProjection.Project(ValidAnchor, pickerOpen: true, draftReady: false, Now, Localizer);
        var with = TimeMachineBannerProjection.Project(ValidAnchor, pickerOpen: true, draftReady: true, Now, Localizer);

        Assert.False(without.SubmitEnabled);
        Assert.True(with.SubmitEnabled);
        Assert.True(with.PickerOpen);
    }

    [Fact]
    public void Projection_throws_when_the_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(
            () => TimeMachineBannerProjection.Project(null, false, false, Now, null!));

    // ── accessibility (the a11y label contract) ───────────────────────────────────────────────────────────

    [Fact]
    public void Accessible_name_in_historical_mode_is_the_title_and_body()
    {
        var projection = TimeMachineBannerProjection.Project(ValidAnchor, pickerOpen: false, draftReady: false, Now, Localizer);

        Assert.Equal($"{projection.Title}. {projection.Body}", projection.AccessibleName);
    }

    [Fact]
    public void Accessible_name_in_the_live_prompt_is_the_prompt_body()
    {
        var projection = TimeMachineBannerProjection.Project(null, pickerOpen: true, draftReady: false, Now, Localizer);

        Assert.Equal("Pick a point in time to view historical data.", projection.AccessibleName);
    }

    [Fact]
    public void Every_interactive_label_is_resolved_for_screen_readers()
    {
        var projection = TimeMachineBannerProjection.Project(ValidAnchor, pickerOpen: true, draftReady: true, Now, Localizer);

        Assert.All(
            new[]
            {
                projection.PickLabel,
                projection.ReturnLabel,
                projection.SubmitLabel,
                projection.CancelLabel,
                projection.InputLabel,
            },
            label => Assert.False(string.IsNullOrWhiteSpace(label)));
    }

    // ── view-model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void View_model_initial_projection_is_hidden_in_live_mode()
    {
        using var vm = NewViewModel(out _, out _);

        Assert.Equal(TimeMachineBannerMode.Hidden, vm.Mode);
        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void View_model_initial_projection_is_historical_when_seeded_with_an_anchor()
    {
        using var vm = NewViewModel(out _, out _, ValidAnchor);

        Assert.Equal(TimeMachineBannerMode.Historical, vm.Mode);
        Assert.True(vm.IsVisible);
        Assert.True(vm.ShowReturnToLive);
    }

    [Fact]
    public void View_model_toggle_picker_opens_the_live_prompt_and_reprojects()
    {
        using var vm = NewViewModel(out _, out _);
        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        vm.TogglePicker();

        Assert.True(vm.PickerOpen);
        Assert.Equal(TimeMachineBannerMode.LivePrompt, vm.Mode);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void View_model_reprojects_when_the_anchor_changes_underneath_it()
    {
        using var vm = NewViewModel(out var source, out _);
        Assert.False(vm.IsVisible);
        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        source.SetAsOf(ValidAnchor);

        Assert.Equal(TimeMachineBannerMode.Historical, vm.Mode);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void View_model_staging_a_full_draft_enables_submit()
    {
        using var vm = NewViewModel(out _, out _);
        vm.TogglePicker();
        Assert.False(vm.SubmitEnabled);

        vm.SetDraftDate(new DateTimeOffset(2026, 4, 4, 0, 0, 0, TimeSpan.Zero));
        Assert.False(vm.SubmitEnabled); // date only — still incomplete

        vm.SetDraftTime(new TimeSpan(14, 30, 0));
        Assert.True(vm.SubmitEnabled);
        Assert.True(vm.DraftReady);
    }

    [Fact]
    public void View_model_submit_with_an_incomplete_draft_is_a_no_op()
    {
        using var vm = NewViewModel(out var source, out _);
        vm.TogglePicker();
        vm.SetDraftDate(new DateTimeOffset(2026, 4, 4, 0, 0, 0, TimeSpan.Zero));

        Assert.False(vm.Submit());
        Assert.Null(source.AsOf);
        Assert.True(vm.PickerOpen);
    }

    [Fact]
    public void View_model_submit_applies_the_anchor_forwards_to_the_seam_and_closes_the_picker()
    {
        using var vm = NewViewModel(out var source, out _);
        vm.TogglePicker();
        var date = new DateTimeOffset(2026, 4, 4, 0, 0, 0, TimeSpan.Zero);
        var time = new TimeSpan(14, 30, 0);
        vm.SetDraftDate(date);
        vm.SetDraftTime(time);

        Assert.True(vm.Submit());

        var expected = TimeMachineBannerRegistration.LocalToRfc3339(TimeMachineBannerRegistration.CombineDraft(date, time));
        Assert.Equal(expected, source.AsOf);
        Assert.False(vm.PickerOpen);
        Assert.Equal(TimeMachineBannerMode.Historical, vm.Mode);
    }

    [Fact]
    public void View_model_return_to_live_clears_the_anchor_and_closes_the_picker()
    {
        using var vm = NewViewModel(out var source, out _, ValidAnchor, pickerOpen: true);
        Assert.Equal(TimeMachineBannerMode.Historical, vm.Mode);

        vm.ReturnToLive();

        Assert.Null(source.AsOf);
        Assert.False(vm.PickerOpen);
        Assert.Equal(TimeMachineBannerMode.Hidden, vm.Mode);
    }

    [Fact]
    public void View_model_command_palette_trigger_reveals_and_seeds_the_picker()
    {
        using var vm = NewViewModel(out _, out var trigger);

        trigger.RequestOpen();

        Assert.True(vm.PickerOpen);
        Assert.Equal(TimeMachineBannerMode.LivePrompt, vm.Mode);
        Assert.NotNull(vm.DraftDate);
        Assert.NotNull(vm.DraftTime);

        // No anchor → seeded to yesterday at local noon.
        Assert.Equal(Now.ToLocalTime().Date.AddDays(-1), vm.DraftDate!.Value.ToLocalTime().Date);
        Assert.Equal(new TimeSpan(12, 0, 0), vm.DraftTime!.Value);
    }

    [Fact]
    public void View_model_command_palette_trigger_seeds_from_the_current_anchor_when_set()
    {
        using var vm = NewViewModel(out _, out var trigger, ValidAnchor);

        trigger.RequestOpen();

        TimeMachineBannerRegistration.TryParseAsOf(ValidAnchor, out var anchor);
        Assert.Equal(anchor.ToLocalTime().TimeOfDay, vm.DraftTime);
        Assert.Equal(anchor.ToLocalTime().Date, vm.DraftDate!.Value.ToLocalTime().Date);
    }

    [Fact]
    public void View_model_unsubscribes_on_dispose()
    {
        var vm = NewViewModel(out var source, out var trigger);
        vm.Dispose();

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        source.SetAsOf(ValidAnchor);
        trigger.RequestOpen();

        Assert.Equal(0, raised);
    }

    // ── seams ─────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void As_of_source_normalizes_a_malformed_initial_value_to_null() =>
        Assert.Null(new InMemoryAsOfDateSource("not-a-timestamp").AsOf);

    [Fact]
    public void As_of_source_set_stores_a_valid_anchor_and_raises_changed_once()
    {
        var source = new InMemoryAsOfDateSource();
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.SetAsOf(ValidAnchor);

        Assert.Equal(ValidAnchor, source.AsOf);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void As_of_source_refuses_a_malformed_write_and_stays_silent()
    {
        var source = new InMemoryAsOfDateSource(ValidAnchor);
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.SetAsOf("garbage");

        Assert.Equal(ValidAnchor, source.AsOf);
        Assert.Equal(0, raised);
    }

    [Fact]
    public void As_of_source_clear_and_empty_write_return_to_live()
    {
        var fromClear = new InMemoryAsOfDateSource(ValidAnchor);
        fromClear.Clear();
        Assert.Null(fromClear.AsOf);

        var fromEmpty = new InMemoryAsOfDateSource(ValidAnchor);
        fromEmpty.SetAsOf("");
        Assert.Null(fromEmpty.AsOf);
    }

    [Fact]
    public void As_of_source_idempotent_write_is_silent()
    {
        var source = new InMemoryAsOfDateSource(ValidAnchor);
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.SetAsOf(ValidAnchor);

        Assert.Equal(0, raised);
    }

    [Fact]
    public void Picker_trigger_raises_open_requested()
    {
        var trigger = new TimeMachinePickerTrigger();
        var raised = 0;
        trigger.OpenRequested += (_, _) => raised++;

        trigger.RequestOpen();

        Assert.Equal(1, raised);
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_only_operational_lines_with_the_surface_slug_and_no_timestamp()
    {
        var lines = new List<string>();
        var diagnostics = new TimeMachineBannerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordAnchorApplied();
        diagnostics.RecordReturnedToLive();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.AnchorsApplied);
        Assert.Equal(1, diagnostics.ReturnedToLive);
        Assert.Equal(
            new[]
            {
                "view.opened slug=TimeMachineBanner",
                "time-machine.as-of-applied slug=TimeMachineBanner",
                "time-machine.returned-to-live slug=TimeMachineBanner",
            },
            lines);
        Assert.DoesNotContain(lines, line => line.Contains("2026", StringComparison.Ordinal));
    }
}
