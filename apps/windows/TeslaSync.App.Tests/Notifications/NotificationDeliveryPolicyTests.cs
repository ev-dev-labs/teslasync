using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Push;
using Xunit;

namespace TeslaSync.App.Tests.Notifications;

/// <summary>Verifies the foreground/background, quiet-hours, Focus Assist and settings coordination (P2/W8-0001).</summary>
public sealed class NotificationDeliveryPolicyTests
{
    private static readonly TimeOnly Noon = new(12, 0);

    private static NotificationContent Content(
        NotificationKind kind = NotificationKind.Alert,
        PushBannerSeverity severity = PushBannerSeverity.Warning) =>
        new(kind, "Title", "Body", severity, ToastScenario.Default, "notifications/inbox", null, Array.Empty<ToastAction>());

    private static QuietHours AllDay => new(true, new TimeOnly(0, 0), new TimeOnly(23, 59));

    [Fact]
    public void Foreground_shows_banner_not_toast()
    {
        var decision = NotificationDeliveryPolicy.Decide(Content(), NotificationSettings.Default, FocusAssistState.Off, true, Noon);

        Assert.True(decision.Ingest);
        Assert.True(decision.InAppBanner);
        Assert.False(decision.OsToast);
    }

    [Fact]
    public void Background_shows_toast_not_banner()
    {
        var decision = NotificationDeliveryPolicy.Decide(Content(), NotificationSettings.Default, FocusAssistState.Off, false, Noon);

        Assert.False(decision.InAppBanner);
        Assert.True(decision.OsToast);
    }

    [Fact]
    public void Background_quiet_hours_suppresses_toast()
    {
        var settings = NotificationSettings.Default with { QuietHours = new QuietHours(true, new TimeOnly(9, 0), new TimeOnly(17, 0)) };
        var decision = NotificationDeliveryPolicy.Decide(Content(), settings, FocusAssistState.Off, false, Noon);

        Assert.True(decision.Ingest);
        Assert.False(decision.OsToast);
    }

    [Theory]
    [InlineData(FocusAssistState.PriorityOnly)]
    [InlineData(FocusAssistState.AlarmsOnly)]
    public void Background_focus_assist_suppresses_toast(FocusAssistState state)
    {
        var decision = NotificationDeliveryPolicy.Decide(Content(), NotificationSettings.Default, state, false, Noon);
        Assert.False(decision.OsToast);
    }

    [Fact]
    public void Background_focus_off_shows_toast()
    {
        var decision = NotificationDeliveryPolicy.Decide(Content(), NotificationSettings.Default, FocusAssistState.Off, false, Noon);
        Assert.True(decision.OsToast);
    }

    [Fact]
    public void Disabled_kind_is_inbox_only_even_when_foreground()
    {
        var settings = NotificationSettings.Default with
        {
            EnabledKinds = new HashSet<NotificationKind>(NotificationSettings.AllKinds.Where(k => k != NotificationKind.Alert)),
        };

        var decision = NotificationDeliveryPolicy.Decide(Content(NotificationKind.Alert), settings, FocusAssistState.Off, true, Noon);

        Assert.True(decision.Ingest);
        Assert.False(decision.InAppBanner);
        Assert.False(decision.OsToast);
    }

    [Fact]
    public void Master_off_is_inbox_only()
    {
        var decision = NotificationDeliveryPolicy.Decide(Content(), NotificationSettings.Default with { Enabled = false }, FocusAssistState.Off, true, Noon);
        Assert.Equal(NotificationDelivery.InboxOnly, decision);
    }

    [Fact]
    public void Critical_breaks_through_quiet_hours_and_focus_assist()
    {
        var settings = NotificationSettings.Default with { QuietHours = AllDay };
        var decision = NotificationDeliveryPolicy.Decide(
            Content(severity: PushBannerSeverity.Critical), settings, FocusAssistState.AlarmsOnly, false, Noon);

        Assert.True(decision.OsToast);
    }

    [Fact]
    public void Critical_breaks_through_disabled_kind()
    {
        var settings = NotificationSettings.Default with { EnabledKinds = new HashSet<NotificationKind>() };
        var decision = NotificationDeliveryPolicy.Decide(
            Content(NotificationKind.Alert, PushBannerSeverity.Critical), settings, FocusAssistState.Off, false, Noon);

        Assert.True(decision.OsToast);
    }

    [Fact]
    public void Critical_without_breakthrough_is_suppressed_in_quiet_hours()
    {
        var settings = NotificationSettings.Default with { AllowCriticalBreakthrough = false, QuietHours = AllDay };
        var decision = NotificationDeliveryPolicy.Decide(
            Content(severity: PushBannerSeverity.Critical), settings, FocusAssistState.Off, false, Noon);

        Assert.False(decision.OsToast);
    }

    [Fact]
    public void Inbox_always_ingests()
    {
        var settings = NotificationSettings.Default with { Enabled = false, QuietHours = AllDay };
        var decision = NotificationDeliveryPolicy.Decide(Content(), settings, FocusAssistState.AlarmsOnly, false, Noon);
        Assert.True(decision.Ingest);
    }
}
