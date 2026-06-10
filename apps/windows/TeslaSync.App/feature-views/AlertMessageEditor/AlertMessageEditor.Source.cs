using System.Globalization;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The query inputs for the insert-token catalog read — the native mirror of the args the web
/// token-catalog hook forwards (kind / signal_name / op / metric_id). The catalog
/// response is a pure function of these, so they also key the cache entry.
/// </summary>
public sealed record MessageTokenQuery(string? Kind, string? SignalName, string? Op, string? MetricId)
{
    /// <summary>An empty query (no rule context yet).</summary>
    public static MessageTokenQuery Empty => new(null, null, null, null);

    /// <summary>Build the query from a rule draft (web parity: the editor passes the draft fields through).</summary>
    public static MessageTokenQuery FromDraft(AlertRuleDraft draft)
    {
        ArgumentNullException.ThrowIfNull(draft);
        return new MessageTokenQuery(draft.Kind, draft.SignalName, draft.Op, draft.MetricId);
    }

    /// <summary>The snake_case query parameters to append to the catalog request (omitting empty values).</summary>
    public IReadOnlyDictionary<string, object?> ToQueryParams()
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (!string.IsNullOrEmpty(Kind))
        {
            query["kind"] = Kind;
        }

        if (!string.IsNullOrEmpty(SignalName))
        {
            query["signal_name"] = SignalName;
        }

        if (!string.IsNullOrEmpty(Op))
        {
            query["op"] = Op;
        }

        if (!string.IsNullOrEmpty(MetricId))
        {
            query["metric_id"] = MetricId;
        }

        return query;
    }

    /// <summary>A stable cache key incorporating every input that varies the catalog response.</summary>
    public string CacheKey() => string.Create(
        CultureInfo.InvariantCulture,
        $"alerts:message-tokens:{Kind}:{SignalName}:{Op}:{MetricId}");
}

/// <summary>
/// The data port the view-model binds to for the insert-token catalog (P1/S8 state-holder seam). It
/// yields the cache-then-network sequence of parsed token snapshots for the token-catalog read — the
/// native analogue of the web token-catalog hook. The view never performs HTTP
/// itself; the concrete <see cref="MessageTokenSource"/> (or a test fake) drives this.
/// </summary>
public interface IMessageTokenSource
{
    /// <summary>Stream the cache-then-network token snapshots for <paramref name="query"/>, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<MessageToken>>> StreamAsync(
        MessageTokenQuery query,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The data port the view-model binds to for the preset gallery (P1/S8). The native analogue of the web
/// <c>useAlertMessagePresets</c> hook.
/// </summary>
public interface IMessagePresetSource
{
    /// <summary>Stream the cache-then-network preset snapshots for an optional <paramref name="kind"/>, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<MessagePreset>>> StreamAsync(
        string? kind,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The outcome of a single preview render — the native analogue of the web <c>useAlertMessagePreview</c>
/// mutation resolving. On success it carries the rendered <see cref="Result"/>; on an HTTP fault it
/// carries a classified <see cref="Error"/> rather than throwing (web parity: the mutation resolves to a
/// rendered pane or an error string, never an unhandled rejection).
/// </summary>
public sealed record MessagePreviewOutcome(bool Success, MessagePreviewResult? Result, RepositoryError? Error)
{
    /// <summary>A successful render.</summary>
    public static MessagePreviewOutcome Ok(MessagePreviewResult result) => new(true, result, null);

    /// <summary>A classified failure.</summary>
    public static MessagePreviewOutcome Fail(RepositoryError error) => new(false, null, error);
}

/// <summary>
/// The data port the view-model binds to for the live preview (P1/S8). A fire-on-edit render rather than
/// a cache-then-network read, so it exposes a single awaitable call.
/// </summary>
public interface IMessagePreviewSource
{
    /// <summary>Render <paramref name="request"/> against the preview endpoint; never throws for an HTTP fault.</summary>
    Task<MessagePreviewOutcome> PreviewAsync(MessagePreviewRequest request, CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IMessageTokenSource"/> — the native data adapter for the insert-token
/// catalog. It runs one cache-then-network read of the token-catalog endpoint (generated operation
/// <see cref="TokenCatalogOperation"/>) through the shared <see cref="CacheThenNetworkEngine"/>, caching
/// the raw JSON so the snake_case wire shape round-trips losslessly, and maps each emission to typed
/// tokens via <see cref="MessageTokenResultMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class MessageTokenSource : IMessageTokenSource
{
    /// <summary>The generated OpenAPI operation id for the insert-token catalog read.</summary>
    public const string TokenCatalogOperation = "get_api_v1_alerts_message_placeholders"; // parity:allow generated OpenAPI operation id is immutable (ADR-014)

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public MessageTokenSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<MessageToken>>> StreamAsync(
        MessageTokenQuery query,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        var request = new ApiRequest(TokenCatalogOperation, Query: query.ToQueryParams());

        var raw = _engine.StreamAsync<JsonElement>(
            query.CacheKey(),
            ct => _api.SendAsync<JsonElement>(request, ct),
            JsonArrays.IsEmpty,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return MessageTokenResultMapper.Map(emission);
        }
    }
}

/// <summary>
/// The repository-backed <see cref="IMessagePresetSource"/> — the native data adapter for the preset
/// gallery. Runs one cache-then-network read of the preset endpoint (generated operation
/// <see cref="PresetCatalogOperation"/>) and maps each emission via <see cref="MessagePresetResultMapper"/>.
/// </summary>
public sealed class MessagePresetSource : IMessagePresetSource
{
    /// <summary>The generated OpenAPI operation id for the preset gallery read.</summary>
    public const string PresetCatalogOperation = "get_api_v1_alerts_message_presets";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public MessagePresetSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<MessagePreset>>> StreamAsync(
        string? kind,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (!string.IsNullOrEmpty(kind))
        {
            query["kind"] = kind;
        }

        var request = new ApiRequest(PresetCatalogOperation, Query: query);
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"alerts:message-presets:{kind}");

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            JsonArrays.IsEmpty,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return MessagePresetResultMapper.Map(emission);
        }
    }
}

/// <summary>
/// The repository-backed <see cref="IMessagePreviewSource"/> — the native data adapter for the live
/// preview. Posts the editor draft to the preview endpoint (generated operation
/// <see cref="PreviewOperation"/>) and classifies any fault through the shared <see cref="ApiErrorMapper"/>
/// rather than throwing. No HTTP touches the view.
/// </summary>
public sealed class MessagePreviewSource : IMessagePreviewSource
{
    /// <summary>The generated OpenAPI operation id for the preview render.</summary>
    public const string PreviewOperation = "post_api_v1_alerts_message_preview";

    private readonly IApiClient _api;

    /// <summary>Creates the source over the contract client.</summary>
    public MessagePreviewSource(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<MessagePreviewOutcome> PreviewAsync(
        MessagePreviewRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var apiRequest = new ApiRequest(PreviewOperation, Body: request);
        try
        {
            var element = await _api.SendAsync<JsonElement>(apiRequest, cancellationToken).ConfigureAwait(false);
            return MessagePreviewOutcome.Ok(MessagePreviewResult.FromJson(element));
        }
        catch (ApiException ex)
        {
            return MessagePreviewOutcome.Fail(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return MessagePreviewOutcome.Fail(ApiErrorMapper.Map(ex));
        }
    }
}

/// <summary>Shared empty-array predicate for the editor's cache-then-network catalog reads.</summary>
internal static class JsonArrays
{
    public static bool IsEmpty(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
