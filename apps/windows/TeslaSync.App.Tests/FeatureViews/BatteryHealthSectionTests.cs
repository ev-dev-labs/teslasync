using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>BatteryHealthSection</c> feature surface's UI-thread-free logic — the
/// per-state branch projection (loading / error / empty / stale / offline / ready), the web BatteryPill level
/// rounding + colour threshold + bar fraction, the three mini-stats' <c>fmtNumber</c> / <c>fmtInt</c>
/// formatting (including the verbatim <c>chargeEnergyAdded * 5.5</c> km range heuristic), the freshness chip
/// copy, the accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/analytics/components/weekly-digest/BatteryHealthSection.tsx). The WinUI view itself
/// (BatteryHealthSection.cs) is exercised by the app build.
/// </summary>
public sealed class BatteryHealthSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static BatteryHealthSectionModel Ready(
        double start = 64,
        double end = 80,
        double energy = 100,
        long sessions = 12) =>
        BatteryHealthSectionModel.Ready(start, end, energy, sessions);

    private static BatteryHealthSectionDisplay Project(BatteryHealthSectionModel model) =>
        BatteryHealthSectionProjection.Project(model, Localizer);

    // ── Branch precedence: loading → error → empty → freshness → ready ─────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(BatteryHealthSectionState.Loading, Project(BatteryHealthSectionModel.Loading).State);

    [Fact]
    public void Error_when_model_failed() =>
        Assert.Equal(BatteryHealthSectionState.Error, Project(BatteryHealthSectionModel.Failed()).State);

    [Fact]
    public void Empty_when_model_is_empty() =>
        Assert.Equal(BatteryHealthSectionState.Empty, Project(BatteryHealthSectionModel.Empty).State);

    [Fact]
    public void Ready_when_charge_sessions_present() =>
        Assert.Equal(BatteryHealthSectionState.Ready, Project(Ready(sessions: 5)).State);

    [Fact]
    public void Fresh_snapshot_with_no_sessions_collapses_to_empty()
    {
        // Battery health is derived entirely from charging activity — a fresh snapshot with zero charge
        // sessions has no story to summarise, so the section shows its friendly empty state.
        Assert.Equal(BatteryHealthSectionState.Empty, Project(Ready(sessions: 0)).State);
    }

    [Fact]
    public void Stale_keeps_its_branch_even_with_no_sessions()
    {
        // Freshness wins over emptiness: a stale cached snapshot keeps its chip rather than reclassifying.
        Assert.Equal(
            BatteryHealthSectionState.Stale,
            Project(BatteryHealthSectionModel.Stale(0, 0, 0, 0)).State);
    }

    [Fact]
    public void Offline_keeps_its_branch_even_with_no_sessions() =>
        Assert.Equal(
            BatteryHealthSectionState.Offline,
            Project(BatteryHealthSectionModel.Offline(0, 0, 0, 0)).State);

    // ── Battery pills: web BatteryPill (level rounding, colour threshold, bar fraction) ────────────────

    [Fact]
    public void Pills_are_the_start_then_end_average()
    {
        var pills = Project(Ready(start: 64, end: 80)).Pills;

        Assert.Collection(
            pills,
            p => Assert.Equal("Avg Battery at Charge Start", p.Label),
            p => Assert.Equal("Avg Battery at Charge End", p.Label));
    }

    [Fact]
    public void Pill_level_text_rounds_then_appends_percent()
    {
        var pills = Project(Ready(start: 64.4, end: 80.6)).Pills;

        Assert.Equal("64%", pills[0].LevelText); // 64.4 → 64
        Assert.Equal("81%", pills[1].LevelText); // 80.6 → 81
    }

    [Fact]
    public void Pill_level_rounds_half_away_from_zero()
    {
        Assert.Equal("65%", Project(Ready(start: 64.5)).Pills[0].LevelText);
    }

    [Theory]
    [InlineData(85, StatusKind.Success)]
    [InlineData(60, StatusKind.Success)]
    [InlineData(59, StatusKind.Warning)]
    [InlineData(30, StatusKind.Warning)]
    [InlineData(29, StatusKind.Danger)]
    [InlineData(0, StatusKind.Danger)]
    public void Pill_status_follows_the_web_threshold(double level, StatusKind expected)
    {
        Assert.Equal(expected, Project(Ready(start: level)).Pills[0].Status);
    }

    [Fact]
    public void Pill_bar_fraction_is_level_over_one_hundred()
    {
        Assert.Equal(0.64, Project(Ready(start: 64)).Pills[0].BarFraction, 3);
    }

    [Fact]
    public void Pill_bar_fraction_clamps_at_full()
    {
        // web Math.min(level, 100) — an over-100 share never overflows the bar.
        Assert.Equal(1.0, Project(Ready(start: 120)).Pills[0].BarFraction, 3);
    }

    [Fact]
    public void Pill_bar_fraction_is_zero_for_zero_level()
    {
        Assert.Equal(0.0, Project(Ready(start: 0)).Pills[0].BarFraction, 3);
    }

    [Fact]
    public void Pill_automation_name_carries_label_and_level()
    {
        Assert.Equal("Avg Battery at Charge Start, 64%", Project(Ready(start: 64)).Pills[0].AutomationName);
    }

    // ── Mini-stats: web MiniStat (charge gain, sessions, est. range added) ─────────────────────────────

    [Fact]
    public void Stats_are_gain_sessions_then_range_in_web_order()
    {
        var stats = Project(Ready()).Stats;

        Assert.Collection(
            stats,
            s => Assert.Equal(BatteryHealthStatKind.ChargeGain, s.Kind),
            s => Assert.Equal(BatteryHealthStatKind.ChargeSessions, s.Kind),
            s => Assert.Equal(BatteryHealthStatKind.RangeAdded, s.Kind));
    }

    [Fact]
    public void Stat_labels_resolve_from_the_facade()
    {
        var stats = Project(Ready()).Stats;

        Assert.Equal("Avg Charge Gain", stats[0].Label);
        Assert.Equal("Charge Sessions", stats[1].Label);
        Assert.Equal("Est. Range Added", stats[2].Label);
    }

    [Fact]
    public void Charge_gain_is_end_minus_start_to_one_decimal()
    {
        Assert.Equal("16.0%", Project(Ready(start: 64, end: 80)).Stats[0].Value);
    }

    [Fact]
    public void Charge_gain_can_be_negative()
    {
        Assert.Equal("-5.5%", Project(Ready(start: 70, end: 64.5)).Stats[0].Value);
    }

    [Fact]
    public void Charge_sessions_value_groups_thousands_like_fmtInt()
    {
        Assert.Equal("1,234", Project(Ready(sessions: 1234)).Stats[1].Value);
    }

    [Fact]
    public void Est_range_added_multiplies_energy_by_the_web_factor_and_appends_km()
    {
        // web: fmtNumber(metrics.chargeEnergyAdded * 5.5, 0) km
        Assert.Equal("550 km", Project(Ready(energy: 100)).Stats[2].Value); // 100 * 5.5 = 550
    }

    [Fact]
    public void Est_range_added_groups_thousands()
    {
        Assert.Equal("5,500 km", Project(Ready(energy: 1000)).Stats[2].Value); // 1000 * 5.5 = 5500
    }

    [Fact]
    public void Stat_automation_name_carries_label_and_value()
    {
        Assert.Equal("Charge Sessions, 12", Project(Ready(sessions: 12)).Stats[1].AutomationName);
    }

    [Fact]
    public void Range_factor_is_the_web_constant() =>
        Assert.Equal(5.5, BatteryHealthSectionProjection.RangeKilometersPerEnergyUnit, 3);

    // ── Title + freshness chip ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Title_resolves_from_the_facade() =>
        Assert.Equal("Battery Health", Project(Ready()).Title);

    [Fact]
    public void Ready_has_no_freshness_chip()
    {
        var display = Project(Ready());

        Assert.False(display.ShowFreshnessChip);
    }

    [Fact]
    public void Stale_shows_a_warning_stale_chip()
    {
        var display = Project(BatteryHealthSectionModel.Stale(64, 80, 100, 12));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Stale", display.FreshnessChipText);
        Assert.Equal(StatusKind.Warning, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_shows_a_danger_offline_chip()
    {
        var display = Project(BatteryHealthSectionModel.Offline(64, 80, 100, 12));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Offline", display.FreshnessChipText);
        Assert.Equal(StatusKind.Danger, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_keeps_the_cached_pills_and_stats()
    {
        var display = Project(BatteryHealthSectionModel.Offline(64, 80, 100, 12));

        Assert.Equal("64%", display.Pills[0].LevelText);
        Assert.Equal("550 km", display.Stats[2].Value);
    }

    // ── Fixed copy (loading / empty / error / retry) ───────────────────────────────────────────────────

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading", Project(BatteryHealthSectionModel.Loading).LoadingLabel);

    [Fact]
    public void Empty_message_is_a_friendly_battery_specific_string() =>
        Assert.Equal(
            "No charge sessions to summarize this week",
            Project(BatteryHealthSectionModel.Empty).EmptyMessage);

    [Fact]
    public void Error_title_is_resolved() =>
        Assert.Equal("Couldn't load battery health", Project(BatteryHealthSectionModel.Failed()).ErrorTitle);

    [Fact]
    public void Error_message_falls_back_to_the_default_when_none_supplied() =>
        Assert.Equal(
            "We couldn't load battery health for this week. Please try again.",
            Project(BatteryHealthSectionModel.Failed()).ErrorMessage);

    [Fact]
    public void Error_message_uses_the_supplied_message() =>
        Assert.Equal("Network unreachable", Project(BatteryHealthSectionModel.Failed("Network unreachable")).ErrorMessage);

    [Fact]
    public void Retry_label_uses_the_shared_common_retry_string() =>
        Assert.Equal("Retry", Project(BatteryHealthSectionModel.Failed()).RetryLabel);

    // ── Accessibility: every state exposes a meaningful Narrator name ──────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(BatteryHealthSectionModel.Loading),
                Project(BatteryHealthSectionModel.Empty),
                Project(BatteryHealthSectionModel.Failed()),
                Project(BatteryHealthSectionModel.Stale(64, 80, 100, 12)),
                Project(BatteryHealthSectionModel.Offline(64, 80, 100, 12)),
                Project(Ready()),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_pairs_the_title_and_loading_label() =>
        Assert.Equal("Battery Health. Loading", Project(BatteryHealthSectionModel.Loading).AutomationName);

    [Fact]
    public void Empty_automation_name_pairs_the_title_and_empty_message() =>
        Assert.Equal(
            "Battery Health. No charge sessions to summarize this week",
            Project(BatteryHealthSectionModel.Empty).AutomationName);

    [Fact]
    public void Error_automation_name_pairs_the_title_and_error_title() =>
        Assert.Equal(
            "Battery Health. Couldn't load battery health",
            Project(BatteryHealthSectionModel.Failed()).AutomationName);

    [Fact]
    public void Ready_automation_name_carries_title_pills_and_stats()
    {
        var display = Project(Ready(start: 64, end: 80, energy: 100, sessions: 12));

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        foreach (var pill in display.Pills)
        {
            Assert.Contains(pill.AutomationName, display.AutomationName, StringComparison.Ordinal);
        }

        foreach (var stat in display.Stats)
        {
            Assert.Contains(stat.AutomationName, display.AutomationName, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Stale_automation_name_includes_the_chip()
    {
        var display = Project(BatteryHealthSectionModel.Stale(64, 80, 100, 12));

        Assert.Contains("Stale", display.AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=BatteryHealthSection, PII-safe ──────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new BatteryHealthSectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BatteryHealthSection", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_battery_behaviour()
    {
        var captured = new List<string>();
        var diagnostics = new BatteryHealthSectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=BatteryHealthSection", line);
        Assert.DoesNotContain('%', line);
        Assert.DoesNotContain("km", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("BatteryHealthSection", BatteryHealthSectionRegistration.Slug);

    // ── Argument validation ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => BatteryHealthSectionProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => BatteryHealthSectionProjection.Project(BatteryHealthSectionModel.Loading, null!));
}
