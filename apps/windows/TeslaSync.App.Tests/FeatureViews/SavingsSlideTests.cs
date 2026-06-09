using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Savings slide surface's UI-thread-free logic — the year-review JSON parse
/// adapter (the <c>gas_savings</c> / <c>total_charging_cost</c> figures + the web <c>safe()</c> coercion), the
/// projection (currency formatting, the gas-equivalent maths, the electric bar fraction, the cups-of-coffee
/// note, the a11y names), the cache-then-network result mapper, the repository source's year-review request
/// shape, the state-holder view-model's per-state matrix (loading / loaded / empty / error / stale / offline),
/// the registry metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/analytics/components/review/SavingsSlide.tsx).
/// </summary>
public sealed class SavingsSlideTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string ReviewJson = """
    {
      "year": 2025,
      "vehicle": { "id": 1, "display_name": "Model 3", "model": "m3" },
      "total_drives": 200,
      "total_charging_cost": 250,
      "gas_savings": 1000,
      "co2_offset_kg": 500
    }
    """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_savings_and_charging_cost()
    {
        using var doc = JsonDocument.Parse(ReviewJson);
        var snapshot = SavingsSnapshot.FromJson(doc.RootElement);

        Assert.Equal(1000, snapshot.GasSavings);
        Assert.Equal(250, snapshot.TotalChargingCost);
        Assert.Equal(1250, snapshot.GasCostEquiv);
        Assert.True(snapshot.HasData);
    }

    [Fact]
    public void FromJson_present_review_without_figures_coerces_to_zero()
    {
        // web: a present YearReview prop renders safe(undefined)=0 for a missing figure (the page above gates
        // the "no data" surface). A year key alone marks the object as a review.
        using var doc = JsonDocument.Parse("""{"year":2025}""");
        var snapshot = SavingsSnapshot.FromJson(doc.RootElement);

        Assert.Equal(0, snapshot.GasSavings);
        Assert.Equal(0, snapshot.TotalChargingCost);
        Assert.True(snapshot.HasData);
    }

    [Fact]
    public void FromJson_coerces_non_finite_and_non_numeric_fields_to_zero()
    {
        using var doc = JsonDocument.Parse("""{"gas_savings":"oops","total_charging_cost":null}""");
        var snapshot = SavingsSnapshot.FromJson(doc.RootElement);

        Assert.Equal(0, snapshot.GasSavings);
        Assert.Equal(0, snapshot.TotalChargingCost);
        Assert.True(snapshot.HasData); // gas_savings key present marks it a review
    }

    [Fact]
    public void FromJson_parses_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"gas_savings":"1234.5","total_charging_cost":"300"}""");
        var snapshot = SavingsSnapshot.FromJson(doc.RootElement);

        Assert.Equal(1234.5, snapshot.GasSavings);
        Assert.Equal(300, snapshot.TotalChargingCost);
    }

    [Fact]
    public void FromJson_is_tolerant_of_empty_and_non_object_and_non_review()
    {
        using var empty = JsonDocument.Parse("{}");
        Assert.False(SavingsSnapshot.FromJson(empty.RootElement).HasData);

        using var notObject = JsonDocument.Parse("[]");
        Assert.False(SavingsSnapshot.FromJson(notObject.RootElement).HasData);

        using var notReview = JsonDocument.Parse("""{"unrelated":1}""");
        Assert.False(SavingsSnapshot.FromJson(notReview.RootElement).HasData);
    }

    [Theory]
    [InlineData("""{"gas_savings":1}""", true)]
    [InlineData("""{"total_charging_cost":1}""", true)]
    [InlineData("""{"year":2025}""", true)]
    [InlineData("""{"vehicle":{}}""", false)]
    public void HasData_gate_matches_presence_of_review_keys(string json, bool expected)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expected, SavingsSnapshot.FromJson(doc.RootElement).HasData);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_formats_labels_currency_fraction_and_note()
    {
        var view = SavingsProjection.Project(Sample(), Localizer);

        Assert.Equal(1000, view.SavingsValue);
        Assert.Equal("$1,000", view.SavingsValueText);
        Assert.Equal("You saved", view.YouSavedLabel);
        Assert.Equal("vs. driving a gas car", view.VsGasLabel);

        Assert.Equal("Gas would cost", view.GasCostLabel);
        Assert.Equal("$1,250", view.GasCostValueText);           // gas_savings + total_charging_cost
        Assert.Equal("Electric cost", view.ElectricCostLabel);
        Assert.Equal("$250", view.ElectricCostValueText);

        Assert.Equal(0.2, view.ElectricFraction, 5);             // 250 / 1250
        Assert.Equal(200, view.CupsOfCoffee);                    // round(1000 / 5)
        Assert.Equal("That's 200 cups of coffee!", view.SavingsNote);
        Assert.Equal("$", view.CurrencySymbol);
    }

    [Fact]
    public void Project_honours_custom_currency_symbol()
    {
        var view = SavingsProjection.Project(Sample(), Localizer, "€");

        Assert.Equal("€1,000", view.SavingsValueText);
        Assert.Equal("€1,250", view.GasCostValueText);
        Assert.Equal("€250", view.ElectricCostValueText);
        Assert.Equal("€", view.CurrencySymbol);
    }

    [Fact]
    public void Project_clamps_fraction_and_handles_zero_gas_cost()
    {
        var view = SavingsProjection.Project(SavingsSnapshot.Empty, Localizer);

        Assert.Equal("$0", view.SavingsValueText);
        Assert.Equal("$0", view.GasCostValueText);
        Assert.Equal("$0", view.ElectricCostValueText);
        Assert.Equal(0.0, view.ElectricFraction);   // gasCostEquiv == 0 -> no divide-by-zero
        Assert.Equal(0, view.CupsOfCoffee);
        Assert.Equal("That's 0 cups of coffee!", view.SavingsNote);
    }

    [Fact]
    public void Project_fraction_is_clamped_when_electric_exceeds_equivalent()
    {
        // A pathological negative saving (electric cost above the gas-equivalent) still clamps to 1.
        var view = SavingsProjection.Project(new SavingsSnapshot(-100, 300, true), Localizer);
        Assert.Equal(1.0, view.ElectricFraction);
    }

    [Fact]
    public void Project_builds_accessible_names_with_label_and_value()
    {
        var view = SavingsProjection.Project(Sample(), Localizer);

        Assert.Contains(view.YouSavedLabel, view.SavingsAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.SavingsValueText, view.SavingsAutomationName, StringComparison.Ordinal);

        Assert.Contains(view.GasCostLabel, view.GasBarAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.GasCostValueText, view.GasBarAutomationName, StringComparison.Ordinal);

        Assert.Contains(view.ElectricCostLabel, view.ElectricBarAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.ElectricCostValueText, view.ElectricBarAutomationName, StringComparison.Ordinal);

        Assert.Contains(view.YouSavedLabel, view.SummaryAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.VsGasLabel, view.SummaryAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.SavingsValueText, view.SummaryAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_constants_match_web()
    {
        Assert.Equal(5.0, SavingsProjection.CupDivisor);
        Assert.Equal("$", SavingsProjection.DefaultCurrencySymbol);
        Assert.Equal("translation.yearReview.savingsNote", SavingsProjection.SavingsNoteKey);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(ReviewJson);

        var cached = SavingsResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(1000, cached.Value!.GasSavings);

        var offline = SavingsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(250, offline.Value!.TotalChargingCost);
    }

    [Fact]
    public void Map_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(ReviewJson);

        Assert.Equal(LoadStatus.Loaded, SavingsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, SavingsResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, SavingsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);

        Assert.Equal(LoadStatus.Loading, SavingsResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<SavingsSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SavingsSlideState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_summary()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(SavingsSlideState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal("$1,000", vm.Display.SavingsValueText);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_data_renders_empty()
    {
        using var vm = NewViewModel(Loaded(SavingsSnapshot.Empty));
        await vm.LoadAsync();

        Assert.Equal(SavingsSlideState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No drive data for this year", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<SavingsSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SavingsSlideState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<SavingsSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SavingsSlideState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<SavingsSnapshot>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SavingsSlideState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<SavingsSnapshot>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SavingsSlideState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<SavingsSnapshot>.Loading(),
            RepositoryResult<SavingsSnapshot>.Cached(Sample(), Now, stale: false),
            RepositoryResult<SavingsSnapshot>.Loaded(Sample(), Now));
        await vm.LoadAsync();

        Assert.Equal(SavingsSlideState.Loaded, vm.State);
        Assert.Equal("$1,000", vm.Display.SavingsValueText);
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_values()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();
        Assert.Equal("$1,000", vm.Display.SavingsValueText);

        vm.CurrencySymbol = "€";

        Assert.Equal("€1,000", vm.Display.SavingsValueText);
        Assert.Equal("€1,250", vm.Display.GasCostValueText);
    }

    [Fact]
    public async Task ViewModel_title_empty_and_retry_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<SavingsSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Year in Review", vm.Title);
        Assert.Equal("No drive data for this year", vm.EmptyMessage);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SavingsSlideViewModel.State), changed);
        Assert.Contains(nameof(SavingsSlideViewModel.Display), changed);
    }

    // ---- Repository source request shape (engine + fake client) ---------------------

    [Fact]
    public async Task Source_streams_snapshot_and_targets_the_year_review_operation_with_year_query()
    {
        using var doc = JsonDocument.Parse(ReviewJson);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client, year: 2025);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(1000, emissions[^1].Value!.GasSavings);

        var request = client.Requests[^1];
        Assert.Equal("get_api_v1_analytics_year_review", request.OperationId);
        Assert.NotNull(request.Query);
        Assert.Equal(2025, Convert.ToInt32(request.Query!["year"], CultureInfo.InvariantCulture));
        Assert.False(request.Query.ContainsKey("vehicle_id"));
    }

    [Fact]
    public async Task Source_includes_vehicle_filter_when_supplied()
    {
        using var doc = JsonDocument.Parse(ReviewJson);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client, year: 2024, vehicleId: "7");

        await Collect(source.StreamAsync());

        var request = client.Requests[^1];
        Assert.Equal("7", Convert.ToString(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_empty_body_streams_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client, year: 2025);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public void Source_exposes_canonical_operation_id()
    {
        Assert.Equal("get_api_v1_analytics_year_review", SavingsSlideSource.YearReviewOperation);
    }

    // ---- Registration + diagnostics -------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("savings-slide", SavingsSlideRegistration.Id);
        Assert.Equal("analytics", SavingsSlideRegistration.Category);
        Assert.Equal("SavingsSlide", SavingsSlideRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new SavingsSlideDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SavingsSlide", Assert.Single(sink));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static SavingsSnapshot Sample() => new(1000, 250, true);

    private static RepositoryResult<SavingsSnapshot> Loaded(SavingsSnapshot snapshot) =>
        RepositoryResult<SavingsSnapshot>.Loaded(snapshot, Now);

    private static SavingsSlideViewModel NewViewModel(params RepositoryResult<SavingsSnapshot>[] emissions) =>
        new(new FakeSource(emissions), Localizer, currencySymbol: null, clock: () => Now);

    private static SavingsSlideSource NewSource(IApiClient client, int year, string? vehicleId = null)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new SavingsSlideSource(client, engine, options, year, vehicleId);
    }

    private static async Task<IReadOnlyList<RepositoryResult<SavingsSnapshot>>> Collect(
        IAsyncEnumerable<RepositoryResult<SavingsSnapshot>> stream)
    {
        var list = new List<RepositoryResult<SavingsSnapshot>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<SavingsSnapshot>[] emissions) : ISavingsSlideSource
    {
        public async IAsyncEnumerable<RepositoryResult<SavingsSnapshot>> StreamAsync(
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
}
