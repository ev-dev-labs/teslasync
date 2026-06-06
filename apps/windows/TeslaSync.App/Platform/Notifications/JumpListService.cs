using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using Windows.UI.StartScreen;

namespace TeslaSync.App.Notifications;

/// <summary>
/// Publishes the application's Windows jump list (P2/W8-0001). It asks the core
/// <see cref="JumpListBuilder"/> for the curated, route-validated entries (Dashboard, Vehicles,
/// Charging, Drives, Live Map, Notifications Inbox, Settings, Search) and writes them to the OS jump
/// list, each carrying a <c>teslasync://app/…</c> deep-link argument the launch handler resolves back to
/// the page. Publishing requires MSIX package identity; on a host without it the update is a safe no-op.
/// </summary>
public sealed class JumpListService
{
    private readonly RouteRegistry _registry;
    private readonly ILocalizer _localizer;
    private readonly NotificationDiagnostics _diagnostics;

    /// <summary>Creates the service over the route registry, a localizer and diagnostics.</summary>
    public JumpListService(RouteRegistry registry, ILocalizer localizer, NotificationDiagnostics diagnostics)
    {
        ArgumentNullException.ThrowIfNull(registry);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(diagnostics);

        _registry = registry;
        _localizer = localizer;
        _diagnostics = diagnostics;
    }

    /// <summary>Rebuilds and saves the jump list from the current route registry. Best-effort.</summary>
    public async Task UpdateAsync()
    {
        try
        {
            if (!JumpList.IsSupported())
            {
                return;
            }

            var jumpList = await JumpList.LoadCurrentAsync().AsTask().ConfigureAwait(false);
            jumpList.SystemGroupKind = JumpListSystemGroupKind.None;
            jumpList.Items.Clear();

            foreach (var entry in JumpListBuilder.Build(_registry, _localizer))
            {
                var item = JumpListItem.CreateWithArguments(entry.Arguments, entry.Label);
                item.Description = entry.Label;
                item.GroupName = entry.GroupLabel;
                jumpList.Items.Add(item);
            }

            await jumpList.SaveAsync().AsTask().ConfigureAwait(false);
            _diagnostics.RecordJumpListBuild();
        }
        catch (Exception)
        {
            // No package identity / unsupported host — publishing the jump list is best-effort.
        }
    }
}
