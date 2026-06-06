using System.Runtime.InteropServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.Platform;

/// <summary>
/// The Windows <see cref="IFocusAssistProvider"/> (P2/W8-0001): it reads the shell's user-notification
/// state via <c>SHQueryUserNotificationState</c> and maps it onto <see cref="FocusAssistState"/> so the
/// delivery policy can hold back ordinary toasts while the user is in quiet time, presenting or running
/// a full-screen app. The query is cheap and read each time. Best-effort: on a host where the shell API
/// is unavailable it reports <see cref="FocusAssistState.Unknown"/> (which the policy treats as "allow")
/// rather than throwing.
/// </summary>
public sealed partial class WindowsFocusAssistProvider : IFocusAssistProvider
{
    // QUERY_USER_NOTIFICATION_STATE values (shellapi.h).
    private const int QunsNotPresent = 1;
    private const int QunsBusy = 2;
    private const int QunsRunningD3dFullScreen = 3;
    private const int QunsPresentationMode = 4;
    private const int QunsAcceptsNotifications = 5;
    private const int QunsQuietTime = 6;
    private const int QunsApp = 7;

    /// <inheritdoc />
    public FocusAssistState Current
    {
        get
        {
            try
            {
                if (SHQueryUserNotificationState(out var state) == 0)
                {
                    return Map(state);
                }
            }
            catch (Exception)
            {
                // No shell API on this host — treat as "allow" (Unknown) rather than crashing.
            }

            return FocusAssistState.Unknown;
        }
    }

    private static FocusAssistState Map(int state) => state switch
    {
        QunsAcceptsNotifications => FocusAssistState.Off,
        QunsQuietTime => FocusAssistState.PriorityOnly,
        QunsBusy or QunsRunningD3dFullScreen or QunsPresentationMode => FocusAssistState.AlarmsOnly,
        QunsNotPresent or QunsApp => FocusAssistState.Off,
        _ => FocusAssistState.Unknown,
    };

    [LibraryImport("shell32.dll")]
    private static partial int SHQueryUserNotificationState(out int state);
}
