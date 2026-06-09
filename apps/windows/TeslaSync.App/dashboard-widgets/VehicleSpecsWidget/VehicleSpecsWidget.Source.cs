using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets.VehicleSpecs;

/// <summary>
/// The repository-backed <see cref="IVehicleSpecsSource"/> — the native data adapter for the Vehicle Specs
/// surface. It first resolves the primary (or explicit) vehicle from the shared
/// <see cref="IWidgetVehicleSource"/> (the native analogue of the web component's
/// <c>vehicleId ?? vehicles?.[0]?.id ?? 0</c>), then performs one cache-then-network read that fans out to the
/// web component's three independent queries — <c>GET /vehicles/{id}/specs</c> (web <c>useVehicleSpecs</c>),
/// <c>GET /vehicles/{id}/options</c> (web <c>useVehicleOptions</c>) and
/// <c>GET /vehicle-config/latest?vehicle_id={id}</c> (web <c>useVehicleConfigLatest</c>) — and folds them into
/// one <see cref="VehicleSpecsSnapshot"/>. Mirroring the web's independent queries, a single failing endpoint
/// is tolerated (its part resolves null while the others render, preserving <c>hasAnyData</c>); only when all
/// three fail is the error propagated, so the engine surfaces the retry / offline chrome. The combined
/// snapshot is cached so the whole surface restores instantly, and no HTTP ever touches the view. When no
/// vehicle is available the read short-circuits to <see cref="RepositoryResult{T}.Empty"/>, mirroring the web
/// hooks' disabled state (<c>enabled: !!vehicleId</c>) collapsing to the "No specs available" surface.
/// </summary>
public sealed class VehicleSpecsSource : IVehicleSpecsSource
{
    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the reads to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public VehicleSpecsSource(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _vehicles = vehicles;
        _api = api;
        _engine = engine;
        _json = options.Json;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<VehicleSpecsSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle all three queries are disabled → hasAnyData false → empty surface.
            yield return RepositoryResult<VehicleSpecsSnapshot>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:specs-options-config");

        var stream = _engine.StreamAsync(
            cacheKey,
            ct => FetchAsync(vid, ct),
            static snapshot => !snapshot.HasAnyData,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in stream.ConfigureAwait(false))
        {
            yield return emission;
        }
    }

    private async Task<long?> ResolveVehicleIdAsync(CancellationToken cancellationToken)
    {
        if (_vehicleId is { } explicitId)
        {
            return explicitId;
        }

        var primary = await _vehicles.GetPrimaryAsync(cancellationToken).ConfigureAwait(false);
        return primary?.VehicleId;
    }

    private async Task<VehicleSpecsSnapshot> FetchAsync(long vid, CancellationToken cancellationToken)
    {
        var specsRequest = new ApiRequest(
            VehicleSpecsRegistration.SpecsOperationId, PathParams: VehiclePath(vid));
        var optionsRequest = new ApiRequest(
            VehicleSpecsRegistration.OptionsOperationId, PathParams: VehiclePath(vid));
        var configRequest = new ApiRequest(
            VehicleSpecsRegistration.ConfigOperationId,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleSpecsRegistration.VehicleQueryParam] = vid,
            });

        // Web parity: the three queries run independently/concurrently.
        var specsTask = TryReadAsync(specsRequest, cancellationToken);
        var optionsTask = TryReadAsync(optionsRequest, cancellationToken);
        var configTask = TryReadAsync(configRequest, cancellationToken);
        await Task.WhenAll(specsTask, optionsTask, configTask).ConfigureAwait(false);

        var specs = await specsTask.ConfigureAwait(false);
        var options = await optionsTask.ConfigureAwait(false);
        var config = await configTask.ConfigureAwait(false);

        // Every query failed (e.g. offline / auth) → propagate so the engine surfaces the retry / offline
        // chrome. A single failing endpoint is tolerated below (its part stays null while the others render),
        // preserving the web's hasAnyData resilience.
        if (specs.Failed && options.Failed && config.Failed)
        {
            throw specs.Error ?? options.Error ?? config.Error
                ?? new InvalidOperationException("vehicle specs read failed");
        }

        return new VehicleSpecsSnapshot(
            specs.Failed ? null : VehicleSpecsInfo.ParseEnvelope(specs.Value),
            options.Failed ? null : VehicleSpecOption.ParseEnvelope(options.Value),
            config.Failed ? null : VehicleConfigInfo.ParseResponse(config.Value));
    }

    private async Task<ReadOutcome> TryReadAsync(ApiRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var value = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ReadOutcome.Ok(value);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // One endpoint failing must not blank the others (web: an errored query leaves its data undefined).
            return ReadOutcome.Fail(ex);
        }
    }

    private static Dictionary<string, string> VehiclePath(long vid) =>
        new(StringComparer.Ordinal)
        {
            [VehicleSpecsRegistration.VehiclePathParam] = vid.ToString(CultureInfo.InvariantCulture),
        };

    /// <summary>One endpoint's outcome: the decoded body, or the failure that left its part undefined.</summary>
    private readonly struct ReadOutcome
    {
        private ReadOutcome(JsonElement value, Exception? error, bool failed)
        {
            Value = value;
            Error = error;
            Failed = failed;
        }

        public JsonElement Value { get; }

        public Exception? Error { get; }

        public bool Failed { get; }

        public static ReadOutcome Ok(JsonElement value) => new(value, null, false);

        public static ReadOutcome Fail(Exception error) => new(default, error, true);
    }
}
