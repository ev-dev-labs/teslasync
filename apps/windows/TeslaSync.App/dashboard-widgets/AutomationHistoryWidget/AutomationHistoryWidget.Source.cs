using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The repository-backed <see cref="IAutomationHistorySource"/> — the native data adapter for the
/// Automation History surface. It runs one cache-then-network read of <c>GET /automations/history</c>
/// (generated operation <c>get_api_v1_automations_history</c>) with the same trailing
/// <c>limit=20</c> page-size the web hook requests
/// (<see cref="AutomationHistoryRegistration.DefaultLimit"/>), caching the raw JSON so the snake_case wire
/// shape round-trips losslessly, and parses each emission into an <see cref="AutomationHistorySnapshot"/>
/// via <see cref="AutomationHistoryResultMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class AutomationHistorySource : IAutomationHistorySource
{
    private const string CacheKey = "automations:history";

    private static readonly ApiRequest HistoryRequest = new(
        Operations.Automations.History,
        Query: new Dictionary<string, object?> { ["limit"] = AutomationHistoryRegistration.DefaultLimit });

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public AutomationHistorySource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<AutomationHistorySnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(HistoryRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return AutomationHistoryResultMapper.Map(emission);
        }
    }

    // Web parity: the backend always returns a populated history object (items + summary), even for an idle
    // fleet that renders as zero runs. Only a null/absent or empty-object body counts as empty here; a
    // populated object with an empty items array is mapped to Loaded and the view-model collapses it to the
    // empty surface via the projection's row count.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };
}
