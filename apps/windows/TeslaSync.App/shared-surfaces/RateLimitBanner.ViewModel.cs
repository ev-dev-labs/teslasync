using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="RateLimitBanner"/> view — the native port of the web
/// <c>RateLimitBanner</c> body (web/src/components/feedback/RateLimitBanner.tsx L50-115). It binds the P1/S8
/// <see cref="IRateLimitSignalSource"/> (the web <c>teslasync:rate-limited</c> / <c>teslasync:upstream-down</c>
/// document events) and <see cref="IQueryInvalidator"/> (the web <c>useQueryClient</c>), captures the active
/// cooldown when a signal arrives (the web <c>onLimited</c> / <c>onUpstream</c> handlers setting state +
/// <c>expiresAt</c>), recomputes the pure <see cref="RateLimitBannerProjection"/> against an injectable clock, and
/// raises <see cref="PropertyChanged"/> so the view re-renders the countdown. <see cref="Tick"/> advances the
/// once-per-second countdown (the web <c>setInterval</c>), <see cref="Retry"/> clears the banner and invalidates
/// every query (the web <c>handleRetry</c>), and <see cref="Dismiss"/> clears the banner without invalidating (the
/// web <c>handleDismiss</c>). <see cref="Dispose"/> unsubscribes from the signal source (the web effect cleanup).
/// The view performs no I/O of its own and owns only the dispatcher timer that calls <see cref="Tick"/>.
/// </summary>
public sealed class RateLimitBannerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IRateLimitSignalSource _source;
    private readonly IQueryInvalidator _invalidator;
    private readonly Func<DateTimeOffset> _clock;
    private RateLimitSignal? _signal;
    private RateLimitBannerProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and the two P1/S8 seams.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="source">The resilience-signal seam (web <c>teslasync:rate-limited</c> / <c>teslasync:upstream-down</c>).</param>
    /// <param name="invalidator">The query-invalidation seam (web <c>useQueryClient().invalidateQueries()</c>).</param>
    /// <param name="clock">The current-instant source the countdown is computed against (defaults to <see cref="DateTimeOffset.UtcNow"/>).</param>
    public RateLimitBannerViewModel(
        ILocalizer localizer,
        IRateLimitSignalSource source,
        IQueryInvalidator invalidator,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(invalidator);

        _localizer = localizer;
        _source = source;
        _invalidator = invalidator;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);

        _projection = Compute();
        _source.SignalReceived += OnSignalReceived;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>RateLimitBanner</c>).</summary>
    public static string Slug => RateLimitBannerRegistration.Slug;

    /// <summary>The current render projection (visibility + countdown + localized copy + action state).</summary>
    public RateLimitBannerProjection Projection => _projection;

    /// <summary>Whether the banner is shown (web <c>state !== null</c>).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>The localized, count-substituted banner copy (web <c>ratelimit.banner</c> / <c>upstream.banner</c>).</summary>
    public string Message => _projection.Message;

    /// <summary>Whether the retry control is enabled (web <c>!(remaining &gt; 0)</c>).</summary>
    public bool RetryEnabled => _projection.RetryEnabled;

    /// <summary>The localized "Retry now" label (web <c>ratelimit.retry</c>).</summary>
    public string RetryLabel => _projection.RetryLabel;

    /// <summary>The localized dismiss-control accessible name (web <c>common.dismiss</c>).</summary>
    public string DismissLabel => _projection.DismissLabel;

    /// <summary>The accessible name a screen reader announces for the surface (the banner message).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>
    /// Advance the once-per-second countdown — the native analogue of the web <c>setInterval(() =&gt; setNow(...), 1000)</c>
    /// that runs only while the banner is visible (web/src/components/feedback/RateLimitBanner.tsx L91-100):
    /// recompute the projection against the current clock; <see cref="PropertyChanged"/> fires only when the rendered
    /// value actually changes (e.g. the countdown ticks down a whole second or the retry control unlocks at zero).
    /// </summary>
    public void Tick() => Reproject();

    /// <summary>
    /// Clear the banner and force every page to refetch — the web <c>handleRetry</c>
    /// (web/src/components/feedback/RateLimitBanner.tsx L108-111): <c>setState(null)</c> then
    /// <c>queryClient.invalidateQueries()</c>. Invalidation runs only when a banner was actually showing, so a
    /// no-op call never churns the cache.
    /// </summary>
    public void Retry()
    {
        if (_disposed)
        {
            return;
        }

        var wasVisible = _signal is not null;
        _signal = null;
        Reproject();

        if (wasVisible)
        {
            _invalidator.InvalidateAll();
        }
    }

    /// <summary>
    /// Clear the banner without invalidating — the web <c>handleDismiss</c>
    /// (web/src/components/feedback/RateLimitBanner.tsx L113-115): <c>setState(null)</c> only. The in-process
    /// short-circuit cache expires on its own when the retry-after window elapses (the web note), so a fresh
    /// signal re-arms the banner.
    /// </summary>
    public void Dismiss()
    {
        if (_disposed)
        {
            return;
        }

        _signal = null;
        Reproject();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.SignalReceived -= OnSignalReceived;
        GC.SuppressFinalize(this);
    }

    private void OnSignalReceived(object? sender, RateLimitSignalEventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        // web onLimited / onUpstream: capture the cooldown anchored at "now" and restart the countdown.
        _signal = e.Kind == RateLimitKind.RateLimited
            ? RateLimitSignal.RateLimited(e.Scope, e.RetryAfterSeconds, _clock())
            : RateLimitSignal.UpstreamDown(e.Upstream, e.RetryAfterSeconds, _clock());
        Reproject();
    }

    private RateLimitBannerProjection Compute() =>
        RateLimitBannerProjection.Project(_signal, _clock(), _localizer);

    private void Reproject()
    {
        var next = Compute();
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}
