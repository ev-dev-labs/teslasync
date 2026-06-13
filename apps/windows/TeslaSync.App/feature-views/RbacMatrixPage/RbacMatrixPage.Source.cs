using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// Tolerant JSON readers for the RBAC matrix envelope — accepts the snake_case wire shape the Go API emits and the
/// camelCase aliases the web <c>camelCaseKeys</c> transform produces, so a native read never drifts from the web.
/// </summary>
internal static class RbacMatrixJson
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

    /// <summary>Read a string array property (tolerant of aliases), skipping non-string entries.</summary>
    public static IReadOnlyList<string> StringList(JsonElement obj, params string[] names)
    {
        foreach (string name in names)
        {
            if (obj.ValueKind == JsonValueKind.Object
                && obj.TryGetProperty(name, out JsonElement v)
                && v.ValueKind == JsonValueKind.Array)
            {
                var list = new List<string>();
                foreach (JsonElement item in v.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.String && item.GetString() is { } s)
                    {
                        list.Add(s);
                    }
                }

                return list;
            }
        }

        return Array.Empty<string>();
    }

    /// <summary>
    /// Read a <c>{ key: { key: bool } }</c> nested map (the matrix). A missing row / cell is simply absent (the web
    /// "no opinion → deny" semantics); only explicit truthy values are stored.
    /// </summary>
    public static IReadOnlyDictionary<string, IReadOnlyDictionary<string, bool>> NestedBoolMap(
        JsonElement obj, params string[] names)
    {
        foreach (string name in names)
        {
            if (obj.ValueKind == JsonValueKind.Object
                && obj.TryGetProperty(name, out JsonElement outer)
                && outer.ValueKind == JsonValueKind.Object)
            {
                var map = new Dictionary<string, IReadOnlyDictionary<string, bool>>(StringComparer.Ordinal);
                foreach (JsonProperty row in outer.EnumerateObject())
                {
                    map[row.Name] = BoolMap(row.Value);
                }

                return map;
            }
        }

        return new Dictionary<string, IReadOnlyDictionary<string, bool>>(StringComparer.Ordinal);
    }

    /// <summary>Read a flat <c>{ key: bool }</c> map (a matrix row, or the effective-for-me grant set).</summary>
    public static IReadOnlyDictionary<string, bool> BoolMap(JsonElement obj, params string[] names)
    {
        if (names.Length == 0)
        {
            return ReadBoolMap(obj);
        }

        foreach (string name in names)
        {
            if (obj.ValueKind == JsonValueKind.Object
                && obj.TryGetProperty(name, out JsonElement v)
                && v.ValueKind == JsonValueKind.Object)
            {
                return ReadBoolMap(v);
            }
        }

        return new Dictionary<string, bool>(StringComparer.Ordinal);
    }

    private static Dictionary<string, bool> ReadBoolMap(JsonElement obj)
    {
        var map = new Dictionary<string, bool>(StringComparer.Ordinal);
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return map;
        }

        foreach (JsonProperty cell in obj.EnumerateObject())
        {
            map[cell.Name] = cell.Value.ValueKind == JsonValueKind.True;
        }

        return map;
    }
}

/// <summary>
/// The generated-client-backed <see cref="IRbacMatrixFeed"/> — the native data adapter for the web
/// <c>useRbacMatrix</c> hook (<c>GET /admin/rbac/matrix</c>, no parameters). Binds to the generated OpenAPI contract
/// client (ADR-004); no HTTP touches the view. The session envelope round-trips through the tolerant parser into a
/// <see cref="RbacMatrixSnapshot"/>; a <c>501 AUTH_MODE_OPEN</c> response is treated the same way the web hook treats
/// it — as a successful "feature unavailable" signal mapped to <see cref="RbacMatrixSnapshot.Open"/> — while any
/// other non-success response surfaces as the client's <see cref="ApiException"/> so the view-model can mark the
/// matrix query as errored.
/// </summary>
public sealed class RbacMatrixClientFeed : IRbacMatrixFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    public RbacMatrixClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<RbacMatrixSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(RbacMatrixRegistration.MatrixOperation);
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ParseSnapshot(json);
        }
        catch (ApiException ex) when (string.Equals(ex.ErrorCode, RbacMatrixRegistration.AuthModeOpenCode, StringComparison.Ordinal))
        {
            // Mirror web useRbacMatrix: a 501 AUTH_MODE_OPEN is a successful "forward-auth required" signal.
            return RbacMatrixSnapshot.Open;
        }
    }

    /// <summary>Project a <c>GET /admin/rbac/matrix</c> session JSON envelope into the shared <see cref="RbacMatrixSnapshot"/>.</summary>
    public static RbacMatrixSnapshot ParseSnapshot(JsonElement json)
    {
        // An explicit { "mode": "open" } body (some deployments return the envelope rather than a 501) maps to Open.
        if (string.Equals(RbacMatrixJson.Str(json, "mode"), "open", StringComparison.OrdinalIgnoreCase))
        {
            return RbacMatrixSnapshot.Open;
        }

        var roles = new List<RbacRole>();
        if (json.ValueKind == JsonValueKind.Object
            && json.TryGetProperty("roles", out JsonElement roleRows)
            && roleRows.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement row in roleRows.EnumerateArray())
            {
                if (row.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                string id = RbacMatrixJson.Str(row, "id") ?? string.Empty;
                string name = RbacMatrixJson.Str(row, "name") ?? id;
                roles.Add(new RbacRole(id, name));
            }
        }

        var permissions = new List<RbacPermissionEntry>();
        if (json.ValueKind == JsonValueKind.Object
            && json.TryGetProperty("permissions", out JsonElement permRows)
            && permRows.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement row in permRows.EnumerateArray())
            {
                if (row.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                string id = RbacMatrixJson.Str(row, "id") ?? string.Empty;
                string name = RbacMatrixJson.Str(row, "name") ?? id;
                string category = RbacMatrixJson.Str(row, "category") ?? string.Empty;
                permissions.Add(new RbacPermissionEntry(id, name, category));
            }
        }

        return new RbacMatrixSnapshot(
            IsOpenMode: false,
            Roles: roles,
            Permissions: permissions,
            Categories: RbacMatrixJson.StringList(json, "categories"),
            Matrix: RbacMatrixJson.NestedBoolMap(json, "matrix"),
            EffectiveForMe: RbacMatrixJson.BoolMap(json, "effective_for_me", "effectiveForMe"),
            MyRoles: RbacMatrixJson.StringList(json, "my_roles", "myRoles"),
            GroupsHeaderName: RbacMatrixJson.Str(json, "groups_header_name", "groupsHeaderName"));
    }
}

/// <summary>
/// The generated-client-backed <see cref="IRbacWriteService"/> — the native data adapter for the web
/// <c>useUpsertRbacCells</c> mutation (<c>PUT /admin/rbac/matrix</c>, body <c>{ cells: [...] }</c>). The route is
/// sudo-gated server-side; a <c>SUDO_REQUIRED</c> 401 / a validation 400 surfaces as the client's
/// <see cref="ApiException"/>, which the view-model maps to a kept-open editor (web parity: the matrix stays in edit
/// mode so the operator can retry). No HTTP touches the view.
/// </summary>
public sealed class RbacUpsertClientService : IRbacWriteService
{
    private readonly IApiClient _api;

    /// <summary>Creates the service over the generated contract client.</summary>
    public RbacUpsertClientService(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task UpsertAsync(IReadOnlyList<RbacUpsertCell> cells, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(cells);

        // web useUpsertRbacCells body: { cells: [{ role_id, permission_id, allowed }] }. The keys are emitted as the
        // snake_case wire shape the Go handler binds, never the camelCase record property names.
        var wireCells = new List<Dictionary<string, object?>>(cells.Count);
        foreach (RbacUpsertCell cell in cells)
        {
            wireCells.Add(new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["role_id"] = cell.RoleId,
                ["permission_id"] = cell.PermissionId,
                ["allowed"] = cell.Allowed,
            });
        }

        var body = new Dictionary<string, object?>(StringComparer.Ordinal) { ["cells"] = wireCells };
        var request = new ApiRequest(RbacMatrixRegistration.UpsertOperation, Body: body);
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }
}
