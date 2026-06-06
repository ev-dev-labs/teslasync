using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Push;
using Xunit;

namespace TeslaSync.App.Tests.Notifications;

/// <summary>Verifies composition of localized, actionable, deep-linked, redactable toasts (P2/W8-0001).</summary>
public sealed class NotificationComposerTests
{
    private static readonly RouteRegistry Registry = new();

    private static readonly IReadOnlyDictionary<string, string> Empty =
        new Dictionary<string, string>(StringComparer.Ordinal);

    private static IReadOnlyDictionary<string, string> Data(params (string Key, string Value)[] pairs)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var pair in pairs)
        {
            map[pair.Key] = pair.Value;
        }

        return map;
    }

    private static PushPayload Payload(
        string kind,
        string? title = null,
        string? body = null,
        string? category = null,
        IReadOnlyDictionary<string, string>? data = null) =>
        new(kind, title, body, category, data ?? Empty);

    [Fact]
    public void Compose_prefers_payload_title_and_body()
    {
        var content = new NotificationComposer(Registry).Compose(Payload("charge_complete", "Done", "At 80%", "info"));
        Assert.Equal("Done", content.Title);
        Assert.Equal("At 80%", content.Body);
    }

    [Fact]
    public void Compose_falls_back_to_localized_kind_defaults()
    {
        var localizer = new RecordingLocalizer();
        var content = new NotificationComposer(Registry, localizer).Compose(Payload("reauth_needed"));

        Assert.Contains("notifications.kind.reauth_needed.title", localizer.RequestedKeys);
        Assert.Contains("notifications.kind.reauth_needed.body", localizer.RequestedKeys);
        Assert.Equal("Sign-in required", content.Title);
    }

    [Fact]
    public void Compose_uses_localized_override()
    {
        var localizer = new RecordingLocalizer(new Dictionary<string, string> { ["notifications.kind.alert.title"] = "Alerte" });
        var content = new NotificationComposer(Registry, localizer).Compose(Payload("alert"));
        Assert.Equal("Alerte", content.Title);
    }

    [Fact]
    public void Compose_charge_complete_deep_links_to_session()
    {
        var content = new NotificationComposer(Registry).Compose(Payload("charge_complete", data: Data(("session_id", "42"))));
        Assert.Equal("charging/42", content.RoutePath);
        Assert.Equal("42", content.EntityId);
    }

    [Fact]
    public void Compose_reauth_is_critical_and_urgent()
    {
        var content = new NotificationComposer(Registry).Compose(Payload("reauth_needed"));
        Assert.Equal(PushBannerSeverity.Critical, content.Severity);
        Assert.Equal(ToastScenario.Urgent, content.Scenario);
    }

    [Fact]
    public void Compose_alert_defaults_to_warning()
    {
        var content = new NotificationComposer(Registry).Compose(Payload("alert"));
        Assert.Equal(PushBannerSeverity.Warning, content.Severity);
        Assert.Equal(ToastScenario.Default, content.Scenario);
    }

    [Fact]
    public void Compose_category_can_elevate_to_critical()
    {
        var content = new NotificationComposer(Registry).Compose(Payload("alert", category: "critical"));
        Assert.Equal(PushBannerSeverity.Critical, content.Severity);
        Assert.Equal(ToastScenario.Urgent, content.Scenario);
    }

    [Fact]
    public void Compose_charge_complete_is_informational()
    {
        var content = new NotificationComposer(Registry).Compose(Payload("charge_complete"));
        Assert.Equal(PushBannerSeverity.Info, content.Severity);
    }

    [Fact]
    public void Compose_primary_action_navigates_to_deep_link()
    {
        var content = new NotificationComposer(Registry).Compose(Payload("charge_complete", data: Data(("session_id", "42"))));
        Assert.NotEmpty(content.Actions);

        var primary = ToastArguments.Decode(content.Actions[0].Arguments);
        Assert.Equal(ToastActions.Navigate, primary[ToastArguments.ActionKey]);
        Assert.Equal("charging/42", primary[ToastArguments.RouteKey]);
    }

    [Fact]
    public void Compose_command_result_offers_retry()
    {
        var content = new NotificationComposer(Registry).Compose(Payload("command_result"));
        Assert.Contains(content.Actions, a => ToastArguments.Decode(a.Arguments)[ToastArguments.ActionKey] == ToastActions.Retry);
    }

    [Fact]
    public void Compose_reauth_primary_action_reauthenticates()
    {
        var content = new NotificationComposer(Registry).Compose(Payload("reauth_needed"));
        var primary = ToastArguments.Decode(content.Actions[0].Arguments);
        Assert.Equal(ToastActions.Reauthenticate, primary[ToastArguments.ActionKey]);
    }

    [Fact]
    public void Compose_launch_arguments_navigate_to_route()
    {
        var content = new NotificationComposer(Registry).Compose(Payload("vehicle_state", data: Data(("vehicle_id", "7"))));
        var launch = ToastArguments.Decode(content.LaunchArguments);

        Assert.Equal("vehicles/7", launch[ToastArguments.RouteKey]);
        Assert.Equal(ToastActions.Navigate, launch[ToastArguments.ActionKey]);
    }

    [Fact]
    public void Compose_redacts_body_when_enabled()
    {
        var payload = Payload("vehicle_state", body: "Vehicle 5YJ3E1EA7KF000000 unlocked");

        var redacted = new NotificationComposer(Registry, localizer: null, redactSensitive: true).Compose(payload);
        Assert.DoesNotContain("5YJ3E1EA7KF000000", redacted.Body, StringComparison.Ordinal);

        var plain = new NotificationComposer(Registry).Compose(payload);
        Assert.Contains("5YJ3E1EA7KF000000", plain.Body, StringComparison.Ordinal);
    }

    [Fact]
    public void ToToast_carries_title_actions_and_launch()
    {
        var content = new NotificationComposer(Registry).Compose(Payload("alert", "A", "B", "warning"));
        var toast = content.ToToast();

        Assert.Equal(content.Title, toast.Title);
        Assert.Equal(content.LaunchArguments, toast.LaunchArguments);
        Assert.Equal(content.Actions, toast.Actions);
    }
}
