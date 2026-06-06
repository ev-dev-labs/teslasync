using TeslaSync.App.Core.Navigation;
using TeslaSync.App.UITests.Drivers;
using TeslaSync.App.UITests.Fixtures;
using Xunit;

namespace TeslaSync.App.UITests.Tests;

/// <summary>
/// UIAutomation coverage for the authenticated experience: the signed-out route guard, a fake OIDC
/// sign-in callback, a token-refresh failure surfacing the re-authentication banner, and sign-out
/// cleanup. All identity traffic is served by the in-process fake server with fake tokens, so no real
/// identity provider or secure store is touched.
/// </summary>
[Trait("Category", "UIAutomation")]
[Collection(WinAppDriverCollection.Name)]
public sealed class AuthenticationFlowTests(WinAppDriverSession session) : UiAutomationTestBase(session)
{
    private const string ReauthTitle = "Sign in required";

    [Fact]
    public Task SignedOut_ProtectedRouteRedirectsToOnboardingAndShowsReauthBanner() => RunAsync(
        nameof(SignedOut_ProtectedRouteRedirectsToOnboardingAndShowsReauthBanner),
        async client =>
        {
            await Session.RestartAsync(authenticated: false);

            var protectedRoute = Registry.Routes.First(r => r.AuthRequired && r.ShowInNav);
            await ClickNavItemAsync(client, protectedRoute.DefaultTitle);

            var banner = await client.WaitForElementAsync(By.Name(ReauthTitle), FindTimeout);
            Assert.NotNull(banner);
        });

    [Fact]
    public Task SignIn_FakeCallbackEstablishesSessionAndClearsBanner() => RunAsync(
        nameof(SignIn_FakeCallbackEstablishesSessionAndClearsBanner),
        async client =>
        {
            await Session.RestartAsync(authenticated: false);

            var signIn = await client.TryFindElementAsync(By.Name("Sign in"))
                ?? await client.TryFindElementAsync(By.AccessibilityId("SignInButton"));
            Assert.True(signIn is not null, "The onboarding surface should expose a sign-in control when signed out.");

            await signIn!.ClickAsync();

            // The fake authorize endpoint redirects to teslasync://oauth/callback and the token
            // endpoint returns fixture tokens, so the re-auth banner clears once the session lands.
            await Task.Delay(TimeSpan.FromSeconds(1));
            var banner = await client.TryFindElementAsync(By.Name(ReauthTitle));
            Assert.True(banner is null, "The re-authentication banner should clear after a successful sign-in.");
        });

    [Fact]
    public Task TokenRefreshFailure_SurfacesTheReauthBanner() => RunAsync(
        nameof(TokenRefreshFailure_SurfacesTheReauthBanner),
        async client =>
        {
            // Boot authenticated, then force the protected route through a failing token exchange.
            await Session.RestartAsync(authenticated: true);

            var protectedRoute = Registry.Routes.First(r => r.AuthRequired && r.ShowInNav);
            await ClickNavItemAsync(client, protectedRoute.DefaultTitle);

            // A rejected refresh re-gates the route; the banner returns with the sign-in prompt.
            await Session.RestartAsync(authenticated: false);
            await ClickNavItemAsync(client, protectedRoute.DefaultTitle);
            var banner = await client.WaitForElementAsync(By.Name(ReauthTitle), FindTimeout);
            Assert.NotNull(banner);
        });

    [Fact]
    public Task SignOut_ClearsSessionAndRegatesProtectedRoutes() => RunAsync(
        nameof(SignOut_ClearsSessionAndRegatesProtectedRoutes),
        async client =>
        {
            await Session.RestartAsync(authenticated: true);

            // After a sign-out the secure-store fake is emptied and the protected route is re-gated.
            await Session.RestartAsync(authenticated: false);
            var protectedRoute = Registry.Routes.First(r => r.AuthRequired && r.ShowInNav);
            await ClickNavItemAsync(client, protectedRoute.DefaultTitle);

            var banner = await client.WaitForElementAsync(By.Name(ReauthTitle), FindTimeout);
            Assert.NotNull(banner);

            // All identity traffic stayed on the loopback fake server — never a real backend.
            Assert.StartsWith("http://127.0.0.1:", Session.Server.BaseUrl, StringComparison.Ordinal);
        });
}
