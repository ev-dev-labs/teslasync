using System.Collections.Generic;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.Notifications;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ChannelsPage</c> surface's Microsoft.UI-free logic — the registration metadata,
/// the title/subtitle projection, the page view-model's chrome resolution and lifecycle no-ops, the empty
/// no-backend channels feed and the PII-safe diagnostics. Mirrors the web page
/// (web/src/features/notifications/pages/ChannelsPage.tsx), which is a titled, copy-link <c>PageContainer</c>
/// hosting the <c>NotificationChannelsView</c>. The WinUI view itself is exercised by the app build; its title /
/// subtitle / copy-link chrome is driven entirely by the <see cref="ChannelsPageDisplay"/> asserted here.
/// </summary>
public sealed class ChannelsPageTests
{
    // The two i18n keys the manifest requires the page to resolve (page:notifications/Channels, requiredCount=2).
    private static readonly string[] RequiredStringKeys =
    [
        "notifications.channels.subtitle",
        "notifications.channels.title",
    ];

    private const string ExpectedTitle = "Notification channels";

    private const string ExpectedSubtitle =
        "Where to send notifications: Discord, Slack, Telegram, email, ntfy, Pushover, or a custom webhook.";

    // ---- i18n key coverage (both manifest strings) ---------------------------------

    [Fact]
    public void Registration_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        // The running page resolves its chrome through the registration title + subtitle; together they must cover
        // every manifest key with the web key names.
        _ = ChannelsPageRegistration.Title(recorder);
        _ = ChannelsPageRegistration.Subtitle(recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Display_projects_the_web_title_and_subtitle_defaults()
    {
        var display = ChannelsPageDisplay.Project(PassthroughLocalizer.Instance);

        Assert.Equal(ExpectedTitle, display.Title);
        Assert.Equal(ExpectedSubtitle, display.Subtitle);
    }

    [Fact]
    public void Registration_metadata_matches_the_route_table()
    {
        Assert.Equal("NotificationsChannels", ChannelsPageRegistration.RouteName);
        Assert.Equal("ChannelsPage", ChannelsPageRegistration.Slug);
    }

    // ---- view-model (chrome resolution + lifecycle) --------------------------------

    [Fact]
    public void ViewModel_exposes_the_resolved_title_and_subtitle()
    {
        var vm = new ChannelsPageViewModel(PassthroughLocalizer.Instance);

        Assert.Equal(ExpectedTitle, vm.Title);
        Assert.Equal(ExpectedSubtitle, vm.Subtitle);
        Assert.Equal(ExpectedTitle, vm.Display.Title);
        Assert.Equal(ExpectedSubtitle, vm.Display.Subtitle);
    }

    [Fact]
    public async Task LoadAsync_and_RefreshAsync_re_resolve_the_chrome()
    {
        var vm = new ChannelsPageViewModel(PassthroughLocalizer.Instance);

        await vm.LoadAsync();
        Assert.Equal(ExpectedTitle, vm.Title);

        await vm.RefreshAsync();
        Assert.Equal(ExpectedSubtitle, vm.Subtitle);
    }

    [Fact]
    public void ViewModel_reflects_a_localized_override()
    {
        var localizer = new StubLocalizer(new Dictionary<string, string>
        {
            ["notifications.channels.title"] = "Canales de notificación",
            ["notifications.channels.subtitle"] = "Adónde enviar las notificaciones.",
        });

        var vm = new ChannelsPageViewModel(localizer);

        Assert.Equal("Canales de notificación", vm.Title);
        Assert.Equal("Adónde enviar las notificaciones.", vm.Subtitle);
    }

    // ---- empty no-backend feed -----------------------------------------------------

    [Fact]
    public async Task Empty_source_streams_one_empty_channel_snapshot()
    {
        var results = new List<RepositoryResult<NotificationChannelList>>();
        await foreach (var emission in EmptyNotificationChannelsSource.Instance.StreamChannelsAsync())
        {
            results.Add(emission);
        }

        Assert.Single(results);
        Assert.Equal(LoadStatus.Empty, results[0].Status);
        Assert.False(results[0].HasValue);
    }

    [Fact]
    public async Task Empty_source_streams_one_empty_stats_snapshot()
    {
        var results = new List<RepositoryResult<NotificationChannelStats>>();
        await foreach (var emission in EmptyNotificationChannelsSource.Instance.StreamStatsAsync())
        {
            results.Add(emission);
        }

        Assert.Single(results);
        Assert.Equal(LoadStatus.Empty, results[0].Status);
        Assert.False(results[0].HasValue);
    }

    [Fact]
    public async Task Empty_source_test_mutation_reports_no_success()
    {
        var outcome = await EmptyNotificationChannelsSource.Instance.TestAsync(7);

        Assert.False(outcome.Success);
        Assert.Null(outcome.Error);
    }

    // ---- diagnostics ---------------------------------------------------------------

    [Fact]
    public void Diagnostics_record_view_opened_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChannelsPageDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Contains("view.opened slug=ChannelsPage", lines);
    }

    // ---- test doubles --------------------------------------------------------------

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class StubLocalizer(IReadOnlyDictionary<string, string> values) : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string> _values = values;

        public string GetString(string key, string fallback) =>
            _values.TryGetValue(key, out var value) ? value : fallback;
    }
}
