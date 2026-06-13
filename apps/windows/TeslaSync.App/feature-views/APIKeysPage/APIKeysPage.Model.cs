// Admin / API Keys page — native model layer.
//
// The WinUI-free read-models, lifecycle state, projection, registration and
// diagnostics behind the APIKeysPage surface (the native parity port of the web
// page web/src/features/admin/pages/APIKeysPage.tsx, route /api-keys). The web
// page manages API keys for programmatic access: a create modal (name +
// permission level → a one-time generated key), a list of existing keys with a
// permission badge / expired badge / metadata, and per-row revoke + delete with
// a delete confirmation.
//
// Everything here is UI-thread-free so the JSON adapters, the permission/row
// projection and the PII-safe diagnostics are asserted headlessly without a
// WinUI host.
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>APIKeysPage</c> surface — the native union of the data states
/// the web page renders (web/src/features/admin/pages/APIKeysPage.tsx). The web page runs the <c>useApiKeys</c>
/// query and renders, in order, the skeletons while <c>isLoading</c>, the friendly empty surface when the resolved
/// list is empty, and the key rows otherwise. The cache-then-network read this surface owns adds the stale / offline
/// content variants and the retriable error surface, so this single enum drives the top-level branch the
/// ledger/Narrator key off; the content states (<see cref="Loaded"/> / <see cref="Stale"/> / <see cref="Offline"/>)
/// all render the rows.
/// </summary>
public enum ApiKeysState
{
    /// <summary>The read is in flight with no cached value yet — render the row skeletons (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>A fresh, non-empty key list arrived — render the rows (web <c>keys.length &gt; 0</c>).</summary>
    Loaded,

    /// <summary>The read resolved with no keys — render the friendly empty surface (web <c>EmptyState</c>).</summary>
    Empty,

    /// <summary>A cached list older than the freshness window — render the rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render the rows plus an offline chip.</summary>
    Offline,

    /// <summary>The read failed with no cached list — render the retriable error surface.</summary>
    Error,
}

/// <summary>
/// One API key — the native, cache-friendly read-model parsed from a row of the <c>GET /api-keys</c> response (the
/// web <c>APIKey</c>, web/src/types/admin.ts). Field names mirror the Go API's snake_case JSON tags
/// (<c>internal/api/apikey/handler.go</c>); parsing is null-tolerant so a partial row never throws. Pure data — no
/// WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Id">The server key id.</param>
/// <param name="Name">The friendly key name.</param>
/// <param name="KeyPrefix">The non-secret key prefix shown in the list (e.g. <c>ts_abc123...</c>).</param>
/// <param name="Permissions">The permission level (<c>read</c> / <c>read-write</c> / <c>admin</c>).</param>
/// <param name="CreatedAt">When the key was created.</param>
/// <param name="LastUsedAt">When the key was last used, or null if never used.</param>
/// <param name="ExpiresAt">When the key expires, or null if it never expires.</param>
public sealed record ApiKey(
    long Id,
    string Name,
    string KeyPrefix,
    string Permissions,
    DateTimeOffset? CreatedAt,
    DateTimeOffset? LastUsedAt,
    DateTimeOffset? ExpiresAt)
{
    /// <summary>Parse one key object into a read-model (web <c>APIKey</c> shape), tolerating missing fields.</summary>
    public static ApiKey FromJson(JsonElement element)
    {
        long id = ApiKeysJson.ReadLong(element, "id");
        string name = ApiKeysJson.ReadString(element, "name") ?? string.Empty;
        string keyPrefix = ApiKeysJson.ReadString(element, "key_prefix") ?? string.Empty;
        string permissions = ApiKeysJson.NormalizePermission(ApiKeysJson.ReadString(element, "permissions"));
        DateTimeOffset? createdAt = ApiKeysJson.ReadDateTime(element, "created_at");
        DateTimeOffset? lastUsedAt = ApiKeysJson.ReadDateTime(element, "last_used_at");
        DateTimeOffset? expiresAt = ApiKeysJson.ReadDateTime(element, "expires_at");
        return new ApiKey(id, name, keyPrefix, permissions, createdAt, lastUsedAt, expiresAt);
    }

    /// <summary>True when the key has an expiry that is already in the past (web <c>isExpired</c>).</summary>
    public bool IsExpired(DateTimeOffset now) => ExpiresAt is { } expiry && expiry < now;
}

/// <summary>
/// A parsed snapshot of the API-key collection — the native read-model behind the web <c>useApiKeys()</c> array.
/// <see cref="HasData"/> distinguishes a populated list from a resolved-but-empty response so the empty surface
/// renders rather than a blank region.
/// </summary>
/// <param name="Keys">The keys in server order (newest first, as the API returns them).</param>
public sealed record ApiKeyList(IReadOnlyList<ApiKey> Keys)
{
    /// <summary>An empty key list.</summary>
    public static ApiKeyList Empty { get; } = new(Array.Empty<ApiKey>());

    /// <summary>True when at least one API key exists.</summary>
    public bool HasData => Keys.Count > 0;

    /// <summary>Parse a <c>GET /api-keys</c> array into a tolerant list of rows; a non-array body is empty.</summary>
    public static ApiKeyList FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        var keys = new List<ApiKey>(element.GetArrayLength());
        foreach (var row in element.EnumerateArray())
        {
            if (row.ValueKind == JsonValueKind.Object)
            {
                keys.Add(ApiKey.FromJson(row));
            }
        }

        return keys.Count == 0 ? Empty : new ApiKeyList(keys);
    }
}

/// <summary>
/// The one-time secret returned by <c>POST /api-keys</c> (the web <c>APIKey &amp; { key: string }</c>). The raw
/// <see cref="Key"/> is shown exactly once in the "API Key Created" modal and is never persisted by the client.
/// </summary>
/// <param name="Id">The new key id.</param>
/// <param name="Key">The raw secret key (shown once, then unrecoverable).</param>
/// <param name="Name">The key name.</param>
/// <param name="KeyPrefix">The non-secret prefix.</param>
/// <param name="Permissions">The permission level.</param>
public sealed record CreatedApiKey(long Id, string Key, string Name, string KeyPrefix, string Permissions)
{
    /// <summary>Parse the create response object into the created-key read-model.</summary>
    public static CreatedApiKey FromJson(JsonElement element) => new(
        ApiKeysJson.ReadLong(element, "id"),
        ApiKeysJson.ReadString(element, "key") ?? string.Empty,
        ApiKeysJson.ReadString(element, "name") ?? string.Empty,
        ApiKeysJson.ReadString(element, "key_prefix") ?? string.Empty,
        ApiKeysJson.NormalizePermission(ApiKeysJson.ReadString(element, "permissions")));
}

/// <summary>A localized transient message raised for the in-app toast surface (web <c>useMutationToast</c>).</summary>
/// <param name="Message">The localized toast body.</param>
/// <param name="IsError">True for an error toast (rendered with the danger severity).</param>
public sealed record ApiKeysToast(string Message, bool IsError);

/// <summary>
/// The render-ready projection of a single key row (web's per-key <c>GlassPanel</c>). Carries the localized labels,
/// the permission chip (label + status + glyph), the expired flag, the metadata strings and the per-row Narrator
/// names so the view stays a thin renderer.
/// </summary>
public sealed record ApiKeyRowDisplay(
    long Id,
    string Name,
    string PermissionLabel,
    StatusKind PermissionStatus,
    string PermissionGlyph,
    bool IsExpired,
    string ExpiredLabel,
    string KeyPrefix,
    string CreatedText,
    bool HasLastUsed,
    string LastUsedText,
    bool CanRevoke,
    string RevokeTooltip,
    string RevokeAutomationName,
    string DeleteTooltip,
    string DeleteAutomationName);

/// <summary>
/// The render-ready projection the <see cref="ApiKeysPageViewModel"/> exposes — the localized page chrome (title /
/// subtitle / create action), the empty-surface copy and the projected key <see cref="Rows"/>. The view binds to
/// this so all i18n + branch selection happen here, off the UI thread.
/// </summary>
public sealed record ApiKeysDisplay(
    string Title,
    string Subtitle,
    string AutomationName,
    string CreateLabel,
    string CreateAutomationName,
    string EmptyTitle,
    string EmptyMessage,
    IReadOnlyList<ApiKeyRowDisplay> Rows);

/// <summary>
/// Projects the parsed <see cref="ApiKeyList"/> + <see cref="ApiKeysState"/> into the render-ready
/// <see cref="ApiKeysDisplay"/>. Pure and localizer-driven so every label is asserted headlessly and the WinUI view
/// never composes a string itself.
/// </summary>
public static class ApiKeysProjection
{
    private const string ReadGlyph = "\uE72E";       // Lock — read-only access
    private const string ReadWriteGlyph = "\uE70F";  // Edit — read-write access
    private const string AdminGlyph = "\uE7EF";       // Admin — elevated access

    /// <summary>Resolve the permission level into its localized label, status chip colour and glyph (web <c>PermissionBadge</c>).</summary>
    public static (string Label, StatusKind Status, string Glyph) Permission(string permission, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return permission switch
        {
            "read-write" => (localizer.GetString("apiKeys.permission.readWrite", "Read-Write"), StatusKind.Warning, ReadWriteGlyph),
            "admin" => (localizer.GetString("apiKeys.permission.admin", "Admin"), StatusKind.Info, AdminGlyph),
            _ => (localizer.GetString("apiKeys.permission.read", "Read"), StatusKind.Success, ReadGlyph),
        };
    }

    /// <summary>Build the full page projection from the current list snapshot, state and clock.</summary>
    public static ApiKeysDisplay Project(ApiKeyList keys, ApiKeysState state, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(keys);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("apiKeys.title", "API Keys");
        string createLabel = localizer.GetString("apiKeys.createButton", "Create Key");

        IReadOnlyList<ApiKeyRowDisplay> rows = state is ApiKeysState.Loading or ApiKeysState.Error
            ? Array.Empty<ApiKeyRowDisplay>()
            : ProjectRows(keys, localizer, now);

        return new ApiKeysDisplay(
            Title: title,
            Subtitle: localizer.GetString("apiKeys.subtitle", "Manage programmatic access to TeslaSync"),
            AutomationName: title,
            CreateLabel: createLabel,
            CreateAutomationName: createLabel,
            EmptyTitle: localizer.GetString("apiKeys.empty.title", "No API keys"),
            EmptyMessage: localizer.GetString(
                "apiKeys.empty.message",
                "Create an API key to enable programmatic access to TeslaSync data and controls."),
            Rows: rows);
    }

    private static IReadOnlyList<ApiKeyRowDisplay> ProjectRows(ApiKeyList keys, ILocalizer localizer, DateTimeOffset now)
    {
        if (!keys.HasData)
        {
            return Array.Empty<ApiKeyRowDisplay>();
        }

        string createdLabel = localizer.GetString("apiKeys.row.created", "Created");
        string lastUsedLabel = localizer.GetString("apiKeys.row.lastUsed", "Last used");
        string revoke = localizer.GetString("apiKeys.row.revoke", "Revoke");
        string delete = localizer.GetString("apiKeys.delete.confirm", "Delete");
        string expired = localizer.GetString("apiKeys.badge.expired", "Expired");

        var rows = new List<ApiKeyRowDisplay>(keys.Keys.Count);
        foreach (var key in keys.Keys)
        {
            var (permLabel, permStatus, permGlyph) = Permission(key.Permissions, localizer);
            bool isExpired = key.IsExpired(now);

            string createdDate = DateTimeFormatting.Format(key.CreatedAt, DateTimeVariant.Date, now);
            string createdText = string.Format(CultureInfo.CurrentCulture, "{0} {1}", createdLabel, createdDate);

            bool hasLastUsed = key.LastUsedAt is not null;
            string lastUsedText = hasLastUsed
                ? string.Format(
                    CultureInfo.CurrentCulture,
                    "{0} {1}",
                    lastUsedLabel,
                    DateTimeFormatting.Format(key.LastUsedAt, DateTimeVariant.Date, now))
                : string.Empty;

            rows.Add(new ApiKeyRowDisplay(
                Id: key.Id,
                Name: key.Name,
                PermissionLabel: permLabel,
                PermissionStatus: permStatus,
                PermissionGlyph: permGlyph,
                IsExpired: isExpired,
                ExpiredLabel: expired,
                KeyPrefix: key.KeyPrefix,
                CreatedText: createdText,
                HasLastUsed: hasLastUsed,
                LastUsedText: lastUsedText,
                CanRevoke: !isExpired,
                RevokeTooltip: revoke,
                RevokeAutomationName: string.Format(CultureInfo.CurrentCulture, "{0} {1}", revoke, key.Name),
                DeleteTooltip: delete,
                DeleteAutomationName: string.Format(CultureInfo.CurrentCulture, "{0} {1}", delete, key.Name)));
        }

        return rows;
    }
}

/// <summary>
/// Canonical metadata for the APIKeysPage surface — the native anchor for the web page at
/// web/src/features/admin/pages/APIKeysPage.tsx (route <c>/api-keys</c>, nav name <c>APIKeys</c>). Centralises the
/// diagnostics <see cref="Slug"/>, the localized title/subtitle (the web <c>PageContainer</c> header) and the
/// generated OpenAPI operation ids the source reads and mutates (the web <c>useApiKeys</c> / <c>useCreateApiKey</c>
/// / <c>useDeleteApiKey</c> / <c>useRevokeApiKey</c> hooks).
/// </summary>
public static class ApiKeysRegistration
{
    /// <summary>The navigation route name the shell page factory registers this surface under.</summary>
    public const string RouteName = "APIKeys";

    /// <summary>The normalized route path (web route <c>/api-keys</c>).</summary>
    public const string RoutePath = "api-keys";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "APIKeysPage";

    /// <summary>The web page this surface mirrors.</summary>
    public const string WebSource = "features/admin/pages/APIKeysPage.tsx";

    /// <summary>Cache key for the cache-then-network key-list read.</summary>
    public const string CacheKey = "admin:api-keys";

    /// <summary>Operation id for <c>GET /api-keys</c> — the key list (web <c>useApiKeys</c>).</summary>
    public const string ListOperation = "get_api_v1_api_keys";

    /// <summary>Operation id for <c>POST /api-keys</c> — create a key (web <c>useCreateApiKey</c>).</summary>
    public const string CreateOperation = "post_api_v1_api_keys";

    /// <summary>Operation id for <c>DELETE /api-keys/{id}</c> (web <c>useDeleteApiKey</c>).</summary>
    public const string DeleteOperation = "delete_api_v1_api_keys_id";

    /// <summary>Operation id for <c>POST /api-keys/{id}/revoke</c> (web <c>useRevokeApiKey</c>).</summary>
    public const string RevokeOperation = "post_api_v1_api_keys_id_revoke";

    /// <summary>The path-parameter name shared by the per-key mutation endpoints.</summary>
    public const string IdParam = "id";

    /// <summary>The localized page title (web <c>t('API Keys')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("apiKeys.title", "API Keys");
    }

    /// <summary>The localized page subtitle (web <c>t('Manage programmatic access to TeslaSync')</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("apiKeys.subtitle", "Manage programmatic access to TeslaSync");
    }
}

/// <summary>
/// PII-safe diagnostics for the APIKeysPage surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a key name, prefix, secret or count — so a diagnostics
/// line can never leak user configuration. Thread-safe.
/// </summary>
public sealed class ApiKeysDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe line sink (the host's diagnostics pipeline).</summary>
    public ApiKeysDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of <c>view.opened</c> events recorded.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=APIKeysPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ApiKeysRegistration.Slug}");
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> scalar readers for the API-key adapters. Scoped to this file so the page
/// owns its parsing without coupling to another surface's helper.
/// </summary>
file static class ApiKeysJson
{
    public static long ReadLong(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var prop))
        {
            return 0;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var number) => number,
            JsonValueKind.String when long.TryParse(
                prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => 0,
        };
    }

    public static string? ReadString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    public static DateTimeOffset? ReadDateTime(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var prop) || prop.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        string? raw = prop.GetString();
        if (string.IsNullOrEmpty(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var value)
            ? value
            : null;
    }

    public static string NormalizePermission(string? raw) =>
        string.IsNullOrWhiteSpace(raw) ? "read" : raw.Trim().ToLowerInvariant();
}
