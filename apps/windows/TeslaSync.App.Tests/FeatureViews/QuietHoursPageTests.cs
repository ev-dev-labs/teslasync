using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.Notifications;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>QuietHoursPage</c> surface's Microsoft.UI-free logic — the registration
/// metadata (shell route name, web route path, diagnostics slug), the two page-tier i18n strings the header binds
/// (web <c>notifications.quietHours.title</c> / <c>notifications.quietHours.subtitle</c>), the PII-safe
/// <c>view.opened</c> diagnostics and the inert empty source the shell mounts the hosted panel over. Mirrors the
/// web spec (web/src/features/notifications/pages/QuietHoursPage.tsx); the WinUI view (PageContainer + the hosted
/// QuietHoursPanel) is exercised by the app build.
/// </summary>
public sealed class QuietHoursPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The two i18n keys the manifest requires the page to resolve (web key names).
    private static readonly string[] RequiredStringKeys =
    [
        "notifications.quietHours.subtitle",
        "notifications.quietHours.title",
    ];

    // ---- Registration --------------------------------------------------------------

    [Fact]
    public void Registration_mirrors_the_web_route_and_nav_name()
    {
        Assert.Equal("NotificationsQuietHours", QuietHoursPageRegistration.RouteName);
        Assert.Equal("notifications/quiet-hours", QuietHoursPageRegistration.Route);
        Assert.Equal("QuietHoursPage", QuietHoursPageRegistration.Slug);
    }

    [Fact]
    public void Registration_resolves_the_two_page_strings_with_web_defaults()
    {
        Assert.Equal("Quiet hours", QuietHoursPageRegistration.Title(Localizer));
        Assert.Equal(
            "Suppress non-critical notifications during a configurable window.",
            QuietHoursPageRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Registration_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => QuietHoursPageRegistration.Title(null!));
        Assert.Throws<ArgumentNullException>(() => QuietHoursPageRegistration.Subtitle(null!));
    }

    // ---- View-model ----------------------------------------------------------------

    [Fact]
    public void ViewModel_exposes_the_localized_title_subtitle_and_copy_link_route()
    {
        var vm = new QuietHoursPageViewModel(Localizer);

        Assert.Equal("Quiet hours", vm.Title);
        Assert.Equal("Suppress non-critical notifications during a configurable window.", vm.Subtitle);
        Assert.Equal("notifications/quiet-hours", QuietHoursPageViewModel.CopyLinkRoute);
    }

    [Fact]
    public void ViewModel_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();
        var vm = new QuietHoursPageViewModel(recorder);

        _ = vm.Title;
        _ = vm.Subtitle;

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void ViewModel_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => new QuietHoursPageViewModel(null!));
    }

    [Fact]
    public void ViewModel_records_a_pii_safe_view_opened_event()
    {
        var lines = new List<string>();
        var vm = new QuietHoursPageViewModel(Localizer, new QuietHoursPageDiagnostics(lines.Add));

        vm.NotifyOpened();

        Assert.Equal("view.opened slug=QuietHoursPage", Assert.Single(lines));
    }

    // ---- Empty source (the shell's inert default) ----------------------------------

    [Fact]
    public async Task EmptyQuietHoursSource_yields_one_empty_emission()
    {
        var emissions = new List<RepositoryResult<IReadOnlyList<QuietHoursWindow>>>();
        await foreach (var emission in EmptyQuietHoursSource.Instance.StreamAsync())
        {
            emissions.Add(emission);
        }

        var only = Assert.Single(emissions);
        Assert.Equal(LoadStatus.Empty, only.Status);
        Assert.Null(only.Value);
    }

    [Fact]
    public async Task EmptyQuietHoursSource_treats_writes_as_no_ops()
    {
        // The inert source never throws; create / update / delete complete without contacting a backend.
        await EmptyQuietHoursSource.Instance.SaveAsync(QuietHoursDraft.CreateDefault("UTC"));
        await EmptyQuietHoursSource.Instance.DeleteAsync(1);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
