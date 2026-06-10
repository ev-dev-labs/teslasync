using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The active-incidents seam (P1/S8) — the native analogue of the web <c>useIncidents({ activeOnly: true })</c>
/// query. It yields the cache-then-network sequence of parsed active-incident lists for
/// <c>GET /status/incidents?active=1</c>. The view never performs HTTP; the concrete
/// <see cref="IncidentsSource"/> (or a test fake) drives this.
/// </summary>
public interface IIncidentsSource
{
    /// <summary>Stream the cache-then-network active-incident snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<IncidentSummary>>> StreamAsync(
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IIncidentsSource"/> — the native data adapter for the active-incidents read.
/// It runs one cache-then-network read of <c>GET /status/incidents</c> with the <c>active=1</c> query (the web
/// <c>useIncidents({ activeOnly: true })</c> query), parsing each emission's <c>{ "incidents": [...] }</c>
/// envelope into an <see cref="IncidentSummary"/> list. No HTTP touches the view.
/// </summary>
public sealed class IncidentsSource : IIncidentsSource
{
    private const string CacheKey = "status:incidents:active";

    private static readonly ApiRequest ListRequest =
        ApiRequest.WithQuery(IncidentsRegistration.ListOperation, "active", 1);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public IncidentsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<IncidentSummary>>> StreamAsync(
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
            yield return Map(emission);
        }
    }

    private static RepositoryResult<IReadOnlyList<IncidentSummary>> Map(RepositoryResult<JsonElement> raw)
    {
        IReadOnlyList<IncidentSummary> Parse() =>
            raw.HasValue ? IncidentSummary.ParseList(raw.Value) : Array.Empty<IncidentSummary>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<IncidentSummary>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<IncidentSummary>>.Cached(
                Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<IncidentSummary>>.Refreshing(
                Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<IncidentSummary>>.Loaded(
                Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<IncidentSummary>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<IncidentSummary>>.OfflineCached(
                Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<IncidentSummary>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    // The incidents endpoint returns a { "incidents": [...], "count": n } envelope; a null / non-object body, a
    // missing incidents array, or an empty array carries no active incidents, so the surface falls back to its
    // friendly empty state.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Array => element.GetArrayLength() == 0,
        JsonValueKind.Object => !element.TryGetProperty("incidents", out var incidents)
            || incidents.ValueKind != JsonValueKind.Array
            || incidents.GetArrayLength() == 0,
        _ => true,
    };
}
