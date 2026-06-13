using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.Notifications;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the WebhooksPage feature-view's Microsoft.UI-free logic — the registration metadata
/// (web route <c>/notifications/webhooks</c>, nav name <c>Webhooks</c>), the localized <c>PageContainer</c> chrome
/// projection (the title + subtitle resolved from the web key names <c>notifications.webhooks.title</c> /
/// <c>notifications.webhooks.subtitle</c>), the view-model lifecycle + PII-safe diagnostics, and the inert default
/// webhook source the page feeds the embedded WebhookChannelsSection. Mirrors the web page spec
/// (web/src/features/notifications/pages/WebhooksPage.tsx). The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class WebhooksPageTests
{
    [Fact]
    public void Registration_mirrors_the_web_route_and_slug()
    {
        Assert.Equal("NotificationsWebhooks", WebhooksPageRegistration.RouteName);
        Assert.Equal("notifications/webhooks", WebhooksPageRegistration.RoutePath);
        Assert.Equal("WebhooksPage", WebhooksPageRegistration.Slug);
    }

    [Fact]
    public void Registration_resolves_the_title_and_subtitle_keys_with_web_defaults()
    {
        var localizer = new RecordingLocalizer();

        Assert.Equal("Webhooks", WebhooksPageRegistration.Title(localizer));
        Assert.Equal(
            "Custom HTTPS endpoints that receive HMAC-signed event payloads.",
            WebhooksPageRegistration.Subtitle(localizer));

        // Binding evidence: every visible literal flows through the keyed call site with the web key name.
        Assert.Equal("Webhooks", localizer.Requested["notifications.webhooks.title"]);
        Assert.Equal(
            "Custom HTTPS endpoints that receive HMAC-signed event payloads.",
            localizer.Requested["notifications.webhooks.subtitle"]);
    }

    [Fact]
    public void ViewModel_projects_the_localized_page_chrome()
    {
        var vm = new WebhooksPageViewModel(PassthroughLocalizer.Instance);

        Assert.Equal("Webhooks", vm.Display.Title);
        Assert.Equal(
            "Custom HTTPS endpoints that receive HMAC-signed event payloads.",
            vm.Display.Subtitle);
        Assert.Equal("Webhooks", vm.Display.AutomationName);
    }

    [Fact]
    public void NotifyOpened_records_a_single_pii_safe_view_opened_diagnostic()
    {
        var lines = new List<string>();
        var vm = new WebhooksPageViewModel(PassthroughLocalizer.Instance, new WebhooksPageDiagnostics(lines.Add));

        vm.NotifyOpened();

        Assert.Equal(new[] { "view.opened slug=WebhooksPage" }, lines);
    }

    [Fact]
    public async Task LoadAsync_completes_and_keeps_the_chrome()
    {
        var vm = new WebhooksPageViewModel(PassthroughLocalizer.Instance);

        await vm.LoadAsync();

        Assert.Equal("Webhooks", vm.Display.Title);
        Assert.Equal(
            "Custom HTTPS endpoints that receive HMAC-signed event payloads.",
            vm.Display.Subtitle);
    }

    [Fact]
    public async Task EmptyWebhookChannelsSource_yields_a_single_empty_snapshot()
    {
        var results = new List<RepositoryResult<WebhookChannelList>>();
        await foreach (var result in EmptyWebhookChannelsSource.Instance.StreamWebhooksAsync())
        {
            results.Add(result);
        }

        var only = Assert.Single(results);
        Assert.Equal(LoadStatus.Empty, only.Status);
    }

    /// <summary>An <see cref="ILocalizer"/> that records each requested (key, fallback) and returns the fallback.</summary>
    private sealed class RecordingLocalizer : ILocalizer
    {
        public Dictionary<string, string> Requested { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Requested[key] = fallback;
            return fallback;
        }
    }
}
