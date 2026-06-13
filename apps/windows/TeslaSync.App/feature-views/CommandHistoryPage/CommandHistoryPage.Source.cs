using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The read seam the <see cref="CommandHistoryPageViewModel"/> binds to (P1/S8 state-holder layer) — the native
/// port of the web page's two data sources (web/src/features/system/pages/CommandHistoryPage.tsx): the
/// <c>useSelectedVehicle</c> fleet list that fills the vehicle picker, and the per-vehicle
/// <c>useCommandHistory → GET /vehicles/{vehicleID}/commands/history</c> query that fills the stats / timeline.
/// Each source is fetched independently so the view-model can mirror the web's selection fallback
/// (<c>vehicleId ?? vehicles?.[0]?.id</c>) and its single error / empty states. The view never performs HTTP; the
/// contract-client-backed <see cref="CommandHistoryClientFeed"/> (or a test fake) drives this.
/// </summary>
public interface ICommandHistoryFeed
{
    /// <summary>Fetch the fleet list for the vehicle picker (web <c>useSelectedVehicle → GET /vehicles</c>).</summary>
    Task<IReadOnlyList<CommandHistoryVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Fetch the command log for <paramref name="vehicleId"/> (web <c>useCommandHistory</c>, <c>limit=200</c>).</summary>
    Task<IReadOnlyList<CommandLogEntry>> FetchHistoryAsync(long vehicleId, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to an empty fleet and empty command log (the empty data state, no HTTP).</summary>
public sealed class EmptyCommandHistoryFeed : ICommandHistoryFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyCommandHistoryFeed Instance { get; } = new();

    private EmptyCommandHistoryFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<CommandHistoryVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<CommandHistoryVehicle>>(Array.Empty<CommandHistoryVehicle>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<CommandLogEntry>> FetchHistoryAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<CommandLogEntry>>(Array.Empty<CommandLogEntry>());
    }
}

/// <summary>
/// The generated-client-backed <see cref="ICommandHistoryFeed"/> — the native data adapter for the Command History
/// page. It binds the page's two web data sources to the generated OpenAPI contract client (ADR-004):
/// <c>GET /vehicles</c> (web <c>useSelectedVehicle</c>) and
/// <c>GET /vehicles/{vehicleID}/commands/history?limit=200</c> (web <c>useCommandHistory</c>, the same
/// <c>limit=200</c> page-size the web hook requests). The per-vehicle read fills the <c>{vehicleID}</c> path slot
/// and passes the snake_case <c>limit</c> query the Go API expects (never camelCase, never a double <c>/api/v1</c>
/// prefix — the client versions the path exactly once). No HTTP touches the view; each response JSON round-trips
/// through the tolerant model parsers so the snake_case wire shape is preserved losslessly, and a non-success
/// response surfaces as the client's <see cref="ApiException"/> for the view-model's error branch.
/// </summary>
public sealed class CommandHistoryClientFeed : ICommandHistoryFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public CommandHistoryClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<CommandHistoryVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(CommandHistoryRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return CommandHistoryVehicle.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<CommandLogEntry>> FetchHistoryAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            CommandHistoryRegistration.HistoryOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [CommandHistoryRegistration.VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            },
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["limit"] = CommandHistoryRegistration.HistoryLimit,
            });

        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return CommandLogEntry.ParseList(json);
    }
}
