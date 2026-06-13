using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.FeatureViews.Settings;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Tesla Orders page's Microsoft.UI-free logic — the page chrome the web
/// <c>TeslaOrdersPage</c> owns (web/src/features/admin/pages/TeslaOrdersPage.tsx): the two parity strings resolved
/// through the localizer (<c>orders.title</c> / <c>orders.subtitle</c>, the same web keys the hosted
/// <c>ActiveOrdersSection</c> uses), the view-model's title/subtitle projection + language <c>Reload</c>, and the
/// default local-state orders source the page hosts (a single empty snapshot + a no-op success refresh). The
/// Fluent view itself is a thin renderer exercised by the app build / UI-automation tier. Mirrors the web spec.
/// </summary>
public sealed class TeslaOrdersPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ---- Registration (the two parity strings + the route metadata) -----------------

    [Fact]
    public void Registration_resolves_the_two_parity_strings()
    {
        Assert.Equal("Active Orders", TeslaOrdersRegistration.Title(Localizer));
        Assert.Equal(
            "Vehicle orders and delivery tracking from Tesla",
            TeslaOrdersRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Registration_keeps_the_web_orders_keys_and_route_name()
    {
        Assert.Equal("translation.orders.title", TeslaOrdersRegistration.TitleKey);
        Assert.Equal("translation.orders.subtitle", TeslaOrdersRegistration.SubtitleKey);
        Assert.Equal("TeslaOrders", TeslaOrdersRegistration.RouteName);
        Assert.Equal("TeslaOrdersPage", TeslaOrdersRegistration.Slug);
    }

    [Fact]
    public void Registration_routes_every_string_through_the_localizer()
    {
        var recording = new RecordingLocalizer();
        _ = TeslaOrdersRegistration.Title(recording);
        _ = TeslaOrdersRegistration.Subtitle(recording);
        Assert.Contains("translation.orders.title", recording.Keys);
        Assert.Contains("translation.orders.subtitle", recording.Keys);
    }

    [Fact]
    public void Registration_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => TeslaOrdersRegistration.Title(null!));
        Assert.Throws<ArgumentNullException>(() => TeslaOrdersRegistration.Subtitle(null!));
    }

    // ---- View-model (the page chrome the thin view binds to) ------------------------

    [Fact]
    public void ViewModel_exposes_the_resolved_title_and_subtitle()
    {
        var vm = new TeslaOrdersPageViewModel(Localizer);
        Assert.Equal("Active Orders", vm.Title);
        Assert.Equal("Vehicle orders and delivery tracking from Tesla", vm.Subtitle);
    }

    [Fact]
    public void ViewModel_reload_raises_title_and_subtitle()
    {
        var vm = new TeslaOrdersPageViewModel(Localizer);
        var raised = new List<string>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName ?? string.Empty);

        vm.Reload();

        Assert.Contains(nameof(TeslaOrdersPageViewModel.Title), raised);
        Assert.Contains(nameof(TeslaOrdersPageViewModel.Subtitle), raised);
    }

    [Fact]
    public void ViewModel_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => new TeslaOrdersPageViewModel(null!));
    }

    // ---- Default local-state source (the host-injection empty feed) -----------------

    [Fact]
    public async Task EmptySource_streams_a_single_empty_snapshot()
    {
        var results = new List<RepositoryResult<OrdersSnapshot>>();
        await foreach (var result in EmptyActiveOrdersSource.Instance.StreamOrdersAsync())
        {
            results.Add(result);
        }

        var only = Assert.Single(results);
        Assert.Equal(LoadStatus.Empty, only.Status);
        Assert.Null(only.Error);
    }

    [Fact]
    public async Task EmptySource_refresh_is_a_noop_success()
    {
        var outcome = await EmptyActiveOrdersSource.Instance.RefreshAsync();
        Assert.True(outcome.Succeeded);
        Assert.Null(outcome.Error);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
