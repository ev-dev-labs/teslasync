using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.FeatureViews.DlqInspector;
using TeslaSync.App.ModalsDialogs;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// Tolerant JSON readers for the DLQ list / audit / replay envelopes — accepts the snake_case wire shape and the
/// camelCase aliases produced by the web <c>camelCaseKeys</c> transform, so a native read never drifts from the web.
/// (The per-entry summary / full payload parse is delegated to the shared <see cref="DlqEntryParsing"/>.)
/// </summary>
internal static class DlqEnvelopeJson
{
    public static string? Str(JsonElement obj, params string[] names)
    {
        foreach (string name in names)
        {
            if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out JsonElement v) && v.ValueKind == JsonValueKind.String)
            {
                return v.GetString();
            }
        }

        return null;
    }

    public static long Long(JsonElement obj, params string[] names)
    {
        foreach (string name in names)
        {
            if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out JsonElement v))
            {
                continue;
            }

            if (v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out long n))
            {
                return n;
            }

            if (v.ValueKind == JsonValueKind.String && long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out long s))
            {
                return s;
            }
        }

        return 0;
    }

    public static bool Bool(JsonElement obj, params string[] names)
    {
        foreach (string name in names)
        {
            if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out JsonElement v))
            {
                if (v.ValueKind == JsonValueKind.True)
                {
                    return true;
                }

                if (v.ValueKind == JsonValueKind.False)
                {
                    return false;
                }
            }
        }

        return false;
    }
}

/// <summary>
/// The generated-client-backed <see cref="IDlqListFeed"/> — the native data adapter for the web <c>useDLQList</c>
/// hook (<c>GET /system/dlq</c>, no parameters). Binds to the generated OpenAPI contract client (ADR-004); no HTTP
/// touches the view. The <c>{ count, replay_enabled, entries[] }</c> envelope round-trips through the tolerant
/// parser into a <see cref="DlqListSnapshot"/>, reusing the shared <see cref="DlqEntryParsing"/> for each entry. A
/// non-success response surfaces as the client's <c>ApiException</c> so the view-model can show the retryable error.
/// </summary>
public sealed class DlqListClientFeed : IDlqListFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    public DlqListClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<DlqListSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(DlqInspectorRegistration.ListOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ParseSnapshot(json);
    }

    /// <summary>Project a <c>GET /system/dlq</c> JSON envelope into the shared <see cref="DlqListSnapshot"/> contract.</summary>
    public static DlqListSnapshot ParseSnapshot(JsonElement json)
    {
        var entries = new List<DlqEntrySummary>();
        if (json.ValueKind == JsonValueKind.Object
            && json.TryGetProperty("entries", out JsonElement rows)
            && rows.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement row in rows.EnumerateArray())
            {
                if (row.ValueKind == JsonValueKind.Object)
                {
                    entries.Add(DlqEntryParsing.ParseSummary(row));
                }
            }
        }

        int count = (int)DlqEnvelopeJson.Long(json, "count");
        bool replayEnabled = DlqEnvelopeJson.Bool(json, "replay_enabled", "replayEnabled");
        return new DlqListSnapshot(count, replayEnabled, entries);
    }
}

/// <summary>
/// The generated-client-backed <see cref="IDlqEntryFeed"/> — the native data adapter for the web <c>useDLQEntry</c>
/// hook (<c>GET /system/dlq/{id}</c>). Reuses the shared <see cref="DlqEntryParsing.ParseFull"/> to project the
/// summary + both base64 payload blobs.
/// </summary>
public sealed class DlqEntryClientFeed : IDlqEntryFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    public DlqEntryClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<DlqEntryFull> FetchAsync(long id, CancellationToken cancellationToken)
    {
        var request = ApiRequest.WithPath(
            DlqInspectorRegistration.EntryOperation,
            "id",
            id.ToString(CultureInfo.InvariantCulture));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return DlqEntryParsing.ParseFull(json);
    }
}

/// <summary>
/// The generated-client-backed <see cref="IDlqAuditFeed"/> — the native data adapter for the web <c>useDLQAudit</c>
/// hook (<c>GET /system/dlq/audit</c>, or <c>GET /system/dlq/{id}/audit</c> when scoped, with the <c>limit</c> query
/// param). The <c>{ rows[] }</c> envelope round-trips into <see cref="AuditRecord"/> rows.
/// </summary>
public sealed class DlqAuditClientFeed : IDlqAuditFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    public DlqAuditClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<AuditRecord>> FetchAsync(long? dlqId, int limit, CancellationToken cancellationToken)
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal) { ["limit"] = limit };
        ApiRequest request = dlqId is { } scoped
            ? new ApiRequest(
                DlqInspectorRegistration.EntryAuditOperation,
                new Dictionary<string, string>(StringComparer.Ordinal) { ["id"] = scoped.ToString(CultureInfo.InvariantCulture) },
                query)
            : new ApiRequest(DlqInspectorRegistration.AuditOperation, null, query);

        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ParseRows(json);
    }

    /// <summary>Project a DLQ audit JSON envelope into the shared <see cref="AuditRecord"/> rows.</summary>
    public static IReadOnlyList<AuditRecord> ParseRows(JsonElement json)
    {
        var rows = new List<AuditRecord>();
        if (json.ValueKind == JsonValueKind.Object
            && json.TryGetProperty("rows", out JsonElement arr)
            && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement row in arr.EnumerateArray())
            {
                if (row.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                rows.Add(new AuditRecord(
                    Id: DlqEnvelopeJson.Long(row, "id"),
                    ReplayedAt: DlqEnvelopeJson.Str(row, "replayed_at", "replayedAt") ?? string.Empty,
                    Actor: DlqEnvelopeJson.Str(row, "actor") ?? string.Empty,
                    DlqId: DlqEnvelopeJson.Long(row, "dlq_id", "dlqId"),
                    Result: DlqEnvelopeJson.Str(row, "result") ?? string.Empty,
                    DstTopic: DlqEnvelopeJson.Str(row, "dst_topic", "dstTopic") ?? string.Empty,
                    Error: DlqEnvelopeJson.Str(row, "error") ?? string.Empty,
                    TraceId: DlqEnvelopeJson.Str(row, "trace_id", "traceId") ?? string.Empty));
            }
        }

        return rows;
    }
}

/// <summary>
/// The generated-client-backed <see cref="IDlqReplayService"/> — the native data adapter for the web
/// <c>useDLQReplay</c> mutation (<c>POST /system/dlq/{id}/replay</c>). The <c>{ ok, replayed_id, dst_topic, result }</c>
/// envelope round-trips into a <see cref="DlqReplayOutcome"/>; the hard <c>DLQ_REPLAY_ENABLED=false</c> gate surfaces
/// as the client's HTTP-403 <c>ApiException</c>, which the view-model maps to the replay-blocked banner.
/// </summary>
public sealed class DlqReplayClientService : IDlqReplayService
{
    private readonly IApiClient _api;

    /// <summary>Creates the service over the generated contract client.</summary>
    public DlqReplayClientService(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<DlqReplayOutcome> ReplayAsync(long id, CancellationToken cancellationToken)
    {
        var request = ApiRequest.WithPath(
            DlqInspectorRegistration.ReplayOperation,
            "id",
            id.ToString(CultureInfo.InvariantCulture));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ParseOutcome(json, id);
    }

    /// <summary>Project a DLQ replay JSON envelope into a <see cref="DlqReplayOutcome"/>.</summary>
    public static DlqReplayOutcome ParseOutcome(JsonElement json, long fallbackId) => new(
        Ok: DlqEnvelopeJson.Bool(json, "ok"),
        ReplayedId: DlqEnvelopeJson.Long(json, "replayed_id", "replayedId") is var rid && rid != 0 ? rid : fallbackId,
        DstTopic: DlqEnvelopeJson.Str(json, "dst_topic", "dstTopic") ?? string.Empty,
        Result: DlqReplayResultCodes.Parse(DlqEnvelopeJson.Str(json, "result")),
        Error: DlqEnvelopeJson.Str(json, "error"));
}
