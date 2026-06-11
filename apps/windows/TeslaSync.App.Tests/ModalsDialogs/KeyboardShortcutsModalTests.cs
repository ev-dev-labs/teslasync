using System.Text.RegularExpressions;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the keyboard-shortcuts cheatsheet's UI-thread-free logic — the registry external
/// store (register / dedupe-by-id / unregister / reset / change notification), the route context, the persisted
/// filter store + token round-trip, the <see cref="ShortcutProjection"/> (scope + route + search filtering, the
/// group-by, the per-group id sort and the group rank/title sort), the state-holder view-model's state matrix
/// (loading / loaded / empty, mode persistence, live registry + route re-projection, search reset on close), the
/// registry metadata + i18n keys, the diagnostics and the accessible row name. The WinUI view itself (which
/// references Microsoft.UI) is exercised by the app build; this project asserts every state and branch the web
/// spec (web/src/components/feedback/KeyboardShortcutsModal.tsx) renders, headlessly.
/// </summary>
public sealed class KeyboardShortcutsModalTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ---- ShortcutDefinition route matching + accessible name ----------------------------

    [Fact]
    public void Global_definition_has_no_route()
    {
        ShortcutDefinition def = Global("g", "Global", "Toggle theme", "t");
        Assert.False(def.HasRoute);
    }

    [Theory]
    [InlineData("/charging", true)]
    [InlineData("/charging/42", true)]
    [InlineData("/drives", false)]
    [InlineData("/", false)]
    public void Route_prefix_matches_pathname(string pathname, bool expected)
    {
        ShortcutDefinition def = Route("r", "Charging", "Start charge", "/charging", "c");
        Assert.True(def.HasRoute);
        Assert.Equal(expected, def.MatchesRoute(pathname));
    }

    [Theory]
    [InlineData("/drives/42", true)]
    [InlineData("/drives/abc", false)]
    [InlineData("/drives", false)]
    public void Route_regex_matches_pathname(string pathname, bool expected)
    {
        ShortcutDefinition def = new()
        {
            Id = "rx",
            Keys = new[] { "g", "d" },
            Description = "Open drive",
            Group = "Navigation",
            Scope = ShortcutScope.Route,
            RoutePattern = new Regex("^/drives/\\d+$"),
        };

        Assert.True(def.HasRoute);
        Assert.Equal(expected, def.MatchesRoute(pathname));
    }

    [Fact]
    public void AccessibleName_joins_description_and_keys()
    {
        Assert.Equal("Open command palette: Ctrl + K",
            Global("p", "Actions", "Open command palette", "Ctrl", "K").AccessibleName);
        Assert.Equal("Dismiss", Global("e", "Global", "Dismiss").AccessibleName);
    }

    // ---- GroupRank (web GROUP_PRIORITY + first-token split) ------------------------------

    [Theory]
    [InlineData("navigation", 100)]
    [InlineData("Actions", 90)]
    [InlineData("global", 90)]
    [InlineData("commands", 80)]
    [InlineData("table view", 70)]   // first token before whitespace
    [InlineData("form(x)", 50)]      // first token before '('
    [InlineData("Replay", 20)]
    [InlineData("Trip replay", 0)]   // first token "trip" is not a priority key
    [InlineData("Unknown", 0)]
    [InlineData("", 0)]
    public void GroupRank_uses_first_token_priority(string label, int expected)
    {
        Assert.Equal(expected, ShortcutProjection.GroupRank(label));
    }

    // ---- Projection: scope + route filtering --------------------------------------------

    [Fact]
    public void Project_all_mode_shows_globals_plus_matching_route_entries()
    {
        ShortcutDefinition[] all =
        {
            Global("g", "Global", "Toggle theme", "t"),
            Route("r", "Charging", "Start charge", "/charging", "c"),
            Page("p", "Charging", "Stop charge", "/charging", "s"),
        };

        IReadOnlyList<ShortcutGroup> onCharging = ShortcutProjection.Project(all, ShortcutFilterMode.All, "/charging", "");
        Assert.Equal(new[] { "g", "r", "p" }.OrderBy(x => x), Ids(onCharging).OrderBy(x => x));

        IReadOnlyList<ShortcutGroup> onRoot = ShortcutProjection.Project(all, ShortcutFilterMode.All, "/", "");
        Assert.Equal(new[] { "g" }, Ids(onRoot));
    }

    [Fact]
    public void Project_global_mode_shows_only_global_scope()
    {
        ShortcutDefinition[] all =
        {
            Global("g", "Global", "Toggle theme", "t"),
            Route("r", "Charging", "Start charge", "/charging", "c"),
        };

        IReadOnlyList<ShortcutGroup> groups = ShortcutProjection.Project(all, ShortcutFilterMode.Global, "/charging", "");
        Assert.Equal(new[] { "g" }, Ids(groups));
    }

    [Fact]
    public void Project_page_mode_shows_only_matching_non_global()
    {
        ShortcutDefinition[] all =
        {
            Global("g", "Global", "Toggle theme", "t"),
            Route("r", "Charging", "Start charge", "/charging", "c"),
            Page("p", "Charging", "Stop charge", "/charging", "s"),
        };

        IReadOnlyList<ShortcutGroup> onCharging = ShortcutProjection.Project(all, ShortcutFilterMode.Page, "/charging", "");
        Assert.Equal(new[] { "p", "r" }, Ids(onCharging).OrderBy(x => x).ToArray());

        IReadOnlyList<ShortcutGroup> onRoot = ShortcutProjection.Project(all, ShortcutFilterMode.Page, "/", "");
        Assert.Empty(onRoot);
    }

    // ---- Projection: search filter ------------------------------------------------------

    [Theory]
    [InlineData("open", new[] { "a" })]
    [InlineData("PALETTE", new[] { "a" })]   // case-insensitive
    [InlineData("  close  ", new[] { "b" })]  // trimmed
    [InlineData("zzz", new string[0])]
    public void Project_filters_by_description_substring(string search, string[] expectedIds)
    {
        ShortcutDefinition[] all =
        {
            Global("a", "Actions", "Open command palette", "Ctrl", "K"),
            Global("b", "Actions", "Close panel", "Esc"),
        };

        IReadOnlyList<ShortcutGroup> groups = ShortcutProjection.Project(all, ShortcutFilterMode.All, "/", search);
        Assert.Equal(expectedIds.OrderBy(x => x).ToArray(), Ids(groups).OrderBy(x => x).ToArray());
    }

    // ---- Projection: grouping + ordering ------------------------------------------------

    [Fact]
    public void Project_orders_groups_by_rank_then_title_and_entries_by_id()
    {
        ShortcutDefinition[] all =
        {
            Global("nav-z", "navigation", "Z nav", "z"),
            Global("nav-a", "navigation", "A nav", "a"),
            Global("act", "actions", "Act", "x"),
            Global("rep", "Replay", "Replay", "r"),
            Global("zeb", "Zebra", "Zebra", "9"),
            Global("alp", "Alpha", "Alpha", "1"),
        };

        IReadOnlyList<ShortcutGroup> groups = ShortcutProjection.Project(all, ShortcutFilterMode.All, "/", "");

        // navigation(100) > actions(90) > Replay(20) > rank-0 groups alpha-sorted (Alpha, Zebra).
        Assert.Equal(new[] { "navigation", "actions", "Replay", "Alpha", "Zebra" },
            groups.Select(g => g.Title).ToArray());

        // entries inside a group sort by id (nav-a before nav-z).
        ShortcutGroup nav = groups[0];
        Assert.Equal(new[] { "nav-a", "nav-z" }, nav.Shortcuts.Select(s => s.Id).ToArray());
    }

    // ---- Registry external store --------------------------------------------------------

    [Fact]
    public void Registry_register_is_last_writer_wins_by_id_and_keeps_order()
    {
        var registry = new ShortcutRegistry();
        int changes = 0;
        registry.Changed += (_, _) => changes++;

        registry.Register(Global("a", "Actions", "First", "1"));
        registry.Register(Global("b", "Actions", "Second", "2"));
        registry.Register(Global("a", "Actions", "First (updated)", "1"));   // replace, keep position

        Assert.Equal(new[] { "a", "b" }, registry.Snapshot.Select(s => s.Id).ToArray());
        Assert.Equal("First (updated)", registry.Snapshot[0].Description);
        Assert.Equal(3, changes);
    }

    [Fact]
    public void Registry_unregister_and_reset()
    {
        var registry = new ShortcutRegistry();
        registry.Register(Global("a", "Actions", "First", "1"));
        registry.Register(Global("b", "Actions", "Second", "2"));

        Assert.True(registry.Unregister("a"));
        Assert.False(registry.Unregister("missing"));
        Assert.Equal(new[] { "b" }, registry.Snapshot.Select(s => s.Id).ToArray());

        registry.Reset();
        Assert.Empty(registry.Snapshot);
    }

    // ---- Route context ------------------------------------------------------------------

    [Fact]
    public void RouteContext_raises_changed_only_on_actual_change()
    {
        var route = new StaticRouteContext();
        Assert.Equal("/", route.CurrentPath);

        int changes = 0;
        route.Changed += (_, _) => changes++;

        route.Navigate("/");          // no change
        route.Navigate("/charging");  // change
        route.Navigate("/charging");  // no change

        Assert.Equal("/charging", route.CurrentPath);
        Assert.Equal(1, changes);
    }

    // ---- Filter store + token round-trip ------------------------------------------------

    [Theory]
    [InlineData(ShortcutFilterMode.All, "all")]
    [InlineData(ShortcutFilterMode.Global, "global")]
    [InlineData(ShortcutFilterMode.Page, "page")]
    public void FilterMode_token_round_trips(ShortcutFilterMode mode, string token)
    {
        Assert.Equal(token, ShortcutFilterModes.Token(mode));
        Assert.Equal(mode, ShortcutFilterModes.Parse(token));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("nonsense")]
    public void FilterMode_parse_defaults_to_all(string? token)
    {
        Assert.Equal(ShortcutFilterMode.All, ShortcutFilterModes.Parse(token));
    }

    [Fact]
    public void FilterStore_session_key_matches_web()
    {
        Assert.Equal("teslasync:shortcuts:filter:v1", ShortcutFilterModes.SessionStorageKey);
        Assert.Equal(ShortcutFilterMode.All, new InMemoryShortcutFilterStore().Read());
    }

    // ---- ViewModel: state matrix --------------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading_until_opened()
    {
        var registry = new ShortcutRegistry();
        registry.Register(Global("a", "Actions", "Open palette", "Ctrl", "K"));
        using var vm = NewVm(registry);

        Assert.Equal(KeyboardShortcutsState.Loading, vm.State);
        Assert.True(vm.IsLoading);

        vm.Open();

        Assert.Equal(KeyboardShortcutsState.Loaded, vm.State);
        Assert.True(vm.HasGroups);
    }

    [Fact]
    public void ViewModel_empty_when_no_shortcuts_match()
    {
        using var vm = NewVm(new ShortcutRegistry());
        vm.Open();

        Assert.Equal(KeyboardShortcutsState.Empty, vm.State);
        Assert.True(vm.IsEmpty);
        Assert.Equal("No shortcuts match your search.", vm.EmptyMessage);
    }

    [Fact]
    public void ViewModel_search_narrows_to_empty()
    {
        var registry = new ShortcutRegistry();
        registry.Register(Global("a", "Actions", "Open palette", "Ctrl", "K"));
        using var vm = NewVm(registry);
        vm.Open();
        Assert.Equal(KeyboardShortcutsState.Loaded, vm.State);

        vm.Search = "nonexistent";
        Assert.Equal(KeyboardShortcutsState.Empty, vm.State);

        vm.Search = "palette";
        Assert.Equal(KeyboardShortcutsState.Loaded, vm.State);
    }

    [Fact]
    public void ViewModel_reads_persisted_filter_on_construct()
    {
        var store = new InMemoryShortcutFilterStore();
        store.Write(ShortcutFilterMode.Page);

        using var vm = NewVm(new ShortcutRegistry(), store: store);

        Assert.Equal(ShortcutFilterMode.Page, vm.Mode);
        Assert.Equal("page", vm.SelectedFilterValue);
    }

    [Fact]
    public void ViewModel_set_mode_persists_and_reprojects()
    {
        var store = new InMemoryShortcutFilterStore();
        var registry = new ShortcutRegistry();
        registry.Register(Global("g", "Global", "Toggle theme", "t"));
        registry.Register(Route("r", "Charging", "Start charge", "/charging", "c"));
        using var vm = NewVm(registry, route: new StaticRouteContext("/charging"), store: store);
        vm.Open();

        vm.SetMode(ShortcutFilterMode.Global);

        Assert.Equal(ShortcutFilterMode.Global, vm.Mode);
        Assert.Equal("global", vm.SelectedFilterValue);
        Assert.Equal(ShortcutFilterMode.Global, store.Read());
        Assert.Equal(new[] { "g" }, Ids(vm.Groups));
    }

    [Fact]
    public void ViewModel_reprojects_on_registry_change()
    {
        var registry = new ShortcutRegistry();
        registry.Register(Global("a", "Actions", "Open palette", "Ctrl", "K"));
        using var vm = NewVm(registry);
        vm.Open();
        Assert.Single(vm.Groups.SelectMany(g => g.Shortcuts));

        registry.Register(Global("b", "Navigation", "Go dashboard", "g", "d"));

        Assert.Equal(2, vm.Groups.SelectMany(g => g.Shortcuts).Count());
        Assert.Contains(vm.Groups.SelectMany(g => g.Shortcuts), s => s.Id == "b");
    }

    [Fact]
    public void ViewModel_reprojects_on_route_change()
    {
        var registry = new ShortcutRegistry();
        registry.Register(Global("g", "Global", "Toggle theme", "t"));
        registry.Register(Route("r", "Charging", "Start charge", "/charging", "c"));
        var route = new StaticRouteContext("/");
        using var vm = NewVm(registry, route: route);
        vm.Open();
        Assert.Equal(new[] { "g" }, Ids(vm.Groups));

        route.Navigate("/charging");

        Assert.Equal(new[] { "g", "r" }, Ids(vm.Groups).OrderBy(x => x).ToArray());
    }

    [Fact]
    public void ViewModel_close_resets_search()
    {
        var registry = new ShortcutRegistry();
        registry.Register(Global("a", "Actions", "Open palette", "Ctrl", "K"));
        using var vm = NewVm(registry);
        vm.Open();
        vm.Search = "open";
        Assert.Equal("open", vm.Search);

        vm.Close();

        Assert.Equal(string.Empty, vm.Search);
    }

    [Fact]
    public void ViewModel_filter_options_are_localized_with_tokens()
    {
        using var vm = NewVm(new ShortcutRegistry());
        IReadOnlyList<ComboOption> options = vm.FilterOptions;

        Assert.Equal(new[] { "all", "global", "page" }, options.Select(o => o.Value).ToArray());
        Assert.Equal(new[] { "All", "Global", "This page" }, options.Select(o => o.Label).ToArray());
    }

    [Fact]
    public void ViewModel_open_records_view_opened_diagnostic()
    {
        var sink = new List<string>();
        var diagnostics = new KeyboardShortcutsModalDiagnostics(sink.Add);
        using var vm = NewVm(new ShortcutRegistry(), diagnostics: diagnostics);

        vm.Open();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=KeyboardShortcutsModal", Assert.Single(sink));
    }

    [Fact]
    public void ViewModel_dispose_stops_reprojecting()
    {
        var registry = new ShortcutRegistry();
        registry.Register(Global("a", "Actions", "Open palette", "Ctrl", "K"));
        var vm = NewVm(registry);
        vm.Open();
        int before = vm.Groups.SelectMany(g => g.Shortcuts).Count();

        vm.Dispose();
        registry.Register(Global("b", "Navigation", "Go dashboard", "g", "d"));

        Assert.Equal(before, vm.Groups.SelectMany(g => g.Shortcuts).Count());
    }

    // ---- Registration + i18n keys -------------------------------------------------------

    [Fact]
    public void Registration_exposes_slug_and_localized_copy()
    {
        Assert.Equal("KeyboardShortcutsModal", KeyboardShortcutsModalRegistration.Slug);
        Assert.Equal("Keyboard Shortcuts", KeyboardShortcutsModalRegistration.Title(Localizer));
        Assert.Equal("All", KeyboardShortcutsModalRegistration.FilterAll(Localizer));
        Assert.Equal("Global", KeyboardShortcutsModalRegistration.FilterGlobal(Localizer));
        Assert.Equal("This page", KeyboardShortcutsModalRegistration.FilterPage(Localizer));
        Assert.Equal("Search shortcuts\u2026", KeyboardShortcutsModalRegistration.SearchPrompt(Localizer));
        Assert.Equal("No shortcuts match your search.", KeyboardShortcutsModalRegistration.Empty(Localizer));
    }

    [Fact]
    public void Registration_i18n_keys_match_web_source()
    {
        string[] keys =
        {
            KeyboardShortcutsModalRegistration.TitleKey,
            KeyboardShortcutsModalRegistration.FilterAllKey,
            KeyboardShortcutsModalRegistration.FilterGlobalKey,
            KeyboardShortcutsModalRegistration.FilterPageKey,
            KeyboardShortcutsModalRegistration.SearchKey,
            KeyboardShortcutsModalRegistration.EmptyKey,
        };

        Assert.Equal(new[]
        {
            "translation.shortcuts.title",
            "translation.shortcuts.filter.all",
            "translation.shortcuts.filter.global",
            "translation.shortcuts.filter.page",
            "translation.shortcuts.search",
            "translation.shortcuts.empty",
        }, keys);

        Assert.Equal(keys.Length, keys.Distinct().Count());
        Assert.All(keys, k => Assert.StartsWith("translation.shortcuts.", k));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new KeyboardShortcutsModalDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=KeyboardShortcutsModal", Assert.Single(sink));
    }

    // ---- helpers ------------------------------------------------------------------------

    private static KeyboardShortcutsModalViewModel NewVm(
        IShortcutRegistry registry,
        IRouteContext? route = null,
        IShortcutFilterStore? store = null,
        KeyboardShortcutsModalDiagnostics? diagnostics = null) =>
        new(registry, route ?? new StaticRouteContext("/"), Localizer, store, diagnostics);

    private static ShortcutDefinition Global(string id, string group, string description, params string[] keys) =>
        new() { Id = id, Keys = keys, Description = description, Group = group, Scope = ShortcutScope.Global };

    private static ShortcutDefinition Route(string id, string group, string description, string prefix, params string[] keys) =>
        new() { Id = id, Keys = keys, Description = description, Group = group, Scope = ShortcutScope.Route, RoutePrefix = prefix };

    private static ShortcutDefinition Page(string id, string group, string description, string prefix, params string[] keys) =>
        new() { Id = id, Keys = keys, Description = description, Group = group, Scope = ShortcutScope.Page, RoutePrefix = prefix };

    private static string[] Ids(IReadOnlyList<ShortcutGroup> groups) =>
        groups.SelectMany(g => g.Shortcuts).Select(s => s.Id).ToArray();
}
