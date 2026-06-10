using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DriveStatCards</c> feature surface's UI-thread-free logic — the SI→display
/// projection (distance / speed unit conversion, the web <c>formatDuration</c> clock, the <c>fmtInt</c> SOC
/// readout, the <c>fmtWithUnit</c> power tile, the rounded elevation tiles and the two energy-gated cost
/// tiles), the loading-vs-ready state branch, the per-tile count-up vs static split, the localized label +
/// i18n key set, the composed Narrator names, the Segoe Fluent glyph / design-token accent mapping and the
/// PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/drive-detail/DriveStatCards.tsx). The WinUI view itself
/// (feature-views\DriveStatCards.cs) is exercised by the app build.
/// </summary>
public sealed class DriveStatCardsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static DriveStatsSnapshot Snapshot(
        double distanceM = 12340,
        double durationS = 3720,
        double? maxSpeedMps = 30,
        double? avgSpeedMps = 20,
        double? startBatteryPct = 84,
        double? endBatteryPct = 72,
        double powerMaxKw = 180,
        double energyWh = 15000,
        double elevGainM = 234.6,
        double elevLossM = 123.4) =>
        new(distanceM, durationS, maxSpeedMps, avgSpeedMps, startBatteryPct, endBatteryPct, powerMaxKw, energyWh, elevGainM, elevLossM);

    private static DriveStatCardsDisplay Project(
        DriveStatsSnapshot? snapshot,
        UnitPref? units = null,
        DriveStatsFormatting? formatting = null,
        ILocalizer? localizer = null) =>
        DriveStatCardsProjection.Project(
            new DriveStatCardsModel(snapshot),
            units ?? UnitPref.Metric,
            formatting ?? DriveStatsFormatting.Default,
            localizer ?? Localizer);

    private static DriveStatCardModel Card(DriveStatCardsDisplay display, string labelKey) =>
        display.Cards.Single(c => c.Label == labelKey);

    // ── Loading branch (parent has not resolved the drive — skeleton chrome, never a blank box) ───────────

    [Fact]
    public void Pending_model_projects_the_loading_state_with_no_cards()
    {
        var display = Project(null);

        Assert.Equal(DriveStatCardsState.Loading, display.State);
        Assert.Empty(display.Cards);
        Assert.Equal(0, display.CardCount);
    }

    [Fact]
    public void Loading_still_resolves_the_region_and_loading_labels()
    {
        var display = Project(null);

        Assert.Equal("Drive statistics", display.RegionLabel);
        Assert.Equal("Loading", display.LoadingLabel);
    }

    [Fact]
    public void Pending_model_static_is_loading()
    {
        Assert.Null(DriveStatCardsModel.Pending.Stats);
        Assert.Equal(DriveStatCardsState.Loading, Project(null).State);
    }

    // ── Ready: the eight always-present tiles ────────────────────────────────────────────────────────────

    [Fact]
    public void A_resolved_drive_with_no_energy_renders_exactly_the_eight_base_tiles()
    {
        var display = Project(Snapshot(energyWh: 0));

        Assert.Equal(DriveStatCardsState.Ready, display.State);
        Assert.Equal(8, display.CardCount);
        Assert.Collection(
            display.Cards,
            c => Assert.Equal("Distance", c.Label),
            c => Assert.Equal("Duration", c.Label),
            c => Assert.Equal("Max Speed", c.Label),
            c => Assert.Equal("Avg Speed", c.Label),
            c => Assert.Equal("SOC", c.Label),
            c => Assert.Equal("Max Power", c.Label),
            c => Assert.Equal("Elev. Gain", c.Label),
            c => Assert.Equal("Elev. Loss", c.Label));
    }

    [Fact]
    public void Distance_tile_converts_si_metres_and_animates_at_one_decimal()
    {
        var card = Card(Project(Snapshot()), "Distance");

        Assert.Equal("12.3 km", card.Value);
        Assert.Equal(12.34, card.AnimatedValue);
        Assert.Equal(1, card.AnimatedPrecision);
        Assert.Equal(" km", card.AnimatedSuffix);
    }

    [Fact]
    public void Duration_tile_renders_the_web_clock_string()
    {
        // 3720 s = 62 min → "1h 2m".
        var card = Card(Project(Snapshot()), "Duration");

        Assert.Equal("1h 2m", card.Value);
        Assert.Null(card.AnimatedValue); // static tile (web plain string)
    }

    [Fact]
    public void Max_and_avg_speed_tiles_convert_si_mps_at_zero_decimals()
    {
        var display = Project(Snapshot());

        var max = Card(display, "Max Speed");
        Assert.Equal("108 km/h", max.Value);          // 30 m/s → 108 km/h
        Assert.Equal(108, max.AnimatedValue);
        Assert.Equal(" km/h", max.AnimatedSuffix);

        var avg = Card(display, "Avg Speed");
        Assert.Equal("72 km/h", avg.Value);            // 20 m/s → 72 km/h
        Assert.Equal(0, avg.AnimatedPrecision);
    }

    [Fact]
    public void Soc_tile_renders_start_arrow_end_percent()
    {
        var card = Card(Project(Snapshot()), "SOC");

        Assert.Equal($"84% {DriveStatCardsProjection.SocArrow} 72%", card.Value);
        Assert.Null(card.AnimatedValue);
    }

    [Fact]
    public void Soc_tile_coerces_null_battery_to_zero_like_web_fmtInt()
    {
        // web fmtInt uses safeNumber → null renders "0".
        var card = Card(Project(Snapshot(startBatteryPct: null, endBatteryPct: null)), "SOC");

        Assert.Equal($"0% {DriveStatCardsProjection.SocArrow} 0%", card.Value);
    }

    [Fact]
    public void Max_power_tile_renders_kw_at_the_user_precision()
    {
        // web fmtWithUnit(powerMax, 'kW') at the default decimal precision (2).
        var card = Card(Project(Snapshot()), "Max Power");

        Assert.Equal("180.00 kW", card.Value);
        Assert.Null(card.AnimatedValue);
    }

    [Fact]
    public void Elevation_tiles_round_metres_and_carry_the_direction_arrow()
    {
        var display = Project(Snapshot());

        var gain = Card(display, "Elev. Gain");
        Assert.Equal($"235 m {DriveStatCardsProjection.UpArrow}", gain.Value); // round(234.6) = 235
        Assert.Equal(235, gain.AnimatedValue);
        Assert.Equal($" m {DriveStatCardsProjection.UpArrow}", gain.AnimatedSuffix);

        var loss = Card(display, "Elev. Loss");
        Assert.Equal($"123 m {DriveStatCardsProjection.DownArrow}", loss.Value); // round(123.4) = 123
        Assert.Equal(123, loss.AnimatedValue);
    }

    // ── Ready: the two energy-gated tiles ────────────────────────────────────────────────────────────────

    [Fact]
    public void Trip_cost_tile_appears_only_when_energy_is_present()
    {
        Assert.DoesNotContain(Project(Snapshot(energyWh: 0)).Cards, c => c.Label == "Trip Cost");

        var card = Card(Project(Snapshot(energyWh: 15000)), "Trip Cost");
        // 15 kWh × $0.12 = $1.80.
        Assert.Equal("$1.80", card.Value);
    }

    [Fact]
    public void Cost_per_distance_tile_appears_only_with_energy_and_distance()
    {
        // energy present but zero distance → no cost-per-distance tile (web `energyWh > 0 && distanceM > 0`).
        Assert.DoesNotContain(
            Project(Snapshot(energyWh: 15000, distanceM: 0)).Cards,
            c => c.Label.StartsWith("Cost /", StringComparison.Ordinal));

        var display = Project(Snapshot(energyWh: 15000, distanceM: 12340));
        var card = display.Cards.Single(c => c.Label.StartsWith("Cost /", StringComparison.Ordinal));

        Assert.Equal("Cost / km", card.Label);     // web interpolated {{unit}} → distance label
        Assert.Equal("$0.146", card.Value);          // $1.80 / 12.34 km, 3 decimals
        Assert.Equal(10, display.CardCount);          // 8 base + trip cost + cost/distance
    }

    [Fact]
    public void Energy_without_distance_yields_nine_tiles()
    {
        var display = Project(Snapshot(energyWh: 15000, distanceM: 0));

        Assert.Equal(9, display.CardCount); // 8 base + trip cost only
        Assert.Contains(display.Cards, c => c.Label == "Trip Cost");
    }

    // ── Unit conversion (web useUnits — imperial) ────────────────────────────────────────────────────────

    [Fact]
    public void Imperial_units_convert_distance_speed_and_relabel_the_cost_tile()
    {
        var display = Project(Snapshot(), UnitPref.Imperial);

        Assert.Equal("7.7 mi", Card(display, "Distance").Value);     // 12340 m → 7.67 mi
        Assert.Equal("67 mph", Card(display, "Max Speed").Value);    // 30 m/s → 67 mph
        Assert.Equal("45 mph", Card(display, "Avg Speed").Value);    // 20 m/s → 44.7 → 45 mph

        var cost = display.Cards.Single(c => c.Label.StartsWith("Cost /", StringComparison.Ordinal));
        Assert.Equal("Cost / mi", cost.Label);
    }

    [Fact]
    public void Custom_formatting_applies_currency_rate_and_precision()
    {
        var formatting = new DriveStatsFormatting(CurrencySymbol: "€", CostPerKwh: 0.30, Precision: 0);
        var display = Project(Snapshot(energyWh: 10000, distanceM: 10000), UnitPref.Metric, formatting);

        // 10 kWh × €0.30 = €3 (precision 0).
        Assert.Equal("€3", Card(display, "Trip Cost").Value);
        // Power precision follows the same setting.
        Assert.Equal("180 kW", Card(display, "Max Power").Value);
        // Cost-per-distance is always 3 decimals (web formatCurrency(value, 3)): €3 / 10 km = €0.300.
        var cost = display.Cards.Single(c => c.Label.StartsWith("Cost /", StringComparison.Ordinal));
        Assert.Equal("€0.300", cost.Value);
    }

    // ── formatDuration (web helper) ──────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(0, "0m")]
    [InlineData(45, "45m")]
    [InlineData(62, "1h 2m")]
    [InlineData(120, "2h 0m")]
    [InlineData(59.5, "60m")]   // web Math.round(59.5) = 60
    [InlineData(125.4, "2h 5m")] // round(5.4) = 5
    public void FormatDuration_matches_the_web_helper(double minutes, string expected)
    {
        Assert.Equal(expected, DriveStatCardsProjection.FormatDuration(minutes));
    }

    // ── costPerDistanceUnit (web useFormatting) ──────────────────────────────────────────────────────────

    [Fact]
    public void CostPerDistanceUnit_is_null_for_non_positive_distance()
    {
        Assert.Null(DriveStatCardsProjection.CostPerDistanceUnit(10, 0, UnitPref.Metric, DriveStatsFormatting.Default));
        Assert.Null(DriveStatCardsProjection.CostPerDistanceUnit(10, -5, UnitPref.Metric, DriveStatsFormatting.Default));
    }

    [Fact]
    public void CostPerDistanceUnit_divides_cost_by_display_distance()
    {
        // 10 kWh × $0.12 = $1.20; 2000 m = 2 km → $0.60/km.
        double? value = DriveStatCardsProjection.CostPerDistanceUnit(10, 2000, UnitPref.Metric, DriveStatsFormatting.Default);

        Assert.NotNull(value);
        Assert.Equal(0.6, value!.Value, 6);
    }

    // ── Accessibility: every tile carries a descriptive Narrator name ────────────────────────────────────

    [Fact]
    public void Every_tile_exposes_a_label_and_value_narrator_name()
    {
        foreach (var card in Project(Snapshot()).Cards)
        {
            Assert.False(string.IsNullOrWhiteSpace(card.AutomationName));
            Assert.Contains(card.Label, card.AutomationName, StringComparison.Ordinal);
            Assert.Contains(card.Value, card.AutomationName, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Tile_narrator_name_joins_the_label_and_value()
    {
        var card = Card(Project(Snapshot()), "Distance");

        Assert.Equal(
            string.Create(CultureInfo.CurrentCulture, $"{card.Label}: {card.Value}"),
            card.AutomationName);
    }

    // ── i18n: every key from the source resolves with the web default (P1/S10 catalog) ──────────────────

    [Fact]
    public void Every_i18n_key_from_the_source_is_resolved_with_the_web_default()
    {
        var recorder = new RecordingLocalizer();

        // A drive with energy + distance exercises every tile (including the two energy-gated ones).
        Project(Snapshot(energyWh: 15000, distanceM: 12340), UnitPref.Metric, DriveStatsFormatting.Default, recorder);

        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["driveDetail.distance"] = "Distance",
            ["driveDetail.duration"] = "Duration",
            ["driveDetail.maxSpeed"] = "Max Speed",
            ["driveDetail.avgSpeed"] = "Avg Speed",
            ["driveDetail.soc"] = "SOC",
            ["driveDetail.maxPower"] = "Max Power",
            ["driveDetail.elevGain"] = "Elev. Gain",
            ["driveDetail.elevLoss"] = "Elev. Loss",
            ["driveDetail.tripCost"] = "Trip Cost",
            ["driveDetail.costPerUnit"] = "Cost / {{unit}}",
        };

        foreach (var (key, fallback) in expected)
        {
            Assert.True(recorder.Requested.TryGetValue(key, out var seen), $"i18n key not resolved: {key}");
            Assert.Equal(fallback, seen);
        }
    }

    [Fact]
    public void Source_i18n_keys_match_the_web_t_calls()
    {
        Assert.Equal("driveDetail.distance", DriveStatCardsRegistration.DistanceKey);
        Assert.Equal("driveDetail.duration", DriveStatCardsRegistration.DurationKey);
        Assert.Equal("driveDetail.maxSpeed", DriveStatCardsRegistration.MaxSpeedKey);
        Assert.Equal("driveDetail.avgSpeed", DriveStatCardsRegistration.AvgSpeedKey);
        Assert.Equal("driveDetail.soc", DriveStatCardsRegistration.SocKey);
        Assert.Equal("driveDetail.maxPower", DriveStatCardsRegistration.MaxPowerKey);
        Assert.Equal("driveDetail.elevGain", DriveStatCardsRegistration.ElevGainKey);
        Assert.Equal("driveDetail.elevLoss", DriveStatCardsRegistration.ElevLossKey);
        Assert.Equal("driveDetail.tripCost", DriveStatCardsRegistration.TripCostKey);
        Assert.Equal("driveDetail.costPerUnit", DriveStatCardsRegistration.CostPerUnitKey);
    }

    [Fact]
    public void Cost_per_unit_fallback_carries_the_web_interpolation_token()
    {
        Assert.Equal("Cost / {{unit}}", DriveStatCardsRegistration.CostPerUnitFallback);
        Assert.Contains(DriveStatCardsRegistration.UnitToken, DriveStatCardsRegistration.CostPerUnitFallback, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): PII-safe slugged events ───────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new DriveStatCardsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DriveStatCards", Assert.Single(captured));
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("DriveStatCards", DriveStatCardsRegistration.Slug);
    }

    // ── Glyph / accent token mapping (locked) ────────────────────────────────────────────────────────────

    [Fact]
    public void Glyphs_map_to_the_expected_segoe_fluent_code_points()
    {
        Assert.Equal("\uE7C0", DriveStatCardsRegistration.DistanceGlyph);
        Assert.Equal("\uE121", DriveStatCardsRegistration.DurationGlyph);
        Assert.Equal("\uE9D9", DriveStatCardsRegistration.MaxSpeedGlyph);
        Assert.Equal("\uE9D2", DriveStatCardsRegistration.AvgSpeedGlyph);
        Assert.Equal("\uE83F", DriveStatCardsRegistration.SocGlyph);
        Assert.Equal("\uE945", DriveStatCardsRegistration.MaxPowerGlyph);
        Assert.Equal("\uE707", DriveStatCardsRegistration.ElevGainGlyph);
        Assert.Equal("\uE707", DriveStatCardsRegistration.ElevLossGlyph);
        Assert.Equal("\uE1D3", DriveStatCardsRegistration.TripCostGlyph);
        Assert.Equal("\uEB0F", DriveStatCardsRegistration.CostPerUnitGlyph);
    }

    [Fact]
    public void Accent_brushes_are_theme_aware_token_keys_not_literal_hex()
    {
        string[] keys =
        [
            DriveStatCardsRegistration.DistanceColor,
            DriveStatCardsRegistration.DurationColor,
            DriveStatCardsRegistration.MaxSpeedColor,
            DriveStatCardsRegistration.AvgSpeedColor,
            DriveStatCardsRegistration.SocColor,
            DriveStatCardsRegistration.MaxPowerColor,
            DriveStatCardsRegistration.ElevGainColor,
            DriveStatCardsRegistration.ElevLossColor,
            DriveStatCardsRegistration.TripCostColor,
            DriveStatCardsRegistration.CostPerUnitColor,
        ];

        foreach (var key in keys)
        {
            Assert.StartsWith("Ts", key, StringComparison.Ordinal);
            Assert.EndsWith("Brush", key, StringComparison.Ordinal);
            Assert.DoesNotContain('#', key);
        }
    }

    /// <summary>An <see cref="ILocalizer"/> that returns the fallback and records each requested key.</summary>
    private sealed class RecordingLocalizer : ILocalizer
    {
        public Dictionary<string, string> Requested { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Requested[key] = fallback;
            return fallback;
        }
    }
}
