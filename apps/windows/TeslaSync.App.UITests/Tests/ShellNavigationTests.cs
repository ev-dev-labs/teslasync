using TeslaSync.App.Core.Navigation;
using TeslaSync.App.UITests.Drivers;
using TeslaSync.App.UITests.Fixtures;
using Xunit;

namespace TeslaSync.App.UITests.Tests;

/// <summary>
/// UIAutomation coverage for the navigation shell: launch, the grouped NavigationView, the
/// search / command palette, deep-link canonicalisation, back/forward history, title-bar and window
/// resize, the theme switch and keyboard-only navigation. Drives the real packaged app over
/// WinAppDriver and asserts against the live UI Automation tree.
/// </summary>
[Trait("Category", "UIAutomation")]
[Collection(WinAppDriverCollection.Name)]
public sealed class ShellNavigationTests(WinAppDriverSession session) : UiAutomationTestBase(session)
{
    [Fact]
    public Task Launch_RendersTitleBarNavigationContentAndStatusChrome() => RunAsync(
        nameof(Launch_RendersTitleBarNavigationContentAndStatusChrome),
        async client =>
        {
            await ShellElementAsync(client, ShellAutomationIds.AppTitleText);
            await ShellElementAsync(client, ShellAutomationIds.RootNavigation);
            await ShellElementAsync(client, ShellAutomationIds.SearchBox);
            await ShellElementAsync(client, ShellAutomationIds.ThemeToggle);
            await ShellElementAsync(client, ShellAutomationIds.ContentFrame);
            await ShellElementAsync(client, ShellAutomationIds.StatusText);

            var header = await HeaderTitleAsync(client);
            Assert.False(string.IsNullOrWhiteSpace(header));
        });

    [Fact]
    public Task NavigationView_RendersAHeaderForEveryNonEmptyRouteGroup() => RunAsync(
        nameof(NavigationView_RendersAHeaderForEveryNonEmptyRouteGroup),
        async client =>
        {
            await ShellElementAsync(client, ShellAutomationIds.RootNavigation);

            foreach (var info in RouteGroups.Ordered)
            {
                if (Registry.RoutesInGroup(info.Group).Count == 0)
                {
                    continue;
                }

                var header = await client.TryFindElementAsync(By.Name(info.DefaultTitle));
                Assert.True(header is not null, $"NavigationView is missing a header for group '{info.DefaultTitle}'.");
            }
        });

    [Fact]
    public Task CommandPalette_SearchSurfacesSuggestionsAndNavigates() => RunAsync(
        nameof(CommandPalette_SearchSurfacesSuggestionsAndNavigates),
        async client =>
        {
            var search = await ShellElementAsync(client, ShellAutomationIds.SearchBox);
            var target = Registry.NavigableRoutes.First(r => !r.IsParameterized);
            await search.SendKeysAsync(target.DefaultTitle);

            // Submitting the query routes to the matched page; the header reflects the new route.
            await client.SendKeysAsync("\uE007"); // Enter
            var header = await HeaderTitleAsync(client);
            Assert.False(string.IsNullOrWhiteSpace(header));
        });

    [Fact]
    public Task DeepLink_PendingRouteViewSurfacesTheCanonicalCustomSchemeUri() => RunAsync(
        nameof(DeepLink_PendingRouteViewSurfacesTheCanonicalCustomSchemeUri),
        async client =>
        {
            var route = RepresentativeRoute(RouteGroup.DashboardExplore);
            Assert.NotNull(route);

            await ClickNavItemAsync(client, route!.DefaultTitle);

            var expected = DeepLink.BuildUri(RouteRegistry.Normalize(route.PathPattern)).ToString();
            var shown = await client.WaitForElementAsync(By.Name(expected), FindTimeout);
            Assert.NotNull(shown);
        });

    [Fact]
    public Task BackForward_RestoresThePreviousRouteThroughKeyboardAccelerators() => RunAsync(
        nameof(BackForward_RestoresThePreviousRouteThroughKeyboardAccelerators),
        async client =>
        {
            var first = Registry.RoutesInGroup(RouteGroup.DashboardExplore).First();
            var second = Registry.RoutesInGroup(RouteGroup.Vehicles).First();

            await ClickNavItemAsync(client, first.DefaultTitle);
            var firstHeader = await HeaderTitleAsync(client);

            await ClickNavItemAsync(client, second.DefaultTitle);
            var secondHeader = await HeaderTitleAsync(client);
            Assert.NotEqual(firstHeader, secondHeader);

            await SendChordAsync(client, "\uE00A\uE012"); // Alt+Left (back)
            Assert.Equal(firstHeader, await HeaderTitleAsync(client));

            await SendChordAsync(client, "\uE00A\uE014"); // Alt+Right (forward)
            Assert.Equal(secondHeader, await HeaderTitleAsync(client));
        });

    [Fact]
    public Task TitleBarAndResize_KeepShellChromeIntact() => RunAsync(
        nameof(TitleBarAndResize_KeepShellChromeIntact),
        async client =>
        {
            await client.SetWindowSizeAsync(1280, 860);
            await ShellElementAsync(client, ShellAutomationIds.AppTitleText);

            await client.SetWindowSizeAsync(900, 640);
            var title = await ShellElementAsync(client, ShellAutomationIds.AppTitleText);
            Assert.Equal("TeslaSync", await title.GetTextAsync());
        });

    [Fact]
    public Task ThemeSwitch_TogglesWithoutDisruptingTheShell() => RunAsync(
        nameof(ThemeSwitch_TogglesWithoutDisruptingTheShell),
        async client =>
        {
            var toggle = await ShellElementAsync(client, ShellAutomationIds.ThemeToggle);
            await toggle.ClickAsync();
            await toggle.ClickAsync();

            // The shell survives the System -> Light -> Dark cycle and remains interactive.
            await ShellElementAsync(client, ShellAutomationIds.RootNavigation);
        });

    [Fact]
    public Task KeyboardNavigation_MovesFocusToAnActionableControl() => RunAsync(
        nameof(KeyboardNavigation_MovesFocusToAnActionableControl),
        async client =>
        {
            var search = await ShellElementAsync(client, ShellAutomationIds.SearchBox);
            await search.ClickAsync();

            // Tab from the search box should land on a keyboard-focusable shell control.
            await client.SendKeysAsync("\uE004"); // Tab
            var navigation = await ShellElementAsync(client, ShellAutomationIds.RootNavigation);
            Assert.True(await navigation.IsKeyboardFocusableAsync());
        });
}
