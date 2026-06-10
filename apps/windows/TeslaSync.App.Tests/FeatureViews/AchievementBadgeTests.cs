using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AchievementBadge</c> feature surface's UI-thread-free logic — the per-state
/// branch projection (loading / error / empty / stale / offline / ready), the web <c>Math.round(progress * 100)</c>
/// percent, the web <c>!unlocked &amp;&amp; progress &gt;= 0.8</c> near-complete flag, the clamped ring sweep, the
/// unlocked / locked colours + captions, the size metrics (the web <c>sizeConfig</c>), the freshness chip copy, the
/// accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/analytics/components/AchievementBadge.tsx). The WinUI view itself (AchievementBadge.cs) is
/// exercised by the app build.
/// </summary>
public sealed class AchievementBadgeTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private const string WarningKey = "TsColorWarningBrush";
    private const string SecondaryKey = "TsColorTextSecondaryBrush";
    private const string MutedKey = "TsColorTextMutedBrush";
    private const string BorderKey = "TsColorBorderBrush";

    private static AchievementData Ach(
        bool unlocked = false,
        double progress = 0.5,
        string name = "Road Warrior",
        string description = "Drive 1,000 km",
        string icon = "\U0001F3C6",
        string id = "road-warrior",
        string? unlockedAt = null,
        int target = 1000,
        int current = 500) =>
        new(id, name, description, icon, unlocked, unlockedAt, progress, target, current);

    private static AchievementBadgeDisplay Project(AchievementBadgeModel model) =>
        AchievementBadgeProjection.Project(model, Localizer);

    // ── Branch precedence: loading → error → empty → freshness → ready ─────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(AchievementBadgeState.Loading, Project(AchievementBadgeModel.Loading()).State);

    [Fact]
    public void Error_when_model_failed() =>
        Assert.Equal(AchievementBadgeState.Error, Project(AchievementBadgeModel.Failed()).State);

    [Fact]
    public void Empty_when_model_is_empty() =>
        Assert.Equal(AchievementBadgeState.Empty, Project(AchievementBadgeModel.Empty()).State);

    [Fact]
    public void Ready_when_achievement_present() =>
        Assert.Equal(AchievementBadgeState.Ready, Project(AchievementBadgeModel.Ready(Ach())).State);

    [Fact]
    public void Fresh_snapshot_with_no_achievement_collapses_to_empty() =>
        Assert.Equal(
            AchievementBadgeState.Empty,
            Project(new AchievementBadgeModel(AchievementBadgeState.Ready, null)).State);

    [Fact]
    public void Stale_keeps_its_branch_with_an_achievement() =>
        Assert.Equal(AchievementBadgeState.Stale, Project(AchievementBadgeModel.Stale(Ach())).State);

    [Fact]
    public void Offline_keeps_its_branch_with_an_achievement() =>
        Assert.Equal(AchievementBadgeState.Offline, Project(AchievementBadgeModel.Offline(Ach())).State);

    [Fact]
    public void Stale_with_no_achievement_collapses_to_empty() =>
        Assert.Equal(
            AchievementBadgeState.Empty,
            Project(new AchievementBadgeModel(AchievementBadgeState.Stale, null)).State);

    [Fact]
    public void Offline_with_no_achievement_collapses_to_empty() =>
        Assert.Equal(
            AchievementBadgeState.Empty,
            Project(new AchievementBadgeModel(AchievementBadgeState.Offline, null)).State);

    // ── Percent: the web Math.round(progress * 100) ───────────────────────────────────────────────────────

    [Theory]
    [InlineData(0.0, 0)]
    [InlineData(0.5, 50)]
    [InlineData(0.8, 80)]
    [InlineData(1.0, 100)]
    [InlineData(0.756, 76)]
    [InlineData(0.754, 75)]
    public void Percent_rounds_like_the_web(double progress, int expected) =>
        Assert.Equal(expected, AchievementBadgeProjection.PercentOf(progress));

    [Fact]
    public void Percent_rounds_halves_away_from_zero_like_javascript() =>
        // 0.125 * 100 == 12.5 exactly; JS Math.round → 13 (banker's rounding would give 12).
        Assert.Equal(13, AchievementBadgeProjection.PercentOf(0.125));

    [Fact]
    public void Percent_text_appends_a_percent_sign() =>
        Assert.Equal("50%", Project(AchievementBadgeModel.Ready(Ach(progress: 0.5))).PercentText);

    // ── Near complete: the web !unlocked && progress >= 0.8 ───────────────────────────────────────────────

    [Theory]
    [InlineData(0.8, true)]
    [InlineData(0.95, true)]
    [InlineData(1.0, true)]
    [InlineData(0.79, false)]
    [InlineData(0.0, false)]
    public void Near_complete_follows_the_web_threshold(double progress, bool expected) =>
        Assert.Equal(expected, AchievementBadgeProjection.IsNearComplete(false, progress));

    [Fact]
    public void Unlocked_badge_is_never_near_complete() =>
        Assert.False(AchievementBadgeProjection.IsNearComplete(true, 0.95));

    [Fact]
    public void Near_complete_threshold_is_the_web_constant() =>
        Assert.Equal(0.8, AchievementBadgeProjection.NearCompleteThreshold, 3);

    // ── Size metrics: the web sizeConfig ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Small_metrics_match_the_web_size_config()
    {
        var m = AchievementBadgeMetrics.For(AchievementBadgeSize.Small);

        Assert.Equal(56, m.RingDiameter, 3);
        Assert.Equal(3, m.StrokeWidth, 3);
        Assert.Equal(20, m.IconFontSize, 3);
        Assert.Equal(12, m.NameFontSize, 3);
        Assert.Equal(4, m.Gap, 3);
    }

    [Fact]
    public void Medium_metrics_match_the_web_size_config()
    {
        var m = AchievementBadgeMetrics.For(AchievementBadgeSize.Medium);

        Assert.Equal(72, m.RingDiameter, 3);
        Assert.Equal(4, m.StrokeWidth, 3);
        Assert.Equal(30, m.IconFontSize, 3);
        Assert.Equal(14, m.NameFontSize, 3);
        Assert.Equal(8, m.Gap, 3);
    }

    [Fact]
    public void Large_metrics_match_the_web_size_config()
    {
        var m = AchievementBadgeMetrics.For(AchievementBadgeSize.Large);

        Assert.Equal(96, m.RingDiameter, 3);
        Assert.Equal(5, m.StrokeWidth, 3);
        Assert.Equal(36, m.IconFontSize, 3);
        Assert.Equal(16, m.NameFontSize, 3);
        Assert.Equal(12, m.Gap, 3);
    }

    [Fact]
    public void Metrics_default_to_medium() =>
        Assert.Equal(
            AchievementBadgeMetrics.For(AchievementBadgeSize.Medium),
            Project(AchievementBadgeModel.Ready(Ach())).Metrics);

    [Fact]
    public void Metrics_follow_the_requested_size() =>
        Assert.Equal(
            AchievementBadgeMetrics.For(AchievementBadgeSize.Large),
            Project(AchievementBadgeModel.Ready(Ach(), AchievementBadgeSize.Large)).Metrics);

    // ── Unlocked branch: amber name + "✓ Unlocked", no ring ───────────────────────────────────────────────

    [Fact]
    public void Unlocked_badge_hides_the_progress_ring() =>
        Assert.False(Project(AchievementBadgeModel.Ready(Ach(unlocked: true, progress: 1.0))).ShowRing);

    [Fact]
    public void Unlocked_badge_shows_the_unlocked_caption() =>
        Assert.Equal("\u2713 Unlocked", Project(AchievementBadgeModel.Ready(Ach(unlocked: true))).StatusText);

    [Fact]
    public void Unlocked_badge_tints_name_and_status_amber()
    {
        var display = Project(AchievementBadgeModel.Ready(Ach(unlocked: true)));

        Assert.True(display.IsUnlocked);
        Assert.Equal(WarningKey, display.NameAccentKey);
        Assert.Equal(WarningKey, display.StatusAccentKey);
        Assert.Equal(WarningKey, display.ContainerBorderKey);
    }

    // ── Locked branch: ring + percent + grey / muted tints ────────────────────────────────────────────────

    [Fact]
    public void Locked_badge_shows_the_progress_ring() =>
        Assert.True(Project(AchievementBadgeModel.Ready(Ach(unlocked: false))).ShowRing);

    [Fact]
    public void Locked_badge_shows_the_percent_as_status() =>
        Assert.Equal("50%", Project(AchievementBadgeModel.Ready(Ach(unlocked: false, progress: 0.5))).StatusText);

    [Fact]
    public void Locked_badge_uses_secondary_and_muted_tints()
    {
        var display = Project(AchievementBadgeModel.Ready(Ach(unlocked: false, progress: 0.5)));

        Assert.False(display.IsUnlocked);
        Assert.Equal(SecondaryKey, display.NameAccentKey);
        Assert.Equal(MutedKey, display.StatusAccentKey);
        Assert.Equal(BorderKey, display.ContainerBorderKey);
    }

    // ── Ring sweep: clamped pct / 100, near-complete amber arc ────────────────────────────────────────────

    [Fact]
    public void Ring_fraction_is_pct_over_100() =>
        Assert.Equal(0.5, Project(AchievementBadgeModel.Ready(Ach(progress: 0.5))).RingFraction, 3);

    [Fact]
    public void Ring_fraction_clamps_to_one() =>
        Assert.Equal(1.0, Project(AchievementBadgeModel.Ready(Ach(progress: 1.5))).RingFraction, 3);

    [Fact]
    public void Ring_fraction_clamps_to_zero() =>
        Assert.Equal(0.0, Project(AchievementBadgeModel.Ready(Ach(progress: -0.2))).RingFraction, 3);

    [Fact]
    public void Near_complete_ring_is_tinted_warning()
    {
        var display = Project(AchievementBadgeModel.Ready(Ach(unlocked: false, progress: 0.9)));

        Assert.True(display.IsNearComplete);
        Assert.Equal(StatusKind.Warning, display.RingSeverity);
        Assert.Equal(WarningKey, display.RingAccentKey);
    }

    [Fact]
    public void Normal_ring_is_tinted_neutral()
    {
        var display = Project(AchievementBadgeModel.Ready(Ach(unlocked: false, progress: 0.4)));

        Assert.False(display.IsNearComplete);
        Assert.Equal(StatusKind.Neutral, display.RingSeverity);
        Assert.Equal(SecondaryKey, display.RingAccentKey);
    }

    // ── Icon / name / description passthrough ─────────────────────────────────────────────────────────────

    [Fact]
    public void Icon_name_and_description_are_passed_through_verbatim()
    {
        var display = Project(AchievementBadgeModel.Ready(
            Ach(name: "First Charge", description: "Plug in for the first time", icon: "\U0001F50C")));

        Assert.Equal("First Charge", display.Name);
        Assert.Equal("Plug in for the first time", display.Description);
        Assert.Equal("\U0001F50C", display.IconText);
    }

    [Fact]
    public void Progress_percent_is_exposed()
    {
        var display = Project(AchievementBadgeModel.Ready(Ach(progress: 0.73)));

        Assert.Equal(73, display.ProgressPercent);
    }

    // ── Freshness chip ────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Ready_has_no_freshness_chip() =>
        Assert.False(Project(AchievementBadgeModel.Ready(Ach())).ShowFreshnessChip);

    [Fact]
    public void Stale_shows_a_warning_stale_chip()
    {
        var display = Project(AchievementBadgeModel.Stale(Ach()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Stale", display.FreshnessChipText);
        Assert.Equal(StatusKind.Warning, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_shows_a_danger_offline_chip()
    {
        var display = Project(AchievementBadgeModel.Offline(Ach()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Offline", display.FreshnessChipText);
        Assert.Equal(StatusKind.Danger, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_keeps_the_cached_badge()
    {
        var display = Project(AchievementBadgeModel.Offline(Ach(unlocked: true, name: "Marathon")));

        Assert.Equal("Marathon", display.Name);
        Assert.Equal("\u2713 Unlocked", display.StatusText);
    }

    // ── Fixed copy (loading / empty / error / retry / unlocked) ────────────────────────────────────────────

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading...", Project(AchievementBadgeModel.Loading()).LoadingLabel);

    [Fact]
    public void Empty_message_uses_the_lifetime_no_achievements_string() =>
        Assert.Equal(
            "Start driving to unlock achievements",
            Project(AchievementBadgeModel.Empty()).EmptyMessage);

    [Fact]
    public void Error_title_is_resolved() =>
        Assert.Equal("Failed to load data", Project(AchievementBadgeModel.Failed()).ErrorTitle);

    [Fact]
    public void Error_message_falls_back_to_the_default_when_none_supplied() =>
        Assert.Equal(
            "Check your internet connection and try again.",
            Project(AchievementBadgeModel.Failed()).ErrorMessage);

    [Fact]
    public void Error_message_uses_the_supplied_message() =>
        Assert.Equal(
            "Service unavailable",
            Project(AchievementBadgeModel.Failed("Service unavailable")).ErrorMessage);

    [Fact]
    public void Retry_label_uses_the_shared_common_retry_string() =>
        Assert.Equal("Retry", Project(AchievementBadgeModel.Failed()).RetryLabel);

    [Fact]
    public void Unlocked_caption_uses_the_web_lifetime_unlocked_key() =>
        Assert.Equal("lifetime.unlocked", AchievementBadgeProjection.UnlockedKey);

    // ── Accessibility: every state exposes a meaningful Narrator name ──────────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(AchievementBadgeModel.Loading()),
                Project(AchievementBadgeModel.Empty()),
                Project(AchievementBadgeModel.Failed()),
                Project(AchievementBadgeModel.Stale(Ach())),
                Project(AchievementBadgeModel.Offline(Ach())),
                Project(AchievementBadgeModel.Ready(Ach())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_is_the_loading_label() =>
        Assert.Equal("Loading...", Project(AchievementBadgeModel.Loading()).AutomationName);

    [Fact]
    public void Empty_automation_name_is_the_empty_message() =>
        Assert.Equal(
            "Start driving to unlock achievements",
            Project(AchievementBadgeModel.Empty()).AutomationName);

    [Fact]
    public void Error_automation_name_is_the_error_title() =>
        Assert.Equal("Failed to load data", Project(AchievementBadgeModel.Failed()).AutomationName);

    [Fact]
    public void Ready_automation_name_carries_name_description_and_status()
    {
        var display = Project(AchievementBadgeModel.Ready(
            Ach(unlocked: false, progress: 0.5, name: "Road Warrior", description: "Drive 1,000 km")));

        Assert.Equal("Road Warrior. Drive 1,000 km. 50%", display.AutomationName);
    }

    [Fact]
    public void Unlocked_automation_name_uses_the_unlocked_caption()
    {
        var display = Project(AchievementBadgeModel.Ready(
            Ach(unlocked: true, name: "First Drive", description: "Complete your first drive")));

        Assert.Equal("First Drive. Complete your first drive. \u2713 Unlocked", display.AutomationName);
    }

    [Fact]
    public void Stale_automation_name_includes_the_chip() =>
        Assert.Contains("Stale", Project(AchievementBadgeModel.Stale(Ach())).AutomationName, StringComparison.Ordinal);

    [Fact]
    public void Offline_automation_name_includes_the_chip() =>
        Assert.Contains(
            "Offline", Project(AchievementBadgeModel.Offline(Ach())).AutomationName, StringComparison.Ordinal);

    // ── Diagnostics (P1/S11): view.opened slug=AchievementBadge, PII-safe ──────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new AchievementBadgeDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AchievementBadge", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_the_achievement_content()
    {
        var captured = new List<string>();
        var diagnostics = new AchievementBadgeDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=AchievementBadge", line);
        Assert.DoesNotContain('%', line);
        Assert.DoesNotContain("Road Warrior", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("AchievementBadge", AchievementBadgeRegistration.Slug);

    // ── Argument validation ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => AchievementBadgeProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => AchievementBadgeProjection.Project(AchievementBadgeModel.Loading(), null!));

    [Fact]
    public void Ready_rejects_a_null_achievement() =>
        Assert.Throws<ArgumentNullException>(() => AchievementBadgeModel.Ready(null!));

    [Fact]
    public void Stale_rejects_a_null_achievement() =>
        Assert.Throws<ArgumentNullException>(() => AchievementBadgeModel.Stale(null!));

    [Fact]
    public void Offline_rejects_a_null_achievement() =>
        Assert.Throws<ArgumentNullException>(() => AchievementBadgeModel.Offline(null!));

    [Fact]
    public void Diagnostics_line_is_culture_invariant()
    {
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("tr-TR");
            var captured = new List<string>();
            new AchievementBadgeDiagnostics(captured.Add).RecordViewOpened();
            Assert.Equal("view.opened slug=AchievementBadge", Assert.Single(captured));
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }
}
