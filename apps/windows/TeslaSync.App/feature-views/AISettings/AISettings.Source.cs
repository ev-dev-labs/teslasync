using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="AiSettingsViewModel"/> binds to (P1/S8 state-holder seam). It exposes the two
/// cache-then-network reads the web AISettings panel composes — the settings document (web <c>useSettings</c>
/// → <c>GET /settings</c>) and today's Helix spend (web <c>useAiUsageToday</c> → <c>GET /ai/usage/today</c>) —
/// plus the single save mutation (web <c>useSaveAiSettings</c> → <c>PUT /settings</c>). The view never
/// performs HTTP itself; the concrete <see cref="AiSettingsSource"/> (or a test fake) drives this.
/// </summary>
public interface IAiSettingsSource
{
    /// <summary>Stream the cache-then-network settings snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<AiSettingsSnapshot>> StreamSettingsAsync(
        CancellationToken cancellationToken = default);

    /// <summary>Stream the cache-then-network "today's spend" snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<AiUsageTodaySnapshot>> StreamUsageTodayAsync(
        CancellationToken cancellationToken = default);

    /// <summary>Submit the merged settings document (web <c>PUT /settings</c>); never throws for an HTTP fault.</summary>
    Task<AiSettingsSaveOutcome> SaveAsync(JsonObject document, CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IAiSettingsSource"/> — the native data adapter for the Helix settings
/// surface. The two reads run through the shared <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so
/// the snake_case wire shape round-trips losslessly, then map each emission via the typed result mappers:
/// <c>GET /settings</c> (<see cref="SettingsOperation"/>) and <c>GET /ai/usage/today</c>
/// (<see cref="UsageTodayOperation"/>). The save posts the full merged document to <c>PUT /settings</c>
/// (<see cref="SaveOperation"/>) and classifies any fault through the shared <see cref="ApiErrorMapper"/>
/// rather than throwing. No HTTP touches the view.
/// </summary>
public sealed class AiSettingsSource : IAiSettingsSource
{
    /// <summary>The generated OpenAPI operation id for the settings document read.</summary>
    public const string SettingsOperation = "get_api_v1_settings";

    /// <summary>The generated OpenAPI operation id for today's Helix spend.</summary>
    public const string UsageTodayOperation = "get_api_v1_ai_usage_today";

    /// <summary>The generated OpenAPI operation id for the settings save.</summary>
    public const string SaveOperation = "put_api_v1_settings";

    private const string SettingsCacheKey = "settings:document";
    private const string UsageCacheKey = "ai:usage:today";

    private static readonly ApiRequest SettingsRequest = new(SettingsOperation);
    private static readonly ApiRequest UsageRequest = new(UsageTodayOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public AiSettingsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<AiSettingsSnapshot>> StreamSettingsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            SettingsCacheKey,
            ct => _api.SendAsync<JsonElement>(SettingsRequest, ct),
            IsNonObject,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return AiSettingsResultMapper.Map(emission);
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<AiUsageTodaySnapshot>> StreamUsageTodayAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            UsageCacheKey,
            ct => _api.SendAsync<JsonElement>(UsageRequest, ct),
            IsNonObject,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return AiUsageResultMapper.Map(emission);
        }
    }

    /// <inheritdoc />
    public async Task<AiSettingsSaveOutcome> SaveAsync(JsonObject document, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        var request = new ApiRequest(SaveOperation, Body: document);
        try
        {
            var element = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return AiSettingsSaveOutcome.Ok(AiSettingsSnapshot.FromJson(element));
        }
        catch (ApiException ex)
        {
            return AiSettingsSaveOutcome.Fail(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return AiSettingsSaveOutcome.Fail(ApiErrorMapper.Map(ex));
        }
    }

    // A null / non-object body carries no usable settings or usage envelope (web parity: an absent query
    // has no data). The engine keeps a valid object even when its inner maps are empty.
    private static bool IsNonObject(JsonElement element) => element.ValueKind != JsonValueKind.Object;
}
