using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Windows.UI.ViewManagement;

namespace TeslaSync.App.Components.Motion;

/// <summary>
/// Reads the Windows "show animations" accessibility setting so the motion controls
/// can honour reduce-motion (mirrors the web <c>useMotionPreference</c> / the
/// <c>prefers-reduced-motion</c> media query). The pure duration policy lives in
/// <see cref="TeslaSync.App.Core.Motion.MotionDuration"/>; this adapter only sources
/// the OS flag and notifies listeners when the user changes it at runtime.
/// </summary>
public static class MotionPreference
{
    private static readonly UISettings Settings = new();

    /// <summary>
    /// True when the user has asked the OS to minimise animations, so callers should
    /// skip entrance/transition animations and render the final state immediately.
    /// </summary>
    public static bool ReduceMotion => !Settings.AnimationsEnabled;

    /// <summary>
    /// Subscribe to runtime changes of the reduce-motion preference. The callback is
    /// invoked on a thread-pool thread, so marshal to <paramref name="dispatcher"/>
    /// when touching UI. Returns a token that detaches the handler when disposed.
    /// </summary>
    [System.Runtime.Versioning.SupportedOSPlatform("windows10.0.19041.0")]
    public static IDisposable Observe(DispatcherQueue? dispatcher, Action<bool> onChanged)
    {
        ArgumentNullException.ThrowIfNull(onChanged);

        void Handler(UISettings sender, UISettingsAnimationsEnabledChangedEventArgs args)
        {
            bool reduce = !sender.AnimationsEnabled;
            if (dispatcher is not null)
            {
                dispatcher.TryEnqueue(() => onChanged(reduce));
            }
            else
            {
                onChanged(reduce);
            }
        }

        Settings.AnimationsEnabledChanged += Handler;
        return new Subscription(() => Settings.AnimationsEnabledChanged -= Handler);
    }

    private sealed class Subscription(Action dispose) : IDisposable
    {
        private Action? _dispose = dispose;

        public void Dispose()
        {
            _dispose?.Invoke();
            _dispose = null;
        }
    }
}
