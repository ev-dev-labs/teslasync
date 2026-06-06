using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Shell;

namespace TeslaSync.App.Notifications;

/// <summary>
/// Adapts the shell's resource bridge to the headless <see cref="ILocalizer"/> contract (P2/W8-0001).
/// It lets the notification composer and jump-list builder resolve their keys through the same
/// <c>Strings/{lang}/Resources.resw</c> pipeline the navigation chrome uses, while staying testable via
/// the passthrough localizer in the core library.
/// </summary>
internal sealed class ShellLocalizer : ILocalizer
{
    /// <summary>The shared singleton instance.</summary>
    public static ShellLocalizer Instance { get; } = new();

    private ShellLocalizer()
    {
    }

    /// <inheritdoc />
    public string GetString(string key, string fallback) => Localization.Get(key, fallback);
}
