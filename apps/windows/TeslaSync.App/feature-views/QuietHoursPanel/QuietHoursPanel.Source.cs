using System.Collections.Generic;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data seam the <see cref="QuietHoursPanelViewModel"/> binds to (P1/S8) — the native analogue of the web
/// <c>useQuietHours</c> / <c>useSaveQuietHours</c> / <c>useDeleteQuietHours</c> hook trio
/// (web/src/api/hooks/useNotifications.ts). It yields the cache-then-network sequence of parsed window lists for
/// <c>GET /notifications/quiet-hours</c> and persists a create / update / delete. The view never performs HTTP;
/// the concrete <see cref="QuietHoursSource"/> (or a test fake) drives this.
/// </summary>
public interface IQuietHoursSource
{
    /// <summary>Stream the cache-then-network window-list snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read.</param>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<QuietHoursWindow>>> StreamAsync(
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Persist <paramref name="draft"/> via <c>POST /notifications/quiet-hours</c> (create) or
    /// <c>PATCH /notifications/quiet-hours/{id}</c> (update), mirroring the web <c>useSaveQuietHours</c> mutation.
    /// </summary>
    /// <param name="draft">The draft to create or update.</param>
    /// <param name="cancellationToken">Cancels the write.</param>
    Task SaveAsync(QuietHoursDraft draft, CancellationToken cancellationToken = default);

    /// <summary>Delete the window <paramref name="id"/> via <c>DELETE /notifications/quiet-hours/{id}</c>.</summary>
    /// <param name="id">The window id to delete.</param>
    /// <param name="cancellationToken">Cancels the write.</param>
    Task DeleteAsync(long id, CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IQuietHoursSource"/> — the native data adapter for the quiet-hours surface. It
/// runs one cache-then-network read of <c>GET /notifications/quiet-hours</c> (generated operation
/// <c>get_api_v1_notifications_quiet_hours</c>, the web <c>useQuietHours</c> query), projecting each emission's
/// <c>{ windows: [...] }</c> envelope into a <see cref="QuietHoursWindow"/> list, and issues the create / update /
/// delete writes with the snake_case body the Go API expects. No HTTP touches the view.
/// </summary>
public sealed class QuietHoursSource : IQuietHoursSource
{
    private const string CacheKey = "notifications:quiet-hours";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public QuietHoursSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<QuietHoursWindow>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(QuietHoursRegistration.ListOperation);

        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return Map(emission);
        }
    }

    /// <inheritdoc />
    public async Task SaveAsync(QuietHoursDraft draft, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);

        var body = draft.ToWriteBody();
        ApiRequest request = draft.Id is { } id && id > 0
            ? new ApiRequest(
                QuietHoursRegistration.UpdateOperation,
                new Dictionary<string, string> { ["id"] = id.ToString(CultureInfo.InvariantCulture) },
                Body: body)
            : new ApiRequest(QuietHoursRegistration.CreateOperation, Body: body);

        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task DeleteAsync(long id, CancellationToken cancellationToken = default)
    {
        var request = ApiRequest.WithPath(
            QuietHoursRegistration.DeleteOperation,
            "id",
            id.ToString(CultureInfo.InvariantCulture));
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    private static RepositoryResult<IReadOnlyList<QuietHoursWindow>> Map(RepositoryResult<JsonElement> raw)
    {
        IReadOnlyList<QuietHoursWindow>? windows = raw.Value is { } body
            ? QuietHoursWindow.ListFromResponse(body)
            : null;

        return new RepositoryResult<IReadOnlyList<QuietHoursWindow>>(
            raw.Status,
            windows,
            raw.FetchedAt,
            raw.IsStale,
            raw.Error);
    }

    // The list endpoint returns a { "windows": [...] } envelope; a null / non-object body or an empty / absent
    // windows array is the empty state (web windows.length === 0).
    private static bool IsEmptyResponse(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty("windows", out var windows)
            || windows.ValueKind != JsonValueKind.Array)
        {
            return true;
        }

        return windows.GetArrayLength() == 0;
    }
}
