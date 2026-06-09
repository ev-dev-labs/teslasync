using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ChargingSessionCard</c> feature surface's UI-thread-free logic — the ported
/// charging maths (<c>getChargerCategory</c> / <c>durationMinutes</c> / <c>avgPowerW</c> / <c>costPerKwh</c> /
/// <c>distanceAddedM</c> / <c>formatDurationMinutes</c> / the inline battery-friendly score), the branch projection
/// (loading / empty / ready), the charger badge variant + glow, the energy / free / anomaly badges, the
/// single-endpoint route, the comfortable-only metric chips, the accessible names and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/features/charging/components/ChargingSessionCard.tsx). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class ChargingSessionCardTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static ChargingSessionSnapshot Session(
        long id = 1,
        string? chargerType = "Tesla Supercharger",
        double? energyWh = 42000,
        double? cost = 12.6,
        double? peakW = 150000,
        double? avgW = null,
        double? startSoc = 20,
        double? endSoc = 70,
        double? startOdoM = 1_000_000,
        double? endOdoM = 1_016_093.44,
        string? place = "Gilroy Supercharger",
        double? lat = null,
        double? lon = null,
        bool ended = true) =>
        new(
            id,
            new DateTimeOffset(2026, 1, 2, 10, 0, 0, TimeSpan.Zero),
            ended ? new DateTimeOffset(2026, 1, 2, 11, 30, 0, TimeSpan.Zero) : null,
            chargerType,
            energyWh,
            cost,
            peakW,
            avgW,
            startSoc,
            endSoc,
            startOdoM,
            endOdoM,
            place,
            lat,
            lon);

    private static ChargingSessionCardDisplay Project(
        ChargingSessionSnapshot? session,
        bool selectable = false,
        bool selected = false,
        string? anomaly = null,
        ChargingCardDensity density = ChargingCardDensity.Comfortable,
        DistanceUnit unit = DistanceUnit.Mi,
        bool loading = false) =>
        ChargingSessionCardProjection.Project(
            new ChargingSessionCardModel(loading, session, selectable, selected, anomaly, density, unit),
            Localizer);

    // ── Ported charger category (web getChargerCategory) ─────────────────────────────────────────────────

    [Theory]
    [InlineData(null, ChargerCategory.Home)]
    [InlineData("", ChargerCategory.Home)]
    [InlineData("Tesla Supercharger", ChargerCategory.Supercharger)]
    [InlineData("TPC", ChargerCategory.Supercharger)]
    [InlineData("CCS", ChargerCategory.Dc)]
    [InlineData("CHAdeMO", ChargerCategory.Dc)]
    [InlineData("DC Fast", ChargerCategory.Dc)]
    [InlineData("Home", ChargerCategory.Home)]
    [InlineData("Wall Connector", ChargerCategory.Home)]
    [InlineData("Mystery", ChargerCategory.Unknown)]
    public void Category_maps_like_the_web(string? type, ChargerCategory expected) =>
        Assert.Equal(expected, ChargingSessionMath.CategoryOf(type));

    // ── Ported session maths ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void DurationMinutes_is_zero_for_an_in_progress_session() =>
        Assert.Equal(0, ChargingSessionMath.DurationMinutes(Session(ended: false)));

    [Fact]
    public void DurationMinutes_computes_the_fractional_span()
    {
        var s = Session() with
        {
            StartedAt = new DateTimeOffset(2026, 1, 2, 10, 0, 0, TimeSpan.Zero),
            EndedAt = new DateTimeOffset(2026, 1, 2, 10, 45, 30, TimeSpan.Zero),
        };
        Assert.Equal(45.5, ChargingSessionMath.DurationMinutes(s), 3);
    }

    [Fact]
    public void AvgPowerW_prefers_energy_over_elapsed_hours() =>
        Assert.Equal(28000, ChargingSessionMath.AvgPowerW(Session()), 3);

    [Fact]
    public void AvgPowerW_falls_back_to_the_api_value() =>
        Assert.Equal(5000, ChargingSessionMath.AvgPowerW(Session(ended: false, avgW: 5000)));

    [Fact]
    public void CostPerKwh_is_cost_over_kwh() =>
        Assert.Equal(0.3, ChargingSessionMath.CostPerKwh(Session())!.Value, 4);

    [Theory]
    [InlineData(0, 12.6)]
    [InlineData(42000, 0)]
    public void CostPerKwh_is_null_when_free_or_zero_energy(double energy, double cost) =>
        Assert.Null(ChargingSessionMath.CostPerKwh(Session(energyWh: energy, cost: cost == 0 ? null : cost)));

    [Fact]
    public void DistanceAddedM_is_the_positive_odometer_delta() =>
        Assert.Equal(16093.44, ChargingSessionMath.DistanceAddedM(Session())!.Value, 2);

    [Fact]
    public void DistanceAddedM_is_null_without_both_readings() =>
        Assert.Null(ChargingSessionMath.DistanceAddedM(Session(startOdoM: null)));

    [Theory]
    [InlineData(20, 70, 100)]   // start low + stop in sweet spot
    [InlineData(25, 100, 55)]   // charged to 100 % is penalised
    [InlineData(80, 85, 40)]    // started high
    [InlineData(60, 95, 40)]    // mid start + over 90 %
    public void BatteryFriendlyScore_ports_the_heuristic(double start, double end, double expected) =>
        Assert.Equal(expected, ChargingSessionMath.BatteryFriendlyScore(start, end)!.Value);

    [Fact]
    public void BatteryFriendlyScore_is_null_without_both_endpoints() =>
        Assert.Null(ChargingSessionMath.BatteryFriendlyScore(20, null));

    [Theory]
    [InlineData(90, "1h 30m")]
    [InlineData(45, "45m")]
    [InlineData(45.5, "46m")]
    [InlineData(125, "2h 5m")]
    [InlineData(0, "0m")]
    public void FormatDurationMinutes_ports_the_web_formatter(double minutes, string expected) =>
        Assert.Equal(expected, ChargingSessionMath.FormatDurationMinutes(minutes));

    [Theory]
    [InlineData(-1)]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public void FormatDurationMinutes_is_the_em_dash_for_bad_input(double minutes) =>
        Assert.Equal("\u2014", ChargingSessionMath.FormatDurationMinutes(minutes));

    // ── Branch precedence: loading → empty → ready ──────────────────────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(ChargingSessionCardState.Loading, Project(Session(), loading: true).State);

    [Fact]
    public void Loading_takes_precedence_over_a_present_session() =>
        Assert.Equal(
            ChargingSessionCardState.Loading,
            ChargingSessionCardProjection.Project(ChargingSessionCardModel.Pending with { Session = Session() }, Localizer).State);

    [Fact]
    public void Empty_when_no_session() =>
        Assert.Equal(ChargingSessionCardState.Empty, Project(null).State);

    [Fact]
    public void Ready_when_a_session_is_present() =>
        Assert.Equal(ChargingSessionCardState.Ready, Project(Session()).State);

    // ── Charger badge + glow ────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("Tesla Supercharger", "Supercharger", StatusKind.Danger, ChargingCardGlow.Cyan)]
    [InlineData("CCS", "DC Fast", StatusKind.Warning, ChargingCardGlow.Green)]
    [InlineData("Home", "Home / AC", StatusKind.Success, ChargingCardGlow.Green)]
    [InlineData("Mystery", "Charger", StatusKind.Success, ChargingCardGlow.Green)]
    public void Charger_badge_and_glow_follow_the_category(
        string type, string label, StatusKind status, ChargingCardGlow glow)
    {
        var display = Project(Session(chargerType: type));

        Assert.Equal(label, display.ChargerLabel);
        Assert.Equal(status, display.ChargerStatus);
        Assert.Equal(glow, display.Glow);
    }

    [Fact]
    public void Null_charger_type_is_home_ac() =>
        Assert.Equal("Home / AC", Project(Session(chargerType: null)).ChargerLabel);

    // ── Energy / free / anomaly badges ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Energy_badge_is_shown_with_kwh()
    {
        var display = Project(Session());

        Assert.True(display.HasEnergyBadge);
        Assert.Equal("42.00 kWh", display.EnergyBadgeText);
    }

    [Fact]
    public void Energy_badge_is_hidden_for_zero_energy() =>
        Assert.False(Project(Session(energyWh: 0)).HasEnergyBadge);

    [Fact]
    public void Free_badge_shows_for_a_zero_cost_charge_with_energy()
    {
        var display = Project(Session(chargerType: "Home", cost: null));

        Assert.True(display.HasFreeBadge);
        Assert.Equal("Free", display.FreeLabel);
    }

    [Fact]
    public void Free_badge_is_hidden_for_a_paid_charge() =>
        Assert.False(Project(Session()).HasFreeBadge);

    [Fact]
    public void Free_badge_is_hidden_without_energy_even_if_free() =>
        Assert.False(Project(Session(energyWh: 0, cost: null)).HasFreeBadge);

    [Fact]
    public void Anomaly_badge_renders_the_supplied_message()
    {
        var display = Project(Session(), anomaly: "0 kWh in 1h 16m");

        Assert.True(display.HasAnomaly);
        Assert.Equal("0 kWh in 1h 16m", display.AnomalyMessage);
    }

    [Fact]
    public void Anomaly_badge_is_absent_without_a_message() =>
        Assert.False(Project(Session()).HasAnomaly);

    // ── Leading battery-friendly score badge ────────────────────────────────────────────────────────────

    [Fact]
    public void Score_badge_carries_the_value_and_aria_label()
    {
        var display = Project(Session(startSoc: 20, endSoc: 70));

        Assert.True(display.HasScore);
        Assert.Equal(100, display.Score);
        Assert.Equal("Battery-friendly score: 100", display.ScoreAriaLabel);
    }

    [Fact]
    public void Score_badge_is_absent_without_both_soc_endpoints()
    {
        var display = Project(Session(startSoc: null));

        Assert.False(display.HasScore);
        Assert.Equal(string.Empty, display.ScoreAriaLabel);
    }

    // ── Single-endpoint route (web RouteDisplay explicit-single) ────────────────────────────────────────

    [Fact]
    public void Route_prefers_the_resolved_place()
    {
        var display = Project(Session(place: "Gilroy Supercharger"));

        Assert.True(display.HasRoute);
        Assert.Equal("Gilroy Supercharger", display.RouteLabel);
    }

    [Fact]
    public void Route_falls_back_to_coordinates()
    {
        var display = Project(Session(place: null, lat: 37.0, lon: -121.57));

        Assert.True(display.HasRoute);
        Assert.Contains("37.00", display.RouteLabel, StringComparison.Ordinal);
    }

    [Fact]
    public void Route_is_an_em_dash_without_any_location()
    {
        var display = Project(Session(place: null, lat: null, lon: null));

        Assert.False(display.HasRoute);
        Assert.Equal("\u2014", display.RouteLabel);
    }

    // ── Metrics row (comfortable density only) ──────────────────────────────────────────────────────────

    [Fact]
    public void Comfortable_density_builds_every_available_metric()
    {
        var display = Project(Session(), unit: DistanceUnit.Mi);

        Assert.True(display.ShowMetrics);
        Assert.Equal(6, display.Metrics.Count);
        Assert.Contains(display.Metrics, m => m.Text == "150.00 kW peak");
        Assert.Contains(display.Metrics, m => m.Text == "~28.00 kW avg");
        Assert.Contains(display.Metrics, m => m.Text == "1h 30m");
        Assert.Contains(display.Metrics, m => m.Text == "$12.60");
        Assert.Contains(display.Metrics, m => m.Text == "($0.30/kWh)");
        Assert.Contains(display.Metrics, m => m.Text == "+10 mi");
    }

    [Fact]
    public void Distance_metric_honours_the_display_unit()
    {
        var display = Project(Session(), unit: DistanceUnit.Km);

        Assert.Contains(display.Metrics, m => m.Text == "+16 km");
    }

    [Fact]
    public void Cost_metric_tints_success_and_distance_tints_power()
    {
        var display = Project(Session(), unit: DistanceUnit.Mi);

        var cost = Assert.Single(display.Metrics, m => m.Text == "$12.60");
        Assert.Equal(ChargingSessionCardProjection.CostBrushKey, cost.AccentBrushKey);

        var distance = Assert.Single(display.Metrics, m => m.Text == "+10 mi");
        Assert.Equal(ChargingSessionCardProjection.DistanceBrushKey, distance.AccentBrushKey);
    }

    [Fact]
    public void Cost_per_kwh_chip_has_no_icon()
    {
        var display = Project(Session(), unit: DistanceUnit.Mi);

        var cpk = Assert.Single(display.Metrics, m => m.Text == "($0.30/kWh)");
        Assert.Null(cpk.Glyph);
    }

    [Fact]
    public void Compact_density_hides_the_metrics_row()
    {
        var display = Project(Session(), density: ChargingCardDensity.Compact);

        Assert.False(display.ShowMetrics);
        Assert.Empty(display.Metrics);
    }

    [Fact]
    public void Battery_delta_endpoints_are_surfaced()
    {
        var display = Project(Session(startSoc: 20, endSoc: 70));

        Assert.Equal(20, display.BatteryStartPct);
        Assert.Equal(70, display.BatteryEndPct);
    }

    // ── Selection ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Selection_state_and_label_are_projected()
    {
        var display = Project(Session(id: 42), selectable: true, selected: true);

        Assert.True(display.Selectable);
        Assert.True(display.Selected);
        Assert.Equal(42, display.SessionId);
        Assert.Equal("Select charging session", display.SelectLabel);
    }

    [Fact]
    public void Selection_is_off_by_default() =>
        Assert.False(Project(Session()).Selectable);

    // ── Accessibility: every state exposes a meaningful Narrator name ────────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(Session(), loading: true),
                Project(null),
                Project(Session(), anomaly: "telemetry gap"),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_is_the_loading_label() =>
        Assert.Equal("Loading", Project(Session(), loading: true).AutomationName);

    [Fact]
    public void Empty_automation_name_is_the_empty_message() =>
        Assert.Equal("No charging session to show", Project(null).AutomationName);

    [Fact]
    public void Ready_automation_name_carries_the_session_summary()
    {
        var display = Project(Session(), anomaly: "telemetry gap");

        Assert.Contains("Supercharger", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("1h 30m", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("42.00 kWh", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("telemetry gap", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Battery-friendly score: 100", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Ready_started_at_text_is_rendered()
    {
        var display = Project(Session());

        Assert.False(string.IsNullOrEmpty(display.StartedAtText));
        Assert.NotEqual("\u2014", display.StartedAtText);
    }

    // ── Diagnostics (P1/S11): view.opened slug=ChargingSessionCard, PII-safe ─────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new ChargingSessionCardDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargingSessionCard", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_session_content()
    {
        var captured = new List<string>();
        var diagnostics = new ChargingSessionCardDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("Gilroy", line, StringComparison.Ordinal);
        Assert.DoesNotContain("kWh", line, StringComparison.Ordinal);
        Assert.DoesNotContain('$', line);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("ChargingSessionCard", ChargingSessionCardRegistration.Slug);

    [Fact]
    public void Registration_glyphs_are_distinct()
    {
        string[] glyphs =
        [
            ChargingSessionCardRegistration.ZapGlyph,
            ChargingSessionCardRegistration.ClockGlyph,
            ChargingSessionCardRegistration.PlugGlyph,
            ChargingSessionCardRegistration.TrendingUpGlyph,
            ChargingSessionCardRegistration.CostGlyph,
            ChargingSessionCardRegistration.SunGlyph,
            ChargingSessionCardRegistration.WarningGlyph,
        ];
        Assert.Equal(glyphs.Length, glyphs.Distinct().Count());
    }

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => ChargingSessionCardProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => ChargingSessionCardProjection.Project(ChargingSessionCardModel.Pending, null!));
}
