using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SessionDetailPanel</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / ready), the web row set + ordering with its three optional rows (Avg Power /
/// Cost / Location), the <c>getChargerLabel</c> and <c>durationMinutes</c> helper ports, the Wh→kWh / W→kW /
/// minute / currency formatting and SoC-range template, the accessible names and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/features/charging/components/charging-curve/SessionDetailPanel.tsx). The
/// WinUI view itself (SessionDetailPanel.cs) is exercised by the app build.
/// </summary>
public sealed class SessionDetailPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // 2026-04-04 02:30 UTC; the year + month are timezone-stable for this instant, so date assertions below
    // that probe "Apr"/"2026" hold regardless of the test machine's local zone.
    private static readonly DateTimeOffset Start = new(2026, 4, 4, 2, 30, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset End = Start.AddMinutes(45);

    private static SessionDetailModel Ready(
        string? chargerType = "Tesla",
        double? peakPowerW = 150_000,
        double startSocPct = 20,
        double? endSocPct = 80,
        double totalEnergyAddedWh = 42_500,
        double? avgPowerW = 90_000,
        double? costDecimal = 12.5,
        string? startPlace = "Gilroy Supercharger") =>
        SessionDetailModel.ForSession(
            Start,
            End,
            chargerType,
            peakPowerW,
            startSocPct,
            endSocPct,
            totalEnergyAddedWh,
            avgPowerW,
            costDecimal,
            startPlace);

    // Builds a session with explicit (possibly null) timestamps — used by the date / duration edge cases the
    // defaulted Ready(...) helper cannot express.
    private static SessionDetailModel SessionWith(DateTimeOffset? startedAt, DateTimeOffset? endedAt) =>
        SessionDetailModel.ForSession(startedAt, endedAt, "Tesla", 150_000, 20, 80, 42_500, 90_000, 12.5, "Gilroy Supercharger");

    private static SessionDetailDisplay Project(SessionDetailModel model, string? currencySymbol = null) =>
        SessionDetailProjection.Project(model, Localizer, currencySymbol);

    private static SessionDetailRow RowFor(SessionDetailDisplay display, string label) =>
        display.Rows.Single(row => row.Label == label);

    // ── Branch precedence: loading → empty → ready (web data lifecycle) ───────────────────────────────

    [Fact]
    public void Loading_when_model_is_pending() =>
        Assert.Equal(SessionDetailState.Loading, Project(SessionDetailModel.Pending).State);

    [Fact]
    public void Empty_when_no_session_is_bound() =>
        Assert.Equal(SessionDetailState.Empty, Project(SessionDetailModel.None).State);

    [Fact]
    public void Ready_when_a_session_is_bound() =>
        Assert.Equal(SessionDetailState.Ready, Project(Ready()).State);

    [Fact]
    public void Loading_takes_precedence_over_a_bound_session()
    {
        var display = Project(new SessionDetailModel(true, true, Start, End, "Tesla", 150_000, 20, 80, 42_500, 90_000, 12.5, "Gilroy"));

        Assert.Equal(SessionDetailState.Loading, display.State);
    }

    [Fact]
    public void Non_ready_states_render_no_rows()
    {
        Assert.Empty(Project(SessionDetailModel.Pending).Rows);
        Assert.Empty(Project(SessionDetailModel.None).Rows);
    }

    // ── Row set + ordering (web composition, with the three optional rows) ────────────────────────────

    [Fact]
    public void Ready_renders_every_row_in_web_order_when_all_fields_present()
    {
        var display = Project(Ready());

        Assert.Collection(
            display.Rows,
            row => Assert.Equal("Date", row.Label),
            row => Assert.Equal("Charger Type", row.Label),
            row => Assert.Equal("SOC Range", row.Label),
            row => Assert.Equal("Energy Added", row.Label),
            row => Assert.Equal("Peak Power", row.Label),
            row => Assert.Equal("Avg Power", row.Label),
            row => Assert.Equal("Duration", row.Label),
            row => Assert.Equal("Cost", row.Label),
            row => Assert.Equal("Location", row.Label));
    }

    [Fact]
    public void Avg_power_row_is_omitted_when_avg_power_is_null()
    {
        var display = Project(Ready(avgPowerW: null));

        Assert.DoesNotContain(display.Rows, row => row.Label == "Avg Power");
    }

    [Fact]
    public void Cost_row_is_omitted_when_cost_is_null()
    {
        var display = Project(Ready(costDecimal: null));

        Assert.DoesNotContain(display.Rows, row => row.Label == "Cost");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Location_row_is_omitted_when_place_is_absent(string? place)
    {
        var display = Project(Ready(startPlace: place));

        Assert.DoesNotContain(display.Rows, row => row.Label == "Location");
    }

    [Fact]
    public void Minimal_session_renders_only_the_six_always_present_rows()
    {
        var display = Project(Ready(avgPowerW: null, costDecimal: null, startPlace: null));

        Assert.Collection(
            display.Rows,
            row => Assert.Equal("Date", row.Label),
            row => Assert.Equal("Charger Type", row.Label),
            row => Assert.Equal("SOC Range", row.Label),
            row => Assert.Equal("Energy Added", row.Label),
            row => Assert.Equal("Peak Power", row.Label),
            row => Assert.Equal("Duration", row.Label));
    }

    [Fact]
    public void Location_row_shows_the_place_verbatim()
    {
        var display = Project(Ready(startPlace: "Harris Ranch"));

        Assert.Equal("Harris Ranch", RowFor(display, "Location").Value);
    }

    // ── Numeric formatting (Wh→kWh / W→kW / minutes / currency) ──────────────────────────────────────

    [Fact]
    public void Energy_added_scales_watt_hours_to_kwh_at_precision_two() =>
        Assert.Equal("42.50 kWh", RowFor(Project(Ready(totalEnergyAddedWh: 42_500)), "Energy Added").Value);

    [Fact]
    public void Energy_added_groups_thousands() =>
        Assert.Equal("1,234.56 kWh", RowFor(Project(Ready(totalEnergyAddedWh: 1_234_560)), "Energy Added").Value);

    [Fact]
    public void Peak_power_scales_watts_to_kw() =>
        Assert.Equal("150.00 kW", RowFor(Project(Ready(peakPowerW: 150_000)), "Peak Power").Value);

    [Fact]
    public void Peak_power_renders_zero_when_null() =>
        Assert.Equal("0.00 kW", RowFor(Project(Ready(peakPowerW: null)), "Peak Power").Value);

    [Fact]
    public void Avg_power_scales_watts_to_kw() =>
        Assert.Equal("90.00 kW", RowFor(Project(Ready(avgPowerW: 90_000)), "Avg Power").Value);

    [Fact]
    public void Cost_uses_the_default_currency_symbol_and_precision() =>
        Assert.Equal("$12.50", RowFor(Project(Ready(costDecimal: 12.5)), "Cost").Value);

    [Fact]
    public void Cost_honours_a_supplied_currency_symbol() =>
        Assert.Equal("\u20AC12.50", RowFor(Project(Ready(costDecimal: 12.5), "\u20AC"), "Cost").Value);

    // ── SOC range (web template literal) ─────────────────────────────────────────────────────────────

    [Fact]
    public void Soc_range_renders_start_and_end() =>
        Assert.Equal("20% \u2192 80%", RowFor(Project(Ready(startSocPct: 20, endSocPct: 80)), "SOC Range").Value);

    [Fact]
    public void Soc_range_uses_a_question_mark_when_the_end_is_missing() =>
        Assert.Equal("20% \u2192 ?%", RowFor(Project(Ready(startSocPct: 20, endSocPct: null)), "SOC Range").Value);

    [Fact]
    public void Soc_range_preserves_fractional_percentages() =>
        Assert.Equal("19.5% \u2192 80.2%", RowFor(Project(Ready(startSocPct: 19.5, endSocPct: 80.2)), "SOC Range").Value);

    // ── Duration (web durationMinutes helper) ────────────────────────────────────────────────────────

    [Fact]
    public void Duration_rounds_the_span_to_whole_minutes() =>
        Assert.Equal("45.00 min", RowFor(Project(SessionWith(Start, End)), "Duration").Value);

    [Fact]
    public void Duration_is_zero_when_the_session_has_not_ended() =>
        Assert.Equal("0.00 min", RowFor(Project(SessionWith(Start, null)), "Duration").Value);

    [Fact]
    public void Duration_is_zero_when_the_end_precedes_the_start() =>
        Assert.Equal("0.00 min", RowFor(Project(SessionWith(Start, Start.AddMinutes(-10))), "Duration").Value);

    [Theory]
    [InlineData(0, 0)]      // no span
    [InlineData(30, 1)]     // 0.5 min rounds half-away-from-zero up to 1
    [InlineData(90, 2)]     // 1.5 min rounds up to 2
    [InlineData(2_700, 45)] // 45 min exactly
    public void Duration_minutes_matches_the_web_math_round(int spanSeconds, double expected) =>
        Assert.Equal(expected, SessionDetailProjection.DurationMinutes(Start, Start.AddSeconds(spanSeconds)));

    [Fact]
    public void Duration_minutes_is_zero_without_an_end() =>
        Assert.Equal(0, SessionDetailProjection.DurationMinutes(Start, null));

    // ── Date (shared full variant; em-dash fallback) ─────────────────────────────────────────────────

    [Fact]
    public void Date_uses_the_shared_full_datetime_variant()
    {
        var value = RowFor(Project(SessionWith(Start, End)), "Date").Value;

        Assert.Equal(DateTimeFormatting.Format(Start, DateTimeVariant.Full, DateTimeOffset.Now), value);
        Assert.Contains("2026", value, StringComparison.Ordinal);
        Assert.Contains("Apr", value, StringComparison.Ordinal);
    }

    [Fact]
    public void Date_renders_the_em_dash_when_the_timestamp_is_missing() =>
        Assert.Equal("\u2014", RowFor(Project(SessionWith(null, null)), "Date").Value);

    // ── Charger label (web getChargerLabel helper, every branch) ─────────────────────────────────────

    [Fact]
    public void Charger_label_is_supercharger_for_an_exact_tesla_type() =>
        Assert.Equal("Supercharger", SessionDetailProjection.ChargerLabel(Ready(chargerType: "Tesla"), Localizer));

    [Theory]
    [InlineData("Tesla Supercharger V3")]
    [InlineData("URBAN tesla")]
    public void Charger_label_is_supercharger_when_the_type_contains_tesla(string chargerType) =>
        Assert.Equal("Supercharger", SessionDetailProjection.ChargerLabel(Ready(chargerType: chargerType), Localizer));

    [Fact]
    public void Charger_label_is_dc_fast_for_any_other_named_charger() =>
        Assert.Equal("DC Fast", SessionDetailProjection.ChargerLabel(Ready(chargerType: "EVgo"), Localizer));

    [Fact]
    public void Charger_label_is_dc_fast_for_a_high_peak_without_a_type() =>
        Assert.Equal("DC Fast", SessionDetailProjection.ChargerLabel(Ready(chargerType: null, peakPowerW: 25_000), Localizer));

    [Fact]
    public void Charger_label_is_dc_fast_for_an_empty_type_with_a_high_peak() =>
        Assert.Equal("DC Fast", SessionDetailProjection.ChargerLabel(Ready(chargerType: "", peakPowerW: 25_000), Localizer));

    [Fact]
    public void Charger_label_is_home_ac_for_a_low_peak_without_a_type() =>
        Assert.Equal("Home / AC", SessionDetailProjection.ChargerLabel(Ready(chargerType: null, peakPowerW: 10_000), Localizer));

    [Fact]
    public void Charger_label_is_home_ac_without_a_type_or_peak() =>
        Assert.Equal("Home / AC", SessionDetailProjection.ChargerLabel(Ready(chargerType: null, peakPowerW: null), Localizer));

    [Fact]
    public void Charger_type_row_carries_the_resolved_label() =>
        Assert.Equal("Supercharger", RowFor(Project(Ready(chargerType: "Tesla")), "Charger Type").Value);

    // ── Accessibility: every state exposes a meaningful Narrator name ─────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name() =>
        Assert.All(
            new[]
            {
                Project(SessionDetailModel.Pending),
                Project(SessionDetailModel.None),
                Project(Ready()),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));

    [Fact]
    public void Loading_automation_name_combines_the_title_and_loading_label() =>
        Assert.Equal("Session Details. Loading", Project(SessionDetailModel.Pending).AutomationName);

    [Fact]
    public void Empty_automation_name_combines_the_title_and_empty_message() =>
        Assert.Equal("Session Details. Select a session to inspect", Project(SessionDetailModel.None).AutomationName);

    [Fact]
    public void Ready_automation_name_carries_every_row()
    {
        var display = Project(Ready());

        foreach (var row in display.Rows)
        {
            Assert.Contains(row.AutomationName, display.AutomationName, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Row_automation_name_is_the_label_then_the_value()
    {
        var energy = RowFor(Project(Ready(totalEnergyAddedWh: 42_500)), "Energy Added");

        Assert.Equal("Energy Added 42.50 kWh", energy.AutomationName);
    }

    // ── Title + empty / loading copy resolve through the facade ──────────────────────────────────────

    [Fact]
    public void Title_resolves_from_the_facade() =>
        Assert.Equal("Session Details", Project(Ready()).Title);

    [Fact]
    public void Empty_message_resolves_from_the_facade() =>
        Assert.Equal("Select a session to inspect", Project(SessionDetailModel.None).EmptyMessage);

    [Fact]
    public void Loading_label_resolves_from_the_facade() =>
        Assert.Equal("Loading", Project(SessionDetailModel.Pending).LoadingLabel);

    // ── Diagnostics (P1/S11): view.opened slug=SessionDetailPanel, PII-safe ──────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_the_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new SessionDetailDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SessionDetailPanel", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_session_values()
    {
        var captured = new List<string>();
        var diagnostics = new SessionDetailDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=SessionDetailPanel", line);
        Assert.DoesNotContain('$', line);
        Assert.DoesNotContain("12", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("SessionDetailPanel", SessionDetailRegistration.Slug);

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => SessionDetailProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => SessionDetailProjection.Project(SessionDetailModel.Pending, null!));
}
