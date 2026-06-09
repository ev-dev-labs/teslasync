using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
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
/// Headless verification of the SignalCatalogWidget's UI-thread-free logic — the two JSON parse
/// adapters (the <c>{signals:[…]}</c> catalog envelope with web-interface field tolerance + value-kind
/// cleaning, and the <c>{observations:[…]}</c> envelope), the observation-count map, the search filter,
/// the category grouping (Uncategorized fallback + alphabetical sort + per-group counts), the compact
/// total, the two cache-then-network result mappers, the registry metadata, the diagnostics, the
/// repository source's vehicle resolution + request shapes, and the catalog-driven view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline) plus the best-effort observation
/// fold. Mirrors the web spec (web/src/features/dashboard/widgets/SignalCatalogWidget.tsx).
/// </summary>
public sealed class SignalCatalogWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);
    private static readonly IReadOnlyDictionary<string, long> NoCounts = new Dictionary<string, long>(StringComparer.Ordinal);

    // ---- Catalog parse adapter ------------------------------------------------------

    [Fact]
    public void Catalog_parses_real_envelope_mapping_field_destination_value_kind()
    {
        const string json = """
        {"signals":[
          {"field":"BatteryLevel","destination":"signal_log","value_kind":"ValueKindFloat",
           "last_seen_at":null,"sample_count_total":null,"vehicle_count":null}],
         "generated_at":"2026-06-06T12:00:00Z"}
        """;
        using var doc = JsonDocument.Parse(json);

        var entry = Assert.Single(SignalCatalogEntryModel.ParseEnvelope(doc.RootElement));

        Assert.Equal("BatteryLevel", entry.Name);     // name ← field
        Assert.Equal("signal_log", entry.SourceModule); // source_module ← destination
        Assert.Equal("ValueKindFloat", entry.ValueKind);
        Assert.Equal("Float", entry.UnitLabel);        // unit badge ← cleaned value_kind
        Assert.True(entry.HasUnit);
    }

    [Fact]
    public void Catalog_prefers_web_interface_names_when_present()
    {
        const string json = """
        {"signals":[{"name":"Gear","source_module":"drive","value_type":"ValueKindEnum"}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var entry = Assert.Single(SignalCatalogEntryModel.ParseEnvelope(doc.RootElement));

        Assert.Equal("Gear", entry.Name);          // name wins over field
        Assert.Equal("drive", entry.SourceModule); // source_module wins over destination
        Assert.Equal("Enum", entry.UnitLabel);     // value_type read as the kind
    }

    [Fact]
    public void Catalog_accepts_bare_array_and_drops_fieldless_rows()
    {
        const string json = """
        [{"field":"A","destination":"d","value_kind":"ValueKindBool"},{"destination":"d"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var entry = Assert.Single(SignalCatalogEntryModel.ParseEnvelope(doc.RootElement));
        Assert.Equal("A", entry.Name);
    }

    [Theory]
    [InlineData("ValueKindFloat", "Float")]
    [InlineData("ValueKindInt64", "Int64")]
    [InlineData("ValueKindString", "String")]
    [InlineData("Double", "Double")]   // already clean
    [InlineData("ValueKindUnknown", "")]
    [InlineData("", "")]
    public void Catalog_value_kind_is_cleaned_and_unknown_suppresses_badge(string kind, string expected)
    {
        var entry = new SignalCatalogEntryModel("X", "d", kind);
        Assert.Equal(expected, entry.UnitLabel);
        Assert.Equal(expected.Length > 0, entry.HasUnit);
    }

    [Fact]
    public void Catalog_parse_returns_empty_for_missing_signals()
    {
        using var doc = JsonDocument.Parse("""{"generated_at":"2026-06-06T12:00:00Z"}""");
        Assert.Empty(SignalCatalogEntryModel.ParseEnvelope(doc.RootElement));
    }

    // ---- Observation parse adapter + counts -----------------------------------------

    [Fact]
    public void Observations_parse_envelope_and_tolerates_signal_name_alias()
    {
        const string json = """
        {"count":3,"total":9,"observations":[
          {"vehicle_id":7,"ts":"2026-06-06T12:00:00Z","field":"BatteryLevel","value_kind":"ValueKindFloat","value":78.5},
          {"vehicle_id":7,"ts":"2026-06-06T12:01:00Z","field":"BatteryLevel","value_kind":"ValueKindFloat","value":78.6},
          {"vehicle_id":7,"ts":"2026-06-06T12:02:00Z","signal_name":"Gear","value_kind":"ValueKindEnum","value":4}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var rows = SignalObservationModel.ParseEnvelope(doc.RootElement);
        Assert.Equal(3, rows.Count);

        var counts = SignalCatalogProjection.CountByField(rows);
        Assert.Equal(2, counts["BatteryLevel"]);
        Assert.Equal(1, counts["Gear"]); // signal_name alias resolved to field
    }

    [Fact]
    public void Observations_parse_returns_empty_for_missing_observations()
    {
        using var doc = JsonDocument.Parse("""{"count":0,"total":0}""");
        Assert.Empty(SignalObservationModel.ParseEnvelope(doc.RootElement));
    }

    // ---- Projection: filter / group / compact / counts ------------------------------

    [Fact]
    public void Project_groups_by_category_with_uncategorized_and_alphabetical_sort()
    {
        var entries = new[]
        {
            new SignalCatalogEntryModel("Bravo", "zeta", "ValueKindFloat"),
            new SignalCatalogEntryModel("Alpha", "alpha", "ValueKindBool"),
            new SignalCatalogEntryModel("Cor", "", "ValueKindEnum"), // empty destination → Uncategorized
        };

        var display = SignalCatalogProjection.Project(entries, NoCounts, SignalCatalogSize.Default, null, Localizer);

        Assert.True(display.HasEntries);
        Assert.True(display.HasMatches);
        Assert.Equal(3, display.TotalCount);
        // OrdinalIgnoreCase alphabetical: alpha, Uncategorized, zeta
        Assert.Collection(
            display.Groups,
            g => Assert.Equal("alpha", g.Category),
            g => Assert.Equal("Uncategorized", g.Category),
            g => Assert.Equal("zeta", g.Category));
        Assert.All(display.Groups, g => Assert.Equal(1, g.Count));
        Assert.Equal("(1)", display.Groups[0].CountLabel);
    }

    [Fact]
    public void Project_filters_by_name_kind_and_source_case_insensitively()
    {
        var entries = new[]
        {
            new SignalCatalogEntryModel("BatteryLevel", "energy", "ValueKindFloat"),
            new SignalCatalogEntryModel("Gear", "drive", "ValueKindEnum"),
        };

        var byName = SignalCatalogProjection.Project(entries, NoCounts, SignalCatalogSize.Default, "batt", Localizer);
        Assert.True(byName.HasMatches);
        Assert.Equal("energy", Assert.Single(byName.Groups).Category);
        Assert.Equal(2, byName.TotalCount); // total is always the full catalog count

        var bySource = SignalCatalogProjection.Project(entries, NoCounts, SignalCatalogSize.Default, "DRIVE", Localizer);
        Assert.Equal("drive", Assert.Single(bySource.Groups).Category);

        var byKind = SignalCatalogProjection.Project(entries, NoCounts, SignalCatalogSize.Default, "enum", Localizer);
        Assert.Equal("Gear", Assert.Single(Assert.Single(byKind.Groups).Rows).Name);

        var none = SignalCatalogProjection.Project(entries, NoCounts, SignalCatalogSize.Default, "zzz", Localizer);
        Assert.False(none.HasMatches);
        Assert.True(none.HasEntries); // catalog still has entries — only the search has no hits
        Assert.Empty(none.Groups);
    }

    [Fact]
    public void Project_rows_carry_observation_counts_and_value_kind_badge()
    {
        var entries = new[]
        {
            new SignalCatalogEntryModel("BatteryLevel", "energy", "ValueKindFloat"),
            new SignalCatalogEntryModel("Gear", "energy", "ValueKindUnknown"),
        };
        var counts = new Dictionary<string, long>(StringComparer.Ordinal) { ["BatteryLevel"] = 12 };

        var display = SignalCatalogProjection.Project(entries, counts, SignalCatalogSize.Default, null, Localizer);

        var rows = Assert.Single(display.Groups).Rows;
        var battery = rows.First(r => r.Name == "BatteryLevel");
        Assert.Equal(12, battery.ObservationCount);
        Assert.Equal("12", battery.ObservationCountText);
        Assert.True(battery.HasUnit);
        Assert.Equal("Float", battery.UnitLabel);

        var gear = rows.First(r => r.Name == "Gear");
        Assert.Equal(0, gear.ObservationCount); // no observations → 0
        Assert.False(gear.HasUnit);             // ValueKindUnknown → no badge
    }

    [Fact]
    public void Project_compact_total_uses_full_catalog_count()
    {
        var entries = new[]
        {
            new SignalCatalogEntryModel("A", "x", "ValueKindFloat"),
            new SignalCatalogEntryModel("B", "x", "ValueKindFloat"),
            new SignalCatalogEntryModel("C", "x", "ValueKindFloat"),
        };

        var display = SignalCatalogProjection.Project(entries, NoCounts, new SignalCatalogSize(1, 4), null, Localizer);

        Assert.True(display.IsCompact);
        Assert.Equal(3, display.TotalCount);
        Assert.Equal("3", display.TotalCountText);
        Assert.Contains("signals available", display.CompactAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_empty_catalog_yields_no_groups()
    {
        var display = SignalCatalogProjection.Project(
            Array.Empty<SignalCatalogEntryModel>(), NoCounts, SignalCatalogSize.Default, null, Localizer);

        Assert.False(display.HasEntries);
        Assert.False(display.HasMatches);
        Assert.Equal(0, display.TotalCount);
        Assert.Empty(display.Groups);
    }

    [Fact]
    public void Project_rows_have_non_empty_accessibility_names()
    {
        var entries = new[] { new SignalCatalogEntryModel("BatteryLevel", "energy", "ValueKindFloat") };
        var counts = new Dictionary<string, long>(StringComparer.Ordinal) { ["BatteryLevel"] = 5 };

        var display = SignalCatalogProjection.Project(entries, counts, SignalCatalogSize.Default, null, Localizer);

        var row = Assert.Single(Assert.Single(display.Groups).Rows);
        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("BatteryLevel", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Float", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("5", row.AutomationName, StringComparison.Ordinal);
        Assert.False(string.IsNullOrWhiteSpace(Assert.Single(display.Groups).AutomationName));
    }

    // ---- Result mappers (cache-then-network preservation) ---------------------------

    [Fact]
    public void CatalogMapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"signals":[{"field":"A","destination":"d","value_kind":"ValueKindFloat"}]}""");

        var cached = SignalCatalogResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = SignalCatalogResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void CatalogMapper_collapses_loaded_empty_to_empty_and_maps_failure()
    {
        using var empty = JsonDocument.Parse("""{"signals":[]}""");
        Assert.Equal(LoadStatus.Empty, SignalCatalogResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(empty.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Error, SignalCatalogResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void ObservationsMapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"observations":[{"field":"A"}]}""");

        var loaded = SignalObservationsResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Single(loaded.Value!);

        using var empty = JsonDocument.Parse("""{"observations":[]}""");
        Assert.Equal(LoadStatus.Empty, SignalObservationsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(empty.RootElement, Now)).Status);
    }

    // ---- Size flag (web isCompact) -------------------------------------------------

    [Theory]
    [InlineData(1, 4, true)]
    [InlineData(2, 4, false)]
    [InlineData(4, 40, false)]
    public void Size_isCompact_matches_web(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new SignalCatalogSize(cols, rows).IsCompact);

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("signal-catalog", SignalCatalogRegistration.Id);
        Assert.Equal("telemetry", SignalCatalogRegistration.Category);
        Assert.Equal("SignalCatalogWidget", SignalCatalogRegistration.Slug);
        Assert.Equal(new SignalCatalogSize(2, 4), SignalCatalogRegistration.DefaultSize);
        Assert.Equal(new SignalCatalogSize(2, 4), SignalCatalogRegistration.MinSize);
        Assert.Equal(new SignalCatalogSize(4, 40), SignalCatalogRegistration.MaxSize);
        Assert.Equal("Signal Catalog", SignalCatalogRegistration.Name(Localizer));
        Assert.Contains("signals", SignalCatalogRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(4, 40, true)]
    [InlineData(1, 4, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 3, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, SignalCatalogRegistration.IsWithinBounds(new SignalCatalogSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new SignalCatalogSize(2, 4), SignalCatalogRegistration.Clamp(new SignalCatalogSize(1, 1)));
        Assert.Equal(new SignalCatalogSize(4, 40), SignalCatalogRegistration.Clamp(new SignalCatalogSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SignalCatalogDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SignalCatalogWidget", Assert.Single(lines));
    }

    // ---- Source: request shapes + vehicle resolution -------------------------------

    [Fact]
    public async Task Source_catalog_stream_requests_catalog_and_parses()
    {
        using var doc = JsonDocument.Parse("""{"signals":[{"field":"A","destination":"d","value_kind":"ValueKindFloat"}]}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new SignalCatalogSource(new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await DrainCatalog(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Single(results[^1].Value!);
        Assert.Equal("get_api_v1_signals_catalog", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task Source_catalog_empty_signals_yields_empty()
    {
        using var doc = JsonDocument.Parse("""{"signals":[],"generated_at":"2026-06-06T12:00:00Z"}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new SignalCatalogSource(new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await DrainCatalog(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public async Task Source_observations_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new SignalCatalogSource(new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await DrainObservations(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_observations_resolves_primary_vehicle_and_requests_with_vehicle_id()
    {
        using var doc = JsonDocument.Parse("""{"observations":[{"field":"A"}]}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new SignalCatalogSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await DrainObservations(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_signals_observations", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_observations_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"observations":[]}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new SignalCatalogSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await DrainObservations(source);

        Assert.Equal(42L, Convert.ToInt64(Assert.Single(api.Requests).Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- View-model catalog-driven state matrix ------------------------------------

    [Fact]
    public async Task ViewModel_stays_loading_until_catalog_resolves()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>.Loading() }, // catalog never resolves
            ObsEmpty());
        await vm.LoadAsync();

        Assert.Equal(SignalCatalogState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_groups_and_freshness()
    {
        using var vm = NewViewModel(
            Catalog(new SignalCatalogEntryModel("BatteryLevel", "energy", "ValueKindFloat")),
            ObsEmpty());
        await vm.LoadAsync();

        Assert.Equal(SignalCatalogState.Loaded, vm.State);
        Assert.True(vm.HasEntries);
        Assert.Equal(1, vm.Display.TotalCount);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_when_catalog_empty()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>.Empty(Now) },
            ObsEmpty());
        await vm.LoadAsync();

        Assert.Equal(SignalCatalogState.Empty, vm.State);
        Assert.False(vm.HasEntries);
        Assert.Equal("No signals in catalog", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_error_when_catalog_fails_with_no_entries()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")) },
            ObsEmpty());
        await vm.LoadAsync();

        Assert.Equal(SignalCatalogState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.HasEntries);
        Assert.True(vm.Attempts >= 1);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_entries()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>.Cached(Entries("A"), Now, stale: true) },
            ObsEmpty());
        await vm.LoadAsync();

        Assert.Equal(SignalCatalogState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasEntries);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_entries_and_error_chip()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>.OfflineCached(Entries("A"), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")) },
            ObsEmpty());
        await vm.LoadAsync();

        Assert.Equal(SignalCatalogState.Offline, vm.State);
        Assert.True(vm.HasEntries);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_folds_observation_counts_without_changing_state()
    {
        using var vm = NewViewModel(
            Catalog(
                new SignalCatalogEntryModel("BatteryLevel", "energy", "ValueKindFloat"),
                new SignalCatalogEntryModel("Gear", "energy", "ValueKindEnum")),
            new[]
            {
                RepositoryResult<IReadOnlyList<SignalObservationModel>>.Loaded(
                    new[]
                    {
                        new SignalObservationModel("BatteryLevel"),
                        new SignalObservationModel("BatteryLevel"),
                        new SignalObservationModel("Gear"),
                    },
                    Now),
            });
        await vm.LoadAsync();

        Assert.Equal(SignalCatalogState.Loaded, vm.State);
        var rows = AllRows(vm.Display);
        Assert.Equal(2, rows.First(r => r.Name == "BatteryLevel").ObservationCount);
        Assert.Equal(1, rows.First(r => r.Name == "Gear").ObservationCount);
    }

    [Fact]
    public async Task ViewModel_search_filters_without_reload()
    {
        using var vm = NewViewModel(
            Catalog(
                new SignalCatalogEntryModel("BatteryLevel", "energy", "ValueKindFloat"),
                new SignalCatalogEntryModel("Gear", "drive", "ValueKindEnum")),
            ObsEmpty());
        await vm.LoadAsync();
        Assert.Equal(2, AllRows(vm.Display).Count);

        vm.Search = "batt";
        Assert.True(vm.Display.HasMatches);
        Assert.Equal("BatteryLevel", Assert.Single(AllRows(vm.Display)).Name);

        vm.Search = "zzz";
        Assert.False(vm.Display.HasMatches);
        Assert.True(vm.HasEntries); // catalog unchanged — only the filter empties the view
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(Catalog(new SignalCatalogEntryModel("A", "x", "ValueKindFloat")), ObsEmpty());
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new SignalCatalogSize(1, 4);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(SignalCatalogState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_retry_reruns_and_keeps_entries()
    {
        using var vm = NewViewModel(Catalog(new SignalCatalogEntryModel("A", "x", "ValueKindFloat")), ObsEmpty());
        await vm.LoadAsync();
        Assert.Equal(1, vm.Display.TotalCount);

        await vm.RetryAsync();

        Assert.Equal(SignalCatalogState.Loaded, vm.State);
        Assert.Equal(1, vm.Display.TotalCount);
        Assert.True(vm.Attempts >= 2);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Catalog(new SignalCatalogEntryModel("A", "x", "ValueKindFloat")), ObsEmpty());
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SignalCatalogViewModel.State), changed);
        Assert.Contains(nameof(SignalCatalogViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_chrome_resolve_through_i18n()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>.Empty(Now) },
            ObsEmpty());
        await vm.LoadAsync();

        Assert.Equal("Signal Catalog", vm.Title);
        Assert.Equal("No signals in catalog", vm.EmptyMessage);
        Assert.Equal("No matching signals", vm.NoResultsMessage);
        Assert.Equal("Search signals\u2026", vm.SearchHint);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static SignalCatalogEntryModel[] Entries(params string[] names)
    {
        var list = new SignalCatalogEntryModel[names.Length];
        for (int i = 0; i < names.Length; i++)
        {
            list[i] = new SignalCatalogEntryModel(names[i], "x", "ValueKindFloat");
        }

        return list;
    }

    private static RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>[] Catalog(params SignalCatalogEntryModel[] entries) =>
        new[] { RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>.Loaded(entries, Now) };

    private static RepositoryResult<IReadOnlyList<SignalObservationModel>>[] ObsEmpty() =>
        new[] { RepositoryResult<IReadOnlyList<SignalObservationModel>>.Empty(Now) };

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static SignalCatalogViewModel NewViewModel(
        RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>[] catalog,
        RepositoryResult<IReadOnlyList<SignalObservationModel>>[] observations) =>
        new(new FakeSignalCatalogSource(catalog, observations), Localizer, SignalCatalogSize.Default);

    private static IReadOnlyList<SignalCatalogRow> AllRows(SignalCatalogDisplay display) =>
        display.Groups.SelectMany(g => g.Rows).ToList();

    private static async Task<List<RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>>> DrainCatalog(ISignalCatalogSource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>>();
        await foreach (var result in source.StreamCatalogAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static async Task<List<RepositoryResult<IReadOnlyList<SignalObservationModel>>>> DrainObservations(ISignalCatalogSource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<SignalObservationModel>>>();
        await foreach (var result in source.StreamObservationsAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private sealed class FakeSignalCatalogSource(
        RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>[] catalog,
        RepositoryResult<IReadOnlyList<SignalObservationModel>>[] observations) : ISignalCatalogSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>> StreamCatalogAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in catalog)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SignalObservationModel>>> StreamObservationsAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in observations)
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
