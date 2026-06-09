using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using GeneratedApi = TeslaSync.Windows.Generated.Api;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the StatHeroSlide feature surface's UI-thread-free logic — the year-review JSON
/// parse adapter, the per-field SI→display projection (the distance / energy hero stats with their
/// Earth-lap + home-power comparisons and {{percent}} / {{days}} i18n interpolation), the cache-then-network
/// result mapper, the accessible names, the localized labels + i18n key set, the registration + contract
/// audit-pin, the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded /
/// empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/analytics/components/review/StatHeroSlide.tsx). The WinUI view itself (StatHeroSlide.cs)
/// is exercised by the app build.
/// </summary>
public sealed class StatHeroSlideTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    private static YearReviewTotals Totals(double distanceKm = 1000, double energyKwh = 456.7) =>
        new(distanceKm, energyKwh);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_fields()
    {
        const string json = """
        {"year":2026,"total_drives":120,"total_distance_km":12345.6,"total_energy_kwh":2345.6,
         "total_charging_cost":410.5}
        """;
        using var doc = JsonDocument.Parse(json);

        var totals = YearReviewTotals.FromJson(doc.RootElement);

        Assert.Equal(12345.6, totals.TotalDistanceKm);
        Assert.Equal(2345.6, totals.TotalEnergyKwh);
        Assert.True(totals.HasAny);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"total_distance_km":50}""");

        var totals = YearReviewTotals.FromJson(doc.RootElement);

        Assert.Equal(50, totals.TotalDistanceKm);
        Assert.Equal(0, totals.TotalEnergyKwh);
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        var totals = YearReviewTotals.FromJson(doc.RootElement);
        Assert.False(totals.HasAny);
        Assert.Equal(0, totals.TotalDistanceKm);
        Assert.Equal(0, totals.TotalEnergyKwh);
    }

    [Theory]
    [InlineData(StatHeroField.Distance, 10, 0, true)]
    [InlineData(StatHeroField.Distance, 0, 10, false)]
    [InlineData(StatHeroField.Energy, 0, 10, true)]
    [InlineData(StatHeroField.Energy, 10, 0, false)]
    [InlineData(StatHeroField.Unknown, 10, 10, false)]
    public void HasValueFor_gates_per_field(StatHeroField field, double distKm, double energyKwh, bool expected) =>
        Assert.Equal(expected, new YearReviewTotals(distKm, energyKwh).HasValueFor(field));

    // ---- Field mapping -------------------------------------------------------------

    [Theory]
    [InlineData("distance", StatHeroField.Distance)]
    [InlineData("DISTANCE", StatHeroField.Distance)]
    [InlineData("energy", StatHeroField.Energy)]
    [InlineData("Energy", StatHeroField.Energy)]
    [InlineData("drives", StatHeroField.Unknown)]
    [InlineData("", StatHeroField.Unknown)]
    [InlineData(null, StatHeroField.Unknown)]
    public void FromKey_maps_the_web_field_prop(string? key, StatHeroField expected) =>
        Assert.Equal(expected, StatHeroFields.FromKey(key));

    [Fact]
    public void ToKey_returns_the_canonical_web_id()
    {
        Assert.Equal("distance", StatHeroFields.ToKey(StatHeroField.Distance));
        Assert.Equal("energy", StatHeroFields.ToKey(StatHeroField.Energy));
        Assert.Equal("unknown", StatHeroFields.ToKey(StatHeroField.Unknown));
    }

    // ---- Projection: distance ------------------------------------------------------

    [Fact]
    public void Project_distance_metric_formats_the_hero()
    {
        var hero = StatHeroProjection.Project(Totals(distanceKm: 1000), StatHeroField.Distance, UnitPref.Metric, Localizer);

        Assert.Equal(StatHeroProjection.DistanceEmoji, hero.Emoji);
        Assert.Equal(1000, hero.Value);
        Assert.Equal(0, hero.Decimals);
        Assert.Equal("1,000", hero.FormattedValue);
        Assert.Equal("km", hero.Unit);
        Assert.True(hero.HasData);
        // 1000 / 40075 = 2.4953% around the Earth.
        Assert.Equal("That's 2.5% around the Earth!", hero.Comparison);
    }

    [Fact]
    public void Project_distance_imperial_converts_the_value_but_keeps_the_km_comparison()
    {
        var hero = StatHeroProjection.Project(Totals(distanceKm: 1000), StatHeroField.Distance, UnitPref.Imperial, Localizer);

        Assert.Equal("621", hero.FormattedValue); // 1000 km -> 621 mi
        Assert.Equal("mi", hero.Unit);
        // The Earth-lap comparison stays km-based regardless of the display unit.
        Assert.Equal("That's 2.5% around the Earth!", hero.Comparison);
    }

    [Fact]
    public void Project_distance_large_renders_the_full_lap_percentage()
    {
        var hero = StatHeroProjection.Project(Totals(distanceKm: 40075), StatHeroField.Distance, UnitPref.Metric, Localizer);

        Assert.Equal("40,075", hero.FormattedValue);
        Assert.Equal("That's 100.0% around the Earth!", hero.Comparison);
    }

    [Fact]
    public void Project_distance_small_renders_the_encouragement_line()
    {
        // 100 / 40075 = 0.25% < 1% threshold -> the small-distance copy.
        var hero = StatHeroProjection.Project(Totals(distanceKm: 100), StatHeroField.Distance, UnitPref.Metric, Localizer);

        Assert.Equal("Every kilometer counts!", hero.Comparison);
        Assert.True(hero.HasData);
    }

    [Fact]
    public void Project_distance_zero_is_not_data()
    {
        var hero = StatHeroProjection.Project(Totals(distanceKm: 0), StatHeroField.Distance, UnitPref.Metric, Localizer);

        Assert.False(hero.HasData);
        Assert.Equal("0", hero.FormattedValue);
        Assert.Equal("Every kilometer counts!", hero.Comparison);
    }

    // ---- Projection: energy --------------------------------------------------------

    [Fact]
    public void Project_energy_formats_the_hero()
    {
        var hero = StatHeroProjection.Project(Totals(energyKwh: 456.7), StatHeroField.Energy, UnitPref.Metric, Localizer);

        Assert.Equal(StatHeroProjection.EnergyEmoji, hero.Emoji);
        Assert.Equal(456.7, hero.Value);
        Assert.Equal("457", hero.FormattedValue);
        Assert.Equal("kWh charged", hero.Unit);
        Assert.True(hero.HasData);
        // round(456.7 / 30) = 15 days.
        Assert.Equal("Enough to power a home for 15 days", hero.Comparison);
    }

    [Fact]
    public void Project_energy_rounds_the_home_days_half_up()
    {
        // round(300 / 30) = 10 days exactly.
        var hero = StatHeroProjection.Project(Totals(energyKwh: 300), StatHeroField.Energy, UnitPref.Metric, Localizer);

        Assert.Equal("300", hero.FormattedValue);
        Assert.Equal("Enough to power a home for 10 days", hero.Comparison);
    }

    [Fact]
    public void Project_energy_uses_the_same_value_regardless_of_units()
    {
        var metric = StatHeroProjection.Project(Totals(energyKwh: 456.7), StatHeroField.Energy, UnitPref.Metric, Localizer);
        var imperial = StatHeroProjection.Project(Totals(energyKwh: 456.7), StatHeroField.Energy, UnitPref.Imperial, Localizer);

        Assert.Equal(metric.FormattedValue, imperial.FormattedValue);
        Assert.Equal(metric.Unit, imperial.Unit);
    }

    // ---- Projection: unknown (web default branch) ----------------------------------

    [Fact]
    public void Project_unknown_field_is_the_fallback()
    {
        var hero = StatHeroProjection.Project(Totals(), StatHeroField.Unknown, UnitPref.Metric, Localizer);

        Assert.Equal(StatHeroProjection.FallbackEmoji, hero.Emoji);
        Assert.Equal(0, hero.Value);
        Assert.Equal(string.Empty, hero.Unit);
        Assert.Equal(string.Empty, hero.Comparison);
        Assert.False(hero.HasData);
    }

    // ---- Interpolation -------------------------------------------------------------

    [Fact]
    public void Project_substitutes_the_percent_and_days_tokens()
    {
        var distance = StatHeroProjection.Project(Totals(distanceKm: 1000), StatHeroField.Distance, UnitPref.Metric, Localizer);
        var energy = StatHeroProjection.Project(Totals(energyKwh: 456.7), StatHeroField.Energy, UnitPref.Metric, Localizer);

        Assert.DoesNotContain("{{percent}}", distance.Comparison, StringComparison.Ordinal);
        Assert.DoesNotContain("{{days}}", energy.Comparison, StringComparison.Ordinal);
        Assert.Contains("2.5%", distance.Comparison, StringComparison.Ordinal);
        Assert.Contains("15", energy.Comparison, StringComparison.Ordinal);
    }

    // ---- Accessibility -------------------------------------------------------------

    [Fact]
    public void Hero_exposes_a_descriptive_automation_name()
    {
        var distance = StatHeroProjection.Project(Totals(distanceKm: 1000), StatHeroField.Distance, UnitPref.Metric, Localizer);
        var energy = StatHeroProjection.Project(Totals(energyKwh: 456.7), StatHeroField.Energy, UnitPref.Metric, Localizer);

        Assert.Equal("1,000 km. That's 2.5% around the Earth!", distance.AutomationName);
        Assert.Equal("457 kWh charged. Enough to power a home for 15 days", energy.AutomationName);
        Assert.False(string.IsNullOrWhiteSpace(distance.AutomationName));
    }

    // ---- i18n ----------------------------------------------------------------------

    [Fact]
    public void Every_i18n_key_from_the_source_is_resolved_with_the_web_default()
    {
        var recorder = new RecordingLocalizer();

        StatHeroProjection.Project(Totals(distanceKm: 1000), StatHeroField.Distance, UnitPref.Metric, recorder);
        StatHeroProjection.Project(Totals(distanceKm: 100), StatHeroField.Distance, UnitPref.Metric, recorder);
        StatHeroProjection.Project(Totals(energyKwh: 456.7), StatHeroField.Energy, UnitPref.Metric, recorder);

        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["yearReview.distanceComparison"] = "That's {{percent}}% around the Earth!",
            ["yearReview.distanceSmall"] = "Every kilometer counts!",
            ["yearReview.energyUnit"] = "kWh charged",
            ["yearReview.energyComparison"] = "Enough to power a home for {{days}} days",
        };

        foreach (var (key, fallback) in expected)
        {
            Assert.True(recorder.Requested.TryGetValue(key, out var seen), $"i18n key not resolved: {key}");
            Assert.Equal(fallback, seen);
        }
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"total_distance_km":10,"total_energy_kwh":5}""");

        var cached = StatHeroResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(10, cached.Value!.TotalDistanceKm);

        var offline = StatHeroResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(5, offline.Value!.TotalEnergyKwh);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"total_distance_km":10}""");

        Assert.Equal(LoadStatus.Loaded, StatHeroResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, StatHeroResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, StatHeroResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(StatHeroField.Distance, RepositoryResult<YearReviewTotals>.Loading());
        await vm.LoadAsync();

        Assert.Equal(StatHeroState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_the_hero()
    {
        using var vm = NewViewModel(StatHeroField.Distance, Loaded(Totals(distanceKm: 1000)));
        await vm.LoadAsync();

        Assert.Equal(StatHeroState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal("1,000", vm.Display.FormattedValue);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_the_field_value_renders_empty()
    {
        using var vm = NewViewModel(StatHeroField.Distance, Loaded(Totals(distanceKm: 0, energyKwh: 0)));
        await vm.LoadAsync();

        Assert.Equal(StatHeroState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_empty_state_is_field_specific()
    {
        // The year has distance but no energy: the energy slide must show its empty state, the distance slide must not.
        var snapshot = Totals(distanceKm: 1000, energyKwh: 0);

        using var energyVm = NewViewModel(StatHeroField.Energy, Loaded(snapshot));
        await energyVm.LoadAsync();
        Assert.Equal(StatHeroState.Empty, energyVm.State);

        using var distanceVm = NewViewModel(StatHeroField.Distance, Loaded(snapshot));
        await distanceVm.LoadAsync();
        Assert.Equal(StatHeroState.Loaded, distanceVm.State);
        Assert.True(distanceVm.HasData);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(StatHeroField.Distance, RepositoryResult<YearReviewTotals>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(StatHeroState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            StatHeroField.Distance,
            RepositoryResult<YearReviewTotals>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(StatHeroState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            StatHeroField.Distance,
            RepositoryResult<YearReviewTotals>.Cached(Totals(distanceKm: 1000), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(StatHeroState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(
            StatHeroField.Distance,
            RepositoryResult<YearReviewTotals>.OfflineCached(
                Totals(distanceKm: 1000), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(StatHeroState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            StatHeroField.Distance,
            RepositoryResult<YearReviewTotals>.Loading(),
            RepositoryResult<YearReviewTotals>.Cached(Totals(distanceKm: 500), Now, stale: false),
            RepositoryResult<YearReviewTotals>.Loaded(Totals(distanceKm: 1000), Now));
        await vm.LoadAsync();

        Assert.Equal(StatHeroState.Loaded, vm.State);
        Assert.Equal("1,000", vm.Display.FormattedValue);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_the_value()
    {
        using var vm = NewViewModel(StatHeroField.Distance, Loaded(Totals(distanceKm: 1000)));
        await vm.LoadAsync();
        Assert.Equal("km", vm.Display.Unit);
        Assert.Equal("1,000", vm.Display.FormattedValue);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("mi", vm.Display.Unit);
        Assert.Equal("621", vm.Display.FormattedValue);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(StatHeroField.Distance, Loaded(Totals(distanceKm: 1000)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(StatHeroSlideViewModel.State), changed);
        Assert.Contains(nameof(StatHeroSlideViewModel.Display), changed);
    }

    [Fact]
    public void ViewModel_surface_name_and_empty_message_are_field_specific()
    {
        using var distance = NewViewModel(StatHeroField.Distance);
        using var energy = NewViewModel(StatHeroField.Energy);

        Assert.Equal("Distance this year", distance.SurfaceName);
        Assert.Equal("Energy this year", energy.SurfaceName);
        Assert.NotEqual(distance.EmptyMessage, energy.EmptyMessage);
        Assert.False(string.IsNullOrWhiteSpace(distance.RetryLabel));
        Assert.False(string.IsNullOrWhiteSpace(distance.LoadingLabel));
    }

    // ---- Registration / constants / contract --------------------------------------

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("StatHeroSlide", StatHeroSlideRegistration.Slug);

    [Fact]
    public void Registration_year_review_operation_resolves_against_the_generated_contract()
    {
        // Audit pin: the locally-held operation id must exist in the generated endpoint table, so a contract
        // drift fails this test rather than 404-ing at runtime.
        Assert.Contains(
            GeneratedApi.ApiEndpoints.All,
            e => string.Equals(e.OperationId, StatHeroSlideRegistration.YearReviewOperation, StringComparison.Ordinal));
    }

    [Fact]
    public void Projection_constants_match_the_web_source()
    {
        Assert.Equal(1000.0, StatHeroProjection.MetersPerKm);
        Assert.Equal(40075.0, StatHeroProjection.EarthCircumferenceKm);
        Assert.Equal(0.01, StatHeroProjection.EarthLapThreshold);
        Assert.Equal(30.0, StatHeroProjection.EnergyKwhPerHomeDay);
    }

    [Fact]
    public void Projection_emojis_match_the_web_codepoints()
    {
        Assert.Equal("\U0001F6E3\uFE0F", StatHeroProjection.DistanceEmoji); // 🛣️
        Assert.Equal("\u26A1", StatHeroProjection.EnergyEmoji);             // ⚡
        Assert.Equal("\U0001F4CA", StatHeroProjection.FallbackEmoji);   // 📊
    }

    // ---- Diagnostics ---------------------------------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new StatHeroSlideDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=StatHeroSlide", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<YearReviewTotals> Loaded(YearReviewTotals totals) =>
        RepositoryResult<YearReviewTotals>.Loaded(totals, Now);

    private static StatHeroSlideViewModel NewViewModel(StatHeroField field, params RepositoryResult<YearReviewTotals>[] emissions) =>
        new(new FakeStatHeroSlideSource(emissions), Localizer, field, UnitPref.Metric);

    private sealed class FakeStatHeroSlideSource(params RepositoryResult<YearReviewTotals>[] emissions) : IStatHeroSlideSource
    {
        public async IAsyncEnumerable<RepositoryResult<YearReviewTotals>> StreamAsync(
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
