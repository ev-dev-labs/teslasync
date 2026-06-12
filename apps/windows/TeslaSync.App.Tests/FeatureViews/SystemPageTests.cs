using System.ComponentModel;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.Admin;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SystemPage</c> surface's Microsoft.UI-free logic — the parity port of the web
/// page (web/src/features/admin/pages/SystemPage.tsx). The web page is an unrouted infrastructure-budget
/// dashboard that composes the RateLimitStatusPanel + QueueStatusPanel under a localized title/subtitle header
/// and owns no query. These tests assert the two manifest strings resolve through the bound
/// <see cref="SystemPageViewModel"/> with the web key names, the registration metadata, the language-refresh
/// re-resolution, the diagnostics event, and that the default empty panel sources resolve to the empty state
/// (never an indefinite spinner). The WinUI view is exercised by the app build; its header text is driven
/// entirely by the <see cref="SystemPageViewModel"/> state asserted here.
/// </summary>
public sealed class SystemPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 2 i18n keys the manifest requires the page to resolve (PARITY_REQUIRED=2).
    private static readonly string[] RequiredStringKeys =
    [
        "system.page.title",
        "system.page.subtitle",
    ];

    // ---- i18n key coverage (both manifest strings, through the bound state holder) -------------------

    [Fact]
    public void ViewModel_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = new SystemPageViewModel(recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Registration_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = SystemPageRegistration.Title(recorder);
        _ = SystemPageRegistration.Subtitle(recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Bound state holder copy (web defaults) ------------------------------------------------------

    [Fact]
    public void ViewModel_exposes_localized_title_and_subtitle()
    {
        var vm = new SystemPageViewModel(Localizer);

        Assert.Equal("System budgets", vm.Title);
        Assert.Equal(
            "Operator dashboard for the throttles and budgets that bound this TeslaSync deployment.",
            vm.Subtitle);
    }

    [Fact]
    public void Registration_exposes_the_web_default_strings()
    {
        Assert.Equal("System budgets", SystemPageRegistration.Title(Localizer));
        Assert.Equal(
            "Operator dashboard for the throttles and budgets that bound this TeslaSync deployment.",
            SystemPageRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Registration_metadata_is_stable()
    {
        Assert.Equal("SystemPage", SystemPageRegistration.Slug);
        Assert.Equal("System", SystemPageRegistration.RouteName);
    }

    // ---- Language refresh (web i18n re-render) -------------------------------------------------------

    [Fact]
    public void Refresh_reresolves_header_and_raises_property_changed()
    {
        var localizer = new MutableLocalizer
        {
            ["system.page.title"] = "System budgets",
            ["system.page.subtitle"] = "Operator dashboard …",
        };
        var vm = new SystemPageViewModel(localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        localizer["system.page.title"] = "Budgets système";
        localizer["system.page.subtitle"] = "Tableau de bord opérateur.";
        vm.Refresh();

        Assert.Equal("Budgets système", vm.Title);
        Assert.Equal("Tableau de bord opérateur.", vm.Subtitle);
        Assert.Contains(nameof(SystemPageViewModel.Title), changed);
        Assert.Contains(nameof(SystemPageViewModel.Subtitle), changed);
    }

    [Fact]
    public void Refresh_is_silent_when_copy_is_unchanged()
    {
        var vm = new SystemPageViewModel(Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Refresh();

        Assert.Empty(changed);
    }

    // ---- Diagnostics (PII-safe view.opened) ----------------------------------------------------------

    [Fact]
    public void Notify_opened_records_pii_safe_view_event()
    {
        var lines = new List<string>();
        var diagnostics = new SystemPageDiagnostics(lines.Add);
        var vm = new SystemPageViewModel(Localizer, diagnostics);

        vm.NotifyOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SystemPage", Assert.Single(lines));
    }

    // ---- Default empty panel sources resolve to the empty state --------------------------------------

    [Fact]
    public async Task EmptyRateLimitStatusSource_yields_a_single_empty_result()
    {
        var results = new List<RepositoryResult<RateLimitStatusSnapshot>>();
        await foreach (var result in EmptyRateLimitStatusSource.Instance.StreamStatusAsync())
        {
            results.Add(result);
        }

        var only = Assert.Single(results);
        Assert.Equal(LoadStatus.Empty, only.Status);
    }

    [Fact]
    public async Task EmptyQueueStatusSource_yields_a_single_empty_result()
    {
        var results = new List<RepositoryResult<QueueStatusSnapshot>>();
        await foreach (var result in EmptyQueueStatusSource.Instance.StreamStatusAsync())
        {
            results.Add(result);
        }

        var only = Assert.Single(results);
        Assert.Equal(LoadStatus.Empty, only.Status);
    }

    [Fact]
    public async Task Empty_sources_drive_the_panels_to_their_empty_state()
    {
        using var rateLimit = new RateLimitStatusViewModel(EmptyRateLimitStatusSource.Instance, Localizer);
        using var queue = new QueueStatusViewModel(EmptyQueueStatusSource.Instance, Localizer);

        await rateLimit.LoadAsync();
        await queue.LoadAsync();

        Assert.Equal(RateLimitPanelState.Empty, rateLimit.State);
        Assert.Equal(QueuePanelState.Empty, queue.State);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class MutableLocalizer : ILocalizer
    {
        private readonly Dictionary<string, string> _map = new(StringComparer.Ordinal);

        public string this[string key]
        {
            set => _map[key] = value;
        }

        public string GetString(string key, string fallback) =>
            _map.TryGetValue(key, out var value) ? value : fallback;
    }
}
