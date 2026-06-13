using System.Globalization;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the DraftRecoveryBanner shared surface's UI-thread-free logic — the registration
/// metadata (slug, the banner / use / discard automation ids, the ARIA role/live contract, the info variant +
/// glyph + accent, and the five i18n keys with the verbatim English fallbacks the web t() calls render), the
/// relative-time adapter (<see cref="DraftRecoveryFormatting"/>) and the message interpolation
/// (<see cref="DraftRecoveryBannerRegistration.FormatRestored"/> /
/// <see cref="DraftRecoveryBannerRegistration.FormatRestoredItem"/>), the pure
/// <see cref="DraftRecoveryBannerProjection"/> (visibility gating, the known-time vs "a moment ago" copy, the
/// generic vs noun-qualified message, the accessible-name contract and the polite live setting), the
/// <see cref="DraftRecoveryBannerViewModel"/> state holder (initial projection, use-draft / discard forwarding +
/// sticky dismissal, reprojection, language reload, subscription cleanup), the
/// <see cref="DelegateDraftRecoverySource"/> seam and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/feedback/DraftRecoveryBanner.tsx + web/src/lib/dateFormat.ts). The WinUI view itself
/// (shared-surfaces/DraftRecoveryBanner.cs) is exercised by the app build.
/// </summary>
public sealed class DraftRecoveryBannerTests
{
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static DraftRecoverySnapshot Restored(int? minutesAgo = 5, string? noun = null) =>
        new(true, minutesAgo is int m ? Now.AddMinutes(-m) : null, noun);

    private static DraftRecoveryBannerProjection Project(DraftRecoverySnapshot snapshot, bool dismissed = false, ILocalizer? localizer = null) =>
        DraftRecoveryBannerProjection.Project(snapshot, dismissed, Now, CultureInfo.InvariantCulture, localizer ?? Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("DraftRecoveryBanner", DraftRecoveryBannerRegistration.Slug);

    [Fact]
    public void Automation_ids_address_the_root_and_both_actions()
    {
        Assert.Equal("draft-recovery-banner", DraftRecoveryBannerRegistration.BannerAutomationId);
        Assert.Equal("draft-recovery-use", DraftRecoveryBannerRegistration.UseDraftAutomationId);
        Assert.Equal("draft-recovery-discard", DraftRecoveryBannerRegistration.DiscardAutomationId);
    }

    [Fact]
    public void Role_and_live_setting_describe_a_polite_status_region()
    {
        Assert.Equal("status", DraftRecoveryBannerRegistration.StatusRole);
        Assert.Equal("polite", DraftRecoveryBannerRegistration.LiveSetting);
    }

    [Fact]
    public void Variant_is_info_matching_the_web_alert_banner()
    {
        Assert.Equal(CalloutVariant.Info, DraftRecoveryBannerRegistration.Variant);
        Assert.Equal(CalloutVariants.Glyph(CalloutVariant.Info), DraftRecoveryBannerRegistration.Glyph);
        Assert.Equal("TsColorInfoBrush", DraftRecoveryBannerRegistration.AccentBrushKey);
    }

    [Theory]
    [InlineData(DraftRecoveryBannerRegistration.UnknownTimeKey, "draft.unknownTime")]
    [InlineData(DraftRecoveryBannerRegistration.RestoredKey, "draft.restored")]
    [InlineData(DraftRecoveryBannerRegistration.RestoredItemKey, "draft.restoredItem")]
    [InlineData(DraftRecoveryBannerRegistration.UseDraftKey, "draft.useDraft")]
    [InlineData(DraftRecoveryBannerRegistration.DiscardKey, "draft.discardDraft")]
    public void I18n_keys_match_the_web_keys(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(DraftRecoveryBannerRegistration.UnknownTimeFallback, "a moment ago")]
    [InlineData(DraftRecoveryBannerRegistration.RestoredFallback, "Draft restored from {{when}}.")]
    [InlineData(DraftRecoveryBannerRegistration.RestoredItemFallback, "{{noun}} draft restored from {{when}}.")]
    [InlineData(DraftRecoveryBannerRegistration.UseDraftFallback, "Use draft")]
    [InlineData(DraftRecoveryBannerRegistration.DiscardFallback, "Discard draft")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    // ── snapshot ──────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Snapshot_none_has_no_draft()
    {
        Assert.False(DraftRecoverySnapshot.None.HasDraft);
        Assert.Null(DraftRecoverySnapshot.None.SavedAt);
        Assert.Null(DraftRecoverySnapshot.None.ItemNoun);
    }

    // ── adapter: relative-time tiers (web formatRelativeTime) ────────────────────────────────────────────

    [Fact]
    public void Relative_time_under_a_minute_reads_just_now() =>
        Assert.Equal("Just now", DraftRecoveryFormatting.FormatRelativeTime(Now.AddSeconds(-30), Now, CultureInfo.InvariantCulture));

    [Fact]
    public void Relative_time_future_instant_reads_just_now() =>
        Assert.Equal("Just now", DraftRecoveryFormatting.FormatRelativeTime(Now.AddMinutes(5), Now, CultureInfo.InvariantCulture));

    [Fact]
    public void Relative_time_minutes_tier() =>
        Assert.Equal("5m ago", DraftRecoveryFormatting.FormatRelativeTime(Now.AddMinutes(-5), Now, CultureInfo.InvariantCulture));

    [Fact]
    public void Relative_time_hours_tier() =>
        Assert.Equal("2h ago", DraftRecoveryFormatting.FormatRelativeTime(Now.AddMinutes(-150), Now, CultureInfo.InvariantCulture));

    [Fact]
    public void Relative_time_over_a_day_reads_the_absolute_date() =>
        Assert.Equal("Jun 7, 12:00 PM", DraftRecoveryFormatting.FormatRelativeTime(Now.AddDays(-2), Now, CultureInfo.InvariantCulture));

    [Fact]
    public void Relative_time_throws_when_culture_is_null() =>
        Assert.Throws<ArgumentNullException>(() => DraftRecoveryFormatting.FormatRelativeTime(Now, Now, null!));

    // ── adapter: message interpolation (web t(..., { noun, when })) ───────────────────────────────────────

    [Fact]
    public void Format_restored_interpolates_the_when_token() =>
        Assert.Equal(
            "Draft restored from 5m ago.",
            DraftRecoveryBannerRegistration.FormatRestored("Draft restored from {{when}}.", "5m ago"));

    [Fact]
    public void Format_restored_item_interpolates_both_tokens() =>
        Assert.Equal(
            "rule draft restored from 5m ago.",
            DraftRecoveryBannerRegistration.FormatRestoredItem("{{noun}} draft restored from {{when}}.", "rule", "5m ago"));

    [Fact]
    public void Format_restored_accepts_a_positional_token_localization()
    {
        // A localized catalog could ship the .NET positional form; both must interpolate without throwing.
        Assert.Equal("Restored from 5m ago", DraftRecoveryBannerRegistration.FormatRestored("Restored from {0}", "5m ago"));
        Assert.Equal("rule from 5m ago", DraftRecoveryBannerRegistration.FormatRestoredItem("{0} from {1}", "rule", "5m ago"));
    }

    // ── projection (per-state) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_is_collapsed_when_there_is_no_draft()
    {
        var projection = Project(DraftRecoverySnapshot.None);

        Assert.False(projection.IsVisible);
        Assert.Equal("polite", projection.LiveSetting);
    }

    [Fact]
    public void Projection_is_collapsed_when_dismissed()
    {
        var projection = Project(Restored(), dismissed: true);

        Assert.False(projection.IsVisible);
    }

    [Fact]
    public void Projection_is_shown_with_the_generic_copy_and_known_time()
    {
        var projection = Project(Restored(minutesAgo: 5));

        Assert.True(projection.IsVisible);
        Assert.Equal("5m ago", projection.WhenText);
        Assert.Equal("Draft restored from 5m ago.", projection.Message);
        Assert.Equal("Use draft", projection.UseDraftLabel);
        Assert.Equal("Discard draft", projection.DiscardLabel);
    }

    [Fact]
    public void Projection_uses_the_unknown_time_copy_when_the_save_instant_is_missing()
    {
        var projection = Project(Restored(minutesAgo: null));

        Assert.True(projection.IsVisible);
        Assert.Equal("a moment ago", projection.WhenText);
        Assert.Equal("Draft restored from a moment ago.", projection.Message);
    }

    [Fact]
    public void Projection_uses_the_noun_qualified_copy_when_a_noun_is_supplied()
    {
        var projection = Project(Restored(minutesAgo: 5, noun: "rule"));

        Assert.True(projection.IsVisible);
        Assert.Equal("rule draft restored from 5m ago.", projection.Message);
    }

    [Fact]
    public void Projection_accessible_name_is_the_message()
    {
        // a11y: a screen reader announces the banner message when the recovery notice drops in.
        var projection = Project(Restored());

        Assert.Equal(projection.Message, projection.AccessibleName);
    }

    [Fact]
    public void Projection_routes_every_string_through_the_localizer()
    {
        // a11y / i18n: no English literal is baked into the projection — every string flows through a keyed call.
        var recording = new RecordingLocalizer();

        _ = Project(Restored(minutesAgo: null, noun: "automation"), localizer: recording);

        Assert.Contains(DraftRecoveryBannerRegistration.UnknownTimeKey, recording.RequestedKeys);
        Assert.Contains(DraftRecoveryBannerRegistration.RestoredItemKey, recording.RequestedKeys);
        Assert.Contains(DraftRecoveryBannerRegistration.UseDraftKey, recording.RequestedKeys);
        Assert.Contains(DraftRecoveryBannerRegistration.DiscardKey, recording.RequestedKeys);
    }

    [Fact]
    public void Projection_throws_when_inputs_are_null()
    {
        Assert.Throws<ArgumentNullException>(() =>
            DraftRecoveryBannerProjection.Project(null!, false, Now, CultureInfo.InvariantCulture, Localizer));
        Assert.Throws<ArgumentNullException>(() =>
            DraftRecoveryBannerProjection.Project(DraftRecoverySnapshot.None, false, Now, null!, Localizer));
        Assert.Throws<ArgumentNullException>(() =>
            DraftRecoveryBannerProjection.Project(DraftRecoverySnapshot.None, false, Now, CultureInfo.InvariantCulture, null!));
    }

    // ── view-model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void View_model_initial_projection_reflects_the_seam()
    {
        var source = new DelegateDraftRecoverySource(Restored(minutesAgo: 5, noun: "rule"));
        using var vm = new DraftRecoveryBannerViewModel(Localizer, source, () => Now);

        Assert.True(vm.IsVisible);
        Assert.Equal("rule draft restored from 5m ago.", vm.Message);
        Assert.Equal("Use draft", vm.UseDraftLabel);
        Assert.Equal("Discard draft", vm.DiscardLabel);
    }

    [Fact]
    public void View_model_use_draft_dismisses_forwards_restore_and_collapses()
    {
        var restored = 0;
        var source = new DelegateDraftRecoverySource(Restored(), onRestore: () => restored++);
        using var vm = new DraftRecoveryBannerViewModel(Localizer, source, () => Now);
        Assert.True(vm.IsVisible);

        vm.UseDraft();

        Assert.False(vm.IsVisible);
        Assert.Equal(1, source.RestoreCount);
        Assert.Equal(1, restored);
        Assert.Equal(0, source.DiscardCount);
    }

    [Fact]
    public void View_model_discard_dismisses_forwards_discard_and_collapses()
    {
        var discarded = 0;
        var source = new DelegateDraftRecoverySource(Restored(), onDiscard: () => discarded++);
        using var vm = new DraftRecoveryBannerViewModel(Localizer, source, () => Now);
        Assert.True(vm.IsVisible);

        vm.Discard();

        Assert.False(vm.IsVisible);
        Assert.Equal(1, source.DiscardCount);
        Assert.Equal(1, discarded);
        Assert.Equal(0, source.RestoreCount);
    }

    [Fact]
    public void View_model_reprojects_when_a_draft_is_hydrated()
    {
        var source = new DelegateDraftRecoverySource(DraftRecoverySnapshot.None);
        using var vm = new DraftRecoveryBannerViewModel(Localizer, source, () => Now);
        Assert.False(vm.IsVisible);

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        source.Set(Restored(minutesAgo: 5));

        Assert.True(vm.IsVisible);
        Assert.Equal("Draft restored from 5m ago.", vm.Message);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void View_model_dismissal_is_sticky_across_a_later_snapshot_change()
    {
        // Parity with the web `dismissed` useState: once dismissed for the holder's lifetime it stays collapsed,
        // even if a fresh draft is pushed (a new banner surfaces by rebinding a fresh holder).
        var source = new DelegateDraftRecoverySource(Restored());
        using var vm = new DraftRecoveryBannerViewModel(Localizer, source, () => Now);

        vm.Discard();
        Assert.False(vm.IsVisible);

        source.Set(Restored(minutesAgo: 1, noun: "automation"));

        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void View_model_reload_re_raises_the_projection()
    {
        var source = new DelegateDraftRecoverySource(Restored());
        using var vm = new DraftRecoveryBannerViewModel(Localizer, source, () => Now);

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        vm.Reload();

        Assert.Equal(1, raised);
    }

    [Fact]
    public void View_model_unsubscribes_on_dispose()
    {
        var source = new DelegateDraftRecoverySource(DraftRecoverySnapshot.None);
        var vm = new DraftRecoveryBannerViewModel(Localizer, source, () => Now);
        vm.Dispose();

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        source.Set(Restored());

        Assert.Equal(0, raised);
    }

    [Fact]
    public void View_model_throws_when_inputs_are_null()
    {
        var source = new DelegateDraftRecoverySource(DraftRecoverySnapshot.None);
        Assert.Throws<ArgumentNullException>(() => new DraftRecoveryBannerViewModel(null!, source));
        Assert.Throws<ArgumentNullException>(() => new DraftRecoveryBannerViewModel(Localizer, null!));
    }

    // ── source seam ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Source_set_raises_changed_and_moves_current()
    {
        var source = new DelegateDraftRecoverySource();
        Assert.False(source.Current.HasDraft);

        var raised = 0;
        source.Changed += (_, _) => raised++;
        source.Set(Restored(minutesAgo: 3, noun: "settings"));

        Assert.Equal(1, raised);
        Assert.True(source.Current.HasDraft);
        Assert.Equal("settings", source.Current.ItemNoun);
    }

    [Fact]
    public void Source_restore_and_discard_forward_to_the_callbacks_and_count()
    {
        var restored = 0;
        var discarded = 0;
        var source = new DelegateDraftRecoverySource(Restored(), onRestore: () => restored++, onDiscard: () => discarded++);

        source.Restore();
        source.Discard();

        Assert.Equal(1, source.RestoreCount);
        Assert.Equal(1, source.DiscardCount);
        Assert.Equal(1, restored);
        Assert.Equal(1, discarded);
    }

    [Fact]
    public void Source_restore_and_discard_are_safe_without_callbacks()
    {
        var source = new DelegateDraftRecoverySource(Restored());

        source.Restore();
        source.Discard();

        Assert.Equal(1, source.RestoreCount);
        Assert.Equal(1, source.DiscardCount);
    }

    [Fact]
    public void Source_set_throws_when_snapshot_is_null() =>
        Assert.Throws<ArgumentNullException>(() => new DelegateDraftRecoverySource().Set(null!));

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_only_operational_lines_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DraftRecoveryBannerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordUseDraft();
        diagnostics.RecordDiscard();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.UseDrafts);
        Assert.Equal(1, diagnostics.Discards);
        Assert.Equal(
            new[]
            {
                "view.opened slug=DraftRecoveryBanner",
                "draft-recovery.use slug=DraftRecoveryBanner",
                "draft-recovery.discard slug=DraftRecoveryBanner",
            },
            lines);
    }
}
