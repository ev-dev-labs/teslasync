using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Explore;

/// <summary>
/// The read seam the <see cref="ExplorePageViewModel"/> binds to (P1/S8 state-holder layer) — the native port of the
/// <c>ExplorePage</c>'s two gating data sources (web/src/features/explore/pages/ExplorePage.tsx): the
/// <c>useVehicles → GET /vehicles</c> fleet read whose <em>count</em> gates the <c>minVehicles</c> entries, and the
/// <c>useIsForwardAuth → GET /system/auth-mode</c> read that gates the <c>requiresAuth</c> entries. The catalogue
/// itself is built locally from the shared navigation registry; these reads only decide which entries are surfaced,
/// so — like the web page — a failed read degrades to the unauthenticated / no-vehicle view rather than an error.
/// The view never performs HTTP; the contract-client-backed <see cref="ExploreClientFeed"/> (or a test fake) drives this.
/// </summary>
public interface IExploreFeed
{
    /// <summary>Fetch the linked-vehicle count gating the catalogue (web <c>useVehicles().length</c>).</summary>
    /// <param name="cancellationToken">Cancels the read.</param>
    Task<int> FetchVehicleCountAsync(CancellationToken cancellationToken);

    /// <summary>Fetch whether the deployment runs behind ForwardAuth (web <c>useIsForwardAuth()</c>).</summary>
    /// <param name="cancellationToken">Cancels the read.</param>
    Task<bool> FetchIsForwardAuthAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The default feed — resolves to a zero-vehicle, open-mode deployment (no HTTP). The shell registers the page over
/// this safe default so an unbound page renders the full open-mode catalogue (every entry that does not require a
/// vehicle or ForwardAuth), exactly as the web page renders before its gating queries resolve.
/// </summary>
public sealed class EmptyExploreFeed : IExploreFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyExploreFeed Instance { get; } = new();

    private EmptyExploreFeed()
    {
    }

    /// <inheritdoc />
    public Task<int> FetchVehicleCountAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(0);
    }

    /// <inheritdoc />
    public Task<bool> FetchIsForwardAuthAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(false);
    }
}

/// <summary>
/// The generated-client-backed <see cref="IExploreFeed"/> — the native data adapter for the Explore page's two gating
/// reads (ADR-004). It binds <c>GET /vehicles</c> (web <c>useVehicles</c>; the response array length is the gating
/// count) and <c>GET /system/auth-mode</c> (web <c>useIsForwardAuth</c>; <c>mode === 'forward_auth'</c>) to the
/// generated OpenAPI contract client, which versions each path exactly once (never a double <c>/api/v1</c> prefix).
/// Both reads are tolerant: a failure surfaces as the client's exception for the view-model to swallow into the safe
/// open-mode default, mirroring the web page treating an unresolved gating query as "no vehicles / open mode".
/// </summary>
public sealed class ExploreClientFeed : IExploreFeed
{
    private const string ForwardAuthWire = "forward_auth";

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public ExploreClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<int> FetchVehicleCountAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(ExploreRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return json.ValueKind == JsonValueKind.Array ? json.GetArrayLength() : 0;
    }

    /// <inheritdoc />
    public async Task<bool> FetchIsForwardAuthAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(ExploreRegistration.AuthModeOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ParseIsForwardAuth(json);
    }

    /// <summary>
    /// Read the deployment auth mode from a <c>GET /system/auth-mode</c> body (web <c>data.mode === 'forward_auth'</c>),
    /// tolerating the <c>mode</c> and legacy <c>auth_mode</c> keys; any other shape is treated as open mode.
    /// </summary>
    /// <param name="element">The JSON body.</param>
    public static bool ParseIsForwardAuth(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        string? mode = ReadString(element, "mode") ?? ReadString(element, "auth_mode");
        return string.Equals(mode, ForwardAuthWire, StringComparison.Ordinal);
    }

    private static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}

/// <summary>
/// The recently-visited registry seam the <see cref="ExplorePageViewModel"/> reads (P1/S8) — the native analogue of
/// the web <c>getRecentPages</c> / <c>subscribeRecentPages</c> store the page subscribes to
/// (web/src/features/explore/pages/ExplorePage.tsx, web/src/lib/recentPages.ts). It exposes the recently-visited
/// route paths (newest-first) and raises <see cref="Changed"/> when the list moves, so the recently-visited strip
/// stays live. The view never touches storage; the composition root binds a durable implementation and a test uses
/// <see cref="StaticExploreRecentSource"/>.
/// </summary>
public interface IExploreRecentSource
{
    /// <summary>The recently-visited route paths, newest-first (web <c>getRecentPages</c>).</summary>
    IReadOnlyList<string> RecentPaths { get; }

    /// <summary>Raised whenever <see cref="RecentPaths"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="IExploreRecentSource"/> with an explicit, caller-set list — the headless / unit-test default and the
/// safe default an unbound page binds to (it starts empty, so the recently-visited strip is simply absent until a
/// real registry is wired). The composition root's recent-pages store (or a test) calls <see cref="Set"/> as the
/// history changes, raising <see cref="Changed"/> so the page reprojects.
/// </summary>
public sealed class StaticExploreRecentSource : IExploreRecentSource
{
    private IReadOnlyList<string> _recentPaths;

    /// <summary>Creates a source starting empty.</summary>
    public StaticExploreRecentSource()
        : this(Array.Empty<string>())
    {
    }

    /// <summary>Creates a source over an initial recent list.</summary>
    /// <param name="recentPaths">The initial recently-visited route paths, newest-first.</param>
    public StaticExploreRecentSource(IReadOnlyList<string> recentPaths)
    {
        ArgumentNullException.ThrowIfNull(recentPaths);
        _recentPaths = recentPaths;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public IReadOnlyList<string> RecentPaths => _recentPaths;

    /// <summary>Move the recent list and raise <see cref="Changed"/>.</summary>
    /// <param name="recentPaths">The new recently-visited route paths, newest-first.</param>
    public void Set(IReadOnlyList<string> recentPaths)
    {
        ArgumentNullException.ThrowIfNull(recentPaths);
        _recentPaths = recentPaths;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>The shared empty recent source — never lists a recently-visited destination.</summary>
public sealed class EmptyExploreRecentSource : IExploreRecentSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyExploreRecentSource Instance { get; } = new();

    private EmptyExploreRecentSource()
    {
    }

    /// <inheritdoc />
    public event EventHandler? Changed
    {
        add { }
        remove { }
    }

    /// <inheritdoc />
    public IReadOnlyList<string> RecentPaths => Array.Empty<string>();
}
