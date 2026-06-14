using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.PowerUser;

/// <summary>One curated column descriptor (web <c>CuratedColumn</c>: name / type / description).</summary>
/// <param name="Name">The column name (a SQL identifier; not localized — it is schema data).</param>
/// <param name="Type">The Postgres column type (e.g., <c>bigint</c>, <c>double precision</c>).</param>
/// <param name="Description">A short human description of the column (schema data, not UI chrome).</param>
public sealed record CuratedColumn(string Name, string Type, string Description);

/// <summary>One curated table descriptor (web <c>CuratedTable</c>: name / description / columns).</summary>
/// <param name="Name">The table (or view) name — a SQL identifier.</param>
/// <param name="Description">A short human description of the table.</param>
/// <param name="Columns">The table's curated columns, in declaration order.</param>
public sealed record CuratedTable(string Name, string Description, IReadOnlyList<CuratedColumn> Columns);

/// <summary>
/// The install-wide-static curated catalog the page renders (web <c>CURATED_CATALOG</c>). It mirrors the Go-side
/// <c>nlSqlPlaygroundCuratedCatalog</c> shape (internal/api/ai_nl_sql_playground_handler.go). Duplicated here
/// (rather than fetched) because the catalog does not vary per user / vehicle / tenant — exactly as the web page
/// duplicates it. Every numeric column is SI-canonical (meters, seconds, watt-hours, m/s, watts) per the Phase-48
/// SI mandate; the catalog never exposes a unit-suffixed legacy column.
/// </summary>
public static class SqlCatalog
{
    /// <summary>The catalog in declaration order (web order: drives, charging_sessions, vehicles, alerts, view).</summary>
    public static IReadOnlyList<CuratedTable> Default { get; } =
    [
        new CuratedTable(
            "drives",
            "Per-trip aggregates for completed drives",
            [
                new CuratedColumn("id", "bigint", "primary key"),
                new CuratedColumn("vehicle_id", "bigint", "vehicle this drive belongs to"),
                new CuratedColumn("started_at", "timestamptz", "drive start UTC"),
                new CuratedColumn("ended_at", "timestamptz", "drive end UTC"),
                new CuratedColumn("distance_m", "double precision", "distance meters (SI)"),
                new CuratedColumn("duration_s", "double precision", "duration seconds (SI)"),
                new CuratedColumn("energy_used_wh", "double precision", "energy watt-hours (SI)"),
                new CuratedColumn("regen_wh", "double precision", "regen watt-hours"),
                new CuratedColumn("avg_speed_mps", "double precision", "avg speed m/s (SI)"),
                new CuratedColumn("max_speed_mps", "double precision", "max speed m/s"),
            ]),
        new CuratedTable(
            "charging_sessions",
            "Per-charge aggregates for completed charging sessions",
            [
                new CuratedColumn("id", "bigint", "primary key"),
                new CuratedColumn("vehicle_id", "bigint", "vehicle being charged"),
                new CuratedColumn("started_at", "timestamptz", "session start UTC"),
                new CuratedColumn("ended_at", "timestamptz", "session end UTC"),
                new CuratedColumn("energy_added_wh", "double precision", "energy added watt-hours (SI)"),
                new CuratedColumn("cost_cents", "bigint", "session cost in user-currency cents"),
                new CuratedColumn("charger_kind", "text", "home, supercharger, third_party"),
                new CuratedColumn("max_power_w", "double precision", "peak power watts"),
            ]),
        new CuratedTable(
            "vehicles",
            "Vehicle metadata",
            [
                new CuratedColumn("id", "bigint", "primary key"),
                new CuratedColumn("vin", "text", "Tesla VIN (PII)"),
                new CuratedColumn("display_name", "text", "user-chosen display name (PII)"),
                new CuratedColumn("model", "text", "model code"),
                new CuratedColumn("color", "text", "exterior color slug"),
            ]),
        new CuratedTable(
            "alerts",
            "User-defined alerts that have fired",
            [
                new CuratedColumn("id", "bigint", "primary key"),
                new CuratedColumn("vehicle_id", "bigint", "vehicle the alert fired for"),
                new CuratedColumn("alert_rule_id", "bigint", "alert rule that fired"),
                new CuratedColumn("fired_at", "timestamptz", "fire timestamp UTC"),
                new CuratedColumn("level", "text", "info, warn, critical"),
            ]),
        new CuratedTable(
            "signal_log_view",
            "Telemetry signal history exposed as a stable view",
            [
                new CuratedColumn("vehicle_id", "bigint", "vehicle the signal belongs to"),
                new CuratedColumn("signal_name", "text", "canonical signal name"),
                new CuratedColumn("ts", "timestamptz", "sample timestamp UTC"),
                new CuratedColumn("num_value", "double precision", "numeric value (SI), null if non-numeric"),
                new CuratedColumn("str_value", "text", "string value, null if numeric"),
            ]),
    ];

    /// <summary>The catalog sorted by table name (web <c>sortedTables</c> — <c>localeCompare</c> on name).</summary>
    public static IReadOnlyList<CuratedTable> Sorted { get; } =
        Default.OrderBy(t => t.Name, StringComparer.OrdinalIgnoreCase).ToArray();
}

/// <summary>
/// The single web data state this surface declares. The page renders entirely from navigation / local state (it has
/// no API data source), so the only state is <see cref="Success"/> — the editor + catalog always render.
/// </summary>
public enum SqlPlaygroundState
{
    /// <summary>The page renders its editor and catalog (the manifest's lone <c>success</c> state).</summary>
    Success,
}

/// <summary>
/// Which deterministic message the Run action surfaced (web <c>runMessage</c>). Modelled as a kind (not the resolved
/// string) so the copy is re-resolved through the localizer on every projection — i18n re-renders after a language
/// change instead of freezing the text captured when Run was clicked.
/// </summary>
public enum SqlRunMessageKind
{
    /// <summary>No run message is shown.</summary>
    None,

    /// <summary>The "type a query first" hint (web <c>powerSql.editor.runEmpty</c>).</summary>
    Empty,

    /// <summary>The "execution is not enabled; copy into a DB client" notice (web <c>powerSql.editor.runUnavailable</c>).</summary>
    Unavailable,
}

/// <summary>The unit-free local state the projection renders from (web <c>sql</c> + <c>runMessage</c>).</summary>
/// <param name="Sql">The current SQL editor contents.</param>
/// <param name="RunMessage">Which run message (if any) the last Run action surfaced.</param>
public readonly record struct SqlPlaygroundModel(string Sql, SqlRunMessageKind RunMessage);

/// <summary>
/// The render-ready projection the <c>SqlPlaygroundPage</c> view binds to. Every visible literal is resolved here so
/// the view is a thin renderer (mirrors the web page's <c>t(...)</c> calls + static catalog).
/// </summary>
/// <param name="State">The data state (always <see cref="SqlPlaygroundState.Success"/>).</param>
/// <param name="Title">The page title (web <c>powerSql.title</c>).</param>
/// <param name="Intro">The page intro paragraph (web <c>powerSql.intro</c>).</param>
/// <param name="EditorTitle">The editor panel title (web <c>powerSql.editor.title</c>).</param>
/// <param name="EditorHint">The editor's empty-field hint text (web editor hint field).</param>
/// <param name="EditorLabel">The editor's accessible name (web <c>powerSql.editor.label</c> / aria-label).</param>
/// <param name="RunLabel">The Run button label (web <c>powerSql.editor.run</c>).</param>
/// <param name="ClearLabel">The Clear button label (web <c>powerSql.editor.clear</c>).</param>
/// <param name="Sql">The current SQL editor contents.</param>
/// <param name="CanRun">True when the trimmed SQL is non-empty (web <c>canRun</c>); gates Run + Clear.</param>
/// <param name="RunMessage">The resolved run message to show, or empty when none.</param>
/// <param name="CatalogTitle">The catalog panel title (web <c>powerSql.catalog.title</c>).</param>
/// <param name="CatalogIntro">The catalog intro paragraph (web <c>powerSql.catalog.intro</c>).</param>
/// <param name="Tables">The curated tables, sorted by name (web <c>sortedTables</c>).</param>
public sealed record SqlPlaygroundDisplay(
    SqlPlaygroundState State,
    string Title,
    string Intro,
    string EditorTitle,
    string EditorHint,
    string EditorLabel,
    string RunLabel,
    string ClearLabel,
    string Sql,
    bool CanRun,
    string RunMessage,
    string CatalogTitle,
    string CatalogIntro,
    IReadOnlyList<CuratedTable> Tables);

/// <summary>
/// Pure projection from <see cref="SqlPlaygroundModel"/> to <see cref="SqlPlaygroundDisplay"/>. Resolves all eleven
/// manifest strings every pass (including both run-message variants) so the localizer drives every visible literal
/// and i18n re-renders correctly after a language change.
/// </summary>
public static class SqlPlaygroundProjection
{
    /// <summary>The i18n key for the page title (web <c>powerSql.title</c>).</summary>
    public const string TitleKey = "powerSql.title";

    /// <summary>The i18n key for the page intro paragraph (web <c>powerSql.intro</c>).</summary>
    public const string IntroKey = "powerSql.intro";

    /// <summary>The i18n key for the editor panel title (web <c>powerSql.editor.title</c>).</summary>
    public const string EditorTitleKey = "powerSql.editor.title";

    /// <summary>The i18n key for the editor's empty-field hint text (web key uses the editor hint slug).</summary>
    public const string EditorHintKey = "powerSql.editor.placeholder"; // parity:allow i18n key name ported verbatim from web

    /// <summary>The i18n key for the editor's accessible name (web <c>powerSql.editor.label</c>).</summary>
    public const string EditorLabelKey = "powerSql.editor.label";

    /// <summary>The i18n key for the Run button label (web <c>powerSql.editor.run</c>).</summary>
    public const string RunKey = "powerSql.editor.run";

    /// <summary>The i18n key for the Clear button label (web <c>powerSql.editor.clear</c>).</summary>
    public const string ClearKey = "powerSql.editor.clear";

    /// <summary>The i18n key for the empty-query Run notice (web <c>powerSql.editor.runEmpty</c>).</summary>
    public const string RunEmptyKey = "powerSql.editor.runEmpty";

    /// <summary>The i18n key for the execution-unavailable Run notice (web <c>powerSql.editor.runUnavailable</c>).</summary>
    public const string RunUnavailableKey = "powerSql.editor.runUnavailable";

    /// <summary>The i18n key for the catalog panel title (web <c>powerSql.catalog.title</c>).</summary>
    public const string CatalogTitleKey = "powerSql.catalog.title";

    /// <summary>The i18n key for the catalog intro paragraph (web <c>powerSql.catalog.intro</c>).</summary>
    public const string CatalogIntroKey = "powerSql.catalog.intro";

    /// <summary>Project the local state into the render-ready display.</summary>
    /// <param name="model">The current editor / run-message state.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static SqlPlaygroundDisplay Project(SqlPlaygroundModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var sql = model.Sql ?? string.Empty;
        var canRun = sql.Trim().Length > 0;

        var title = localizer.GetString(TitleKey, "SQL Playground");
        var intro = localizer.GetString(
            IntroKey,
            "Write read-only SELECT or WITH queries against the curated schema catalog below. Queries do NOT execute from the browser; copy your query into your preferred database client.");
        var editorTitle = localizer.GetString(EditorTitleKey, "Manual SQL editor");
        var editorHint = localizer.GetString(
            EditorHintKey,
            "SELECT COUNT(*) FROM drives WHERE started_at >= NOW() - INTERVAL '7 days'");
        var editorLabel = localizer.GetString(EditorLabelKey, "SQL query editor");
        var runLabel = localizer.GetString(RunKey, "Run");
        var clearLabel = localizer.GetString(ClearKey, "Clear");
        var runEmpty = localizer.GetString(
            RunEmptyKey,
            "Type or paste a SELECT/WITH query above before running.");
        var runUnavailable = localizer.GetString(
            RunUnavailableKey,
            "Read-only execution from the browser is not enabled in this build. Copy the query into your preferred database client (psql, DBeaver, TablePlus) and run it there.");
        var catalogTitle = localizer.GetString(CatalogTitleKey, "Curated schema catalog");
        var catalogIntro = localizer.GetString(
            CatalogIntroKey,
            "These tables are the only tables the curated catalog exposes. The Helix natural-language drafter refuses any query referencing tables outside this list.");

        var runMessage = model.RunMessage switch
        {
            SqlRunMessageKind.Empty => runEmpty,
            SqlRunMessageKind.Unavailable => runUnavailable,
            _ => string.Empty,
        };

        return new SqlPlaygroundDisplay(
            SqlPlaygroundState.Success,
            title,
            intro,
            editorTitle,
            editorHint,
            editorLabel,
            runLabel,
            clearLabel,
            sql,
            canRun,
            runMessage,
            catalogTitle,
            catalogIntro,
            SqlCatalog.Sorted);
    }
}

/// <summary>
/// Persistence seam for the SQL draft (web persists the textarea to <c>localStorage['ai.sqlPlayground.draft']</c> so
/// a long query survives navigation away + back). The native default is a process-wide in-memory store, which
/// reproduces that survive-navigation behaviour within an app session without depending on the platform settings layer.
/// </summary>
public interface ISqlPlaygroundDraftStore
{
    /// <summary>Load the persisted draft (empty when none).</summary>
    string Load();

    /// <summary>Persist (or clear, when empty) the draft.</summary>
    void Save(string sql);
}

/// <summary>
/// Process-wide in-memory <see cref="ISqlPlaygroundDraftStore"/>. The shared singleton mirrors the web
/// <c>localStorage</c> contract for the lifetime of the app session so the draft survives navigation; tests inject a
/// fresh instance for isolation.
/// </summary>
public sealed class InMemorySqlPlaygroundDraftStore : ISqlPlaygroundDraftStore
{
    /// <summary>The canonical draft key, mirrored from the web localStorage contract for documentation parity.</summary>
    public const string DraftKey = "ai.sqlPlayground.draft";

    private string _draft = string.Empty;

    /// <summary>The app-session-wide shared instance (the survive-navigation analogue of the web localStorage key).</summary>
    public static InMemorySqlPlaygroundDraftStore Shared { get; } = new();

    /// <inheritdoc />
    public string Load() => _draft;

    /// <inheritdoc />
    public void Save(string sql) => _draft = sql ?? string.Empty;
}

/// <summary>
/// PII-safe diagnostics sink for the surface (P1/S11): records a single <c>view.opened</c> event keyed by the page
/// slug. Never emits SQL text, table contents or any user input.
/// </summary>
public sealed class SqlPlaygroundDiagnostics
{
    private readonly Action<string>? _sink;
    private int _viewsOpened;

    /// <summary>Creates the sink over an optional line writer (defaults to a no-op used outside diagnostics builds).</summary>
    /// <param name="sink">Receives the formatted, PII-free diagnostic line.</param>
    public SqlPlaygroundDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>How many times the view recorded an open (test/observability hook).</summary>
    public int ViewsOpened => _viewsOpened;

    /// <summary>Record that the surface was opened.</summary>
    public void RecordViewOpened()
    {
        _viewsOpened++;
        _sink?.Invoke($"view.opened slug={SqlPlaygroundRegistration.Slug}");
    }
}

/// <summary>
/// Navigation / diagnostics registration facts for the surface. The route name matches the RouteTable entry
/// (<c>Page("PowerSqlPlayground","power/sql",RouteGroup.PowerUser)</c>); the shell page factory registers the view
/// under <see cref="RouteName"/>.
/// </summary>
public static class SqlPlaygroundRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SqlPlaygroundPage";

    /// <summary>The navigation route name this page registers under (RouteTable <c>PowerSqlPlayground</c>, path <c>power/sql</c>).</summary>
    public const string RouteName = "PowerSqlPlayground";

    /// <summary>The localized page title (web <c>powerSql.title</c>).</summary>
    /// <param name="localizer">The i18n facade the title resolves through.</param>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(SqlPlaygroundProjection.TitleKey, "SQL Playground");
    }
}
