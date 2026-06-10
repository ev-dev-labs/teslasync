using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="PresetGalleryViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed preset lists — the native analogue of the web component's
/// <c>useAutomationPresets(category)</c> query (web/src/api/hooks/useAutomations.ts), which the web
/// <c>PresetGallery</c> consumes as <c>data?.presets</c>. The view never performs HTTP itself; the concrete
/// <see cref="PresetGallerySource"/> (or a test fake) drives this.
/// </summary>
public interface IPresetGallerySource
{
    /// <summary>Stream the cache-then-network preset snapshots, cached first.</summary>
    /// <param name="cancellationToken">Cancels a superseded read.</param>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<AutomationPresetRow>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IPresetGallerySource"/> — the native data adapter for the Preset-Gallery
/// surface. It runs one cache-then-network read of the automation presets (generated operation
/// <c>get_api_v1_automations_presets</c>), optionally scoped to one <c>category</c> (web parity:
/// <c>useAutomationPresets(category)</c> appends <c>?category=</c> only when a category is supplied), caching
/// the raw JSON so the snake_case wire shape round-trips losslessly, and parses each emission into
/// <see cref="AutomationPresetRow"/> rows via <see cref="PresetGalleryResultMapper"/>. No HTTP touches the
/// view.
/// </summary>
public sealed class PresetGallerySource : IPresetGallerySource
{
    private const string CategoryQueryParam = "category";
    private const string CacheKeyPrefix = "automations:presets";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly string? _category;

    /// <summary>Creates the source over the contract client, engine, JSON settings and optional category scope.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="category">An explicit category to scope the read to; null reads every preset.</param>
    public PresetGallerySource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options, string? category = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
        _category = string.IsNullOrWhiteSpace(category) ? null : category;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<AutomationPresetRow>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = _category is { } category
            ? new ApiRequest(
                Operations.Automations.Presets,
                Query: new Dictionary<string, object?>(StringComparer.Ordinal) { [CategoryQueryParam] = category })
            : new ApiRequest(Operations.Automations.Presets);

        string cacheKey = _category is { } c
            ? string.Create(CultureInfo.InvariantCulture, $"{CacheKeyPrefix}:{c}")
            : CacheKeyPrefix;

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return PresetGalleryResultMapper.Map(emission);
        }
    }

    // The presets endpoint returns an object with a "presets" array; a null body, a missing / non-array
    // "presets", or an empty "presets" array all carry no templates. A bare empty array is also treated as empty.
    private static bool IsEmptyResponse(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Null:
            case JsonValueKind.Undefined:
                return true;
            case JsonValueKind.Array:
                return element.GetArrayLength() == 0;
            case JsonValueKind.Object:
                return !element.TryGetProperty("presets", out var presets)
                    || presets.ValueKind != JsonValueKind.Array
                    || presets.GetArrayLength() == 0;
            default:
                return true;
        }
    }
}
