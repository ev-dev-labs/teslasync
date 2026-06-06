namespace TeslaSync.App.Core.Lifecycle;

/// <summary>
/// The app's coarse lifecycle phase (P2/W8-0002). A WinUI desktop window does not receive the UWP
/// <c>Application.Suspending</c>/<c>Resuming</c> OS events, so the windowed equivalent is modelled
/// here from the window's foreground/background transitions: backgrounding the window moves the app
/// through <see cref="Suspending"/> into <see cref="Suspended"/> (live streams pause, state is
/// flushed crash-safe), and returning to the foreground moves it through <see cref="Resuming"/> back
/// to <see cref="Running"/> (freshness is re-validated so paused data is never shown as live).
/// </summary>
public enum AppLifecycleState
{
    /// <summary>The process has started but the first window has not yet been marked active.</summary>
    Launching = 0,

    /// <summary>The app is foreground and fully active.</summary>
    Running,

    /// <summary>The app is transitioning to the background; participants persist + pause.</summary>
    Suspending,

    /// <summary>The app is backgrounded; live streams are paused.</summary>
    Suspended,

    /// <summary>The app is returning to the foreground; participants re-validate before resuming.</summary>
    Resuming,
}

/// <summary>Why a crash-safe persist was requested.</summary>
public enum LifecycleShutdownReason
{
    /// <summary>The shell window is closing in the normal teardown path.</summary>
    WindowClosing = 0,

    /// <summary>The app is being backgrounded (the windowed "suspend" equivalent).</summary>
    Suspend,

    /// <summary>An unhandled exception is tearing the process down — persist immediately.</summary>
    FatalError,
}
