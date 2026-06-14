using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The generated-client-backed <see cref="ISleepEfficiencyFeed"/> — the native data adapter for the
/// Sleep-Efficiency page (ADR-004). It binds to the generated OpenAPI contract client for the single read the
/// web page performs, scoped to the active vehicle by the snake_case <c>vehicle_id</c> query parameter:
/// <c>GET /analytics/sleep</c> (generated <see cref="SleepEfficiencyRegistration.SleepOperation"/>, web
/// <c>useSleepEfficiency</c>). It mirrors the web hook's query exactly — <c>vehicle_id</c> + <c>days</c> (default
/// 30), plus an optional inclusive <c>start</c>/<c>end</c> window when both are supplied (web
/// <c>useRangeState</c>). The raw JSON round-trips through the tolerant <see cref="SleepEfficiencySummary"/>
/// parser so the snake_case wire shape is preserved losslessly; no HTTP touches the view. A failed read
/// propagates as the client's <see cref="ApiException"/> so the view-model renders the error surface, while a
/// non-object body composes to the empty snapshot (web <c>data</c> undefined → the empty surface).
/// </summary>
public sealed class SleepEfficiencyClientFeed : ISleepEfficiencyFeed
{
    private const string VehicleQueryParam = "vehicle_id";
    private const string DaysQueryParam = "days";
    private const string StartQueryParam = "start";
    private const string EndQueryParam = "end";

    // Web parity: useSleepEfficiency(vehicleId) defaults days=30 (web/src/api/hooks/useEnergy.ts L132).
    private const int DefaultDays = 30;

    private readonly IApiClient _api;
    private readonly long _vehicleId;
    private readonly int _days;
    private readonly string? _start;
    private readonly string? _end;

    /// <summary>Creates the feed over the generated contract client, the active vehicle id and an optional range.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    /// <param name="days">The rolling window length (web <c>days</c>); defaults to the web's 30.</param>
    /// <param name="start">Optional inclusive range start (web <c>useRangeState</c> <c>start</c>); null = rolling.</param>
    /// <param name="end">Optional inclusive range end (web <c>useRangeState</c> <c>end</c>); null = rolling.</param>
    public SleepEfficiencyClientFeed(
        IApiClient api,
        long vehicleId,
        int days = DefaultDays,
        string? start = null,
        string? end = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
        _days = days > 0 ? days : DefaultDays;
        _start = start;
        _end = end;
    }

    /// <inheritdoc />
    public async Task<SleepEfficiencySnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(SleepEfficiencyRegistration.SleepOperation, Query: SleepQuery());
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return SleepEfficiencySnapshot.Compose(SleepEfficiencySummary.FromJson(json));
    }

    private Dictionary<string, object?> SleepQuery()
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [VehicleQueryParam] = _vehicleId,
            [DaysQueryParam] = _days,
        };

        // Web parity (web/src/api/hooks/useEnergy.ts L142-143): start/end are appended only when BOTH are set.
        if (!string.IsNullOrWhiteSpace(_start) && !string.IsNullOrWhiteSpace(_end))
        {
            query[StartQueryParam] = _start;
            query[EndQueryParam] = _end;
        }

        return query;
    }
}
