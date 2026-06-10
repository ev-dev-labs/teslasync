using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DrivingTips</c> feature surface's UI-thread-free logic — the
/// recommendation-selection data adapter (the web <c>useMemo</c> body), the per-state branch projection
/// (loading / error / empty / stale / offline / ready), the web average-power and thermal thresholds, the
/// shield-vs-triangle row icon, the freshness chip copy, the localized tip strings, the accessible names, and the
/// PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/driving-dynamics/DrivingTips.tsx + helpers.ts). The WinUI view itself
/// (DrivingTips.cs) is exercised by the app build.
/// </summary>
public sealed class DrivingTipsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The exact web tip strings (DrivingTips.tsx t(...) fallbacks). The em / en dashes are pinned by code point
    // so the parity assertion is unambiguous regardless of source-file encoding.
    private const string NoData = "Drive your vehicle to start collecting dynamics data.";
    private const string EaseAccel = "Ease into the accelerator \u2014 gradual inputs save energy and tire wear.";
    private const string BrakeEarly = "Brake earlier and lighter to improve regen capture.";
    private const string SmoothThrottle = "Smooth throttle transitions can improve efficiency by 10\u201315%.";
    private const string Coast = "Lift off the pedal earlier to let regen do the work.";
    private const string Great = "Excellent driving style! Maintaining this maximizes range and comfort.";
    private const string Keep = "Keep monitoring your scores \u2014 consistency is key.";
    private const string Thermal = "Motor temps are running high \u2014 consider easing off sustained high power.";

    // Mirrors the web __tests__ baseStats; avgPower / maxMotorTemp are the only fields DrivingTips reads.
    private static MotorEfficiencyStats Stats(double avgPowerKw = 0, double maxMotorTempCelsius = 64) => new(
        TotalReadings: 100,
        AvgTorqueNm: 50,
        MaxTorqueNm: 200,
        AvgMotorTempCelsius: 49,
        MaxMotorTempCelsius: maxMotorTempCelsius,
        AvgPowerKw: avgPowerKw,
        PeakPowerKw: 0,
        MinPowerKw: 0,
        PeakRegenKw: 0,
        HighTorquePct: 10);

    private static DrivingTipsDisplay Project(DrivingTipsModel model) =>
        DrivingTipsProjection.Project(model, Localizer);

    private static IReadOnlyList<string> TipTexts(DrivingTipsDisplay display)
    {
        var texts = new List<string>(display.Tips.Count);
        foreach (DrivingTipRow row in display.Tips)
        {
            texts.Add(row.Text);
        }

        return texts;
    }

    // ── Data adapter: the web useMemo recommendation selection ─────────────────────────────────────────────

    [Fact]
    public void Adapter_returns_only_the_no_data_tip_for_null_stats() =>
        Assert.Equal(new[] { DrivingTipKind.NoData }, DrivingTipsAdapter.Select(null));

    [Theory]
    [InlineData(80.01)]
    [InlineData(120)]
    [InlineData(500)]
    public void Adapter_high_power_selects_ease_and_brake(double avgPowerKw) =>
        Assert.Equal(
            new[] { DrivingTipKind.EaseAccel, DrivingTipKind.BrakeEarly },
            DrivingTipsAdapter.Select(Stats(avgPowerKw)));

    [Theory]
    [InlineData(20.01)]
    [InlineData(50)]
    [InlineData(80)] // web `avgPower > 80` is false at exactly 80 → falls to the moderate branch
    public void Adapter_moderate_power_selects_smooth_and_coast(double avgPowerKw) =>
        Assert.Equal(
            new[] { DrivingTipKind.SmoothThrottle, DrivingTipKind.Coast },
            DrivingTipsAdapter.Select(Stats(avgPowerKw)));

    [Theory]
    [InlineData(0)]
    [InlineData(20)] // web `avgPower > 20` is false at exactly 20 → falls to the great/keep branch
    public void Adapter_low_power_selects_great_and_keep(double avgPowerKw) =>
        Assert.Equal(
            new[] { DrivingTipKind.Great, DrivingTipKind.Keep },
            DrivingTipsAdapter.Select(Stats(avgPowerKw)));

    [Fact]
    public void Adapter_appends_thermal_tip_above_the_threshold() =>
        Assert.Equal(
            new[] { DrivingTipKind.Great, DrivingTipKind.Keep, DrivingTipKind.Thermal },
            DrivingTipsAdapter.Select(Stats(avgPowerKw: 0, maxMotorTempCelsius: 120.01)));

    [Fact]
    public void Adapter_does_not_append_thermal_tip_at_the_threshold() =>
        Assert.DoesNotContain(
            DrivingTipKind.Thermal,
            DrivingTipsAdapter.Select(Stats(avgPowerKw: 0, maxMotorTempCelsius: 120)));

    [Fact]
    public void Adapter_thermal_tip_rides_on_top_of_the_high_power_pair() =>
        Assert.Equal(
            new[] { DrivingTipKind.EaseAccel, DrivingTipKind.BrakeEarly, DrivingTipKind.Thermal },
            DrivingTipsAdapter.Select(Stats(avgPowerKw: 120, maxMotorTempCelsius: 150)));

    [Fact]
    public void Adapter_thresholds_match_the_web()
    {
        Assert.Equal(80, DrivingTipsAdapter.EaseThresholdKw, 3);
        Assert.Equal(20, DrivingTipsAdapter.SmoothThresholdKw, 3);
        Assert.Equal(120, DrivingTipsAdapter.ThermalTipCeilingCelsius, 3);
    }

    [Theory]
    [InlineData(DrivingTipKind.NoData, NoData)]
    [InlineData(DrivingTipKind.EaseAccel, EaseAccel)]
    [InlineData(DrivingTipKind.BrakeEarly, BrakeEarly)]
    [InlineData(DrivingTipKind.SmoothThrottle, SmoothThrottle)]
    [InlineData(DrivingTipKind.Coast, Coast)]
    [InlineData(DrivingTipKind.Great, Great)]
    [InlineData(DrivingTipKind.Keep, Keep)]
    [InlineData(DrivingTipKind.Thermal, Thermal)]
    public void Adapter_localizes_each_tip_to_the_web_string(DrivingTipKind kind, string expected) =>
        Assert.Equal(expected, DrivingTipsAdapter.Localize(kind, Localizer));

    // ── Branch precedence: loading → error → empty → freshness → ready ─────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(DrivingTipsState.Loading, Project(DrivingTipsModel.Loading()).State);

    [Fact]
    public void Error_when_model_failed() =>
        Assert.Equal(DrivingTipsState.Error, Project(DrivingTipsModel.Failed()).State);

    [Fact]
    public void Empty_when_model_is_empty() =>
        Assert.Equal(DrivingTipsState.Empty, Project(DrivingTipsModel.Empty()).State);

    [Fact]
    public void Ready_when_stats_present() =>
        Assert.Equal(DrivingTipsState.Ready, Project(DrivingTipsModel.Ready(Stats())).State);

    [Fact]
    public void Fresh_snapshot_with_no_stats_collapses_to_empty()
    {
        var model = new DrivingTipsModel(DrivingTipsState.Ready, null, null);
        Assert.Equal(DrivingTipsState.Empty, Project(model).State);
    }

    [Fact]
    public void Stale_keeps_its_branch_even_with_stats() =>
        Assert.Equal(DrivingTipsState.Stale, Project(DrivingTipsModel.Stale(Stats())).State);

    [Fact]
    public void Offline_keeps_its_branch_even_with_stats() =>
        Assert.Equal(DrivingTipsState.Offline, Project(DrivingTipsModel.Offline(Stats())).State);

    // ── Tip rows render in every data branch (never a blank box) ───────────────────────────────────────────

    [Fact]
    public void Empty_renders_the_single_no_data_row()
    {
        var display = Project(DrivingTipsModel.Empty());

        Assert.Equal(new[] { NoData }, TipTexts(display));
    }

    [Fact]
    public void Ready_high_power_renders_the_ease_and_brake_tips() =>
        Assert.Equal(
            new[] { EaseAccel, BrakeEarly },
            TipTexts(Project(DrivingTipsModel.Ready(Stats(avgPowerKw: 120)))));

    [Fact]
    public void Ready_moderate_power_renders_the_smooth_and_coast_tips() =>
        Assert.Equal(
            new[] { SmoothThrottle, Coast },
            TipTexts(Project(DrivingTipsModel.Ready(Stats(avgPowerKw: 50)))));

    [Fact]
    public void Ready_low_power_renders_the_great_and_keep_tips() =>
        Assert.Equal(
            new[] { Great, Keep },
            TipTexts(Project(DrivingTipsModel.Ready(Stats(avgPowerKw: 0)))));

    [Fact]
    public void Ready_appends_the_thermal_tip_when_motor_runs_hot() =>
        Assert.Equal(
            new[] { EaseAccel, BrakeEarly, Thermal },
            TipTexts(Project(DrivingTipsModel.Ready(Stats(avgPowerKw: 120, maxMotorTempCelsius: 150)))));

    [Fact]
    public void Offline_keeps_the_cached_tips() =>
        Assert.Equal(
            new[] { SmoothThrottle, Coast },
            TipTexts(Project(DrivingTipsModel.Offline(Stats(avgPowerKw: 50)))));

    [Fact]
    public void Stale_keeps_the_cached_tips() =>
        Assert.Equal(
            new[] { Great, Keep },
            TipTexts(Project(DrivingTipsModel.Stale(Stats(avgPowerKw: 0)))));

    // ── Row icon: web `throttleStyle === 'conservative' ? ShieldCheck : AlertTriangle` ─────────────────────

    [Fact]
    public void Conservative_drive_shows_the_shield_icon()
    {
        var display = Project(DrivingTipsModel.Ready(Stats(avgPowerKw: 0)));

        Assert.Equal(DrivingTipsRegistration.ShieldCheckGlyph, display.TipIconGlyph);
        Assert.Equal(StatusKind.Success, display.TipIconStatus);
    }

    [Theory]
    [InlineData(50)]  // moderate
    [InlineData(120)] // aggressive
    public void Non_conservative_drive_shows_the_warning_triangle(double avgPowerKw)
    {
        var display = Project(DrivingTipsModel.Ready(Stats(avgPowerKw)));

        Assert.Equal(DrivingTipsRegistration.AlertTriangleGlyph, display.TipIconGlyph);
        Assert.Equal(StatusKind.Warning, display.TipIconStatus);
    }

    [Fact]
    public void Explicit_conservative_style_wins_over_the_derived_one()
    {
        // web parent passes throttleStyle as a prop; an explicit value beats the power-derived default.
        var display = Project(DrivingTipsModel.Ready(Stats(avgPowerKw: 120), style: ThrottleStyle.Conservative));

        Assert.Equal(DrivingTipsRegistration.ShieldCheckGlyph, display.TipIconGlyph);
        Assert.Equal(StatusKind.Success, display.TipIconStatus);
    }

    [Fact]
    public void Empty_uses_the_warning_triangle_like_the_web_null_style()
    {
        // web: throttleStyle is null with no stats → not 'conservative' → AlertTriangle.
        var display = Project(DrivingTipsModel.Empty());

        Assert.Equal(DrivingTipsRegistration.AlertTriangleGlyph, display.TipIconGlyph);
        Assert.Equal(StatusKind.Warning, display.TipIconStatus);
    }

    [Theory]
    [InlineData(0, true)]      // < 20 conservative
    [InlineData(19.99, true)]
    [InlineData(20, false)]    // 20 is moderate (web getThrottleStyle `avgPower < 20`)
    [InlineData(120, false)]
    public void IsConservative_follows_the_web_throttle_style(double avgPowerKw, bool expected) =>
        Assert.Equal(expected, DrivingTipsProjection.IsConservative(Stats(avgPowerKw), null));

    // ── Title + freshness chip (stale / offline) ───────────────────────────────────────────────────────────

    [Fact]
    public void Title_resolves_from_the_facade() =>
        Assert.Equal("Driving Style Recommendations", Project(DrivingTipsModel.Ready(Stats())).Title);

    [Fact]
    public void Ready_has_no_freshness_chip() =>
        Assert.False(Project(DrivingTipsModel.Ready(Stats())).ShowFreshnessChip);

    [Fact]
    public void Stale_shows_a_warning_stale_chip()
    {
        var display = Project(DrivingTipsModel.Stale(Stats()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Stale", display.FreshnessChipText);
        Assert.Equal(StatusKind.Warning, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_shows_a_danger_offline_chip()
    {
        var display = Project(DrivingTipsModel.Offline(Stats()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Offline", display.FreshnessChipText);
        Assert.Equal(StatusKind.Danger, display.FreshnessChipStatus);
    }

    // ── Fixed copy (loading / error / retry) ───────────────────────────────────────────────────────────────

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading", Project(DrivingTipsModel.Loading()).LoadingLabel);

    [Fact]
    public void Error_title_is_resolved() =>
        Assert.Equal("Couldn't load recommendations", Project(DrivingTipsModel.Failed()).ErrorTitle);

    [Fact]
    public void Error_message_falls_back_to_the_default_when_none_supplied() =>
        Assert.Equal(
            "We couldn't load your driving recommendations. Please try again.",
            Project(DrivingTipsModel.Failed()).ErrorMessage);

    [Fact]
    public void Error_message_uses_the_supplied_message() =>
        Assert.Equal(
            "Network unreachable",
            Project(DrivingTipsModel.Failed("Network unreachable")).ErrorMessage);

    [Fact]
    public void Retry_label_uses_the_shared_common_retry_string() =>
        Assert.Equal("Retry", Project(DrivingTipsModel.Failed()).RetryLabel);

    // ── Accessibility: every state exposes a meaningful Narrator name ──────────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name() =>
        Assert.All(
            new[]
            {
                Project(DrivingTipsModel.Loading()),
                Project(DrivingTipsModel.Empty()),
                Project(DrivingTipsModel.Failed()),
                Project(DrivingTipsModel.Stale(Stats())),
                Project(DrivingTipsModel.Offline(Stats())),
                Project(DrivingTipsModel.Ready(Stats())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));

    [Fact]
    public void Loading_automation_name_pairs_the_title_and_loading_label()
    {
        var display = Project(DrivingTipsModel.Loading());

        Assert.Contains("Driving Style Recommendations", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Loading", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Error_automation_name_is_the_error_title() =>
        Assert.Equal("Couldn't load recommendations", Project(DrivingTipsModel.Failed()).AutomationName);

    [Fact]
    public void Ready_automation_name_carries_the_title_and_every_tip()
    {
        var display = Project(DrivingTipsModel.Ready(Stats(avgPowerKw: 120, maxMotorTempCelsius: 150)));

        Assert.Contains("Driving Style Recommendations", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(EaseAccel, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(BrakeEarly, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(Thermal, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_no_data_message() =>
        Assert.Contains(NoData, Project(DrivingTipsModel.Empty()).AutomationName, StringComparison.Ordinal);

    [Fact]
    public void Stale_automation_name_includes_the_chip() =>
        Assert.Contains("Stale", Project(DrivingTipsModel.Stale(Stats())).AutomationName, StringComparison.Ordinal);

    [Fact]
    public void Every_tip_row_carries_its_own_automation_name()
    {
        var display = Project(DrivingTipsModel.Ready(Stats(avgPowerKw: 50)));

        Assert.All(display.Tips, row => Assert.False(string.IsNullOrWhiteSpace(row.AutomationName)));
        Assert.Equal(SmoothThrottle, display.Tips[0].AutomationName);
    }

    // ── Diagnostics (P1/S11): view.opened slug=DrivingTips, PII-safe ──────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new DrivingTipsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DrivingTips", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_a_motor_reading()
    {
        var captured = new List<string>();
        var diagnostics = new DrivingTipsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=DrivingTips", line);
        Assert.DoesNotContain("kW", line, StringComparison.Ordinal);
        Assert.DoesNotContain('\u00B0', line);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("DrivingTips", DrivingTipsRegistration.Slug);

    [Fact]
    public void Registration_glyphs_match_the_established_segoe_fluent_mappings()
    {
        Assert.Equal("\uEA80", DrivingTipsRegistration.LightbulbGlyph);
        Assert.Equal("\uEA18", DrivingTipsRegistration.ShieldCheckGlyph);
        Assert.Equal("\uE7BA", DrivingTipsRegistration.AlertTriangleGlyph);
    }

    // ── Argument validation ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => DrivingTipsProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => DrivingTipsProjection.Project(DrivingTipsModel.Loading(), null!));

    [Fact]
    public void Adapter_localize_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => DrivingTipsAdapter.Localize(DrivingTipKind.NoData, null!));
}
