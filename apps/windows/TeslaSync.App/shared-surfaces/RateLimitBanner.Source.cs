namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// A resilience signal raised toward the banner — the native analogue of the <c>detail</c> payload on the web
/// <c>teslasync:rate-limited</c> / <c>teslasync:upstream-down</c> <c>CustomEvent</c>s
/// (web/src/components/feedback/RateLimitBanner.tsx L58-79). Carries the triggering <see cref="Kind"/>, the API
/// <see cref="Scope"/> (rate-limit) or <see cref="Upstream"/> name (breaker), and the <see cref="RetryAfterSeconds"/>
/// window the cooldown runs for.
/// </summary>
public sealed class RateLimitSignalEventArgs : EventArgs
{
    /// <summary>Creates the payload over the kind, optional scope/upstream and retry-after window.</summary>
    /// <param name="kind">Which resilience condition raised the banner.</param>
    /// <param name="scope">The rate-limited API path scope (web <c>detail.scope</c>), or null for an upstream trip.</param>
    /// <param name="upstream">The tripped upstream name (web <c>detail.upstream</c>), or null for a rate-limit.</param>
    /// <param name="retryAfterSeconds">The retry-after window in seconds (web <c>detail.retryAfterSec</c>).</param>
    public RateLimitSignalEventArgs(RateLimitKind kind, string? scope, string? upstream, double retryAfterSeconds)
    {
        Kind = kind;
        Scope = scope;
        Upstream = upstream;
        RetryAfterSeconds = retryAfterSeconds;
    }

    /// <summary>Which resilience condition raised the banner.</summary>
    public RateLimitKind Kind { get; }

    /// <summary>The rate-limited API path scope (web <c>detail.scope</c>), or null for an upstream trip.</summary>
    public string? Scope { get; }

    /// <summary>The tripped upstream name (web <c>detail.upstream</c>), or null for a rate-limit.</summary>
    public string? Upstream { get; }

    /// <summary>The retry-after window in seconds (web <c>detail.retryAfterSec</c>).</summary>
    public double RetryAfterSeconds { get; }
}

/// <summary>
/// The resilience-signal seam the <c>RateLimitBanner</c> binds through (P1/S8) — the native analogue of the two
/// document-level <c>CustomEvent</c>s the web <c>resilientFetch</c> dispatches and the banner listens for
/// (web/src/components/feedback/RateLimitBanner.tsx L57-86): a 429 <c>teslasync:rate-limited</c> and a 503
/// <c>UPSTREAM_BREAKER_OPEN</c> <c>teslasync:upstream-down</c>, each carrying a scope/upstream and a retry-after
/// window. The view never subscribes to a transport or a window event itself — it binds to this seam, which the
/// data layer (W5 resilience handler) publishes into. The production binding is
/// <see cref="DelegatedRateLimitSignalSource"/>; <see cref="InMemoryRateLimitSignalSource"/> stands in for headless
/// hosts and unit tests.
/// </summary>
public interface IRateLimitSignalSource
{
    /// <summary>Raised when a rate-limit or upstream-breaker signal arrives; may be raised from a background thread.</summary>
    event EventHandler<RateLimitSignalEventArgs>? SignalReceived;
}

/// <summary>
/// An <see cref="IRateLimitSignalSource"/> driven by explicit caller-raised signals — the headless / unit-test
/// default. <see cref="RaiseRateLimited"/> fires the web <c>teslasync:rate-limited</c> 429 event and
/// <see cref="RaiseUpstreamDown"/> the web <c>teslasync:upstream-down</c> 503 breaker event, so the banner can be
/// exercised across both shapes (and the re-arm flow) without a transport. <see cref="SignalCount"/> records how
/// many signals were raised for assertions.
/// </summary>
public sealed class InMemoryRateLimitSignalSource : IRateLimitSignalSource
{
    /// <inheritdoc />
    public event EventHandler<RateLimitSignalEventArgs>? SignalReceived;

    /// <summary>Number of signals raised through this source (for assertions).</summary>
    public int SignalCount { get; private set; }

    /// <summary>Raise a rate-limit (429) signal for an API scope (the web <c>teslasync:rate-limited</c> event).</summary>
    public void RaiseRateLimited(string? scope, double retryAfterSeconds) =>
        Raise(new RateLimitSignalEventArgs(RateLimitKind.RateLimited, scope, null, retryAfterSeconds));

    /// <summary>Raise an upstream-breaker (503) signal for an upstream (the web <c>teslasync:upstream-down</c> event).</summary>
    public void RaiseUpstreamDown(string? upstream, double retryAfterSeconds) =>
        Raise(new RateLimitSignalEventArgs(RateLimitKind.UpstreamDown, null, upstream, retryAfterSeconds));

    private void Raise(RateLimitSignalEventArgs args)
    {
        SignalCount++;
        SignalReceived?.Invoke(this, args);
    }
}

/// <summary>
/// The production <see cref="IRateLimitSignalSource"/> — the seam the composition root publishes into when the
/// W5 resilience handler observes a 429 response or an open upstream breaker, the native analogue of
/// <c>resilientFetch</c> dispatching the document events (web/src/components/feedback/RateLimitBanner.tsx L10-18).
/// <see cref="PublishRateLimited"/> / <see cref="PublishUpstreamDown"/> fan a signal out to the bound banner.
/// WinUI-free (it holds only an event) so it is unit-tested directly.
/// </summary>
public sealed class DelegatedRateLimitSignalSource : IRateLimitSignalSource
{
    /// <inheritdoc />
    public event EventHandler<RateLimitSignalEventArgs>? SignalReceived;

    /// <summary>Publish a rate-limit (429) signal for an API scope (the web <c>teslasync:rate-limited</c> dispatch).</summary>
    public void PublishRateLimited(string? scope, double retryAfterSeconds) =>
        SignalReceived?.Invoke(this, new RateLimitSignalEventArgs(RateLimitKind.RateLimited, scope, null, retryAfterSeconds));

    /// <summary>Publish an upstream-breaker (503) signal for an upstream (the web <c>teslasync:upstream-down</c> dispatch).</summary>
    public void PublishUpstreamDown(string? upstream, double retryAfterSeconds) =>
        SignalReceived?.Invoke(this, new RateLimitSignalEventArgs(RateLimitKind.UpstreamDown, null, upstream, retryAfterSeconds));
}

/// <summary>
/// The query-invalidation seam the <c>RateLimitBanner</c> binds through (P1/S8) — the native analogue of the web
/// <c>useQueryClient()</c> the banner reaches for in <c>handleRetry</c> to call <c>invalidateQueries()</c>
/// (web/src/components/feedback/RateLimitBanner.tsx L52, L108-111). Invalidating every cached query forces all
/// pages to refetch from scratch once the cooldown clears. The production binding is
/// <see cref="DelegatedQueryInvalidator"/> over the W5 cache; <see cref="CountingQueryInvalidator"/> stands in for
/// headless hosts and unit tests.
/// </summary>
public interface IQueryInvalidator
{
    /// <summary>Invalidate every cached query so pages refetch (web <c>queryClient.invalidateQueries()</c>).</summary>
    void InvalidateAll();
}

/// <summary>
/// An <see cref="IQueryInvalidator"/> that simply counts invalidations — the headless / unit-test default. It lets
/// the retry flow be asserted (the banner invalidated exactly once on retry, never on dismiss) without a real
/// query cache.
/// </summary>
public sealed class CountingQueryInvalidator : IQueryInvalidator
{
    /// <summary>Number of times <see cref="InvalidateAll"/> was called (for assertions).</summary>
    public int InvalidateCount { get; private set; }

    /// <inheritdoc />
    public void InvalidateAll() => InvalidateCount++;
}

/// <summary>
/// The production <see cref="IQueryInvalidator"/> — adapts a host-supplied invalidation action (bound to the W5
/// query cache's invalidate-all entry point) into the seam, the native analogue of
/// <c>queryClient.invalidateQueries()</c>. WinUI-free (it holds only a delegate) so it is unit-tested against an
/// in-memory closure.
/// </summary>
public sealed class DelegatedQueryInvalidator : IQueryInvalidator
{
    private readonly Action _invalidate;

    /// <summary>Creates the invalidator over the host's invalidate-all action.</summary>
    /// <param name="invalidate">Invalidates every cached query (web <c>queryClient.invalidateQueries()</c>).</param>
    public DelegatedQueryInvalidator(Action invalidate)
    {
        ArgumentNullException.ThrowIfNull(invalidate);
        _invalidate = invalidate;
    }

    /// <inheritdoc />
    public void InvalidateAll() => _invalidate();
}
