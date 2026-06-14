using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The read seam the <see cref="SignalExplorerPageViewModel"/> binds to (P1/S8 state-holder layer) — the native
/// port of the web page's data sources (web/src/features/telemetry/pages/SignalExplorerPage.tsx): the
/// <c>useSelectedVehicle</c> fleet list that fills the vehicle picker, the per-vehicle
/// <c>useSignals → GET /signals/{vehicleID}/available</c> catalogue that fills the signal selector, and the
/// deferred Explore query (<c>GET /signals/{vehicleID}/{signal}/history</c>, one request per selected signal,
/// flattened newest-first) that feeds the stats, chart and history table. Each source is fetched independently so
/// the view-model can mirror the web's selection fallback and its single error / empty states. The view never
/// performs HTTP; the contract-client-backed <see cref="SignalExplorerClientFeed"/> (or a test fake) drives this.
/// </summary>
public interface ISignalExplorerFeed
{
    /// <summary>Fetch the fleet list for the vehicle picker (web <c>useSelectedVehicle → GET /vehicles</c>).</summary>
    Task<IReadOnlyList<SignalExplorerVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Fetch the available signal names for <paramref name="vehicleId"/> (web <c>useSignals</c>).</summary>
    Task<IReadOnlyList<string>> FetchAvailableSignalsAsync(long vehicleId, CancellationToken cancellationToken);

    /// <summary>
    /// Run the deferred signal-history query for the selected signals (web <c>useQuery</c> + <c>Promise.all</c>):
    /// one <c>GET /signals/{vehicleID}/{signal}/history</c> request per signal, flattened and sorted newest-first.
    /// </summary>
    Task<IReadOnlyList<SignalExplorerEntry>> FetchHistoryAsync(
        long vehicleId,
        IReadOnlyList<string> signals,
        string fromIso,
        string toIso,
        int limit,
        CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to an empty fleet, empty catalogue and empty history (the empty data state, no HTTP).</summary>
public sealed class EmptySignalExplorerFeed : ISignalExplorerFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptySignalExplorerFeed Instance { get; } = new();

    private EmptySignalExplorerFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<SignalExplorerVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<SignalExplorerVehicle>>(Array.Empty<SignalExplorerVehicle>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<string>> FetchAvailableSignalsAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<string>>(Array.Empty<string>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<SignalExplorerEntry>> FetchHistoryAsync(
        long vehicleId,
        IReadOnlyList<string> signals,
        string fromIso,
        string toIso,
        int limit,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<SignalExplorerEntry>>(Array.Empty<SignalExplorerEntry>());
    }
}

/// <summary>
/// The generated-client-backed <see cref="ISignalExplorerFeed"/> — the native data adapter for the Signal Explorer
/// page. It binds the page's three web data sources to the generated OpenAPI contract client (ADR-004):
/// <c>GET /vehicles</c> (web <c>useSelectedVehicle</c>), <c>GET /signals/{vehicleID}/available</c>
/// (web <c>useSignals</c>) and <c>GET /signals/{vehicleID}/{signalName}/history</c> (web deferred <c>useQuery</c>).
/// The per-vehicle reads fill the <c>{vehicleID}</c> / <c>{signalName}</c> path slots and pass the snake_case
/// <c>from</c> / <c>to</c> / <c>limit</c> query the Go API expects (never camelCase, never a double <c>/api/v1</c>
/// prefix — the client versions the path exactly once). The history requests run sequentially so the result order
/// is deterministic; each response JSON round-trips through the tolerant model parsers so the snake_case wire shape
/// is preserved losslessly, and a non-success response surfaces as the client's <see cref="ApiException"/> for the
/// view-model's error branch. No HTTP touches the view.
/// </summary>
public sealed class SignalExplorerClientFeed : ISignalExplorerFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public SignalExplorerClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<SignalExplorerVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(SignalExplorerRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return SignalExplorerVehicle.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<string>> FetchAvailableSignalsAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            SignalExplorerRegistration.AvailableOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [SignalExplorerRegistration.VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            });

        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ParseAvailableSignals(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<SignalExplorerEntry>> FetchHistoryAsync(
        long vehicleId,
        IReadOnlyList<string> signals,
        string fromIso,
        string toIso,
        int limit,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(signals);
        if (signals.Count == 0)
        {
            return Array.Empty<SignalExplorerEntry>();
        }

        var rows = new List<SignalExplorerEntry>();
        foreach (var signal in signals)
        {
            if (string.IsNullOrWhiteSpace(signal))
            {
                continue;
            }

            cancellationToken.ThrowIfCancellationRequested();
            var request = BuildHistoryRequest(vehicleId, signal, fromIso, toIso, limit);
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            rows.AddRange(SignalExplorerEntry.ParseHistory(json));
        }

        // web: results.flatMap(adapt).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) — newest first.
        rows.Sort(static (a, b) =>
            (b.Timestamp ?? DateTimeOffset.MinValue).CompareTo(a.Timestamp ?? DateTimeOffset.MinValue));
        return rows;
    }

    /// <summary>
    /// Normalize the <c>GET /signals/{vehicleID}/available</c> response down to a flat list of signal names — the
    /// native port of the web <c>useSignals</c> reducer. Accepts the rich catalogue shape
    /// (<c>{ signals: [{ name }] }</c>), a bare <c>string[]</c> and a <c>{ signals: string[] }</c> legacy fallback;
    /// malformed entries (non-string, missing <c>name</c>) are dropped silently.
    /// </summary>
    public static IReadOnlyList<string> ParseAvailableSignals(JsonElement element)
    {
        JsonElement array;
        if (element.ValueKind == JsonValueKind.Array)
        {
            array = element;
        }
        else if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty("signals", out var signals) &&
            signals.ValueKind == JsonValueKind.Array)
        {
            array = signals;
        }
        else
        {
            return Array.Empty<string>();
        }

        var names = new List<string>(array.GetArrayLength());
        foreach (var entry in array.EnumerateArray())
        {
            switch (entry.ValueKind)
            {
                case JsonValueKind.String:
                    string? bare = entry.GetString();
                    if (!string.IsNullOrEmpty(bare))
                    {
                        names.Add(bare);
                    }

                    break;
                case JsonValueKind.Object when entry.TryGetProperty("name", out var name)
                    && name.ValueKind == JsonValueKind.String:
                    string? value = name.GetString();
                    if (!string.IsNullOrEmpty(value))
                    {
                        names.Add(value);
                    }

                    break;
                default:
                    break;
            }
        }

        return names;
    }

    private static ApiRequest BuildHistoryRequest(long vehicleId, string signal, string fromIso, string toIso, int limit)
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["limit"] = limit,
        };

        if (!string.IsNullOrWhiteSpace(fromIso))
        {
            query["from"] = fromIso;
        }

        if (!string.IsNullOrWhiteSpace(toIso))
        {
            query["to"] = toIso;
        }

        return new ApiRequest(
            SignalExplorerRegistration.HistoryOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [SignalExplorerRegistration.VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
                [SignalExplorerRegistration.SignalPathParam] = signal,
            },
            Query: query);
    }
}
