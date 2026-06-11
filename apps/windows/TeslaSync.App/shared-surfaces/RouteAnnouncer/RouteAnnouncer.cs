using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.A11y;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>RouteAnnouncer</c> shared surface — a parity port of
/// web/src/components/a11y/RouteAnnouncer.tsx. It mounts once near the top of the shell and speaks the destination
/// page title to assistive technology after every client-side navigation, so Narrator users hear which page they
/// landed on (WCAG 2.4.2) instead of a silent content swap. The component is intentionally invisible: it hosts the
/// atomic polite live region (<see cref="TsAnnouncerRegion"/>, the native analogue of the web
/// <c>&lt;VisuallyHidden liveRegion priority="polite"&gt;</c>) clipped to nothing, and pushes the
/// <see cref="RouteAnnouncerViewModel.Message"/> the holder computes into it as the text changes. All timing,
/// title reading, first-paint suppression, debouncing and zero-width-space de-duplication live in the
/// UI-thread-free <see cref="RouteAnnouncerViewModel"/>; this view only owns the WinUI wiring — it constructs the
/// dispatcher-timer scheduler, observes the holder and marshals announcements onto the UI thread. There is no
/// loading / error / stale / offline chrome because the web source has no data fetch; the surface is anonymous, so
/// it carries no static copy and exposes no interactive elements — the spoken content is the already-localized
/// page title supplied by the title seam.
/// </summary>
public sealed partial class RouteAnnouncer : ContentControl, IDisposable
{
    private readonly RouteAnnouncerViewModel _viewModel;
    private readonly TsAnnouncerRegion _region;
    private readonly DispatcherQueue? _dispatcher;
    private bool _disposed;

    /// <summary>Creates the surface over the location + title seams, with an optional delay, diagnostics and scheduler.</summary>
    /// <param name="location">The current-location port (web <c>useLocation</c> seam); the shell adapter supplies it.</param>
    /// <param name="title">The page-title port (web <c>document.title</c> seam); the shell adapter supplies it.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    /// <param name="delay">The deferred-read delay; defaults to <see cref="RouteAnnouncerRegistration.DefaultAnnounceDelay"/>.</param>
    /// <param name="scheduler">The deferred-callback port; defaults to a UI-thread dispatcher timer.</param>
    public RouteAnnouncer(
        IRouteLocationSource location,
        IPageTitleSource title,
        RouteAnnouncerDiagnostics? diagnostics = null,
        TimeSpan? delay = null,
        IAnnounceScheduler? scheduler = null)
    {
        ArgumentNullException.ThrowIfNull(location);
        ArgumentNullException.ThrowIfNull(title);

        _dispatcher = DispatcherQueue.GetForCurrentThread();
        IAnnounceScheduler effectiveScheduler = scheduler ?? new DispatcherAnnounceScheduler(_dispatcher);
        _viewModel = new RouteAnnouncerViewModel(location, title, effectiveScheduler, diagnostics, delay);

        // Reuse the atomic polite live region (web `<VisuallyHidden liveRegion priority="polite">`); it is clipped
        // to 1x1 with zero opacity so it is exposed to UI Automation but never drawn.
        _region = new TsAnnouncerRegion { Assertive = false };

        IsTabStop = false;
        Content = _region;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>RouteAnnouncer</c>).</summary>
    public static string Slug => RouteAnnouncerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public RouteAnnouncerViewModel ViewModel => _viewModel;

    private void OnLoaded(object sender, RoutedEventArgs e) => _viewModel.Start();

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(RouteAnnouncerViewModel.Message))
        {
            Marshal(() => _region.Announce(_viewModel.Message));
        }
    }

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }

    /// <summary>Detach from the view-model, cancel any pending announcement and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>
    /// The production <see cref="IAnnounceScheduler"/> — a one-shot UI-thread <see cref="DispatcherQueueTimer"/>
    /// (the native analogue of the web <c>window.setTimeout</c>). Disposing the returned handle stops a
    /// not-yet-fired timer (web <c>clearTimeout</c>). When no dispatcher is available (design-time) the callback
    /// runs inline so an announcement is never silently dropped.
    /// </summary>
    private sealed class DispatcherAnnounceScheduler : IAnnounceScheduler
    {
        private readonly DispatcherQueue? _dispatcher;

        public DispatcherAnnounceScheduler(DispatcherQueue? dispatcher) => _dispatcher = dispatcher;

        public IDisposable Schedule(TimeSpan delay, Action callback)
        {
            ArgumentNullException.ThrowIfNull(callback);

            if (_dispatcher is not { } dispatcher)
            {
                callback();
                return NoopHandle.Instance;
            }

            return new TimerHandle(dispatcher, delay, callback);
        }
    }

    private sealed class TimerHandle : IDisposable
    {
        private readonly DispatcherQueueTimer _timer;
        private Action? _callback;

        public TimerHandle(DispatcherQueue dispatcher, TimeSpan delay, Action callback)
        {
            _callback = callback;
            _timer = dispatcher.CreateTimer();
            _timer.Interval = delay;
            _timer.IsRepeating = false;
            _timer.Tick += OnTick;
            _timer.Start();
        }

        private void OnTick(DispatcherQueueTimer sender, object args)
        {
            _timer.Stop();
            _timer.Tick -= OnTick;
            Action? callback = _callback;
            _callback = null;
            callback?.Invoke();
        }

        public void Dispose()
        {
            if (_callback is null)
            {
                return;
            }

            _callback = null;
            _timer.Stop();
            _timer.Tick -= OnTick;
        }
    }

    private sealed class NoopHandle : IDisposable
    {
        public static NoopHandle Instance { get; } = new();

        private NoopHandle()
        {
        }

        public void Dispose()
        {
        }
    }
}
