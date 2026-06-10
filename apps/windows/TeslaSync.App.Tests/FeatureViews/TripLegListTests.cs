using System.Collections.Generic;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TripLegList</c> feature surface's UI-thread-free logic — the tolerant JSON
/// parse adapter (<c>TripLegListModel.FromJson</c> and the per-row <c>FromJson</c> helpers), the ready / empty
/// branch projection, the web-faithful formatting (distance <c>.toFixed(1)</c>, the verbatim
/// <c>Math.round(duration_s)</c> "min" leg duration, the shared <c>formatEnergy(…, { precision: 1 })</c> kWh
/// output, the <c>formatCurrency</c> cost, the SoC rounding and the low-SoC tint flag), the charge-stop
/// interleaving (<c>idx &lt; stops.length</c>), the endpoint-label coordinate fallback, the localized catalog
/// keys, the composed Narrator names and the diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/TripLegList.tsx). The WinUI view itself
/// (feature-views\TripLegList\TripLegList.cs) is exercised by the app build.
/// </summary>
public sealed class TripLegListTests
{
    private const string EmDash = "\u2014";
    private const string Arrow = "\u2192";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static TripLegSnapshot Leg(
        string? fromName = "San Francisco",
        string? toName = "Los Angeles",
        double distanceM = 25000,
        double durationS = 1800,
        double energyWh = 12000,
        double startSoc = 84.6,
        double arrivalSoc = 18.4) =>
        new(
            new TripLegLocationSnapshot(37.7749, -122.4194, fromName),
            new TripLegLocationSnapshot(34.0522, -118.2437, toName),
            distanceM,
            durationS,
            energyWh,
            startSoc,
            arrivalSoc);

    private static TripChargeStopSnapshot Stop(
        string name = "Harris Ranch Supercharger",
        double from = 18.4,
        double to = 80.2,
        double durationS = 1500,
        double energyWh = 45000,
        double cost = 12.5,
        bool recommended = true) =>
        new(name, from, to, durationS, energyWh, cost, recommended);

    private static TripLegListModel Model(
        IReadOnlyList<TripLegSnapshot>? legs = null,
        IReadOnlyList<TripChargeStopSnapshot>? stops = null,
        DistanceUnit unit = DistanceUnit.Km) =>
        new(legs ?? [Leg()], stops ?? [Stop()], unit);

    private static TripLegListDisplay Project(TripLegListModel model, string? currency = null, int precision = 2) =>
        TripLegListProjection.Project(model, Localizer, currency, precision);

    // ── Parse adapter (cached JSON → model) ─────────────────────────────────────────────────────────

    [Fact]
    public void FromJson_reads_legs_and_charge_stops()
    {
        const string json = """
        {
          "legs": [
            {
              "from": { "lat": 37.7749, "lng": -122.4194, "name": "San Francisco" },
              "to":   { "lat": 36.3300, "lng": -119.2900, "name": "Harris Ranch" },
              "distance_m": 250000,
              "duration_s": 9000,
              "energy_wh": 48000,
              "start_soc": 90,
              "arrival_soc": 22
            }
          ],
          "charge_stops": [
            {
              "name": "Harris Ranch Supercharger",
              "location": { "lat": 36.33, "lng": -119.29, "name": "Harris Ranch" },
              "charge_from_soc": 22,
              "charge_to_soc": 80,
              "charge_duration_s": 1500,
              "energy_wh": 45000,
              "cost": 12.5,
              "is_recommended": true
            }
          ]
        }
        """;
        using var doc = JsonDocument.Parse(json);

        var model = TripLegListModel.FromJson(doc.RootElement, DistanceUnit.Km);

        Assert.Single(model.Legs);
        Assert.Single(model.ChargeStops);
        Assert.Equal("San Francisco", model.Legs[0].From.Name);
        Assert.Equal(250000, model.Legs[0].DistanceM);
        Assert.Equal(48000, model.Legs[0].EnergyWh);
        Assert.Equal("Harris Ranch Supercharger", model.ChargeStops[0].Name);
        Assert.True(model.ChargeStops[0].IsRecommended);
        Assert.Equal(12.5, model.ChargeStops[0].Cost);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_arrays_and_fields()
    {
        using var doc = JsonDocument.Parse("""{"legs":"nope"}""");

        var model = TripLegListModel.FromJson(doc.RootElement);

        Assert.Empty(model.Legs);
        Assert.Empty(model.ChargeStops);
    }

    [Fact]
    public void Leg_FromJson_defaults_missing_endpoints_and_numbers()
    {
        using var doc = JsonDocument.Parse("""{"distance_m":1000}""");

        var leg = TripLegSnapshot.FromJson(doc.RootElement);

        Assert.Equal(TripLegLocationSnapshot.Unknown, leg.From);
        Assert.Equal(TripLegLocationSnapshot.Unknown, leg.To);
        Assert.Equal(1000, leg.DistanceM);
        Assert.Equal(0, leg.EnergyWh);
    }

    [Fact]
    public void ChargeStop_FromJson_defaults_recommended_to_false()
    {
        using var doc = JsonDocument.Parse("""{"name":"Stop A","cost":5}""");

        var stop = TripChargeStopSnapshot.FromJson(doc.RootElement);

        Assert.Equal("Stop A", stop.Name);
        Assert.Equal(5, stop.Cost);
        Assert.False(stop.IsRecommended);
    }

    [Fact]
    public void FromJson_cached_payload_projects_into_a_ready_display()
    {
        const string json = """
        { "legs": [ { "from": {}, "to": {}, "distance_m": 25000, "duration_s": 1800,
          "energy_wh": 12000, "start_soc": 85, "arrival_soc": 18 } ], "charge_stops": [] }
        """;
        using var doc = JsonDocument.Parse(json);

        var display = Project(TripLegListModel.FromJson(doc.RootElement, DistanceUnit.Km));

        Assert.Equal(TripLegListState.Ready, display.State);
        Assert.Equal("25.0 km", Assert.Single(display.Items).DistanceText);
    }

    // ── Empty branch (web legItems.length === 0) ────────────────────────────────────────────────────

    [Fact]
    public void Project_empty_when_no_legs()
    {
        var display = Project(TripLegListModel.Empty);

        Assert.Equal(TripLegListState.Empty, display.State);
        Assert.Equal(TripLegListProjection.TitleFallback, display.Title);
        Assert.Equal(TripLegListProjection.EmptyFallback, display.EmptyMessage);
        Assert.Empty(display.Items);
        Assert.Contains(TripLegListProjection.EmptyFallback, display.AutomationName);
    }

    // ── Ready branch (web list render) ──────────────────────────────────────────────────────────────

    [Fact]
    public void Project_ready_formats_every_leg_metric()
    {
        var display = Project(Model(legs: [Leg()], stops: []));

        Assert.Equal(TripLegListState.Ready, display.State);
        var leg = Assert.Single(display.Items);

        Assert.Equal("1", leg.Index);
        Assert.Equal("San Francisco", leg.FromLabel);
        Assert.Equal("Los Angeles", leg.ToLabel);
        Assert.Equal("25.0 km", leg.DistanceText);
        Assert.Equal("1800 min", leg.DurationText); // web parity: Math.round(duration_s) with a "min" suffix
        Assert.Equal("12.0 kWh", leg.EnergyText);
        Assert.Equal("85%", leg.StartSocText);
        Assert.Equal("18%", leg.ArrivalSocText);
        Assert.True(leg.ArrivalIsLow);
        Assert.Null(leg.ChargeStop);
    }

    [Fact]
    public void Project_distance_follows_the_user_unit()
    {
        var display = Project(Model(legs: [Leg(distanceM: 1609.344)], stops: [], unit: DistanceUnit.Mi));

        Assert.Equal("1.0 mi", Assert.Single(display.Items).DistanceText);
    }

    [Theory]
    [InlineData(45, false)]  // arrival >= 20 → warning tint
    [InlineData(20, false)]  // boundary: not below the threshold
    [InlineData(19.9, true)] // below the threshold → danger tint
    public void Project_arrival_low_flag_matches_web_threshold(double arrivalSoc, bool expectedLow)
    {
        var display = Project(Model(legs: [Leg(arrivalSoc: arrivalSoc)], stops: []));

        Assert.Equal(expectedLow, Assert.Single(display.Items).ArrivalIsLow);
    }

    [Fact]
    public void Project_endpoint_label_falls_back_to_rounded_coordinates()
    {
        var display = Project(Model(legs: [Leg(fromName: null, toName: "")], stops: []));

        var leg = Assert.Single(display.Items);
        Assert.Equal("37.77, -122.42", leg.FromLabel);
        Assert.Equal("34.05, -118.24", leg.ToLabel);
    }

    // ── Charge stop projection ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_charge_stop_formats_every_field()
    {
        var display = Project(Model(legs: [Leg()], stops: [Stop()]), currency: "$", precision: 2);

        var stop = Assert.Single(display.Items).ChargeStop;
        Assert.NotNull(stop);
        Assert.Equal("Harris Ranch Supercharger", stop!.Name);
        Assert.Equal("25 min", stop.DurationText); // web parity: Math.round(charge_duration_s / 60)
        Assert.Equal($"18% {Arrow} 80%", stop.SocRangeText);
        Assert.Equal("45.0 kWh", stop.EnergyText);
        Assert.Equal("$12.50", stop.CostText);
        Assert.True(stop.IsRecommended);
        Assert.Equal(TripLegListProjection.RecommendedFallback, stop.RecommendedText);
    }

    [Fact]
    public void Project_charge_stop_respects_currency_and_precision()
    {
        var display = Project(Model(legs: [Leg()], stops: [Stop(cost: 9.4)]), currency: "\u20AC", precision: 0);

        Assert.Equal("\u20AC9", Assert.Single(display.Items).ChargeStop!.CostText);
    }

    [Fact]
    public void Project_non_recommended_stop_hides_the_note()
    {
        var display = Project(Model(legs: [Leg()], stops: [Stop(recommended: false)]));

        var stop = Assert.Single(display.Items).ChargeStop;
        Assert.NotNull(stop);
        Assert.False(stop!.IsRecommended);
        Assert.Equal(string.Empty, stop.RecommendedText);
    }

    [Fact]
    public void Project_interleaves_a_stop_only_while_idx_is_in_range()
    {
        // Two legs, one stop: only the first leg carries a stop (web idx < stops.length).
        var display = Project(Model(legs: [Leg(), Leg()], stops: [Stop()]));

        Assert.Equal(2, display.Items.Count);
        Assert.NotNull(display.Items[0].ChargeStop);
        Assert.Null(display.Items[1].ChargeStop);
    }

    [Fact]
    public void Project_ignores_extra_stops_beyond_the_leg_count()
    {
        // One leg, two stops: only stops[0] is shown; stops[1] is never rendered.
        var display = Project(Model(legs: [Leg()], stops: [Stop(name: "First"), Stop(name: "Second")]));

        var leg = Assert.Single(display.Items);
        Assert.NotNull(leg.ChargeStop);
        Assert.Equal("First", leg.ChargeStop!.Name);
    }

    // ── Rounding / fixed-decimal helpers (web Math.round / .toFixed) ─────────────────────────────────

    [Theory]
    [InlineData(0, "0")]
    [InlineData(84.4, "84")]
    [InlineData(84.5, "85")]
    [InlineData(1800, "1800")]
    public void RoundToIntString_matches_js_math_round(double value, string expected)
    {
        Assert.Equal(expected, TripLegListProjection.RoundToIntString(value));
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public void RoundToIntString_non_finite_is_em_dash(double value)
    {
        Assert.Equal(EmDash, TripLegListProjection.RoundToIntString(value));
    }

    [Theory]
    [InlineData(25.0, 1, "25.0")]
    [InlineData(12.345, 1, "12.3")]
    [InlineData(37.7749, 2, "37.77")]
    [InlineData(-122.4194, 2, "-122.42")]
    public void Fixed_matches_js_to_fixed(double value, int digits, string expected)
    {
        Assert.Equal(expected, TripLegListProjection.Fixed(value, digits));
    }

    // ── Accessibility (Narrator names) ──────────────────────────────────────────────────────────────

    [Fact]
    public void Surface_automation_name_is_the_title_when_ready()
    {
        var display = Project(Model(legs: [Leg()], stops: []));

        Assert.Equal(display.Title, display.AutomationName);
    }

    [Fact]
    public void Leg_automation_name_composes_ordinal_route_and_metrics()
    {
        var leg = Assert.Single(Project(Model(legs: [Leg()], stops: [])).Items);

        Assert.StartsWith("1. ", leg.AutomationName);
        Assert.Contains($"San Francisco {Arrow} Los Angeles", leg.AutomationName);
        Assert.Contains(leg.DistanceText, leg.AutomationName);
        Assert.Contains(leg.DurationText, leg.AutomationName);
        Assert.Contains(leg.EnergyText, leg.AutomationName);
        Assert.Contains(leg.StartSocText, leg.AutomationName);
        Assert.Contains(leg.ArrivalSocText, leg.AutomationName);
    }

    [Fact]
    public void Stop_automation_name_composes_name_and_metrics()
    {
        var stop = Assert.Single(Project(Model(legs: [Leg()], stops: [Stop()])).Items).ChargeStop;

        Assert.NotNull(stop);
        Assert.Contains(stop!.Name, stop.AutomationName);
        Assert.Contains(stop.DurationText, stop.AutomationName);
        Assert.Contains(stop.CostText, stop.AutomationName);
        Assert.Contains(stop.RecommendedText, stop.AutomationName);
    }

    // ── i18n keys (every key resolves through the facade against the P1/S10 catalog) ────────────────

    [Fact]
    public void Projection_requests_the_catalog_keys()
    {
        var recorder = new RecordingLocalizer();

        TripLegListProjection.Project(Model(legs: [Leg()], stops: [Stop()]), recorder);
        TripLegListProjection.Project(TripLegListModel.Empty, recorder);

        Assert.Contains(TripLegListProjection.TitleKey, recorder.Keys);
        Assert.Contains(TripLegListProjection.EmptyKey, recorder.Keys);
        Assert.Contains(TripLegListProjection.DistanceKey, recorder.Keys);
        Assert.Contains(TripLegListProjection.DurationKey, recorder.Keys);
        Assert.Contains(TripLegListProjection.EnergyKey, recorder.Keys);
        Assert.Contains(TripLegListProjection.SocKey, recorder.Keys);
        Assert.Contains(TripLegListProjection.RecommendedKey, recorder.Keys);
        Assert.Contains(TripLegListProjection.MinKey, recorder.Keys);
    }

    [Fact]
    public void Catalog_keys_use_the_translation_namespace_from_the_web_source()
    {
        Assert.Equal("translation.tripPlanner.legs.title", TripLegListProjection.TitleKey);
        Assert.Equal("translation.tripPlanner.legs.empty", TripLegListProjection.EmptyKey);
        Assert.Equal("translation.tripPlanner.legs.distance", TripLegListProjection.DistanceKey);
        Assert.Equal("translation.tripPlanner.legs.duration", TripLegListProjection.DurationKey);
        Assert.Equal("translation.tripPlanner.legs.energy", TripLegListProjection.EnergyKey);
        Assert.Equal("translation.tripPlanner.legs.soc", TripLegListProjection.SocKey);
        Assert.Equal("translation.tripPlanner.legs.recommended", TripLegListProjection.RecommendedKey);
        Assert.Equal("translation.common.min", TripLegListProjection.MinKey);
    }

    // ── Diagnostics (PII-safe view.opened) ──────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened()
    {
        var emitted = new List<string>();
        var diagnostics = new TripLegListDiagnostics(emitted.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TripLegList", Assert.Single(emitted));
    }

    // ── Registration metadata ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_slug_and_glyphs()
    {
        Assert.Equal("TripLegList", TripLegListRegistration.Slug);
        Assert.Equal("\uE81D", TripLegListRegistration.MapPinGlyph);
        Assert.Equal("\uE72A", TripLegListRegistration.ArrowRightGlyph);
        Assert.Equal("\uE945", TripLegListRegistration.ZapGlyph);
        Assert.Equal("\uE823", TripLegListRegistration.ClockGlyph);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
