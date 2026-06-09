using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the VehicleUpgradesWidget's UI-thread-free logic — the upgrades JSON parse adapter
/// (the <c>upgrades[]</c> array form + the top-level-keys fallback, with the <c>asString</c> / name / price /
/// description coalesce and the <c>eligible !== false</c> edge cases), the share-link active / nearest-expiry
/// computation, the projection (the upgrade rows + their Eligible/Not eligible badges, the compact eligible
/// count + "Up to date" summary, the Share Links summary, the accessibility names), the footprint flags, the
/// cache-then-network source (vehicle resolution → drives → share links → upgrades read, short-circuiting to
/// Empty when no vehicle and keeping the share links best-effort), the registry metadata, the diagnostics, and
/// the state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline).
/// Mirrors the web spec (web/src/features/dashboard/widgets/VehicleUpgradesWidget.tsx).
/// </summary>
public sealed class VehicleUpgradesWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 8, 12, 0, 0, TimeSpan.Zero);
    private const string EmDash = "\u2014";

    // Noon-UTC expiries so the whole-day countdown is deterministic regardless of the runner's time zone.
    private const string FutureExpiry = "2026-06-18T12:00:00Z"; // +10 days
    private const string NearerExpiry = "2026-06-13T12:00:00Z"; // +5 days
    private const string PastExpiry = "2026-05-29T12:00:00Z";   // -10 days

    // ---- Parse adapter: upgrades[] array form --------------------------------------

    [Fact]
    public void Parse_array_maps_name_price_description_and_eligible()
    {
        var upgrade = Assert.Single(Parse(
            """{"upgrades":[{"name":"Tow Hitch","price":"500","description":"Rated 2000 lb","eligible":true}]}"""));

        Assert.Equal("Tow Hitch", upgrade.Name);
        Assert.Equal("500", upgrade.Price);
        Assert.Equal("Rated 2000 lb", upgrade.Description);
        Assert.True(upgrade.Eligible);
    }

    [Fact]
    public void Parse_array_name_falls_back_title_then_unknown()
    {
        var upgrades = Parse("""{"upgrades":[{"title":"Acceleration Boost"},{"foo":"bar"}]}""");

        Assert.Collection(
            upgrades,
            u => Assert.Equal("Acceleration Boost", u.Name),
            u => Assert.Equal("Unknown Upgrade", u.Name));
    }

    [Fact]
    public void Parse_array_price_falls_back_to_cost_and_description_to_summary()
    {
        var upgrade = Assert.Single(Parse(
            """{"upgrades":[{"name":"FSD","cost":"99","summary":"Subscription"}]}"""));

        Assert.Equal("99", upgrade.Price);
        Assert.Equal("Subscription", upgrade.Description);
    }

    [Fact]
    public void Parse_array_numeric_price_is_stringified()
    {
        var upgrade = Assert.Single(Parse("""{"upgrades":[{"name":"X","price":2000}]}"""));
        Assert.Equal("2000", upgrade.Price);
    }

    [Fact]
    public void Parse_array_eligible_only_literal_false_opts_out()
    {
        var upgrades = Parse(
            """{"upgrades":[{"name":"A","eligible":false},{"name":"B","eligible":true},{"name":"C"},{"name":"D","eligible":null},{"name":"E","eligible":0}]}""");

        Assert.Collection(
            upgrades,
            u => Assert.False(u.Eligible), // literal false → not eligible
            u => Assert.True(u.Eligible),  // true
            u => Assert.True(u.Eligible),  // absent → eligible
            u => Assert.True(u.Eligible),  // null → eligible (null !== false)
            u => Assert.True(u.Eligible)); // 0 → eligible (0 !== false)
    }

    [Fact]
    public void Parse_array_skips_non_object_items()
    {
        var upgrade = Assert.Single(Parse("""{"upgrades":[null,42,"x",{"name":"Y"}]}"""));
        Assert.Equal("Y", upgrade.Name);
    }

    [Fact]
    public void Parse_array_missing_price_and_description_are_null()
    {
        var upgrade = Assert.Single(Parse("""{"upgrades":[{"name":"Bare"}]}"""));
        Assert.Null(upgrade.Price);
        Assert.Null(upgrade.Description);
    }

    // ---- Parse adapter: top-level-keys fallback ------------------------------------

    [Fact]
    public void Parse_fallback_treats_object_values_as_upgrades_named_by_key()
    {
        var upgrades = Parse(
            """{"acceleration_boost":{"price":"2000"},"premium_interior":{"name":"Premium Interior"}}""");

        Assert.Collection(
            upgrades,
            u =>
            {
                Assert.Equal("acceleration_boost", u.Name); // key, since no "name"
                Assert.Equal("2000", u.Price);
            },
            u => Assert.Equal("Premium Interior", u.Name)); // explicit name wins over key
    }

    [Fact]
    public void Parse_fallback_skips_non_object_values()
    {
        var upgrade = Assert.Single(Parse("""{"count":3,"label":"x","real":{"name":"Real"}}"""));
        Assert.Equal("Real", upgrade.Name);
    }

    [Fact]
    public void Parse_fallback_eligible_false_opts_out()
    {
        var upgrade = Assert.Single(Parse("""{"tow":{"name":"Tow","eligible":false}}"""));
        Assert.False(upgrade.Eligible);
    }

    [Fact]
    public void Parse_non_object_data_is_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Empty(UpgradesParser.Parse(doc.RootElement, Localizer));
    }

    [Fact]
    public void Parse_empty_object_is_empty()
    {
        Assert.Empty(Parse("{}"));
    }

    // ---- Share links: active filter + nearest expiry -------------------------------

    [Fact]
    public void ShareLink_without_expiry_is_active()
    {
        Assert.True(new ShareLinkInfo(null).IsActive(Now));
        Assert.True(new ShareLinkInfo("").IsActive(Now));
    }

    [Fact]
    public void ShareLink_future_expiry_is_active_past_is_inactive()
    {
        Assert.True(new ShareLinkInfo(FutureExpiry).IsActive(Now));
        Assert.False(new ShareLinkInfo(PastExpiry).IsActive(Now));
    }

    [Fact]
    public void ShareLink_unparseable_expiry_is_active()
    {
        Assert.True(new ShareLinkInfo("not-a-date").IsActive(Now));
    }

    [Fact]
    public void ActiveShareLinks_filters_out_expired()
    {
        var links = new ShareLinkInfo[]
        {
            new(FutureExpiry),
            new(PastExpiry),
            new(null),
        };

        var active = VehicleUpgradesProjection.ActiveShareLinks(links, Now);
        Assert.Equal(2, active.Count);
    }

    [Fact]
    public void NearestExpiry_picks_smallest_positive_countdown()
    {
        var active = new ShareLinkInfo[] { new(FutureExpiry), new(NearerExpiry) };
        Assert.Equal(
            VehicleUpgradesProjection.FormatDate(NearerExpiry, Now),
            VehicleUpgradesProjection.NearestExpiry(active, Now));
    }

    [Fact]
    public void NearestExpiry_is_null_when_no_active_link_has_expiry()
    {
        var active = new ShareLinkInfo[] { new(null), new("") };
        Assert.Null(VehicleUpgradesProjection.NearestExpiry(active, Now));
    }

    [Fact]
    public void ShareLinkInfo_from_array_extracts_expires_at()
    {
        using var doc = JsonDocument.Parse(
            $$"""[{"id":1,"expires_at":"{{FutureExpiry}}"},{"id":2,"expires_at":null},"x"]""");
        var links = ShareLinkInfo.FromArray(doc.RootElement);

        Assert.Equal(2, links.Count);
        Assert.Equal(FutureExpiry, links[0].ExpiresAt);
        Assert.Null(links[1].ExpiresAt);
    }

    [Fact]
    public void ShareLinkInfo_from_non_array_is_empty()
    {
        using var doc = JsonDocument.Parse("""{"not":"an array"}""");
        Assert.Empty(ShareLinkInfo.FromArray(doc.RootElement));
    }

    // ---- daysUntil -----------------------------------------------------------------

    [Fact]
    public void DaysUntil_null_or_unparseable_is_null()
    {
        Assert.Null(UpgradesParser.DaysUntil(null, Now));
        Assert.Null(UpgradesParser.DaysUntil("", Now));
        Assert.Null(UpgradesParser.DaysUntil("not-a-date", Now));
    }

    [Fact]
    public void DaysUntil_uses_ceiling_of_whole_days()
    {
        Assert.Equal(2, UpgradesParser.DaysUntil("2026-06-10T00:00:00Z", Now));
        Assert.Equal(-1, UpgradesParser.DaysUntil("2026-06-07T00:00:00Z", Now));
    }

    // ---- Snapshot ------------------------------------------------------------------

    [Fact]
    public void ExtractUpgradesData_keeps_data_object_json()
    {
        using var doc = JsonDocument.Parse(
            """{"data":{"upgrades":[{"name":"X"}]},"fetched_at":"2026-06-06T00:00:00Z"}""");
        var json = VehicleUpgradesSnapshot.ExtractUpgradesData(doc.RootElement);

        Assert.NotNull(json);
        Assert.Contains("upgrades", json);
    }

    [Theory]
    [InlineData("""{"data":null,"fetched_at":null}""")]
    [InlineData("""{"fetched_at":null}""")]
    [InlineData("""{"data":[]}""")]
    [InlineData("[]")]
    public void ExtractUpgradesData_without_data_object_is_null(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(VehicleUpgradesSnapshot.ExtractUpgradesData(doc.RootElement));
    }

    // ---- Projection: upgrade entries -----------------------------------------------

    [Fact]
    public void Project_builds_one_entry_per_upgrade_with_price_and_badges()
    {
        var display = Project(
            """{"upgrades":[{"name":"Tow Hitch","price":"500","eligible":true},{"name":"Boost","eligible":false}]}""");

        Assert.True(display.HasUpgrades);
        Assert.Equal(2, display.Upgrades.Count);

        var eligible = display.Upgrades[0];
        Assert.Equal("Tow Hitch", eligible.Name);
        Assert.Equal("$500", eligible.PriceText);
        Assert.True(eligible.Eligible);
        Assert.Equal("Eligible", eligible.BadgeText);

        var notEligible = display.Upgrades[1];
        Assert.Null(notEligible.PriceText);
        Assert.False(notEligible.Eligible);
        Assert.Equal("Not eligible", notEligible.BadgeText);
    }

    [Fact]
    public void Project_entry_accessibility_name_includes_name_price_and_badge()
    {
        var entry = Assert.Single(Project("""{"upgrades":[{"name":"Tow Hitch","price":"500"}]}""").Upgrades);
        Assert.Equal("Tow Hitch, $500, Eligible", entry.AccessibilityName);
    }

    [Fact]
    public void Project_entry_accessibility_name_omits_price_when_absent()
    {
        var entry = Assert.Single(Project("""{"upgrades":[{"name":"Boost","eligible":false}]}""").Upgrades);
        Assert.Equal("Boost, Not eligible", entry.AccessibilityName);
    }

    // ---- Projection: compact summary -----------------------------------------------

    [Fact]
    public void Project_compact_counts_eligible_upgrades()
    {
        var display = Project(
            """{"upgrades":[{"name":"A","eligible":true},{"name":"B","eligible":false},{"name":"C","eligible":true}]}""",
            new VehicleUpgradesSize(1, 2));

        Assert.True(display.IsCompact);
        Assert.True(display.HasUpgrades);
        Assert.Equal(2, display.EligibleCount);
        Assert.StartsWith("Upgrades & Sharing: 2 available", display.CompactAccessibilityName);
    }

    [Fact]
    public void Project_compact_with_no_upgrades_says_up_to_date()
    {
        var display = Project("{}", new VehicleUpgradesSize(1, 2));

        Assert.True(display.IsCompact);
        Assert.False(display.HasUpgrades);
        Assert.Equal(0, display.EligibleCount);
        Assert.Equal("Upgrades & Sharing: Up to date", display.CompactAccessibilityName);
    }

    [Theory]
    [InlineData(1, 2, true, false)]
    [InlineData(2, 4, false, false)]
    [InlineData(3, 4, false, true)]
    [InlineData(4, 40, false, true)]
    public void Project_footprint_flags_track_size(int cols, int rows, bool compact, bool wide)
    {
        var display = Project("{}", new VehicleUpgradesSize(cols, rows));
        Assert.Equal(compact, display.IsCompact);
        Assert.Equal(wide, display.IsWide);
    }

    // ---- Projection: share links ---------------------------------------------------

    [Fact]
    public void Project_share_links_summary_counts_active_and_formats_nearest()
    {
        var display = ProjectWithLinks(
            """{"upgrades":[{"name":"X"}]}""",
            new ShareLinkInfo(FutureExpiry),
            new ShareLinkInfo(NearerExpiry),
            new ShareLinkInfo(PastExpiry));

        Assert.True(display.HasActiveShareLinks);
        Assert.Equal(2, display.ActiveShareLinkCount); // future + nearer; past is filtered
        Assert.Equal(VehicleUpgradesProjection.FormatDate(NearerExpiry, Now), display.NearestExpiryText);
    }

    [Fact]
    public void Project_share_links_without_expiry_are_active_with_no_nearest()
    {
        var display = ProjectWithLinks("""{"upgrades":[{"name":"X"}]}""", new ShareLinkInfo(null));

        Assert.True(display.HasActiveShareLinks);
        Assert.Equal(1, display.ActiveShareLinkCount);
        Assert.Null(display.NearestExpiryText);
    }

    [Fact]
    public void Project_with_no_share_links_has_empty_section()
    {
        var display = Project("""{"upgrades":[{"name":"X"}]}""");

        Assert.False(display.HasActiveShareLinks);
        Assert.Equal(0, display.ActiveShareLinkCount);
        Assert.Null(display.NearestExpiryText);
    }

    [Fact]
    public void Project_empty_snapshot_has_no_upgrades_and_no_links()
    {
        var display = VehicleUpgradesProjection.Project(
            VehicleUpgradesSnapshot.None, VehicleUpgradesSize.Default, Now, Localizer);

        Assert.False(display.HasUpgrades);
        Assert.Empty(display.Upgrades);
        Assert.False(display.HasActiveShareLinks);
        Assert.Equal(0, display.EligibleCount);
        Assert.Equal("Upgrades & Sharing: Up to date", display.CompactAccessibilityName);
    }

    // ---- FormatDate ----------------------------------------------------------------

    [Fact]
    public void FormatDate_null_or_unparseable_is_em_dash()
    {
        Assert.Equal(EmDash, VehicleUpgradesProjection.FormatDate(null, Now));
        Assert.Equal(EmDash, VehicleUpgradesProjection.FormatDate("not-a-date", Now));
    }

    [Fact]
    public void FormatDate_valid_date_is_month_day_year()
    {
        var formatted = VehicleUpgradesProjection.FormatDate("2027-01-01T12:00:00Z", Now);
        Assert.NotEqual(EmDash, formatted);
        Assert.Contains("Jan", formatted);
        Assert.Contains("2027", formatted);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleUpgradesSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(VehicleUpgradesState.Loading, vm.State);
        Assert.False(vm.HasUpgrades);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_with_upgrades_exposes_entries()
    {
        using var vm = NewViewModel(Loaded(Snapshot("""{"upgrades":[{"name":"Tow Hitch"}]}""")));
        await vm.LoadAsync();

        Assert.Equal(VehicleUpgradesState.Loaded, vm.State);
        Assert.True(vm.HasUpgrades);
        Assert.Single(vm.Display.Upgrades);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_with_no_upgrades_is_still_loaded_with_empty_sections()
    {
        // Web parity: an empty upgrades payload still renders the two-section body ("All upgrades applied" +
        // the share-links section), so it is Loaded — never a blank Empty surface — and keeps any share links.
        using var vm = NewViewModel(Loaded(Snapshot("{}", new ShareLinkInfo(FutureExpiry))));
        await vm.LoadAsync();

        Assert.Equal(VehicleUpgradesState.Loaded, vm.State);
        Assert.False(vm.HasUpgrades);
        Assert.True(vm.HasActiveShareLinks);
        Assert.Equal(1, vm.Display.ActiveShareLinkCount);
    }

    [Fact]
    public async Task ViewModel_engine_empty_renders_empty_two_section_body()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleUpgradesSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(VehicleUpgradesState.Empty, vm.State);
        Assert.False(vm.HasUpgrades);
        Assert.False(vm.HasActiveShareLinks);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleUpgradesSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(VehicleUpgradesState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_entries()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleUpgradesSnapshot>.Cached(Snapshot("""{"upgrades":[{"name":"X"}]}"""), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(VehicleUpgradesState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasUpgrades);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_entries()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleUpgradesSnapshot>.OfflineCached(
            Snapshot("""{"upgrades":[{"name":"X"}]}"""), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(VehicleUpgradesState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasUpgrades);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleUpgradesSnapshot>.Loading(),
            RepositoryResult<VehicleUpgradesSnapshot>.Cached(Snapshot("""{"upgrades":[{"name":"X"}]}"""), Now, stale: false),
            RepositoryResult<VehicleUpgradesSnapshot>.Loaded(Snapshot("""{"upgrades":[{"name":"X"},{"name":"Y"}]}"""), Now));
        await vm.LoadAsync();

        Assert.Equal(VehicleUpgradesState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Upgrades.Count);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_footprint_flags()
    {
        using var vm = NewViewModel(new VehicleUpgradesSize(2, 4), Loaded(Snapshot("""{"upgrades":[{"name":"X"}]}""")));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new VehicleUpgradesSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(VehicleUpgradesState.Loaded, vm.State);
        Assert.True(vm.HasUpgrades);
    }

    [Fact]
    public async Task ViewModel_labels_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleUpgradesSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Upgrades & Sharing", vm.Title);
        Assert.Equal("available", vm.AvailableLabel);
        Assert.Equal("Up to date", vm.UpToDateLabel);
        Assert.Equal("Available Upgrades", vm.UpgradesHeading);
        Assert.Equal("All upgrades applied", vm.AllAppliedLabel);
        Assert.Equal("Share Links", vm.ShareLinksHeading);
        Assert.Equal("Active links", vm.ActiveLinksLabel);
        Assert.Equal("Nearest expiry", vm.NearestExpiryLabel);
        Assert.Equal("No active share links", vm.NoShareLinksLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Snapshot("""{"upgrades":[{"name":"X"}]}""")));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(VehicleUpgradesViewModel.State), changed);
        Assert.Contains(nameof(VehicleUpgradesViewModel.Display), changed);
    }

    // ---- Source: vehicle resolution + multi-read composition -----------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new VehicleUpgradesSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_reads_drives_then_share_links_then_upgrades_in_order()
    {
        using var drives = JsonDocument.Parse("""[{"id":55},{"id":54}]""");
        using var shares = JsonDocument.Parse($$"""[{"id":1,"expires_at":"{{FutureExpiry}}"}]""");
        using var upgrades = JsonDocument.Parse(
            """{"data":{"upgrades":[{"name":"Tow Hitch","price":"500"}]},"fetched_at":"2026-06-06T00:00:00Z"}""");

        var api = new FakeApiClient()
            .ReturnsValue(drives.RootElement)
            .ReturnsValue(shares.RootElement)
            .ReturnsValue(upgrades.RootElement);
        var source = new VehicleUpgradesSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.NotNull(terminal.Value!.UpgradesDataJson);
        Assert.Single(VehicleUpgradesProjection.ParseSnapshot(terminal.Value, Localizer));
        Assert.Single(terminal.Value.ShareLinks);

        Assert.Equal(3, api.Requests.Count);
        Assert.Equal(Operations.Drives.List, api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].Query![VehicleUpgradesRegistration.VehicleQueryParam]!.ToString());
        Assert.Equal(Operations.Sharing.DriveShares, api.Requests[1].OperationId);
        Assert.Equal("55", api.Requests[1].PathParams![VehicleUpgradesRegistration.DrivePathParam]);
        Assert.Equal(VehicleUpgradesRegistration.UpgradesOperationId, api.Requests[2].OperationId);
        Assert.Equal("7", api.Requests[2].PathParams![VehicleUpgradesRegistration.VehiclePathParam]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var drives = JsonDocument.Parse("""[{"id":9}]""");
        using var shares = JsonDocument.Parse("[]");
        using var upgrades = JsonDocument.Parse("""{"data":{"upgrades":[{"name":"X"}]},"fetched_at":null}""");

        var api = new FakeApiClient()
            .ReturnsValue(drives.RootElement)
            .ReturnsValue(shares.RootElement)
            .ReturnsValue(upgrades.RootElement);
        var source = new VehicleUpgradesSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal("42", api.Requests[0].Query![VehicleUpgradesRegistration.VehicleQueryParam]!.ToString());
        Assert.Equal("42", api.Requests[^1].PathParams![VehicleUpgradesRegistration.VehiclePathParam]);
    }

    [Fact]
    public async Task Source_with_no_drives_skips_share_links_request()
    {
        using var drives = JsonDocument.Parse("[]"); // no drive → share-links query disabled (web drives[0])
        using var upgrades = JsonDocument.Parse("""{"data":{"upgrades":[{"name":"X"}]},"fetched_at":null}""");

        var api = new FakeApiClient()
            .ReturnsValue(drives.RootElement)
            .ReturnsValue(upgrades.RootElement);
        var source = new VehicleUpgradesSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Empty(terminal.Value!.ShareLinks);
        Assert.Equal(2, api.Requests.Count);
        Assert.Equal(Operations.Drives.List, api.Requests[0].OperationId);
        Assert.Equal(VehicleUpgradesRegistration.UpgradesOperationId, api.Requests[1].OperationId);
    }

    [Fact]
    public async Task Source_share_links_failure_is_best_effort()
    {
        using var drives = JsonDocument.Parse("""[{"id":55}]""");
        using var upgrades = JsonDocument.Parse("""{"data":{"upgrades":[{"name":"X"}]},"fetched_at":null}""");

        var api = new FakeApiClient()
            .ReturnsValue(drives.RootElement)
            .Throws(new HttpRequestException("share links down"))
            .ReturnsValue(upgrades.RootElement);
        var source = new VehicleUpgradesSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var terminal = (await Drain(source))[^1];

        // The upgrades read still succeeds; the share-links failure simply leaves that section empty.
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Empty(terminal.Value!.ShareLinks);
        Assert.Single(VehicleUpgradesProjection.ParseSnapshot(terminal.Value, Localizer));
    }

    [Fact]
    public async Task Source_envelope_without_data_resolves_empty_upgrades_snapshot()
    {
        using var drives = JsonDocument.Parse("[]");
        using var upgrades = JsonDocument.Parse("""{"data":null,"fetched_at":null}""");

        var api = new FakeApiClient()
            .ReturnsValue(drives.RootElement)
            .ReturnsValue(upgrades.RootElement);
        var source = new VehicleUpgradesSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Null(terminal.Value!.UpgradesDataJson);
        Assert.Empty(VehicleUpgradesProjection.ParseSnapshot(terminal.Value, Localizer));
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("vehicle-upgrades", VehicleUpgradesRegistration.Id);
        Assert.Equal("vehicle", VehicleUpgradesRegistration.Category);
        Assert.Equal("VehicleUpgradesWidget", VehicleUpgradesRegistration.Slug);
        Assert.Equal(new VehicleUpgradesSize(2, 4), VehicleUpgradesRegistration.DefaultSize);
        Assert.Equal(new VehicleUpgradesSize(1, 2), VehicleUpgradesRegistration.MinSize);
        Assert.Equal(new VehicleUpgradesSize(4, 40), VehicleUpgradesRegistration.MaxSize);
        Assert.Equal("Upgrades & Sharing", VehicleUpgradesRegistration.Name(Localizer));
        Assert.Contains("share", VehicleUpgradesRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new VehicleUpgradesSize(1, 2), VehicleUpgradesRegistration.Clamp(new VehicleUpgradesSize(0, 0)));
        Assert.Equal(new VehicleUpgradesSize(4, 40), VehicleUpgradesRegistration.Clamp(new VehicleUpgradesSize(9, 99)));
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
        Assert.Equal(within, VehicleUpgradesRegistration.IsWithinBounds(new VehicleUpgradesSize(cols, rows)));

    [Fact]
    public void Registration_operation_ids_resolve_against_the_generated_endpoint_table()
    {
        var index = GeneratedApi.ApiEndpoints.All.ToDictionary(e => e.OperationId, e => e, StringComparer.Ordinal);

        Assert.True(index.TryGetValue(VehicleUpgradesRegistration.UpgradesOperationId, out var upgrades));
        Assert.Contains(VehicleUpgradesRegistration.VehiclePathParam, upgrades!.PathParams);

        Assert.True(index.TryGetValue(Operations.Drives.List, out _));

        Assert.True(index.TryGetValue(Operations.Sharing.DriveShares, out var shares));
        Assert.Contains(VehicleUpgradesRegistration.DrivePathParam, shares!.PathParams);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new VehicleUpgradesDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VehicleUpgradesWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static IReadOnlyList<ParsedUpgrade> Parse(string dataJson)
    {
        using var doc = JsonDocument.Parse(dataJson);
        return UpgradesParser.Parse(doc.RootElement, Localizer);
    }

    private static VehicleUpgradesSnapshot Snapshot(string upgradesDataJson, params ShareLinkInfo[] shareLinks) =>
        new(upgradesDataJson, shareLinks);

    private static VehicleUpgradesDisplay Project(string upgradesDataJson) =>
        Project(upgradesDataJson, VehicleUpgradesSize.Default);

    private static VehicleUpgradesDisplay Project(string upgradesDataJson, VehicleUpgradesSize size) =>
        VehicleUpgradesProjection.Project(Snapshot(upgradesDataJson), size, Now, Localizer);

    private static VehicleUpgradesDisplay ProjectWithLinks(string upgradesDataJson, params ShareLinkInfo[] shareLinks) =>
        VehicleUpgradesProjection.Project(
            Snapshot(upgradesDataJson, shareLinks), VehicleUpgradesSize.Default, Now, Localizer);

    private static RepositoryResult<VehicleUpgradesSnapshot> Loaded(VehicleUpgradesSnapshot snapshot) =>
        RepositoryResult<VehicleUpgradesSnapshot>.Loaded(snapshot, Now);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<VehicleUpgradesSnapshot>>> Drain(IVehicleUpgradesSource source)
    {
        var results = new List<RepositoryResult<VehicleUpgradesSnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            results.Add(result);
        }

        return results;
    }

    private static VehicleUpgradesViewModel NewViewModel(params RepositoryResult<VehicleUpgradesSnapshot>[] emissions) =>
        NewViewModel(VehicleUpgradesSize.Default, emissions);

    private static VehicleUpgradesViewModel NewViewModel(
        VehicleUpgradesSize size,
        params RepositoryResult<VehicleUpgradesSnapshot>[] emissions) =>
        new(new FakeVehicleUpgradesSource(emissions), Localizer, size, () => Now);

    private sealed class FakeVehicleUpgradesSource(params RepositoryResult<VehicleUpgradesSnapshot>[] emissions)
        : IVehicleUpgradesSource
    {
        public async IAsyncEnumerable<RepositoryResult<VehicleUpgradesSnapshot>> StreamAsync(
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

    private sealed class FakeWidgetVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }
}
