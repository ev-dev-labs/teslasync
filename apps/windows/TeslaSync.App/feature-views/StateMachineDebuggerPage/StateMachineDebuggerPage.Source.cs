using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The data port the <c>StateMachineDebuggerPage</c> reads through — the native analogue of the web page's four
/// hooks (<c>useSelectedVehicle</c> vehicles, <c>useVehicleStateMachine</c>, <c>useFSMStats</c>,
/// <c>useFSMTransitions</c>, <c>useSignalSnapshot</c>). The view-model is the only consumer; implementations never
/// touch a WinUI type.
/// </summary>
public interface IStateMachineDebuggerFeed
{
    /// <summary>Fetch the picker's vehicles (web <c>useSelectedVehicle</c> vehicles, <c>GET /vehicles/</c>).</summary>
    Task<IReadOnlyList<VehicleOptionRecord>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Fetch the live vehicle state (web <c>useVehicleStateMachine</c>, <c>GET /vehicles/{id}/state</c>).</summary>
    Task<CurrentStateInfo?> FetchStateAsync(long vehicleId, CancellationToken cancellationToken);

    /// <summary>Fetch the active sub-FSMs (web <c>useFSMStats</c>, <c>GET /fsm/stats</c>).</summary>
    Task<IReadOnlyList<ActiveSubFSM>> FetchActiveSubsAsync(long vehicleId, CancellationToken cancellationToken);

    /// <summary>Fetch one page of FSM transitions (web <c>useFSMTransitions</c>, <c>GET /fsm/transitions</c>).</summary>
    Task<FsmTransitionsPage> FetchTransitionsAsync(
        long vehicleId, string fsmType, int hours, int page, int perPage, CancellationToken cancellationToken);

    /// <summary>Fetch the signal snapshot at an instant (web <c>useSignalSnapshot</c>, <c>GET /signals/{id}/snapshot</c>).</summary>
    Task<SignalSnapshot?> FetchSnapshotAsync(long vehicleId, string atIso, CancellationToken cancellationToken);
}

/// <summary>
/// The default no-backend debugger feed the parameterless (shell-registered) <see cref="StateMachineDebuggerPage"/>
/// hosts itself against — the local-state default, mirroring the other W7 pages' empty feeds. Every read resolves to
/// the empty result (driving the friendly "no vehicles" / "no transitions" states). The generated-client-backed
/// source (<see cref="StateMachineDebuggerClientFeed"/>) is wired separately from the shared data layer (web's
/// TanStack hooks); this feed keeps the page mountable without a backend.
/// </summary>
public sealed class EmptyStateMachineDebuggerFeed : IStateMachineDebuggerFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyStateMachineDebuggerFeed Instance { get; } = new();

    private EmptyStateMachineDebuggerFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<VehicleOptionRecord>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<VehicleOptionRecord>>(Array.Empty<VehicleOptionRecord>());
    }

    /// <inheritdoc />
    public Task<CurrentStateInfo?> FetchStateAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<CurrentStateInfo?>(null);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<ActiveSubFSM>> FetchActiveSubsAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<ActiveSubFSM>>(Array.Empty<ActiveSubFSM>());
    }

    /// <inheritdoc />
    public Task<FsmTransitionsPage> FetchTransitionsAsync(
        long vehicleId, string fsmType, int hours, int page, int perPage, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(FsmTransitionsPage.Empty);
    }

    /// <inheritdoc />
    public Task<SignalSnapshot?> FetchSnapshotAsync(long vehicleId, string atIso, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<SignalSnapshot?>(null);
    }
}

/// <summary>
/// The generated-client-backed <see cref="IStateMachineDebuggerFeed"/> — the native data adapter for the debugger
/// surface. It binds to the generated OpenAPI contract client (ADR-004): <c>GET /vehicles/</c> for the picker,
/// <c>GET /vehicles/{id}/state</c> for the live state, <c>GET /fsm/stats</c> for the active sub-FSMs,
/// <c>GET /fsm/transitions</c> for the paged transition log, and <c>GET /signals/{id}/snapshot</c> for the
/// per-transition snapshot. The endpoints declare no typed query params, so the client appends
/// <c>vehicle_id</c>/<c>fsm</c>/<c>hours</c>/<c>page</c>/<c>per_page</c>/<c>at</c> as snake_case without contract
/// rejection. No HTTP touches the view; every body round-trips through the tolerant page parsers.
/// </summary>
public sealed class StateMachineDebuggerClientFeed : IStateMachineDebuggerFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public StateMachineDebuggerClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<VehicleOptionRecord>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(StateMachineDebuggerRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return VehicleOptionRecord.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<CurrentStateInfo?> FetchStateAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = ApiRequest.WithPath(
            StateMachineDebuggerRegistration.StateOperation, "vehicleID", vehicleId.ToString(CultureInfo.InvariantCulture));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return CurrentStateInfo.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<ActiveSubFSM>> FetchActiveSubsAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal) { ["vehicle_id"] = vehicleId };
        var json = await _api.SendAsync<JsonElement>(
            new ApiRequest(StateMachineDebuggerRegistration.StatsOperation, Query: query), cancellationToken).ConfigureAwait(false);
        return FsmStatsParser.ParseActiveSubs(json);
    }

    /// <inheritdoc />
    public async Task<FsmTransitionsPage> FetchTransitionsAsync(
        long vehicleId, string fsmType, int hours, int page, int perPage, CancellationToken cancellationToken)
    {
        bool isAll = string.Equals(fsmType, FsmTypeCatalog.All, StringComparison.OrdinalIgnoreCase);
        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["vehicle_id"] = vehicleId,
            ["fsm"] = isAll ? null : fsmType,
            ["hours"] = hours > 0 ? hours : (object?)null,
            ["page"] = page,
            ["per_page"] = perPage,
        };

        var json = await _api.SendAsync<JsonElement>(
            new ApiRequest(StateMachineDebuggerRegistration.TransitionsOperation, Query: query), cancellationToken).ConfigureAwait(false);
        return FsmTransitionRecord.ParsePage(json);
    }

    /// <inheritdoc />
    public async Task<SignalSnapshot?> FetchSnapshotAsync(long vehicleId, string atIso, CancellationToken cancellationToken)
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal) { ["at"] = atIso };
        var request = new ApiRequest(
            StateMachineDebuggerRegistration.SnapshotOperation,
            PathParams: new Dictionary<string, string> { ["vehicleID"] = vehicleId.ToString(CultureInfo.InvariantCulture) },
            Query: query);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return SignalSnapshot.Parse(json);
    }
}

/// <summary>
/// The no-backend <see cref="IFsmStateDiagramSource"/> the page hosts the embedded <c>FSMStateDiagram</c> over when
/// no contract client is wired (the shell-registered default, mirroring the page's empty feed). It yields a single
/// successful-but-empty emission so the diagram renders its friendly empty state rather than spinning forever — the
/// same local-state default the rest of the page surfaces without a backend.
/// </summary>
public sealed class EmptyFsmStateDiagramSource : IFsmStateDiagramSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyFsmStateDiagramSource Instance { get; } = new();

    private EmptyFsmStateDiagramSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<FsmTransition>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<IReadOnlyList<FsmTransition>>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}
