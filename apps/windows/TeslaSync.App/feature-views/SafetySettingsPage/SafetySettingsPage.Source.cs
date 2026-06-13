using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The generated-client-backed <see cref="ISafetySettingsFeed"/> — the native data adapter for the Safety Settings page
/// (ADR-004). It binds to the generated OpenAPI contract client for the three reads the web page performs, all scoped to
/// the active vehicle by the snake_case <c>vehicle_id</c> query parameter:
/// <list type="number">
///   <item><c>GET /safety/latest</c> (<see cref="SafetySettingsRegistration.LatestOperation"/>, the web
///         <c>useQuery(['safety-latest'])</c>) is the primary read whose failure surfaces the page error.</item>
///   <item><c>GET /safety?limit=100</c> (<see cref="SafetySettingsRegistration.HistoryOperation"/>, the web
///         <c>useQuery(['safety-history'])</c>) powers the Safety-States chart and the history table; a failure
///         degrades gracefully to an empty history rather than sinking the page.</item>
///   <item><c>GET /security/latest</c> (<see cref="SafetySettingsRegistration.SecurityOperation"/>, the web
///         <c>useSecurityLatest</c> 15-second live poll) powers the Live Safety Signals row; a failure degrades to
///         null so those cards render their "—" fallback.</item>
/// </list>
/// The raw JSON round-trips through the tolerant parsers so the snake_case wire shape is preserved losslessly; no HTTP
/// touches the view. A failed latest read propagates as the client's <see cref="ApiException"/> so the view-model
/// renders the error surface, mirroring the web's primary query gating the page.
/// </summary>
public sealed class SafetySettingsClientFeed : ISafetySettingsFeed
{
    private const string VehicleQueryParam = "vehicle_id";
    private const string LimitQueryParam = "limit";
    private const int HistoryLimit = 100;

    private readonly IApiClient _api;
    private readonly long _vehicleId;

    /// <summary>Creates the feed over the generated contract client and the active vehicle id.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    public SafetySettingsClientFeed(IApiClient api, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async Task<SafetySettingsSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var latestRequest = new ApiRequest(SafetySettingsRegistration.LatestOperation, Query: VehicleQuery());
        var latestJson = await _api.SendAsync<JsonElement>(latestRequest, cancellationToken).ConfigureAwait(false);
        SafetySnapshot? latest = latestJson.ValueKind == JsonValueKind.Object ? SafetySnapshot.FromJson(latestJson) : null;

        IReadOnlyList<SafetySnapshot> history = await FetchHistoryAsync(cancellationToken).ConfigureAwait(false);
        SecuritySafetySnapshot? security = await FetchSecurityAsync(cancellationToken).ConfigureAwait(false);

        return SafetySettingsSnapshot.Compose(latest, history, security);
    }

    private async Task<IReadOnlyList<SafetySnapshot>> FetchHistoryAsync(CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(
                SafetySettingsRegistration.HistoryOperation,
                Query: new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    [VehicleQueryParam] = _vehicleId,
                    [LimitQueryParam] = HistoryLimit,
                });

            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ParseHistory(json);
        }
        catch (ApiException)
        {
            // The history read is the web's separate, best-effort query — a transport failure here must never sink the
            // page, so the chart and table fall back to empty.
            return Array.Empty<SafetySnapshot>();
        }
    }

    private async Task<SecuritySafetySnapshot?> FetchSecurityAsync(CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(SafetySettingsRegistration.SecurityOperation, Query: VehicleQuery());
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return SecuritySafetySnapshot.FromJson(json);
        }
        catch (ApiException)
        {
            // Web parity: the live-signals read is an independent poll; a failure leaves the signal cards at their "—".
            return null;
        }
    }

    private static IReadOnlyList<SafetySnapshot> ParseHistory(JsonElement json)
    {
        if (json.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SafetySnapshot>();
        }

        var rows = new List<SafetySnapshot>(json.GetArrayLength());
        foreach (var item in json.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                rows.Add(SafetySnapshot.FromJson(item));
            }
        }

        return rows;
    }

    private Dictionary<string, object?> VehicleQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
    };
}
