using System.Globalization;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The read port the <see cref="ShareDriveDialogViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the web <c>useShareLinks(driveId)</c> query (web/src/api/hooks/useSharing.ts). It yields the
/// cache-then-network sequence of parsed share links for <c>GET /drives/{driveID}/shares</c>. The view never
/// performs HTTP itself; the concrete <see cref="ShareLinksSource"/> (or a test fake) drives this.
/// </summary>
public interface IShareLinksSource
{
    /// <summary>Stream the cache-then-network share-link snapshots for a drive, cached first.</summary>
    /// <param name="driveId">The drive whose share links are read.</param>
    /// <param name="cancellationToken">Cancellation for a superseded read.</param>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<ShareLink>>> StreamAsync(
        long driveId,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The mutation port the <see cref="ShareDriveDialogViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the web <c>useCreateShareLink(driveId)</c> and <c>useRevokeShareLink(driveId)</c> mutations. The view
/// never performs HTTP itself; the concrete <see cref="ShareLinksCommands"/> (or a test fake) drives this. Neither
/// method throws for an HTTP fault — each resolves to a classified outcome so the view raises a toast rather than
/// an unhandled rejection (web parity).
/// </summary>
public interface IShareLinksCommands
{
    /// <summary>Create a share link (web <c>createShare.mutateAsync(payload)</c>): <c>POST /drives/{driveID}/share</c>.</summary>
    Task<ShareCreateOutcome> CreateAsync(long driveId, CreateShareBody body, CancellationToken cancellationToken = default);

    /// <summary>Revoke a share link (web <c>revokeShare.mutateAsync(token)</c>): <c>DELETE /shares/{token}</c>.</summary>
    Task<ShareRevokeOutcome> RevokeAsync(string token, CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IShareLinksSource"/> — the native data adapter for the dialog's active-links
/// read. It streams <c>GET /drives/{driveID}/shares</c> through the shared <see cref="CacheThenNetworkEngine"/>
/// (the same cache + freshness contract the rest of the app shares) and folds each raw emission through
/// <see cref="ShareDriveDialogResultMapper"/> so the view-model receives parsed <see cref="ShareLink"/>s with every
/// freshness flag preserved. Every body is cached so the snake_case wire round-trips losslessly. No HTTP touches
/// the view.
/// </summary>
public sealed class ShareLinksSource : IShareLinksSource
{
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public ShareLinksSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ShareLink>>> StreamAsync(
        long driveId,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = ApiRequest.WithPath(
            ShareDriveDialogRegistration.ListOperation,
            "driveID",
            driveId.ToString(CultureInfo.InvariantCulture));
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"sharing:drive:{driveId}:shares");

        IAsyncEnumerable<RepositoryResult<JsonElement>> stream = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyArray,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (RepositoryResult<JsonElement> result in stream.ConfigureAwait(false))
        {
            yield return ShareDriveDialogResultMapper.Map(result);
        }
    }

    // The shares payload is a JSON array; a null body or empty array is the empty result.
    private static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}

/// <summary>
/// The contract-client-backed <see cref="IShareLinksCommands"/> — the native command adapter for the dialog's
/// create / revoke mutations. <see cref="CreateAsync"/> POSTs the assembled body to
/// <c>post_api_v1_drives_driveID_share</c> and parses the <c>{ token, url, id }</c> response; <see cref="RevokeAsync"/>
/// issues <c>delete_api_v1_shares_token</c>. Both classify any fault through the shared <see cref="ApiErrorMapper"/>
/// rather than throwing, mirroring the web mutations whose <c>onError</c> simply raises a toast. No HTTP touches the
/// view.
/// </summary>
public sealed class ShareLinksCommands : IShareLinksCommands
{
    private readonly IApiClient _api;

    /// <summary>Creates the command adapter over the generated contract client.</summary>
    /// <param name="api">The generated contract client.</param>
    public ShareLinksCommands(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<ShareCreateOutcome> CreateAsync(
        long driveId,
        CreateShareBody body,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(body);

        var request = new ApiRequest(
            ShareDriveDialogRegistration.CreateOperation,
            new Dictionary<string, string> { ["driveID"] = driveId.ToString(CultureInfo.InvariantCulture) },
            Query: null,
            Body: body);

        try
        {
            JsonElement response = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ShareCreateOutcome.Ok(ParseCreate(response));
        }
        catch (ApiException ex)
        {
            return ShareCreateOutcome.Fail(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return ShareCreateOutcome.Fail(ApiErrorMapper.Map(ex));
        }
    }

    /// <inheritdoc />
    public async Task<ShareRevokeOutcome> RevokeAsync(string token, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(token);

        var request = ApiRequest.WithPath(ShareDriveDialogRegistration.RevokeOperation, "token", token);
        try
        {
            _ = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ShareRevokeOutcome.Ok();
        }
        catch (ApiException ex)
        {
            return ShareRevokeOutcome.Fail(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return ShareRevokeOutcome.Fail(ApiErrorMapper.Map(ex));
        }
    }

    private static ShareCreateResult ParseCreate(JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object)
        {
            return new ShareCreateResult(string.Empty, null, 0);
        }

        string token = body.TryGetProperty("token", out JsonElement t) && t.ValueKind == JsonValueKind.String
            ? t.GetString() ?? string.Empty
            : string.Empty;
        string? url = body.TryGetProperty("url", out JsonElement u) && u.ValueKind == JsonValueKind.String
            ? u.GetString()
            : null;
        long id = body.TryGetProperty("id", out JsonElement i) && i.ValueKind == JsonValueKind.Number && i.TryGetInt64(out long n)
            ? n
            : 0;
        return new ShareCreateResult(token, url, id);
    }
}
