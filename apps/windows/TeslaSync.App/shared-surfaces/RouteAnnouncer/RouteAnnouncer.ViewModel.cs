using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="RouteAnnouncer"/> view — the native port of the web
/// component (web/src/components/a11y/RouteAnnouncer.tsx). The web component subscribes to <c>useLocation()</c>
/// and, on every pathname change AFTER the first render, defers a read of <c>document.title</c> and writes it into
/// a polite live region, rotating a zero-width-space suffix so repeated titles are still re-read. This holder
/// reproduces that exactly:
/// <list type="bullet">
/// <item><description>
/// the first run (mount) is skipped — the platform already speaks the initial page on load, so announcing it again
/// would double-speak (web <c>firstRender</c> guard);
/// </description></item>
/// <item><description>
/// each subsequent navigation cancels any pending read (web <c>clearTimeout</c> on effect cleanup) and schedules a
/// fresh one through the <see cref="IAnnounceScheduler"/> seam (web <c>setTimeout(..., delayMs)</c>);
/// </description></item>
/// <item><description>
/// when the delay elapses the page title is read from the <see cref="IPageTitleSource"/> seam and projected by
/// <see cref="RouteAnnouncerProjection.Next"/> into the <see cref="Message"/> the view speaks — an empty title
/// clears the region.
/// </description></item>
/// </list>
/// Because the surface has no data fetch, there is no loading / error / stale / offline branch to model (the web
/// source has none); the only states are an empty region (first paint, or a title-less destination) and an active
/// announcement, both represented by <see cref="Message"/>. The view never performs HTTP, navigation or timing
/// itself — it observes <see cref="Message"/> and pushes it into the live region. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class RouteAnnouncerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IRouteLocationSource _location;
    private readonly IPageTitleSource _title;
    private readonly IAnnounceScheduler _scheduler;
    private readonly RouteAnnouncerDiagnostics _diagnostics;
    private readonly TimeSpan _delay;

    private bool _firstRun = true;
    private int _counter;
    private IDisposable? _pending;
    private string _message = string.Empty;
    private bool _started;
    private bool _disposed;

    /// <summary>Creates the holder over the location + title + scheduler seams, with an optional delay and diagnostics.</summary>
    /// <param name="location">The current-location port (web <c>useLocation</c> seam).</param>
    /// <param name="title">The page-title port (web <c>document.title</c> seam).</param>
    /// <param name="scheduler">The deferred-callback port (web <c>setTimeout</c>/<c>clearTimeout</c> seam).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    /// <param name="delay">The deferred-read delay; defaults to <see cref="RouteAnnouncerRegistration.DefaultAnnounceDelay"/> (web <c>delayMs</c>).</param>
    public RouteAnnouncerViewModel(
        IRouteLocationSource location,
        IPageTitleSource title,
        IAnnounceScheduler scheduler,
        RouteAnnouncerDiagnostics? diagnostics = null,
        TimeSpan? delay = null)
    {
        ArgumentNullException.ThrowIfNull(location);
        ArgumentNullException.ThrowIfNull(title);
        ArgumentNullException.ThrowIfNull(scheduler);

        _location = location;
        _title = title;
        _scheduler = scheduler;
        _diagnostics = diagnostics ?? new RouteAnnouncerDiagnostics();
        _delay = delay ?? RouteAnnouncerRegistration.DefaultAnnounceDelay;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current live-region text (web <c>message</c> state): a title plus de-dup padding, or empty.</summary>
    public string Message
    {
        get => _message;
        private set
        {
            if (string.Equals(_message, value, StringComparison.Ordinal))
            {
                return;
            }

            _message = value;
            Raise();
        }
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>RouteAnnouncer</c>).</summary>
    public static string Slug => RouteAnnouncerRegistration.Slug;

    /// <summary>The current zero-width-space padding counter (0..3) — exposed for diagnostics / tests.</summary>
    public int PaddingCounter => _counter;

    /// <summary>True while a deferred announcement is scheduled but has not yet fired (web timeout in flight).</summary>
    public bool HasPendingAnnouncement => _pending is not null;

    /// <summary>
    /// Begin announcing route changes (web component mount): emit the <c>view.opened</c> diagnostic, subscribe to
    /// the location seam, and consume the first run so the initial page is NOT announced (web <c>firstRender</c>
    /// guard). Idempotent — a second call is a no-op.
    /// </summary>
    public void Start()
    {
        if (_started || _disposed)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _location.Changed += OnLocationChanged;

        // The mount run establishes the baseline without announcing — the platform already speaks the initial
        // page, so the first real navigation is the first thing this surface announces.
        RunRouteEffect();
    }

    private void OnLocationChanged(object? sender, EventArgs e) => RunRouteEffect();

    private void RunRouteEffect()
    {
        if (_disposed)
        {
            return;
        }

        // Cancel the previous deferred read first (web effect cleanup / clearTimeout) so two rapid navigations
        // announce only the final destination.
        _pending?.Dispose();
        _pending = null;

        if (_firstRun)
        {
            _firstRun = false;
            return;
        }

        _pending = _scheduler.Schedule(_delay, OnDelayElapsed);
    }

    private void OnDelayElapsed()
    {
        if (_disposed)
        {
            return;
        }

        _pending = null;

        // The destination page has had the delay window to write its title; read it now (web deferred read).
        AnnouncementStep step = RouteAnnouncerProjection.Next(_title.Title, _counter);
        _counter = step.Counter;
        Message = step.Message;

        if (step.IsCleared)
        {
            _diagnostics.RecordCleared();
        }
        else
        {
            _diagnostics.RecordAnnounced();
        }
    }

    /// <summary>Stop announcing, cancel any pending read and detach from the location seam (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _location.Changed -= OnLocationChanged;
        _pending?.Dispose();
        _pending = null;
        GC.SuppressFinalize(this);
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
