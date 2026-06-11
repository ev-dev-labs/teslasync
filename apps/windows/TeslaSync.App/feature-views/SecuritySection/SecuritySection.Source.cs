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
/// The data port the <see cref="SecuritySectionViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of merged <see cref="SecuritySectionSnapshot"/>s (the latest security event slice
/// + the live lock / sentry flags) — the native analogue of the web Vehicle-Detail page's
/// <c>useSecurityLatest(vehicleId)</c> read and the <c>state</c> from <c>useVehicleState(vehicleId)</c>, both
/// passed into <c>&lt;SecuritySection securityData={…} state={…} /&gt;</c>
/// (web/src/features/vehicles/components/vehicle-detail/SecuritySection.tsx). The view never performs HTTP
/// itself; the concrete <see cref="SecuritySectionSource"/> (or a test fake) drives this.
/// </summary>
public interface ISecuritySectionSource
{
    /// <summary>Stream the cache-then-network security snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read.</param>
    /// <returns>The cache-then-network emission sequence.</returns>
    IAsyncEnumerable<RepositoryResult<SecuritySectionSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ISecuritySectionSource"/> — the native data adapter for the vehicle-detail
/// Security section. It resolves the primary (or explicit) vehicle from the shared
/// <see cref="IWidgetVehicleSource"/>, then:
/// <list type="number">
///   <item>Resolves the lock / sentry flags: a best-effort cache-then-network read of the vehicle state
///         (generated operation <c>get_api_v1_vehicles_vehicleID_state</c>) reduced to its <c>is_locked</c> and
///         <c>sentry_mode</c> fields — the native analogue of the web page's <c>state</c> from
///         <c>useVehicleState</c>. A state failure leaves both flags false (the web's falsy lock / sentry
///         rendering), never failing the surface.</item>
///   <item>Streams the primary read: a cache-then-network read of <c>GET /security/latest?vehicle_id={id}</c>
///         (generated operation <c>get_api_v1_security_latest</c>, the web <c>useSecurityLatest</c> 15-second
///         live poll) through the shared <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the
///         snake_case wire shape round-trips losslessly, parsed (with the resolved lock / sentry flags folded
///         in) into a <see cref="SecuritySectionSnapshot"/> via <see cref="SecuritySectionResultMapper"/>.</item>
/// </list>
/// A null / non-object security body is treated as empty (the web <c>securityData</c> being null → the friendly
/// empty state). When no vehicle is available the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty(System.DateTimeOffset?)"/>, mirroring the web hooks' disabled query
/// (<c>enabled: vehicleId &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class SecuritySectionSource : ISecuritySectionSource
{
    // The web's useSecurityLatest reads /security/latest; Operations.cs carries no Security group, so the id is
    // referenced verbatim here (scoped to this surface), exactly as the sibling SecurityPanelSource does. It
    // resolves against TeslaSync.Windows.Generated.Api.ApiEndpoints.
    private const string SecurityLatestOperation = "get_api_v1_security_latest";
    private const string VehicleQueryParam = "vehicle_id";
    private const string VehiclePathParam = "vehicleID";
    private const string StateField = "state";
    private const string LockedField = "is_locked";
    private const string SentryField = "sentry_mode";

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
    public SecuritySectionSource(
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
    public async IAsyncEnumerable<RepositoryResult<SecuritySectionSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle both the security and vehicle-state reads are disabled.
            yield return RepositoryResult<SecuritySectionSnapshot>.Empty();
            yield break;
        }

        (bool locked, bool sentryActive) = await ResolveLockStateAsync(vid, cancellationToken).ConfigureAwait(false);

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:security-section");
        var request = new ApiRequest(
            SecurityLatestOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
            });

        // A null / non-object security body carries no event; the engine flags it Empty and the view-model
        // renders the web "No security data available" empty state (web securityData == null).
        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyBody,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return SecuritySectionResultMapper.Map(emission, locked, sentryActive);
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
    /// Drain a best-effort cache-then-network read of the vehicle state and reduce it to the <c>is_locked</c> and
    /// <c>sentry_mode</c> flags (web <c>state.is_locked</c> / <c>state.sentry_mode</c>). The freshest
    /// value-bearing emission wins; a transport failure (or a body without the fields) collapses to
    /// <see langword="false"/> so the Locked / Sentry cards render their falsy values rather than erroring,
    /// mirroring the web's boolean reads. Cancellation still propagates.
    /// </summary>
    private async Task<(bool Locked, bool SentryActive)> ResolveLockStateAsync(long vehicleId, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vehicleId}:security-section:lock-state");
        var request = new ApiRequest(
            Operations.Vehicles.State,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            });

        bool locked = false;
        bool sentryActive = false;
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
                if (emission.HasValue && TryReadLockState(emission.Value, out bool emittedLocked, out bool emittedSentry))
                {
                    locked = emittedLocked;
                    sentryActive = emittedSentry;
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort: a vehicle-state failure leaves the Locked / Sentry cards at their falsy values.
        }

        return (locked, sentryActive);
    }

    // web: const state = stateData?.state — the /vehicles/{id}/state response wraps the canonical SignalStore
    // state object under "state"; a plain state object (no envelope) is still usable. Reads is_locked /
    // sentry_mode from whichever shape is present.
    private static bool TryReadLockState(JsonElement root, out bool locked, out bool sentryActive)
    {
        locked = false;
        sentryActive = false;
        if (root.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        JsonElement state = root;
        if (root.TryGetProperty(StateField, out var nested) && nested.ValueKind == JsonValueKind.Object)
        {
            state = nested;
        }

        locked = ReadBool(state, LockedField);
        sentryActive = ReadBool(state, SentryField);
        return true;
    }

    // Tolerant boolean read: the backend serializes raw signal.SignalValue, so a flag may arrive as a bool, a
    // 0/1 number or a boolean string. Absent / wrong-kind reads as false (the web boolean default).
    private static bool ReadBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return false;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number => v.TryGetDouble(out double n) && n != 0,
            JsonValueKind.String => bool.TryParse(v.GetString(), out bool b) && b,
            _ => false,
        };
    }

    private static bool IsEmptyBody(JsonElement element) => element.ValueKind != JsonValueKind.Object;
}
