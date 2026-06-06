using Microsoft.UI.Xaml;
using TeslaSync.App.Core.Live;

namespace TeslaSync.App.Live;

/// <summary>
/// The WinUI foreground-lifecycle adapter for the live SSE client (P2/W6-0001). It projects the
/// host <see cref="Window"/>'s activation and visibility onto the headless
/// <see cref="IForegroundLifecycle"/> contract the <see cref="SseClient"/> consumes, so a
/// backgrounded or hidden window pauses the stream (releasing the socket) and a returning window
/// resumes it — without the engine taking any dependency on WinUI.
///
/// <para>The window is considered foreground while it is both visible and not deactivated; either a
/// deactivation (<see cref="WindowActivationState.Deactivated"/>) or a visibility loss parks the
/// stream. Transitions are de-duplicated so the client only sees genuine foreground changes.</para>
/// </summary>
public sealed class WindowForegroundLifecycle : IForegroundLifecycle, IDisposable
{
    private readonly Window _window;
    private bool _activated = true;
    private bool _visible = true;
    private bool _isForeground = true;
    private bool _disposed;

    /// <summary>Creates the adapter and begins observing the window's activation/visibility.</summary>
    public WindowForegroundLifecycle(Window window)
    {
        ArgumentNullException.ThrowIfNull(window);
        _window = window;
        _window.Activated += OnActivated;
        _window.VisibilityChanged += OnVisibilityChanged;
    }

    /// <inheritdoc />
    public event Action<bool>? ForegroundChanged;

    /// <inheritdoc />
    public bool IsForeground => _isForeground;

    private void OnActivated(object sender, WindowActivatedEventArgs args)
    {
        _activated = args.WindowActivationState != WindowActivationState.Deactivated;
        Reconcile();
    }

    private void OnVisibilityChanged(object sender, WindowVisibilityChangedEventArgs args)
    {
        _visible = args.Visible;
        Reconcile();
    }

    private void Reconcile()
    {
        bool foreground = _activated && _visible;
        if (foreground == _isForeground)
        {
            return;
        }

        _isForeground = foreground;
        ForegroundChanged?.Invoke(foreground);
    }

    /// <summary>Detaches the window event handlers.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _window.Activated -= OnActivated;
        _window.VisibilityChanged -= OnVisibilityChanged;
    }
}
