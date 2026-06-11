using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="LiveStaleDataBanner"/> view — the native port of the web
/// component body (web/src/components/feedback/LiveStaleDataBanner.tsx L27-L69). It binds the
/// <see cref="ILiveStaleDataBannerSource"/> (the P1/S8 <c>useLiveConnection</c> seam), tracks when the current
/// disconnection began (the web <c>disconnectedSinceRef</c>), and re-runs the pure
/// <see cref="LiveStaleDataBannerEvaluator"/> whenever the live-pipeline status moves or the view's wake timer fires
/// (<see cref="NotifyTimeElapsed"/>, the web <c>setTimeout</c> callback). The render-ready
/// <see cref="LiveStaleDataBannerProjection"/> and the next <see cref="RetryAfter"/> wake delay are recomputed and
/// <see cref="PropertyChanged"/> is raised so the view re-renders and (re)schedules its one-shot timer.
/// <see cref="Dispose"/> unsubscribes from the seam (the web effect cleanup). The view performs no I/O of its own;
/// the show / hide animation is a view concern.
/// </summary>
public sealed class LiveStaleDataBannerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly ILiveStaleDataBannerSource _source;
    private readonly Func<DateTimeOffset> _clock;
    private readonly TimeSpan _threshold;
    private DateTimeOffset? _disconnectedSince;
    private LiveStaleDataBannerProjection _projection;
    private TimeSpan? _retryAfter;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and live-connection seam (P1/S8).</summary>
    /// <param name="localizer">The i18n facade the title / message resolve through.</param>
    /// <param name="source">The live-connection state-holder seam (web <c>useLiveConnection</c>).</param>
    /// <param name="clock">The clock the sustained-disconnection elapsed time is measured against; defaults to <see cref="DateTimeOffset.UtcNow"/>.</param>
    /// <param name="threshold">The sustained-disconnection threshold; defaults to <see cref="LiveStaleDataBannerRegistration.StaleThreshold"/> (web 2 minutes).</param>
    public LiveStaleDataBannerViewModel(
        ILocalizer localizer,
        ILiveStaleDataBannerSource source,
        Func<DateTimeOffset>? clock = null,
        TimeSpan? threshold = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);

        _localizer = localizer;
        _source = source;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _threshold = threshold ?? LiveStaleDataBannerRegistration.StaleThreshold;

        var decision = LiveStaleDataBannerEvaluator.Decide(_source.Status, null, _clock(), _threshold);
        _disconnectedSince = decision.DisconnectedSince;
        _projection = LiveStaleDataBannerProjection.Project(decision.Show, _localizer);
        _retryAfter = decision.RetryAfter;

        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>LiveStaleDataBanner</c>).</summary>
    public static string Slug => LiveStaleDataBannerRegistration.Slug;

    /// <summary>The current render projection (visibility + title + message + glyph + accessible name + live setting).</summary>
    public LiveStaleDataBannerProjection Projection => _projection;

    /// <summary>Whether the banner is shown (web <c>show</c>).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>The localized banner title (web <c>t('live.staleBanner.title')</c>).</summary>
    public string Title => _projection.Title;

    /// <summary>The localized banner message (web <c>t('live.staleBanner.message')</c>).</summary>
    public string Message => _projection.Message;

    /// <summary>The Segoe Fluent glyph the banner shows (web Lucide <c>WifiOff</c>).</summary>
    public string IconGlyph => _projection.IconGlyph;

    /// <summary>The accessible name a screen reader announces (title + message).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>The ARIA live urgency the banner declares (polite).</summary>
    public string LiveSetting => _projection.LiveSetting;

    /// <summary>
    /// How long the view should wait before calling <see cref="NotifyTimeElapsed"/> so the threshold can elapse, or
    /// null when nothing is pending (the banner is already shown, or the pipe is not disconnected) — the web
    /// <c>setTimeout</c> delay. The view schedules a one-shot timer for this.
    /// </summary>
    public TimeSpan? RetryAfter => _retryAfter;

    /// <summary>When the current sustained disconnection began, or null if the pipe is not disconnected (web <c>disconnectedSinceRef</c>); exposed for tests / diagnostics.</summary>
    public DateTimeOffset? DisconnectedSince => _disconnectedSince;

    /// <summary>
    /// Re-evaluate the trigger against the current clock — the web <c>setTimeout</c> callback firing once the
    /// remaining threshold time has elapsed, promoting the banner to shown without any further wire traffic.
    /// </summary>
    public void NotifyTimeElapsed() => Evaluate();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSourceChanged;
        GC.SuppressFinalize(this);
    }

    private void OnSourceChanged(object? sender, EventArgs e) => Evaluate();

    private void Evaluate()
    {
        if (_disposed)
        {
            return;
        }

        var decision = LiveStaleDataBannerEvaluator.Decide(_source.Status, _disconnectedSince, _clock(), _threshold);
        _disconnectedSince = decision.DisconnectedSince;

        var nextProjection = LiveStaleDataBannerProjection.Project(decision.Show, _localizer);
        var changed = nextProjection != _projection || decision.RetryAfter != _retryAfter;

        _projection = nextProjection;
        _retryAfter = decision.RetryAfter;

        if (changed)
        {
            // Raised whenever the visual OR the pending wake delay moves — a status flip to disconnected keeps the
            // banner hidden but arms RetryAfter, and the view must (re)schedule its one-shot timer off that change.
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
        }
    }
}
