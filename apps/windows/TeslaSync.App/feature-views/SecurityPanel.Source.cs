using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="SecurityPanelViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of merged <see cref="SecurityPanelSnapshot"/>s (the latest security event + the
/// vehicle's remote-start config flag) — the native analogue of the web Live-Telemetry parent's
/// <c>useSecurityLatest(vehicleId)</c> read and the <c>remoteStartEnabled</c> live-config flag, both passed into
/// <c>&lt;SecurityPanel securityData={…} remoteStartEnabled={…} /&gt;</c>
/// (web/src/features/vehicles/components/telemetry-panels/SecurityPanel.tsx). The view never performs HTTP
/// itself; the concrete <see cref="SecurityPanelSource"/> (or a test fake) drives this.
/// </summary>
public interface ISecurityPanelSource
{
    /// <summary>Stream the cache-then-network security snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<SecurityPanelSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ISecurityPanelSource"/> — the native data adapter for the Security surface.
/// It resolves the primary (or explicit) vehicle from the shared <see cref="IWidgetVehicleSource"/>, then:
/// <list type="number">
///   <item>Resolves the remote-start config flag: a best-effort cache-then-network read of the vehicle state
///         (generated operation <c>get_api_v1_vehicles_vehicleID_state</c>) reduced to its
///         <c>remote_start_enabled</c> field — the native analogue of the web parent's <c>remoteStartEnabled</c>
///         live-config flag. A state failure leaves the flag null (the Remote Start row shows the em dash),
///         never failing the surface — mirroring the web row.</item>
///   <item>Streams the primary read: a cache-then-network read of <c>GET /security/latest?vehicle_id={id}</c>
///         (generated operation <c>get_api_v1_security_latest</c>, the web <c>useSecurityLatest</c> query — a
///         5-second live poll) through the shared <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so
///         the snake_case wire shape round-trips losslessly, parsed (with the resolved remote-start flag folded
///         in) into a <see cref="SecurityPanelSnapshot"/> via <see cref="SecurityPanelResultMapper"/>.</item>
/// </list>
/// The security read is never declared "empty" at the engine boundary (a null security body still produces a
/// snapshot so the remote-start row keeps rendering); the view-model owns the empty classification from the
/// merged snapshot. When no vehicle is available the read short-circuits to <see cref="RepositoryResult{T}.Empty()"/>,
/// mirroring the web hook's disabled query (<c>enabled: vehicleId &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class SecurityPanelSource : ISecurityPanelSource
{
    // The web's useSecurityLatest reads /security/latest; Operations.cs carries no Security group yet, so the id
    // is referenced verbatim here (scoped to this surface), exactly as the sibling LiveVehicleStateSource does.
    // It resolves against TeslaSync.Windows.Generated.Api.ApiEndpoints.
    private const string SecurityLatestOperation = "get_api_v1_security_latest";
    private const string VehicleQueryParam = "vehicle_id";
    private const string VehiclePathParam = "vehicleID";
    private const string RemoteStartField = "remote_start_enabled";

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
    public SecurityPanelSource(
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
    public async IAsyncEnumerable<RepositoryResult<SecurityPanelSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle both the security and remote-start reads are disabled.
            yield return RepositoryResult<SecurityPanelSnapshot>.Empty();
            yield break;
        }

        bool? remoteStartEnabled = await ResolveRemoteStartAsync(vid, cancellationToken).ConfigureAwait(false);

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:security-panel");
        var request = new ApiRequest(
            SecurityLatestOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
            });

        // The security read is never short-circuited to Empty (isEmpty: never): a null security body still yields
        // a snapshot so the remote-start row keeps rendering; the view-model decides Empty from the merged
        // snapshot (web hasData = securityData != null || remoteStartEnabled != null).
        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            static _ => false,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return SecurityPanelResultMapper.Map(emission, remoteStartEnabled);
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

    /// <summary>
    /// Drain a best-effort cache-then-network read of the vehicle state and reduce it to the
    /// <c>remote_start_enabled</c> flag (web <c>remoteStartEnabled</c>). The freshest value-bearing emission wins;
    /// a transport failure (or a body without the field) collapses to <see langword="null"/> so the Remote Start
    /// row shows the em dash rather than an error, mirroring the web row. Cancellation still propagates.
    /// </summary>
    private async Task<bool?> ResolveRemoteStartAsync(long vehicleId, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vehicleId}:security-panel:remote-start");
        var request = new ApiRequest(
            Operations.Vehicles.State,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            });

        bool? remoteStart = null;
        try
        {
            var raw = _engine.StreamAsync<JsonElement>(
                cacheKey,
                ct => _api.SendAsync<JsonElement>(request, ct),
                IsEmptyBody,
                _json,
                CacheFreshness.LiveStaleSeconds,
                cancellationToken);

            await foreach (var emission in raw.ConfigureAwait(false))
            {
                if (emission.HasValue)
                {
                    remoteStart = SecurityPanelJson.ReadBool(emission.Value, RemoteStartField);
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort: a vehicle-state failure leaves the Remote Start row at the em dash.
        }

        return remoteStart;
    }

    private static bool IsEmptyBody(JsonElement element) => element.ValueKind != JsonValueKind.Object;
}
