using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>HealthOverview</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / ready / empty / error / stale / offline), the web <c>HEALTH_GLOW</c> health→glow
/// mapping, the <c>healthBadgeVariant</c> / <c>getAlertVariant</c> tone mappings, the conditional temperature
/// alert, the verbatim score, the live motor-state line, the freshness chip, the accessible names, and the
/// PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/drivetrain-health/HealthOverview.tsx plus its constants / helpers). The
/// WinUI view itself is exercised by the app build.
/// </summary>
public sealed class HealthOverviewTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static HealthOverviewDisplay Project(HealthOverviewModel model) =>
        HealthOverviewProjection.Project(model, Localizer);

    // ── Branch precedence: parent lifecycle drives the state ──────────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(HealthOverviewState.Loading, Project(HealthOverviewModel.Loading).State);

    [Fact]
    public void Empty_when_model_is_empty() =>
        Assert.Equal(HealthOverviewState.Empty, Project(HealthOverviewModel.Empty).State);

    [Fact]
    public void Error_when_model_failed() =>
        Assert.Equal(HealthOverviewState.Error, Project(HealthOverviewModel.Failed()).State);

    [Fact]
    public void Ready_when_model_is_ready() =>
        Assert.Equal(
            HealthOverviewState.Ready,
            Project(HealthOverviewModel.Ready(DrivetrainHealth.Good, 95, "Drive")).State);

    [Fact]
    public void Stale_when_model_is_stale() =>
        Assert.Equal(
            HealthOverviewState.Stale,
            Project(HealthOverviewModel.Stale(DrivetrainHealth.Warning, 60, "Park")).State);

    [Fact]
    public void Offline_when_model_is_offline() =>
        Assert.Equal(
            HealthOverviewState.Offline,
            Project(HealthOverviewModel.Offline(DrivetrainHealth.Critical, 25, "Park")).State);

    // ── Glow: the web HEALTH_GLOW (good→green, warning→cyan, critical→purple) ──────────────────────────

    [Theory]
    [InlineData(DrivetrainHealth.Good, HealthOverviewGlow.Green)]
    [InlineData(DrivetrainHealth.Warning, HealthOverviewGlow.Cyan)]
    [InlineData(DrivetrainHealth.Critical, HealthOverviewGlow.Purple)]
    public void Glow_follows_the_web_health_glow_map(DrivetrainHealth health, HealthOverviewGlow expected)
    {
        Assert.Equal(expected, HealthOverviewProjection.GlowFor(health));
        Assert.Equal(expected, Project(HealthOverviewModel.Ready(health, 50, "Drive")).Glow);
    }

    [Fact]
    public void Glow_is_resolved_in_every_state()
    {
        Assert.Equal(HealthOverviewGlow.Green, Project(HealthOverviewModel.Loading).Glow);
        Assert.Equal(
            HealthOverviewGlow.Purple,
            Project(HealthOverviewModel.Offline(DrivetrainHealth.Critical, 25, "Park")).Glow);
    }

    // ── Accent + badge tone: the web healthBadgeVariant (good→success, warning→warning, critical→danger) ──

    [Theory]
    [InlineData(DrivetrainHealth.Good, StatusKind.Success)]
    [InlineData(DrivetrainHealth.Warning, StatusKind.Warning)]
    [InlineData(DrivetrainHealth.Critical, StatusKind.Danger)]
    public void Badge_tone_follows_the_web_health_badge_variant(DrivetrainHealth health, StatusKind expected)
    {
        Assert.Equal(expected, HealthOverviewProjection.BadgeStatusFor(health));
        Assert.Equal(expected, Project(HealthOverviewModel.Ready(health, 50, "Drive")).BadgeStatus);
    }

    [Theory]
    [InlineData(DrivetrainHealth.Good, "TsColorSuccessBrush")]
    [InlineData(DrivetrainHealth.Warning, "TsColorWarningBrush")]
    [InlineData(DrivetrainHealth.Critical, "TsColorDangerBrush")]
    public void Accent_key_follows_the_health_tone(DrivetrainHealth health, string expectedBrushKey) =>
        Assert.Equal(expectedBrushKey, Project(HealthOverviewModel.Ready(health, 50, "Drive")).HealthAccentKey);

    [Fact]
    public void Healthy_uses_the_check_icon_others_use_the_warning_icon()
    {
        Assert.True(Project(HealthOverviewModel.Ready(DrivetrainHealth.Good, 95, "Drive")).IsHealthy);
        Assert.False(Project(HealthOverviewModel.Ready(DrivetrainHealth.Warning, 60, "Park")).IsHealthy);
        Assert.False(Project(HealthOverviewModel.Ready(DrivetrainHealth.Critical, 25, "Park")).IsHealthy);
    }

    // ── Conditional alert: web overallHealth !== 'good' && getAlertVariant ─────────────────────────────

    [Fact]
    public void Alert_is_hidden_when_healthy() =>
        Assert.False(Project(HealthOverviewModel.Ready(DrivetrainHealth.Good, 95, "Drive")).ShowAlert);

    [Fact]
    public void Alert_is_shown_when_warm_or_overheating()
    {
        Assert.True(Project(HealthOverviewModel.Ready(DrivetrainHealth.Warning, 60, "Park")).ShowAlert);
        Assert.True(Project(HealthOverviewModel.Ready(DrivetrainHealth.Critical, 25, "Park")).ShowAlert);
    }

    [Fact]
    public void Alert_is_hidden_outside_content_states_even_when_unhealthy()
    {
        // A non-content (loading) state never surfaces the temperature banner, even with a warning health.
        var display = Project(new HealthOverviewModel(HealthOverviewState.Loading, DrivetrainHealth.Warning, 60, "Park"));
        Assert.False(display.ShowAlert);
    }

    [Theory]
    [InlineData(DrivetrainHealth.Warning, CalloutVariant.Warning)]
    [InlineData(DrivetrainHealth.Critical, CalloutVariant.Danger)]
    public void Alert_variant_follows_the_web_get_alert_variant(DrivetrainHealth health, CalloutVariant expected)
    {
        Assert.Equal(expected, HealthOverviewProjection.AlertVariantFor(health));
        Assert.Equal(expected, Project(HealthOverviewModel.Ready(health, 50, "Park")).AlertVariant);
    }

    [Fact]
    public void Alert_title_and_message_match_the_warning_copy()
    {
        var display = Project(HealthOverviewModel.Ready(DrivetrainHealth.Warning, 60, "Park"));
        Assert.Equal("Elevated Temperatures Detected", display.AlertTitle);
        Assert.Equal(
            "Drivetrain temperatures are above normal operating range. Monitor closely and consider reducing load.",
            display.AlertMessage);
    }

    [Fact]
    public void Alert_title_and_message_match_the_critical_copy()
    {
        var display = Project(HealthOverviewModel.Ready(DrivetrainHealth.Critical, 25, "Park"));
        Assert.Equal("Critical Temperature Warning", display.AlertTitle);
        Assert.Equal(
            "One or more drivetrain components are operating at critically high temperatures. Immediate attention is recommended.",
            display.AlertMessage);
    }

    // ── Health headline + badge label ─────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(DrivetrainHealth.Good, "Drivetrain Healthy")]
    [InlineData(DrivetrainHealth.Warning, "Drivetrain Running Warm")]
    [InlineData(DrivetrainHealth.Critical, "Drivetrain Overheating")]
    public void Health_headline_matches_the_web_copy(DrivetrainHealth health, string expected) =>
        Assert.Equal(expected, Project(HealthOverviewModel.Ready(health, 50, "Drive")).HealthTitle);

    [Theory]
    [InlineData(DrivetrainHealth.Good, "GOOD")]
    [InlineData(DrivetrainHealth.Warning, "WARNING")]
    [InlineData(DrivetrainHealth.Critical, "CRITICAL")]
    public void Badge_label_uses_the_uppercase_fallback(DrivetrainHealth health, string expected) =>
        Assert.Equal(expected, Project(HealthOverviewModel.Ready(health, 50, "Drive")).BadgeLabel);

    // ── Score: rendered verbatim with a percent suffix (web AnimatedNumber value + suffix) ─────────────

    [Fact]
    public void Score_is_passed_through_for_the_animated_number()
    {
        var display = Project(HealthOverviewModel.Ready(DrivetrainHealth.Good, 95, "Drive"));
        Assert.Equal(95, display.HealthScore);
        Assert.Equal("95%", display.HealthScoreText);
    }

    [Fact]
    public void Score_text_is_rounded_to_a_whole_percent()
    {
        Assert.Equal("60%", Project(HealthOverviewModel.Ready(DrivetrainHealth.Warning, 60, "Park")).HealthScoreText);
        Assert.Equal("25%", Project(HealthOverviewModel.Ready(DrivetrainHealth.Critical, 25, "Park")).HealthScoreText);
    }

    // ── Motor state line ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Motor_state_line_prefixes_the_localized_label() =>
        Assert.Equal(
            "Motor State: Drive",
            Project(HealthOverviewModel.Ready(DrivetrainHealth.Good, 95, "Drive")).MotorStateText);

    [Fact]
    public void Motor_state_line_trims_the_value() =>
        Assert.Equal(
            "Motor State: D",
            Project(HealthOverviewModel.Ready(DrivetrainHealth.Good, 95, "  D  ")).MotorStateText);

    [Fact]
    public void Motor_state_line_falls_back_to_an_em_dash_when_unknown()
    {
        Assert.Equal(
            "Motor State: \u2014",
            Project(HealthOverviewModel.Ready(DrivetrainHealth.Good, 95, string.Empty)).MotorStateText);
        Assert.Equal(
            "Motor State: \u2014",
            Project(HealthOverviewModel.Ready(DrivetrainHealth.Good, 95, "   ")).MotorStateText);
    }

    // ── Freshness chip (stale / offline only) ─────────────────────────────────────────────────────────

    [Fact]
    public void Freshness_chip_is_hidden_for_a_fresh_snapshot() =>
        Assert.False(Project(HealthOverviewModel.Ready(DrivetrainHealth.Good, 95, "Drive")).ShowFreshnessChip);

    [Fact]
    public void Stale_snapshot_shows_a_warning_stale_chip()
    {
        var display = Project(HealthOverviewModel.Stale(DrivetrainHealth.Good, 95, "Drive"));
        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Stale", display.FreshnessChipText);
        Assert.Equal(StatusKind.Warning, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_snapshot_shows_a_danger_offline_chip()
    {
        var display = Project(HealthOverviewModel.Offline(DrivetrainHealth.Critical, 25, "Park"));
        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Offline", display.FreshnessChipText);
        Assert.Equal(StatusKind.Danger, display.FreshnessChipStatus);
    }

    // ── Shared empty / loading / error copy + freshness passthrough ────────────────────────────────────

    [Fact]
    public void Empty_message_uses_the_drivetrain_no_data_fallback() =>
        Assert.Equal("No drivetrain data available", Project(HealthOverviewModel.Empty).EmptyMessage);

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_fallback() =>
        Assert.Equal("Loading", Project(HealthOverviewModel.Loading).LoadingLabel);

    [Fact]
    public void Error_uses_the_default_title_message_and_retry()
    {
        var display = Project(HealthOverviewModel.Failed());
        Assert.Equal("Couldn't load drivetrain health", display.ErrorTitle);
        Assert.Equal("We couldn't load drivetrain health right now. Please try again.", display.ErrorMessage);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void Error_prefers_the_model_supplied_message()
    {
        var display = Project(HealthOverviewModel.Failed("Sensor bus offline"));
        Assert.Equal("Sensor bus offline", display.ErrorMessage);
    }

    [Fact]
    public void Freshness_timestamp_and_fetching_flag_are_passed_through()
    {
        var now = DateTimeOffset.UnixEpoch;
        var display = Project(HealthOverviewModel.Ready(DrivetrainHealth.Good, 95, "Drive", now, isFetching: true));
        Assert.Equal(now, display.UpdatedAt);
        Assert.True(display.IsFetching);
    }

    // ── Accessibility: every state exposes a meaningful Narrator name ──────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(HealthOverviewModel.Loading),
                Project(HealthOverviewModel.Empty),
                Project(HealthOverviewModel.Failed()),
                Project(HealthOverviewModel.Ready(DrivetrainHealth.Good, 95, "Drive")),
                Project(HealthOverviewModel.Stale(DrivetrainHealth.Warning, 60, "Park")),
                Project(HealthOverviewModel.Offline(DrivetrainHealth.Critical, 25, "Park")),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_is_the_loading_label() =>
        Assert.Equal("Loading", Project(HealthOverviewModel.Loading).AutomationName);

    [Fact]
    public void Empty_automation_name_is_the_empty_message() =>
        Assert.Equal("No drivetrain data available", Project(HealthOverviewModel.Empty).AutomationName);

    [Fact]
    public void Error_automation_name_is_the_error_title() =>
        Assert.Equal("Couldn't load drivetrain health", Project(HealthOverviewModel.Failed()).AutomationName);

    [Fact]
    public void Healthy_ready_automation_name_omits_the_alert_and_chip() =>
        Assert.Equal(
            "Drivetrain Healthy. Motor State: Drive. GOOD. 95%",
            Project(HealthOverviewModel.Ready(DrivetrainHealth.Good, 95, "Drive")).AutomationName);

    [Fact]
    public void Warm_ready_automation_name_carries_the_alert_title() =>
        Assert.Equal(
            "Elevated Temperatures Detected. Drivetrain Running Warm. Motor State: Park. WARNING. 60%",
            Project(HealthOverviewModel.Ready(DrivetrainHealth.Warning, 60, "Park")).AutomationName);

    [Fact]
    public void Stale_automation_name_leads_with_the_freshness_chip() =>
        Assert.Equal(
            "Stale. Drivetrain Healthy. Motor State: Drive. GOOD. 95%",
            Project(HealthOverviewModel.Stale(DrivetrainHealth.Good, 95, "Drive")).AutomationName);

    [Fact]
    public void Offline_critical_automation_name_carries_chip_alert_and_score() =>
        Assert.Equal(
            "Offline. Critical Temperature Warning. Drivetrain Overheating. Motor State: Park. CRITICAL. 25%",
            Project(HealthOverviewModel.Offline(DrivetrainHealth.Critical, 25, "Park")).AutomationName);

    // ── Diagnostics (P1/S11): view.opened slug=HealthOverview, PII-safe ────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new HealthOverviewDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=HealthOverview", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_the_health_score_or_motor_state()
    {
        var captured = new List<string>();
        var diagnostics = new HealthOverviewDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=HealthOverview", line);
        Assert.DoesNotContain('%', line);
        Assert.DoesNotContain("Motor State", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("HealthOverview", HealthOverviewRegistration.Slug);

    [Fact]
    public void Registration_exposes_distinct_health_and_warning_glyphs() =>
        Assert.NotEqual(HealthOverviewRegistration.HealthyGlyph, HealthOverviewRegistration.WarningGlyph);

    // ── Argument validation ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => HealthOverviewProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => HealthOverviewProjection.Project(HealthOverviewModel.Loading, null!));
}
