using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The generated-client-backed <see cref="IPowershareFeed"/> — the native data adapter for the Powershare
/// surface. It binds to the generated OpenAPI contract client (ADR-004): five independent reads of
/// <c>GET /signals/observations</c> (scoped by <c>vehicle_id</c> + <c>field</c> + <c>limit=1</c>), one per
/// Powershare cold signal — the native fan-out of the web page's five <c>useSignalObservations</c> hooks
/// (web/src/features/charging/pages/PowersharePage.tsx). No HTTP touches the view; each response round-trips
/// through the tolerant <see cref="PowershareObservation"/> reducers so the snake_case wire shape is preserved
/// losslessly. Every read is best-effort and independent: a failed observation falls back to an empty envelope
/// and simply leaves that value absent (web parity — each hook resolves on its own), so a single missing
/// signal never blanks the others.
/// </summary>
public sealed class PowershareClientFeed : IPowershareFeed
{
    /// <summary>
    /// The generated operation id for <c>GET /signals/observations</c>. The web reads this endpoint; the
    /// generated endpoint table exposes this id (resolved against <c>ApiEndpoints</c>), referenced verbatim
    /// here exactly as the sibling <c>AutopilotSectionSource</c> does for the same endpoint.
    /// </summary>
    public const string ObservationsOperation = "get_api_v1_signals_observations";

    private const string VehicleQueryParam = "vehicle_id";
    private const string FieldQueryParam = "field";
    private const string LimitQueryParam = "limit";

    // A standalone, reusable empty-observations body for the graceful-degradation path (a failed cold-signal
    // read). Cloned off a throwaway document so it survives that document's disposal.
    private static readonly JsonElement EmptyObservations = ParseEmptyObservations();

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public PowershareClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<PowershareReading> FetchAsync(string vehicleId, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(vehicleId);

        // Five independent, best-effort reads (web parity: five separate useSignalObservations hooks).
        var status = await TryObservationAsync(PowershareRegistration.StatusField, vehicleId, cancellationToken).ConfigureAwait(false);
        var shareType = await TryObservationAsync(PowershareRegistration.TypeField, vehicleId, cancellationToken).ConfigureAwait(false);
        var stopReason = await TryObservationAsync(PowershareRegistration.StopReasonField, vehicleId, cancellationToken).ConfigureAwait(false);
        var hoursLeft = await TryObservationAsync(PowershareRegistration.HoursLeftField, vehicleId, cancellationToken).ConfigureAwait(false);
        var powerKw = await TryObservationAsync(PowershareRegistration.PowerField, vehicleId, cancellationToken).ConfigureAwait(false);

        return PowershareReading.FromObservations(status, shareType, stopReason, hoursLeft, powerKw);
    }

    private async Task<JsonElement> TryObservationAsync(string field, string vehicleId, CancellationToken cancellationToken)
    {
        try
        {
            var body = await _api
                .SendAsync<JsonElement>(ObservationRequest(field, vehicleId), cancellationToken)
                .ConfigureAwait(false);
            return body.Clone();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // Web parity: a failed (or empty) observation query just leaves that value absent — the page still
            // renders whatever the other reads provided.
            return EmptyObservations;
        }
    }

    private static ApiRequest ObservationRequest(string field, string vehicleId) => new(
        ObservationsOperation,
        Query: new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [VehicleQueryParam] = vehicleId,
            [FieldQueryParam] = field,
            [LimitQueryParam] = PowershareRegistration.ObservationLimit,
        });

    private static JsonElement ParseEmptyObservations()
    {
        using var doc = JsonDocument.Parse("""{"observations":[]}""");
        return doc.RootElement.Clone();
    }
}
