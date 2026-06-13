using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.MiscSurfaces;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.MiscSurfaces;

/// <summary>
/// Headless verification of the <c>globalShortcuts</c> misc surface's UI-thread-free logic — the static
/// catalogue (the four universals, the <c>GOTO_SHORTCUTS</c> navigation table and the
/// <c>commandRegistry</c>-with-shortcut entries), the build into the shared <see cref="ShortcutDefinition"/>
/// records (all global scope, web order), the render-ready grouped projection (per state: the populated,
/// rank-ordered groups and the defensive empty surface), the view-model's seed/unseed lifecycle against the
/// shared <see cref="IShortcutRegistry"/>, the composed Narrator names, the i18n key flow and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/lib/globalShortcuts.tsx + web/src/hooks/useKeyboardShortcuts.ts +
/// web/src/lib/commandRegistry.ts). The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class GlobalShortcutsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static ShortcutDefinition Def(IReadOnlyList<ShortcutDefinition> defs, string id) =>
        defs.Single(d => d.Id == id);

    // ── Catalogue (adapter): counts + raw web data ───────────────────────────────────────────────────────

    [Fact]
    public void Catalog_counts_match_the_web_sources()
    {
        Assert.Equal(4, GlobalShortcutsCatalog.UniversalCount);
        Assert.Equal(14, GlobalShortcutsCatalog.NavigationCount);
        Assert.Equal(3, GlobalShortcutsCatalog.CommandCount);
        Assert.Equal(21, GlobalShortcutsCatalog.TotalCount);

        Assert.Equal(GlobalShortcutsCatalog.UniversalCount, GlobalShortcutsCatalog.Universals.Count);
        Assert.Equal(GlobalShortcutsCatalog.NavigationCount, GlobalShortcutsCatalog.Navigation.Count);
        Assert.Equal(GlobalShortcutsCatalog.CommandCount, GlobalShortcutsCatalog.Commands.Count);
    }

    [Fact]
    public void Catalog_navigation_mirrors_web_goto_shortcuts_keys_and_paths()
    {
        // web GOTO_SHORTCUTS declaration order: d v c r t b a e s n l o x i.
        string[] expectedKeys = ["d", "v", "c", "r", "t", "b", "a", "e", "s", "n", "l", "o", "x", "i"];
        Assert.Equal(expectedKeys, GlobalShortcutsCatalog.Navigation.Select(n => n.Key).ToArray());

        var pathByKey = GlobalShortcutsCatalog.Navigation.ToDictionary(n => n.Key, n => n.Path, StringComparer.Ordinal);
        Assert.Equal("/", pathByKey["d"]);
        Assert.Equal("/vehicles", pathByKey["v"]);
        Assert.Equal("/charging", pathByKey["c"]);
        Assert.Equal("/drives", pathByKey["r"]);
        Assert.Equal("/trips", pathByKey["t"]);
        Assert.Equal("/battery", pathByKey["b"]);
        Assert.Equal("/analytics", pathByKey["a"]);
        Assert.Equal("/efficiency", pathByKey["e"]);
        Assert.Equal("/settings", pathByKey["s"]);
        Assert.Equal("/notifications/inbox", pathByKey["n"]);
        Assert.Equal("/live-signals", pathByKey["l"]);
        Assert.Equal("/automations", pathByKey["o"]);
        Assert.Equal("/commands", pathByKey["x"]);
        Assert.Equal("/climate", pathByKey["i"]);
    }

    [Fact]
    public void Catalog_commands_are_the_three_registry_entries_with_a_shortcut()
    {
        Assert.Equal(
            new[] { "pref.themePicker", "action.shortcuts", "action.dashboard.edit" },
            GlobalShortcutsCatalog.Commands.Select(c => c.CommandId).ToArray());
        Assert.Equal(
            new[] { "T", "?", "E" },
            GlobalShortcutsCatalog.Commands.Select(c => c.Key).ToArray());
    }

    // ── Build: 21 global definitions, web order, correct keys/descriptions/groups ─────────────────────────

    [Fact]
    public void Build_emits_twentyone_definitions_in_web_order_all_global()
    {
        IReadOnlyList<ShortcutDefinition> defs = GlobalShortcutsCatalog.Build(Localizer);

        Assert.Equal(21, defs.Count);
        Assert.All(defs, d => Assert.Equal(ShortcutScope.Global, d.Scope));
        Assert.All(defs, d => Assert.False(d.HasRoute));

        // [...universals, ...navigation, ...palette]
        Assert.Equal("global.palette.ctrlk", defs[0].Id);
        Assert.Equal("global.shortcuts.escape", defs[3].Id);
        Assert.Equal("global.goto.d", defs[4].Id);
        Assert.Equal("global.goto.i", defs[17].Id);
        Assert.Equal("global.palette.cmd.pref.themePicker", defs[18].Id);
        Assert.Equal("global.palette.cmd.action.dashboard.edit", defs[20].Id);

        // Every id is unique.
        Assert.Equal(defs.Count, defs.Select(d => d.Id).Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void Build_universals_carry_web_keys_descriptions_and_actions_group()
    {
        IReadOnlyList<ShortcutDefinition> defs = GlobalShortcutsCatalog.Build(Localizer);

        ShortcutDefinition ctrlk = Def(defs, "global.palette.ctrlk");
        Assert.Equal(new[] { "Ctrl", "K" }, ctrlk.Keys);
        Assert.Equal("Open command palette", ctrlk.Description);
        Assert.Equal("Actions", ctrlk.Group);

        Assert.Equal(new[] { "/" }, Def(defs, "global.palette.slash").Keys);
        Assert.Equal("Open command palette", Def(defs, "global.palette.slash").Description);
        Assert.Equal(new[] { "?" }, Def(defs, "global.shortcuts.help").Keys);
        Assert.Equal("Show keyboard shortcuts", Def(defs, "global.shortcuts.help").Description);
        Assert.Equal(new[] { "Esc" }, Def(defs, "global.shortcuts.escape").Keys);
        Assert.Equal("Close modal / cancel", Def(defs, "global.shortcuts.escape").Description);
    }

    [Fact]
    public void Build_navigation_composes_go_to_label_with_chord_and_navigation_group()
    {
        IReadOnlyList<ShortcutDefinition> defs = GlobalShortcutsCatalog.Build(Localizer);

        ShortcutDefinition dashboard = Def(defs, "global.goto.d");
        Assert.Equal(new[] { "g", "d" }, dashboard.Keys);
        Assert.Equal("Go to Dashboard", dashboard.Description);
        Assert.Equal("Navigation (press g then\u2026)", dashboard.Group);

        Assert.Equal("Go to Battery & Energy", Def(defs, "global.goto.b").Description);
        Assert.Equal("Go to Live Signals", Def(defs, "global.goto.l").Description);
        Assert.Equal(new[] { "g", "x" }, Def(defs, "global.goto.x").Keys);
        Assert.Equal("Go to Commands", Def(defs, "global.goto.x").Description);
    }

    [Fact]
    public void Build_commands_carry_single_key_label_and_commands_group()
    {
        IReadOnlyList<ShortcutDefinition> defs = GlobalShortcutsCatalog.Build(Localizer);

        ShortcutDefinition theme = Def(defs, "global.palette.cmd.pref.themePicker");
        Assert.Equal(new[] { "T" }, theme.Keys);
        Assert.Equal("Open theme picker", theme.Description);
        Assert.Equal("Commands", theme.Group);

        Assert.Equal("Show keyboard shortcuts", Def(defs, "global.palette.cmd.action.shortcuts").Description);
        Assert.Equal(new[] { "E" }, Def(defs, "global.palette.cmd.action.dashboard.edit").Keys);
        Assert.Equal("Edit dashboard layout", Def(defs, "global.palette.cmd.action.dashboard.edit").Description);
    }

    // ── Projection: Ready state (grouped, rank-ordered like the cheatsheet) ────────────────────────────────

    [Fact]
    public void Project_ready_groups_in_navigation_actions_commands_rank_order()
    {
        GlobalShortcutsDisplay display = GlobalShortcutsProjection.Project(
            GlobalShortcutsCatalog.Build(Localizer), Localizer);

        Assert.Equal(GlobalShortcutsState.Ready, display.State);
        Assert.True(display.HasShortcuts);
        Assert.Equal(21, display.ShortcutCount);
        Assert.Equal("Keyboard Shortcuts", display.Title);

        // ShortcutProjection ranks navigation(100) > actions(90) > commands(80).
        Assert.Equal(
            new[] { "Navigation (press g then\u2026)", "Actions", "Commands" },
            display.Groups.Select(g => g.Title).ToArray());

        Assert.Equal(14, display.Groups[0].Shortcuts.Count);
        Assert.Equal(4, display.Groups[1].Shortcuts.Count);
        Assert.Equal(3, display.Groups[2].Shortcuts.Count);
    }

    [Fact]
    public void Project_orders_navigation_rows_by_id()
    {
        GlobalShortcutsDisplay display = GlobalShortcutsProjection.Project(
            GlobalShortcutsCatalog.Build(Localizer), Localizer);

        // Per-group id sort: global.goto.a, .b, .c, .d, .e, .i, .l, .n, .o, .r, .s, .t, .v, .x
        Assert.Equal(
            new[] { "a", "b", "c", "d", "e", "i", "l", "n", "o", "r", "s", "t", "v", "x" }
                .Select(k => $"global.goto.{k}").ToArray(),
            display.Groups[0].Shortcuts.Select(s => s.Id).ToArray());
    }

    // ── Projection: Empty state (defensive — no definitions, never a blank box) ────────────────────────────

    [Fact]
    public void Project_with_no_definitions_yields_a_friendly_empty_surface()
    {
        GlobalShortcutsDisplay display = GlobalShortcutsProjection.Project(
            Array.Empty<ShortcutDefinition>(), Localizer);

        Assert.Equal(GlobalShortcutsState.Empty, display.State);
        Assert.False(display.HasShortcuts);
        Assert.Empty(display.Groups);
        Assert.Equal(0, display.ShortcutCount);
        Assert.Equal("No data available", display.EmptyMessage);
        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    // ── Accessibility: composed Narrator names (description + keys) ─────────────────────────────────────────

    [Fact]
    public void Definitions_expose_accessible_row_names()
    {
        IReadOnlyList<ShortcutDefinition> defs = GlobalShortcutsCatalog.Build(Localizer);

        Assert.Equal("Open command palette: Ctrl + K", Def(defs, "global.palette.ctrlk").AccessibleName);
        Assert.Equal("Go to Dashboard: g + d", Def(defs, "global.goto.d").AccessibleName);
        Assert.Equal("Open theme picker: T", Def(defs, "global.palette.cmd.pref.themePicker").AccessibleName);
        Assert.All(defs, d => Assert.False(string.IsNullOrWhiteSpace(d.AccessibleName)));
    }

    [Fact]
    public void Project_ready_automation_name_is_the_title()
    {
        GlobalShortcutsDisplay display = GlobalShortcutsProjection.Project(
            GlobalShortcutsCatalog.Build(Localizer), Localizer);

        Assert.Equal("Keyboard Shortcuts", display.AutomationName);
    }

    // ── i18n: every visible string flows through a registration / catalogue key ───────────────────────────

    [Fact]
    public void Build_and_project_flow_copy_through_the_i18n_keys()
    {
        var localizer = new KeyCapturingLocalizer();

        GlobalShortcutsProjection.Project(GlobalShortcutsCatalog.Build(localizer), localizer);

        // Group + title + empty + template keys.
        Assert.Contains(GlobalShortcutsRegistration.ActionsGroupKey, localizer.RequestedKeys);
        Assert.Contains(GlobalShortcutsRegistration.NavigationGroupKey, localizer.RequestedKeys);
        Assert.Contains(GlobalShortcutsRegistration.CommandsGroupKey, localizer.RequestedKeys);
        Assert.Contains(GlobalShortcutsRegistration.GotoTemplateKey, localizer.RequestedKeys);
        Assert.Contains(GlobalShortcutsRegistration.TitleKey, localizer.RequestedKeys);
        Assert.Contains(GlobalShortcutsRegistration.EmptyKey, localizer.RequestedKeys);

        // Every universal / navigation / command label key.
        foreach (GlobalActionShortcut a in GlobalShortcutsCatalog.Universals)
        {
            Assert.Contains(a.DescriptionKey, localizer.RequestedKeys);
        }

        foreach (GlobalNavigationShortcut n in GlobalShortcutsCatalog.Navigation)
        {
            Assert.Contains(n.LabelKey, localizer.RequestedKeys);
        }

        foreach (GlobalCommandShortcut c in GlobalShortcutsCatalog.Commands)
        {
            Assert.Contains(c.LabelKey, localizer.RequestedKeys);
        }
    }

    [Fact]
    public void Registration_keys_are_translation_namespaced_and_distinct()
    {
        string[] keys =
        [
            GlobalShortcutsRegistration.ActionsGroupKey,
            GlobalShortcutsRegistration.NavigationGroupKey,
            GlobalShortcutsRegistration.CommandsGroupKey,
            GlobalShortcutsRegistration.GotoTemplateKey,
            GlobalShortcutsRegistration.TitleKey,
            GlobalShortcutsRegistration.EmptyKey,
        ];

        Assert.All(keys, k => Assert.StartsWith("translation.", k, StringComparison.Ordinal));
        Assert.Equal(keys.Length, keys.Distinct(StringComparer.Ordinal).Count());
    }

    // ── ViewModel: seed / unseed lifecycle against the shared registry ────────────────────────────────────

    [Fact]
    public void ViewModel_builds_defs_but_does_not_register_until_activated()
    {
        var registry = new ShortcutRegistry();
        using var vm = new GlobalShortcutsViewModel(Localizer, registry);

        Assert.False(vm.IsActive);
        Assert.Equal(21, vm.Definitions.Count);
        Assert.Empty(registry.Snapshot);
        Assert.Equal(GlobalShortcutsState.Ready, vm.Display.State);
    }

    [Fact]
    public void Activate_registers_every_definition_and_records_the_view()
    {
        var registry = new ShortcutRegistry();
        var captured = new List<string>();
        using var vm = NewViewModel(registry, captured);

        vm.Activate();

        Assert.True(vm.IsActive);
        Assert.Equal(21, registry.Snapshot.Count);
        Assert.Equal(
            GlobalShortcutsCatalog.Build(Localizer).Select(d => d.Id).OrderBy(x => x, StringComparer.Ordinal),
            registry.Snapshot.Select(d => d.Id).OrderBy(x => x, StringComparer.Ordinal));
        Assert.Equal("view.opened slug=globalShortcuts", Assert.Single(captured));
    }

    [Fact]
    public void Activate_is_idempotent()
    {
        var registry = new ShortcutRegistry();
        var captured = new List<string>();
        using var vm = NewViewModel(registry, captured);

        vm.Activate();
        vm.Activate();

        Assert.Equal(21, registry.Snapshot.Count);
        Assert.Single(captured); // no duplicate view.opened
    }

    [Fact]
    public void Deactivate_unregisters_every_definition()
    {
        var registry = new ShortcutRegistry();
        using var vm = NewViewModel(registry);
        vm.Activate();
        Assert.Equal(21, registry.Snapshot.Count);

        vm.Deactivate();

        Assert.False(vm.IsActive);
        Assert.Empty(registry.Snapshot);
    }

    [Fact]
    public void Deactivate_leaves_other_registrants_untouched()
    {
        var registry = new ShortcutRegistry();
        registry.Register(new ShortcutDefinition
        {
            Id = "page.local",
            Keys = new[] { "x" },
            Description = "Local",
            Group = "Page",
            Scope = ShortcutScope.Page,
            RoutePrefix = "/x",
        });
        using var vm = NewViewModel(registry);

        vm.Activate();
        Assert.Equal(22, registry.Snapshot.Count);

        vm.Deactivate();

        Assert.Equal(new[] { "page.local" }, registry.Snapshot.Select(d => d.Id).ToArray());
    }

    [Fact]
    public void Dispose_unregisters_and_stops_responding()
    {
        var registry = new ShortcutRegistry();
        var vm = NewViewModel(registry);
        vm.Activate();
        Assert.Equal(21, registry.Snapshot.Count);

        vm.Dispose();

        Assert.False(vm.IsActive);
        Assert.Empty(registry.Snapshot);
    }

    [Fact]
    public void Reload_reprojects_and_refreshes_registry_without_reopening()
    {
        var registry = new ShortcutRegistry();
        var captured = new List<string>();
        var localizer = new MutableLocalizer();
        using var vm = new GlobalShortcutsViewModel(localizer, registry, new GlobalShortcutsDiagnostics(captured.Add));
        vm.Activate();
        Assert.Equal("Keyboard Shortcuts", vm.Display.Title);
        Assert.Single(captured);

        localizer.Suffix = " (es)";
        vm.Reload();

        // Re-projected copy reflects the new language.
        Assert.Equal("Keyboard Shortcuts (es)", vm.Display.Title);
        // Registry entries refreshed in place (last-writer-wins by id) — still 21, new descriptions.
        Assert.Equal(21, registry.Snapshot.Count);
        Assert.Contains(registry.Snapshot, d => d.Description.EndsWith(" (es)", StringComparison.Ordinal));
        // A language change is not a re-open.
        Assert.Single(captured);
    }

    // ── Diagnostics (P1/S11): slug-only counter, never a shortcut id ──────────────────────────────────────

    [Fact]
    public void Diagnostics_count_and_emit_view_opened_with_slug()
    {
        var captured = new List<string>();
        var diagnostics = new GlobalShortcutsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.All(captured, line => Assert.Equal("view.opened slug=globalShortcuts", line));
    }

    [Fact]
    public void Activate_diagnostic_never_leaks_a_shortcut_id_or_key()
    {
        var captured = new List<string>();
        using var vm = NewViewModel(new ShortcutRegistry(), captured);

        vm.Activate();

        string line = Assert.Single(captured);
        Assert.DoesNotContain("global.goto", line, StringComparison.Ordinal);
        Assert.DoesNotContain("Ctrl", line, StringComparison.Ordinal);
    }

    // ── Registration metadata is stable ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable() => Assert.Equal("globalShortcuts", GlobalShortcutsRegistration.Slug);

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Build_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => GlobalShortcutsCatalog.Build(null!));

    [Fact]
    public void Project_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() => GlobalShortcutsProjection.Project(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() =>
            GlobalShortcutsProjection.Project(Array.Empty<ShortcutDefinition>(), null!));
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() => new GlobalShortcutsViewModel(null!, new ShortcutRegistry()));
        Assert.Throws<ArgumentNullException>(() => new GlobalShortcutsViewModel(Localizer, null!));
    }

    // ── Helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private static GlobalShortcutsViewModel NewViewModel(IShortcutRegistry registry, List<string>? sink = null) =>
        new(Localizer, registry, sink is null ? null : new GlobalShortcutsDiagnostics(sink.Add));

    private sealed class KeyCapturingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = [];

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private sealed class MutableLocalizer : ILocalizer
    {
        public string Suffix { get; set; } = string.Empty;

        public string GetString(string key, string fallback) =>
            string.Create(CultureInfo.InvariantCulture, $"{fallback}{Suffix}");
    }
}
