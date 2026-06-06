using TeslaSync.App.Core.Push;
using Xunit;

namespace TeslaSync.App.Tests.Push;

/// <summary>
/// Verifies the <see cref="ForegroundPushRouter"/> fans a decoded payload into the notifications
/// inbox, the W2 banner sink and the toast service, maps severity from the category, and ingests
/// (but raises no empty toast/banner) for a payload with no display text.
/// </summary>
public sealed class ForegroundPushRouterTests
{
    private static (ForegroundPushRouter Router, NotificationInbox Inbox, RecordingBannerSink Banner, RecordingToastService Toast) Build()
    {
        var inbox = new NotificationInbox();
        var banner = new RecordingBannerSink();
        var toast = new RecordingToastService();
        var router = new ForegroundPushRouter(inbox, banner, toast, new PushDiagnostics());
        return (router, inbox, banner, toast);
    }

    [Fact]
    public async Task RouteAsync_fans_payload_into_inbox_banner_and_toast()
    {
        var (router, inbox, banner, toast) = Build();
        var data = new Dictionary<string, string>(StringComparer.Ordinal) { ["route"] = "charging/42" };
        var payload = new PushPayload("charge_complete", "Charge complete", "Your car is at 80%", "alert", data);

        await router.RouteAsync(payload);

        var item = Assert.Single(inbox.Recent);
        Assert.Equal("charge_complete", item.Kind);

        var published = Assert.Single(banner.Published);
        Assert.Equal(PushBannerSeverity.Critical, published.Severity);
        Assert.Equal("Charge complete", published.Title);

        var shown = Assert.Single(toast.Shown);
        Assert.Equal("Your car is at 80%", shown.Body);
        Assert.Equal("charging/42", shown.LaunchArgument);
    }

    [Fact]
    public async Task RouteAsync_with_no_display_text_ingests_only()
    {
        var (router, inbox, banner, toast) = Build();
        var payload = new PushPayload("silent_sync", null, null, null, PushPayload.Unknown.Data);

        await router.RouteAsync(payload);

        Assert.Single(inbox.Recent);
        Assert.Empty(banner.Published);
        Assert.Empty(toast.Shown);
    }

    [Theory]
    [InlineData("warning", PushBannerSeverity.Warning)]
    [InlineData("security", PushBannerSeverity.Critical)]
    [InlineData("info", PushBannerSeverity.Info)]
    [InlineData(null, PushBannerSeverity.Info)]
    public async Task RouteAsync_maps_severity_from_category(string? category, PushBannerSeverity expected)
    {
        var (router, _, banner, _) = Build();
        var payload = new PushPayload("k", "Title", "Body", category, PushPayload.Unknown.Data);

        await router.RouteAsync(payload);

        Assert.Equal(expected, Assert.Single(banner.Published).Severity);
    }
}
