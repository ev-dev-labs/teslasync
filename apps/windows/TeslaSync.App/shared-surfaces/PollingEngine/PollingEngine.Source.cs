using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The data port the <see cref="PollingEngineViewModel"/> binds to (P1/S8 state-holder seam). It exposes the two
/// independent cache-then-network reads the web component composes — the adaptive-polling-engine status
/// (web <c>useQuery(getPollingStatus)</c> → <c>GET /polling/status</c>, refetched every 15 s) and the cost / savings
/// snapshot (web <c>useQuery(getPollingSavings)</c> → <c>GET /polling/savings</c>, refetched every 30 s). The view
/// never performs HTTP itself; the concrete <see cref="PollingEngineSource"/> (or a test fake) drives this.
/// </summary>
public interface IPollingEngineSource
{
    /// <summary>Stream the cache-then-network polling-engine-status snapshots, cached first.</summary>
    /// <param name="cancellationToken">Cancels the read.</param>
    /// <returns>The cache-then-network sequence of raw status emissions.</returns>
    IAsyncEnumerable<RepositoryResult<PollingStatusSnapshot>> StreamStatusAsync(
        CancellationToken cancellationToken = default);

    /// <summary>Stream the cache-then-network savings snapshots, cached first.</summary>
    /// <param name="cancellationToken">Cancels the read.</param>
    /// <returns>The cache-then-network sequence of raw savings emissions.</returns>
    IAsyncEnumerable<RepositoryResult<PollingSavings>> StreamSavingsAsync(
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IPollingEngineSource"/> — the native data adapter for the PollingEngine surface.
/// It runs two independent cache-then-network reads through the shared <see cref="CacheThenNetworkEngine"/>, caching
/// the raw JSON so the snake_case wire shape round-trips losslessly, then maps each emission to a typed snapshot via
/// <see cref="PollingEngineResultMapper"/>. Both <c>/polling/*</c> routes post-date — and are intentionally absent
/// from — the OpenAPI contract, so they are reached the same way the Live (SSE) and Push subsystems reach their
/// non-contract routes: through the shared <see cref="HttpClient"/> whose pipeline already carries the auth +
/// resilience handlers. No HTTP touches the view.
/// </summary>
public sealed class PollingEngineSource : IPollingEngineSource
{
    private const string StatusCacheKey = "polling-engine:status";
    private const string SavingsCacheKey = "polling-engine:savings";

    private readonly HttpClient _http;
    private readonly CacheThenNetworkEngine _engine;
    private readonly ApiClientOptions _options;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the shared HTTP pipeline, cache-then-network engine and API options.</summary>
    /// <param name="http">The shared, authenticated <see cref="HttpClient"/> (carries auth + resilience handlers).</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API options (base address, version segment, JSON settings).</param>
    public PollingEngineSource(HttpClient http, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _http = http;
        _engine = engine;
        _options = options;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<PollingStatusSnapshot>> StreamStatusAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            StatusCacheKey,
            ct => FetchAsync(PollingEngineRegistration.StatusPath, ct),
            IsAbsentBody,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (RepositoryResult<JsonElement> emission in raw.ConfigureAwait(false))
        {
            yield return PollingEngineResultMapper.MapStatus(emission);
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<PollingSavings>> StreamSavingsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            SavingsCacheKey,
            ct => FetchAsync(PollingEngineRegistration.SavingsPath, ct),
            IsAbsentBody,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (RepositoryResult<JsonElement> emission in raw.ConfigureAwait(false))
        {
            yield return PollingEngineResultMapper.MapSavings(emission);
        }
    }

    private async Task<JsonElement> FetchAsync(string path, CancellationToken cancellationToken)
    {
        // Version the route exactly once (no double prefix), then resolve it against the client base address.
        string versioned = _options.VersionBasePath.TrimEnd('/') + "/" + path;
        var uri = new Uri(_http.BaseAddress ?? _options.BaseAddress, versioned);

        using HttpResponseMessage response = await _http
            .GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
            .ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        await using Stream stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        return await JsonSerializer.DeserializeAsync<JsonElement>(stream, _json, cancellationToken).ConfigureAwait(false);
    }

    // Only a null/undefined body carries no data; a disabled engine or a zero-vehicle snapshot is a meaningful,
    // renderable object that must NOT collapse to the empty state (the view-model derives Disabled/Empty itself).
    private static bool IsAbsentBody(JsonElement element) =>
        element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;
}

/// <summary>
/// An in-memory <see cref="IPollingEngineSource"/> for headless tests and isolated hosts. It replays the configured
/// status and savings emission sequences (cached-then-network ordering is the caller's to arrange) without opening a
/// socket, so every view-model transition is asserted deterministically.
/// </summary>
public sealed class InMemoryPollingEngineSource : IPollingEngineSource
{
    private readonly IReadOnlyList<RepositoryResult<PollingStatusSnapshot>> _status;
    private readonly IReadOnlyList<RepositoryResult<PollingSavings>> _savings;

    /// <summary>Creates the fake over the status and savings emission sequences to replay.</summary>
    /// <param name="status">The status emissions, in arrival order.</param>
    /// <param name="savings">The savings emissions, in arrival order (empty replays nothing).</param>
    public InMemoryPollingEngineSource(
        IEnumerable<RepositoryResult<PollingStatusSnapshot>> status,
        IEnumerable<RepositoryResult<PollingSavings>>? savings = null)
    {
        ArgumentNullException.ThrowIfNull(status);
        _status = new List<RepositoryResult<PollingStatusSnapshot>>(status);
        _savings = savings is null
            ? Array.Empty<RepositoryResult<PollingSavings>>()
            : new List<RepositoryResult<PollingSavings>>(savings);
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<PollingStatusSnapshot>> StreamStatusAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        foreach (RepositoryResult<PollingStatusSnapshot> emission in _status)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return emission;
            await Task.Yield();
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<PollingSavings>> StreamSavingsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        foreach (RepositoryResult<PollingSavings> emission in _savings)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return emission;
            await Task.Yield();
        }
    }
}
