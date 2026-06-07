using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the BatteryDegradationForecastWidget's UI-thread-free logic — the JSON parse
/// adapter (forecast + risk factor), the health-tier / risk-glyph / score-impact helpers, the projection
/// across the compact / standard footprints, the cache-then-network result mapper, the per-vehicle data
/// source (primary resolution + query-scoped request), the registry metadata, the diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline)
/// including the web <c>hasData</c> gate. Mirrors the web spec
/// (web/src/features/dashboard/widgets/BatteryDegradationForecastWidget.tsx + api/hooks/useEnergy.ts).
/// </summary>
public sealed class BatteryDegradationForecastWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string EmDash = "\u2014";
    private const string MinusSign = "\u2212";

    private static DegradationRiskFactor Risk(string name, double score, string? label = null, string? detail = null) =>
        new(name, score, label, detail);

    private static DegradationForecast Forecast(
        double? currentHealthPct = 92.4,
        double rate = 0.08,
        bool hasProjected = true,
        DateTimeOffset? projected = null,
        IReadOnlyList<DegradationRiskFactor>? risks = null,
        IReadOnlyList<string>? recommendations = null) =>
        new(
            currentHealthPct,
            rate,
            hasProjected,
            projected ?? new DateTimeOffset(2028, 3, 1, 0, 0, 0, TimeSpan.Zero),
            risks ?? Array.Empty<DegradationRiskFactor>(),
            recommendations ?? Array.Empty<string>());

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_fields()
    {
        const string json = """
        {"current_health_pct":92.4,"current_health":80.0,"degradation_rate_pct_per_month":0.08,
         "projected_80pct_date":"2028-03-15T00:00:00Z",
         "risk_factors":[{"name":"High temperature exposure","score":8,"label":"Heat exposure","detail":"34 days >35°C"}],
         "recommendations":["Avoid DC fast charging above 80%","Park in shade"]}
        """;
        using var doc = JsonDocument.Parse(json);

        var forecast = DegradationForecast.FromJson(doc.RootElement);

        Assert.Equal(92.4, forecast.CurrentHealthPct);
        Assert.Equal(0.08, forecast.DegradationRatePctPerMonth);
        Assert.True(forecast.HasProjectedDate);
        Assert.Equal(2028, forecast.ProjectedDate!.Value.Year);
        Assert.Equal(3, forecast.ProjectedDate!.Value.Month);

        var rf = Assert.Single(forecast.RiskFactors);
        Assert.Equal("High temperature exposure", rf.Name);
        Assert.Equal(8, rf.Score);
        Assert.Equal("Heat exposure", rf.Label);
        Assert.Equal("34 days >35°C", rf.Detail);

        Assert.Equal(2, forecast.Recommendations.Count);
        Assert.Equal("Avoid DC fast charging above 80%", forecast.Recommendations[0]);
    }

    [Fact]
    public void FromJson_falls_back_to_current_health_when_pct_absent()
    {
        using var doc = JsonDocument.Parse("""{"current_health":88.5}""");

        var forecast = DegradationForecast.FromJson(doc.RootElement);

        Assert.Equal(88.5, forecast.CurrentHealthPct);
    }

    [Fact]
    public void FromJson_keeps_literal_zero_health()
    {
        // Web parity: the ?? chain only falls through on absent/null, so a literal 0 stays 0 (and hasData=true).
        using var doc = JsonDocument.Parse("""{"current_health_pct":0}""");

        var forecast = DegradationForecast.FromJson(doc.RootElement);

        Assert.Equal(0, forecast.CurrentHealthPct);
        Assert.True(forecast.HasData);
    }

    [Fact]
    public void FromJson_null_projected_date_is_absent()
    {
        using var doc = JsonDocument.Parse("""{"current_health_pct":90,"projected_80pct_date":null}""");

        var forecast = DegradationForecast.FromJson(doc.RootElement);

        Assert.False(forecast.HasProjectedDate);
        Assert.Null(forecast.ProjectedDate);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"degradation_rate_pct_per_month":0.2}""");

        var forecast = DegradationForecast.FromJson(doc.RootElement);

        Assert.Null(forecast.CurrentHealthPct);
        Assert.Equal(0.2, forecast.DegradationRatePctPerMonth);
        Assert.False(forecast.HasProjectedDate);
        Assert.Empty(forecast.RiskFactors);
        Assert.Empty(forecast.Recommendations);
        Assert.False(forecast.HasData);
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        var forecast = DegradationForecast.FromJson(doc.RootElement);
        Assert.False(forecast.HasData);
        Assert.Empty(forecast.RiskFactors);
    }

    [Fact]
    public void FromJson_skips_non_string_recommendations()
    {
        using var doc = JsonDocument.Parse("""{"current_health_pct":90,"recommendations":["ok",null,7,"two"]}""");

        var forecast = DegradationForecast.FromJson(doc.RootElement);

        Assert.Equal(new[] { "ok", "two" }, forecast.Recommendations);
    }

    [Fact]
    public void RiskFactorFromJson_leaves_optional_label_and_detail_null()
    {
        using var doc = JsonDocument.Parse("""{"name":"DC fast charging","score":5}""");

        var rf = DegradationRiskFactor.FromJson(doc.RootElement);

        Assert.Equal("DC fast charging", rf.Name);
        Assert.Equal(5, rf.Score);
        Assert.Null(rf.Label);
        Assert.Null(rf.Detail);
    }

    // ---- Health tier (web healthTier) ----------------------------------------------

    [Theory]
    [InlineData(0.0, "healthy", StatusKind.Success)]
    [InlineData(0.05, "healthy", StatusKind.Success)]
    [InlineData(0.06, "normal", StatusKind.Warning)]
    [InlineData(0.12, "normal", StatusKind.Warning)]
    [InlineData(0.13, "accelerated", StatusKind.Danger)]
    [InlineData(0.4, "accelerated", StatusKind.Danger)]
    public void TierFor_classifies_by_rate(double rate, string key, StatusKind status)
    {
        var (tierKey, _, tierStatus) = BatteryDegradationForecastProjection.TierFor(rate);
        Assert.Equal(key, tierKey);
        Assert.Equal(status, tierStatus);
    }

    // ---- Risk glyph (web riskIcon) -------------------------------------------------

    [Theory]
    [InlineData("High temperature exposure", "\uE9CA")] // Thermometer
    [InlineData("Thermal stress", "\uE9CA")]
    [InlineData("DC fast charging", "\uE945")]          // Zap
    [InlineData("Frequent fast charges", "\uE945")]
    [InlineData("Deep discharge cycles", "\uE945")]     // web quirk: "disCHARGE" matches the charge rule first
    [InlineData("Battery wear", "\uE83F")]              // Battery
    [InlineData("High SOC dwell", "\uE83F")]
    [InlineData("Something else", "\uE7BA")]            // AlertTriangle default
    public void RiskGlyph_maps_by_keyword(string name, string glyph) =>
        Assert.Equal(glyph, BatteryDegradationForecastProjection.RiskGlyph(name));

    // ---- Score impact (web scoreToImpact) ------------------------------------------

    [Theory]
    [InlineData(9, StatusKind.Danger)]
    [InlineData(7, StatusKind.Danger)]
    [InlineData(6, StatusKind.Warning)]
    [InlineData(4, StatusKind.Warning)]
    [InlineData(3, StatusKind.Success)]
    [InlineData(0, StatusKind.Success)]
    public void ScoreStatus_maps_by_threshold(double score, StatusKind status) =>
        Assert.Equal(status, BatteryDegradationForecastProjection.ScoreStatus(score));

    // ---- Projection (standard, 2x4) ------------------------------------------------

    [Fact]
    public void Project_standard_formats_hero_health_and_rate()
    {
        var forecast = Forecast(
            currentHealthPct: 92.45,
            rate: 0.08,
            projected: new DateTimeOffset(2028, 3, 10, 0, 0, 0, TimeSpan.Zero));

        var view = BatteryDegradationForecastProjection.Project(forecast, new BatteryDegradationForecastSize(2, 4), Localizer);

        Assert.False(view.IsCompact);
        Assert.True(view.HasData);
        Assert.Equal("normal", view.TierKey);
        Assert.Equal("Normal", view.TierLabel);
        Assert.Equal(StatusKind.Warning, view.TierStatus);

        Assert.True(view.HasCurrentHealth);
        Assert.Equal("92.5%", view.CurrentHealthText);
        Assert.Equal("Current Health", view.CurrentHealthLabel);

        Assert.True(view.HasProjectedDate);
        Assert.Equal("Mar 2028", view.ProjectedDateText);
        Assert.Equal("Projected 80% Capacity", view.ProjectedDateLabel);

        Assert.True(view.ShowRate);
        Assert.Equal($"{MinusSign}0.08%/mo", view.RateText);
    }

    [Fact]
    public void Project_builds_risk_items_with_glyph_label_and_score_badge()
    {
        var forecast = Forecast(risks: new[]
        {
            Risk("High temperature exposure", 8, label: "Heat exposure", detail: "34 days >35°C"),
            Risk("Frequent fast charging", 5),
        });

        var view = BatteryDegradationForecastProjection.Project(forecast, new BatteryDegradationForecastSize(2, 4), Localizer);

        Assert.Equal("Risk Factors", view.RiskFactorsLabel);
        Assert.Equal(2, view.RiskFactors.Count);

        var first = view.RiskFactors[0];
        Assert.Equal("\uE9CA", first.Glyph);
        Assert.Equal("Heat exposure", first.Label);     // label wins over name
        Assert.Equal("34 days >35°C", first.Detail);
        Assert.Equal("8", first.ScoreText);
        Assert.Equal(StatusKind.Danger, first.ScoreStatus);

        var second = view.RiskFactors[1];
        Assert.Equal("\uE945", second.Glyph);
        Assert.Equal("Frequent fast charging", second.Label); // falls back to name
        Assert.Equal(EmDash, second.Detail);                  // falls back to em-dash
        Assert.Equal(StatusKind.Warning, second.ScoreStatus);
    }

    [Fact]
    public void Project_caps_risk_factors_at_five()
    {
        var risks = Enumerable.Range(0, 9).Select(i => Risk($"Risk {i}", i)).ToArray();
        var view = BatteryDegradationForecastProjection.Project(
            Forecast(risks: risks), new BatteryDegradationForecastSize(2, 4), Localizer);

        Assert.Equal(BatteryDegradationForecastProjection.MaxRiskFactors, view.RiskFactors.Count);
        Assert.Equal(5, view.RiskFactors.Count);
    }

    [Fact]
    public void Project_builds_recommendation_tips_capped_at_three()
    {
        var recs = new[] { "One", "Two", "Three", "Four" };
        var view = BatteryDegradationForecastProjection.Project(
            Forecast(recommendations: recs), new BatteryDegradationForecastSize(2, 4), Localizer);

        Assert.Equal("Recommendations", view.RecommendationsLabel);
        Assert.Equal(3, view.Tips.Count);

        var tip = view.Tips[0];
        Assert.Equal("Tip", tip.Title);
        Assert.Equal("One", tip.Description);
        Assert.Equal("Recommendation", tip.ImpactLabel);
        Assert.Equal(StatusKind.Warning, tip.ImpactStatus);
        Assert.Equal("\uEA80", tip.Glyph);
    }

    [Fact]
    public void Project_hides_rate_when_zero_or_negative()
    {
        var view = BatteryDegradationForecastProjection.Project(
            Forecast(rate: 0), new BatteryDegradationForecastSize(2, 4), Localizer);

        Assert.False(view.ShowRate);
        Assert.Equal(string.Empty, view.RateText);
        Assert.Equal("healthy", view.TierKey);
    }

    [Fact]
    public void Project_null_health_renders_em_dash_but_keeps_projected_hero()
    {
        var forecast = Forecast(
            currentHealthPct: null,
            projected: new DateTimeOffset(2030, 1, 5, 0, 0, 0, TimeSpan.Zero));

        var view = BatteryDegradationForecastProjection.Project(forecast, new BatteryDegradationForecastSize(2, 4), Localizer);

        Assert.False(view.HasCurrentHealth);
        Assert.Equal(EmDash, view.CurrentHealthText);
        Assert.True(view.HasData); // projected date present
        Assert.Equal("Jan 2030", view.ProjectedDateText);
    }

    [Fact]
    public void Project_missing_projected_date_renders_em_dash()
    {
        var forecast = Forecast(currentHealthPct: 90, hasProjected: false, projected: null);

        var view = BatteryDegradationForecastProjection.Project(forecast, new BatteryDegradationForecastSize(2, 4), Localizer);

        Assert.False(view.HasProjectedDate);
        Assert.Equal(EmDash, view.ProjectedDateText);
    }

    [Fact]
    public void Project_compact_uses_health_readout_and_tier()
    {
        var view = BatteryDegradationForecastProjection.Project(
            Forecast(currentHealthPct: 91.0, rate: 0.03), new BatteryDegradationForecastSize(1, 2), Localizer);

        Assert.True(view.IsCompact);
        Assert.Equal("91.0%", view.CurrentHealthText);
        Assert.Equal("Healthy", view.TierLabel);
    }

    [Fact]
    public void Project_items_have_non_empty_accessibility_names()
    {
        var forecast = Forecast(
            risks: new[] { Risk("Thermal stress", 7, label: "Heat", detail: "hot") },
            recommendations: new[] { "Charge to 80%" });

        var view = BatteryDegradationForecastProjection.Project(forecast, new BatteryDegradationForecastSize(2, 4), Localizer);

        var risk = Assert.Single(view.RiskFactors);
        Assert.False(string.IsNullOrWhiteSpace(risk.AutomationName));
        Assert.Contains(risk.Label, risk.AutomationName, StringComparison.Ordinal);
        Assert.Contains(risk.ScoreText, risk.AutomationName, StringComparison.Ordinal);

        var tip = Assert.Single(view.Tips);
        Assert.False(string.IsNullOrWhiteSpace(tip.AutomationName));
        Assert.Contains(tip.Description, tip.AutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"current_health_pct":90.1,"degradation_rate_pct_per_month":0.1}""");

        var cached = BatteryDegradationForecastResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(90.1, cached.Value!.CurrentHealthPct);

        var offline = BatteryDegradationForecastResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(0.1, offline.Value!.DegradationRatePctPerMonth);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"current_health_pct":90}""");

        Assert.Equal(LoadStatus.Loaded, BatteryDegradationForecastResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, BatteryDegradationForecastResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, BatteryDegradationForecastResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<DegradationForecast>.Loading());
        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationForecastState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_projection()
    {
        using var vm = NewViewModel(Loaded(Forecast()));
        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationForecastState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal("Mar 2028", vm.Display.ProjectedDateText);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_data_renders_empty_via_hasData_gate()
    {
        // Web parity: a resolved body with no current health AND no projected date hits the hasData gate.
        var noData = new DegradationForecast(null, 0.2, false, null, Array.Empty<DegradationRiskFactor>(), Array.Empty<string>());
        using var vm = NewViewModel(Loaded(noData));
        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationForecastState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No degradation forecast data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<DegradationForecast>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationForecastState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<DegradationForecast>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationForecastState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<DegradationForecast>.Cached(Forecast(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationForecastState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<DegradationForecast>.OfflineCached(
            Forecast(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationForecastState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<DegradationForecast>.Loading(),
            RepositoryResult<DegradationForecast>.Cached(Forecast(currentHealthPct: 80.0), Now, stale: false),
            RepositoryResult<DegradationForecast>.Loaded(Forecast(currentHealthPct: 90.0), Now));
        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationForecastState.Loaded, vm.State);
        Assert.Equal("90.0%", vm.Display.CurrentHealthText);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new BatteryDegradationForecastSize(2, 4), Loaded(Forecast()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new BatteryDegradationForecastSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(BatteryDegradationForecastState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<DegradationForecast>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Battery Forecast", vm.Title);
        Assert.Equal("No degradation forecast data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Forecast()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(BatteryDegradationForecastViewModel.State), changed);
        Assert.Contains(nameof(BatteryDegradationForecastViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("battery-degradation-forecast", BatteryDegradationForecastRegistration.Id);
        Assert.Equal("battery", BatteryDegradationForecastRegistration.Category);
        Assert.Equal("BatteryDegradationForecastWidget", BatteryDegradationForecastRegistration.Slug);
        Assert.Equal(new BatteryDegradationForecastSize(2, 4), BatteryDegradationForecastRegistration.DefaultSize);
        Assert.Equal(new BatteryDegradationForecastSize(1, 2), BatteryDegradationForecastRegistration.MinSize);
        Assert.Equal(new BatteryDegradationForecastSize(4, 40), BatteryDegradationForecastRegistration.MaxSize);
        Assert.Equal("Battery Forecast", BatteryDegradationForecastRegistration.Name(Localizer));
        Assert.Contains("80%", BatteryDegradationForecastRegistration.Description(Localizer), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(2, 4, true)]   // default
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 1, false)]  // below min rows
    [InlineData(2, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, BatteryDegradationForecastRegistration.IsWithinBounds(new BatteryDegradationForecastSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new BatteryDegradationForecastSize(1, 2), BatteryDegradationForecastRegistration.Clamp(new BatteryDegradationForecastSize(0, 0)));
        Assert.Equal(new BatteryDegradationForecastSize(4, 40), BatteryDegradationForecastRegistration.Clamp(new BatteryDegradationForecastSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new BatteryDegradationForecastDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BatteryDegradationForecastWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new BatteryDegradationForecastSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_by_query()
    {
        using var doc = JsonDocument.Parse(
            """{"current_health_pct":91.2,"degradation_rate_pct_per_month":0.07,"projected_80pct_date":"2029-09-01T00:00:00Z"}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new BatteryDegradationForecastSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(91.2, terminal.Value!.CurrentHealthPct);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_analytics_battery_degradation", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"current_health_pct":90}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new BatteryDegradationForecastSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_object_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new BatteryDegradationForecastSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<DegradationForecast>>> Drain(IBatteryDegradationForecastSource source)
    {
        var list = new List<RepositoryResult<DegradationForecast>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<DegradationForecast> Loaded(DegradationForecast forecast) =>
        RepositoryResult<DegradationForecast>.Loaded(forecast, Now);

    private static BatteryDegradationForecastViewModel NewViewModel(params RepositoryResult<DegradationForecast>[] emissions) =>
        NewViewModel(BatteryDegradationForecastSize.Default, emissions);

    private static BatteryDegradationForecastViewModel NewViewModel(
        BatteryDegradationForecastSize size,
        params RepositoryResult<DegradationForecast>[] emissions) =>
        new(new FakeForecastSource(emissions), Localizer, size, () => Now);

    private sealed class FakeForecastSource(params RepositoryResult<DegradationForecast>[] emissions) : IBatteryDegradationForecastSource
    {
        public async IAsyncEnumerable<RepositoryResult<DegradationForecast>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class FakeWidgetVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }
}
