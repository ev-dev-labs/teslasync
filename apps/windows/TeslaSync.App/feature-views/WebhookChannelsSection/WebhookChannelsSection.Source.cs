using System.Collections.Generic;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="WebhookChannelsViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network channel read the web <c>useWebhookChannels()</c> composes (the kind=webhook slice of
/// <c>GET /notifications</c>) and exposes the five mutations/utilities the section invokes: save, delete, toggle,
/// the HMAC-aware webhook test (web <c>useTestWebhookChannel</c>) and the signature preview utility (web
/// <c>useWebhookSignaturePreview</c>). The view never performs HTTP itself; the concrete
/// <see cref="WebhookChannelsSource"/> (or a test fake) drives this.
/// </summary>
public interface IWebhookChannelsSource
{
    /// <summary>Stream the cache-then-network webhook-list snapshots (kind=webhook filtered), newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<WebhookChannelList>> StreamWebhooksAsync(CancellationToken cancellationToken = default);

    /// <summary>Create (<c>POST</c>) or update (<c>PUT</c>) a webhook from <paramref name="body"/> (web <c>useSaveChannel</c>).</summary>
    Task SaveAsync(JsonObject body, long? id, CancellationToken cancellationToken = default);

    /// <summary>Delete a webhook (web <c>useDeleteChannel</c>).</summary>
    Task DeleteAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>Flip a webhook's enabled flag (web <c>useToggleChannel</c>).</summary>
    Task ToggleAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>Fire a structured test delivery through the HMAC-aware webhook path (web <c>useTestWebhookChannel</c>).</summary>
    Task<WebhookTestResult> TestWebhookAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>Ask the server to compute the X-TeslaSync-Signature for (secret, body) (web <c>useWebhookSignaturePreview</c>).</summary>
    Task<string> PreviewSignatureAsync(string secret, string body, CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IWebhookChannelsSource"/> — the native data adapter for the WebhookChannels
/// surface. The read replays cache-then-network through the shared <see cref="CacheThenNetworkEngine"/> (the
/// channel list is cached as raw JSON under the same <c>notifications:channels</c> key the generic channels
/// surface uses, then mapped + kind=webhook-filtered by <see cref="WebhookChannelsResultMapper"/>); the four
/// mutations and the signature-preview utility go straight through the generated contract client. No HTTP
/// touches the view.
/// </summary>
public sealed class WebhookChannelsSource : IWebhookChannelsSource
{
    private const string ChannelsCacheKey = "notifications:channels";

    private static readonly ApiRequest ChannelsRequest = new(WebhookChannelsRegistration.ChannelsOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public WebhookChannelsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<WebhookChannelList>> StreamWebhooksAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            ChannelsCacheKey,
            ct => _api.SendAsync<JsonElement>(ChannelsRequest, ct),
            IsEmptyWebhooks,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return WebhookChannelsResultMapper.MapWebhooks(emission);
        }
    }

    /// <inheritdoc />
    public async Task SaveAsync(JsonObject body, long? id, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(body);

        var request = id is { } channelId
            ? new ApiRequest(WebhookChannelsRegistration.UpdateOperation, PathParams: PathFor(channelId), Body: body)
            : new ApiRequest(WebhookChannelsRegistration.CreateOperation, Body: body);

        await _api.SendAsync<JsonElement?>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task DeleteAsync(long id, CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(WebhookChannelsRegistration.DeleteOperation, PathParams: PathFor(id));
        await _api.SendAsync<JsonElement?>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task ToggleAsync(long id, CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(WebhookChannelsRegistration.ToggleOperation, PathParams: PathFor(id));
        await _api.SendAsync<JsonElement?>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<WebhookTestResult> TestWebhookAsync(long id, CancellationToken cancellationToken = default)
    {
        // web parity: the section's row test fires { id } with no title/message, so the request carries no body
        // and the structured result body is returned unconditionally (even on a non-2xx receiver status).
        var request = new ApiRequest(WebhookChannelsRegistration.WebhookTestOperation, PathParams: PathFor(id));
        var response = await _api.SendAsync<JsonElement?>(request, cancellationToken).ConfigureAwait(false);

        return response is { } value
            ? WebhookTestResult.FromJson(value)
            : new WebhookTestResult(false, 0, 0, null, null, false, null);
    }

    /// <inheritdoc />
    public async Task<string> PreviewSignatureAsync(string secret, string body, CancellationToken cancellationToken = default)
    {
        var payload = new JsonObject
        {
            ["secret"] = secret,
            ["body"] = body,
        };

        var request = new ApiRequest(WebhookChannelsRegistration.SignaturePreviewOperation, Body: payload);
        var response = await _api.SendAsync<JsonElement?>(request, cancellationToken).ConfigureAwait(false);

        if (response is { } value && value.ValueKind == JsonValueKind.Object)
        {
            return JsonScalars.ReadString(value, "signature") ?? string.Empty;
        }

        return string.Empty;
    }

    private static Dictionary<string, string> PathFor(long id) =>
        new(StringComparer.Ordinal)
        {
            [WebhookChannelsRegistration.ChannelIdParam] = id.ToString(CultureInfo.InvariantCulture),
        };

    // The cache-then-network "empty" predicate runs over the full GET /notifications array; the surface is empty
    // when it holds no kind=webhook rows (the web useWebhookChannels filter), even if other channel kinds exist.
    private static bool IsEmptyWebhooks(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return true;
        }

        foreach (var row in element.EnumerateArray())
        {
            if (row.ValueKind == JsonValueKind.Object &&
                string.Equals(JsonScalars.ReadString(row, "kind"), "webhook", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
        }

        return true;
    }
}
