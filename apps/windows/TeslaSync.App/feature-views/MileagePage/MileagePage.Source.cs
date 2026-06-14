using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The generated-client-backed <see cref="IMileageFeed"/> — the native data adapter for the Mileage page
/// (ADR-004). It binds to the generated OpenAPI contract client for the three reads the web page performs, all
/// scoped to the active vehicle by the snake_case <c>vehicle_id</c> query parameter:
/// <c>GET /mileage/stats</c> (generated <see cref="MileageRegistration.StatsOperation"/>, web
/// <c>useMileageStats</c>) is the primary read whose failure surfaces the page error;
/// <c>GET /mileage/daily</c> (<see cref="MileageRegistration.DailyOperation"/>, web <c>useDailyMileage</c>,
/// scoped further by the <c>days</c> window) and <c>GET /mileage/monthly</c>
/// (<see cref="MileageRegistration.MonthlyOperation"/>, web <c>useMonthlyMileage</c>) are best-effort
/// supplementary reads that feed the charts and the monthly-summary table. Both supplementary responses are
/// <c>{vehicle_id, days|months}</c> envelopes, unwrapped here exactly as the web hooks' <c>select</c> does. The
/// raw JSON round-trips through the tolerant parsers so the snake_case wire shape is preserved losslessly; no
/// HTTP touches the view. A failed stats read propagates as the client's <see cref="ApiException"/> so the
/// view-model renders the error surface, while a failed daily / monthly read degrades gracefully to no buckets
/// (mirroring the web's independent queries).
/// </summary>
public sealed class MileageClientFeed : IMileageFeed
{
    /// <summary>The web <c>useDailyMileage</c> default per-day window (legacy <c>limit=90</c>).</summary>
    public const int DefaultDays = 90;

    private const string VehicleQueryParam = "vehicle_id";
    private const string DaysQueryParam = "days";

    private readonly IApiClient _api;
    private readonly long _vehicleId;
    private readonly int _days;

    /// <summary>Creates the feed over the generated contract client, the active vehicle id and the daily window.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    /// <param name="days">The daily-bucket window (web <c>useDailyMileage(activeId, 90)</c>); clamped to ≥ 1.</param>
    public MileageClientFeed(IApiClient api, long vehicleId, int days = DefaultDays)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
        _days = days < 1 ? DefaultDays : days;
    }

    /// <inheritdoc />
    public async Task<MileageSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var statsRequest = new ApiRequest(MileageRegistration.StatsOperation, Query: VehicleQuery());
        var statsJson = await _api.SendAsync<JsonElement>(statsRequest, cancellationToken).ConfigureAwait(false);
        MileageStats? stats = MileageStats.FromJson(statsJson);

        IReadOnlyList<MileageDailyBucket> daily = await FetchDailyAsync(cancellationToken).ConfigureAwait(false);
        IReadOnlyList<MileageMonthlyBucket> monthly = await FetchMonthlyAsync(cancellationToken).ConfigureAwait(false);
        return MileageSnapshot.Compose(stats, daily, monthly);
    }

    private async Task<IReadOnlyList<MileageDailyBucket>> FetchDailyAsync(CancellationToken cancellationToken)
    {
        try
        {
            var query = VehicleQuery();
            query[DaysQueryParam] = _days;
            var request = new ApiRequest(MileageRegistration.DailyOperation, Query: query);
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ParseDaily(json);
        }
        catch (ApiException)
        {
            // The daily read is the web's separate, best-effort query — a transport failure here must never sink
            // the whole page, so the odometer + daily-distance charts fall back to empty.
            return Array.Empty<MileageDailyBucket>();
        }
    }

    private async Task<IReadOnlyList<MileageMonthlyBucket>> FetchMonthlyAsync(CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(MileageRegistration.MonthlyOperation, Query: VehicleQuery());
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ParseMonthly(json);
        }
        catch (ApiException)
        {
            // The monthly read is independent and best-effort — a failure degrades to an empty summary table.
            return Array.Empty<MileageMonthlyBucket>();
        }
    }

    /// <summary>
    /// Unwrap a <c>GET /mileage/daily</c> <c>{vehicle_id, days:[...]}</c> envelope into the tolerant daily list
    /// (web hook <c>select: (resp) =&gt; safeArray(resp?.days)</c>). A non-object body or a missing / non-array
    /// <c>days</c> field yields an empty list.
    /// </summary>
    public static IReadOnlyList<MileageDailyBucket> ParseDaily(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("days", out var days) || days.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<MileageDailyBucket>();
        }

        var buckets = new List<MileageDailyBucket>(days.GetArrayLength());
        foreach (var item in days.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                buckets.Add(MileageDailyBucket.FromJson(item));
            }
        }

        return buckets;
    }

    /// <summary>
    /// Unwrap a <c>GET /mileage/monthly</c> <c>{vehicle_id, months:[...]}</c> envelope into the tolerant monthly
    /// list (web hook <c>select: (resp) =&gt; safeArray(resp?.months)</c>). A non-object body or a missing /
    /// non-array <c>months</c> field yields an empty list.
    /// </summary>
    public static IReadOnlyList<MileageMonthlyBucket> ParseMonthly(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("months", out var months) || months.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<MileageMonthlyBucket>();
        }

        var buckets = new List<MileageMonthlyBucket>(months.GetArrayLength());
        foreach (var item in months.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                buckets.Add(MileageMonthlyBucket.FromJson(item));
            }
        }

        return buckets;
    }

    private Dictionary<string, object?> VehicleQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
    };
}
