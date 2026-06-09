using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the EnergySiteInfoWidget's UI-thread-free logic — the two-source JSON parse
/// adapter (energy-sites → first site id, site-info envelope → site-info model), the <c>fmtNumber</c> /
/// <c>fmtInt</c>-backed solar / Powerwall readouts, the projection (the four label/value detail entries +
/// the hasSites / hasInfo gates), the footprint flags, the two-call source composition (sites → site-info,
/// short-circuiting when no site is linked), the registry metadata, the diagnostics, and the state-holder
/// view-model's per-state transitions (loading / loaded / no-site / no-data / error / stale / offline).
/// Mirrors the web spec (web/src/features/dashboard/widgets/EnergySiteInfoWidget.tsx).
/// </summary>
public sealed class EnergySiteInfoWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);
    private const string EmDash = "\u2014";
    private const string Times = "\u00d7";

    private static EnergySiteInfoData Info(
        double? nameplatePowerWatts = 9800,
        double? nameplateEnergyWattHours = 13500,
        long? batteryCount = 1,
        string? version = "23.44.0",
        string? installationTimeZone = "America/Los_Angeles") =>
        new(nameplatePowerWatts, nameplateEnergyWattHours, batteryCount, version, installationTimeZone);

    private static EnergySiteInfoSnapshot Linked(EnergySiteInfoData? info) =>
        new(true, 555, info);

    // ---- Parse adapter: energy sites -----------------------------------------------

    [Fact]
    public void ParseFirstSiteId_reads_snake_case_energy_site_id()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":1,"energy_site_id":555,"site_name":"Home"},{"id":2,"energy_site_id":777}]""");

        Assert.Equal(555, EnergySiteInfoSnapshot.ParseFirstSiteId(doc.RootElement));
    }

    [Fact]
    public void ParseFirstSiteId_accepts_numeric_string()
    {
        using var doc = JsonDocument.Parse("""[{"energy_site_id":"909"}]""");
        Assert.Equal(909, EnergySiteInfoSnapshot.ParseFirstSiteId(doc.RootElement));
    }

    [Fact]
    public void ParseFirstSiteId_empty_array_is_null()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(EnergySiteInfoSnapshot.ParseFirstSiteId(doc.RootElement));
    }

    [Fact]
    public void ParseFirstSiteId_non_array_is_null()
    {
        using var doc = JsonDocument.Parse("""{"energy_site_id":1}""");
        Assert.Null(EnergySiteInfoSnapshot.ParseFirstSiteId(doc.RootElement));
    }

    [Fact]
    public void ParseFirstSiteId_missing_id_is_null()
    {
        using var doc = JsonDocument.Parse("""[{"site_name":"Home"}]""");
        Assert.Null(EnergySiteInfoSnapshot.ParseFirstSiteId(doc.RootElement));
    }

    // ---- Parse adapter: site-info envelope -----------------------------------------

    [Fact]
    public void ParseResponse_reads_snake_case_fields()
    {
        using var doc = JsonDocument.Parse(
            """
            {"data":{"nameplate_power":9800,"nameplate_energy":13500,"battery_count":2,
            "version":"23.44.0","installation_time_zone":"America/Los_Angeles"},"fetched_at":"2026-06-06T00:00:00Z"}
            """);

        var info = EnergySiteInfoData.ParseResponse(doc.RootElement);

        Assert.NotNull(info);
        Assert.Equal(9800, info!.NameplatePowerWatts);
        Assert.Equal(13500, info.NameplateEnergyWattHours);
        Assert.Equal(2, info.BatteryCount);
        Assert.Equal("23.44.0", info.Version);
        Assert.Equal("America/Los_Angeles", info.InstallationTimeZone);
    }

    [Fact]
    public void ParseResponse_null_data_is_null()
    {
        using var doc = JsonDocument.Parse("""{"data":null,"fetched_at":"2026-06-06T00:00:00Z"}""");
        Assert.Null(EnergySiteInfoData.ParseResponse(doc.RootElement));
    }

    [Fact]
    public void ParseResponse_absent_data_is_null()
    {
        using var doc = JsonDocument.Parse("""{"fetched_at":"2026-06-06T00:00:00Z"}""");
        Assert.Null(EnergySiteInfoData.ParseResponse(doc.RootElement));
    }

    [Fact]
    public void ParseResponse_non_object_is_null()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(EnergySiteInfoData.ParseResponse(doc.RootElement));
    }

    [Fact]
    public void ParseResponse_sparse_data_object_is_non_null_with_null_fields()
    {
        // Web parity: an info object whose fields are all undefined is still a non-null `info` → Loaded.
        using var doc = JsonDocument.Parse("""{"data":{},"fetched_at":null}""");
        var info = EnergySiteInfoData.ParseResponse(doc.RootElement);

        Assert.NotNull(info);
        Assert.Null(info!.NameplatePowerWatts);
        Assert.Null(info.BatteryCount);
        Assert.Null(info.Version);
    }

    [Fact]
    public void Snapshot_from_site_and_info_sets_has_info()
    {
        using var doc = JsonDocument.Parse(
            """{"data":{"version":"1.0"},"fetched_at":"2026-06-06T00:00:00Z"}""");

        var snapshot = EnergySiteInfoSnapshot.FromSiteAndInfo(555, doc.RootElement);

        Assert.True(snapshot.HasSites);
        Assert.Equal(555, snapshot.SiteId);
        Assert.True(snapshot.HasInfo);
        Assert.Equal("1.0", snapshot.Info!.Version);
    }

    [Fact]
    public void Snapshot_from_site_and_null_info_has_no_info()
    {
        using var doc = JsonDocument.Parse("""{"data":null}""");
        var snapshot = EnergySiteInfoSnapshot.FromSiteAndInfo(555, doc.RootElement);

        Assert.True(snapshot.HasSites);
        Assert.False(snapshot.HasInfo);
    }

    [Fact]
    public void Snapshot_from_json_without_site_is_no_sites_ignoring_info()
    {
        using var sites = JsonDocument.Parse("[]");
        using var info = JsonDocument.Parse("""{"data":{"version":"1.0"}}""");

        var snapshot = EnergySiteInfoSnapshot.FromJson(sites.RootElement, info.RootElement);

        Assert.False(snapshot.HasSites);
        Assert.False(snapshot.HasInfo);
    }

    // ---- Formatters (web fmtNumber / fmtInt parity) --------------------------------

    [Fact]
    public void FormatSolar_divides_watts_by_thousand_at_one_decimal()
    {
        Assert.Equal("9.8 kW", EnergySiteInfoProjection.FormatSolar(9800));
        Assert.Equal("11.4 kW", EnergySiteInfoProjection.FormatSolar(11430)); // 11.43 → 11.4 (half-expand)
    }

    [Fact]
    public void FormatSolar_null_power_is_em_dash()
    {
        Assert.Equal(EmDash, EnergySiteInfoProjection.FormatSolar(null));
    }

    [Fact]
    public void FormatPowerwalls_formats_count_and_energy()
    {
        Assert.Equal($"1 {Times} 13.5 kWh", EnergySiteInfoProjection.FormatPowerwalls(1, 13500));
        Assert.Equal($"3 {Times} 13.5 kWh", EnergySiteInfoProjection.FormatPowerwalls(3, 13500));
    }

    [Fact]
    public void FormatPowerwalls_zero_count_is_em_dash()
    {
        Assert.Equal(EmDash, EnergySiteInfoProjection.FormatPowerwalls(0, 13500));
        Assert.Equal(EmDash, EnergySiteInfoProjection.FormatPowerwalls(null, 13500));
    }

    [Fact]
    public void FormatPowerwalls_null_energy_keeps_count_with_em_dash_energy()
    {
        Assert.Equal($"2 {Times} {EmDash} kWh", EnergySiteInfoProjection.FormatPowerwalls(2, null));
    }

    // ---- Projection: detail entries ------------------------------------------------

    [Fact]
    public void Project_builds_four_entries_with_labels_and_values()
    {
        var display = Project(Linked(Info()));

        Assert.True(display.HasSites);
        Assert.True(display.HasInfo);
        Assert.Equal(EnergySiteInfoSize.MaxEntries, display.Entries.Count);

        Assert.Equal("Solar System", display.Entries[0].Label);
        Assert.Equal("9.8 kW", display.Entries[0].Value);
        Assert.False(display.Entries[0].Mono);

        Assert.Equal("Powerwalls", display.Entries[1].Label);
        Assert.Equal($"1 {Times} 13.5 kWh", display.Entries[1].Value);

        Assert.Equal("Gateway Firmware", display.Entries[2].Label);
        Assert.Equal("23.44.0", display.Entries[2].Value);
        Assert.True(display.Entries[2].Mono); // web `mono: true`

        Assert.Equal("Installation Timezone", display.Entries[3].Label);
        Assert.Equal("America/Los_Angeles", display.Entries[3].Value);
    }

    [Fact]
    public void Project_keeps_null_firmware_and_timezone_values_for_em_dash_render()
    {
        // Web parity: firmware/timezone are null when absent; the WidgetDetailCard renders `value ?? '—'`.
        var display = Project(Linked(Info(version: null, installationTimeZone: null)));

        Assert.Null(display.Entries[2].Value);
        Assert.Null(display.Entries[3].Value);
    }

    [Fact]
    public void Project_no_info_has_no_entries()
    {
        var display = Project(Linked(null));

        Assert.True(display.HasSites);
        Assert.False(display.HasInfo);
        Assert.Empty(display.Entries);
    }

    [Fact]
    public void Project_no_site_flag()
    {
        var display = Project(EnergySiteInfoSnapshot.NoSites);

        Assert.False(display.HasSites);
        Assert.False(display.HasInfo);
        Assert.Empty(display.Entries);
    }

    [Fact]
    public void Project_entry_accessibility_name_is_label_and_value()
    {
        var display = Project(Linked(Info()));

        Assert.Equal("Solar System: 9.8 kW", display.Entries[0].AccessibilityName);
        Assert.Equal("Gateway Firmware: 23.44.0", display.Entries[2].AccessibilityName);
    }

    [Fact]
    public void Project_entry_accessibility_name_uses_em_dash_for_null_value()
    {
        var display = Project(Linked(Info(version: null)));
        Assert.Equal($"Gateway Firmware: {EmDash}", display.Entries[2].AccessibilityName);
    }

    [Fact]
    public void Project_compact_flag_tracks_footprint()
    {
        Assert.True(Project(Linked(Info()), new EnergySiteInfoSize(1, 2)).IsCompact);
        Assert.False(Project(Linked(Info()), new EnergySiteInfoSize(2, 4)).IsCompact);
    }

    // ---- Footprint -----------------------------------------------------------------

    [Theory]
    [InlineData(1, 2, true)]
    [InlineData(2, 4, false)]
    [InlineData(4, 40, false)]
    public void Size_is_compact_at_single_column(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new EnergySiteInfoSize(cols, rows).IsCompact);

    [Fact]
    public void Size_max_entries_is_four() =>
        Assert.Equal(4, EnergySiteInfoSize.MaxEntries);

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<EnergySiteInfoSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(EnergySiteInfoState.Loading, vm.State);
        Assert.False(vm.HasInfo);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_with_info_exposes_entries()
    {
        using var vm = NewViewModel(Loaded(Linked(Info())));
        await vm.LoadAsync();

        Assert.Equal(EnergySiteInfoState.Loaded, vm.State);
        Assert.True(vm.HasSites);
        Assert.True(vm.HasInfo);
        Assert.Equal(4, vm.Display.Entries.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_linked_site_without_info_is_no_data()
    {
        using var vm = NewViewModel(Loaded(Linked(null)));
        await vm.LoadAsync();

        Assert.Equal(EnergySiteInfoState.NoData, vm.State);
        Assert.True(vm.HasSites);
        Assert.False(vm.HasInfo);
        Assert.Equal("No site info available", vm.NoDataMessage);
    }

    [Fact]
    public async Task ViewModel_without_site_is_no_site()
    {
        using var vm = NewViewModel(Loaded(EnergySiteInfoSnapshot.NoSites));
        await vm.LoadAsync();

        Assert.Equal(EnergySiteInfoState.NoSite, vm.State);
        Assert.False(vm.HasSites);
        Assert.Equal("No Tesla Energy site linked", vm.NoSiteMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_no_data_defensively()
    {
        using var vm = NewViewModel(RepositoryResult<EnergySiteInfoSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(EnergySiteInfoState.NoData, vm.State);
        Assert.True(vm.HasSites);
        Assert.False(vm.HasInfo);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<EnergySiteInfoSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(EnergySiteInfoState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_entries()
    {
        using var vm = NewViewModel(
            RepositoryResult<EnergySiteInfoSnapshot>.Cached(Linked(Info()), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(EnergySiteInfoState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasInfo);
        Assert.Equal(4, vm.Display.Entries.Count);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_entries()
    {
        using var vm = NewViewModel(RepositoryResult<EnergySiteInfoSnapshot>.OfflineCached(
            Linked(Info()), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(EnergySiteInfoState.Offline, vm.State);
        Assert.True(vm.HasInfo);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<EnergySiteInfoSnapshot>.Loading(),
            RepositoryResult<EnergySiteInfoSnapshot>.Cached(Linked(Info()), Now, stale: false),
            RepositoryResult<EnergySiteInfoSnapshot>.Loaded(Linked(Info(version: "24.0.0")), Now));
        await vm.LoadAsync();

        Assert.Equal(EnergySiteInfoState.Loaded, vm.State);
        Assert.Equal("24.0.0", vm.Display.Entries[2].Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact_flag()
    {
        using var vm = NewViewModel(new EnergySiteInfoSize(2, 4), Loaded(Linked(Info())));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new EnergySiteInfoSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(EnergySiteInfoState.Loaded, vm.State);
        Assert.Equal(4, vm.Display.Entries.Count);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(Loaded(EnergySiteInfoSnapshot.NoSites));
        await vm.LoadAsync();

        Assert.Equal("Energy Site", vm.Title);
        Assert.Equal("No Tesla Energy site linked", vm.NoSiteMessage);
        Assert.Equal("No site info available", vm.NoDataMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Linked(Info())));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(EnergySiteInfoViewModel.State), changed);
        Assert.Contains(nameof(EnergySiteInfoViewModel.Display), changed);
    }

    // ---- Source: two-call composition ----------------------------------------------

    [Fact]
    public async Task Source_with_no_sites_yields_no_site_without_requesting_site_info()
    {
        using var sites = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(sites.RootElement);
        var source = new EnergySiteInfoSource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.False(terminal.Value!.HasSites);
        // Only the energy-sites request fired; the site-info query stays disabled (web enabled: !!siteId).
        Assert.Single(api.Requests);
        Assert.Equal(EnergySiteInfoRegistration.SitesOperationId, api.Requests[0].OperationId);
    }

    [Fact]
    public async Task Source_resolves_first_site_and_requests_site_info_with_path_param()
    {
        using var sites = JsonDocument.Parse("""[{"energy_site_id":555}]""");
        using var info = JsonDocument.Parse(
            """{"data":{"nameplate_power":9800,"battery_count":1,"version":"23.44.0"},"fetched_at":"2026-06-06T00:00:00Z"}""");
        var api = new FakeApiClient()
            .ReturnsValue(sites.RootElement)
            .ReturnsValue(info.RootElement);
        var source = new EnergySiteInfoSource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.HasSites);
        Assert.Equal(555, terminal.Value.SiteId);
        Assert.True(terminal.Value.HasInfo);
        Assert.Equal("23.44.0", terminal.Value.Info!.Version);

        Assert.Equal(2, api.Requests.Count);
        Assert.Equal(EnergySiteInfoRegistration.SitesOperationId, api.Requests[0].OperationId);

        var siteInfo = api.Requests[1];
        Assert.Equal(EnergySiteInfoRegistration.SiteInfoOperationId, siteInfo.OperationId);
        Assert.Equal("555", siteInfo.PathParams![EnergySiteInfoRegistration.SitePathParam]);
    }

    [Fact]
    public async Task Source_linked_site_with_null_info_data_resolves_no_info()
    {
        using var sites = JsonDocument.Parse("""[{"energy_site_id":42}]""");
        using var info = JsonDocument.Parse("""{"data":null,"fetched_at":null}""");
        var api = new FakeApiClient()
            .ReturnsValue(sites.RootElement)
            .ReturnsValue(info.RootElement);
        var source = new EnergySiteInfoSource(api, NewEngine(), new ApiClientOptions());

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.HasSites);
        Assert.False(terminal.Value.HasInfo);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("energy-site-info", EnergySiteInfoRegistration.Id);
        Assert.Equal("energy", EnergySiteInfoRegistration.Category);
        Assert.Equal("EnergySiteInfoWidget", EnergySiteInfoRegistration.Slug);
        Assert.Equal(new EnergySiteInfoSize(2, 4), EnergySiteInfoRegistration.DefaultSize);
        Assert.Equal(new EnergySiteInfoSize(1, 2), EnergySiteInfoRegistration.MinSize);
        Assert.Equal(new EnergySiteInfoSize(4, 40), EnergySiteInfoRegistration.MaxSize);
        Assert.Equal("Energy Site", EnergySiteInfoRegistration.Name(Localizer));
        Assert.Contains("Powerwall", EnergySiteInfoRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(1, 2, true)]
    [InlineData(4, 40, true)]
    [InlineData(0, 4, false)]
    [InlineData(5, 40, false)]
    [InlineData(2, 41, false)]
    [InlineData(2, 1, false)]
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, EnergySiteInfoRegistration.IsWithinBounds(new EnergySiteInfoSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new EnergySiteInfoSize(1, 2), EnergySiteInfoRegistration.Clamp(new EnergySiteInfoSize(0, 0)));
        Assert.Equal(new EnergySiteInfoSize(4, 40), EnergySiteInfoRegistration.Clamp(new EnergySiteInfoSize(9, 99)));
    }

    [Fact]
    public void Registration_operation_ids_resolve_against_the_generated_endpoint_table()
    {
        var index = GeneratedApi.ApiEndpoints.All.ToDictionary(e => e.OperationId, e => e, StringComparer.Ordinal);

        Assert.True(index.ContainsKey(EnergySiteInfoRegistration.SitesOperationId));
        Assert.True(index.TryGetValue(EnergySiteInfoRegistration.SiteInfoOperationId, out var siteInfo));
        Assert.Contains(EnergySiteInfoRegistration.SitePathParam, siteInfo!.PathParams);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new EnergySiteInfoDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=EnergySiteInfoWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static EnergySiteInfoDisplay Project(EnergySiteInfoSnapshot snapshot) =>
        Project(snapshot, EnergySiteInfoSize.Default);

    private static EnergySiteInfoDisplay Project(EnergySiteInfoSnapshot snapshot, EnergySiteInfoSize size) =>
        EnergySiteInfoProjection.Project(snapshot, size, Localizer);

    private static RepositoryResult<EnergySiteInfoSnapshot> Loaded(EnergySiteInfoSnapshot snapshot) =>
        RepositoryResult<EnergySiteInfoSnapshot>.Loaded(snapshot, Now);

    private static CacheThenNetworkEngine NewEngine() => new(new FakeCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<EnergySiteInfoSnapshot>>> Drain(IEnergySiteInfoSource source)
    {
        var results = new List<RepositoryResult<EnergySiteInfoSnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            results.Add(result);
        }

        return results;
    }

    private static EnergySiteInfoViewModel NewViewModel(params RepositoryResult<EnergySiteInfoSnapshot>[] emissions) =>
        NewViewModel(EnergySiteInfoSize.Default, emissions);

    private static EnergySiteInfoViewModel NewViewModel(
        EnergySiteInfoSize size,
        params RepositoryResult<EnergySiteInfoSnapshot>[] emissions) =>
        new(new FakeEnergySiteInfoSource(emissions), Localizer, size);

    private sealed class FakeEnergySiteInfoSource(params RepositoryResult<EnergySiteInfoSnapshot>[] emissions)
        : IEnergySiteInfoSource
    {
        public async IAsyncEnumerable<RepositoryResult<EnergySiteInfoSnapshot>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }
}
