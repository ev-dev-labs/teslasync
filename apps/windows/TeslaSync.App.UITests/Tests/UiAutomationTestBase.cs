using TeslaSync.App.Core.Navigation;
using TeslaSync.App.UITests.Drivers;
using TeslaSync.App.UITests.Fixtures;

namespace TeslaSync.App.UITests.Tests;

/// <summary>
/// Shared behaviour for every UI automation test class: holds the WinAppDriver session and exposes
/// shell-level helpers (locate chrome, drive the NavigationView, read the route announcer) used across
/// the shell, auth, component, page-state, platform-polish and accessibility suites. Navigation
/// targets are derived from the real <see cref="RouteRegistry"/> so the tests track the app's actual
/// route surface rather than a hand-maintained copy.
/// </summary>
public abstract class UiAutomationTestBase(WinAppDriverSession session)
{
    /// <summary>The implicit per-find timeout used by the shell helpers.</summary>
    protected static readonly TimeSpan FindTimeout = TimeSpan.FromSeconds(10);

    /// <summary>The shared WinAppDriver session.</summary>
    protected WinAppDriverSession Session { get; } = session;

    /// <summary>The route registry the app navigates over.</summary>
    protected RouteRegistry Registry { get; } = new();

    /// <summary>Run a test body against the live client, capturing failure artifacts on throw.</summary>
    protected Task RunAsync(string testName, Func<WinAppDriverClient, Task> body)
        => Session.RunAsync(testName, body);

    /// <summary>Wait for a shell control by its <c>x:Name</c> / AutomationId.</summary>
    protected static Task<WinAppElement> ShellElementAsync(WinAppDriverClient client, string automationId)
        => client.WaitForElementAsync(By.AccessibilityId(automationId), FindTimeout);

    /// <summary>The representative (first navigable) route for a group, or null when the group is empty.</summary>
    protected RouteDefinition? RepresentativeRoute(RouteGroup group)
        => Registry.RoutesInGroup(group).FirstOrDefault();

    /// <summary>
    /// Expand the navigation pane and invoke the navigation item whose accessible name matches
    /// <paramref name="itemName"/> (the localized route title; its headless fallback is the route's
    /// default title). Returns false when no such item is present.
    /// </summary>
    protected static async Task<bool> ClickNavItemAsync(WinAppDriverClient client, string itemName)
    {
        var item = await client.TryFindElementAsync(By.Name(itemName)).ConfigureAwait(false);
        if (item is null)
        {
            return false;
        }

        await item.ClickAsync().ConfigureAwait(false);
        return true;
    }

    /// <summary>Read the active route's header title text.</summary>
    protected static async Task<string> HeaderTitleAsync(WinAppDriverClient client)
    {
        var header = await ShellElementAsync(client, ShellAutomationIds.HeaderTitle).ConfigureAwait(false);
        return await header.GetTextAsync().ConfigureAwait(false);
    }

    /// <summary>Read the status bar text.</summary>
    protected static async Task<string> StatusTextAsync(WinAppDriverClient client)
    {
        var status = await ShellElementAsync(client, ShellAutomationIds.StatusText).ConfigureAwait(false);
        return await status.GetTextAsync().ConfigureAwait(false);
    }

    /// <summary>
    /// Drive a global keyboard chord (WinAppDriver send-keys syntax). Modifier keys are released by
    /// the trailing null terminator WinAppDriver applies per call.
    /// </summary>
    protected static Task SendChordAsync(WinAppDriverClient client, string keys)
        => client.SendKeysAsync(keys);
}
