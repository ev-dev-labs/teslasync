using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>ScrollRestoration</c> shared surface — a parity port of
/// web/src/components/layout/ScrollRestoration.tsx. It mounts once near the shell root and reproduces the web
/// component's classic-router scroll-restoration behaviour for the single scrollable region: it records the
/// vertical offset per location key (path + search) while the user scrolls, restores the saved offset on a POP
/// (back/forward) navigation, and scrolls to the top on a fresh PUSH / REPLACE navigation. Like the web source —
/// which <c>return null</c>s — the surface is intentionally invisible: it draws no chrome, takes no tab stop and
/// contributes no Narrator node (<see cref="AccessibilityView.Raw"/>), so it carries no static copy, no i18n keys
/// and no interactive elements. All capture / restore timing lives in the UI-thread-free
/// <see cref="ScrollRestorationViewModel"/>; this view only owns the WinUI wiring — it adapts the shell's content
/// <see cref="ScrollViewer"/> to the <see cref="IScrollSurface"/> seam, supplies a composition-render frame
/// scheduler (the native analogue of <c>requestAnimationFrame</c>) and starts / disposes the holder on
/// load / unload. There is no loading / error / stale / offline chrome because the web source has no data fetch.
/// </summary>
public sealed partial class ScrollRestoration : ContentControl, IDisposable
{
    private readonly ScrollRestorationViewModel _viewModel;
    private readonly IDisposable? _ownedSurface;
    private bool _disposed;

    /// <summary>Creates the surface over the location + scroll-surface seams, with optional store, frames and diagnostics.</summary>
    /// <param name="location">The current-location port (web <c>useLocation</c> + <c>useNavigationType</c> seam).</param>
    /// <param name="surface">The scrollable viewport port (web <c>#main-content</c> seam).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    /// <param name="store">The per-location offset store; defaults to a process-lifetime <see cref="InMemoryScrollOffsetStore"/>.</param>
    /// <param name="frames">The per-frame scheduler; defaults to a composition-render one-shot.</param>
    public ScrollRestoration(
        IScrollRestorationLocationSource location,
        IScrollSurface surface,
        ScrollRestorationDiagnostics? diagnostics = null,
        IScrollOffsetStore? store = null,
        IFrameScheduler? frames = null)
        : this(location, surface, ownsSurface: false, diagnostics, store, frames)
    {
    }

    /// <summary>
    /// Creates the surface over the shell's content <see cref="ScrollViewer"/> (the native <c>#main-content</c>
    /// analogue), wrapping it in the <see cref="IScrollSurface"/> adapter this surface owns and disposes.
    /// </summary>
    /// <param name="location">The current-location port (web <c>useLocation</c> + <c>useNavigationType</c> seam).</param>
    /// <param name="mainContent">The shell's scrollable content viewport.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    /// <param name="store">The per-location offset store; defaults to a process-lifetime <see cref="InMemoryScrollOffsetStore"/>.</param>
    /// <param name="frames">The per-frame scheduler; defaults to a composition-render one-shot.</param>
    public ScrollRestoration(
        IScrollRestorationLocationSource location,
        ScrollViewer mainContent,
        ScrollRestorationDiagnostics? diagnostics = null,
        IScrollOffsetStore? store = null,
        IFrameScheduler? frames = null)
        : this(location, new ScrollViewerSurface(mainContent), ownsSurface: true, diagnostics, store, frames)
    {
    }

    private ScrollRestoration(
        IScrollRestorationLocationSource location,
        IScrollSurface surface,
        bool ownsSurface,
        ScrollRestorationDiagnostics? diagnostics,
        IScrollOffsetStore? store,
        IFrameScheduler? frames)
    {
        ArgumentNullException.ThrowIfNull(location);
        ArgumentNullException.ThrowIfNull(surface);

        _viewModel = new ScrollRestorationViewModel(
            location,
            store ?? new InMemoryScrollOffsetStore(),
            surface,
            frames ?? new RenderingFrameScheduler(),
            diagnostics);

        // Only an adapter this surface created (the ScrollViewer convenience ctor) is detached on dispose; a
        // caller-supplied seam is owned by the caller.
        _ownedSurface = ownsSurface ? surface as IDisposable : null;

        ConfigureInvisibleChrome();
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ScrollRestoration</c>).</summary>
    public static string Slug => ScrollRestorationRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ScrollRestorationViewModel ViewModel => _viewModel;

    /// <summary>Detach from the seams, flush the final position and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        _ownedSurface?.Dispose();
        GC.SuppressFinalize(this);
    }

    private void ConfigureInvisibleChrome()
    {
        // web `return null`: the surface contributes no visible chrome, no tab stop and no accessible node — the
        // a11y contract is the deliberate absence of anything that would need a Narrator label.
        IsTabStop = false;
        IsHitTestVisible = false;
        Width = 0;
        Height = 0;
        MinWidth = 0;
        MinHeight = 0;
        Content = null;
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);
    }

    private void OnLoaded(object sender, RoutedEventArgs e) => _viewModel.Start();

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>
    /// Adapts a WinUI <see cref="ScrollViewer"/> to the <see cref="IScrollSurface"/> seam — the native binding of
    /// the web <c>#main-content</c> element: <see cref="Offset"/> reads <see cref="ScrollViewer.VerticalOffset"/>,
    /// <see cref="ScrollTo"/> calls <see cref="ScrollViewer.ChangeView(double?, double?, float?, bool)"/> with
    /// animation disabled (an instant restore, matching the web <c>scrollTop =</c> assignment), and
    /// <see cref="Scrolled"/> re-raises <see cref="ScrollViewer.ViewChanged"/>.
    /// </summary>
    private sealed class ScrollViewerSurface : IScrollSurface, IDisposable
    {
        private readonly ScrollViewer _scrollViewer;
        private bool _disposed;

        public ScrollViewerSurface(ScrollViewer scrollViewer)
        {
            ArgumentNullException.ThrowIfNull(scrollViewer);
            _scrollViewer = scrollViewer;
            _scrollViewer.ViewChanged += OnViewChanged;
        }

        public event EventHandler? Scrolled;

        public double Offset => _scrollViewer.VerticalOffset;

        public void ScrollTo(double offset) => _scrollViewer.ChangeView(null, offset, null, disableAnimation: true);

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _scrollViewer.ViewChanged -= OnViewChanged;
        }

        private void OnViewChanged(object? sender, ScrollViewerViewChangedEventArgs e) =>
            Scrolled?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// The production <see cref="IFrameScheduler"/> — a one-shot <see cref="CompositionTarget.Rendering"/>
    /// subscription, the native analogue of <c>requestAnimationFrame</c>: the callback runs once on the next frame
    /// and disposing the handle before it fires unsubscribes (web <c>cancelAnimationFrame</c>).
    /// </summary>
    private sealed class RenderingFrameScheduler : IFrameScheduler
    {
        public IDisposable RequestFrame(Action callback)
        {
            ArgumentNullException.ThrowIfNull(callback);
            return new FrameHandle(callback);
        }

        private sealed class FrameHandle : IDisposable
        {
            private Action? _callback;

            public FrameHandle(Action callback)
            {
                _callback = callback;
                CompositionTarget.Rendering += OnRendering;
            }

            public void Dispose()
            {
                if (_callback is null)
                {
                    return;
                }

                _callback = null;
                CompositionTarget.Rendering -= OnRendering;
            }

            private void OnRendering(object? sender, object e)
            {
                CompositionTarget.Rendering -= OnRendering;
                Action? callback = _callback;
                _callback = null;
                callback?.Invoke();
            }
        }
    }
}
