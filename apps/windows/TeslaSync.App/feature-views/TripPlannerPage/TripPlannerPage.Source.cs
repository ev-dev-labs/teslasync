using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The generated-client-backed <see cref="IPlanTripClient"/> — the native data adapter for the Trip Planner page's
/// plan mutation and the C# port of the web <c>usePlanTrip</c> hook (web/src/api/hooks/useDriving.ts). It POSTs the
/// snake_case trip-plan request body to <c>POST /trip-planner/plan</c> (generated operation
/// <c>post_api_v1_trip_planner_plan</c>) and parses the response into a <see cref="TripPlanSnapshot"/>. The fixed
/// preference flags mirror the web source's literals (<c>include_weather: true</c>, <c>prefer_superchargers: true</c>).
/// No HTTP touches the view.
/// </summary>
public sealed class PlanTripClient : IPlanTripClient
{
    private readonly IApiClient _api;

    /// <summary>Creates the client over the shared contract client.</summary>
    public PlanTripClient(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<TripPlanSnapshot> PlanAsync(TripPlanRequestModel request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var body = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["vehicle_id"] = request.VehicleId,
            ["origin"] = Location(request.Origin),
            ["destination"] = Location(request.Destination),
            ["current_soc"] = request.CurrentSoc,
            ["charge_limit_soc"] = request.ChargeLimitSoc,
            ["min_arrival_soc"] = request.MinArrivalSoc,
            ["preferences"] = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["speed_factor"] = request.SpeedFactor,
                ["include_weather"] = true,
                ["prefer_superchargers"] = true,
            },
        };

        var apiRequest = new ApiRequest(TripPlannerOperations.Plan, Body: body);
        var response = await _api.SendAsync<JsonElement>(apiRequest, cancellationToken).ConfigureAwait(false);
        return TripPlanSnapshot.FromJson(response);
    }

    private static Dictionary<string, object?> Location(TripLocationModel location) =>
        new(StringComparer.Ordinal)
        {
            ["lat"] = location.Lat,
            ["lng"] = location.Lng,
            ["name"] = location.Name,
        };
}

/// <summary>
/// The generated-client-backed <see cref="ISendToCarClient"/> — the native data adapter for the send-to-car action
/// and the C# port of the web <c>handleSendToCar</c> call. It POSTs a <c>navigation_request</c> command to
/// <c>POST /vehicles/{vehicleID}/command</c> (generated operation <c>post_api_v1_vehicles_vehicleID_command</c>),
/// mirroring the web body shape exactly (<c>{ command, params: { lat, lon } }</c> — note the web sends <c>lon</c>,
/// not <c>lng</c>, for the command param). The response is ignored exactly as the web's fire-and-forget try/catch is.
/// </summary>
public sealed class SendToCarClient : ISendToCarClient
{
    private const string NavigationCommand = "navigation_request";

    private readonly IApiClient _api;

    /// <summary>Creates the client over the shared contract client.</summary>
    public SendToCarClient(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task SendNavigationAsync(long vehicleId, double lat, double lng, CancellationToken cancellationToken = default)
    {
        var body = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["command"] = NavigationCommand,
            ["params"] = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["lat"] = lat,
                ["lon"] = lng,
            },
        };

        var apiRequest = new ApiRequest(
            TripPlannerOperations.Command,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [TripPlannerOperations.VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            },
            Body: body);

        await _api.SendAsync<JsonElement>(apiRequest, cancellationToken).ConfigureAwait(false);
    }
}
