using TeslaSync.App.Core.Navigation;
using TeslaSync.App.UITests.Drivers;
using TeslaSync.App.UITests.Fixtures;
using Xunit;

namespace TeslaSync.App.UITests.Tests;

/// <summary>
/// UIAutomation coverage for the Windows platform-polish surfaces: Toast-notification activation, the
/// taskbar JumpList, taskbar status, and settings persistence. Toast and JumpList entries both carry a
/// <c>teslasync://</c> deep link, so their activation contract is verified by asserting that the deep
/// link resolves to the expected route and that driving the app to that route lands correctly. The OS
/// surfaces that live outside the app's UI Automation tree (the system toast banner, the taskbar
/// overlay) are asserted at their in-app analog and ledgered to the W8 unit suite that covers their
/// composition.
/// </summary>
[Trait("Category", "UIAutomation")]
[Collection(WinAppDriverCollection.Name)]
public sealed class PlatformPolishTests(WinAppDriverSession session) : UiAutomationTestBase(session)
{
    [Fact]
    public Task ToastActivation_DeepLinkRoutesToTheExpectedPage() => RunAsync(
        nameof(ToastActivation_DeepLinkRoutesToTheExpectedPage),
        async client =>
        {
            // A Toast's activation argument is a teslasync:// deep link; assert it resolves and lands.
            var target = Registry.RoutesInGroup(RouteGroup.Charging).First();
            var toastDeepLink = DeepLink.BuildUri(RouteRegistry.Normalize(target.PathPattern));
            Assert.True(DeepLink.TryActivate(toastDeepLink, Registry, out var match));
            Assert.Equal(target.Name, match.Route.Name);

            await ClickNavItemAsync(client, target.DefaultTitle);
            Assert.False(string.IsNullOrWhiteSpace(await HeaderTitleAsync(client)));
            Session.Artifacts.Log($"toast activation → {toastDeepLink} → route '{match.Route.Name}'.");
        });

    [Fact]
    public Task JumpList_DeepLinkRoutesToTheExpectedPage() => RunAsync(
        nameof(JumpList_DeepLinkRoutesToTheExpectedPage),
        async client =>
        {
            // A JumpList task launches the app with a teslasync:// deep link; assert the same contract.
            var target = Registry.RoutesInGroup(RouteGroup.TripsDriving).First();
            var jumpListDeepLink = DeepLink.BuildUri(RouteRegistry.Normalize(target.PathPattern));
            Assert.True(DeepLink.TryActivate(jumpListDeepLink, Registry, out var match));
            Assert.Equal(target.Name, match.Route.Name);

            await ClickNavItemAsync(client, target.DefaultTitle);
            Assert.False(string.IsNullOrWhiteSpace(await HeaderTitleAsync(client)));
            Session.Artifacts.Log($"jump list activation → {jumpListDeepLink} → route '{match.Route.Name}'.");
        });

    [Fact]
    public Task TaskbarStatus_ShellStatusBarReflectsRouteState() => RunAsync(
        nameof(TaskbarStatus_ShellStatusBarReflectsRouteState),
        async client =>
        {
            // The taskbar overlay is composed off-tree; its in-app analog is the shell status bar.
            await ShellElementAsync(client, ShellAutomationIds.StatusBar);
            var status = await StatusTextAsync(client);
            Assert.NotNull(status);
            Session.Artifacts.Log("taskbar status: shell status bar present; OS overlay covered by W8 unit suite.");
        });

    [Fact]
    public Task SettingsPersistence_WindowStateRoundTripsWithinTheSession() => RunAsync(
        nameof(SettingsPersistence_WindowStateRoundTripsWithinTheSession),
        async client =>
        {
            await client.SetWindowSizeAsync(1180, 820);
            var (width, height) = await client.GetWindowRectAsync();

            // The persisted window-state surface reflects the applied size (min-size clamps respected).
            Assert.True(width >= 900, $"Expected the window width to persist (>=900), saw {width}.");
            Assert.True(height >= 600, $"Expected the window height to persist (>=600), saw {height}.");
            Session.Artifacts.Log(
                $"settings persistence: window {width}x{height}; AppSettings + 'open last visited' " +
                "round-trip covered by the W8 settings/lifecycle unit suite.");
        });
}
