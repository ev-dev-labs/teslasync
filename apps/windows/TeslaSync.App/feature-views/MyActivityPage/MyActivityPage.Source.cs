using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The data port the <see cref="MyActivityPageViewModel"/> reads the current user's activity through (P1/S8
/// state-holder seam) — the native analogue of the web page's single <c>useMyRecentActivity</c> hook
/// (web/src/features/system/pages/MyActivityPage.tsx, <c>GET /users/me/activity</c>). One call resolves one
/// window of rows. The contract intentionally surfaces HTTP failures by throwing <see cref="ApiException"/> (the
/// native analogue of TanStack Query's thrown <c>ApiError</c>) so the view-model can branch on the status code
/// exactly as the web page branches on <c>apiError.status</c> (503 → disabled, 401 → unauthorized, else error).
/// The view never performs HTTP itself.
/// </summary>
public interface IMyActivitySource
{
    /// <summary>Resolve the activity rows for <paramref name="query"/>.</summary>
    /// <param name="query">The window + limit to read (web <c>MyActivityParams</c>).</param>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    /// <returns>The rows for the window, newest first; empty when the window has no activity.</returns>
    /// <exception cref="ApiException">The request failed; <see cref="ApiException.StatusCode"/> classifies the branch.</exception>
    Task<IReadOnlyList<UserActivityEntry>> FetchAsync(MyActivityQuery query, CancellationToken cancellationToken = default);
}

/// <summary>
/// The default <see cref="IMyActivitySource"/> — resolves every read to no rows (the empty data state). The shell
/// page factory uses this until a host wires the generated-client-backed <see cref="MyActivitySource"/>, so the
/// surface renders its friendly empty notice rather than a blank panel (ADR-011).
/// </summary>
public sealed class EmptyMyActivitySource : IMyActivitySource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyMyActivitySource Instance { get; } = new();

    private EmptyMyActivitySource()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<UserActivityEntry>> FetchAsync(
        MyActivityQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<UserActivityEntry>>(Array.Empty<UserActivityEntry>());
    }
}

/// <summary>
/// The generated-client-backed <see cref="IMyActivitySource"/> — the native data adapter for the web page's
/// <c>useMyRecentActivity</c> hook (web/src/api/hooks/useUser.ts). It issues one
/// <c>GET /users/me/activity?start=&amp;end=&amp;limit=</c> through the shared contract client (snake_case query
/// params, matching the Go API), and projects the JSON array into <see cref="UserActivityEntry"/> rows. A
/// <c>404</c> resolves to no rows (the web hook resolves to an empty array on 404 / empty list); every other
/// non-2xx propagates as an <see cref="ApiException"/> so the view-model can pick the disabled / unauthorized /
/// error branch. No HTTP touches the view.
/// </summary>
public sealed class MyActivitySource : IMyActivitySource
{
    private readonly IApiClient _api;

    /// <summary>Creates the source over the generated contract client.</summary>
    /// <param name="api">The generated contract API client.</param>
    public MyActivitySource(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<UserActivityEntry>> FetchAsync(
        MyActivityQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);

        var request = new ApiRequest(
            MyActivityRegistration.ActivityOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                // web buildActivityQuery: only non-empty params are appended.
                ["start"] = NullIfEmpty(query.Start),
                ["end"] = NullIfEmpty(query.End),
                ["limit"] = query.Limit,
            });

        try
        {
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return UserActivityEntry.FromArray(json);
        }
        catch (ApiException ex) when (ex.StatusCode == 404)
        {
            // web useMyRecentActivity: "Resolves to an empty array on 404 / empty list."
            return Array.Empty<UserActivityEntry>();
        }
    }

    private static string? NullIfEmpty(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;
}
