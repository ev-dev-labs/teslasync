using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Battery;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the WinUI <c>EnergyProductsPage</c>'s UI-thread-free logic — the energy-sites and
/// site-info JSON parse adapters, the projections (summary stat cards, the per-site card with its Charge /
/// Capacity / Type stats and capability chips, and the configuration section with the backup-reserve gauge,
/// the Powerwalls / Rated Power / Rated Energy stats and the Time-of-Use rate-plan panel), the cache-then-network
/// result mappers, the page + card state-holder per-state transitions (loading / loaded / empty / error / stale /
/// offline), card reconciliation, the i18n key coverage, the registration metadata and the diagnostics. Mirrors
/// the web spec (web/src/features/battery/pages/EnergyProductsPage.tsx).
/// </summary>
public sealed class EnergyProductsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    /// <summary>Every visible literal the page renders (web key names) — parity string coverage (33).</summary>
    private static readonly string[] RequiredStringKeys =
    [
        "energy.products.backup", "energy.products.backupCapable", "energy.products.battery",
        "energy.products.capacity", "energy.products.charge", "energy.products.empty",
        "energy.products.grid", "energy.products.lastFetched", "energy.products.refresh",
        "energy.products.solar", "energy.products.stormActive", "energy.products.stormWatch",
        "energy.products.subtitle", "energy.products.title", "energy.products.totalSites",
        "energy.products.type", "energy.products.unnamed", "energy.products.withBattery",
        "energy.products.withSolar",
        "energy.siteInfo.backupReserve", "energy.siteInfo.batteryCount", "energy.siteInfo.empty",
        "energy.siteInfo.firmware", "energy.siteInfo.lastFetched", "energy.siteInfo.operationMode",
        "energy.siteInfo.ratedEnergy", "energy.siteInfo.ratedPower", "energy.siteInfo.refresh",
        "energy.siteInfo.title",
        "energy.tou.editPlan", "energy.tou.noPlan", "energy.tou.sectionTitle", "energy.tou.updateButton",
    ];

    private static EnergySite SampleSite(
        long energySiteId = 123,
        string name = "Home",
        string resourceType = "battery",
        bool touCapable = true) => new(
        Id: energySiteId,
        EnergySiteId: energySiteId,
        ResourceType: resourceType,
        SiteName: name,
        TotalPackEnergyWh: 13_500,
        PercentageCharged: 82.5,
        BatteryType: "ac_powerwall",
        BackupCapable: true,
        StormModeEnabled: true,
        HasSolar: true,
        HasBattery: true,
        HasGrid: true,
        TouCapable: touCapable,
        StormModeCapable: true,
        FetchedAt: Now);

    private static EnergySiteInfo SampleInfo(string? tariffName = "PG&E EV2-A") => new(
        DefaultRealMode: "autonomous",
        BackupReservePercent: 20,
        BatteryCount: 2,
        NameplatePowerW: 10_000,
        NameplateEnergyWh: 27_000,
        Version: "23.44.0",
        InstallationTimeZone: "America/Los_Angeles",
        TouCapable: true,
        TariffName: tariffName,
        Components: new[] { new EnergyComponentFlag("battery", true), new EnergyComponentFlag("solar", true) },
        FetchedAt: Now);

    // ---- Parse adapter: sites -------------------------------------------------------

    [Fact]
    public void Sites_FromJson_reads_snake_case_array()
    {
        const string json = """
        [
          {"id":7,"energy_site_id":123,"resource_type":"battery","site_name":"Home","total_pack_energy":13500,
           "percentage_charged":82.5,"battery_type":"ac_powerwall","backup_capable":true,"storm_mode_enabled":true,
           "has_solar":true,"has_battery":true,"has_grid":true,"tou_capable":true,"storm_mode_capable":true,
           "fetched_at":"2026-06-06T12:00:00Z"},
          {"id":8,"energy_site_id":456,"resource_type":"solar","site_name":"Cabin","has_solar":true,"has_battery":false,
           "backup_capable":false,"fetched_at":"2026-06-06T12:00:00Z"}
        ]
        """;
        using var doc = JsonDocument.Parse(json);

        var snapshot = EnergyProductsSnapshot.FromJson(doc.RootElement);

        Assert.Equal(2, snapshot.Total);
        Assert.Equal(123, snapshot.Sites[0].EnergySiteId);
        Assert.Equal("battery", snapshot.Sites[0].ResourceType);
        Assert.Equal(13500, snapshot.Sites[0].TotalPackEnergyWh);
        Assert.Equal(82.5, snapshot.Sites[0].PercentageCharged);
        Assert.True(snapshot.Sites[0].BackupCapable);
        Assert.Equal(2, snapshot.WithSolar);
        Assert.Equal(1, snapshot.WithBattery);
        Assert.Equal(1, snapshot.BackupCapable);
        Assert.True(snapshot.HasSites);
    }

    [Fact]
    public void Sites_FromJson_is_tolerant_of_missing_fields_and_non_array()
    {
        using var partial = JsonDocument.Parse("""[{"energy_site_id":1}]""");
        var snapshot = EnergyProductsSnapshot.FromJson(partial.RootElement);
        Assert.Single(snapshot.Sites);
        Assert.Equal(string.Empty, snapshot.Sites[0].ResourceType);
        Assert.Null(snapshot.Sites[0].TotalPackEnergyWh);

        using var obj = JsonDocument.Parse("{}");
        Assert.Same(EnergyProductsSnapshot.Empty, EnergyProductsSnapshot.FromJson(obj.RootElement));

        using var empty = JsonDocument.Parse("[]");
        Assert.Same(EnergyProductsSnapshot.Empty, EnergyProductsSnapshot.FromJson(empty.RootElement));
    }

    // ---- Parse adapter: site info ---------------------------------------------------

    [Fact]
    public void SiteInfo_FromResponse_reads_wrapper_and_components()
    {
        const string json = """
        {"data":{"default_real_mode":"self_consumption","backup_reserve_percent":35,"battery_count":3,
          "nameplate_power":15000,"nameplate_energy":40500,"version":"24.1.0","installation_time_zone":"America/New_York",
          "components":{"solar":true,"battery":true,"grid":false,"tou_capable":true},
          "tariff_content_v2":{"name":"ConEd Rate"}},
         "fetched_at":"2026-06-06T12:00:00Z"}
        """;
        using var doc = JsonDocument.Parse(json);

        Assert.True(EnergySiteInfo.HasData(doc.RootElement));
        var info = EnergySiteInfo.FromResponse(doc.RootElement);

        Assert.Equal("self_consumption", info.DefaultRealMode);
        Assert.Equal(35, info.BackupReservePercent);
        Assert.Equal(3, info.BatteryCount);
        Assert.Equal(15000, info.NameplatePowerW);
        Assert.Equal(40500, info.NameplateEnergyWh);
        Assert.Equal("24.1.0", info.Version);
        Assert.True(info.TouCapable);
        Assert.Equal("ConEd Rate", info.TariffName);
        Assert.Equal(4, info.Components.Count);
        Assert.NotNull(info.FetchedAt);
    }

    [Fact]
    public void SiteInfo_FromResponse_treats_null_data_as_empty()
    {
        using var doc = JsonDocument.Parse("""{"data":null,"fetched_at":null}""");
        Assert.False(EnergySiteInfo.HasData(doc.RootElement));
        Assert.Same(EnergySiteInfo.Empty, EnergySiteInfo.FromResponse(doc.RootElement));
    }

    [Fact]
    public void SiteInfo_FromResponse_reads_nested_tou_settings_tariff_name()
    {
        const string json = """
        {"data":{"default_real_mode":"backup","tou_settings":{"tariff_content_v2":{"name":"Nested Plan"}}}}
        """;
        using var doc = JsonDocument.Parse(json);

        var info = EnergySiteInfo.FromResponse(doc.RootElement);

        Assert.Equal("Nested Plan", info.TariffName);
    }

    // ---- Projection: i18n coverage --------------------------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        // Summary keys, the card keys (blank name exercises `unnamed`), and the site-info / TOU keys
        // (null tariff exercises `tou.noPlan`) — collectively the full 33-key parity surface.
        EnergyProductsProjection.Project(new EnergyProductsSnapshot(new[] { SampleSite() }), recorder);
        EnergyProductsProjection.ProjectCard(SampleSite(name: string.Empty), recorder);
        EnergyProductsProjection.ProjectSiteInfo(SampleInfo(tariffName: null), touCapableFromSite: true, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Projection: summary stat panels --------------------------------------------

    [Fact]
    public void Projection_builds_four_summary_stats()
    {
        var snapshot = new EnergyProductsSnapshot(new[]
        {
            SampleSite(energySiteId: 1),
            SampleSite(energySiteId: 2, resourceType: "solar"),
        });

        var view = EnergyProductsProjection.Project(snapshot, Localizer);

        Assert.Equal("Energy Sites", view.TotalSites.Label);
        Assert.Equal("2", view.TotalSites.Value);
        Assert.Equal("With Solar", view.WithSolar.Label);
        Assert.Equal("2", view.WithSolar.Value);
        Assert.Equal("With Battery", view.WithBattery.Label);
        Assert.Equal("2", view.WithBattery.Value);
        Assert.Equal("Backup Capable", view.BackupCapable.Label);
        Assert.Equal("2", view.BackupCapable.Value);
        Assert.Equal("Energy Products", view.Title);
        Assert.Equal("Refresh from Tesla", view.RefreshLabel);

        foreach (var stat in new[] { view.TotalSites, view.WithSolar, view.WithBattery, view.BackupCapable })
        {
            Assert.False(string.IsNullOrWhiteSpace(stat.AutomationName));
            Assert.False(string.IsNullOrWhiteSpace(stat.Glyph));
        }
    }

    // ---- Projection: site card ------------------------------------------------------

    [Fact]
    public void ProjectCard_builds_header_stats_and_capability_chips()
    {
        var view = EnergyProductsProjection.ProjectCard(SampleSite(), Localizer);

        Assert.Equal("Home", view.SiteName);
        Assert.Equal("Powerwall", view.ResourceLabel);
        Assert.Contains("ID 123", view.SubLabel, StringComparison.Ordinal);
        Assert.Equal("ac_powerwall", view.BatteryType);

        Assert.Equal("Charge", view.Charge.Label);
        Assert.Equal("82.5%", view.Charge.Value);
        Assert.Equal("Capacity", view.Capacity.Label);
        Assert.Equal("13.5 kWh", view.Capacity.Value);
        Assert.Equal("Type", view.Type.Label);
        Assert.Equal("Powerwall", view.Type.Value);

        Assert.Equal(5, view.Capabilities.Count);
        Assert.Equal("Solar", view.Capabilities[0].Label);
        Assert.True(view.Capabilities[0].Active);
        Assert.True(view.StormActive);
        Assert.Equal("Storm Mode Active", view.StormActiveLabel);
        Assert.Contains("Last fetched", view.LastFetchedLabel, StringComparison.Ordinal);
    }

    [Fact]
    public void ProjectCard_uses_unnamed_fallback_and_em_dash_for_missing_charge()
    {
        var site = SampleSite(name: "  ") with { PercentageCharged = null, TotalPackEnergyWh = null };

        var view = EnergyProductsProjection.ProjectCard(site, Localizer);

        Assert.Equal("Unnamed Site", view.SiteName);
        Assert.Equal("\u2014", view.Charge.Value);
        Assert.Equal("\u2014", view.Capacity.Value);
    }

    // ---- Projection: site configuration section -------------------------------------

    [Fact]
    public void ProjectSiteInfo_builds_mode_reserve_rated_stats_and_rate_plan()
    {
        var view = EnergyProductsProjection.ProjectSiteInfo(SampleInfo(), touCapableFromSite: false, Localizer);

        Assert.Equal("Site Configuration", view.Title);
        Assert.Equal("Time-Based Control", view.OperationModeValue); // autonomous
        Assert.True(view.HasBackupReserve);
        Assert.Equal(20, view.BackupReservePercent);
        Assert.Equal("20%", view.BackupReserveValue);

        Assert.Equal("Powerwalls", view.Powerwalls.Label);
        Assert.Equal("2", view.Powerwalls.Value);
        Assert.Equal("Rated Power", view.RatedPower.Label);
        Assert.Equal("10.0 kW", view.RatedPower.Value);
        Assert.Equal("Rated Energy", view.RatedEnergy.Label);
        Assert.Equal("27.0 kWh", view.RatedEnergy.Value);

        Assert.Equal("23.44.0", view.FirmwareValue);
        Assert.Equal(2, view.Components.Count);

        Assert.True(view.ShowRatePlan); // info.TouCapable
        Assert.Equal("Rate Plan", view.RatePlan.SectionTitle);
        Assert.Equal("PG&E EV2-A", view.RatePlan.PlanName);
        Assert.Equal("Update", view.RatePlan.UpdateLabel);
    }

    [Fact]
    public void ProjectSiteInfo_uses_no_plan_fallback_and_em_dash_reserve()
    {
        var info = SampleInfo(tariffName: null) with { BackupReservePercent = null, BatteryCount = null, NameplatePowerW = null };

        var view = EnergyProductsProjection.ProjectSiteInfo(info, touCapableFromSite: true, Localizer);

        Assert.Equal("No rate plan configured", view.RatePlan.PlanName);
        Assert.False(view.HasBackupReserve);
        Assert.Equal("\u2014", view.BackupReserveValue);
        Assert.Equal("\u2014", view.Powerwalls.Value);
        Assert.Equal("\u2014", view.RatedPower.Value);
    }

    [Fact]
    public void ProjectSiteInfo_shows_rate_plan_from_site_tou_capability()
    {
        var info = SampleInfo() with { TouCapable = false };

        var fromSite = EnergyProductsProjection.ProjectSiteInfo(info, touCapableFromSite: true, Localizer);
        var neither = EnergyProductsProjection.ProjectSiteInfo(info, touCapableFromSite: false, Localizer);

        Assert.True(fromSite.ShowRatePlan);
        Assert.False(neither.ShowRatePlan);
    }

    [Theory]
    [InlineData(500.0, "500 Wh")]
    [InlineData(13500.0, "13.5 kWh")]
    [InlineData(null, "\u2014")]
    public void FormatEnergy_matches_web_thresholds(double? wh, string expected) =>
        Assert.Equal(expected, EnergyProductsProjection.FormatEnergy(wh));

    [Theory]
    [InlineData(750.0, "750 W")]
    [InlineData(10000.0, "10.0 kW")]
    [InlineData(null, "\u2014")]
    public void FormatPower_matches_web_thresholds(double? w, string expected) =>
        Assert.Equal(expected, EnergyProductsProjection.FormatPower(w));

    // ---- Result mappers -------------------------------------------------------------

    [Fact]
    public void SitesMapper_preserves_status_and_collapses_empty_array_to_empty()
    {
        using var arr = JsonDocument.Parse("""[{"energy_site_id":1,"has_solar":true}]""");
        var cached = EnergyProductsResultMapper.Map(RepositoryResult<JsonElement>.Cached(arr.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(1, cached.Value!.Total);

        using var empty = JsonDocument.Parse("[]");
        var loaded = EnergyProductsResultMapper.Map(RepositoryResult<JsonElement>.Loaded(empty.RootElement, Now));
        Assert.Equal(LoadStatus.Empty, loaded.Status); // empty array → empty state

        Assert.Equal(LoadStatus.Error, EnergyProductsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void SiteInfoMapper_collapses_null_data_to_empty()
    {
        using var doc = JsonDocument.Parse("""{"data":{"default_real_mode":"backup"}}""");
        var loaded = EnergySiteInfoResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal("backup", loaded.Value!.DefaultRealMode);

        using var nullData = JsonDocument.Parse("""{"data":null}""");
        var loadedNull = EnergySiteInfoResultMapper.Map(RepositoryResult<JsonElement>.Loaded(nullData.RootElement, Now));
        Assert.Equal(LoadStatus.Empty, loadedNull.Status);
    }

    // ---- Page view-model state matrix -----------------------------------------------

    [Fact]
    public async Task PageViewModel_loading_only_stays_loading()
    {
        using var vm = NewPageViewModel(RepositoryResult<EnergyProductsSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(EnergyProductsState.Loading, vm.State);
        Assert.False(vm.HasContent);
        Assert.Empty(vm.Cards);
    }

    [Fact]
    public async Task PageViewModel_loaded_builds_summary_and_cards()
    {
        var snapshot = new EnergyProductsSnapshot(new[]
        {
            SampleSite(energySiteId: 1),
            SampleSite(energySiteId: 2, resourceType: "solar"),
        });
        using var vm = NewPageViewModel(RepositoryResult<EnergyProductsSnapshot>.Loaded(snapshot, Now));
        await vm.LoadAsync();

        Assert.Equal(EnergyProductsState.Loaded, vm.State);
        Assert.True(vm.HasContent);
        Assert.Equal("2", vm.Display.TotalSites.Value);
        Assert.Equal(2, vm.Cards.Count);
        Assert.Equal(1, vm.Cards[0].EnergySiteId);
        Assert.Equal(2, vm.Cards[1].EnergySiteId);
        Assert.NotNull(vm.UpdatedAt);
    }

    [Fact]
    public async Task PageViewModel_empty_renders_empty_state_with_no_cards()
    {
        using var vm = NewPageViewModel(RepositoryResult<EnergyProductsSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(EnergyProductsState.Empty, vm.State);
        Assert.False(vm.HasContent);
        Assert.Empty(vm.Cards);
        Assert.Contains("No energy products", vm.Display.EmptyMessage, StringComparison.Ordinal);
    }

    [Fact]
    public async Task PageViewModel_failure_renders_error()
    {
        using var vm = NewPageViewModel(
            RepositoryResult<EnergyProductsSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(EnergyProductsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task PageViewModel_stale_and_offline_keep_content()
    {
        var snapshot = new EnergyProductsSnapshot(new[] { SampleSite() });

        using var stale = NewPageViewModel(RepositoryResult<EnergyProductsSnapshot>.Cached(snapshot, Now, stale: true));
        await stale.LoadAsync();
        Assert.Equal(EnergyProductsState.Stale, stale.State);
        Assert.True(stale.IsStale);
        Assert.True(stale.HasContent);

        using var offline = NewPageViewModel(RepositoryResult<EnergyProductsSnapshot>.OfflineCached(
            snapshot, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await offline.LoadAsync();
        Assert.Equal(EnergyProductsState.Offline, offline.State);
        Assert.True(offline.HasContent);
        Assert.False(string.IsNullOrWhiteSpace(offline.ErrorMessage));
    }

    [Fact]
    public async Task PageViewModel_refresh_reuses_cards_keyed_by_site_id()
    {
        var snapshot = new EnergyProductsSnapshot(new[] { SampleSite(energySiteId: 1), SampleSite(energySiteId: 2) });
        var source = new FakeEnergyProductsSource(
            new[] { RepositoryResult<EnergyProductsSnapshot>.Loaded(snapshot, Now) },
            new[] { RepositoryResult<EnergyProductsSnapshot>.Loaded(snapshot, Now) });
        using var vm = new EnergyProductsPageViewModel(source, new FakeSiteInfoSource(), Localizer, () => Now);

        await vm.LoadAsync();
        var firstCard = vm.Cards[0];

        await vm.RefreshAsync();

        Assert.Equal(2, vm.Cards.Count);
        Assert.Same(firstCard, vm.Cards[0]); // same id → same card holder preserved
    }

    // ---- Card view-model state matrix -----------------------------------------------

    [Fact]
    public async Task CardViewModel_loaded_exposes_site_info_content()
    {
        using var card = NewCardViewModel(RepositoryResult<EnergySiteInfo>.Loaded(SampleInfo(), Now));
        await card.LoadSiteInfoAsync();

        Assert.Equal(EnergyProductsState.Loaded, card.SiteInfoState);
        Assert.True(card.HasSiteInfoContent);
        Assert.Equal("Time-Based Control", card.SiteInfoDisplay.OperationModeValue);
        Assert.Equal("2", card.SiteInfoDisplay.Powerwalls.Value);
    }

    [Fact]
    public async Task CardViewModel_empty_renders_site_info_empty_state()
    {
        using var card = NewCardViewModel(RepositoryResult<EnergySiteInfo>.Empty(Now));
        await card.LoadSiteInfoAsync();

        Assert.Equal(EnergyProductsState.Empty, card.SiteInfoState);
        Assert.False(card.HasSiteInfoContent);
        Assert.Contains("No site configuration", card.SiteInfoDisplay.EmptyMessage, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CardViewModel_failure_renders_site_info_error()
    {
        using var card = NewCardViewModel(
            RepositoryResult<EnergySiteInfo>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await card.LoadSiteInfoAsync();

        Assert.Equal(EnergyProductsState.Error, card.SiteInfoState);
        Assert.True(card.IsError);
        Assert.False(string.IsNullOrWhiteSpace(card.ErrorMessage));
    }

    [Fact]
    public void CardViewModel_card_display_resolves_before_load()
    {
        using var card = new EnergySiteCardViewModel(SampleSite(), new FakeSiteInfoSource(), Localizer, () => Now);

        Assert.Equal("Home", card.CardDisplay.SiteName);
        Assert.Equal(123, card.EnergySiteId);
        Assert.Equal("Powerwall", card.CardDisplay.Type.Value);
    }

    // ---- Registration + diagnostics + empty sources ---------------------------------

    [Fact]
    public void Registration_matches_web_route()
    {
        Assert.Equal("EnergyProducts", EnergyProductsRegistration.RouteName);
        Assert.Equal("EnergyProductsPage", EnergyProductsRegistration.Slug);
        Assert.Equal("Energy Products", EnergyProductsRegistration.Title(Localizer));
        Assert.Contains("Powerwalls", EnergyProductsRegistration.Subtitle(Localizer), StringComparison.Ordinal);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new EnergyProductsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=EnergyProductsPage", Assert.Single(lines));
    }

    [Fact]
    public async Task Empty_sources_yield_empty_states()
    {
        using var vm = new EnergyProductsPageViewModel(
            EmptyEnergyProductsSource.Instance, EmptyEnergySiteInfoSource.Instance, Localizer, () => Now);
        await vm.LoadAsync();
        Assert.Equal(EnergyProductsState.Empty, vm.State);

        using var card = new EnergySiteCardViewModel(SampleSite(), EmptyEnergySiteInfoSource.Instance, Localizer, () => Now);
        await card.LoadSiteInfoAsync();
        Assert.Equal(EnergyProductsState.Empty, card.SiteInfoState);
    }

    // ---- Fakes / helpers ------------------------------------------------------------

    private static EnergyProductsPageViewModel NewPageViewModel(params RepositoryResult<EnergyProductsSnapshot>[] emissions) =>
        new(new FakeEnergyProductsSource(emissions, emissions), new FakeSiteInfoSource(), Localizer, () => Now);

    private static EnergySiteCardViewModel NewCardViewModel(params RepositoryResult<EnergySiteInfo>[] emissions) =>
        new(SampleSite(), new FakeSiteInfoSource(emissions), Localizer, () => Now);

    private sealed class FakeEnergyProductsSource(
        RepositoryResult<EnergyProductsSnapshot>[] streamEmissions,
        RepositoryResult<EnergyProductsSnapshot>[] refreshEmissions) : IEnergyProductsSource
    {
        public IAsyncEnumerable<RepositoryResult<EnergyProductsSnapshot>> StreamAsync(CancellationToken cancellationToken = default) =>
            Yield(streamEmissions, cancellationToken);

        public IAsyncEnumerable<RepositoryResult<EnergyProductsSnapshot>> RefreshAsync(CancellationToken cancellationToken = default) =>
            Yield(refreshEmissions, cancellationToken);

        private static async IAsyncEnumerable<RepositoryResult<EnergyProductsSnapshot>> Yield(
            RepositoryResult<EnergyProductsSnapshot>[] emissions,
            [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class FakeSiteInfoSource(params RepositoryResult<EnergySiteInfo>[] emissions) : IEnergySiteInfoSource
    {
        public IAsyncEnumerable<RepositoryResult<EnergySiteInfo>> StreamAsync(long siteId, CancellationToken cancellationToken = default) =>
            Yield(cancellationToken);

        public IAsyncEnumerable<RepositoryResult<EnergySiteInfo>> RefreshAsync(long siteId, CancellationToken cancellationToken = default) =>
            Yield(cancellationToken);

        private async IAsyncEnumerable<RepositoryResult<EnergySiteInfo>> Yield(
            [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

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
