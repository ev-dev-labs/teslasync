using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Maps;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The live-position state-holder seam the <c>AnimatedMarker</c> surface binds through (P1/S8) — the native
/// analogue of the <c>position</c> / <c>heading</c> / <c>color</c> stream the web component re-renders from
/// (web/src/components/maps/AnimatedMarker.tsx). It exposes the current <see cref="LoadState{T}"/> of the marker
/// fix and raises <see cref="Changed"/> whenever that fix moves, so the view never reads a query or performs HTTP
/// itself. The production binding is <see cref="RepositoryAnimatedMarkerSource{T}"/> over a cache-then-network
/// repository stream; <see cref="StaticAnimatedMarkerSource"/> stands in for headless hosts and unit tests.
/// </summary>
public interface IAnimatedMarkerSource
{
    /// <summary>The current marker-fix load state (live / stale / offline / loading / empty / error).</summary>
    LoadState<AnimatedMarkerSample> Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;

    /// <summary>Re-attempt the fix after a failure (the error-state retry affordance).</summary>
    void Retry();
}

/// <summary>
/// An <see cref="IAnimatedMarkerSource"/> with an explicit, caller-set load state — the headless / unit-test
/// default. It lets the projection and view-model be exercised for every state (loading, empty, error, stale,
/// offline, live) without a repository or a UI host. Call <see cref="Set"/> to move the fix (raising
/// <see cref="Changed"/>); <see cref="Retry"/> increments <see cref="RetryCount"/> and re-raises
/// <see cref="Changed"/> so the retry path is observable in tests.
/// </summary>
public sealed class StaticAnimatedMarkerSource : IAnimatedMarkerSource
{
    private LoadState<AnimatedMarkerSample> _current;

    /// <summary>Creates a source over an initial load state (defaults to the first-load <c>Loading</c> state).</summary>
    /// <param name="current">The initial load state.</param>
    public StaticAnimatedMarkerSource(LoadState<AnimatedMarkerSample>? current = null) =>
        _current = current ?? new LoadState<AnimatedMarkerSample>.Loading();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public LoadState<AnimatedMarkerSample> Current => _current;

    /// <summary>Number of times <see cref="Retry"/> has been invoked (for test assertions).</summary>
    public int RetryCount { get; private set; }

    /// <summary>Move the fix to a new load state and raise <see cref="Changed"/>.</summary>
    /// <param name="state">The new load state.</param>
    public void Set(LoadState<AnimatedMarkerSample> state)
    {
        ArgumentNullException.ThrowIfNull(state);
        _current = state;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public void Retry()
    {
        RetryCount++;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The production <see cref="IAnimatedMarkerSource"/> — binds the marker to a cache-then-network repository
/// stream of a domain read-model, the native wiring for "stream the live vehicle position into the marker". The
/// composition root supplies a stream factory (e.g.
/// <c>ct =&gt; positionRepository.WatchAsync(vehicleId, ct)</c>) and selectors that pull the fix, optional
/// heading and optional tint out of each value; each <see cref="RepositoryResult{T}"/> emission is mapped to a
/// marker fix via <see cref="AnimatedMarkerSample.FromRepositoryResult{T}"/>, projected to the richer
/// <see cref="LoadState{T}"/> union and surfaced through <see cref="Current"/> / <see cref="Changed"/>. A
/// monotonic generation guard discards emissions from a superseded run, and <see cref="Retry"/> restarts the
/// stream. WinUI-free so it is unit-tested against an in-memory stream without a UI host.
/// </summary>
/// <typeparam name="T">The repository's domain read-model type whose value carries the fix.</typeparam>
public sealed class RepositoryAnimatedMarkerSource<T> : IAnimatedMarkerSource, IDisposable
{
    private readonly Func<CancellationToken, IAsyncEnumerable<RepositoryResult<T>>> _stream;
    private readonly Func<T, GeoPoint> _selectPosition;
    private readonly Func<T, double?>? _selectHeading;
    private readonly Func<T, string?>? _selectAccentBrushKey;
    private readonly object _gate = new();
    private CancellationTokenSource _lifetime = new();
    private LoadState<AnimatedMarkerSample> _current = new LoadState<AnimatedMarkerSample>.Loading();
    private int _generation;
    private bool _disposed;

    /// <summary>Creates the source over a repository stream factory and the fix/heading/tint selectors.</summary>
    /// <param name="stream">The cache-then-network stream factory (web query function).</param>
    /// <param name="selectPosition">Selector that pulls the fix out of the latest value.</param>
    /// <param name="selectHeading">Optional selector that pulls the heading (degrees) out of the latest value.</param>
    /// <param name="selectAccentBrushKey">Optional selector that pulls the tint token key out of the latest value.</param>
    /// <param name="autoStart">Whether to begin the first stream immediately (defaults to true).</param>
    public RepositoryAnimatedMarkerSource(
        Func<CancellationToken, IAsyncEnumerable<RepositoryResult<T>>> stream,
        Func<T, GeoPoint> selectPosition,
        Func<T, double?>? selectHeading = null,
        Func<T, string?>? selectAccentBrushKey = null,
        bool autoStart = true)
    {
        ArgumentNullException.ThrowIfNull(stream);
        ArgumentNullException.ThrowIfNull(selectPosition);
        _stream = stream;
        _selectPosition = selectPosition;
        _selectHeading = selectHeading;
        _selectAccentBrushKey = selectAccentBrushKey;

        if (autoStart)
        {
            Start();
        }
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public LoadState<AnimatedMarkerSample> Current
    {
        get
        {
            lock (_gate)
            {
                return _current;
            }
        }
    }

    /// <summary>Re-run the stream (the latest run wins via a monotonic generation guard).</summary>
    public void Start()
    {
        if (_disposed)
        {
            return;
        }

        var generation = Interlocked.Increment(ref _generation);
        _ = PumpAsync(generation);
    }

    /// <inheritdoc />
    public void Retry()
    {
        if (_disposed)
        {
            return;
        }

        // Cancel the in-flight run and start a fresh one so a failed fetch is genuinely re-attempted.
        var old = _lifetime;
        _lifetime = new CancellationTokenSource();
        old.Cancel();
        old.Dispose();
        Start();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _lifetime.Cancel();
        _lifetime.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task PumpAsync(int generation)
    {
        var token = _lifetime.Token;
        try
        {
            await foreach (var result in _stream(token).ConfigureAwait(false))
            {
                if (Volatile.Read(ref _generation) != generation)
                {
                    // A newer Start/Retry superseded this run; stop applying its emissions.
                    return;
                }

                var mapped = AnimatedMarkerSample.FromRepositoryResult(
                    result, _selectPosition, _selectHeading, _selectAccentBrushKey);
                Update(mapped.ToLoadState());
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by Retry/Dispose (lifetime cancelled); nothing to surface.
        }
        catch (ObjectDisposedException)
        {
            // The lifetime token source was disposed mid-enumeration during Dispose; safe to ignore.
        }
    }

    private void Update(LoadState<AnimatedMarkerSample> state)
    {
        lock (_gate)
        {
            _current = state;
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The map-viewport seam the <c>AnimatedMarker</c> surface binds through (P1/S8) — the native analogue of the web
/// <c>useMap()</c> hook (web/src/components/maps/AnimatedMarker.tsx L44). It exposes the current visible bounds
/// (web <c>map.getBounds()</c>) so the surface can decide whether a fix has scrolled off-screen, and a
/// <see cref="PanTo"/> action (web <c>map.panTo(target)</c>) so it can recentre the map to keep the fix visible.
/// Kept WinUI-free (operates on <see cref="GeoBounds"/> + <see cref="GeoPoint"/>) so the pan behaviour is
/// unit-tested without a map control; the production binding wraps the native map control at the view layer.
/// </summary>
public interface IAnimatedMarkerMap
{
    /// <summary>The map's current visible geographic bounds (web <c>map.getBounds()</c>).</summary>
    GeoBounds VisibleBounds { get; }

    /// <summary>Recentre the map on <paramref name="center"/> (web <c>map.panTo(target, { animate: true })</c>).</summary>
    /// <param name="center">The fix to bring into view.</param>
    void PanTo(GeoPoint center);
}

/// <summary>
/// An <see cref="IAnimatedMarkerMap"/> with explicit, caller-set bounds that records pan requests — the headless /
/// unit-test default. It lets the view-model's "keep the fix in view" behaviour be exercised without a map
/// control: set the visible bounds with <see cref="SetBounds"/> and assert against <see cref="PanCount"/> /
/// <see cref="LastPan"/>. Defaults to the whole-world bounds (every fix is in view, so no pan is requested).
/// </summary>
public sealed class StaticAnimatedMarkerMap : IAnimatedMarkerMap
{
    /// <summary>The whole-world bounds — every finite fix is contained, so no pan is ever requested.</summary>
    public static GeoBounds World { get; } = new(-85, -180, 85, 180);

    private GeoBounds _bounds;

    /// <summary>Creates a map seam over initial bounds (defaults to <see cref="World"/>).</summary>
    /// <param name="bounds">The initial visible bounds.</param>
    public StaticAnimatedMarkerMap(GeoBounds? bounds = null) => _bounds = bounds ?? World;

    /// <inheritdoc />
    public GeoBounds VisibleBounds => _bounds;

    /// <summary>The last fix <see cref="PanTo"/> was asked to recentre on, or null when never panned.</summary>
    public GeoPoint? LastPan { get; private set; }

    /// <summary>Number of times <see cref="PanTo"/> has been invoked (for test assertions).</summary>
    public int PanCount { get; private set; }

    /// <summary>Replace the visible bounds (simulating a map pan/zoom in tests).</summary>
    /// <param name="bounds">The new visible bounds.</param>
    public void SetBounds(GeoBounds bounds) => _bounds = bounds;

    /// <inheritdoc />
    public void PanTo(GeoPoint center)
    {
        LastPan = center;
        PanCount++;
    }
}
