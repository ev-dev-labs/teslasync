using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>PrivacyPage</c> surface's Microsoft.UI-free logic — the registration metadata
/// (shell route name, web route path, diagnostics slug), the two page-tier i18n strings the header binds
/// (web <c>account.privacy.title</c> / <c>account.privacy.subtitle</c>), the PII-safe <c>view.opened</c>
/// diagnostics, the deep link the copy-link affordance writes, and the no-backend
/// <see cref="EmptyConsentRequirementSource"/> the shell-registered page hosts its section against. Mirrors the web
/// spec (web/src/features/settings/pages/PrivacyPage.tsx); the WinUI view (PageContainer + the hosted
/// PrivacySection) is exercised by the app build.
/// </summary>
public sealed class PrivacyPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The two i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "account.privacy.subtitle",
        "account.privacy.title",
    ];

    // ---- Registration --------------------------------------------------------------

    [Fact]
    public void Registration_mirrors_the_web_route_and_nav_name()
    {
        Assert.Equal("Privacy", PrivacyPageRegistration.RouteName);
        Assert.Equal("account/privacy", PrivacyPageRegistration.Route);
        Assert.Equal("PrivacyPage", PrivacyPageRegistration.Slug);
    }

    [Fact]
    public void Registration_resolves_the_two_page_strings_with_web_defaults()
    {
        Assert.Equal("Privacy", PrivacyPageRegistration.Title(Localizer));
        Assert.Equal(
            "Manage browser-local data: recently viewed pages and cookies / analytics consent.",
            PrivacyPageRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Registration_uses_the_web_key_names_for_the_two_page_strings()
    {
        Assert.Equal("account.privacy.title", PrivacyPageRegistration.TitleKey);
        Assert.Equal("account.privacy.subtitle", PrivacyPageRegistration.SubtitleKey);
    }

    [Fact]
    public void Registration_builds_the_copy_link_deep_link_for_the_route()
    {
        Assert.Contains("account/privacy", PrivacyPageRegistration.CopyLinkUri());
    }

    [Fact]
    public void Registration_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => PrivacyPageRegistration.Title(null!));
        Assert.Throws<ArgumentNullException>(() => PrivacyPageRegistration.Subtitle(null!));
    }

    // ---- View-model ----------------------------------------------------------------

    [Fact]
    public void ViewModel_exposes_the_localized_title_subtitle_and_copy_link_route()
    {
        var vm = new PrivacyPageViewModel(Localizer);

        Assert.Equal("Privacy", vm.Title);
        Assert.Equal(
            "Manage browser-local data: recently viewed pages and cookies / analytics consent.",
            vm.Subtitle);
        Assert.Equal("account/privacy", PrivacyPageViewModel.CopyLinkRoute);
    }

    [Fact]
    public void ViewModel_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();
        var vm = new PrivacyPageViewModel(recorder);

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
        Assert.Throws<ArgumentNullException>(() => new PrivacyPageViewModel(null!));
    }

    [Fact]
    public void ViewModel_records_a_pii_safe_view_opened_event()
    {
        var lines = new List<string>();
        var vm = new PrivacyPageViewModel(Localizer, new PrivacyPageDiagnostics(lines.Add));

        vm.NotifyOpened();

        Assert.Equal("view.opened slug=PrivacyPage", Assert.Single(lines));
    }

    // ---- No-backend consent-requirement source -------------------------------------

    [Fact]
    public void EmptyConsentRequirementSource_is_a_singleton()
    {
        Assert.Same(EmptyConsentRequirementSource.Instance, EmptyConsentRequirementSource.Instance);
    }

    [Fact]
    public async Task EmptyConsentRequirementSource_streams_loading_then_a_successful_empty()
    {
        var results = new List<RepositoryResult<bool>>();
        await foreach (var result in EmptyConsentRequirementSource.Instance.StreamAsync())
        {
            results.Add(result);
        }

        Assert.Equal(2, results.Count);
        Assert.Equal(LoadStatus.Loading, results[0].Status);

        // The terminal emission is a successful-but-empty read — the section maps it to "consent not required"
        // (web Boolean(versionQuery.data?.require_cookie_consent) coalesces undefined to false).
        Assert.Equal(LoadStatus.Empty, results[1].Status);
        Assert.Null(results[1].Error);
    }

    [Fact]
    public async Task EmptyConsentRequirementSource_honors_a_cancelled_token()
    {
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
        {
            await foreach (var _ in EmptyConsentRequirementSource.Instance.StreamAsync(cts.Token))
            {
            }
        });
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
