using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The repository-backed <see cref="ICommandQuickActionsSource"/> — the native data adapter that resolves the
/// vehicle the Quick Actions grid commands. It runs one cache-then-network read of <c>GET /vehicles</c>
/// (generated operation <c>get_api_v1_vehicles</c>, the same <see cref="Operations.Vehicles.List"/> the web
/// <c>useVehicles</c> hook fetches), caching the raw JSON under the shared <c>vehicles:list</c> key so it
/// round-trips losslessly, and resolves <c>vehicleId ?? vehicles?.[0]?.id</c> through
/// <see cref="CommandQuickActionsResultMapper"/>. A response that resolves no vehicle collapses to
/// <see cref="RepositoryResult{T}.Empty"/>, mirroring the web <c>id === 0</c> empty surface. No HTTP touches
/// the view.
/// </summary>
public sealed class CommandQuickActionsSource : ICommandQuickActionsSource
{
    private const string VehiclesListKey = "vehicles:list";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the contract client, engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the first listed vehicle is used (web <c>vehicleId</c> prop).</param>
    public CommandQuickActionsSource(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<CommandQuickActionsReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(Operations.Vehicles.List);

        var raw = _engine.StreamAsync<JsonElement>(
            VehiclesListKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmpty,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return CommandQuickActionsResultMapper.Map(emission, _vehicleId);
        }
    }

    // Web parity: with no resolvable vehicle the grid short-circuits to "No vehicle selected" (id === 0).
    private bool IsEmpty(JsonElement vehicles) => CommandQuickActionsReading.Resolve(vehicles, _vehicleId) is null;
}

/// <summary>
/// The single real <see cref="IVehicleCommandSender"/> — the native data adapter for a quick-action command.
/// It POSTs <c>{ "command": "&lt;wire&gt;" }</c> to <c>/vehicles/{vehicleID}/command</c> (generated operation
/// <c>post_api_v1_vehicles_vehicleID_command</c>) through the shared contract client — the native analogue of
/// the web <c>useVehicleCommand</c> mutation's <c>request('/vehicles/{id}/command', { method: 'POST', body:
/// JSON.stringify({ command, params }) })</c>. The optional <c>params</c> object the web sends is
/// <c>undefined</c> for every quick action, so it is omitted here exactly as the web serialization omits it.
/// The response is parsed into a <see cref="CommandResult"/>; no HTTP touches the view.
/// </summary>
public sealed class VehicleCommandSender : IVehicleCommandSender
{
    // Generated operation id (asserted by the widget tests) + its path parameter. Not in Operations.cs,
    // which catalogs only GET reads, so it is named locally exactly like the other write-path adapters.
    private const string CommandOperation = "post_api_v1_vehicles_vehicleID_command";
    private const string VehiclePathParam = "vehicleID";

    private readonly IApiClient _api;

    /// <summary>Creates the sender over the generated contract client.</summary>
    public VehicleCommandSender(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<CommandResult> SendAsync(long vehicleId, string command, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(command);

        var request = new ApiRequest(
            CommandOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            },
            Body: new CommandRequestBody(command));

        var response = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return CommandResult.FromResponse(response);
    }

    // The POST body shape the Go handler decodes ({ command, params }); params is omitted (web sends undefined).
    private sealed record CommandRequestBody([property: JsonPropertyName("command")] string Command);
}
