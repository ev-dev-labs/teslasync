using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using Xunit;

namespace TeslaSync.App.Tests.Notifications;

/// <summary>Verifies toast activations decode to valid routes and honor the dismiss action (P2/W8-0001).</summary>
public sealed class ToastActivationRouterTests
{
    private static readonly RouteRegistry Registry = new();

    [Fact]
    public void Resolve_navigate_routes_to_path()
    {
        var args = ToastArguments.For(ToastActions.Navigate, "charging/42", NotificationKind.ChargeComplete, "42");
        var activation = ToastActivationRouter.Resolve(args, Registry);

        Assert.True(activation.ShouldNavigate);
        Assert.Equal("charging/42", activation.RoutePath);
        Assert.Equal(NotificationKind.ChargeComplete, activation.Kind);
        Assert.Equal("42", activation.EntityId);
        Assert.False(activation.Match.Route.IsCatchAll);
    }

    [Fact]
    public void Resolve_dismiss_does_not_navigate()
    {
        var args = ToastArguments.For(ToastActions.Dismiss, "charging", NotificationKind.ChargeComplete);
        var activation = ToastActivationRouter.Resolve(args, Registry);

        Assert.False(activation.ShouldNavigate);
        Assert.Equal("charging", activation.RoutePath);
    }

    [Fact]
    public void Resolve_empty_arguments_defaults_to_inbox()
    {
        var activation = ToastActivationRouter.Resolve(null, Registry);

        Assert.True(activation.ShouldNavigate);
        Assert.Equal("notifications/inbox", activation.RoutePath);
    }

    [Fact]
    public void Resolve_unknown_route_falls_back_to_inbox()
    {
        var args = ToastArguments.For(ToastActions.Navigate, "no-such-route-zzz", NotificationKind.Generic);
        var activation = ToastActivationRouter.Resolve(args, Registry);

        Assert.Equal("notifications/inbox", activation.RoutePath);
        Assert.False(activation.Match.Route.IsCatchAll);
    }

    [Fact]
    public void Resolve_reauthenticate_navigates_to_settings()
    {
        var args = ToastArguments.For(ToastActions.Reauthenticate, "settings", NotificationKind.ReauthNeeded);
        var activation = ToastActivationRouter.Resolve(args, Registry);

        Assert.True(activation.ShouldNavigate);
        Assert.Equal("settings", activation.RoutePath);
    }
}
