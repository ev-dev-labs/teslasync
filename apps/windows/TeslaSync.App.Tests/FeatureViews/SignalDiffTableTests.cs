using System.Globalization;
using System.Text.Json;
using System.Threading;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Signal Diff table surface's UI-thread-free logic — the diff-response JSON
/// parse + value coercion (<c>formatRaw</c> / <c>asNumber</c>), the Δ computation (<c>deltaLabel</c>), the
/// cache-then-network result mapper, the filter + pinned-first projection (the web <c>sortedRows</c>
/// <c>useMemo</c>), the repository source's request shape, the state-holder view-model's per-state matrix
/// (loading / loaded / empty / error / stale / offline), the selection + pin commands, the registry metadata
/// and the diagnostics. Mirrors the web spec
/// (web/src/features/telemetry/components/SignalDiffTable.tsx).
/// </summary>
public sealed class SignalDiffTableTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string DiffResponse = """
    {
      "vehicle_id": 7,
      "at_a": "2026-06-06T11:00:00Z",
      "at_b": "2026-06-06T12:00:00Z",
      "count": 3,
      "data": [
        { "name": "BatteryLevel", "value_a": 80, "value_b": 78, "source_a": "l1", "source_b": "log", "age_ms_a": 1200, "age_ms_b": 65000, "changed": true },
        { "name": "Gear", "value_a": "P", "value_b": "D", "source_a": "l2", "source_b": "l1", "changed": true },
        { "name": "Location", "value_a": {"lat":1}, "value_b": {"lat":2}, "changed": true }
      ]
    }
    """;

    public SignalDiffTableTests()
    {
        // Deterministic numeric formatting for the Δ-cell assertions (the production formatter reads
        // CurrentCulture so the user's locale formats the delta; pinning it to invariant here makes the
        // expected '.'-decimal strings stable regardless of the runner's locale).
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
    }

    // ---- Diff parse adapter ---------------------------------------------------------

    [Fact]
    public void ParseResponse_parses_rows_and_coerces_values()
    {
        using var doc = JsonDocument.Parse(DiffResponse);
        var rows = SignalDiffRow.ParseResponse(doc.RootElement);

        var byName = rows.ToDictionary(r => r.Name, StringComparer.Ordinal);
        Assert.Equal(3, rows.Count);

        // Numeric values: coerced to display (fmtNumber, precision 2) + numeric projection; source + age kept.
        Assert.Equal("80.00", byName["BatteryLevel"].DisplayA);
        Assert.Equal("78.00", byName["BatteryLevel"].DisplayB);
        Assert.Equal(80d, byName["BatteryLevel"].NumericA);
        Assert.Equal(78d, byName["BatteryLevel"].NumericB);
        Assert.Equal("l1", byName["BatteryLevel"].SourceA);
        Assert.Equal("log", byName["BatteryLevel"].SourceB);
        Assert.Equal(1200d, byName["BatteryLevel"].AgeMsA);
        Assert.Equal(65000d, byName["BatteryLevel"].AgeMsB);
        Assert.True(byName["BatteryLevel"].Changed);

        // Bare strings render verbatim and are non-numeric.
        Assert.Equal("P", byName["Gear"].DisplayA);
        Assert.Equal("D", byName["Gear"].DisplayB);
        Assert.Null(byName["Gear"].NumericA);

        // Compound objects flow through as JSON (never crash the cell), no age.
        Assert.Equal("{\"lat\":1}", byName["Location"].DisplayA);
        Assert.Equal("{\"lat\":2}", byName["Location"].DisplayB);
        Assert.Null(byName["Location"].AgeMsA);
    }

    [Fact]
    public void ParseResponse_is_tolerant_of_missing_data_and_non_object()
    {
        using var noData = JsonDocument.Parse("""{"vehicle_id":7}""");
        Assert.Empty(SignalDiffRow.ParseResponse(noData.RootElement));

        using var notObject = JsonDocument.Parse("[]");
        Assert.Empty(SignalDiffRow.ParseResponse(notObject.RootElement));

        using var emptyData = JsonDocument.Parse("""{"data":[]}""");
        Assert.Empty(SignalDiffRow.ParseResponse(emptyData.RootElement));

        using var dataNotArray = JsonDocument.Parse("""{"data":"nope"}""");
        Assert.Empty(SignalDiffRow.ParseResponse(dataNotArray.RootElement));
    }

    [Fact]
    public void FormatRaw_and_AsNumber_match_web_coercion()
    {
        Assert.Equal("\u2014", SignalDiffRow.FormatRaw(default)); // undefined → em-dash

        using var nul = JsonDocument.Parse("null");
        Assert.Equal("\u2014", SignalDiffRow.FormatRaw(nul.RootElement));
        Assert.Null(SignalDiffRow.AsNumber(nul.RootElement));

        using var num = JsonDocument.Parse("42.5");
        Assert.Equal("42.50", SignalDiffRow.FormatRaw(num.RootElement));
        Assert.Equal(42.5d, SignalDiffRow.AsNumber(num.RootElement));

        using var boolean = JsonDocument.Parse("true");
        Assert.Equal("true", SignalDiffRow.FormatRaw(boolean.RootElement));
        Assert.Equal(1d, SignalDiffRow.AsNumber(boolean.RootElement));

        using var numericString = JsonDocument.Parse("\"15.5\"");
        Assert.Equal(15.5d, SignalDiffRow.AsNumber(numericString.RootElement));

        using var blank = JsonDocument.Parse("\"   \"");
        Assert.Null(SignalDiffRow.AsNumber(blank.RootElement));

        using var word = JsonDocument.Parse("\"Drive\"");
        Assert.Null(SignalDiffRow.AsNumber(word.RootElement));
    }

    // ---- Δ computation (deltaLabel parity) ------------------------------------------

    [Fact]
    public void Delta_numeric_increase_shows_signed_delta_and_percent()
    {
        var cell = SignalDiffDeltaCell.Compute(Row("S", 10, 15), Localizer);
        Assert.Equal(SignalDiffDeltaTone.Positive, cell.Tone);
        Assert.Equal("+5.00 (+50.0%)", cell.Text);
    }

    [Fact]
    public void Delta_numeric_decrease_is_negative()
    {
        var cell = SignalDiffDeltaCell.Compute(Row("S", 20, 10), Localizer);
        Assert.Equal(SignalDiffDeltaTone.Negative, cell.Tone);
        Assert.Equal("-10.00 (-50.0%)", cell.Text);
    }

    [Fact]
    public void Delta_from_zero_baseline_omits_percent()
    {
        var cell = SignalDiffDeltaCell.Compute(Row("S", 0, 5), Localizer);
        Assert.Equal(SignalDiffDeltaTone.Positive, cell.Tone);
        Assert.Equal("+5.00", cell.Text);
    }

    [Fact]
    public void Delta_equal_numbers_is_neutral_zero()
    {
        var cell = SignalDiffDeltaCell.Compute(Row("S", 5, 5), Localizer);
        Assert.Equal(SignalDiffDeltaTone.Neutral, cell.Tone);
        Assert.Equal("0.00 (+0.0%)", cell.Text);
    }

    [Fact]
    public void Delta_non_numeric_difference_is_changed()
    {
        var row = new SignalDiffRow("Gear", "P", "D", null, null, null, null, null, null, true);
        var cell = SignalDiffDeltaCell.Compute(row, Localizer);
        Assert.Equal(SignalDiffDeltaTone.Changed, cell.Tone);
        Assert.Equal("changed", cell.Text);
    }

    [Fact]
    public void Delta_identical_display_is_no_change_em_dash()
    {
        var row = new SignalDiffRow("Mode", "Sentry", "Sentry", null, null, null, null, null, null, false);
        var cell = SignalDiffDeltaCell.Compute(row, Localizer);
        Assert.Equal(SignalDiffDeltaTone.NoChange, cell.Tone);
        Assert.Equal("\u2014", cell.Text);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(DiffResponse);

        var cached = SignalDiffTableResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(3, cached.Value!.Count);

        var offline = SignalDiffTableResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(3, offline.Value!.Count);
    }

    [Fact]
    public void Map_collapses_loaded_empty_diff_to_empty_and_maps_failure_and_loading()
    {
        using var empty = JsonDocument.Parse("""{"data":[]}""");
        Assert.Equal(LoadStatus.Empty, SignalDiffTableResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(empty.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Error, SignalDiffTableResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);

        Assert.Equal(LoadStatus.Loading, SignalDiffTableResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- Projection: filter + pinned-first sort -------------------------------------

    [Fact]
    public void Project_sorts_by_name_then_floats_pinned_first()
    {
        var display = SignalDiffProjection.Project(Rows(), "", Empty(), Localizer);
        Assert.Equal(new[] { "BatteryLevel", "Gear", "Location" }, display.Rows.Select(r => r.Name));

        var pinned = SignalDiffProjection.Project(Rows(), "", Pinned("Location"), Localizer);
        Assert.Equal(new[] { "Location", "BatteryLevel", "Gear" }, pinned.Rows.Select(r => r.Name));
        Assert.True(pinned.Rows[0].IsPinned);
    }

    [Fact]
    public void Project_filters_by_case_insensitive_name_substring()
    {
        var display = SignalDiffProjection.Project(Rows(), "batt", Empty(), Localizer);
        Assert.True(display.HasRows);
        Assert.Equal("BatteryLevel", Assert.Single(display.Rows).Name);
    }

    [Fact]
    public void Project_no_match_yields_empty_display()
    {
        var display = SignalDiffProjection.Project(Rows(), "zzz", Empty(), Localizer);
        Assert.False(display.HasRows);
        Assert.Empty(display.Rows);
    }

    [Fact]
    public void Project_composes_automation_name_with_labels_and_values()
    {
        var display = SignalDiffProjection.Project(Rows(), "batt", Empty(), Localizer);
        string automation = Assert.Single(display.Rows).AutomationName;
        Assert.Contains("BatteryLevel", automation, StringComparison.Ordinal);
        Assert.Contains("Window A: 80.00", automation, StringComparison.Ordinal);
        Assert.Contains("Window B: 78.00", automation, StringComparison.Ordinal);
        Assert.Contains("\u0394:", automation, StringComparison.Ordinal);
    }

    // ---- View-model: state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_until_resolved()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SignalDiffRow>>.Loading());
        await vm.LoadAsync();
        Assert.Equal(SignalDiffSectionState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_with_rows()
    {
        using var vm = NewViewModel(Loaded());
        await vm.LoadAsync();

        Assert.Equal(SignalDiffSectionState.Loaded, vm.State);
        Assert.True(vm.HasDiffs);
        Assert.True(vm.Display.HasRows);
        Assert.False(vm.IsError);
        Assert.NotNull(vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_diff()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SignalDiffRow>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SignalDiffSectionState.Empty, vm.State);
        Assert.False(vm.HasDiffs);
        Assert.Equal("No differences between the two snapshots", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_error_with_no_cache()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SignalDiffRow>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SignalDiffSectionState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_rows()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SignalDiffRow>>.Cached(
            Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SignalDiffSectionState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasRows);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_rows_and_sets_error_chip()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SignalDiffRow>>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SignalDiffSectionState.Offline, vm.State);
        Assert.True(vm.Display.HasRows);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_filter_reprojects_without_refetch_and_flags_active()
    {
        using var vm = NewViewModel(Loaded());
        await vm.LoadAsync();
        Assert.Equal(3, vm.Display.Rows.Count);
        Assert.False(vm.FilterActive);

        vm.SetFilter("gear");

        Assert.True(vm.FilterActive);
        Assert.Equal("Gear", Assert.Single(vm.Display.Rows).Name);
        Assert.True(vm.HasDiffs); // underlying diff is unchanged

        vm.SetFilter("zzz");
        Assert.False(vm.Display.HasRows); // filtered-empty, but still HasDiffs
        Assert.True(vm.HasDiffs);
    }

    // ---- View-model: selection (web selectedSignals / onSelectionChange) ------------

    [Fact]
    public async Task ViewModel_selection_toggle_select_all_and_clear()
    {
        using var vm = NewViewModel(Loaded());
        await vm.LoadAsync();

        var events = new List<int>();
        vm.SelectionChanged += (_, sel) => events.Add(sel.Count);

        vm.ToggleSelection("Gear");
        Assert.Equal(new[] { "Gear" }, vm.SelectedSignals);
        Assert.True(vm.IsSelected("Gear"));

        vm.ToggleSelection("Gear");
        Assert.Empty(vm.SelectedSignals);

        vm.SelectAllVisible();
        Assert.Equal(3, vm.SelectedCount);

        vm.ClearSelection();
        Assert.Equal(0, vm.SelectedCount);

        Assert.Equal(new[] { 1, 0, 3, 0 }, events);
    }

    // ---- View-model: pinning (web pinnedSignals + useTogglePin) ---------------------

    [Fact]
    public async Task ViewModel_toggle_pin_reorders_and_raises_event()
    {
        using var vm = NewViewModel(Loaded());
        await vm.LoadAsync();
        Assert.Equal("BatteryLevel", vm.Display.Rows[0].Name);

        SignalDiffPinChange? change = null;
        vm.PinToggled += (_, c) => change = c;

        vm.TogglePin("Location");

        Assert.True(vm.IsPinned("Location"));
        Assert.Equal("Location", vm.Display.Rows[0].Name); // pinned floats to the top
        Assert.Equal(new SignalDiffPinChange("Location", true), change);

        vm.TogglePin("Location");
        Assert.False(vm.IsPinned("Location"));
        Assert.Equal("BatteryLevel", vm.Display.Rows[0].Name);
    }

    [Fact]
    public async Task ViewModel_set_pinned_seeds_without_event()
    {
        using var vm = NewViewModel(Loaded());
        await vm.LoadAsync();

        bool raised = false;
        vm.PinToggled += (_, _) => raised = true;

        vm.SetPinned(new[] { "Gear" });

        Assert.True(vm.IsPinned("Gear"));
        Assert.Equal("Gear", vm.Display.Rows[0].Name);
        Assert.False(raised);
    }

    // ---- Repository source request shape (engine + fake client) ---------------------

    [Fact]
    public async Task Source_streams_diff_and_targets_the_diff_operation_with_vehicle_path()
    {
        using var doc = JsonDocument.Parse(DiffResponse);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamDiffAsync(7));

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(3, emissions[^1].Value!.Count);
        Assert.Equal("get_api_v1_signals_vehicleID_diff", client.Requests[^1].OperationId);
        Assert.Equal("7", client.Requests[^1].PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_identical_snapshots_stream_empty()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":7,"count":0,"data":[]}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamDiffAsync(7));

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registry + diagnostics -----------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_and_slug()
    {
        Assert.Equal("signal-diff-table", SignalDiffTableRegistration.Id);
        Assert.Equal("SignalDiffTable", SignalDiffTableRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new SignalDiffTableDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SignalDiffTable", Assert.Single(sink));
    }

    // ---- helpers --------------------------------------------------------------------

    private static SignalDiffRow Row(string name, double a, double b) =>
        new(name, SignalDiffFormat.Number(a), SignalDiffFormat.Number(b), a, b, "l1", "l1", null, null, true);

    private static IReadOnlySet<string> Empty() => new HashSet<string>(StringComparer.Ordinal);

    private static IReadOnlySet<string> Pinned(params string[] names) =>
        new HashSet<string>(names, StringComparer.Ordinal);

    private static SignalDiffTableViewModel NewViewModel(RepositoryResult<IReadOnlyList<SignalDiffRow>> result) =>
        new(new FakeSource(result), vehicleId: 7, Localizer);

    private static SignalDiffTableSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new SignalDiffTableSource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<SignalDiffRow>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<SignalDiffRow>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<SignalDiffRow>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private static IReadOnlyList<SignalDiffRow> Rows()
    {
        using var doc = JsonDocument.Parse(DiffResponse);
        return SignalDiffRow.ParseResponse(doc.RootElement);
    }

    private static IReadOnlyList<SignalDiffRow> Sample() => Rows();

    private static RepositoryResult<IReadOnlyList<SignalDiffRow>> Loaded() =>
        RepositoryResult<IReadOnlyList<SignalDiffRow>>.Loaded(Rows(), Now);

    private sealed class FakeSource : ISignalDiffTableSource
    {
        private readonly RepositoryResult<IReadOnlyList<SignalDiffRow>> _result;

        public FakeSource(RepositoryResult<IReadOnlyList<SignalDiffRow>> result) => _result = result;

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SignalDiffRow>>> StreamDiffAsync(
            long vehicleId,
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return RepositoryResult<IReadOnlyList<SignalDiffRow>>.Loading();
            await Task.Yield();
            yield return _result;
        }
    }
}
