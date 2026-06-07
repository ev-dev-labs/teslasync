using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The repository-backed <see cref="IAutomationStatusSource"/> — the native data adapter for the
/// Automation Status surface. It runs one cache-then-network read of <c>GET /automations</c> (generated
/// operation <c>get_api_v1_automations</c>, the same endpoint the web <c>useAutomations</c> hook reads),
/// caching the raw JSON so the snake_case wire shape round-trips losslessly, and parses each emission into
/// an <see cref="AutomationStatusSnapshot"/> via <see cref="AutomationStatusResultMapper"/>. No HTTP
/// touches the view.
/// </summary>
public sealed class AutomationStatusSource : IAutomationStatusSource
{
    private const string CacheKey = "automations:list";

    private static readonly ApiRequest ListRequest = new(Operations.Automations.List);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public AutomationStatusSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<AutomationStatusSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(ListRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return AutomationStatusResultMapper.Map(emission);
        }
    }

    // Web parity: the endpoint returns a (possibly empty) JSON array of automations. A null/absent body or
    // an empty array is the empty result — the web gates its "No automations configured" empty state on
    // items.length === 0, so a configured-but-empty fleet collapses to the friendly empty surface.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}

/// <summary>
/// The repository-backed <see cref="IAutomationToggle"/> — the native data adapter for the enable/disable
/// mutation. It issues one <c>PATCH /automations/{id}/toggle</c> (generated operation
/// <c>patch_api_v1_automations_id_toggle</c>) with an <c>{ "enabled": &lt;bool&gt; }</c> body, mirroring
/// the web <c>useToggleAutomation</c> request, and reports success/failure as a bool so the view-model can
/// revert its optimistic flip without classifying transport errors. No HTTP touches the view.
/// </summary>
public sealed class AutomationToggleCommand : IAutomationToggle
{
    private const string ToggleOperation = "patch_api_v1_automations_id_toggle";

    private readonly IApiClient _api;

    /// <summary>Creates the command over the generated contract client.</summary>
    public AutomationToggleCommand(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<bool> ToggleAsync(long id, bool enabled, CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(
            ToggleOperation,
            PathParams: new Dictionary<string, string> { ["id"] = id.ToString(CultureInfo.InvariantCulture) },
            Body: new Dictionary<string, object?> { ["enabled"] = enabled });

        try
        {
            await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return false;
        }
    }
}
