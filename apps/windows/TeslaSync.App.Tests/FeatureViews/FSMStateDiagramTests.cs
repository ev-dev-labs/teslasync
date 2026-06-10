using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the State Diagram surface's UI-thread-free logic — the FSM registry
/// (states / edges / colour variants), the transition parse adapter, the diagram projection (per-state
/// counts, latest state, edge summary, accessibility labels) and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline), plus the registration metadata and
/// diagnostics. Mirrors the web spec (web/src/features/system/components/FSMStateDiagram.tsx).
/// </summary>
public sealed class FSMStateDiagramTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    // ---- Registry: states / edges --------------------------------------------------

    [Theory]
    [InlineData("vehicle", 7)]
    [InlineData("drive_session", 5)]
    [InlineData("charge_session", 5)]
    [InlineData("command", 10)]
    [InlineData("notification", 7)]
    [InlineData("alert_cooldown", 3)]
    [InlineData("automation", 11)]
    [InlineData("telemetry_connection", 6)]
    public void Registry_has_each_diagrammable_fsm(string fsmType, int stateCount)
    {
        Assert.True(FsmStateDiagramRegistry.HasDiagram(fsmType));
        Assert.Equal(stateCount, FsmStateDiagramRegistry.States(fsmType)!.Count);
        Assert.NotEmpty(FsmStateDiagramRegistry.Edges(fsmType)!);
    }

    [Theory]
    [InlineData("all")]
    [InlineData("unknown")]
    [InlineData("")]
    [InlineData(null)]
    public void Registry_rejects_undiagrammed_types(string? fsmType)
    {
        Assert.False(FsmStateDiagramRegistry.HasDiagram(fsmType));
        Assert.Null(FsmStateDiagramRegistry.States(fsmType));
        Assert.Null(FsmStateDiagramRegistry.Edges(fsmType));
    }

    [Fact]
    public void Registry_preserves_web_vehicle_state_order()
    {
        Assert.Equal(
            new[] { "online", "driving", "charging", "parked", "updating", "asleep", "offline" },
            FsmStateDiagramRegistry.States("vehicle"));
    }

    [Fact]
    public void Registry_edges_reference_only_declared_states()
    {
        foreach (var (fsmType, def) in FsmStateDiagramRegistry.All)
        {
            var states = new HashSet<string>(def.States, StringComparer.Ordinal);
            foreach (var edge in def.Edges)
            {
                Assert.True(states.Contains(edge.From), $"{fsmType}: unknown from-state {edge.From}");
                Assert.True(states.Contains(edge.To), $"{fsmType}: unknown to-state {edge.To}");
            }
        }
    }

    [Fact]
    public void Registry_edges_are_deduplicated()
    {
        foreach (var (fsmType, def) in FsmStateDiagramRegistry.All)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var edge in def.Edges)
            {
                Assert.True(seen.Add(edge.From + "->" + edge.To), $"{fsmType}: duplicate edge {edge.From}->{edge.To}");
            }
        }
    }

    // ---- Registry: colour variants -------------------------------------------------

    [Theory]
    [InlineData("vehicle", "online", FsmStateVariant.Success)]
    [InlineData("vehicle", "offline", FsmStateVariant.Danger)]
    [InlineData("vehicle", "charging", FsmStateVariant.Warning)]
    [InlineData("vehicle", "parked", FsmStateVariant.Info)]
    [InlineData("vehicle", "asleep", FsmStateVariant.Neutral)]
    [InlineData("vehicle", "OFFLINE", FsmStateVariant.Danger)] // case-insensitive (web .toLowerCase())
    [InlineData("command", "gave_up", FsmStateVariant.Danger)]
    [InlineData("vehicle", "nonsense", FsmStateVariant.Neutral)]
    public void VariantFor_maps_states(string fsmType, string state, FsmStateVariant expected) =>
        Assert.Equal(expected, FsmStateDiagramRegistry.VariantFor(fsmType, state));

    [Theory]
    [InlineData(FsmStateVariant.Success, "TsColorSuccessBrush")]
    [InlineData(FsmStateVariant.Warning, "TsColorWarningBrush")]
    [InlineData(FsmStateVariant.Danger, "TsColorDangerBrush")]
    [InlineData(FsmStateVariant.Info, "TsColorInfoBrush")]
    [InlineData(FsmStateVariant.Neutral, "TsColorTextMutedBrush")]
    public void BrushKeyFor_maps_variants_to_tokens(FsmStateVariant variant, string expected) =>
        Assert.Equal(expected, FsmStateDiagramRegistry.BrushKeyFor(variant));

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ParseList_reads_the_paged_data_shape()
    {
        var list = FsmTransition.ParseList(Json("""
        { "data": [
            { "id": 1, "ts": "2026-06-09T11:00:00Z", "fsm_name": "vehicle", "from_state": "online", "to_state": "driving" },
            { "id": 2, "ts": "2026-06-09T11:05:00Z", "fsm_name": "vehicle", "from_state": "driving", "to_state": "parked" }
          ], "total": 2, "page": 1, "per_page": 50 }
        """));

        Assert.Equal(2, list.Count);
        Assert.Equal("vehicle", list[0].FsmName);
        Assert.Equal("online", list[0].FromState);
        Assert.Equal("driving", list[0].ToState);
        Assert.Equal(new DateTimeOffset(2026, 6, 9, 11, 0, 0, TimeSpan.Zero), list[0].Timestamp);
    }

    [Fact]
    public void ParseList_reads_a_bare_array_and_camelCase_keys()
    {
        var list = FsmTransition.ParseList(Json("""
        [ { "fsmName": "vehicle", "fromState": "asleep", "toState": "online" } ]
        """));

        var row = Assert.Single(list);
        Assert.Equal("vehicle", row.FsmName);
        Assert.Equal("asleep", row.FromState);
        Assert.Equal("online", row.ToState);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array_or_bad_rows()
    {
        Assert.Empty(FsmTransition.ParseList(Json("{}")));
        Assert.Empty(FsmTransition.ParseList(Json("null")));
        Assert.Empty(FsmTransition.ParseList(Json("42")));
        Assert.Empty(FsmTransition.ParseList(Json("""{ "data": null }""")));

        // Non-object array items are skipped, not parsed.
        Assert.Empty(FsmTransition.ParseList(Json("""[ 1, "x", true ]""")));
    }

    [Fact]
    public void ParseList_tolerates_missing_or_unparseable_timestamp()
    {
        var list = FsmTransition.ParseList(Json("""
        [ { "fsm_name": "vehicle", "from_state": "online", "to_state": "driving" },
          { "ts": "not-a-date", "fsm_name": "vehicle", "from_state": "driving", "to_state": "online" } ]
        """));

        Assert.Equal(2, list.Count);
        Assert.Null(list[0].Timestamp);
        Assert.Null(list[1].Timestamp);
    }

    // ---- Projection: counts, latest, edges -----------------------------------------

    [Fact]
    public void Project_tallies_state_counts_from_both_endpoints()
    {
        var display = FsmStateDiagramProjection.Project("vehicle", new[]
        {
            Tr("online", "driving", "2026-06-09T11:00:00Z"),
            Tr("driving", "parked", "2026-06-09T11:05:00Z"),
        }, Localizer);

        Assert.True(display.IsSupported);
        // online: 1 (from), driving: 2 (to + from), parked: 1 (to)
        Assert.Equal(1, Node(display, "online").Count);
        Assert.Equal(2, Node(display, "driving").Count);
        Assert.Equal(1, Node(display, "parked").Count);
        Assert.Equal(0, Node(display, "asleep").Count);
        Assert.False(Node(display, "asleep").IsActive);
        Assert.True(Node(display, "driving").IsActive);
    }

    [Fact]
    public void Project_marks_latest_state_by_timestamp()
    {
        var display = FsmStateDiagramProjection.Project("vehicle", new[]
        {
            Tr("online", "driving", "2026-06-09T11:00:00Z"),
            Tr("driving", "parked", "2026-06-09T11:30:00Z"),
            Tr("online", "charging", "2026-06-09T10:00:00Z"),
        }, Localizer);

        Assert.True(Node(display, "parked").IsCurrent);
        Assert.False(Node(display, "driving").IsCurrent);
        Assert.False(Node(display, "charging").IsCurrent);
    }

    [Fact]
    public void Project_emits_next_edge_counts_between_consecutive_nodes()
    {
        var display = FsmStateDiagramProjection.Project("vehicle", new[]
        {
            Tr("online", "driving", "2026-06-09T11:00:00Z"),
            Tr("online", "driving", "2026-06-09T11:01:00Z"),
        }, Localizer);

        // online -> driving are consecutive in the vehicle state order.
        Assert.Equal(2, Node(display, "online").NextEdgeCount);
        // driving -> charging never occurred.
        Assert.Null(Node(display, "driving").NextEdgeCount);
    }

    [Fact]
    public void Project_orders_edge_summary_by_count_descending_and_caps_at_ten()
    {
        var transitions = new List<FsmTransition>();
        // 11 distinct vehicle edges, each repeated (i+1) times, in ascending order of frequency.
        var edges = new (string From, string To)[]
        {
            ("online", "driving"), ("online", "charging"), ("online", "parked"), ("online", "asleep"),
            ("online", "offline"), ("driving", "parked"), ("driving", "charging"), ("driving", "online"),
            ("charging", "driving"), ("charging", "parked"), ("parked", "online"),
        };
        for (int i = 0; i < edges.Length; i++)
        {
            for (int n = 0; n <= i; n++)
            {
                transitions.Add(Tr(edges[i].From, edges[i].To, "2026-06-09T11:00:00Z"));
            }
        }

        var display = FsmStateDiagramProjection.Project("vehicle", transitions, Localizer);

        Assert.True(display.HasEdgeSummary);
        Assert.Equal(10, display.EdgeSummary.Count); // capped
        // Highest-frequency edge (parked->online, repeated 11x) is first.
        Assert.Equal("parked", display.EdgeSummary[0].From);
        Assert.Equal("online", display.EdgeSummary[0].To);
        // Descending order is preserved.
        for (int i = 1; i < display.EdgeSummary.Count; i++)
        {
            Assert.True(display.EdgeSummary[i - 1].Count >= display.EdgeSummary[i].Count);
        }
    }

    [Fact]
    public void Project_filters_transitions_to_the_selected_fsm()
    {
        var display = FsmStateDiagramProjection.Project("vehicle", new[]
        {
            Tr("online", "driving", "2026-06-09T11:00:00Z", fsm: "vehicle"),
            Tr("pending", "active", "2026-06-09T11:05:00Z", fsm: "drive_session"),
        }, Localizer);

        Assert.Equal(1, Node(display, "driving").Count);
        // The drive_session row is ignored for the vehicle diagram.
        Assert.DoesNotContain(display.Nodes, n => string.Equals(n.State, "active", StringComparison.Ordinal));
    }

    [Fact]
    public void Project_unsupported_type_yields_the_select_empty_state()
    {
        var display = FsmStateDiagramProjection.Project("all", new[]
        {
            Tr("online", "driving", "2026-06-09T11:00:00Z"),
        }, Localizer);

        Assert.False(display.IsSupported);
        Assert.Empty(display.Nodes);
        Assert.False(display.HasEdgeSummary);
        Assert.Equal(FsmStateDiagramText.SelectFsmTypeFallback, display.EmptyMessage);
    }

    [Fact]
    public void Project_supported_type_with_no_rows_renders_dimmed_diagram()
    {
        var display = FsmStateDiagramProjection.Project("vehicle", Array.Empty<FsmTransition>(), Localizer);

        Assert.True(display.IsSupported);
        Assert.Equal(7, display.Nodes.Count);
        Assert.All(display.Nodes, n => Assert.Equal(0, n.Count));
        Assert.All(display.Nodes, n => Assert.False(n.IsActive));
        Assert.All(display.Nodes, n => Assert.False(n.IsCurrent));
        Assert.False(display.HasEdgeSummary);
    }

    // ---- Projection: accessibility labels ------------------------------------------

    [Fact]
    public void Project_composes_node_and_surface_accessibility_names()
    {
        var display = FsmStateDiagramProjection.Project("vehicle", new[]
        {
            Tr("online", "driving", "2026-06-09T11:00:00Z"),
        }, Localizer);

        var driving = Node(display, "driving");
        Assert.Contains("driving", driving.AutomationName, StringComparison.Ordinal);
        Assert.Contains("1 transitions", driving.AutomationName, StringComparison.Ordinal);
        Assert.Contains("current state", driving.AutomationName, StringComparison.Ordinal);

        var asleep = Node(display, "asleep");
        Assert.Equal("asleep", asleep.AutomationName); // no count, not current

        Assert.Contains("7 states", display.AutomationName, StringComparison.Ordinal);

        var edge = Assert.Single(display.EdgeSummary);
        Assert.Contains("online to driving", edge.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_resolves_node_brush_keys_from_the_registry()
    {
        var display = FsmStateDiagramProjection.Project("vehicle", Array.Empty<FsmTransition>(), Localizer);
        Assert.Equal("TsColorSuccessBrush", Node(display, "online").BrushKey);
        Assert.Equal("TsColorDangerBrush", Node(display, "offline").BrushKey);
        Assert.Equal("TsColorTextMutedBrush", Node(display, "asleep").BrushKey);
    }

    // ---- ViewModel: per-state transitions ------------------------------------------

    [Fact]
    public async Task ViewModel_unsupported_type_is_empty_without_loading()
    {
        using var vm = new FsmStateDiagramViewModel(new ThrowingSource(), "all", Localizer);
        Assert.False(vm.IsSupported);
        Assert.Equal(FsmStateDiagramState.Empty, vm.State);

        // LoadAsync is a no-op for an undiagrammed type (the ThrowingSource is never enumerated).
        await vm.LoadAsync();

        Assert.Equal(FsmStateDiagramState.Empty, vm.State);
        Assert.False(vm.Display.IsSupported);
    }

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel("vehicle", RepositoryResult<IReadOnlyList<FsmTransition>>.Loading());
        await vm.LoadAsync();
        Assert.Equal(FsmStateDiagramState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_the_diagram()
    {
        using var vm = NewViewModel("vehicle", Loaded(new[]
        {
            Tr("online", "driving", "2026-06-09T11:00:00Z"),
        }));
        await vm.LoadAsync();

        Assert.Equal(FsmStateDiagramState.Loaded, vm.State);
        Assert.True(vm.Display.IsSupported);
        Assert.Equal(7, vm.Display.Nodes.Count);
        Assert.Equal(Now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_response_renders_loaded_dimmed_diagram()
    {
        using var vm = NewViewModel("vehicle", RepositoryResult<IReadOnlyList<FsmTransition>>.Empty(Now));
        await vm.LoadAsync();

        // A supported FSM type with no rows is still the diagram, not the "select a type" empty surface.
        Assert.Equal(FsmStateDiagramState.Loaded, vm.State);
        Assert.True(vm.Display.IsSupported);
        Assert.All(vm.Display.Nodes, n => Assert.Equal(0, n.Count));
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            "vehicle",
            RepositoryResult<IReadOnlyList<FsmTransition>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(FsmStateDiagramState.Error, vm.State);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.Equal(1, vm.Attempts);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            "vehicle",
            RepositoryResult<IReadOnlyList<FsmTransition>>.Cached(
                new[] { Tr("online", "driving", "2026-06-09T11:00:00Z") }, Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(FsmStateDiagramState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.IsSupported);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_message()
    {
        using var vm = NewViewModel(
            "vehicle",
            RepositoryResult<IReadOnlyList<FsmTransition>>.OfflineCached(
                new[] { Tr("online", "driving", "2026-06-09T11:00:00Z") },
                Now,
                new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(FsmStateDiagramState.Offline, vm.State);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Display.IsSupported);
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            "vehicle",
            RepositoryResult<IReadOnlyList<FsmTransition>>.Loading(),
            RepositoryResult<IReadOnlyList<FsmTransition>>.Cached(
                new[] { Tr("online", "driving", "2026-06-09T11:00:00Z") }, Now, stale: false),
            RepositoryResult<IReadOnlyList<FsmTransition>>.Loaded(
                new[]
                {
                    Tr("online", "driving", "2026-06-09T11:00:00Z"),
                    Tr("driving", "parked", "2026-06-09T11:05:00Z"),
                },
                Now));
        await vm.LoadAsync();

        Assert.Equal(FsmStateDiagramState.Loaded, vm.State);
        Assert.Equal(1, Node(vm.Display, "parked").Count);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new FsmStateDiagramDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FSMStateDiagram", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_canonical_metadata()
    {
        Assert.Equal("fsm-state-diagram", FsmStateDiagramRegistration.Id);
        Assert.Equal("FSMStateDiagram", FsmStateDiagramRegistration.Slug);
        Assert.Equal("State Diagram", FsmStateDiagramRegistration.Name(Localizer));
    }

    // ---- Helpers -------------------------------------------------------------------

    private static FsmStateDiagramViewModel NewViewModel(
        string fsmType,
        params RepositoryResult<IReadOnlyList<FsmTransition>>[] emissions) =>
        new(new FakeSource(emissions), fsmType, Localizer);

    private static RepositoryResult<IReadOnlyList<FsmTransition>> Loaded(IReadOnlyList<FsmTransition> transitions) =>
        RepositoryResult<IReadOnlyList<FsmTransition>>.Loaded(transitions, Now);

    private static FsmTransition Tr(string from, string to, string? ts = null, string fsm = "vehicle") =>
        new(
            ts is null
                ? null
                : DateTimeOffset.Parse(ts, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal),
            fsm,
            from,
            to);

    private static FsmStateNode Node(FsmStateDiagramDisplay display, string state) =>
        display.Nodes.Single(n => string.Equals(n.State, state, StringComparison.Ordinal));

    private static JsonElement Json(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private sealed class FakeSource : IFsmStateDiagramSource
    {
        private readonly RepositoryResult<IReadOnlyList<FsmTransition>>[] _emissions;

        public FakeSource(RepositoryResult<IReadOnlyList<FsmTransition>>[] emissions) => _emissions = emissions;

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<FsmTransition>>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in _emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class ThrowingSource : IFsmStateDiagramSource
    {
        public IAsyncEnumerable<RepositoryResult<IReadOnlyList<FsmTransition>>> StreamAsync(
            CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("Unsupported FSM types must never read from the network.");
    }
}
