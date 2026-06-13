using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TwoFactorAuthPage</c> surface's Microsoft.UI-free logic — the registration
/// metadata (shell route name, web route path, diagnostics slug), the two page-tier i18n strings the header binds
/// (web <c>account.twoFactor.title</c> / <c>account.twoFactor.subtitle</c>), the PII-safe <c>view.opened</c>
/// diagnostics and the deep link the copy-link affordance writes. Mirrors the web spec
/// (web/src/features/settings/pages/TwoFactorAuthPage.tsx); the WinUI view (PageContainer + the hosted
/// TOTPEnrollmentSection) is exercised by the app build.
/// </summary>
public sealed class TwoFactorAuthPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The two i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "account.twoFactor.subtitle",
        "account.twoFactor.title",
    ];

    // ---- Registration --------------------------------------------------------------

    [Fact]
    public void Registration_mirrors_the_web_route_and_nav_name()
    {
        Assert.Equal("TwoFactorAuth", TwoFactorAuthPageRegistration.RouteName);
        Assert.Equal("account/2fa", TwoFactorAuthPageRegistration.Route);
        Assert.Equal("TwoFactorAuthPage", TwoFactorAuthPageRegistration.Slug);
    }

    [Fact]
    public void Registration_resolves_the_two_page_strings_with_web_defaults()
    {
        Assert.Equal("Two-factor authentication", TwoFactorAuthPageRegistration.Title(Localizer));
        Assert.Equal(
            "Add a second factor to your sign-in. Required for sensitive admin actions.",
            TwoFactorAuthPageRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Registration_uses_the_web_key_names_for_the_two_page_strings()
    {
        Assert.Equal("account.twoFactor.title", TwoFactorAuthPageRegistration.TitleKey);
        Assert.Equal("account.twoFactor.subtitle", TwoFactorAuthPageRegistration.SubtitleKey);
    }

    [Fact]
    public void Registration_builds_the_copy_link_deep_link_for_the_route()
    {
        Assert.Contains("account/2fa", TwoFactorAuthPageRegistration.CopyLinkUri());
    }

    [Fact]
    public void Registration_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => TwoFactorAuthPageRegistration.Title(null!));
        Assert.Throws<ArgumentNullException>(() => TwoFactorAuthPageRegistration.Subtitle(null!));
    }

    // ---- View-model ----------------------------------------------------------------

    [Fact]
    public void ViewModel_exposes_the_localized_title_subtitle_and_copy_link_route()
    {
        var vm = new TwoFactorAuthPageViewModel(Localizer);

        Assert.Equal("Two-factor authentication", vm.Title);
        Assert.Equal("Add a second factor to your sign-in. Required for sensitive admin actions.", vm.Subtitle);
        Assert.Equal("account/2fa", TwoFactorAuthPageViewModel.CopyLinkRoute);
    }

    [Fact]
    public void ViewModel_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();
        var vm = new TwoFactorAuthPageViewModel(recorder);

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
        Assert.Throws<ArgumentNullException>(() => new TwoFactorAuthPageViewModel(null!));
    }

    [Fact]
    public void ViewModel_records_a_pii_safe_view_opened_event()
    {
        var lines = new List<string>();
        var vm = new TwoFactorAuthPageViewModel(Localizer, new TwoFactorAuthPageDiagnostics(lines.Add));

        vm.NotifyOpened();

        Assert.Equal("view.opened slug=TwoFactorAuthPage", Assert.Single(lines));
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
