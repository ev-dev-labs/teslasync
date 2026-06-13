using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.Notifications;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>BrowserNotificationsPage</c> surface's Microsoft.UI-free logic — the
/// page-tier registration (the two i18n strings the parity manifest requires, the route / slug constants and the
/// shareable copy-link deep link) and the shell-default browser-tab-signals source (the empty data state the
/// embedded <c>NotificationSettings</c> renders from). The WinUI view itself is exercised by the app build; it is
/// a thin <c>PageContainer</c> wrapper around the already-tested <c>NotificationSettings</c> surface. Mirrors the
/// web spec (web/src/features/notifications/pages/BrowserNotificationsPage.tsx).
/// </summary>
public sealed class BrowserNotificationsPageTests
{
    // The two i18n keys the manifest requires the page to resolve (web key names).
    private static readonly string[] RequiredStringKeys =
    [
        "notifications.browser.subtitle",
        "notifications.browser.title",
    ];

    // ---- Strings -------------------------------------------------------------------

    [Fact]
    public void Title_resolves_the_web_key_with_the_web_fallback()
    {
        Assert.Equal("notifications.browser.title", BrowserNotificationsRegistration.TitleKey);
        Assert.Equal("Browser notifications", BrowserNotificationsRegistration.TitleFallback);
        Assert.Equal("Browser notifications", BrowserNotificationsRegistration.Title(PassthroughLocalizer.Instance));
    }

    [Fact]
    public void Subtitle_resolves_the_web_key_with_the_web_fallback()
    {
        Assert.Equal("notifications.browser.subtitle", BrowserNotificationsRegistration.SubtitleKey);
        Assert.Equal(
            "Native browser push notifications when alerts fire.",
            BrowserNotificationsRegistration.SubtitleFallback);
        Assert.Equal(
            "Native browser push notifications when alerts fire.",
            BrowserNotificationsRegistration.Subtitle(PassthroughLocalizer.Instance));
    }

    [Fact]
    public void Registration_resolves_every_required_string_key_from_the_catalog()
    {
        var localizer = new RecordingLocalizer(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["notifications.browser.title"] = "Catalog title",
            ["notifications.browser.subtitle"] = "Catalog subtitle",
        });

        Assert.Equal("Catalog title", BrowserNotificationsRegistration.Title(localizer));
        Assert.Equal("Catalog subtitle", BrowserNotificationsRegistration.Subtitle(localizer));

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, localizer.RequestedKeys);
        }
    }

    // ---- Registration --------------------------------------------------------------

    [Fact]
    public void Registration_mirrors_the_web_route_and_slug()
    {
        Assert.Equal("NotificationsBrowser", BrowserNotificationsRegistration.RouteName);
        Assert.Equal("notifications/browser", BrowserNotificationsRegistration.Route);
        Assert.Equal("BrowserNotificationsPage", BrowserNotificationsRegistration.Slug);
    }

    [Fact]
    public void CopyLinkUri_is_the_canonical_route_deep_link()
    {
        Assert.Equal("teslasync://app/notifications/browser", BrowserNotificationsRegistration.CopyLinkUri());
    }

    // ---- Default tab-signals source ------------------------------------------------

    [Fact]
    public async Task Default_tab_signals_source_resolves_to_the_empty_state()
    {
        var results = new List<RepositoryResult<NotificationTabSignals>>();
        await foreach (var result in EmptyNotificationTabSignalsSource.Instance.StreamAsync())
        {
            results.Add(result);
        }

        var only = Assert.Single(results);
        Assert.Equal(LoadStatus.Empty, only.Status);
    }

    [Fact]
    public async Task Default_tab_signals_source_accepts_a_save_as_a_no_op()
    {
        // The save path is inert for the shell-default source (web parity — the surface keeps its optimistic value).
        await EmptyNotificationTabSignalsSource.Instance.SaveAsync(NotificationTabSignals.Default);
    }

    /// <summary>An <see cref="ILocalizer"/> that records requested keys and can map a few of them.</summary>
    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string> _map;

        public RecordingLocalizer(IReadOnlyDictionary<string, string> map) => _map = map;

        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return _map.TryGetValue(key, out var value) ? value : fallback;
        }
    }
}
