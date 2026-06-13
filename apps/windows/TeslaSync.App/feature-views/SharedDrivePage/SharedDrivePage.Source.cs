using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Sharing;

/// <summary>
/// The data port the <see cref="SharedDrivePageViewModel"/> reads through — the native parity of the web page's
/// single hook (web/src/api/hooks/useSharing.ts <c>useSharedDrive</c> → the public <c>GET /share/{token}</c>
/// read). The view never performs HTTP itself; the default <see cref="EmptySharedDrivePageFeed"/> resolves to the
/// unavailable state and the generated-client-backed <see cref="SharedDrivePageClientFeed"/> binds the OpenAPI
/// contract client (ADR-004). A failing read throws so the view-model can surface the never-blank expired view.
/// </summary>
public interface ISharedDrivePageFeed
{
    /// <summary>Resolve the shared-drive snapshot for a public token (web's <c>useSharedDrive</c>).</summary>
    Task<SharedDriveSnapshot> FetchAsync(string token, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to the empty snapshot (the loading/unavailable state the shell shows by default).</summary>
public sealed class EmptySharedDrivePageFeed : ISharedDrivePageFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptySharedDrivePageFeed Instance { get; } = new();

    private EmptySharedDrivePageFeed()
    {
    }

    /// <inheritdoc />
    public Task<SharedDriveSnapshot> FetchAsync(string token, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(SharedDriveSnapshot.Empty);
    }
}

/// <summary>
/// The generated-client-backed <see cref="ISharedDrivePageFeed"/> — the native data adapter for the public
/// shared-drive report (ADR-004). It binds to the generated OpenAPI contract client for the single read the web
/// page performs (<see cref="SharedDrivePageRegistration.ShareOperation"/> → <c>GET /share/{token}</c>, the
/// endpoint mounted before auth so no session is required). The response round-trips through the tolerant
/// <see cref="SharedDriveData"/> parser so both the SI v2 envelope and the legacy v1 envelope are normalized
/// losslessly to SI; an empty/expired token short-circuits to the unavailable snapshot and a transport failure
/// propagates so the view-model can render the expired view. No HTTP touches the view.
/// </summary>
public sealed class SharedDrivePageClientFeed : ISharedDrivePageFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public SharedDrivePageClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<SharedDriveSnapshot> FetchAsync(string token, CancellationToken cancellationToken)
    {
        // web `useSharedDrive` is `enabled: !!token` — an empty token never fetches (the idle/unavailable state).
        if (string.IsNullOrEmpty(token))
        {
            return SharedDriveSnapshot.Empty;
        }

        var request = ApiRequest.WithPath(SharedDrivePageRegistration.ShareOperation, SharedDrivePageRegistration.TokenParam, token);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return new SharedDriveSnapshot(SharedDriveData.FromJson(json));
    }
}
