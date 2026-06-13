using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.FeatureViews.FeatureFlags;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// Tolerant JSON readers for the feature-flag list / change-audit envelopes — accepts the snake_case wire shape the
/// Go API emits and the camelCase aliases the web <c>camelCaseKeys</c> transform produces, so a native read never
/// drifts from the web. JSON values (the arbitrary flag value / the audit old+new value) are materialised as a
/// compact serialization (the web <c>JSON.stringify</c> form) or a cloned <see cref="JsonElement"/>.
/// </summary>
internal static class FeatureFlagJson
{
    /// <summary>Read the first present string property (tolerant of snake_case / camelCase aliases), else null.</summary>
    public static string? Str(JsonElement obj, params string[] names)
    {
        foreach (string name in names)
        {
            if (obj.ValueKind == JsonValueKind.Object
                && obj.TryGetProperty(name, out JsonElement v)
                && v.ValueKind == JsonValueKind.String)
            {
                return v.GetString();
            }
        }

        return null;
    }

    /// <summary>Read the first present integer property (tolerant of number or numeric-string), else 0.</summary>
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

            if (v.ValueKind == JsonValueKind.String
                && long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out long s))
            {
                return s;
            }
        }

        return 0;
    }

    /// <summary>
    /// The compact JSON serialization of the first present value property — the native mirror of the web
    /// <c>JSON.stringify(value)</c> the audit panel's <c>compact()</c> renders. A JSON null / absent value resolves
    /// to <c>null</c> (the web <c>value == null</c> → em-dash branch).
    /// </summary>
    public static string? ValueJson(JsonElement obj, params string[] names)
    {
        foreach (string name in names)
        {
            if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out JsonElement v))
            {
                if (v.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
                {
                    return null;
                }

                return JsonSerializer.Serialize(v);
            }
        }

        return null;
    }

    /// <summary>
    /// The cloned flag value <see cref="JsonElement"/> (independent of the transient parse document) — the arbitrary
    /// JSON value the registry stores. An absent value resolves to a default (undefined) element, which the
    /// <c>FlagsTable</c> preview renders as an em-dash.
    /// </summary>
    public static JsonElement ValueElement(JsonElement obj, params string[] names)
    {
        foreach (string name in names)
        {
            if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out JsonElement v))
            {
                return v.Clone();
            }
        }

        return default;
    }
}

/// <summary>
/// The generated-client-backed <see cref="IFeatureFlagsFeed"/> — the native data adapter for the web <c>useFlags</c>
/// hook (<c>GET /system/flags</c>, no parameters). Binds to the generated OpenAPI contract client (ADR-004); no HTTP
/// touches the view. The <c>{ count, flags[] }</c> envelope round-trips through the tolerant parser into a
/// <see cref="FeatureFlagsSnapshot"/>; a non-success response surfaces as the client's <see cref="ApiException"/> so
/// the view-model can mark the flags query as errored.
/// </summary>
public sealed class FeatureFlagsClientFeed : IFeatureFlagsFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    public FeatureFlagsClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<FeatureFlagsSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(FeatureFlagsRegistration.ListOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ParseSnapshot(json);
    }

    /// <summary>Project a <c>GET /system/flags</c> JSON envelope into the shared <see cref="FeatureFlagsSnapshot"/>.</summary>
    public static FeatureFlagsSnapshot ParseSnapshot(JsonElement json)
    {
        var flags = new List<FeatureFlagEntry>();
        if (json.ValueKind == JsonValueKind.Object
            && json.TryGetProperty("flags", out JsonElement rows)
            && rows.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement row in rows.EnumerateArray())
            {
                if (row.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                string key = FeatureFlagJson.Str(row, "key") ?? string.Empty;
                JsonElement value = FeatureFlagJson.ValueElement(row, "value");
                flags.Add(new FeatureFlagEntry(key, value));
            }
        }

        return new FeatureFlagsSnapshot(flags);
    }
}

/// <summary>
/// The generated-client-backed <see cref="IFlagChangesFeed"/> — the native data adapter for the web
/// <c>useFlagChanges(null, 50)</c> hook (<c>GET /system/flags/changes</c>, with the <c>limit</c> query param). The
/// <c>{ count, flag_key, limit, rows[] }</c> envelope round-trips into <see cref="FeatureFlagChangeRow"/> rows.
/// </summary>
public sealed class FlagChangesClientFeed : IFlagChangesFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    public FlagChangesClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<FlagChangesSnapshot> FetchAsync(int limit, CancellationToken cancellationToken)
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal) { ["limit"] = limit };
        var request = new ApiRequest(FeatureFlagsRegistration.ChangesOperation, Query: query);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ParseSnapshot(json);
    }

    /// <summary>Project a <c>GET /system/flags/changes</c> JSON envelope into the shared <see cref="FlagChangesSnapshot"/>.</summary>
    public static FlagChangesSnapshot ParseSnapshot(JsonElement json)
    {
        var rows = new List<FeatureFlagChangeRow>();
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

                rows.Add(new FeatureFlagChangeRow(
                    Id: FeatureFlagJson.Long(row, "id").ToString(CultureInfo.InvariantCulture),
                    ChangedAt: FeatureFlagJson.Str(row, "changed_at", "changedAt"),
                    Actor: FeatureFlagJson.Str(row, "actor"),
                    FlagKey: FeatureFlagJson.Str(row, "flag_key", "flagKey") ?? string.Empty,
                    Operation: FeatureFlagJson.Str(row, "operation") ?? string.Empty,
                    OldValueJson: FeatureFlagJson.ValueJson(row, "old_value", "oldValue"),
                    NewValueJson: FeatureFlagJson.ValueJson(row, "new_value", "newValue"),
                    Reason: FeatureFlagJson.Str(row, "reason")));
            }
        }

        return new FlagChangesSnapshot(rows);
    }
}

/// <summary>
/// The generated-client-backed <see cref="IFlagWriteService"/> — the native data adapter for the web
/// <c>useSetFlag</c> (<c>PUT /system/flags/{key}</c>, body <c>{ value, reason }</c>) and <c>useDeleteFlag</c>
/// (<c>DELETE /system/flags/{key}?reason=</c>) mutations. Both are sudo-gated server-side; a <c>SUDO_REQUIRED</c>
/// 401 / a validation 400 surfaces as the client's <see cref="ApiException"/>, which the view-model maps to a kept-open
/// editor (web parity: the drawer / dialog stays open so the operator can retry). No HTTP touches the view.
/// </summary>
public sealed class FlagWriteClientService : IFlagWriteService
{
    private readonly IApiClient _api;

    /// <summary>Creates the service over the generated contract client.</summary>
    public FlagWriteClientService(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task SetAsync(string key, JsonElement value, string reason, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(key);

        // web useSetFlag body: { value, reason }. The JsonElement serializes as its raw JSON value (object / array /
        // scalar), exactly as the web posts JSON.stringify({ value, reason }).
        var body = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["value"] = value,
            ["reason"] = reason,
        };

        var request = new ApiRequest(
            FeatureFlagsRegistration.SetOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal) { ["key"] = key },
            Body: body);

        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task DeleteAsync(string key, string reason, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(key);

        // web useDeleteFlag: DELETE /system/flags/{key}?reason=… — the backend audit row rejects an empty reason.
        var request = new ApiRequest(
            FeatureFlagsRegistration.DeleteOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal) { ["key"] = key },
            Query: new Dictionary<string, object?>(StringComparer.Ordinal) { ["reason"] = reason });

        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }
}
