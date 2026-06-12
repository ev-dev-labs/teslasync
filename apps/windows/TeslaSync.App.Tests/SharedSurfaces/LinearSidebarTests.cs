using System.Collections.Generic;
using System.Linq;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the LinearSidebar surface's UI-thread-free logic — the registration slug + i18n
/// keys/fallbacks + count/page interpolation (<see cref="LinearSidebarRegistration"/>); the pure active-path /
/// tokenizer / match / favorites-resolve / projection adapters with their trailing-badge + collapse + empty-
/// filter contract (<see cref="LinearSidebarProjection"/>); the in-memory seams
/// (<see cref="InMemoryNavLocationSource"/>, <see cref="InMemoryPinnedPagesStore"/>); the state-holder
/// view-model's collapse seeding / toggle / filter / pin-unpin / active-section / pathname / counts transitions
/// (<see cref="LinearSidebarViewModel"/>); and the PII-safe diagnostics (<see cref="LinearSidebarDiagnostics"/>).
/// Mirrors the web spec one-for-one (web/src/components/layout/sidebar/LinearSidebar.tsx). The WinUI view
/// (LinearSidebar.cs, which composes the favorites group + section Expanders + active accent + trailing badges +
/// hover actions + the empty-filter live region) is exercised by the app build.
/// </summary>
public sealed class LinearSidebarTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private const string PageGlyph = "\uE7C3";

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static LinearNavItem Item(string to, string label) => new(to, label, PageGlyph);

    private static LinearNavSection Section(string title, params LinearNavItem[] items) => new(title, items);

    private static IReadOnlyList<LinearNavSection> Sample() => new[]
    {
        Section(
            "Fleet",
            Item("/", "Dashboard"),
            Item("/vehicles", "Vehicles"),
            Item("/notifications/alerts", "Alerts")),
        Section(
            "Operations",
            Item("/data-repair", "Data Repair"),
            Item("/charging", "Charging")),
    };

    private static LinearSidebarDisplay Project(
        IReadOnlyList<LinearNavSection>? sections = null,
        IReadOnlyList<string>? pinnedKeys = null,
        string pathname = "/",
        Func<string, string>? navLabel = null,
        IReadOnlySet<string>? collapsed = null,
        string? filter = null,
        int alertCount = 0,
        int vehicleCount = 0,
        int staleCount = 0,
        ILocalizer? localizer = null) =>
        LinearSidebarProjection.Project(
            sections ?? Sample(),
            pinnedKeys ?? Array.Empty<string>(),
            pathname,
            navLabel,
            collapsed ?? new HashSet<string>(StringComparer.Ordinal),
            filter,
            alertCount,
            vehicleCount,
            staleCount,
            localizer ?? Localizer);

    // ---- Registration: slug + keys + interpolation -------------------------------------------------

    [Fact]
    public void Slug_is_the_surface_name() =>
        Assert.Equal("LinearSidebar", LinearSidebarRegistration.Slug);

    [Theory]
    [InlineData("translation.nav.sidebar")]
    [InlineData("translation.nav.favorites")]
    [InlineData("translation.nav.filterNoMatch")]
    [InlineData("translation.nav.filterClear")]
    [InlineData("translation.nav.vehicleCount")]
    [InlineData("translation.nav.staleCount")]
    [InlineData("translation.nav.pinPage")]
    [InlineData("translation.nav.unpinPage")]
    public void I18n_keys_carry_the_catalog_prefix(string key) =>
        Assert.StartsWith("translation.nav.", key, StringComparison.Ordinal);

    [Fact]
    public void FormatCount_substitutes_both_token_styles()
    {
        Assert.Equal("3 vehicles", LinearSidebarRegistration.FormatCount("{{count}} vehicles", 3));
        Assert.Equal("7 stale rows", LinearSidebarRegistration.FormatCount("{0} stale rows", 7));
    }

    [Fact]
    public void FormatPage_substitutes_both_token_styles()
    {
        Assert.Equal("Pin Vehicles to favorites", LinearSidebarRegistration.FormatPage("Pin {{page}} to favorites", "Vehicles"));
        Assert.Equal("Unpin Vehicles", LinearSidebarRegistration.FormatPage("Unpin {0}", "Vehicles"));
    }

    [Theory]
    [InlineData(0, "0")]
    [InlineData(3, "3")]
    [InlineData(99, "99")]
    [InlineData(100, "99+")]
    [InlineData(1000, "99+")]
    public void CountChipText_caps_at_99(int value, string expected) =>
        Assert.Equal(expected, LinearSidebarRegistration.CountChipText(value));

    // ---- Active-path helper (web isActiveLinearPath) -----------------------------------------------

    [Theory]
    [InlineData("/", "/", true)]
    [InlineData("/vehicles", "/", false)]
    [InlineData("/vehicles", "/vehicles", true)]
    [InlineData("/vehicles/3", "/vehicles", true)]
    [InlineData("/vehicles/3/state", "/vehicles", true)]
    [InlineData("/vehiclesx", "/vehicles", false)]
    [InlineData("/charging", "/vehicles", false)]
    public void IsActivePath_matches_self_and_descendants(string pathname, string to, bool expected) =>
        Assert.Equal(expected, LinearSidebarProjection.IsActivePath(pathname, to));

    // ---- Tokenizer + match (web filterTokens + matchesFilter) --------------------------------------

    [Fact]
    public void Tokenize_splits_lowercase_whitespace_and_drops_blanks()
    {
        Assert.Empty(LinearSidebarProjection.Tokenize(null));
        Assert.Empty(LinearSidebarProjection.Tokenize("   "));
        Assert.Equal(new[] { "live", "map" }, LinearSidebarProjection.Tokenize("  Live   MAP "));
    }

    [Fact]
    public void Matches_requires_every_token_case_insensitively()
    {
        IReadOnlyList<string> tokens = LinearSidebarProjection.Tokenize("data rep");
        Assert.True(LinearSidebarProjection.Matches("Data Repair", tokens));
        Assert.False(LinearSidebarProjection.Matches("Data", tokens));
        Assert.True(LinearSidebarProjection.Matches("anything", Array.Empty<string>()));
    }

    // ---- ResolvePinned (web pinnedItems derivation) ------------------------------------------------

    [Fact]
    public void ResolvePinned_keeps_pin_order_and_skips_unknown_keys()
    {
        IReadOnlyList<LinearNavItem> resolved = LinearSidebarProjection.ResolvePinned(
            Sample(), new[] { "/charging", "/missing", "/vehicles" });

        Assert.Equal(new[] { "/charging", "/vehicles" }, resolved.Select(i => i.To));
    }

    // ---- Projection: tree shape, favorites, active, trailing ---------------------------------------

    [Fact]
    public void Project_renders_every_section_when_unfiltered()
    {
        LinearSidebarDisplay display = Project();

        Assert.Equal(LinearSidebarContentState.Tree, display.ContentState);
        Assert.False(display.IsFilterActive);
        Assert.False(display.IsEmptyFilter);
        Assert.Null(display.Favorites);
        Assert.Equal(new[] { "Fleet", "Operations" }, display.Sections.Select(s => s.Title));
        Assert.Equal(3, display.Sections[0].Count);
    }

    [Fact]
    public void Project_flags_the_active_row()
    {
        LinearSidebarDisplay display = Project(pathname: "/vehicles/3");

        LinearNavLinkDisplay vehicles = display.Sections[0].Items.Single(r => r.To == "/vehicles");
        LinearNavLinkDisplay dashboard = display.Sections[0].Items.Single(r => r.To == "/");

        Assert.True(vehicles.IsActive);
        Assert.False(dashboard.IsActive);
    }

    [Fact]
    public void Project_routes_trailing_badges_like_the_web()
    {
        LinearSidebarDisplay display = Project(alertCount: 2, vehicleCount: 4, staleCount: 7);

        LinearNavLinkDisplay alerts = display.Sections[0].Items.Single(r => r.To == "/notifications/alerts");
        LinearNavLinkDisplay vehicles = display.Sections[0].Items.Single(r => r.To == "/vehicles");
        LinearNavLinkDisplay repair = display.Sections[1].Items.Single(r => r.To == "/data-repair");
        LinearNavLinkDisplay charging = display.Sections[1].Items.Single(r => r.To == "/charging");

        Assert.Equal(LinearTrailingKind.NotificationDot, alerts.Trailing);
        Assert.Equal(LinearTrailingKind.CountChip, vehicles.Trailing);
        Assert.Equal("4 vehicles", vehicles.TrailingLabel);
        Assert.Equal(LinearTrailingKind.CountChip, repair.Trailing);
        Assert.Equal("7 stale rows", repair.TrailingLabel);
        Assert.Equal(LinearTrailingKind.None, charging.Trailing);
    }

    [Fact]
    public void Project_suppresses_badges_when_counts_are_zero()
    {
        LinearSidebarDisplay display = Project();

        Assert.Equal(LinearTrailingKind.None, display.Sections[0].Items.Single(r => r.To == "/notifications/alerts").Trailing);
        Assert.Equal(LinearTrailingKind.None, display.Sections[0].Items.Single(r => r.To == "/vehicles").Trailing);
    }

    [Fact]
    public void Project_builds_favorites_and_hides_the_pin_action_for_pinned_section_rows()
    {
        LinearSidebarDisplay display = Project(pinnedKeys: new[] { "/vehicles" });

        Assert.NotNull(display.Favorites);
        Assert.Equal("Favorites", display.Favorites!.Label);
        LinearNavLinkDisplay favorite = Assert.Single(display.Favorites.Items);
        Assert.Equal("/vehicles", favorite.To);
        Assert.True(favorite.ShowUnpin);
        Assert.False(favorite.ShowPin);
        Assert.Equal("Unpin Vehicles", favorite.UnpinLabel);

        // The same item still appears in its source section, but with no pin action (web pinnedSet behaviour).
        LinearNavLinkDisplay sectionRow = display.Sections[0].Items.Single(r => r.To == "/vehicles");
        Assert.False(sectionRow.ShowPin);
        Assert.False(sectionRow.ShowUnpin);

        // A non-pinned section row offers the pin action.
        LinearNavLinkDisplay charging = display.Sections[1].Items.Single(r => r.To == "/charging");
        Assert.True(charging.ShowPin);
        Assert.Equal("Pin Charging to favorites", charging.PinLabel);
    }

    // ---- Projection: collapse + filter expansion ---------------------------------------------------

    [Fact]
    public void Project_collapses_only_the_listed_sections()
    {
        var collapsed = new HashSet<string>(new[] { "Operations" }, StringComparer.Ordinal);
        LinearSidebarDisplay display = Project(collapsed: collapsed);

        Assert.True(display.Sections.Single(s => s.Title == "Fleet").IsExpanded);
        Assert.False(display.Sections.Single(s => s.Title == "Operations").IsExpanded);
    }

    [Fact]
    public void Project_forces_every_matching_section_open_while_filtering()
    {
        var collapsed = new HashSet<string>(new[] { "Fleet", "Operations" }, StringComparer.Ordinal);
        LinearSidebarDisplay display = Project(collapsed: collapsed, filter: "charging");

        Assert.True(display.IsFilterActive);
        LinearSectionDisplay operations = Assert.Single(display.Sections);
        Assert.Equal("Operations", operations.Title);
        Assert.True(operations.IsExpanded);
        Assert.Equal("/charging", Assert.Single(operations.Items).To);
    }

    [Fact]
    public void Project_emits_empty_filter_state_when_no_section_matches()
    {
        LinearSidebarDisplay display = Project(filter: "zzz-nothing");

        Assert.True(display.IsFilterActive);
        Assert.True(display.IsEmptyFilter);
        Assert.Equal(LinearSidebarContentState.EmptyFilter, display.ContentState);
        Assert.Empty(display.Sections);
        Assert.Equal("No matches.", display.EmptyFilterMessage);
        Assert.Equal("Clear filter", display.ClearFilterLabel);
    }

    [Fact]
    public void Project_keeps_favorites_header_even_when_filter_hides_all_pinned_rows()
    {
        LinearSidebarDisplay display = Project(pinnedKeys: new[] { "/vehicles" }, filter: "zzz-nothing");

        Assert.NotNull(display.Favorites);
        Assert.Empty(display.Favorites!.Items);
        Assert.True(display.IsEmptyFilter);
    }

    [Fact]
    public void Project_applies_the_navLabel_resolver()
    {
        LinearSidebarDisplay display = Project(navLabel: label => label.ToUpperInvariant());

        Assert.Contains(display.Sections[0].Items, r => r.Label == "VEHICLES");
    }

    // ---- Accessibility names -----------------------------------------------------------------------

    [Fact]
    public void Nav_landmark_uses_the_localized_sidebar_name()
    {
        LinearSidebarDisplay display = Project();
        Assert.Equal("Sidebar navigation", display.NavAutomationName);
    }

    [Fact]
    public void Every_surface_owned_string_flows_through_the_localizer()
    {
        var localizer = new RecordingLocalizer();
        Project(pinnedKeys: new[] { "/vehicles" }, vehicleCount: 2, localizer: localizer);

        Assert.Contains("translation.nav.sidebar", localizer.RequestedKeys);
        Assert.Contains("translation.nav.favorites", localizer.RequestedKeys);
        Assert.Contains("translation.nav.filterNoMatch", localizer.RequestedKeys);
        Assert.Contains("translation.nav.filterClear", localizer.RequestedKeys);
        Assert.Contains("translation.nav.vehicleCount", localizer.RequestedKeys);
        Assert.Contains("translation.nav.pinPage", localizer.RequestedKeys);
        Assert.Contains("translation.nav.unpinPage", localizer.RequestedKeys);
    }

    // ---- Seams -------------------------------------------------------------------------------------

    [Fact]
    public void Location_source_normalizes_and_notifies_on_change()
    {
        var location = new InMemoryNavLocationSource();
        Assert.Equal("/", location.CurrentPath);

        int notified = 0;
        location.PathChanged += (_, _) => notified++;
        location.Navigate("/vehicles");
        location.Navigate("/vehicles"); // no-op

        Assert.Equal("/vehicles", location.CurrentPath);
        Assert.Equal(1, notified);
    }

    [Fact]
    public void Pinned_store_dedupes_keeps_order_and_notifies()
    {
        var store = new InMemoryPinnedPagesStore(new[] { "/a", "/a" });
        int notified = 0;
        store.Changed += (_, _) => notified++;

        store.Pin("/b");
        store.Pin("/a");   // already pinned → no-op
        store.Unpin("/missing"); // absent → no-op

        Assert.Equal(new[] { "/a", "/b" }, store.Pinned);
        Assert.True(store.IsPinned("/a"));
        Assert.Equal(1, notified);

        store.Unpin("/a");
        Assert.Equal(new[] { "/b" }, store.Pinned);
        Assert.Equal(2, notified);
    }

    // ---- View-model --------------------------------------------------------------------------------

    [Fact]
    public void ViewModel_seeds_collapse_to_everything_except_the_active_section()
    {
        using var vm = new LinearSidebarViewModel(Localizer, Sample(), activeSectionTitle: "Operations");

        Assert.True(vm.IsSectionExpanded("Operations"));
        Assert.False(vm.IsSectionExpanded("Fleet"));
    }

    [Fact]
    public void ViewModel_toggle_section_flips_collapse()
    {
        using var vm = new LinearSidebarViewModel(Localizer, Sample(), activeSectionTitle: "Fleet");
        Assert.True(vm.IsSectionExpanded("Fleet"));

        vm.ToggleSection("Fleet");
        Assert.False(vm.IsSectionExpanded("Fleet"));

        vm.ToggleSection("Fleet");
        Assert.True(vm.IsSectionExpanded("Fleet"));
    }

    [Fact]
    public void ViewModel_active_section_change_auto_expands()
    {
        using var vm = new LinearSidebarViewModel(Localizer, Sample());
        Assert.False(vm.IsSectionExpanded("Operations"));

        vm.SetActiveSectionTitle("Operations");
        Assert.True(vm.IsSectionExpanded("Operations"));
    }

    [Fact]
    public void ViewModel_filter_then_clear_round_trips_the_empty_state()
    {
        using var vm = new LinearSidebarViewModel(Localizer, Sample());

        vm.SetFilter("zzz-nothing");
        Assert.True(vm.Display.IsEmptyFilter);

        vm.ClearFilter();
        Assert.False(vm.Display.IsEmptyFilter);
        Assert.Equal(string.Empty, vm.Filter);
    }

    [Fact]
    public void ViewModel_pin_and_unpin_route_through_the_store()
    {
        var store = new InMemoryPinnedPagesStore();
        using var vm = new LinearSidebarViewModel(Localizer, Sample(), pinnedStore: store);

        vm.Pin("/charging");
        Assert.NotNull(vm.Display.Favorites);
        Assert.Equal("/charging", Assert.Single(vm.Display.Favorites!.Items).To);

        vm.Unpin("/charging");
        Assert.Null(vm.Display.Favorites);
    }

    [Fact]
    public void ViewModel_pathname_override_takes_precedence_over_location()
    {
        var location = new InMemoryNavLocationSource("/charging");
        using var vm = new LinearSidebarViewModel(Localizer, Sample(), location: location);
        Assert.Equal("/charging", vm.EffectivePath);

        vm.SetPathname("/vehicles");
        Assert.Equal("/vehicles", vm.EffectivePath);

        vm.SetPathname(null);
        Assert.Equal("/charging", vm.EffectivePath);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_location_changes()
    {
        var location = new InMemoryNavLocationSource("/");
        using var vm = new LinearSidebarViewModel(Localizer, Sample(), location: location);

        int notified = 0;
        vm.PropertyChanged += (_, _) => notified++;
        location.Navigate("/vehicles");

        Assert.True(notified > 0);
        Assert.Equal("/vehicles", vm.EffectivePath);
        Assert.True(vm.Display.Sections[0].Items.Single(r => r.To == "/vehicles").IsActive);
    }

    [Fact]
    public void ViewModel_select_item_echoes_to_the_callback()
    {
        using var vm = new LinearSidebarViewModel(Localizer, Sample());
        string? selected = null;
        vm.ItemSelected += (_, to) => selected = to;

        vm.SelectItem("/charging");
        Assert.Equal("/charging", selected);
    }

    [Fact]
    public void ViewModel_counts_drive_the_trailing_badges()
    {
        using var vm = new LinearSidebarViewModel(Localizer, Sample());
        Assert.Equal(LinearTrailingKind.None, vm.Display.Sections[0].Items.Single(r => r.To == "/vehicles").Trailing);

        vm.SetCounts(alertCount: 0, vehicleCount: 5, staleCount: 0);
        LinearNavLinkDisplay vehicles = vm.Display.Sections[0].Items.Single(r => r.To == "/vehicles");
        Assert.Equal(LinearTrailingKind.CountChip, vehicles.Trailing);
        Assert.Equal("5 vehicles", vehicles.TrailingLabel);
    }

    [Fact]
    public void ViewModel_dispose_detaches_from_the_seams()
    {
        var location = new InMemoryNavLocationSource("/");
        var vm = new LinearSidebarViewModel(Localizer, Sample(), location: location);
        vm.Dispose();

        int notified = 0;
        vm.PropertyChanged += (_, _) => notified++;
        location.Navigate("/vehicles");

        Assert.Equal(0, notified);
    }

    // ---- Diagnostics -------------------------------------------------------------------------------

    [Fact]
    public void Diagnostics_records_only_the_slug()
    {
        var lines = new List<string>();
        var diagnostics = new LinearSidebarDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.All(lines, line => Assert.Equal("view.opened slug=LinearSidebar", line));
    }
}
