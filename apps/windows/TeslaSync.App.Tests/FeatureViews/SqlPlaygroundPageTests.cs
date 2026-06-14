using System.Linq;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.PowerUser;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SqlPlaygroundPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/power-user/pages/SqlPlaygroundPage.tsx), the curated schema catalog, the lone <c>success</c>
/// data state, the manual SQL editor's run/clear flow and <c>canRun</c> gate (GlassPanel1), the curated-catalog
/// viewer (GlassPanel2), the draft persistence seam and the view-model's observable flow. The WinUI view is
/// exercised by the app build; its per-region content is driven entirely by the <see cref="SqlPlaygroundDisplay"/>
/// projection asserted here.
/// </summary>
public sealed class SqlPlaygroundPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The eleven manifest string keys the page resolves (PARITY: string).
    private static readonly string[] ManifestStringKeys =
    [
        "powerSql.title",
        "powerSql.intro",
        "powerSql.editor.title",
        "powerSql.editor.placeholder", // parity:allow i18n key name ported verbatim from web
        "powerSql.editor.label",
        "powerSql.editor.run",
        "powerSql.editor.clear",
        "powerSql.editor.runEmpty",
        "powerSql.editor.runUnavailable",
        "powerSql.catalog.title",
        "powerSql.catalog.intro",
    ];

    private static SqlPlaygroundModel Model(
        string sql = "",
        SqlRunMessageKind runMessage = SqlRunMessageKind.None) =>
        new(sql, runMessage);

    // ---- i18n key coverage (PARITY: string) ----------------------------------------

    [Fact]
    public void Projection_resolves_every_manifest_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = SqlPlaygroundProjection.Project(Model(), recorder);

        foreach (var key in ManifestStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Manifest_strings_resolve_the_web_defaults()
    {
        var display = SqlPlaygroundProjection.Project(Model(), Localizer);

        Assert.Equal("SQL Playground", display.Title);
        Assert.Equal(
            "Write read-only SELECT or WITH queries against the curated schema catalog below. Queries do NOT execute from the browser; copy your query into your preferred database client.",
            display.Intro);
        Assert.Equal("Manual SQL editor", display.EditorTitle);
        Assert.Equal(
            "SELECT COUNT(*) FROM drives WHERE started_at >= NOW() - INTERVAL '7 days'",
            display.EditorHint);
        Assert.Equal("SQL query editor", display.EditorLabel);
        Assert.Equal("Run", display.RunLabel);
        Assert.Equal("Clear", display.ClearLabel);
        Assert.Equal("Curated schema catalog", display.CatalogTitle);
        Assert.Equal(
            "These tables are the only tables the curated catalog exposes. The Helix natural-language drafter refuses any query referencing tables outside this list.",
            display.CatalogIntro);
    }

    // ---- data state (PARITY: state success) ----------------------------------------

    [Fact]
    public void Projection_is_always_success_state()
    {
        Assert.Equal(SqlPlaygroundState.Success, SqlPlaygroundProjection.Project(Model(), Localizer).State);
        Assert.Equal(SqlPlaygroundState.Success, SqlPlaygroundProjection.Project(Model("SELECT 1"), Localizer).State);
    }

    // ---- editor panel (PARITY: GlassPanel1) ----------------------------------------

    [Fact]
    public void CanRun_is_false_for_empty_and_whitespace_sql()
    {
        Assert.False(SqlPlaygroundProjection.Project(Model(""), Localizer).CanRun);
        Assert.False(SqlPlaygroundProjection.Project(Model("   \n\t "), Localizer).CanRun);
    }

    [Fact]
    public void CanRun_is_true_for_non_empty_sql()
    {
        Assert.True(SqlPlaygroundProjection.Project(Model("SELECT 1"), Localizer).CanRun);
    }

    [Fact]
    public void Run_message_is_empty_when_no_run_yet()
    {
        Assert.Equal(string.Empty, SqlPlaygroundProjection.Project(Model("SELECT 1"), Localizer).RunMessage);
    }

    [Fact]
    public void Run_empty_kind_resolves_the_empty_notice()
    {
        var display = SqlPlaygroundProjection.Project(Model("", SqlRunMessageKind.Empty), Localizer);
        Assert.Equal("Type or paste a SELECT/WITH query above before running.", display.RunMessage);
    }

    [Fact]
    public void Run_unavailable_kind_resolves_the_unavailable_notice()
    {
        var display = SqlPlaygroundProjection.Project(Model("SELECT 1", SqlRunMessageKind.Unavailable), Localizer);
        Assert.StartsWith("Read-only execution from the browser is not enabled in this build.", display.RunMessage);
        Assert.Contains("psql, DBeaver, TablePlus", display.RunMessage);
    }

    // ---- catalog panel (PARITY: GlassPanel2) ---------------------------------------

    [Fact]
    public void Catalog_exposes_the_five_curated_tables_sorted_by_name()
    {
        var display = SqlPlaygroundProjection.Project(Model(), Localizer);
        var names = display.Tables.Select(t => t.Name).ToArray();

        Assert.Equal(
            new[] { "alerts", "charging_sessions", "drives", "signal_log_view", "vehicles" },
            names);
    }

    [Fact]
    public void Catalog_table_names_are_unique()
    {
        var names = SqlCatalog.Default.Select(t => t.Name).ToList();
        Assert.Equal(names.Count, names.Distinct().Count());
    }

    [Fact]
    public void Drives_table_carries_the_si_canonical_columns()
    {
        var drives = SqlCatalog.Default.Single(t => t.Name == "drives");
        var columns = drives.Columns.Select(c => c.Name).ToArray();

        Assert.Contains("distance_m", columns);
        Assert.Contains("duration_s", columns);
        Assert.Contains("energy_used_wh", columns);
        Assert.Contains("avg_speed_mps", columns);
        Assert.Contains("max_speed_mps", columns);
    }

    [Fact]
    public void Catalog_never_exposes_a_legacy_unit_suffixed_column()
    {
        var legacySuffixes = new[] { "_mi", "_min", "_mph", "_kwh", "_kw", "_psi" };
        var columns = SqlCatalog.Default.SelectMany(t => t.Columns).Select(c => c.Name);

        Assert.All(
            columns,
            name => Assert.DoesNotContain(
                legacySuffixes,
                suffix => name.EndsWith(suffix, StringComparison.Ordinal)));
    }

    [Fact]
    public void Catalog_columns_all_carry_a_type_and_description()
    {
        Assert.All(
            SqlCatalog.Default.SelectMany(t => t.Columns),
            column =>
            {
                Assert.False(string.IsNullOrWhiteSpace(column.Name));
                Assert.False(string.IsNullOrWhiteSpace(column.Type));
                Assert.False(string.IsNullOrWhiteSpace(column.Description));
            });
    }

    // ---- view-model flow -----------------------------------------------------------

    [Fact]
    public void ViewModel_starts_empty_with_success_state()
    {
        var vm = new SqlPlaygroundPageViewModel(Localizer, new InMemorySqlPlaygroundDraftStore());

        Assert.Equal(string.Empty, vm.Sql);
        Assert.False(vm.CanRun);
        Assert.Equal(SqlPlaygroundState.Success, vm.State);
        Assert.Equal("SQL Playground", vm.Title);
    }

    [Fact]
    public void ViewModel_set_sql_updates_and_persists_the_draft()
    {
        var store = new InMemorySqlPlaygroundDraftStore();
        var vm = new SqlPlaygroundPageViewModel(Localizer, store);

        vm.SetSql("SELECT * FROM drives");

        Assert.Equal("SELECT * FROM drives", vm.Sql);
        Assert.True(vm.CanRun);
        Assert.Equal("SELECT * FROM drives", store.Load());
    }

    [Fact]
    public void ViewModel_loads_the_persisted_draft_on_construction()
    {
        var store = new InMemorySqlPlaygroundDraftStore();
        store.Save("SELECT 42");

        var vm = new SqlPlaygroundPageViewModel(Localizer, store);

        Assert.Equal("SELECT 42", vm.Sql);
        Assert.True(vm.CanRun);
    }

    [Fact]
    public void ViewModel_run_with_empty_sql_surfaces_the_empty_notice()
    {
        var vm = new SqlPlaygroundPageViewModel(Localizer, new InMemorySqlPlaygroundDraftStore());

        vm.Run();

        Assert.Equal(SqlRunMessageKind.Empty, vm.RunMessage);
        Assert.Equal(
            "Type or paste a SELECT/WITH query above before running.",
            vm.Display.RunMessage);
    }

    [Fact]
    public void ViewModel_run_with_sql_surfaces_the_unavailable_notice()
    {
        var vm = new SqlPlaygroundPageViewModel(Localizer, new InMemorySqlPlaygroundDraftStore());
        vm.SetSql("SELECT 1");

        vm.Run();

        Assert.Equal(SqlRunMessageKind.Unavailable, vm.RunMessage);
        Assert.StartsWith(
            "Read-only execution from the browser is not enabled in this build.",
            vm.Display.RunMessage);
    }

    [Fact]
    public void ViewModel_clear_resets_sql_and_run_message_and_draft()
    {
        var store = new InMemorySqlPlaygroundDraftStore();
        var vm = new SqlPlaygroundPageViewModel(Localizer, store);
        vm.SetSql("SELECT 1");
        vm.Run();

        vm.Clear();

        Assert.Equal(string.Empty, vm.Sql);
        Assert.Equal(SqlRunMessageKind.None, vm.RunMessage);
        Assert.Equal(string.Empty, vm.Display.RunMessage);
        Assert.False(vm.CanRun);
        Assert.Equal(string.Empty, store.Load());
    }

    [Fact]
    public void ViewModel_typing_does_not_clear_an_existing_run_message()
    {
        // web: onChange only calls setSql; runMessage is cleared by Clear / AI apply, not by typing.
        var vm = new SqlPlaygroundPageViewModel(Localizer, new InMemorySqlPlaygroundDraftStore());
        vm.Run(); // empty -> Empty notice

        vm.SetSql("SELECT 1");

        Assert.Equal(SqlRunMessageKind.Empty, vm.RunMessage);
    }

    [Fact]
    public void ViewModel_raises_property_changed_on_set_sql()
    {
        var vm = new SqlPlaygroundPageViewModel(Localizer, new InMemorySqlPlaygroundDraftStore());
        var raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        vm.SetSql("SELECT 1");

        Assert.True(raised);
    }

    [Fact]
    public void ViewModel_notify_opened_records_through_diagnostics()
    {
        string? captured = null;
        var diagnostics = new SqlPlaygroundDiagnostics(line => captured = line);
        var vm = new SqlPlaygroundPageViewModel(Localizer, new InMemorySqlPlaygroundDraftStore(), diagnostics);

        vm.NotifyOpened();

        Assert.Equal("view.opened slug=SqlPlaygroundPage", captured);
    }

    // ---- registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_route_slug_and_title()
    {
        Assert.Equal("PowerSqlPlayground", SqlPlaygroundRegistration.RouteName);
        Assert.Equal("SqlPlaygroundPage", SqlPlaygroundRegistration.Slug);
        Assert.Equal("SQL Playground", SqlPlaygroundRegistration.Title(Localizer));
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        string? captured = null;
        var diagnostics = new SqlPlaygroundDiagnostics(line => captured = line);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SqlPlaygroundPage", captured);
    }

    // ---- test doubles --------------------------------------------------------------

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
