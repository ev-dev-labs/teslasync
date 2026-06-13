using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The data port the <c>ActiveSessionsPage</c> reads through — the native analogue of the web <c>useSessions</c> /
/// <c>useRevokeSession</c> / <c>useRevokeAllOtherSessions</c> hook trio. The list fetch resolves either the open-mode
/// signal or the forward-auth list; the two revokes are the destructive, step-up-gated mutations. The view-model is
/// the only consumer; implementations never touch a WinUI type.
/// </summary>
public interface IActiveSessionsFeed
{
    /// <summary>Fetch the sessions list (web <c>useSessions</c> GET /auth/sessions), resolving open-mode vs forward-auth.</summary>
    Task<ActiveSessionsSnapshot> FetchAsync(CancellationToken cancellationToken);

    /// <summary>Revoke a single session by id (web <c>useRevokeSession</c> DELETE /auth/sessions/{id}).</summary>
    Task RevokeAsync(string id, CancellationToken cancellationToken);

    /// <summary>Revoke every other session, returning the revoked count (web <c>useRevokeAllOtherSessions</c>).</summary>
    Task<int> RevokeAllOthersAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The default no-backend sessions feed the parameterless (shell-registered) <see cref="ActiveSessionsPage"/> hosts
/// itself against — the local-state default, mirroring the other W7 pages' empty feeds. The list resolves to a
/// forward-auth snapshot with no rows (driving the friendly empty state) and the two revokes are inert. The
/// generated-client-backed source (<see cref="ActiveSessionsClientFeed"/>) is wired separately from the shared data
/// layer (web's TanStack hooks); this feed keeps the page mountable without a backend.
/// </summary>
public sealed class EmptyActiveSessionsFeed : IActiveSessionsFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyActiveSessionsFeed Instance { get; } = new();

    private EmptyActiveSessionsFeed()
    {
    }

    /// <inheritdoc />
    public Task<ActiveSessionsSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(ActiveSessionsSnapshot.EmptySession);
    }

    /// <inheritdoc />
    public Task RevokeAsync(string id, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(id);
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task<int> RevokeAllOthersAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(0);
    }
}

/// <summary>
/// The generated-client-backed <see cref="IActiveSessionsFeed"/> — the native data adapter for the sessions surface.
/// It binds to the generated OpenAPI contract client (ADR-004): <c>GET /auth/sessions</c> for the list query (web
/// <c>useSessions</c>), <c>DELETE /auth/sessions/{id}</c> for the single revoke (web <c>useRevokeSession</c>) and
/// <c>DELETE /auth/sessions/all-others</c> for the bulk revoke (web <c>useRevokeAllOtherSessions</c>). The 501
/// <c>AUTH_MODE_OPEN</c> response is treated the same way the web hook treats it — as a successful "feature
/// unavailable" signal mapped to <see cref="ActiveSessionsSnapshot.Open"/>, not an error — so the list query never
/// throws for that case. Any other non-success response surfaces as the client's <see cref="ApiException"/> so the
/// view-model can render the failure surface. No HTTP touches the view; the list JSON round-trips through the tolerant
/// <see cref="ActiveSessionsSnapshot"/> parser.
/// </summary>
public sealed class ActiveSessionsClientFeed : IActiveSessionsFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public ActiveSessionsClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<ActiveSessionsSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(ActiveSessionsRegistration.ListOperation);
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ActiveSessionsSnapshot.FromJson(json);
        }
        catch (ApiException ex) when (string.Equals(ex.ErrorCode, ActiveSessionsRegistration.AuthModeOpenCode, StringComparison.Ordinal))
        {
            // Mirror web useSessions: a 501 AUTH_MODE_OPEN is a successful "session tracking unavailable" signal.
            return ActiveSessionsSnapshot.Open;
        }
    }

    /// <inheritdoc />
    public async Task RevokeAsync(string id, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(id);
        var request = ApiRequest.WithPath(ActiveSessionsRegistration.RevokeOperation, "id", id);
        _ = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<int> RevokeAllOthersAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(ActiveSessionsRegistration.RevokeAllOthersOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ReadRevokedCount(json);
    }

    private static int ReadRevokedCount(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("revoked", out var revoked) &&
            revoked.ValueKind == JsonValueKind.Number &&
            revoked.TryGetInt32(out var count))
        {
            return count;
        }

        return 0;
    }
}
