using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The data port the <see cref="SignalDiffPageViewModel"/> binds to — the native analogue of the five web hooks the
/// page composes (web/src/features/telemetry/pages/SignalDiffPage.tsx): <c>useVehicles</c> (the page-local picker),
/// <c>useSignals</c> (the available-signal catalog feeding the diff fetch), <c>useSignalDiffServer</c> (the
/// two-snapshot diff), <c>usePinned</c> (the pinned rows) and <c>useTogglePin</c> (the pin / unpin writes). The view
/// never performs HTTP itself; the concrete <see cref="SignalDiffPageClientFeed"/> (or a test fake) drives this.
/// <see cref="PinnedSignal"/> is shared with the unified workspace so both surfaces read pins identically.
/// </summary>
public interface ISignalDiffPageFeed
{
    /// <summary>Fetch the fleet vehicles for the page-local picker (web <c>useVehicles</c> GET /vehicles).</summary>
    Task<IReadOnlyList<SignalDiffVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Fetch the available-signal catalog for a vehicle (web <c>useSignals</c> GET /signals/{id}/available).</summary>
    Task<IReadOnlyList<string>> FetchAvailableAsync(long vehicleId, CancellationToken cancellationToken);

    /// <summary>Fetch the two-snapshot diff for a vehicle (web <c>useSignalDiffServer</c> GET /signals/{id}/diff).</summary>
    Task<IReadOnlyList<SignalDiffRow>> FetchDiffAsync(long vehicleId, CancellationToken cancellationToken);

    /// <summary>Fetch the pinned signal rows for a vehicle's diff context (web <c>usePinned('widget', context)</c>).</summary>
    Task<IReadOnlyList<PinnedSignal>> FetchPinnedAsync(long vehicleId, CancellationToken cancellationToken);

    /// <summary>Pin a signal (web <c>useTogglePin</c> pin → POST /pinned).</summary>
    Task PinAsync(string itemId, string context, CancellationToken cancellationToken);

    /// <summary>Unpin a signal by its pin row id (web <c>useTogglePin</c> unpin → DELETE /pinned/{id}).</summary>
    Task UnpinAsync(string existingId, CancellationToken cancellationToken);
}

/// <summary>
/// The default no-backend Signal Diff feed the parameterless (shell-registered) <see cref="SignalDiffPage"/> hosts
/// itself against — the local-state default, mirroring the other W7 pages' empty feeds. The vehicles, catalog, diff
/// and pins all resolve empty (driving the friendly no-vehicle / no-changes states) and the two pin writes are inert.
/// The generated-client-backed source (<see cref="SignalDiffPageClientFeed"/>) is wired separately from the shared
/// data layer (web's TanStack hooks); this feed keeps the page mountable without a backend.
/// </summary>
public sealed class EmptySignalDiffPageFeed : ISignalDiffPageFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptySignalDiffPageFeed Instance { get; } = new();

    private EmptySignalDiffPageFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<SignalDiffVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<SignalDiffVehicle>>(Array.Empty<SignalDiffVehicle>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<string>> FetchAvailableAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<string>>(Array.Empty<string>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<SignalDiffRow>> FetchDiffAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<SignalDiffRow>>(Array.Empty<SignalDiffRow>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<PinnedSignal>> FetchPinnedAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<PinnedSignal>>(Array.Empty<PinnedSignal>());
    }

    /// <inheritdoc />
    public Task PinAsync(string itemId, string context, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(itemId);
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task UnpinAsync(string existingId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(existingId);
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }
}

/// <summary>
/// The generated-client-backed <see cref="ISignalDiffPageFeed"/> — the native data adapter for the Signal Diff page.
/// It binds to the generated OpenAPI contract client (ADR-004): <c>GET /vehicles</c> (web <c>useVehicles</c>),
/// <c>GET /signals/{vehicleID}/available</c> (web <c>useSignals</c>), <c>GET /signals/{vehicleID}/diff</c> (web
/// <c>useSignalDiffServer</c>), <c>GET /pinned</c> (web <c>usePinned</c>), <c>POST /pinned</c> +
/// <c>DELETE /pinned/{id}</c> (web <c>useTogglePin</c>).
/// <para>
/// Two reads deliberately omit the web query parameters: the generated <c>/pinned</c> and <c>/signals/{id}/diff</c>
/// endpoint descriptors declare no query parameters, and the contract client rejects undeclared ones, so — exactly
/// like the sibling <see cref="SignalDiffTableSource"/> and <see cref="SignalsWorkspaceClientFeed"/> — the diff read
/// relies on the backend's default trailing-hour window (the same default the web picker seeds) and the pinned read is
/// filtered to signal rows client-side. Each pin write still carries the per-vehicle diff context the web sends. No
/// HTTP touches the view; every payload round-trips through tolerant parsers.
/// </para>
/// </summary>
public sealed class SignalDiffPageClientFeed : ISignalDiffPageFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public SignalDiffPageClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<SignalDiffVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(SignalDiffPageRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return SignalDiffVehicle.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<string>> FetchAvailableAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = ApiRequest.WithPath(
            SignalDiffPageRegistration.AvailableOperation,
            "vehicleID",
            vehicleId.ToString(CultureInfo.InvariantCulture));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ParseAvailable(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<SignalDiffRow>> FetchDiffAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = ApiRequest.WithPath(
            SignalDiffPageRegistration.DiffOperation,
            "vehicleID",
            vehicleId.ToString(CultureInfo.InvariantCulture));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return SignalDiffRow.ParseResponse(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<PinnedSignal>> FetchPinnedAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(SignalDiffPageRegistration.PinnedListOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ParsePinned(json);
    }

    /// <inheritdoc />
    public async Task PinAsync(string itemId, string context, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(itemId);
        ArgumentNullException.ThrowIfNull(context);

        var body = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["item_type"] = SignalDiffPageRegistration.PinType,
            ["item_id"] = itemId,
            ["context"] = context,
        };
        var request = new ApiRequest(SignalDiffPageRegistration.PinCreateOperation, Body: body);
        _ = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task UnpinAsync(string existingId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(existingId);
        var request = ApiRequest.WithPath(SignalDiffPageRegistration.PinDeleteOperation, "id", existingId);
        _ = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Parse the available-signal catalog — the native port of the web <c>useSignals</c> reducer: a bare array, a
    /// <c>{ signals: [...] }</c> / <c>{ data: [...] }</c> envelope, and entries that are either bare strings or
    /// <c>{ name }</c> objects.
    /// </summary>
    public static IReadOnlyList<string> ParseAvailable(JsonElement element)
    {
        JsonElement array = element;
        if (element.ValueKind == JsonValueKind.Object)
        {
            if (element.TryGetProperty("signals", out var signals))
            {
                array = signals;
            }
            else if (element.TryGetProperty("data", out var data))
            {
                array = data;
            }
        }

        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var list = new List<string>(array.GetArrayLength());
        foreach (var entry in array.EnumerateArray())
        {
            switch (entry.ValueKind)
            {
                case JsonValueKind.String:
                    string? s = entry.GetString();
                    if (!string.IsNullOrEmpty(s))
                    {
                        list.Add(s);
                    }

                    break;
                case JsonValueKind.Object when entry.TryGetProperty("name", out var name)
                    && name.ValueKind == JsonValueKind.String:
                    string? n = name.GetString();
                    if (!string.IsNullOrEmpty(n))
                    {
                        list.Add(n);
                    }

                    break;
            }
        }

        return list;
    }

    /// <summary>
    /// Parse the pinned rows — the native port of the web <c>pinnedSignals</c> derivation: read the <c>id</c> +
    /// <c>item_id</c> from each row (tolerating a <c>{ data: [...] }</c> envelope or a bare array) and keep only the
    /// rows whose <c>item_id</c> carries the <c>signal:</c> prefix, stripped to the bare signal name.
    /// </summary>
    public static IReadOnlyList<PinnedSignal> ParsePinned(JsonElement element)
    {
        JsonElement array = element;
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty("data", out var data))
        {
            array = data;
        }

        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<PinnedSignal>();
        }

        var list = new List<PinnedSignal>(array.GetArrayLength());
        foreach (var entry in array.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            string? itemId = ReadString(entry, "item_id");
            if (itemId is null || !itemId.StartsWith(SignalDiffPageRegistration.SignalItemPrefix, StringComparison.Ordinal))
            {
                continue;
            }

            string id = ReadId(entry);
            string name = itemId[SignalDiffPageRegistration.SignalItemPrefix.Length..];
            list.Add(new PinnedSignal(id, name));
        }

        return list;
    }

    private static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.String ? prop.GetString() : null;

    private static string ReadId(JsonElement obj)
    {
        if (!obj.TryGetProperty("id", out var id))
        {
            return string.Empty;
        }

        return id.ValueKind switch
        {
            JsonValueKind.String => id.GetString() ?? string.Empty,
            JsonValueKind.Number => id.GetRawText(),
            _ => string.Empty,
        };
    }
}
