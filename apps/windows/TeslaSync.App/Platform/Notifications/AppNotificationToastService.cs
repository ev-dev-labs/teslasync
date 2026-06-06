using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.Notifications;

/// <summary>
/// The Windows rich-toast surface (P2/W8-0001). It implements <see cref="IToastPresenter"/> by building
/// an actionable, deep-linkable toast with the Windows App SDK <see cref="AppNotificationBuilder"/>: the
/// localized title/body, the composed launch arguments (the route the body-tap opens), the urgent /
/// reminder scenario, and one or two action buttons each carrying their own activation arguments. The
/// argument key/value pairs are the same ones the core <see cref="ToastArguments"/> encoder produces, so
/// the platform never re-implements toast semantics. Presentation is best-effort: an unpackaged or
/// unsupported host is a no-op, never a crash, and no secret is ever placed in an argument.
/// </summary>
public sealed class AppNotificationToastService : IToastPresenter
{
    private const int MaxTagLength = 60;

    /// <inheritdoc />
    public Task PresentAsync(ToastContent content, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(content);
        cancellationToken.ThrowIfCancellationRequested();

        try
        {
            var builder = new AppNotificationBuilder()
                .AddText(content.Title)
                .AddText(content.Body)
                .SetGroup(Trim(content.Group));

            foreach (var pair in ToastArguments.Decode(content.LaunchArguments))
            {
                builder.AddArgument(pair.Key, pair.Value);
            }

            if (content.Scenario == ToastScenario.Urgent)
            {
                builder.SetScenario(AppNotificationScenario.Urgent);
            }
            else if (content.Scenario == ToastScenario.Reminder)
            {
                builder.SetScenario(AppNotificationScenario.Reminder);
            }

            foreach (var action in content.Actions)
            {
                var button = new AppNotificationButton(action.Content);
                foreach (var pair in ToastArguments.Decode(action.Arguments))
                {
                    button.AddArgument(pair.Key, pair.Value);
                }

                builder.AddButton(button);
            }

            AppNotificationManager.Default.Show(builder.BuildNotification());
        }
        catch (Exception)
        {
            // No package identity / unsupported host — presenting a toast is best-effort.
        }

        return Task.CompletedTask;
    }

    private static string Trim(string value) => value.Length <= MaxTagLength ? value : value[..MaxTagLength];
}
