using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Battery;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the WinUI <c>ProjectedRangePage</c>'s UI-thread-free logic — the range-projection
/// JSON parse adapter, the SI→display projection (hero cards, efficiency gauge, projection-curve series +
/// current-SoC reference line, scenario cards, efficiency heatmap, what-if interpolation, range factors,
/// tips), the cache-then-network result mapper, the state-holder view-model's per-state transitions
/// (loading / loaded / empty / error / stale / offline), the interactive what-if reprojection, the i18n key
/// coverage, the registration metadata and the diagnostics. Mirrors the web spec
/// (web/src/features/battery/pages/ProjectedRangePage.tsx).
/// </summary>
public sealed class ProjectedRangePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    /// <summary>Every visible literal the page renders (web key names) — parity string coverage (27).</summary>
    private static readonly (string Key, string Fallback)[] RequiredStrings =
    [
        ("range.battery", "Battery"),
        ("range.current", "Current"),
        ("range.efficiency", "Efficiency"),
        ("range.efficiencyMatrix", "Personal Efficiency Matrix (Wh/km)"),
        ("range.factors", "Range Factors"),
        ("range.healthFactor", "Health Factor"),
        ("range.noMatrix", "Efficiency data requires drives in different conditions."),
        ("range.noScenarios", "Drive more to see personalized scenario projections."),
        ("range.noWhatIf", "Adjust sliders to calculate projected range."),
        ("range.projected", "Projected Range"),
        ("range.projectionCurve", "Range Projection Curve"),
        ("range.rated", "Rated Range"),
        ("range.scenarios", "Range Scenarios"),
        ("range.speed", "Speed"),
        ("range.subtitle", "Personalized range estimates based on your driving patterns, weather, and conditions"),
        ("range.temperature", "Temperature"),
        ("range.teslaEstimate", "Tesla Estimate"),
        ("range.tip.elevation", "Plan routes to minimize elevation changes."),
        ("range.tip.precondition", "Pre-condition the cabin while still plugged in."),
        ("range.tip.seatHeaters", "Use seat heaters instead of cabin heat in cold weather."),
        ("range.tip.speed", "Keep speed under 110 km/h for optimal efficiency."),
        ("range.tips", "Tips to Maximize Range"),
        ("range.title", "Projected Range"),
        ("range.usableCapacity", "Usable Capacity"),
        ("range.whatIf", "What If Calculator"),
        ("range.whatIfConditions", "at {0} km/h, {1}\u00B0C"),
        ("range.yourEstimate", "Your Estimate"),
    ];

    private static RangeProjection Sample() => new(
        CurrentRangeKm: 320,
        ProjectedRangeKm: 300,
        BatteryLevel: 72,
        EfficiencyFactor: 0.82,
        CurrentBatteryPct: 72,
        UsableCapacityWh: 75_000,
        HealthFactor: 0.94,
        TeslaEstimateKm: 410,
        YourEstimateKm: 380,
        AccuracyNote: "Based on 42 recent drives",
        Factors:
        [
            new RangeFactor("temperature", -8.5, "Cold weather reduces range"),
            new RangeFactor("speed", 3.2, "Steady highway speed helps"),
        ],
        ProjectionCurve:
        [
            new RangeCurvePoint(100, 500, 470),
            new RangeCurvePoint(50, 250, 235),
            new RangeCurvePoint(0, 0, 0),
        ],
        Scenarios:
        [
            new RangeScenario("Highway", 110, 5, 190, 360, 224, 8, ["sentry"], false),
            new RangeScenario("City", 40, 20, 150, 450, 280, 0, [], true),
        ],
        EfficiencyMatrix:
        [
            new RangeEfficiencyBucket("mild", "suburban", 160, 12),
            new RangeEfficiencyBucket("hot", "highway", 215, 4),
        ]);

    private static RangeProjectionDisplay Project(
        RangeProjection data,
        double speed = RangeProjectionProjection.DefaultWhatIfSpeedKmh,
        double temp = RangeProjectionProjection.DefaultWhatIfTempC,
        UnitPref? units = null) =>
        RangeProjectionProjection.Project(data, speed, temp, units ?? UnitPref.Metric, Localizer);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_fields()
    {
        const string json = """
        {"current_range_km":320,"projected_range_km":300,"battery_level":72,"efficiency_factor":0.82,
         "current_battery_pct":71,"usable_capacity_wh":75000,"health_factor":0.94,"tesla_estimate_km":410,
         "your_estimate_km":380,"accuracy_note":"note",
         "factors":[{"name":"temperature","impact_pct":-8.5,"description":"cold"}],
         "projection_curve":[{"battery_pct":100,"rated_range":500,"projected_range":470}],
         "scenarios":[{"name":"Highway","speed_kmh":110,"temp_c":5,"efficiency_wh_km":190,"range_km":360,
            "range_mi":224,"sample_count":8,"extras":["sentry"],"is_current":true}],
         "efficiency_matrix":[{"temp_bucket":"mild","speed_bucket":"suburban","wh_km":160,"samples":12}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var data = RangeProjection.FromJson(doc.RootElement);

        Assert.Equal(320, data.CurrentRangeKm);
        Assert.Equal(0.82, data.EfficiencyFactor);
        Assert.Equal(71, data.CurrentBatteryPct);
        Assert.Equal(75_000, data.UsableCapacityWh);
        Assert.Equal(410, data.TeslaEstimateKm);
        Assert.Equal("note", data.AccuracyNote);
        Assert.Single(data.Factors);
        Assert.Equal("temperature", data.Factors[0].Name);
        Assert.Single(data.ProjectionCurve);
        Assert.Equal(470, data.ProjectionCurve[0].ProjectedRangeKm);
        var scenario = Assert.Single(data.Scenarios);
        Assert.True(scenario.IsCurrent);
        Assert.Equal("sentry", Assert.Single(scenario.Extras));
        var bucket = Assert.Single(data.EfficiencyMatrix);
        Assert.Equal("mild", bucket.TempBucket);
        Assert.Equal(12, bucket.Samples);
    }

    [Fact]
    public void FromJson_tolerates_missing_and_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        var data = RangeProjection.FromJson(doc.RootElement);

        Assert.True(data.IsEmpty);
        Assert.Empty(data.Factors);
        Assert.Empty(data.ProjectionCurve);
        Assert.Empty(data.Scenarios);
        Assert.Empty(data.EfficiencyMatrix);
        Assert.Equal(1, data.HealthFactor); // health defaults to 1.0
    }

    // ---- Hero projection -----------------------------------------------------------

    [Fact]
    public void Projection_hero_cards_metric()
    {
        var d = Project(Sample());

        Assert.Equal("380 km", d.YourEstimate.Value);
        Assert.Equal("410 km", d.TeslaEstimate.Value);
        Assert.Equal("72%", d.Battery.Value);
        Assert.Equal("94.0%", d.HealthFactor.Value);
        Assert.Contains("Wh", d.UsableCapacity.Value, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_hero_cards_imperial_convert_distance()
    {
        var d = Project(Sample(), units: UnitPref.Imperial);

        // 380 km ≈ 236 mi, 410 km ≈ 255 mi — restated at the display boundary.
        Assert.EndsWith("mi", d.YourEstimate.Value, StringComparison.Ordinal);
        Assert.EndsWith("mi", d.TeslaEstimate.Value, StringComparison.Ordinal);
        Assert.Contains("236", d.YourEstimate.Value, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(0.95, 1)]
    [InlineData(0.80, 3)]
    [InlineData(0.50, 5)]
    public void Projection_efficiency_gauge_color_thresholds(double factor, int expectedIndex)
    {
        var data = Sample() with { EfficiencyFactor = factor };
        var d = Project(data);

        Assert.Equal(Math.Round(factor * 100), d.EfficiencyValue);
        Assert.Equal(expectedIndex, d.EfficiencyColorIndex);
    }

    // ---- Curve / scenarios / matrix ------------------------------------------------

    [Fact]
    public void Projection_curve_has_rated_and_projected_series_plus_current_reference()
    {
        var d = Project(Sample());

        Assert.True(d.HasCurve);
        Assert.Equal(2, d.CurveSeries.Count);
        Assert.All(d.CurveSeries, s => Assert.Equal(ChartSeriesKind.Area, s.Kind));
        var annotation = Assert.Single(d.CurveAnnotations);
        Assert.Equal(ChartAnnotationKind.VerticalLine, annotation.Kind);
        Assert.Equal(72, annotation.Value); // battery_level
        Assert.Equal("Current", annotation.Label);
    }

    [Fact]
    public void Projection_scenarios_format_and_flag_current()
    {
        var d = Project(Sample());

        Assert.True(d.HasScenarios);
        Assert.Equal(2, d.Scenarios.Count);
        var city = d.Scenarios[1];
        Assert.Equal("City", city.Name);
        Assert.True(city.IsCurrent);
        Assert.Equal("450 km", city.RangeValue);
        Assert.Equal("40 km/h", city.SpeedValue);
        Assert.Equal("20\u00B0C", city.TempValue);
        Assert.Contains("Wh/km", city.EfficiencyValue, StringComparison.Ordinal);
        Assert.Equal(string.Empty, city.SamplesValue); // 0 drives → no sample label
    }

    [Fact]
    public void Projection_scenarios_empty_message_when_none()
    {
        var d = Project(Sample() with { Scenarios = Array.Empty<RangeScenario>() });

        Assert.False(d.HasScenarios);
        Assert.Equal("Drive more to see personalized scenario projections.", d.NoScenariosMessage);
    }

    [Fact]
    public void Projection_matrix_fills_grid_with_severity_and_blanks()
    {
        var d = Project(Sample());

        Assert.True(d.HasMatrix);
        Assert.Equal(3, d.MatrixSpeedHeaders.Count);
        Assert.Equal(4, d.MatrixRows.Count); // freezing / cold / mild / hot

        var mild = d.MatrixRows[2];
        Assert.Equal("Mild", mild.TempLabel);
        var mildSuburban = mild.Cells[1]; // suburban column
        Assert.True(mildSuburban.HasData);
        Assert.Equal("160", mildSuburban.Value);
        Assert.Equal("(12)", mildSuburban.Samples);
        Assert.Equal(1, mildSuburban.Severity); // <=180 → good

        var hot = d.MatrixRows[3];
        Assert.Equal(3, hot.Cells[2].Severity); // 215 Wh/km highway → poor
        Assert.False(mild.Cells[0].HasData); // mild/city had no bucket
        Assert.Equal("\u2014", mild.Cells[0].Value);
    }

    // ---- What-if interpolation -----------------------------------------------------

    [Fact]
    public void InterpolateRange_uses_matching_bucket()
    {
        var matrix = new RangeEfficiencyBucket[] { new("mild", "suburban", 160, 12) };

        var (eff, range) = RangeProjectionProjection.InterpolateRange(matrix, speedKmh: 80, tempC: 20, batteryPct: 80, capacityWh: 75_000);

        Assert.Equal(160, eff);
        Assert.Equal(375, range); // 75000 * 0.8 / 160
    }

    [Fact]
    public void InterpolateRange_falls_back_to_heuristic_without_match()
    {
        var (eff, range) = RangeProjectionProjection.InterpolateRange(
            Array.Empty<RangeEfficiencyBucket>(), speedKmh: 80, tempC: 20, batteryPct: 80, capacityWh: 75_000);

        // 155 + (80-35)*0.5 + max(0,20-20)*1.5 = 177.5
        Assert.Equal(177.5, eff);
        Assert.Equal(338, range); // round(75000*0.8/177.5)
    }

    [Fact]
    public async Task WhatIf_reprojects_when_sliders_change()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();
        string before = vm.Display.WhatIfRangeValue;

        vm.WhatIfSpeedKmh = 140;

        Assert.NotEqual(before, vm.Display.WhatIfRangeValue);
        Assert.Contains("140", vm.Display.WhatIfConditions, StringComparison.Ordinal);
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void ResultMapper_preserves_status_and_parses_value()
    {
        using var doc = JsonDocument.Parse("""{"your_estimate_km":380}""");
        var cached = RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true);

        var mapped = RangeProjectionResultMapper.Map(cached);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.Equal(380, mapped.Value!.YourEstimateKm);
    }

    [Fact]
    public void ResultMapper_preserves_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Empty, RangeProjectionResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);

        var error = new RepositoryError(RepositoryErrorKind.Server, "boom");
        Assert.Equal(LoadStatus.Error, RangeProjectionResultMapper.Map(RepositoryResult<JsonElement>.Failure(error)).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_to_loaded()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(RangeProjectionState.Loaded, vm.State);
        Assert.True(vm.HasContent);
        Assert.Equal("380 km", vm.Display.YourEstimate.Value);
    }

    [Fact]
    public async Task ViewModel_empty_source_yields_empty()
    {
        using var vm = new ProjectedRangePageViewModel(EmptyRangeProjectionSource.Instance, Localizer);
        await vm.LoadAsync();

        Assert.Equal(RangeProjectionState.Empty, vm.State);
        Assert.False(vm.HasContent);
    }

    [Fact]
    public async Task ViewModel_failure_yields_error()
    {
        using var vm = NewViewModel(RepositoryResult<RangeProjection>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(RangeProjectionState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_offline_keeps_content_with_message()
    {
        var offline = RepositoryResult<RangeProjection>.OfflineCached(Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "net"));
        using var vm = NewViewModel(offline);
        await vm.LoadAsync();

        Assert.Equal(RangeProjectionState.Offline, vm.State);
        Assert.True(vm.HasContent);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_keeps_content()
    {
        var cached = RepositoryResult<RangeProjection>.Cached(Sample(), Now, stale: true);
        using var vm = NewViewModel(cached);
        await vm.LoadAsync();

        Assert.Equal(RangeProjectionState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasContent);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ProjectedRangePageViewModel.State), changed);
        Assert.Contains(nameof(ProjectedRangePageViewModel.Display), changed);
    }

    // ---- i18n coverage / registration / diagnostics --------------------------------

    [Fact]
    public void Projection_surfaces_all_required_strings()
    {
        var d = Project(Sample());
        var rendered = new HashSet<string>(StringComparer.Ordinal)
        {
            d.Title, d.Subtitle, d.YourEstimate.Label, d.TeslaEstimate.Label, d.Battery.Label,
            d.UsableCapacity.Label, d.HealthFactor.Label, d.EfficiencyLabel, d.CurveTitle, d.RatedName,
            d.ProjectedName, d.CurrentLabel, d.ScenariosTitle, d.NoScenariosMessage, d.MatrixTitle,
            d.NoMatrixMessage, d.WhatIfTitle, d.SpeedLabel, d.TemperatureLabel, d.NoWhatIfMessage,
            d.FactorsTitle, d.TipsTitle,
        };
        foreach (var tip in d.Tips)
        {
            rendered.Add(tip.Text);
        }

        // What-if conditions resolves the {0}/{1} template with the active slider values.
        Assert.Equal("at 80 km/h, 20\u00B0C", d.WhatIfConditions);

        foreach (var (key, fallback) in RequiredStrings)
        {
            if (key == "range.whatIfConditions")
            {
                continue; // asserted above (formatted)
            }

            Assert.True(rendered.Contains(fallback), $"required string not surfaced: {key} → '{fallback}'");
        }
    }

    [Fact]
    public void Registration_matches_web_route()
    {
        Assert.Equal("ProjectedRange", ProjectedRangePageRegistration.RouteName);
        Assert.Equal("ProjectedRangePage", ProjectedRangePageRegistration.Slug);
        Assert.Equal("Projected Range", ProjectedRangePageRegistration.Title(Localizer));
        Assert.Contains("Personalized", ProjectedRangePageRegistration.Subtitle(Localizer), StringComparison.Ordinal);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ProjectedRangePageDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ProjectedRangePage", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<RangeProjection> Loaded(RangeProjection data) =>
        RepositoryResult<RangeProjection>.Loaded(data, Now);

    private static ProjectedRangePageViewModel NewViewModel(params RepositoryResult<RangeProjection>[] emissions) =>
        new(new FakeRangeProjectionSource(emissions), Localizer, UnitPref.Metric);

    private sealed class FakeRangeProjectionSource(params RepositoryResult<RangeProjection>[] emissions) : IRangeProjectionSource
    {
        public async IAsyncEnumerable<RepositoryResult<RangeProjection>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
            }

            await Task.CompletedTask.ConfigureAwait(false);
        }
    }
}
