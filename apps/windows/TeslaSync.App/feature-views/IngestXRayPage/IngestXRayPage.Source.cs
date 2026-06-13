using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.FeatureViews.IngestXRay;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the ingest X-Ray page feeds. Every getter returns a
/// nullable / fallback rather than throwing so a partial or schema-drifted body from <c>GET /vehicles</c> or
/// <c>GET /system/ingest-xray/{vehicleID}</c> never aborts the parse (web parity: the React page reads
/// <c>xray.data?.buckets ?? []</c> / <c>vehicles.data ?? []</c> and tolerates an undefined response). Accepts the
/// snake_case wire shape and the camelCase aliases produced by the web <c>camelCaseKeys</c> transform. Kept
/// internal to the surface and free of WinUI types so the parse is unit-tested without a UI host.
/// </summary>
internal static class IngestXRayPageJson
{
    /// <summary>The first present string value among <paramref name="names"/>, or null when absent / not a string.</summary>
    public static string? Str(JsonElement obj, params string[] names)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (string name in names)
        {
            if (obj.TryGetProperty(name, out JsonElement prop) && prop.ValueKind == JsonValueKind.String)
            {
                return prop.GetString();
            }
        }

        return null;
    }

    /// <summary>The first present integer value among <paramref name="names"/>, tolerating a numeric or numeric-string field.</summary>
    public static long Long(JsonElement obj, params string[] names)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return 0;
        }

        foreach (string name in names)
        {
            if (!obj.TryGetProperty(name, out JsonElement prop))
            {
                continue;
            }

            switch (prop.ValueKind)
            {
                case JsonValueKind.Number when prop.TryGetInt64(out long n):
                    return n;
                case JsonValueKind.String when long.TryParse(
                    prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out long s):
                    return s;
                default:
                    break;
            }
        }

        return 0;
    }
}

/// <summary>
/// The generated-client-backed <see cref="IIngestXRayPageFeed"/> — the native data adapter for the Ingest X-Ray
/// page. It binds the page's two web data sources to the generated OpenAPI contract client (ADR-004):
/// <c>GET /vehicles</c> (web <c>useVehicles</c>) and <c>GET /system/ingest-xray/{vehicleID}</c>
/// (web <c>useIngestXRay</c>). The X-Ray read fills the <c>{vehicleID}</c> path slot and appends the snake_case
/// <c>window</c> / <c>bucket</c> / <c>limit</c> query the Go API expects (never camelCase, never a double
/// <c>/api/v1</c> prefix — the client versions the path exactly once). Each response JSON round-trips through the
/// tolerant parsers so the snake_case wire shape is preserved losslessly, and a non-success response surfaces as
/// the client's <see cref="ApiException"/> for the view-model's error branch. No HTTP touches the view.
/// </summary>
public sealed class IngestXRayPageClientFeed : IIngestXRayPageFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public IngestXRayPageClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(IngestXRayPageRegistration.VehiclesOperation);
        JsonElement json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ParseVehicles(json);
    }

    /// <inheritdoc />
    public async Task<IngestXRayPageData> FetchXRayAsync(
        int vehicleId,
        IngestXRayWindow window,
        IngestXRayBucket bucket,
        int limit,
        CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            IngestXRayPageRegistration.XRayOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [IngestXRayPageRegistration.VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            },
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["window"] = IngestXRayWindows.Wire(window),
                ["bucket"] = IngestXRayBuckets.Wire(bucket),
                ["limit"] = limit,
            });

        JsonElement json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ParseXRay(json);
    }

    /// <summary>Project a <c>GET /vehicles</c> JSON array into the shared <see cref="VehicleOption"/> list (web <c>vehicles.data ?? []</c>).</summary>
    public static IReadOnlyList<VehicleOption> ParseVehicles(JsonElement json)
    {
        if (json.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<VehicleOption>();
        }

        var vehicles = new List<VehicleOption>(json.GetArrayLength());
        foreach (JsonElement item in json.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            long id = IngestXRayPageJson.Long(item, "id");
            if (id <= 0)
            {
                continue;
            }

            vehicles.Add(new VehicleOption(
                id,
                IngestXRayPageJson.Str(item, "display_name", "displayName"),
                IngestXRayPageJson.Str(item, "vin"),
                IngestXRayPageJson.Str(item, "model")));
        }

        return vehicles;
    }

    /// <summary>
    /// Project a <c>GET /system/ingest-xray/{vehicleID}</c> JSON envelope into the page payload — the aggregate
    /// summary (reusing the shared <see cref="IngestXRaySummary.FromJson"/>), the bucketed sample-count series and
    /// the per-field statistics (web <c>xray.data</c> fanned out to the header / chart / fields surfaces).
    /// </summary>
    public static IngestXRayPageData ParseXRay(JsonElement json)
    {
        if (json.ValueKind != JsonValueKind.Object)
        {
            return IngestXRayPageData.Empty;
        }

        IngestXRaySummary summary = IngestXRaySummary.FromJson(json);
        IReadOnlyList<XRayBucketPoint> buckets = ParseBuckets(json);
        IReadOnlyList<IngestXRayFieldStat> fields = ParseFields(json);
        return new IngestXRayPageData(summary, buckets, fields);
    }

    /// <summary>Parse the <c>buckets</c> array (<c>{ bucket_start, count }</c>) into the chart series.</summary>
    public static IReadOnlyList<XRayBucketPoint> ParseBuckets(JsonElement json)
    {
        if (json.ValueKind != JsonValueKind.Object
            || !json.TryGetProperty("buckets", out JsonElement arr)
            || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<XRayBucketPoint>();
        }

        var buckets = new List<XRayBucketPoint>(arr.GetArrayLength());
        foreach (JsonElement item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            buckets.Add(new XRayBucketPoint(
                IngestXRayPageJson.Str(item, "bucket_start", "bucketStart") ?? string.Empty,
                IngestXRayPageJson.Long(item, "count")));
        }

        return buckets;
    }

    /// <summary>Parse the <c>fields</c> array (<c>{ field, sample_count, last_seen_at, value_kind }</c>) into the table rows.</summary>
    public static IReadOnlyList<IngestXRayFieldStat> ParseFields(JsonElement json)
    {
        if (json.ValueKind != JsonValueKind.Object
            || !json.TryGetProperty("fields", out JsonElement arr)
            || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<IngestXRayFieldStat>();
        }

        var fields = new List<IngestXRayFieldStat>(arr.GetArrayLength());
        foreach (JsonElement item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            string? field = IngestXRayPageJson.Str(item, "field");
            if (string.IsNullOrEmpty(field))
            {
                continue;
            }

            fields.Add(new IngestXRayFieldStat(
                field,
                IngestXRayPageJson.Long(item, "sample_count", "sampleCount"),
                IngestXRayPageJson.Str(item, "last_seen_at", "lastSeenAt") ?? string.Empty,
                (int)IngestXRayPageJson.Long(item, "value_kind", "valueKind")));
        }

        return fields;
    }
}
