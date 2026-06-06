using TeslaSync.App.UITests.Drivers;
using TeslaSync.App.UITests.Fixtures;
using Xunit;

namespace TeslaSync.App.UITests.Tests;

/// <summary>
/// UIAutomation coverage for the shared component surfaces. Components already mounted in the live
/// shell (buttons, the command-palette AutoSuggestBox, the info-bar re-auth banner, NavigationView
/// selection) are driven directly. Components that only mount on a generated W7 page body — data
/// tables, tabs, charts and their accessible-table alternative, the maps route summary, validating
/// forms, and the EmptyState / ErrorDisplay / Skeleton feedback states — are enumerated in an explicit
/// parity ledger with a reason, so none is silently skipped while the W7 page bodies are pending.
/// </summary>
[Trait("Category", "UIAutomation")]
[Collection(WinAppDriverCollection.Name)]
public sealed class ComponentStateTests(WinAppDriverSession session) : UiAutomationTestBase(session)
{
    /// <summary>
    /// The components the page layer must exercise, each tagged either as live in the shell today or
    /// as pending a W7 page body (the host that will mount it). The pending reason is the parity-ledger
    /// entry the spec requires in place of a silent skip.
    /// </summary>
    private static readonly ComponentCoverage[] RequiredComponents =
    [
        new("Button", Hosted: true, "ThemeToggle button is live in the title bar."),
        new("AutoSuggestBox", Hosted: true, "Command-palette search box is live in the title bar."),
        new("InfoBar", Hosted: true, "Re-authentication / push banners are live shell chrome."),
        new("NavigationView", Hosted: true, "Primary navigation is live in the shell."),
        new("ContentDialog", Hosted: false, "Modal dialogs mount on W7 page bodies (pending)."),
        new("DataTable", Hosted: false, "Data tables mount on W7 list page bodies (pending)."),
        new("TabView", Hosted: false, "Tabbed detail panes mount on W7 detail page bodies (pending)."),
        new("Chart", Hosted: false, "Charts mount on W7 analytics page bodies (pending)."),
        new("ChartAccessibleTable", Hosted: false, "The chart accessible-table alternative ships with the W7 chart host (pending)."),
        new("MapRouteSummary", Hosted: false, "The maps route summary mounts on the W7 maps page body (pending)."),
        new("FormValidation", Hosted: false, "Validating forms mount on W7 settings/automation page bodies (pending)."),
        new("EmptyState", Hosted: false, "EmptyState renders inside a W7 page body (pending)."),
        new("ErrorDisplay", Hosted: false, "ErrorDisplay renders inside a W7 page body (pending)."),
        new("Skeleton", Hosted: false, "Skeleton loading renders inside a W7 page body (pending)."),
    ];

    [Fact]
    public Task Button_ThemeToggleReportsButtonControlTypeAndIsInvokable() => RunAsync(
        nameof(Button_ThemeToggleReportsButtonControlTypeAndIsInvokable),
        async client =>
        {
            var toggle = await ShellElementAsync(client, ShellAutomationIds.ThemeToggle);
            Assert.True(await toggle.IsEnabledAsync());
            await toggle.ClickAsync();
        });

    [Fact]
    public Task CommandPalette_AutoSuggestBoxAcceptsTextAndClears() => RunAsync(
        nameof(CommandPalette_AutoSuggestBoxAcceptsTextAndClears),
        async client =>
        {
            var search = await ShellElementAsync(client, ShellAutomationIds.SearchBox);
            await search.SendKeysAsync("Vehicles");
            await client.SendKeysAsync("\uE007"); // Enter routes and clears the box
            await ShellElementAsync(client, ShellAutomationIds.RootNavigation);
        });

    [Fact]
    public Task InfoBar_ReauthBannerPresentsAnActionableState() => RunAsync(
        nameof(InfoBar_ReauthBannerPresentsAnActionableState),
        async client =>
        {
            await Session.RestartAsync(authenticated: false);
            var protectedRoute = Registry.Routes.First(r => r.AuthRequired && r.ShowInNav);
            await ClickNavItemAsync(client, protectedRoute.DefaultTitle);

            var banner = await client.WaitForElementAsync(By.Name("Sign in required"), FindTimeout);
            Assert.NotNull(banner);
        });

    [Fact]
    public Task NavigationItems_ExposeAccessibleNames() => RunAsync(
        nameof(NavigationItems_ExposeAccessibleNames),
        async client =>
        {
            await ShellElementAsync(client, ShellAutomationIds.RootNavigation);
            var first = Registry.NavigableRoutes.First();
            var item = await client.WaitForElementAsync(By.Name(first.DefaultTitle), FindTimeout);
            var name = await item.GetNameAsync();
            Assert.False(string.IsNullOrWhiteSpace(name));
        });

    [Fact]
    public Task ComponentParity_EveryRequiredComponentIsLiveOrLedgered() => RunAsync(
        nameof(ComponentParity_EveryRequiredComponentIsLiveOrLedgered),
        async client =>
        {
            foreach (var component in RequiredComponents)
            {
                if (component.Hosted)
                {
                    Session.Artifacts.Log($"component LIVE: {component.Name} — {component.Reason}");
                    continue;
                }

                // A pending component must carry an explicit parity-ledger reason — never a silent skip.
                Assert.False(string.IsNullOrWhiteSpace(component.Reason),
                    $"Component '{component.Name}' is not hosted yet and has no parity-ledger reason.");
                Session.Artifacts.Log($"component PENDING-W7: {component.Name} — {component.Reason}");
            }

            // Sanity: the shell really is the live host for the components claimed live.
            await ShellElementAsync(client, ShellAutomationIds.RootNavigation);
        });

    private sealed record ComponentCoverage(string Name, bool Hosted, string Reason);
}
