using System.ComponentModel;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the application-shell surface's UI-thread-free logic — the navigation catalog
/// (projected from the shared <see cref="RouteTable"/>), the visibility/active-path gating, the pure
/// <see cref="LayoutProjection"/> (badges, pinned/recent/current resolution, per-state classification), the
/// <see cref="LayoutViewModel"/> commands + web side-effects (auto-expand, recent tracking, pin caps) and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/components/layout/Layout.tsx). The WinUI view (<c>Layout</c> in
/// shared-surfaces/Layout.cs) is exercised by the app build.
/// </summary>
public sealed class LayoutTests
{
    private static ILocalizer Localizer => PassthroughLocalizer.Instance;

    private static LayoutViewModel NewViewModel(
        out StaticLayoutLocation location,
        out InMemoryLayoutPreferences prefs,
        out StaticLayoutStatusSource status,
        out StaticAuthModeSource auth,
        string startPath = "",
        bool forwardAuth = false,
        LayoutStatusSnapshot? snapshot = null,
        IReadOnlyList<string>? pinned = null)
    {
        location = new StaticLayoutLocation(startPath);
        prefs = new InMemoryLayoutPreferences(SidebarStyleChoice.Linear, statusBarEnabled: true, pinned, recent: null, expanded: null);
        status = new StaticLayoutStatusSource(snapshot ?? LayoutStatusSnapshot.Loading);
        auth = new StaticAuthModeSource(forwardAuth
            ? RequiresAuthSnapshot.ForwardAuth(RequiresAuthCapabilities.AllDisabled)
            : RequiresAuthSnapshot.Unresolved);
        return new LayoutViewModel(Localizer, location, prefs, status, auth);
    }

    // ── catalog (projected from RouteTable) ──────────────────────────────────────────────────────────────

    [Fact]
    public void Catalog_builds_sections_from_the_shared_route_table()
    {
        Assert.NotEmpty(LayoutNavCatalog.Sections);
        Assert.All(LayoutNavCatalog.Sections, s => Assert.NotEmpty(s.Items));
        Assert.All(LayoutNavCatalog.Sections, s => Assert.NotEqual(RouteGroup.None, s.Group));
    }

    [Theory]
    [InlineData("")]
    [InlineData("vehicles")]
    [InlineData("charging")]
    [InlineData("live")]
    [InlineData("digital-twin")]
    [InlineData("notifications/alerts")]
    [InlineData("data-repair")]
    [InlineData("vehicle-comparison")]
    [InlineData("account/2fa")]
    public void Catalog_contains_the_canonical_gated_and_badged_routes(string path)
    {
        Assert.NotNull(LayoutNavCatalog.FindByExactPath(path));
    }

    [Fact]
    public void Catalog_default_pinned_matches_the_web_first_run_set()
    {
        Assert.Equal(new[] { string.Empty, "digital-twin", "vehicles", "charging", "live" }, LayoutNavCatalog.DefaultPinnedPaths);
        Assert.Equal(8, LayoutNavCatalog.MaxPinnedItems);
        Assert.Equal(3, LayoutNavCatalog.MaxRecentItems);
    }

    [Fact]
    public void Catalog_flags_forward_auth_and_min_vehicle_routes()
    {
        var twoFactor = LayoutNavCatalog.FindByExactPath("account/2fa")!.Item;
        Assert.True(twoFactor.RequiresForwardAuth);

        var compare = LayoutNavCatalog.FindByExactPath("vehicle-comparison")!.Item;
        Assert.Equal(2, compare.MinVehicles);

        var alerts = LayoutNavCatalog.FindByExactPath("notifications/alerts")!.Item;
        Assert.Equal(LayoutNavBadge.Alerts, alerts.Badge);
    }

    // ── gating (web isVisibleNavItem) ────────────────────────────────────────────────────────────────────

    [Fact]
    public void IsVisible_hides_min_vehicle_routes_below_the_threshold()
    {
        var compare = LayoutNavCatalog.FindByExactPath("vehicle-comparison")!.Item;
        Assert.False(LayoutNavCatalog.IsVisible(compare, vehicleCount: 1, isForwardAuth: true));
        Assert.True(LayoutNavCatalog.IsVisible(compare, vehicleCount: 2, isForwardAuth: true));
    }

    [Fact]
    public void IsVisible_hides_forward_auth_routes_in_open_mode()
    {
        var twoFactor = LayoutNavCatalog.FindByExactPath("account/2fa")!.Item;
        Assert.False(LayoutNavCatalog.IsVisible(twoFactor, vehicleCount: 5, isForwardAuth: false));
        Assert.True(LayoutNavCatalog.IsVisible(twoFactor, vehicleCount: 5, isForwardAuth: true));
    }

    // ── active-path (web isActiveNavPath) ────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("", "", true)]
    [InlineData("vehicles", "", false)]
    [InlineData("", "vehicles", false)]
    [InlineData("vehicles", "vehicles", true)]
    [InlineData("vehicles/42", "vehicles", true)]
    [InlineData("vehicles-foo", "vehicles", false)]
    [InlineData("/vehicles/", "vehicles", true)]
    public void IsActive_matches_the_web_exact_and_prefix_semantics(string current, string target, bool expected)
    {
        Assert.Equal(expected, LayoutNavCatalog.IsActive(current, target));
    }

    // ── projection: badges + labels + active ─────────────────────────────────────────────────────────────

    [Fact]
    public void Project_attaches_clamped_live_badges_to_the_canonical_routes()
    {
        var counts = new LayoutBadgeCounts(UnreadAlerts: 12, VehicleCount: 3, StaleSessions: 0);
        var chrome = LayoutProjection.Project(
            "vehicles", LayoutNavCatalog.DefaultPinnedPaths, Array.Empty<string>(), new HashSet<RouteGroup>(),
            LayoutStatusSnapshot.Loaded(counts, DateTimeOffset.UtcNow), isForwardAuth: false,
            SidebarStyleChoice.Linear, statusBarEnabled: true, Localizer);

        var alerts = FindLink(chrome, "notifications/alerts");
        Assert.True(alerts.ShowBadge);
        Assert.Equal("9+", alerts.BadgeText); // 12 clamps to 9+

        var vehicles = FindLink(chrome, "vehicles");
        Assert.True(vehicles.ShowBadge);
        Assert.Equal("3", vehicles.BadgeText);
        Assert.True(vehicles.IsActive);
        Assert.Contains("3", vehicles.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_hides_zero_count_badges()
    {
        var chrome = LayoutProjection.Project(
            "", LayoutNavCatalog.DefaultPinnedPaths, Array.Empty<string>(), new HashSet<RouteGroup>(),
            LayoutStatusSnapshot.Loaded(LayoutBadgeCounts.Zero, DateTimeOffset.UtcNow), isForwardAuth: false,
            SidebarStyleChoice.Linear, statusBarEnabled: true, Localizer);

        var vehicles = FindLink(chrome, "vehicles");
        Assert.False(vehicles.ShowBadge);
        Assert.Equal(string.Empty, vehicles.BadgeText);
    }

    [Fact]
    public void Project_resolves_current_entry_with_pin_toggle_state()
    {
        var chrome = LayoutProjection.Project(
            "charging", LayoutNavCatalog.DefaultPinnedPaths, Array.Empty<string>(), new HashSet<RouteGroup>(),
            LayoutStatusSnapshot.Loaded(new LayoutBadgeCounts(0, 1, 0), DateTimeOffset.UtcNow), isForwardAuth: false,
            SidebarStyleChoice.Linear, statusBarEnabled: true, Localizer);

        Assert.NotNull(chrome.CurrentEntry);
        Assert.Equal("charging", chrome.CurrentEntry!.Path);
        Assert.True(chrome.CurrentEntry.IsPinned); // charging is a default-pinned path
        Assert.Equal(LayoutI18n.UnpinCurrent.Fallback, chrome.CurrentEntry.PinToggleLabel);
        Assert.Equal(LayoutI18n.PinnedAction.Fallback, chrome.CurrentEntry.PinToggleCaption);
    }

    [Fact]
    public void Project_excludes_the_active_page_from_recent_links()
    {
        var recent = new[] { "drives", "trips" };
        var chrome = LayoutProjection.Project(
            "drives", Array.Empty<string>(), recent, new HashSet<RouteGroup>(),
            LayoutStatusSnapshot.Loaded(new LayoutBadgeCounts(0, 1, 0), DateTimeOffset.UtcNow), isForwardAuth: false,
            SidebarStyleChoice.Linear, statusBarEnabled: true, Localizer);

        Assert.DoesNotContain(chrome.RecentLinks, l => string.Equals(l.Path, "drives", StringComparison.Ordinal));
        Assert.Contains(chrome.RecentLinks, l => string.Equals(l.Path, "trips", StringComparison.Ordinal));
    }

    [Fact]
    public void Project_gates_forward_auth_items_into_visible_sections()
    {
        var open = LayoutProjection.Project(
            "", LayoutNavCatalog.DefaultPinnedPaths, Array.Empty<string>(), new HashSet<RouteGroup>(),
            LayoutStatusSnapshot.Loaded(new LayoutBadgeCounts(0, 1, 0), DateTimeOffset.UtcNow), isForwardAuth: false,
            SidebarStyleChoice.Linear, statusBarEnabled: true, Localizer);
        Assert.DoesNotContain(AllLinks(open), l => string.Equals(l.Path, "account/2fa", StringComparison.Ordinal));

        var forward = LayoutProjection.Project(
            "", LayoutNavCatalog.DefaultPinnedPaths, Array.Empty<string>(), new HashSet<RouteGroup>(),
            LayoutStatusSnapshot.Loaded(new LayoutBadgeCounts(0, 1, 0), DateTimeOffset.UtcNow), isForwardAuth: true,
            SidebarStyleChoice.Linear, statusBarEnabled: true, Localizer);
        Assert.Contains(AllLinks(forward), l => string.Equals(l.Path, "account/2fa", StringComparison.Ordinal));
    }

    // ── projection: per-state classification (every state renders) ───────────────────────────────────────

    [Fact]
    public void BadgeText_clamps_like_the_web()
    {
        Assert.Equal(string.Empty, LayoutProjection.BadgeText(0));
        Assert.Equal("5", LayoutProjection.BadgeText(5));
        Assert.Equal("9+", LayoutProjection.BadgeText(10));
    }

    [Theory]
    [MemberData(nameof(StateCases))]
    public void ResolveState_classifies_every_web_load_branch(LayoutStatusSnapshot snapshot, LayoutShellState expected)
    {
        Assert.Equal(expected, snapshot.ResolveState());
    }

    public static IEnumerable<object[]> StateCases()
    {
        var when = DateTimeOffset.UtcNow;
        var counts = new LayoutBadgeCounts(1, 1, 0);
        yield return new object[] { LayoutStatusSnapshot.Loading, LayoutShellState.Loading };
        yield return new object[] { LayoutStatusSnapshot.Loaded(counts, when), LayoutShellState.Ready };
        yield return new object[] { new LayoutStatusSnapshot(LoadStatus.Empty, LayoutBadgeCounts.Zero, false, null, when), LayoutShellState.Empty };
        yield return new object[] { new LayoutStatusSnapshot(LoadStatus.Error, LayoutBadgeCounts.Zero, false, new RepositoryError(RepositoryErrorKind.Server, "x"), null), LayoutShellState.Failed };
        yield return new object[] { new LayoutStatusSnapshot(LoadStatus.Offline, counts, false, new RepositoryError(RepositoryErrorKind.Offline, "x"), when), LayoutShellState.Offline };
        yield return new object[] { new LayoutStatusSnapshot(LoadStatus.Cached, counts, true, null, when), LayoutShellState.Stale };
        yield return new object[] { LayoutStatusSnapshot.Loaded(LayoutBadgeCounts.Zero, when), LayoutShellState.Empty };
    }

    [Fact]
    public void Project_state_message_and_chip_only_show_for_non_ready_states()
    {
        var failed = LayoutProjection.Project(
            "", LayoutNavCatalog.DefaultPinnedPaths, Array.Empty<string>(), new HashSet<RouteGroup>(),
            new LayoutStatusSnapshot(LoadStatus.Error, LayoutBadgeCounts.Zero, false, new RepositoryError(RepositoryErrorKind.Server, "x"), null),
            isForwardAuth: false, SidebarStyleChoice.Linear, statusBarEnabled: true, Localizer);
        Assert.Equal(LayoutShellState.Failed, failed.State);
        Assert.True(failed.ShowStateChip);
        Assert.Equal(LayoutI18n.LoadError.Fallback, failed.StateMessage);
        Assert.True(failed.HasDestinations); // chrome still renders the nav

        var ready = LayoutProjection.Project(
            "", LayoutNavCatalog.DefaultPinnedPaths, Array.Empty<string>(), new HashSet<RouteGroup>(),
            LayoutStatusSnapshot.Loaded(new LayoutBadgeCounts(1, 1, 0), DateTimeOffset.UtcNow),
            isForwardAuth: false, SidebarStyleChoice.Linear, statusBarEnabled: true, Localizer);
        Assert.False(ready.ShowStateChip);
        Assert.Equal(string.Empty, ready.StateMessage);
    }

    // ── i18n / a11y label presence ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Every_i18n_label_resolves_through_the_facade()
    {
        Assert.NotEmpty(LayoutI18n.All);
        Assert.All(LayoutI18n.All, label =>
        {
            Assert.False(string.IsNullOrWhiteSpace(label.Key));
            Assert.Equal(label.Fallback, label.Resolve(Localizer));
        });
    }

    [Fact]
    public void Chrome_labels_carry_the_landmark_and_chrome_accessible_names()
    {
        var labels = LayoutProjection.ResolveLabels(Localizer);
        Assert.Equal("Primary", labels.PrimaryNav);
        Assert.Equal("Site header", labels.PrimaryHeader);
        Assert.Equal("Open sidebar", labels.OpenSidebar);
        Assert.Equal("Open theme picker", labels.ThemeOpenPicker);
        Assert.Equal("Sections", labels.Sections);
        Assert.Equal("Ctrl+K to jump", labels.QuickSearchHint);
    }

    [Fact]
    public void Every_projected_link_carries_a_narrator_name()
    {
        var chrome = LayoutProjection.Project(
            "", LayoutNavCatalog.DefaultPinnedPaths, Array.Empty<string>(), new HashSet<RouteGroup>(),
            LayoutStatusSnapshot.Loaded(new LayoutBadgeCounts(2, 1, 0), DateTimeOffset.UtcNow), isForwardAuth: true,
            SidebarStyleChoice.Linear, statusBarEnabled: true, Localizer);

        Assert.All(AllLinks(chrome), l => Assert.False(string.IsNullOrWhiteSpace(l.AutomationName)));
        Assert.All(chrome.Sections, s => Assert.False(string.IsNullOrWhiteSpace(s.Title)));
    }

    // ── view-model: construction + auto-expand active section ────────────────────────────────────────────

    [Fact]
    public void ViewModel_auto_expands_the_active_section_on_construction()
    {
        using var vm = NewViewModel(out _, out _, out _, out _, startPath: "charging");
        var charging = vm.Chrome.Sections.Single(s => s.Group == RouteGroup.Charging);
        Assert.True(charging.IsExpanded);
    }

    [Fact]
    public void ViewModel_toggle_section_cannot_collapse_the_active_section()
    {
        using var vm = NewViewModel(out _, out _, out _, out _, startPath: "charging");
        vm.ToggleSection(RouteGroup.Charging);
        var charging = vm.Chrome.Sections.Single(s => s.Group == RouteGroup.Charging);
        Assert.True(charging.IsExpanded); // still expanded — it is the active section
    }

    [Fact]
    public void ViewModel_toggle_section_collapses_and_expands_an_inactive_section()
    {
        using var vm = NewViewModel(out _, out _, out _, out _, startPath: "");
        vm.ExpandAllSections();
        var target = vm.Chrome.Sections.First(s => s.Group != RouteGroup.DashboardExplore).Group;
        vm.ToggleSection(target);
        Assert.False(vm.Chrome.Sections.Single(s => s.Group == target).IsExpanded);
        vm.ToggleSection(target);
        Assert.True(vm.Chrome.Sections.Single(s => s.Group == target).IsExpanded);
    }

    [Fact]
    public void ViewModel_collapse_all_clears_then_active_section_re_expands()
    {
        using var vm = NewViewModel(out _, out _, out _, out _, startPath: "");
        vm.CollapseAllSections();
        // The active (Dashboard) section is always shown expanded even after a collapse-all.
        Assert.True(vm.Chrome.Sections.Single(s => s.Group == RouteGroup.DashboardExplore).IsExpanded);
        Assert.Equal(1, vm.Chrome.ExpandedSectionCount);
    }

    // ── view-model: pin / unpin (web pinNavPath / unpinNavPath) ──────────────────────────────────────────

    [Fact]
    public void ViewModel_pin_prepends_caps_at_max_and_persists()
    {
        using var vm = NewViewModel(out _, out var prefs, out _, out _, startPath: "", pinned: Array.Empty<string>());
        foreach (var path in new[] { "vehicles", "charging", "live", "drives", "trips", "energy", "battery", "analytics", "commands" })
        {
            vm.Pin(path);
        }

        Assert.Equal(LayoutNavCatalog.MaxPinnedItems, prefs.PinnedPaths.Count);
        Assert.Equal("commands", prefs.PinnedPaths[0]);
        Assert.DoesNotContain("vehicles", prefs.PinnedPaths); // oldest pin dropped past the cap
        Assert.True(prefs.SaveCount > 0);
    }

    [Fact]
    public void ViewModel_pin_removes_the_path_from_recent()
    {
        using var vm = NewViewModel(out var location, out var prefs, out _, out _, startPath: "");
        location.Set("drives"); // tracked into recent (not pinned, not root)
        Assert.Contains("drives", prefs.RecentPaths);

        vm.Pin("drives");
        Assert.Contains("drives", prefs.PinnedPaths);
        Assert.DoesNotContain("drives", prefs.RecentPaths);
    }

    [Fact]
    public void ViewModel_unpin_removes_the_pinned_path()
    {
        using var vm = NewViewModel(out _, out var prefs, out _, out _, startPath: "");
        Assert.Contains("vehicles", prefs.PinnedPaths);
        vm.Unpin("vehicles");
        Assert.DoesNotContain("vehicles", prefs.PinnedPaths);
    }

    [Fact]
    public void ViewModel_toggle_pin_current_flips_the_active_pages_pinned_state()
    {
        using var vm = NewViewModel(out _, out var prefs, out _, out _, startPath: "charging");
        Assert.True(vm.Chrome.CurrentEntry!.IsPinned);
        vm.TogglePinCurrent();
        Assert.DoesNotContain("charging", prefs.PinnedPaths);
        Assert.False(vm.Chrome.CurrentEntry!.IsPinned);
        vm.TogglePinCurrent();
        Assert.Contains("charging", prefs.PinnedPaths);
    }

    // ── view-model: location side-effects + reproject ────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_navigation_tracks_recent_and_raises_property_changed()
    {
        using var vm = NewViewModel(out var location, out var prefs, out _, out _, startPath: "");
        int changes = CountChanges(vm, () => location.Set("trips"));

        Assert.Contains("trips", prefs.RecentPaths);
        Assert.True(changes > 0);
        Assert.True(vm.Chrome.Sections.Single(s => s.Group == RouteGroup.TripsDriving).IsExpanded);
    }

    [Fact]
    public void ViewModel_does_not_track_root_or_pinned_pages_in_recent()
    {
        using var vm = NewViewModel(out var location, out var prefs, out _, out _, startPath: "");
        location.Set("vehicles"); // a default-pinned path
        Assert.DoesNotContain("vehicles", prefs.RecentPaths);
        location.Set(string.Empty); // root
        Assert.DoesNotContain(string.Empty, prefs.RecentPaths);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_status_source_moves()
    {
        using var vm = NewViewModel(out _, out _, out var status, out _, startPath: "");
        Assert.Equal(LayoutShellState.Loading, vm.State);

        int changes = CountChanges(vm, () =>
            status.Set(LayoutStatusSnapshot.Loaded(new LayoutBadgeCounts(4, 2, 1), DateTimeOffset.UtcNow)));

        Assert.True(changes > 0);
        Assert.Equal(LayoutShellState.Ready, vm.State);
        Assert.Equal("4", FindLink(vm.Chrome, "notifications/alerts").BadgeText);
    }

    [Fact]
    public void ViewModel_reveals_forward_auth_items_when_the_auth_mode_resolves()
    {
        using var vm = NewViewModel(out _, out _, out var status, out var auth, startPath: "");
        status.Set(LayoutStatusSnapshot.Loaded(new LayoutBadgeCounts(0, 1, 0), DateTimeOffset.UtcNow));
        Assert.DoesNotContain(AllLinks(vm.Chrome), l => string.Equals(l.Path, "account/2fa", StringComparison.Ordinal));

        auth.Set(RequiresAuthSnapshot.ForwardAuth(RequiresAuthCapabilities.AllDisabled));
        Assert.True(vm.IsForwardAuth);
        Assert.Contains(AllLinks(vm.Chrome), l => string.Equals(l.Path, "account/2fa", StringComparison.Ordinal));
    }

    [Fact]
    public void ViewModel_request_refresh_forwards_the_poll_tick()
    {
        using var vm = NewViewModel(out _, out _, out var status, out _, startPath: "");
        vm.RequestRefresh();
        Assert.Equal(1, status.RefreshCount);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_every_source()
    {
        var vm = NewViewModel(out var location, out _, out var status, out _, startPath: "");
        vm.Dispose();

        int changes = CountChanges(vm, () =>
        {
            location.Set("drives");
            status.Set(LayoutStatusSnapshot.Loaded(new LayoutBadgeCounts(9, 9, 9), DateTimeOffset.UtcNow));
        });
        Assert.Equal(0, changes);
    }

    // ── diagnostics (PII-safe view.opened) ───────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_emits_only_the_slugged_view_opened_signal()
    {
        var emitted = new List<string>();
        var diagnostics = new LayoutDiagnostics(emitted.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(new[] { "view.opened slug=Layout" }, emitted);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static IEnumerable<LayoutNavLinkView> AllLinks(LayoutChrome chrome) =>
        chrome.Sections.SelectMany(s => s.Links);

    private static LayoutNavLinkView FindLink(LayoutChrome chrome, string path) =>
        AllLinks(chrome).First(l => string.Equals(l.Path, path, StringComparison.Ordinal));

    private static int CountChanges(INotifyPropertyChanged vm, Action act)
    {
        int count = 0;
        void Handler(object? sender, PropertyChangedEventArgs e)
        {
            if (e.PropertyName == nameof(LayoutViewModel.Chrome))
            {
                count++;
            }
        }

        vm.PropertyChanged += Handler;
        try
        {
            act();
        }
        finally
        {
            vm.PropertyChanged -= Handler;
        }

        return count;
    }
}
