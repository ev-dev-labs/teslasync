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

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Live Signals table surface's UI-thread-free logic — the snapshot JSON parse
/// + <c>renderValue</c> coercion, the cache-then-network result mapper, the filter / sort projection (the
/// web <c>useMemo</c> chain + <c>useSortToggle</c> semantics), the repository source's request shape, the
/// state-holder view-model's per-state matrix (loading / loaded / empty / error / stale / offline), the
/// registry metadata and the diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/live-signal-inspector/LiveSignalsTable.tsx).
/// </summary>
public sealed class LiveSignalsTableTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string Snapshot = """
    {
      "vehicle_id": 5,
      "signals": {
        "VehicleSpeed": { "value": 42.5, "timestamp": "2026-06-06T11:59:30Z" },
        "Gear": "Drive",
        "Locked": true,
        "Location": {"lat":1,"lon":2}
      }
    }
    """;

    // ---- Snapshot parse adapter -----------------------------------------------------

    [Fact]
    public void ParseSnapshot_normalises_envelopes_and_bare_scalars()
    {
        using var doc = JsonDocument.Parse(Snapshot);
        var rows = LiveSignalRow.ParseSnapshot(doc.RootElement);

        var byName = rows.ToDictionary(r => r.Name, StringComparer.Ordinal);
        Assert.Equal(4, rows.Count);

        // Envelope: value unwrapped, timestamp parsed.
        Assert.Equal("42.5", byName["VehicleSpeed"].ValueDisplay);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 59, 30, TimeSpan.Zero), byName["VehicleSpeed"].Timestamp);

        // Bare scalar string: rendered verbatim, no timestamp.
        Assert.Equal("Drive", byName["Gear"].ValueDisplay);
        Assert.Null(byName["Gear"].Timestamp);

        // Bare scalar boolean.
        Assert.Equal("true", byName["Locked"].ValueDisplay);

        // Compound object without a 'value' key flows through as JSON (web parity — never crashes the cell).
        Assert.Equal("{\"lat\":1,\"lon\":2}", byName["Location"].ValueDisplay);
        Assert.Null(byName["Location"].Timestamp);
    }

    [Fact]
    public void ParseSnapshot_is_tolerant_of_missing_signals_and_non_object()
    {
        using var noSignals = JsonDocument.Parse("""{"vehicle_id":5}""");
        Assert.Empty(LiveSignalRow.ParseSnapshot(noSignals.RootElement));

        using var notObject = JsonDocument.Parse("[]");
        Assert.Empty(LiveSignalRow.ParseSnapshot(notObject.RootElement));

        using var emptySignals = JsonDocument.Parse("""{"signals":{}}""");
        Assert.Empty(LiveSignalRow.ParseSnapshot(emptySignals.RootElement));
    }

    [Fact]
    public void RenderValue_matches_web_coercion()
    {
        Assert.Equal("\u2014", LiveSignalRow.RenderValue(default)); // undefined → em-dash

        using var nul = JsonDocument.Parse("null");
        Assert.Equal("null", LiveSignalRow.RenderValue(nul.RootElement));

        using var str = JsonDocument.Parse("\"Drive\"");
        Assert.Equal("Drive", LiveSignalRow.RenderValue(str.RootElement));

        using var num = JsonDocument.Parse("42");
        Assert.Equal("42", LiveSignalRow.RenderValue(num.RootElement));

        using var boolean = JsonDocument.Parse("false");
        Assert.Equal("false", LiveSignalRow.RenderValue(boolean.RootElement));

        using var obj = JsonDocument.Parse("""{"a":1}""");
        Assert.Equal("{\"a\":1}", LiveSignalRow.RenderValue(obj.RootElement));
    }

    [Fact]
    public void RowFromEntry_null_envelope_value_renders_literal_null()
    {
        using var doc = JsonDocument.Parse("""{"value":null,"timestamp":"2026-06-06T11:59:30Z"}""");
        var row = LiveSignalRow.RowFromEntry("Foo", doc.RootElement);

        Assert.Equal("null", row.ValueDisplay);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 59, 30, TimeSpan.Zero), row.Timestamp);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(Snapshot);

        var cached = LiveSignalsTableResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(4, cached.Value!.Count);

        var offline = LiveSignalsTableResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(4, offline.Value!.Count);
    }

    [Fact]
    public void Map_collapses_loaded_signal_less_snapshot_to_empty_and_maps_failure()
    {
        using var empty = JsonDocument.Parse("""{"signals":{}}""");
        Assert.Equal(LoadStatus.Empty, LiveSignalsTableResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(empty.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Error, LiveSignalsTableResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);

        Assert.Equal(LoadStatus.Loading, LiveSignalsTableResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- Projection: filter + sort --------------------------------------------------

    [Fact]
    public void Project_filters_by_case_insensitive_name_substring()
    {
        var display = LiveSignalsProjection.Project(
            Rows(), "Oca", LiveSignalSortKey.Name, LiveSignalSortDirection.Ascending, Localizer, Now);

        Assert.True(display.HasRows);
        Assert.Equal("Location", Assert.Single(display.Rows).Name);
    }

    [Fact]
    public void Project_empty_filter_keeps_all_rows()
    {
        var display = LiveSignalsProjection.Project(
            Rows(), "   ", LiveSignalSortKey.Name, LiveSignalSortDirection.Ascending, Localizer, Now);

        Assert.Equal(4, display.Rows.Count);
    }

    [Fact]
    public void Project_no_match_yields_empty_display()
    {
        var display = LiveSignalsProjection.Project(
            Rows(), "zzz", LiveSignalSortKey.Name, LiveSignalSortDirection.Ascending, Localizer, Now);

        Assert.False(display.HasRows);
        Assert.Empty(display.Rows);
    }

    [Fact]
    public void Project_sorts_by_name_ascending_and_descending()
    {
        var rows = new[]
        {
            new LiveSignalRow("charlie", "1", null),
            new LiveSignalRow("alpha", "2", null),
            new LiveSignalRow("bravo", "3", null),
        };

        var asc = LiveSignalsProjection.Project(
            rows, "", LiveSignalSortKey.Name, LiveSignalSortDirection.Ascending, Localizer, Now);
        Assert.Equal(new[] { "alpha", "bravo", "charlie" }, asc.Rows.Select(r => r.Name));

        var desc = LiveSignalsProjection.Project(
            rows, "", LiveSignalSortKey.Name, LiveSignalSortDirection.Descending, Localizer, Now);
        Assert.Equal(new[] { "charlie", "bravo", "alpha" }, desc.Rows.Select(r => r.Name));
    }

    [Fact]
    public void Project_sorts_by_timestamp_with_nulls_first_ascending()
    {
        var older = new DateTimeOffset(2026, 6, 6, 10, 0, 0, TimeSpan.Zero);
        var newer = new DateTimeOffset(2026, 6, 6, 11, 0, 0, TimeSpan.Zero);
        var rows = new[]
        {
            new LiveSignalRow("withNewer", "1", newer),
            new LiveSignalRow("withNull", "2", null),
            new LiveSignalRow("withOlder", "3", older),
        };

        var asc = LiveSignalsProjection.Project(
            rows, "", LiveSignalSortKey.Timestamp, LiveSignalSortDirection.Ascending, Localizer, Now);
        Assert.Equal(new[] { "withNull", "withOlder", "withNewer" }, asc.Rows.Select(r => r.Name));

        var desc = LiveSignalsProjection.Project(
            rows, "", LiveSignalSortKey.Timestamp, LiveSignalSortDirection.Descending, Localizer, Now);
        Assert.Equal(new[] { "withNewer", "withOlder", "withNull" }, desc.Rows.Select(r => r.Name));
    }

    [Fact]
    public void Project_composes_automation_name_with_labels_and_value()
    {
        var rows = new[] { new LiveSignalRow("VehicleSpeed", "42.5", Now.AddSeconds(-30)) };
        var display = LiveSignalsProjection.Project(
            rows, "", LiveSignalSortKey.Name, LiveSignalSortDirection.Ascending, Localizer, Now);

        string automation = Assert.Single(display.Rows).AutomationName;
        Assert.Contains("VehicleSpeed", automation, StringComparison.Ordinal);
        Assert.Contains("Value: 42.5", automation, StringComparison.Ordinal);
        Assert.Contains("Last update:", automation, StringComparison.Ordinal);
    }

    // ---- View-model: state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_until_resolved()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<LiveSignalRow>>.Loading());
        await vm.LoadAsync();
        Assert.Equal(LiveSignalsSectionState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_with_rows()
    {
        using var vm = NewViewModel(Loaded());
        await vm.LoadAsync();

        Assert.Equal(LiveSignalsSectionState.Loaded, vm.State);
        Assert.True(vm.HasSignals);
        Assert.True(vm.Display.HasRows);
        Assert.False(vm.IsError);
        Assert.NotNull(vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<LiveSignalRow>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(LiveSignalsSectionState.Empty, vm.State);
        Assert.False(vm.HasSignals);
        Assert.Equal("No live signals cached", vm.EmptyTitle);
    }

    [Fact]
    public async Task ViewModel_error_with_no_cache()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<LiveSignalRow>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(LiveSignalsSectionState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_rows()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<LiveSignalRow>>.Cached(
            Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(LiveSignalsSectionState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasRows);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_rows_and_sets_error_chip()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<LiveSignalRow>>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(LiveSignalsSectionState.Offline, vm.State);
        Assert.True(vm.Display.HasRows);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
    }

    // ---- View-model: client-side filter + sort (web useState / useSortToggle) --------

    [Fact]
    public async Task ViewModel_set_filter_reprojects_without_refetch()
    {
        using var vm = NewViewModel(Loaded());
        await vm.LoadAsync();
        Assert.Equal(4, vm.Display.Rows.Count);

        vm.SetFilter("gear");

        Assert.Equal("Gear", Assert.Single(vm.Display.Rows).Name);
        Assert.True(vm.HasSignals); // underlying snapshot is unchanged
    }

    [Fact]
    public async Task ViewModel_toggle_sort_same_key_flips_direction()
    {
        using var vm = NewViewModel(Loaded());
        await vm.LoadAsync();

        Assert.Equal(LiveSignalSortKey.Name, vm.SortKey);
        Assert.Equal(LiveSignalSortDirection.Ascending, vm.SortDir);

        vm.ToggleSort(LiveSignalSortKey.Name);
        Assert.Equal(LiveSignalSortDirection.Descending, vm.SortDir);
    }

    [Fact]
    public async Task ViewModel_toggle_sort_new_key_selects_it_descending()
    {
        using var vm = NewViewModel(Loaded());
        await vm.LoadAsync();

        vm.ToggleSort(LiveSignalSortKey.Timestamp);

        Assert.Equal(LiveSignalSortKey.Timestamp, vm.SortKey);
        Assert.Equal(LiveSignalSortDirection.Descending, vm.SortDir);
    }

    // ---- Repository source request shape (engine + fake client) ---------------------

    [Fact]
    public async Task Source_streams_snapshot_and_targets_the_live_operation_with_vehicle_path()
    {
        using var doc = JsonDocument.Parse(Snapshot);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamLiveSignalsAsync(5));

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(4, emissions[^1].Value!.Count);
        Assert.Equal("get_api_v1_signals_vehicleID_live", client.Requests[^1].OperationId);
        Assert.Equal("5", client.Requests[^1].PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_signal_less_snapshot_streams_empty()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":5,"signals":{}}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamLiveSignalsAsync(5));

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registry + diagnostics -----------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_and_slug()
    {
        Assert.Equal("live-signals-table", LiveSignalsTableRegistration.Id);
        Assert.Equal("LiveSignalsTable", LiveSignalsTableRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new LiveSignalsTableDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LiveSignalsTable", Assert.Single(sink));
    }

    // ---- helpers --------------------------------------------------------------------

    private static LiveSignalsTableViewModel NewViewModel(RepositoryResult<IReadOnlyList<LiveSignalRow>> result) =>
        new(new FakeSource(result), vehicleId: 5, Localizer, () => Now);

    private static LiveSignalsTableSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new LiveSignalsTableSource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<LiveSignalRow>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<LiveSignalRow>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<LiveSignalRow>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private static IReadOnlyList<LiveSignalRow> Rows()
    {
        using var doc = JsonDocument.Parse(Snapshot);
        return LiveSignalRow.ParseSnapshot(doc.RootElement);
    }

    private static IReadOnlyList<LiveSignalRow> Sample() =>
        new[] { new LiveSignalRow("VehicleSpeed", "42.5", Now.AddSeconds(-30)) };

    private static RepositoryResult<IReadOnlyList<LiveSignalRow>> Loaded() =>
        RepositoryResult<IReadOnlyList<LiveSignalRow>>.Loaded(Rows(), Now);

    private sealed class FakeSource : ILiveSignalsTableSource
    {
        private readonly RepositoryResult<IReadOnlyList<LiveSignalRow>> _result;

        public FakeSource(RepositoryResult<IReadOnlyList<LiveSignalRow>> result) => _result = result;

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<LiveSignalRow>>> StreamLiveSignalsAsync(
            long vehicleId,
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return RepositoryResult<IReadOnlyList<LiveSignalRow>>.Loading();
            await Task.Yield();
            yield return _result;
        }
    }
}
