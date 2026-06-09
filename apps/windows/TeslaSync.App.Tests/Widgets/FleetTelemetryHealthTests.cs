using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the Fleet Telemetry health surface's UI-thread-free logic — the two JSON parse
/// adapters, the cache-then-network result mappers, the projection (count badge + status, the 24-hour
/// "recent" boundary the web uses to colour timestamps, the em-dash fallbacks, the Narrator names), the
/// repository source's request shapes (the <c>?vin=</c> filter + the two refresh POSTs), the state-holder
/// view-model's per-section state matrix (loading / loaded / empty / error / stale / offline), the VIN
/// selection/toggle filter, the refresh-from-Tesla flow, the registry metadata and the diagnostics. Mirrors
/// the web spec (web/src/features/admin/components/devtools/FleetTelemetryHealth.tsx).
/// </summary>
public sealed class FleetTelemetryHealthTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);
    private const string OneHourAgo = "2026-06-06T11:00:00Z";   // < 24h → recent
    private const string TwoDaysAgo = "2026-06-04T12:00:00Z";   // > 24h → not recent

    // ---- VIN parse adapter ---------------------------------------------------------

    [Fact]
    public void Vin_parses_real_api_fields()
    {
        const string json = """
        [{"id":7,"vin":"5YJ3E1EA1KF000001","active":true,
          "first_seen_at":"2026-06-01T00:00:00Z","last_seen_at":"2026-06-06T11:00:00Z","resolved_at":null}]
        """;
        using var doc = JsonDocument.Parse(json);

        var vin = Assert.Single(FleetTelemetryErrorVin.ParseList(doc.RootElement));

        Assert.Equal(7, vin.Id);
        Assert.Equal("5YJ3E1EA1KF000001", vin.Vin);
        Assert.True(vin.Active);
        Assert.Equal("2026-06-01T00:00:00Z", vin.FirstSeenAt);
        Assert.Null(vin.ResolvedAt);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 0, 0, TimeSpan.Zero), vin.LastSeen);
    }

    [Fact]
    public void Vin_is_tolerant_of_missing_fields_and_non_array()
    {
        using var partial = JsonDocument.Parse("""[{"vin":"ABC"}]""");
        var vin = Assert.Single(FleetTelemetryErrorVin.ParseList(partial.RootElement));
        Assert.Equal("ABC", vin.Vin);
        Assert.Equal(0, vin.Id);
        Assert.False(vin.Active);
        Assert.Null(vin.FirstSeen);

        using var notArray = JsonDocument.Parse("{}");
        Assert.Empty(FleetTelemetryErrorVin.ParseList(notArray.RootElement));
    }

    [Fact]
    public void Error_parses_real_api_fields_and_tolerates_nulls()
    {
        const string json = """
        [{"id":3,"vin":"VINX","error_code":"FLEET_TELEMETRY_CONFIG_INVALID",
          "error_message":"unsupported firmware","reported_at":"2026-06-06T11:00:00Z",
          "tesla_updated_at":null,"fetched_at":"2026-06-06T11:30:00Z"},
         {"id":4,"vin":"VINY","error_code":null,"error_message":null,"reported_at":null}]
        """;
        using var doc = JsonDocument.Parse(json);

        var list = FleetTelemetryError.ParseList(doc.RootElement);
        Assert.Equal(2, list.Count);
        Assert.Equal("FLEET_TELEMETRY_CONFIG_INVALID", list[0].ErrorCode);
        Assert.Equal("unsupported firmware", list[0].ErrorMessage);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 0, 0, TimeSpan.Zero), list[0].Reported);
        Assert.Null(list[1].ErrorCode);
        Assert.Null(list[1].ErrorMessage);
        Assert.Null(list[1].Reported);
    }

    // ---- Result mappers (cache-then-network preservation) ---------------------------

    [Fact]
    public void MapVins_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"vin":"A","active":true}]""");

        var cached = FleetTelemetryHealthResultMapper.MapVins(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = FleetTelemetryHealthResultMapper.MapVins(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void MapErrors_collapses_loaded_empty_array_to_empty_and_maps_failure()
    {
        using var empty = JsonDocument.Parse("[]");
        Assert.Equal(LoadStatus.Empty, FleetTelemetryHealthResultMapper.MapErrors(
            RepositoryResult<JsonElement>.Loaded(empty.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Error, FleetTelemetryHealthResultMapper.MapErrors(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);

        Assert.Equal(LoadStatus.Loading, FleetTelemetryHealthResultMapper.MapErrors(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void ProjectVins_count_badge_is_danger_when_any_and_success_when_none()
    {
        var withErrors = FleetTelemetryHealthProjection.ProjectVins(
            new[] { Vin("A", lastSeen: OneHourAgo), Vin("B", lastSeen: TwoDaysAgo) }, Localizer, Now);
        Assert.Equal(2, withErrors.Count);
        Assert.Equal(StatusKind.Danger, withErrors.CountStatus);
        Assert.Equal("2 affected", withErrors.CountBadgeText);
        Assert.True(withErrors.HasRows);

        var none = FleetTelemetryHealthProjection.ProjectVins(Array.Empty<FleetTelemetryErrorVin>(), Localizer, Now);
        Assert.Equal(StatusKind.Success, none.CountStatus);
        Assert.Equal("0 affected", none.CountBadgeText);
        Assert.False(none.HasRows);
    }

    [Fact]
    public void ProjectVins_recent_boundary_matches_web_24h()
    {
        var display = FleetTelemetryHealthProjection.ProjectVins(
            new[] { Vin("RECENT", lastSeen: OneHourAgo), Vin("OLD", lastSeen: TwoDaysAgo) }, Localizer, Now);

        Assert.True(display.Rows[0].LastSeenIsRecent);  // 1h ago < 24h
        Assert.False(display.Rows[1].LastSeenIsRecent); // 2d ago > 24h
        Assert.Contains("RECENT", display.Rows[0].AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void ProjectErrors_emits_em_dash_for_missing_message_and_null_code()
    {
        var display = FleetTelemetryHealthProjection.ProjectErrors(
            new[]
            {
                Error("VINX", code: "E1", message: "boom", reported: OneHourAgo),
                Error("VINY", code: null, message: null, reported: null),
            },
            Localizer,
            Now);

        Assert.True(display.Rows[0].HasErrorCode);
        Assert.True(display.Rows[0].ReportedAtIsRecent);
        Assert.False(display.Rows[1].HasErrorCode);
        Assert.Null(display.Rows[1].ErrorCode);
        Assert.Equal("\u2014", display.Rows[1].Message);
        Assert.Contains("VINX", display.Rows[0].AutomationName, StringComparison.Ordinal);
    }

    // ---- View-model: Error-VINs section state matrix --------------------------------

    [Fact]
    public async Task ViewModel_vins_loading_until_resolved()
    {
        using var vm = NewViewModel(
            vins: Script(RepositoryResult<IReadOnlyList<FleetTelemetryErrorVin>>.Loading()),
            errors: _ => Script(RepositoryResult<IReadOnlyList<FleetTelemetryError>>.Loading()));
        await vm.LoadVinsAsync();
        Assert.Equal(FleetTelemetrySectionState.Loading, vm.VinsState);
    }

    [Fact]
    public async Task ViewModel_vins_loaded_with_rows()
    {
        using var vm = NewViewModel(
            vins: Script(Vins(Vin("A", lastSeen: OneHourAgo))),
            errors: NoErrors);
        await vm.LoadVinsAsync();

        Assert.Equal(FleetTelemetrySectionState.Loaded, vm.VinsState);
        Assert.True(vm.VinsDisplay.HasRows);
        Assert.False(vm.VinsIsError);
        Assert.NotNull(vm.VinsUpdatedAt);
    }

    [Fact]
    public async Task ViewModel_vins_empty()
    {
        using var vm = NewViewModel(
            vins: Script(RepositoryResult<IReadOnlyList<FleetTelemetryErrorVin>>.Empty(Now)),
            errors: NoErrors);
        await vm.LoadVinsAsync();

        Assert.Equal(FleetTelemetrySectionState.Empty, vm.VinsState);
        Assert.False(vm.VinsDisplay.HasRows);
        Assert.Equal("No vehicles with telemetry errors", vm.NoErrorVinsMessage);
    }

    [Fact]
    public async Task ViewModel_vins_error_with_no_cache()
    {
        using var vm = NewViewModel(
            vins: Script(RepositoryResult<IReadOnlyList<FleetTelemetryErrorVin>>.Failure(
                new RepositoryError(RepositoryErrorKind.Server, "boom"))),
            errors: NoErrors);
        await vm.LoadVinsAsync();

        Assert.Equal(FleetTelemetrySectionState.Error, vm.VinsState);
        Assert.True(vm.VinsIsError);
        Assert.False(string.IsNullOrEmpty(vm.VinsErrorMessage));
        Assert.True(vm.VinsAttempts >= 1);
    }

    [Fact]
    public async Task ViewModel_vins_stale_cache_keeps_rows()
    {
        using var vm = NewViewModel(
            vins: Script(RepositoryResult<IReadOnlyList<FleetTelemetryErrorVin>>.Cached(
                new[] { Vin("A", lastSeen: OneHourAgo) }, Now, stale: true)),
            errors: NoErrors);
        await vm.LoadVinsAsync();

        Assert.Equal(FleetTelemetrySectionState.Stale, vm.VinsState);
        Assert.True(vm.VinsIsStale);
        Assert.True(vm.VinsDisplay.HasRows);
    }

    [Fact]
    public async Task ViewModel_vins_offline_keeps_rows_and_sets_error_chip()
    {
        using var vm = NewViewModel(
            vins: Script(RepositoryResult<IReadOnlyList<FleetTelemetryErrorVin>>.OfflineCached(
                new[] { Vin("A", lastSeen: OneHourAgo) }, Now, new RepositoryError(RepositoryErrorKind.Network, "offline"))),
            errors: NoErrors);
        await vm.LoadVinsAsync();

        Assert.Equal(FleetTelemetrySectionState.Offline, vm.VinsState);
        Assert.True(vm.VinsDisplay.HasRows);
        Assert.True(vm.VinsIsStale);
        Assert.True(vm.VinsIsError);
    }

    // ---- View-model: Error-Log section state matrix ---------------------------------

    [Fact]
    public async Task ViewModel_errors_loaded_then_empty_then_error()
    {
        using var loaded = NewViewModel(NoVins, _ => Script(Errors(Error("V", "E", "m", OneHourAgo))));
        await loaded.LoadErrorsAsync();
        Assert.Equal(FleetTelemetrySectionState.Loaded, loaded.ErrorsState);
        Assert.True(loaded.ErrorsDisplay.HasRows);

        using var empty = NewViewModel(NoVins, _ => Script(RepositoryResult<IReadOnlyList<FleetTelemetryError>>.Empty(Now)));
        await empty.LoadErrorsAsync();
        Assert.Equal(FleetTelemetrySectionState.Empty, empty.ErrorsState);

        using var error = NewViewModel(NoVins, _ => Script(RepositoryResult<IReadOnlyList<FleetTelemetryError>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom"))));
        await error.LoadErrorsAsync();
        Assert.Equal(FleetTelemetrySectionState.Error, error.ErrorsState);
        Assert.True(error.ErrorsIsError);
    }

    // ---- View-model: VIN selection filter (web setSelectedVin) ----------------------

    [Fact]
    public async Task ViewModel_select_vin_sets_filter_and_reloads_errors_with_vin_query()
    {
        var source = new FakeSource(
            Script(Vins(Vin("VIN-A", lastSeen: OneHourAgo))),
            _ => Script(Errors(Error("VIN-A", "E", "m", OneHourAgo))));
        using var vm = new FleetTelemetryHealthViewModel(source, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.SelectVinAsync("VIN-A");

        Assert.Equal("VIN-A", vm.SelectedVin);
        Assert.True(vm.HasVinFilter);
        Assert.Contains("VIN-A", source.ErrorVinFilters);
    }

    [Fact]
    public async Task ViewModel_select_same_vin_toggles_filter_off()
    {
        var source = new FakeSource(
            Script(Vins(Vin("VIN-A", lastSeen: OneHourAgo))),
            _ => Script(Errors(Error("VIN-A", "E", "m", OneHourAgo))));
        using var vm = new FleetTelemetryHealthViewModel(source, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.SelectVinAsync("VIN-A");
        Assert.Equal("VIN-A", vm.SelectedVin);

        await vm.SelectVinAsync("VIN-A"); // toggle off
        Assert.Equal(string.Empty, vm.SelectedVin);
        Assert.False(vm.HasVinFilter);
    }

    [Fact]
    public async Task ViewModel_clear_vin_resets_filter()
    {
        var source = new FakeSource(
            Script(Vins(Vin("VIN-A", lastSeen: OneHourAgo))),
            _ => Script(Errors(Error("VIN-A", "E", "m", OneHourAgo))));
        using var vm = new FleetTelemetryHealthViewModel(source, Localizer, () => Now);
        await vm.LoadAsync();
        await vm.SelectVinAsync("VIN-A");

        await vm.ClearVinAsync();

        Assert.Equal(string.Empty, vm.SelectedVin);
        Assert.False(vm.HasVinFilter);
    }

    // ---- View-model: refresh-from-Tesla --------------------------------------------

    [Fact]
    public async Task ViewModel_refresh_vins_calls_mutation_then_reloads()
    {
        var source = new FakeSource(
            Script(Vins(Vin("A", lastSeen: OneHourAgo))),
            NoErrors);
        using var vm = new FleetTelemetryHealthViewModel(source, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.RefreshVinsAsync();

        Assert.Equal(1, source.RefreshVinsCalls);
        Assert.False(vm.IsRefreshingVins);
        Assert.True(vm.VinsAttempts >= 2); // initial load + reload after refresh
    }

    [Fact]
    public async Task ViewModel_refresh_vins_swallows_post_failure_and_still_reloads()
    {
        var source = new FakeSource(
            Script(Vins(Vin("A", lastSeen: OneHourAgo))),
            NoErrors)
        {
            RefreshVinsThrows = new InvalidOperationException("tesla unavailable"),
        };
        using var vm = new FleetTelemetryHealthViewModel(source, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.RefreshVinsAsync(); // must not throw

        Assert.Equal(1, source.RefreshVinsCalls);
        Assert.False(vm.IsRefreshingVins);
        Assert.Equal(FleetTelemetrySectionState.Loaded, vm.VinsState);
    }

    [Fact]
    public async Task ViewModel_refresh_errors_calls_mutation()
    {
        var source = new FakeSource(NoVins, _ => Script(Errors(Error("V", "E", "m", OneHourAgo))));
        using var vm = new FleetTelemetryHealthViewModel(source, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.RefreshErrorsAsync();

        Assert.Equal(1, source.RefreshErrorsCalls);
        Assert.False(vm.IsRefreshingErrors);
    }

    // ---- Repository source request shapes (engine + fake client) --------------------

    [Fact]
    public async Task Source_streams_error_vins_and_parses_rows()
    {
        using var doc = JsonDocument.Parse("""[{"vin":"A","active":true,"last_seen_at":"2026-06-06T11:00:00Z"}]""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamErrorVinsAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Single(emissions[^1].Value!);
        Assert.Equal("get_api_v1_tesla_fleet_telemetry_error_vins", client.Requests[^1].OperationId);
    }

    [Fact]
    public async Task Source_appends_vin_query_only_when_filtered()
    {
        using var doc = JsonDocument.Parse("[]");
        var client = new FakeApiClient()
            .ReturnsValue(doc.RootElement.Clone())
            .ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        await Collect(source.StreamErrorsAsync(null));
        Assert.Null(client.Requests[^1].Query);

        await Collect(source.StreamErrorsAsync("VIN-Z"));
        Assert.NotNull(client.Requests[^1].Query);
        Assert.Equal("VIN-Z", client.Requests[^1].Query!["vin"]);
        Assert.Equal("get_api_v1_tesla_fleet_telemetry_errors", client.Requests[^1].OperationId);
    }

    [Fact]
    public async Task Source_refresh_hits_the_post_refresh_operations()
    {
        using var doc = JsonDocument.Parse("{}");
        var client = new FakeApiClient()
            .ReturnsValue(doc.RootElement.Clone())
            .ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        await source.RefreshErrorVinsAsync();
        Assert.Equal("post_api_v1_tesla_fleet_telemetry_error_vins_refresh", client.Requests[^1].OperationId);

        await source.RefreshErrorsAsync();
        Assert.Equal("post_api_v1_tesla_fleet_telemetry_errors_refresh", client.Requests[^1].OperationId);
    }

    // ---- Registry + diagnostics ----------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_and_slug()
    {
        Assert.Equal("fleet-telemetry-health", FleetTelemetryHealthRegistration.Id);
        Assert.Equal("FleetTelemetryHealth", FleetTelemetryHealthRegistration.Slug);
        Assert.Equal("Error VINs", FleetTelemetryHealthRegistration.ErrorVinsTitle(Localizer));
        Assert.Equal("Error Log", FleetTelemetryHealthRegistration.ErrorLogTitle(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new FleetTelemetryHealthDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FleetTelemetryHealth", Assert.Single(sink));
    }

    // ---- helpers -------------------------------------------------------------------

    private static FleetTelemetryHealthViewModel NewViewModel(
        IReadOnlyList<RepositoryResult<IReadOnlyList<FleetTelemetryErrorVin>>> vins,
        Func<string?, IReadOnlyList<RepositoryResult<IReadOnlyList<FleetTelemetryError>>>> errors) =>
        new(new FakeSource(vins, errors), Localizer, () => Now);

    private static FleetTelemetryHealthSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new FleetTelemetryHealthSource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<T>>>> Collect<T>(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<T>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<T>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private static IReadOnlyList<RepositoryResult<IReadOnlyList<T>>> Script<T>(params RepositoryResult<IReadOnlyList<T>>[] results) => results;

    private static IReadOnlyList<RepositoryResult<IReadOnlyList<FleetTelemetryError>>> NoErrors(string? vin) =>
        Script(RepositoryResult<IReadOnlyList<FleetTelemetryError>>.Empty(Now));

    private static readonly IReadOnlyList<RepositoryResult<IReadOnlyList<FleetTelemetryErrorVin>>> NoVins =
        Script(RepositoryResult<IReadOnlyList<FleetTelemetryErrorVin>>.Empty(Now));

    private static RepositoryResult<IReadOnlyList<FleetTelemetryErrorVin>> Vins(params FleetTelemetryErrorVin[] vins) =>
        RepositoryResult<IReadOnlyList<FleetTelemetryErrorVin>>.Loaded(vins, Now);

    private static RepositoryResult<IReadOnlyList<FleetTelemetryError>> Errors(params FleetTelemetryError[] errors) =>
        RepositoryResult<IReadOnlyList<FleetTelemetryError>>.Loaded(errors, Now);

    private static FleetTelemetryErrorVin Vin(string vin, string? lastSeen = null, string? firstSeen = "2026-06-01T00:00:00Z") =>
        new(1, vin, true, firstSeen, lastSeen, null);

    private static FleetTelemetryError Error(string vin, string? code, string? message, string? reported) =>
        new(1, vin, code, message, reported, null, "2026-06-06T11:30:00Z");

    private sealed class FakeSource : IFleetTelemetryHealthSource
    {
        private readonly IReadOnlyList<RepositoryResult<IReadOnlyList<FleetTelemetryErrorVin>>> _vins;
        private readonly Func<string?, IReadOnlyList<RepositoryResult<IReadOnlyList<FleetTelemetryError>>>> _errors;

        public FakeSource(
            IReadOnlyList<RepositoryResult<IReadOnlyList<FleetTelemetryErrorVin>>> vins,
            Func<string?, IReadOnlyList<RepositoryResult<IReadOnlyList<FleetTelemetryError>>>> errors)
        {
            _vins = vins;
            _errors = errors;
        }

        public List<string?> ErrorVinFilters { get; } = new();

        public int RefreshVinsCalls { get; private set; }

        public int RefreshErrorsCalls { get; private set; }

        public Exception? RefreshVinsThrows { get; init; }

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<FleetTelemetryErrorVin>>> StreamErrorVinsAsync(
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var result in _vins)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
            }

            await Task.CompletedTask;
        }

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<FleetTelemetryError>>> StreamErrorsAsync(
            string? vin,
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            ErrorVinFilters.Add(vin);
            foreach (var result in _errors(vin))
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
            }

            await Task.CompletedTask;
        }

        public Task RefreshErrorVinsAsync(CancellationToken cancellationToken = default)
        {
            RefreshVinsCalls++;
            return RefreshVinsThrows is { } ex ? Task.FromException(ex) : Task.CompletedTask;
        }

        public Task RefreshErrorsAsync(CancellationToken cancellationToken = default)
        {
            RefreshErrorsCalls++;
            return Task.CompletedTask;
        }
    }
}
