using TeslaSync.App.Core.Push;
using Windows.Data.Xml.Dom;
using Windows.UI.Notifications;

namespace TeslaSync.App.Platform;

/// <summary>
/// The Windows <see cref="IToastService"/> (P2/W6-0002): it presents a foreground push as a system
/// toast via the classic <see cref="ToastNotificationManager"/> (packaged-app identity supplies the
/// AppUserModelId). It uses the base Windows SDK toast surface so the platform library needs no extra
/// package. Presentation is best-effort: an unpackaged/unsupported host is a no-op, never a crash.
/// </summary>
public sealed class WindowsToastService : IToastService
{
    /// <inheritdoc />
    public Task ShowAsync(PushToast toast, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(toast);
        cancellationToken.ThrowIfCancellationRequested();

        try
        {
            var xml = ToastNotificationManager.GetTemplateContent(ToastTemplateType.ToastText02);
            var lines = xml.GetElementsByTagName("text");
            if (lines.Length > 0)
            {
                lines[0].AppendChild(xml.CreateTextNode(toast.Title));
            }

            if (lines.Length > 1)
            {
                lines[1].AppendChild(xml.CreateTextNode(toast.Body));
            }

            ToastNotificationManager.CreateToastNotifier().Show(new ToastNotification(xml));
        }
        catch (Exception)
        {
            // No package identity / unsupported host — presenting a toast is best-effort.
        }

        return Task.CompletedTask;
    }
}
