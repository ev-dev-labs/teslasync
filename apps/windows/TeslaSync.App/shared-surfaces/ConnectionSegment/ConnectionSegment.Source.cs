using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Headers;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The API-connection seam the <c>ConnectionSegment</c> surface binds through (P1/S8 state-holder layer) — the
/// native analogue of the web <c>useApiHealth()</c> hook the web <c>&lt;ConnectionSegment&gt;</c> consumes
/// (web/src/api/hooks/useApiHealth.ts). It exposes the current <see cref="ApiHealthSnapshot"/> (the web
/// <c>{ status, latencyMs, lastCheckedAt }</c> return) and raises <see cref="Changed"/> whenever a fresh probe
/// moves the health, so the bound <see cref="ConnectionSegmentViewModel"/> re-projects without polling itself —
/// exactly as the web hook re-renders its consumers off the <c>useQuery</c> refetch loop. The view never issues
/// HTTP itself; it observes this seam. The production binding is <see cref="PollingConnectionSegmentSource"/> over
/// an <see cref="IApiHealthProbe"/>; <see cref="StaticConnectionSegmentSource"/> stands in for headless hosts,
/// previews and unit tests.
/// </summary>
public interface IConnectionSegmentSource
{
    /// <summary>The current API-connection read (web <c>useApiHealth()</c> return).</summary>
    ApiHealthSnapshot Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="IConnectionSegmentSource"/> with an explicit, caller-set snapshot — the headless / preview /
/// unit-test default. It lets the projection and view-model be exercised for every health state without a probe
/// loop or a UI host. Call <see cref="Set"/> to move the snapshot, raising <see cref="Changed"/> (the web hook
/// re-resolving as a new probe completes).
/// </summary>
public sealed class StaticConnectionSegmentSource : IConnectionSegmentSource
{
    private ApiHealthSnapshot _current;

    /// <summary>Creates a source over an initial snapshot (defaults to <see cref="ApiHealthSnapshot.Unknown"/>).</summary>
    /// <param name="current">The initial API-connection read.</param>
    public StaticConnectionSegmentSource(ApiHealthSnapshot? current = null)
    {
        _current = current ?? ApiHealthSnapshot.Unknown;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public ApiHealthSnapshot Current => _current;

    /// <summary>Move the snapshot and raise <see cref="Changed"/> (the web hook re-resolving).</summary>
    /// <param name="snapshot">The new API-connection read.</param>
    public void Set(ApiHealthSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        _current = snapshot;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The single <c>/healthz</c> probe seam — the native analogue of the web <c>probe()</c> closure
/// (web/src/api/hooks/useApiHealth.ts L43-L77). It performs one round-trip and returns a raw
/// <see cref="ApiHealthProbeResult"/> (ok + measured latency + completion time); the bucketing into
/// ok / degraded / offline is the caller's (via <see cref="ApiHealthSnapshot.FromProbe"/>). Decoupling the probe
/// from the poll loop lets <see cref="PollingConnectionSegmentSource"/> be unit-tested deterministically with a
/// fake probe — no socket required. The production binding is <see cref="HttpApiHealthProbe"/>.
/// </summary>
public interface IApiHealthProbe
{
    /// <summary>Perform one <c>/healthz</c> round-trip and return its raw outcome.</summary>
    /// <param name="cancellationToken">Cancels the probe (e.g. the surface is torn down).</param>
    /// <returns>The raw probe outcome (web <c>ProbeResult</c>).</returns>
    Task<ApiHealthProbeResult> ProbeAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The production <see cref="IApiHealthProbe"/> — a 1:1 port of the web <c>probe()</c>
/// (web/src/api/hooks/useApiHealth.ts L43-L77). It issues a cache-bypassing <c>GET</c> against the root
/// <c>/healthz</c> endpoint (which lives at the API root, NOT under <c>/api/v1</c>, so it is reached directly off
/// the base address rather than the versioned client), measures the round-trip with a <see cref="Stopwatch"/>,
/// and bounds the attempt with the shared <see cref="ConnectionSegmentRegistration.ProbeTimeoutMs"/> deadline.
/// A non-2xx response, a network error or the timeout all resolve to <c>ok = false</c> (the web catch / non-ok
/// path); only an upstream (caller) cancellation propagates. WinUI-free so it is unit-tested against a fake
/// <see cref="HttpMessageHandler"/> without a UI host.
/// </summary>
public sealed class HttpApiHealthProbe : IApiHealthProbe
{
    private readonly HttpClient _http;
    private readonly Uri _healthEndpoint;
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>Creates the probe over the shared HTTP client and the API base address.</summary>
    /// <param name="http">The shared <see cref="HttpClient"/> (carries the app's handlers / cookies).</param>
    /// <param name="baseAddress">The API root the unversioned <c>/healthz</c> endpoint hangs off (web <c>getApiBase()</c>).</param>
    /// <param name="clock">The clock the completion timestamp is read from; defaults to <see cref="DateTimeOffset.Now"/>.</param>
    public HttpApiHealthProbe(HttpClient http, Uri baseAddress, Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(baseAddress);
        _http = http;
        _healthEndpoint = new Uri(baseAddress, "/healthz");
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    /// <inheritdoc />
    public async Task<ApiHealthProbeResult> ProbeAsync(CancellationToken cancellationToken = default)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(TimeSpan.FromMilliseconds(ConnectionSegmentRegistration.ProbeTimeoutMs));

        var stopwatch = Stopwatch.StartNew();
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, _healthEndpoint);

            // web: cache: 'no-store' — never let a cached 200 hide an actual outage.
            request.Headers.CacheControl = new CacheControlHeaderValue { NoStore = true, NoCache = true };

            using HttpResponseMessage response = await _http
                .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeoutCts.Token)
                .ConfigureAwait(false);

            stopwatch.Stop();
            return new ApiHealthProbeResult(response.IsSuccessStatusCode, Elapsed(stopwatch), _clock());
        }
        catch (HttpRequestException)
        {
            // web catch: a network/protocol error is offline.
            stopwatch.Stop();
            return new ApiHealthProbeResult(false, Elapsed(stopwatch), _clock());
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // Our own 5 s deadline fired (not an upstream cancel) — web treats no-response-within-timeout as offline.
            stopwatch.Stop();
            return new ApiHealthProbeResult(false, Elapsed(stopwatch), _clock());
        }
    }

    private static int Elapsed(Stopwatch stopwatch) =>
        (int)Math.Min(stopwatch.ElapsedMilliseconds, int.MaxValue);
}

/// <summary>
/// The production <see cref="IConnectionSegmentSource"/> — the native analogue of the web <c>useApiHealth()</c>
/// hook's <c>useQuery</c> refetch loop (web/src/api/hooks/useApiHealth.ts L85-L93). It drives an
/// <see cref="IApiHealthProbe"/> on a fixed cadence (the shared
/// <see cref="ConnectionSegmentRegistration.PollIntervalMs"/>, 15&#160;s), projecting each raw result through
/// <see cref="ApiHealthSnapshot.FromProbe"/> and surfacing it via <see cref="Current"/> / <see cref="Changed"/>.
/// The loop is started explicitly with <see cref="Start"/> (so headless hosts and tests can construct it without
/// opening a socket) and stopped by <see cref="Dispose"/>; <see cref="ProbeOnceAsync"/> runs a single iteration
/// for deterministic unit tests. The probe runs on a background loop, so the snapshot is guarded by a lock; the
/// view marshals the <see cref="Changed"/> notification onto the UI thread. WinUI-free.
/// </summary>
public sealed class PollingConnectionSegmentSource : IConnectionSegmentSource, IDisposable
{
    private readonly IApiHealthProbe _probe;
    private readonly TimeSpan _interval;
    private readonly object _gate = new();
    private readonly CancellationTokenSource _cts = new();
    private ApiHealthSnapshot _current = ApiHealthSnapshot.Unknown;
    private Task? _loop;
    private bool _disposed;

    /// <summary>Creates the source over the probe seam and an optional poll interval.</summary>
    /// <param name="probe">The single-probe seam (web <c>probe()</c>).</param>
    /// <param name="interval">The poll cadence; defaults to <see cref="ConnectionSegmentRegistration.PollIntervalMs"/>.</param>
    public PollingConnectionSegmentSource(IApiHealthProbe probe, TimeSpan? interval = null)
    {
        ArgumentNullException.ThrowIfNull(probe);
        _probe = probe;
        _interval = interval ?? TimeSpan.FromMilliseconds(ConnectionSegmentRegistration.PollIntervalMs);
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public ApiHealthSnapshot Current
    {
        get
        {
            lock (_gate)
            {
                return _current;
            }
        }
    }

    /// <summary>
    /// Start the background poll loop — an immediate first probe followed by one probe every
    /// <see cref="ConnectionSegmentRegistration.PollIntervalMs"/> (the web <c>refetchInterval</c>). Idempotent;
    /// a second call is a no-op. The composition root calls this once the surface is shown.
    /// </summary>
    public void Start()
    {
        lock (_gate)
        {
            if (_disposed || _loop is not null)
            {
                return;
            }

            _loop = RunAsync(_cts.Token);
        }
    }

    /// <summary>
    /// Run a single probe and fold its result into <see cref="Current"/>, raising <see cref="Changed"/> when the
    /// snapshot moves — the web hook's per-refetch update. Exposed for deterministic unit tests; the background
    /// loop calls the same method.
    /// </summary>
    /// <param name="cancellationToken">Cancels the probe.</param>
    /// <returns>The snapshot after the probe is folded in.</returns>
    public async Task<ApiHealthSnapshot> ProbeOnceAsync(CancellationToken cancellationToken = default)
    {
        var result = await _probe.ProbeAsync(cancellationToken).ConfigureAwait(false);
        var next = ApiHealthSnapshot.FromProbe(result);

        bool changed;
        lock (_gate)
        {
            changed = _current != next;
            _current = next;
        }

        if (changed)
        {
            Changed?.Invoke(this, EventArgs.Empty);
        }

        return next;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
        }

        _cts.Cancel();
        _cts.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        try
        {
            // web: the query fires immediately on mount, then on the refetch interval.
            await ProbeOnceAsync(cancellationToken).ConfigureAwait(false);

            using var timer = new PeriodicTimer(_interval);
            while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
            {
                await ProbeOnceAsync(cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // Stopped via Dispose — expected, end the loop quietly.
        }
    }
}
