using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.Telemetry;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>StateMachineDebuggerPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/system/pages/StateMachineDebuggerPage.tsx): the pie + summary grouping, the flap / stat-card
/// derivations, the badge resolution, the windowed live section, the four data-state branches
/// (loading / empty / success) for every source, and the view-model's load / filter / pagination / selection
/// orchestration over the five generated-client operations. The WinUI view is exercised by the app build; its
/// per-region visibility is driven entirely by the <see cref="StateMachineDebuggerDisplay"/> flags asserted here.
/// </summary>
public sealed class StateMachineDebuggerPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 18, 0, 0, TimeSpan.Zero);

    // The 47 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "debugger.share",
        "fsm.allTime",
        "fsm.autoRefresh",
        "fsm.avgInterval",
        "fsm.col.count",
        "fsm.col.state",
        "fsm.count",
        "fsm.currentState",
        "fsm.detail.context",
        "fsm.detail.duration",
        "fsm.detail.from",
        "fsm.detail.guard",
        "fsm.detail.id",
        "fsm.detail.name",
        "fsm.detail.timestamp",
        "fsm.detail.to",
        "fsm.detail.trigger",
        "fsm.detail.vehicleId",
        "fsm.detailTitle",
        "fsm.distributionByState",
        "fsm.distributionByState.aria",
        "fsm.flapCount",
        "fsm.from",
        "fsm.fsmType",
        "fsm.mode",
        "fsm.noState",
        "fsm.noTransitionsInRange",
        "fsm.noVehicles",
        "fsm.perPage",
        "fsm.selectVehicle",
        "fsm.since",
        "fsm.state",
        "fsm.subtitle",
        "fsm.time",
        "fsm.timelineTitle",
        "fsm.title",
        "fsm.to",
        "fsm.total",
        "fsm.totalOnPage",
        "fsm.totalTransitions",
        "fsm.transitionCounts",
        "fsm.trigger",
        "fsm.type",
        "fsm.vehicleLiveState",
        "fsm.viewDetail",
        "help.fsm.liveState.aria",
        "help.fsm.type.aria",
    ];

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private static FsmTransitionRecord Tr(
        long id,
        string from,
        string to,
        DateTimeOffset ts,
        string fsm = "vehicle",
        string trigger = "telemetry",
        string? guard = null,
        double? durationMs = null,
        IReadOnlyList<KeyValuePair<string, string>>? details = null) =>
        new(id, 7, ts.ToString("o"), ts, fsm, from, to, trigger, guard, durationMs,
            details ?? Array.Empty<KeyValuePair<string, string>>(), "{\"id\":" + id + "}");

    private static IReadOnlyList<FsmTransitionRecord> SampleTransitions() =>
    [
        Tr(1, "parked", "driving", Now.AddMinutes(-2), guard: "speed>0", durationMs: 5000,
            details: new[] { new KeyValuePair<string, string>("guard", "speed>0"), new KeyValuePair<string, string>("duration_in_state_ms", "5000") }),
        Tr(2, "driving", "parked", Now.AddMinutes(-1)),
        Tr(3, "parked", "driving", Now.AddSeconds(-30)),
    ];

    private static StateMachineDebuggerModel Populated(long? selectedTransition = 1) =>
        StateMachineDebuggerModel.Initial with
        {
            Vehicles = [new VehicleOptionRecord(7, "Model 3")],
            SelectedVehicleId = 7,
            CurrentState = new CurrentStateInfo("driving", IsCharging: false, Speed: 30, Since: Now.AddHours(-1)),
            Transitions = SampleTransitions(),
            TotalRows = 42,
            ActiveSubs = [new ActiveSubFSM(SubFSMKind.Drive, "active", Now.AddMinutes(-3))],
            IsLive = selectedTransition is null,
            SelectedTransitionId = selectedTransition,
            HasLoaded = true,
            Now = Now,
        };

    [Fact]
    public void Projection_PopulatedModel_ResolvesEveryRequiredStringKey()
    {
        var recorder = new RecordingLocalizer();
        _ = StateMachineDebuggerProjection.Project(Populated(), recorder);

        var missing = RequiredStringKeys.Where(k => !recorder.Keys.Contains(k)).ToList();
        Assert.True(missing.Count == 0, "Missing i18n keys: " + string.Join(", ", missing));
    }

    [Fact]
    public void Projection_NoVehicles_HidesDataRegionsWithEmptyStates()
    {
        var display = StateMachineDebuggerProjection.Project(StateMachineDebuggerModel.Initial with { Now = Now }, Localizer);

        Assert.False(display.HasVehicles);
        Assert.False(display.ShowState);
        Assert.False(display.ShowTransitions);
        Assert.False(display.ShowCounts);
        Assert.False(display.ShowDetail);
        Assert.Equal(ChartState.Empty, display.ChartState);
        Assert.Equal("No vehicles available", display.NoVehiclesMessage);
    }

    [Fact]
    public void Projection_AllSourcesLoading_ShowsLoadingStates()
    {
        var model = StateMachineDebuggerModel.Initial with
        {
            SelectedVehicleId = 7,
            StateLoading = true,
            StatsLoading = true,
            TransitionsLoading = true,
            HasLoaded = false,
            Now = Now,
        };

        var display = StateMachineDebuggerProjection.Project(model, Localizer);

        Assert.True(display.InitialLoading);
        Assert.True(display.StateLoading);
        Assert.True(display.CountsLoading);
        Assert.True(display.TransitionsLoading);
        Assert.Equal(ChartState.Loading, display.ChartState);
    }

    [Fact]
    public void Projection_Populated_ComputesPieSummaryAndStatCards()
    {
        var display = StateMachineDebuggerProjection.Project(Populated(selectedTransition: null), Localizer);

        // Pie: to_state distribution — driving x2, parked x1, count-descending.
        Assert.Equal(2, display.PieValues.Count);
        Assert.Equal("driving", display.PieValues[0].Label);
        Assert.Equal(2, display.PieValues[0].Y);
        Assert.Equal(ChartState.Ready, display.ChartState);

        // Summary rows mirror the pie grouping.
        Assert.Equal(2, display.SummaryRows.Count);
        Assert.True(display.ShowCounts);

        // Four stat cards: page total, server total, flap count, current state.
        Assert.Equal(4, display.StatCards.Count);
        Assert.Equal("3 / 42", display.StatCards[0].Value);
        Assert.Equal("42", display.StatCards[1].Value);
        Assert.Equal("driving", display.StatCards[3].Value);

        // Transition rows + pagination.
        Assert.Equal(3, display.TransitionRows.Count);
        Assert.True(display.ShowPagination);
        Assert.Equal(42, display.TotalRows);
    }

    [Fact]
    public void Projection_SelectedTransition_RendersDetailPanel()
    {
        var display = StateMachineDebuggerProjection.Project(Populated(selectedTransition: 1), Localizer);

        Assert.True(display.ShowDetail);
        Assert.Contains(display.DetailFields, f => f.Label == "Transition ID");
        Assert.Contains(display.DetailFields, f => f.Label == "Guard");
        Assert.Contains(display.DetailFields, f => f.Label == "Duration in State");
        Assert.NotEmpty(display.DetailContextChips);
    }

    [Fact]
    public void Projection_HeroDerivesDriveMode_FromSpeed()
    {
        var display = StateMachineDebuggerProjection.Project(Populated(selectedTransition: null), Localizer);

        Assert.NotNull(display.Hero);
        Assert.Equal("driving", display.Hero!.StateText);
        Assert.Equal("Drive", display.Hero.ModeValue);
        Assert.True(display.Hero.HasSince);
    }

    private sealed class FakeFeed : IStateMachineDebuggerFeed
    {
        private readonly IReadOnlyList<VehicleOptionRecord> _vehicles;
        private readonly FsmTransitionsPage _page;

        public FakeFeed(IReadOnlyList<VehicleOptionRecord> vehicles, FsmTransitionsPage page)
        {
            _vehicles = vehicles;
            _page = page;
        }

        public int SnapshotCalls { get; private set; }

        public Task<IReadOnlyList<VehicleOptionRecord>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(_vehicles);

        public Task<CurrentStateInfo?> FetchStateAsync(long vehicleId, CancellationToken cancellationToken) =>
            Task.FromResult<CurrentStateInfo?>(new CurrentStateInfo("driving", false, 30, Now.AddHours(-1)));

        public Task<IReadOnlyList<ActiveSubFSM>> FetchActiveSubsAsync(long vehicleId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<ActiveSubFSM>>(Array.Empty<ActiveSubFSM>());

        public Task<FsmTransitionsPage> FetchTransitionsAsync(
            long vehicleId, string fsmType, int hours, int page, int perPage, CancellationToken cancellationToken) =>
            Task.FromResult(_page);

        public Task<SignalSnapshot?> FetchSnapshotAsync(long vehicleId, string atIso, CancellationToken cancellationToken)
        {
            SnapshotCalls++;
            return Task.FromResult<SignalSnapshot?>(SignalSnapshot.Empty);
        }
    }

    [Fact]
    public async Task ViewModel_LoadEmptyFeed_ResolvesNoVehicles()
    {
        using var vm = new StateMachineDebuggerPageViewModel(EmptyStateMachineDebuggerFeed.Instance, Localizer, () => Now);
        await vm.LoadAsync();

        Assert.Null(vm.SelectedVehicleId);
        Assert.False(vm.Display.HasVehicles);
        Assert.False(vm.Display.ShowTransitions);
    }

    [Fact]
    public async Task ViewModel_LoadWithVehicles_SelectsFirstAndShowsTransitions()
    {
        var feed = new FakeFeed(
            [new VehicleOptionRecord(7, "Model 3"), new VehicleOptionRecord(9, "Model Y")],
            new FsmTransitionsPage(SampleTransitions(), 42));
        using var vm = new StateMachineDebuggerPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(7, vm.SelectedVehicleId);
        Assert.True(vm.Display.HasVehicles);
        Assert.True(vm.Display.ShowTransitions);
        Assert.Equal(42, vm.Display.TotalRows);
    }

    [Fact]
    public async Task ViewModel_SelectTransition_FreezesAndFetchesSnapshotAndShowsDetail()
    {
        var feed = new FakeFeed(
            [new VehicleOptionRecord(7, "Model 3")],
            new FsmTransitionsPage(SampleTransitions(), 3));
        using var vm = new StateMachineDebuggerPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.SelectTransitionAsync(1);

        Assert.True(vm.Display.ShowDetail);
        Assert.False(vm.Display.LiveControls.IsLive);
        Assert.True(feed.SnapshotCalls >= 1);
    }

    [Fact]
    public async Task ViewModel_SetFsmType_ResetsToFirstPage()
    {
        var feed = new FakeFeed(
            [new VehicleOptionRecord(7, "Model 3")],
            new FsmTransitionsPage(SampleTransitions(), 200));
        using var vm = new StateMachineDebuggerPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.SetPageAsync(3);
        Assert.Equal(3, vm.Display.Page);

        await vm.SetFsmTypeAsync("drive");
        Assert.Equal(1, vm.Display.Page);
        Assert.Equal("drive", vm.Display.SelectedFsmTypeValue);
    }
}
