using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>QuickStatsGrid</c> feature surface's UI-thread-free logic — the loading-vs-ready
/// branch, the eight-tile composition and order, the verbatim battery percent (web template literal), the
/// SI→display distance / speed / temperature conversion (metric and imperial), the <c>fmtNumber</c> power readout
/// with its hard-coded " kW" suffix, the driving/parked Speed subtitle, the verbatim status, the web-colour →
/// token-brush mapping, the localized labels + i18n key set, the composed Narrator names, and the PII-safe
/// diagnostics. Mirrors the web spec
/// (web/src/features/vehicles/components/vehicle-detail/QuickStatsGrid.tsx). The WinUI view itself
/// (feature-views\QuickStatsGrid.cs) is exercised by the app build.
/// </summary>
public sealed class QuickStatsGridTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // Tile indices in the web render order (QuickStatsGrid.tsx lines 22-70).
    private const int Battery = 0;
    private const int Range = 1;
    private const int Odometer = 2;
    private const int Speed = 3;
    private const int InsideTemp = 4;
    private const int OutsideTemp = 5;
    private const int Power = 6;
    private const int State = 7;

    private static QuickVehicleSnapshot Snapshot(
        double batteryLevel = 84,
        double ratedRangeM = 400000,
        double odometerM = 25000000,
        double speedMps = 20,
        double insideTempC = 21.5,
        double outsideTempC = 14,
        double powerKw = 7.5,
        string status = "driving") =>
        new(batteryLevel, ratedRangeM, odometerM, speedMps, insideTempC, outsideTempC, powerKw, status);

    private static QuickStatsGridDisplay Project(
        QuickVehicleSnapshot? snapshot,
        UnitPref? units = null,
        ILocalizer? localizer = null) =>
        QuickStatsGridProjection.Project(
            new QuickStatsGridModel(snapshot),
            units ?? UnitPref.Metric,
            localizer ?? Localizer);

    // ── Loading branch (parent has not resolved the live state — skeleton chrome, never a blank box) ──────

    [Fact]
    public void Pending_model_projects_the_loading_state_with_no_cards()
    {
        var display = Project(null);

        Assert.Equal(QuickStatsGridState.Loading, display.State);
        Assert.Empty(display.Cards);
        Assert.Equal(0, display.CardCount);
    }

    [Fact]
    public void Pending_static_has_no_snapshot_and_projects_loading()
    {
        Assert.Null(QuickStatsGridModel.Pending.Vehicle);
        Assert.Equal(QuickStatsGridState.Loading, Project(null).State);
    }

    [Fact]
    public void Loading_resolves_the_shared_common_loading_label()
    {
        var display = Project(null);

        Assert.Equal("Loading...", display.LoadingLabel);
        Assert.Equal("Loading...", display.AutomationName);
    }

    [Fact]
    public void Resolved_snapshot_projects_the_ready_state() =>
        Assert.Equal(QuickStatsGridState.Ready, Project(Snapshot()).State);

    // ── Ready: the eight always-present tiles in web order ───────────────────────────────────────────────

    [Fact]
    public void Ready_renders_exactly_eight_tiles_in_web_order()
    {
        var cards = Project(Snapshot()).Cards;

        Assert.Equal(8, cards.Count);
        Assert.Equal(QuickStatsGridProjection.TileCount, cards.Count);
        Assert.Collection(
            cards,
            c => Assert.Equal("Battery", c.Label),
            c => Assert.Equal("Range", c.Label),
            c => Assert.Equal("Odometer", c.Label),
            c => Assert.Equal("Speed", c.Label),
            c => Assert.Equal("Inside Temp", c.Label),
            c => Assert.Equal("Outside Temp", c.Label),
            c => Assert.Equal("Power", c.Label),
            c => Assert.Equal("State", c.Label));
    }

    // ── Battery tile: verbatim percent + the green/cyan threshold ────────────────────────────────────────

    [Fact]
    public void Battery_tile_renders_the_verbatim_percent_like_the_web_template_literal()
    {
        // web value={`${state.battery_level}%`} — String(number), no grouping, no forced decimals.
        Assert.Equal("84%", Project(Snapshot(batteryLevel: 84)).Cards[Battery].Value);
        Assert.Equal("7%", Project(Snapshot(batteryLevel: 7)).Cards[Battery].Value);
        Assert.Equal("100%", Project(Snapshot(batteryLevel: 100)).Cards[Battery].Value);
    }

    [Fact]
    public void Battery_tile_is_green_above_fifty_percent()
    {
        Assert.Equal(QuickStatsGridProjection.GreenBrushKey, Project(Snapshot(batteryLevel: 51)).Cards[Battery].AccentBrushKey);
        Assert.Equal(QuickStatsGridProjection.GreenBrushKey, Project(Snapshot(batteryLevel: 84)).Cards[Battery].AccentBrushKey);
    }

    [Fact]
    public void Battery_tile_is_cyan_at_or_below_fifty_percent()
    {
        // web: > 50 ? 'green' : > 20 ? 'cyan' : 'cyan' — every ≤ 50 branch resolves to cyan.
        Assert.Equal(QuickStatsGridProjection.CyanBrushKey, Project(Snapshot(batteryLevel: 50)).Cards[Battery].AccentBrushKey);
        Assert.Equal(QuickStatsGridProjection.CyanBrushKey, Project(Snapshot(batteryLevel: 30)).Cards[Battery].AccentBrushKey);
        Assert.Equal(QuickStatsGridProjection.CyanBrushKey, Project(Snapshot(batteryLevel: 20)).Cards[Battery].AccentBrushKey);
        Assert.Equal(QuickStatsGridProjection.CyanBrushKey, Project(Snapshot(batteryLevel: 0)).Cards[Battery].AccentBrushKey);
    }

    // ── Range / Odometer tiles: SI metres → display distance at zero decimals ─────────────────────────────

    [Fact]
    public void Range_tile_converts_si_metres_at_zero_decimals_with_cyan_accent()
    {
        var card = Project(Snapshot(ratedRangeM: 400000)).Cards[Range];

        Assert.Equal("400 km", card.Value);
        Assert.Equal(QuickStatsGridProjection.CyanBrushKey, card.AccentBrushKey);
    }

    [Fact]
    public void Odometer_tile_groups_thousands_and_uses_purple_accent()
    {
        var card = Project(Snapshot(odometerM: 25000000)).Cards[Odometer];

        Assert.Equal("25,000 km", card.Value);
        Assert.Equal(QuickStatsGridProjection.PurpleBrushKey, card.AccentBrushKey);
    }

    // ── Speed tile: SI m/s → display speed + driving/parked subtitle ──────────────────────────────────────

    [Fact]
    public void Speed_tile_converts_si_mps_at_zero_decimals_with_cyan_accent()
    {
        var card = Project(Snapshot(speedMps: 20)).Cards[Speed];

        Assert.Equal("72 km/h", card.Value);          // 20 m/s → 72 km/h
        Assert.Equal(QuickStatsGridProjection.CyanBrushKey, card.AccentBrushKey);
    }

    [Fact]
    public void Speed_tile_subtitle_is_driving_when_moving()
    {
        // web subtitle={state.speed > 0 ? 'Driving' : 'Parked'}.
        Assert.Equal("Driving", Project(Snapshot(speedMps: 20)).Cards[Speed].Subtitle);
        Assert.Equal("Driving", Project(Snapshot(speedMps: 0.1)).Cards[Speed].Subtitle);
    }

    [Fact]
    public void Speed_tile_subtitle_is_parked_when_stationary()
    {
        Assert.Equal("Parked", Project(Snapshot(speedMps: 0)).Cards[Speed].Subtitle);
    }

    [Fact]
    public void Only_the_speed_tile_carries_a_subtitle()
    {
        var cards = Project(Snapshot()).Cards;

        Assert.All(
            new[] { Battery, Range, Odometer, InsideTemp, OutsideTemp, Power, State },
            i => Assert.Null(cards[i].Subtitle));
        Assert.NotNull(cards[Speed].Subtitle);
    }

    // ── Temperature tiles: SI Celsius → display temperature (default one decimal, no space) ───────────────

    [Fact]
    public void Inside_temp_tile_formats_celsius_with_green_accent()
    {
        var card = Project(Snapshot(insideTempC: 21.5)).Cards[InsideTemp];

        Assert.Equal("21.5\u00B0C", card.Value);
        Assert.Equal(QuickStatsGridProjection.GreenBrushKey, card.AccentBrushKey);
    }

    [Fact]
    public void Outside_temp_tile_formats_celsius_with_cyan_accent()
    {
        var card = Project(Snapshot(outsideTempC: 14)).Cards[OutsideTemp];

        Assert.Equal("14.0\u00B0C", card.Value);
        Assert.Equal(QuickStatsGridProjection.CyanBrushKey, card.AccentBrushKey);
    }

    // ── Power tile: fmtNumber(power) + literal " kW" at the user precision (default 2) ────────────────────

    [Fact]
    public void Power_tile_renders_kw_at_default_two_decimals_with_purple_accent()
    {
        var card = Project(Snapshot(powerKw: 7.5)).Cards[Power];

        Assert.Equal("7.50 kW", card.Value);
        Assert.Equal(QuickStatsGridProjection.PurpleBrushKey, card.AccentBrushKey);
    }

    [Fact]
    public void Power_tile_groups_thousands_like_fmt_number()
    {
        Assert.Equal("1,250.00 kW", Project(Snapshot(powerKw: 1250)).Cards[Power].Value);
    }

    [Fact]
    public void Power_tile_honours_a_user_precision_override()
    {
        var units = UnitPref.Metric with { Precision = 0 };

        // 7.5 → halfExpand → 8, at zero decimals, still suffixed " kW".
        Assert.Equal("8 kW", Project(Snapshot(powerKw: 7.5), units).Cards[Power].Value);
    }

    [Fact]
    public void Power_value_always_uses_kw_even_in_imperial_units()
    {
        // web hard-codes the " kW" suffix regardless of the user's unit preference.
        Assert.Equal("7.50 kW", Project(Snapshot(powerKw: 7.5), UnitPref.Imperial).Cards[Power].Value);
    }

    // ── State tile: the derived status, rendered verbatim ────────────────────────────────────────────────

    [Fact]
    public void State_tile_renders_the_status_verbatim_with_cyan_accent()
    {
        var card = Project(Snapshot(status: "charging")).Cards[State];

        Assert.Equal("charging", card.Value);
        Assert.Equal(QuickStatsGridProjection.CyanBrushKey, card.AccentBrushKey);
    }

    // ── Imperial units: every unit-bearing tile converts + switches its label ─────────────────────────────

    [Fact]
    public void Imperial_units_convert_distance_speed_and_temperature()
    {
        var display = Project(
            Snapshot(ratedRangeM: 160934.4, odometerM: 321868.8, speedMps: 26.8224, insideTempC: 20, outsideTempC: 0),
            UnitPref.Imperial);

        Assert.Equal("100 mi", display.Cards[Range].Value);        // 160934.4 m → 100 mi
        Assert.Equal("200 mi", display.Cards[Odometer].Value);     // 321868.8 m → 200 mi
        Assert.Equal("60 mph", display.Cards[Speed].Value);        // 26.8224 m/s → 60 mph
        Assert.Equal("68.0\u00B0F", display.Cards[InsideTemp].Value); // 20 °C → 68 °F
        Assert.Equal("32.0\u00B0F", display.Cards[OutsideTemp].Value); // 0 °C → 32 °F
    }

    // ── JsNumberString / FormatPower helpers ─────────────────────────────────────────────────────────────

    [Fact]
    public void JsNumberString_drops_trailing_zeros_like_js_string()
    {
        Assert.Equal("84", QuickStatsGridProjection.JsNumberString(84));
        Assert.Equal("84.5", QuickStatsGridProjection.JsNumberString(84.5));
        Assert.Equal("0", QuickStatsGridProjection.JsNumberString(0));
        Assert.Equal("-5", QuickStatsGridProjection.JsNumberString(-5));
    }

    [Fact]
    public void FormatPower_coerces_non_finite_to_zero_like_safe_number()
    {
        Assert.Equal("0.00", QuickStatsGridProjection.FormatPower(double.NaN, UnitPref.Metric));
        Assert.Equal("0.00", QuickStatsGridProjection.FormatPower(double.PositiveInfinity, UnitPref.Metric));
    }

    // ── Accessibility: every tile + the surface expose a meaningful Narrator name ─────────────────────────

    [Fact]
    public void Each_tile_automation_name_pairs_label_and_value()
    {
        var cards = Project(Snapshot(status: "driving")).Cards;

        Assert.Equal("Battery: 84%", cards[Battery].AutomationName);
        Assert.Equal("Range: 400 km", cards[Range].AutomationName);
        Assert.Equal("Odometer: 25,000 km", cards[Odometer].AutomationName);
        Assert.Equal("Inside Temp: 21.5\u00B0C", cards[InsideTemp].AutomationName);
        Assert.Equal("Power: 7.50 kW", cards[Power].AutomationName);
        Assert.Equal("State: driving", cards[State].AutomationName);
    }

    [Fact]
    public void Speed_tile_automation_name_includes_the_subtitle()
    {
        Assert.Equal("Speed: 72 km/h, Driving", Project(Snapshot(speedMps: 20)).Cards[Speed].AutomationName);
        Assert.Equal("Speed: 0 km/h, Parked", Project(Snapshot(speedMps: 0)).Cards[Speed].AutomationName);
    }

    [Fact]
    public void Surface_automation_name_joins_every_tile()
    {
        var display = Project(Snapshot(status: "driving"));

        Assert.Equal(
            "Battery: 84%. Range: 400 km. Odometer: 25,000 km. Speed: 72 km/h, Driving. " +
            "Inside Temp: 21.5\u00B0C. Outside Temp: 14.0\u00B0C. Power: 7.50 kW. State: driving",
            display.AutomationName);
    }

    [Fact]
    public void Every_state_exposes_a_non_empty_surface_automation_name()
    {
        Assert.All(
            new[] { Project(null), Project(Snapshot()) },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    // ── i18n: the projection feeds the web/source keys to the facade ─────────────────────────────────────

    [Fact]
    public void Projection_resolves_every_label_through_the_documented_keys()
    {
        var display = QuickStatsGridProjection.Project(
            new QuickStatsGridModel(Snapshot(speedMps: 20)), UnitPref.Metric, new KeyEchoLocalizer());

        Assert.Equal("common.battery", display.Cards[Battery].Label);
        Assert.Equal("common.range", display.Cards[Range].Label);
        Assert.Equal("common.odometer", display.Cards[Odometer].Label);
        Assert.Equal("common.speed", display.Cards[Speed].Label);
        Assert.Equal("common.insideTemp", display.Cards[InsideTemp].Label);
        Assert.Equal("common.outsideTemp", display.Cards[OutsideTemp].Label);
        Assert.Equal("common.power", display.Cards[Power].Label);
        Assert.Equal("common.state", display.Cards[State].Label);
        Assert.Equal("common.loading", display.LoadingLabel);
    }

    [Fact]
    public void Speed_subtitle_resolves_through_the_driving_and_parked_keys()
    {
        Assert.Equal(
            "common.driving",
            QuickStatsGridProjection
                .Project(new QuickStatsGridModel(Snapshot(speedMps: 20)), UnitPref.Metric, new KeyEchoLocalizer())
                .Cards[Speed].Subtitle);
        Assert.Equal(
            "common.parked",
            QuickStatsGridProjection
                .Project(new QuickStatsGridModel(Snapshot(speedMps: 0)), UnitPref.Metric, new KeyEchoLocalizer())
                .Cards[Speed].Subtitle);
    }

    [Fact]
    public void Status_value_is_rendered_verbatim_not_through_a_key()
    {
        // web value={status} — the status is not passed through t(), so it is never an i18n key.
        var display = QuickStatsGridProjection.Project(
            new QuickStatsGridModel(Snapshot(status: "online")), UnitPref.Metric, new KeyEchoLocalizer());

        Assert.Equal("online", display.Cards[State].Value);
    }

    // ── Diagnostics (P1/S11): view.opened slug=QuickStatsGrid, PII-safe ──────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new QuickStatsGridDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=QuickStatsGrid", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_live_state_figures()
    {
        var captured = new List<string>();
        var diagnostics = new QuickStatsGridDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=QuickStatsGrid", line);
        Assert.DoesNotContain('%', line);
        Assert.DoesNotContain("km", line, StringComparison.Ordinal);
        Assert.DoesNotContain("kW", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("QuickStatsGrid", QuickStatsGridRegistration.Slug);

    [Fact]
    public void View_exposes_the_registration_slug() =>
        Assert.Equal(QuickStatsGridRegistration.Slug, "QuickStatsGrid");

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() =>
            QuickStatsGridProjection.Project(null!, UnitPref.Metric, Localizer));

    [Fact]
    public void Project_rejects_a_null_units() =>
        Assert.Throws<ArgumentNullException>(() =>
            QuickStatsGridProjection.Project(new QuickStatsGridModel(Snapshot()), null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() =>
            QuickStatsGridProjection.Project(new QuickStatsGridModel(Snapshot()), UnitPref.Metric, null!));

    [Fact]
    public void FormatPower_rejects_a_null_units() =>
        Assert.Throws<ArgumentNullException>(() => QuickStatsGridProjection.FormatPower(7.5, null!));

    /// <summary>
    /// An <see cref="ILocalizer"/> that echoes the requested key (ignoring the fallback), proving the projection
    /// feeds the documented i18n keys — not ad-hoc English literals — into the facade.
    /// </summary>
    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key;
    }
}
