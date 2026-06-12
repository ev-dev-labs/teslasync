using System.Runtime.CompilerServices;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Forms;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The read seam the multi-vehicle picker binds to (P1/S8 state-holder layer) — the native port of the web
/// <c>useVehicles()</c> query that the Alert Studio editor feeds into <c>VehicleMultiSelect</c> as its
/// <c>vehicles</c> prop (web/src/components/forms/VehicleMultiSelect.tsx). It yields the cache-then-network
/// sequence of fleet snapshots that populate the picker, projected as presentation-ready
/// <see cref="VehicleOption"/>s. The view never performs HTTP itself; the concrete
/// <see cref="VehicleMultiSelectFleetSource"/> (or a test fake) drives this.
/// </summary>
public interface IVehicleMultiSelectFleetSource
{
    /// <summary>Stream the cache-then-network fleet list, newest cache first (web <c>useVehicles</c>).</summary>
    /// <param name="cancellationToken">Cancellation for a superseded read.</param>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<VehicleOption>>> StreamVehiclesAsync(
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IVehicleMultiSelectFleetSource"/> — the native data adapter for the
/// picker's fleet. It streams <c>GET /vehicles</c> through the shared <see cref="CacheThenNetworkEngine"/>
/// (the same cache-then-network pipeline the web <c>useVehicles</c> query rides) and folds each emission's
/// JSON array into <see cref="VehicleOption"/>s via <see cref="VehicleMultiSelectProjection.ParseVehicles"/>.
/// The body is cached as JSON so the snake_case wire shape round-trips losslessly and a network failure
/// surfaces the last cached fleet (offline) rather than an empty picker. No HTTP touches the view.
/// </summary>
public sealed class VehicleMultiSelectFleetSource : IVehicleMultiSelectFleetSource
{
    /// <summary>The generated OpenAPI operation id for <c>GET /api/v1/vehicles</c> (web <c>useVehicles</c>).</summary>
    public const string VehiclesOperation = Operations.Vehicles.List;

    private const string VehiclesCacheKey = "alert-studio:vehicle-multiselect:vehicles";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public VehicleMultiSelectFleetSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<VehicleOption>>> StreamVehiclesAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(VehiclesOperation);
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream = _engine.StreamAsync<JsonElement>(
            VehiclesCacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            VehicleMultiSelectProjection.IsEmptyArray,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (RepositoryResult<JsonElement> result in stream.ConfigureAwait(false))
        {
            IReadOnlyList<VehicleOption>? vehicles = result.Value is { } body
                ? VehicleMultiSelectProjection.ParseVehicles(body)
                : null;
            yield return new RepositoryResult<IReadOnlyList<VehicleOption>>(
                result.Status, vehicles, result.FetchedAt, result.IsStale, result.Error);
        }
    }
}

/// <summary>
/// A fixed <see cref="IVehicleMultiSelectFleetSource"/> for headless hosts, galleries and tests. The default
/// constructor emits a single terminal snapshot — <see cref="RepositoryResult{T}.Empty()"/> for an empty
/// fleet, otherwise <see cref="RepositoryResult{T}.Loaded"/> — so the view-model renders the loaded or empty
/// branch without a network round-trip. <see cref="Emitting"/> replays an explicit snapshot sequence so a test
/// can drive the loading / stale / offline / error branches the live source produces. The Windows app
/// registers the contract-client-backed <see cref="VehicleMultiSelectFleetSource"/>.
/// </summary>
public sealed class StaticVehicleMultiSelectFleetSource : IVehicleMultiSelectFleetSource
{
    private readonly IReadOnlyList<RepositoryResult<IReadOnlyList<VehicleOption>>> _emissions;

    /// <summary>Creates the source over a fixed fleet (defaults to an empty fleet).</summary>
    /// <param name="vehicles">The fixed fleet to surface, or null for an empty fleet.</param>
    /// <param name="clock">The clock stamping the emission's fetch time (defaults to UTC now).</param>
    public StaticVehicleMultiSelectFleetSource(
        IReadOnlyList<VehicleOption>? vehicles = null, Func<DateTimeOffset>? clock = null)
    {
        DateTimeOffset stamp = (clock ?? (() => DateTimeOffset.UtcNow))();
        IReadOnlyList<VehicleOption> fleet = vehicles ?? Array.Empty<VehicleOption>();
        _emissions =
        [
            fleet.Count == 0
                ? RepositoryResult<IReadOnlyList<VehicleOption>>.Empty(stamp)
                : RepositoryResult<IReadOnlyList<VehicleOption>>.Loaded(fleet, stamp),
        ];
    }

    private StaticVehicleMultiSelectFleetSource(IReadOnlyList<RepositoryResult<IReadOnlyList<VehicleOption>>> emissions) =>
        _emissions = emissions;

    /// <summary>Creates a source that replays an explicit snapshot sequence (drives loading / stale / offline / error).</summary>
    /// <param name="emissions">The snapshots to yield in order.</param>
    public static StaticVehicleMultiSelectFleetSource Emitting(
        params RepositoryResult<IReadOnlyList<VehicleOption>>[] emissions)
    {
        ArgumentNullException.ThrowIfNull(emissions);
        return new StaticVehicleMultiSelectFleetSource((IReadOnlyList<RepositoryResult<IReadOnlyList<VehicleOption>>>)emissions);
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<VehicleOption>>> StreamVehiclesAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask.ConfigureAwait(false);
        foreach (RepositoryResult<IReadOnlyList<VehicleOption>> emission in _emissions)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return emission;
        }
    }
}

/// <summary>
/// Pure JSON → <see cref="VehicleOption"/> projection for the picker's fleet read. Mirrors the wire shape of
/// <c>GET /api/v1/vehicles</c> (a snake_case array; <c>camelCaseKeys</c> on the web means both casings can
/// appear) and folds each object into the presentation record the Core pickers consume. Kept UI-free so it is
/// unit-tested without a XAML host or a live engine.
/// </summary>
public static class VehicleMultiSelectProjection
{
    /// <summary>True when the vehicles payload is a null body or an empty array (the empty-fleet result).</summary>
    public static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };

    /// <summary>Fold a vehicles JSON array into <see cref="VehicleOption"/>s, skipping any malformed entry.</summary>
    public static IReadOnlyList<VehicleOption> ParseVehicles(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<VehicleOption>();
        }

        var vehicles = new List<VehicleOption>(element.GetArrayLength());
        foreach (JsonElement item in element.EnumerateArray())
        {
            if (ParseVehicle(item) is { } vehicle)
            {
                vehicles.Add(vehicle);
            }
        }

        return vehicles;
    }

    private static VehicleOption? ParseVehicle(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        long? id = ReadLong(element, "id", "id");
        if (id is null)
        {
            return null;
        }

        return new VehicleOption(
            id.Value,
            ReadString(element, "display_name", "displayName"),
            ReadString(element, "vin", "vin"),
            ReadString(element, "model", "model"));
    }

    private static long? ReadLong(JsonElement element, string snake, string camel)
    {
        JsonElement value = Pick(element, snake, camel);
        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt64(out long n) => n,
            JsonValueKind.String when long.TryParse(
                value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out long s) => s,
            _ => null,
        };
    }

    private static string? ReadString(JsonElement element, string snake, string camel)
    {
        JsonElement value = Pick(element, snake, camel);
        return value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    private static JsonElement Pick(JsonElement element, string first, string second)
    {
        if (element.TryGetProperty(first, out JsonElement byFirst))
        {
            return byFirst;
        }

        return element.TryGetProperty(second, out JsonElement bySecond) ? bySecond : default;
    }
}
