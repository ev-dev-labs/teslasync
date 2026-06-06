using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Push;
using Xunit;

namespace TeslaSync.App.Tests.Notifications;

/// <summary>Verifies the dispatcher fans a foreground push into inbox, banner and toast per policy (P2/W8-0001).</summary>
public sealed class NotificationDispatcherTests
{
    private static readonly IReadOnlyDictionary<string, string> Empty =
        new Dictionary<string, string>(StringComparer.Ordinal);

    private sealed record Harness(
        NotificationDispatcher Dispatcher,
        NotificationInbox Inbox,
        RecordingNotificationBanner Banner,
        RecordingToastPresenter Toast,
        NotificationDiagnostics Diagnostics);

    private static Harness Build(
        bool foreground,
        NotificationSettings? settings = null,
        FocusAssistState focus = FocusAssistState.Off,
        TimeOnly? now = null)
    {
        var registry = new RouteRegistry();
        var inbox = new NotificationInbox();
        var banner = new RecordingNotificationBanner();
        var toast = new RecordingToastPresenter();
        var diagnostics = new NotificationDiagnostics();
        var composer = new NotificationComposer(registry);
        var resolved = settings ?? NotificationSettings.Default;
        var clockTime = now ?? new TimeOnly(12, 0);

        var dispatcher = new NotificationDispatcher(
            inbox,
            banner,
            toast,
            composer,
            new FakeForeground(foreground),
            new FakeFocusAssist(focus),
            () => resolved,
            diagnostics,
            () => new DateTimeOffset(2026, 1, 1, clockTime.Hour, clockTime.Minute, 0, TimeSpan.Zero));

        return new Harness(dispatcher, inbox, banner, toast, diagnostics);
    }

    private static PushPayload Payload(string kind, string? title = null, string? body = null, string? category = null, IReadOnlyDictionary<string, string>? data = null) =>
        new(kind, title, body, category, data ?? Empty);

    [Fact]
    public async Task Foreground_ingests_and_banners_without_toast()
    {
        var harness = Build(foreground: true);

        await harness.Dispatcher.RouteAsync(Payload("alert", "Alert", "Body", "warning"));

        Assert.Single(harness.Inbox.Recent);
        Assert.Single(harness.Banner.Published);
        Assert.Empty(harness.Toast.Shown);
        Assert.Equal(1, harness.Diagnostics.Snapshot().BannersRaised);
    }

    [Fact]
    public async Task Background_ingests_and_toasts_without_banner()
    {
        var harness = Build(foreground: false);

        await harness.Dispatcher.RouteAsync(Payload("charge_complete", "Done", "At 80%", "info"));

        Assert.Single(harness.Inbox.Recent);
        Assert.Empty(harness.Banner.Published);
        var shown = Assert.Single(harness.Toast.Shown);
        Assert.Equal("Done", shown.Title);
        Assert.Equal(1, harness.Diagnostics.Snapshot().ToastsPresented);
    }

    [Fact]
    public async Task Background_toast_is_actionable_and_deep_linked()
    {
        var harness = Build(foreground: false);

        await harness.Dispatcher.RouteAsync(Payload("vehicle_state", "V", "B", data: new Dictionary<string, string> { ["vehicle_id"] = "7" }));

        var shown = Assert.Single(harness.Toast.Shown);
        Assert.NotEmpty(shown.Actions);
        Assert.Equal("vehicles/7", ToastArguments.Decode(shown.LaunchArguments)[ToastArguments.RouteKey]);
    }

    [Fact]
    public async Task Quiet_hours_background_is_inbox_only()
    {
        var settings = NotificationSettings.Default with { QuietHours = new QuietHours(true, new TimeOnly(0, 0), new TimeOnly(23, 59)) };
        var harness = Build(foreground: false, settings, now: new TimeOnly(12, 0));

        await harness.Dispatcher.RouteAsync(Payload("alert", "A", "B", "info"));

        Assert.Single(harness.Inbox.Recent);
        Assert.Empty(harness.Toast.Shown);
        Assert.Empty(harness.Banner.Published);
        Assert.Equal(1, harness.Diagnostics.Snapshot().ToastsSuppressed);
    }

    [Fact]
    public async Task Master_off_is_inbox_only()
    {
        var harness = Build(foreground: true, NotificationSettings.Default with { Enabled = false });

        await harness.Dispatcher.RouteAsync(Payload("alert", "A", "B"));

        Assert.Single(harness.Inbox.Recent);
        Assert.Empty(harness.Banner.Published);
        Assert.Empty(harness.Toast.Shown);
    }

    [Fact]
    public async Task Critical_breaks_through_quiet_hours()
    {
        var settings = NotificationSettings.Default with { QuietHours = new QuietHours(true, new TimeOnly(0, 0), new TimeOnly(23, 59)) };
        var harness = Build(foreground: false, settings, now: new TimeOnly(12, 0));

        await harness.Dispatcher.RouteAsync(Payload("reauth_needed", "Sign in", "Reconnect"));

        Assert.Single(harness.Toast.Shown);
    }
}
