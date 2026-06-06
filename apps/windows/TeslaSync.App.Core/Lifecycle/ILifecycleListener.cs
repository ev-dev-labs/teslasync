namespace TeslaSync.App.Core.Lifecycle;

/// <summary>
/// A participant the <see cref="LifecycleCoordinator"/> drives on lifecycle transitions (P2/W8-0002):
/// the settings/window-state persister, the response-cache trimmer, and the live-session controller
/// register here. Implementations must be cheap and non-throwing — they run on teardown / background
/// paths where a failure must not cascade.
/// </summary>
public interface ILifecycleListener
{
    /// <summary>Invoked on every committed lifecycle phase change.</summary>
    void OnLifecycleStateChanged(AppLifecycleState previous, AppLifecycleState current);

    /// <summary>Invoked when connectivity changes (an offline → online restore re-validates live data).</summary>
    void OnNetworkChanged(bool isOnline);

    /// <summary>Invoked when a crash-safe persist is required (suspend, window close, or fatal error).</summary>
    void PersistForShutdown(LifecycleShutdownReason reason);
}
