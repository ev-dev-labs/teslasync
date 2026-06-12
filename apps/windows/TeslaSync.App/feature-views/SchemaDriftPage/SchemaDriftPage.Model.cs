using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>SchemaDriftPage</c> surface — the native mirror of the four data
/// states the web page renders (web/src/features/admin/pages/SchemaDriftPage.tsx). The web page runs the
/// <c>useSchemaDrift</c> query and renders, in precedence order, the spinner (web <c>query.isLoading</c>), the
/// subsystem-unavailable banner (web <c>subsystemMissing</c>, the HTTP 503 case) or the generic failure surface, the
/// drift summary + fingerprint details (web <c>query.data</c>) and otherwise the "no fingerprint" empty state. This
/// enum is the top-level summary the ledger/Narrator key off; per-region visibility is still driven by the projected
/// flags so each branch renders exactly as the web composes them.
/// </summary>
public enum SchemaDriftState
{
    /// <summary>The drift query is in flight (web <c>query.isLoading</c>) — the panel shows the shimmer.</summary>
    Loading,

    /// <summary>The query resolved with no fingerprint (web <c>!isLoading &amp;&amp; !data &amp;&amp; !subsystemMissing</c>).</summary>
    Empty,

    /// <summary>The query failed (web <c>subsystemMissing</c> 503, or any other error) — an InfoBar / banner is shown.</summary>
    Error,

    /// <summary>The query produced a drift report (web <c>query.data</c>) — summary + fingerprints render.</summary>
    Success,
}

/// <summary>
/// A current-or-seed schema fingerprint — the native mirror of the web <c>SchemaFingerprint</c>
/// (web/src/types/admin-operator-confidence.ts): the <see cref="Sha256"/> of the normalised DDL plus the
/// <see cref="TableCount"/> / <see cref="ColumnCount"/> / <see cref="IndexCount"/> roll-ups that produced it. Field
/// names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a partial object never throws. Pure
/// data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record SchemaFingerprint(string Sha256, long TableCount, long ColumnCount, long IndexCount)
{
    /// <summary>The all-zero fingerprint (the default before any data arrives).</summary>
    public static SchemaFingerprint Empty { get; } = new(string.Empty, 0, 0, 0);

    /// <summary>Read one fingerprint from a JSON object, tolerating missing / null fields.</summary>
    public static SchemaFingerprint FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new SchemaFingerprint(
            Sha256: JsonReadHelpers.Str(o, "sha256") ?? string.Empty,
            TableCount: JsonReadHelpers.Long(o, "table_count") ?? 0,
            ColumnCount: JsonReadHelpers.Long(o, "column_count") ?? 0,
            IndexCount: JsonReadHelpers.Long(o, "index_count") ?? 0);
    }
}

/// <summary>
/// The current-vs-expected schema comparison — the native mirror of the web <c>SchemaDrift</c>: whether drift exists
/// (<see cref="HasDrift"/>), the two <see cref="Current"/> / <see cref="Expected"/> fingerprints, the signed
/// table/column/index deltas, and the optional <see cref="ExpectedGeneratedAt"/> stamp of when the seed fingerprint
/// was generated. Pure data; parsing is null-tolerant.
/// </summary>
public sealed record SchemaDrift(
    bool HasDrift,
    SchemaFingerprint Current,
    SchemaFingerprint Expected,
    long TableCountDelta,
    long ColumnCountDelta,
    long IndexCountDelta,
    string? ExpectedGeneratedAt)
{
    /// <summary>The all-zero drift (the default before any data arrives).</summary>
    public static SchemaDrift Empty { get; } = new(
        HasDrift: false,
        Current: SchemaFingerprint.Empty,
        Expected: SchemaFingerprint.Empty,
        TableCountDelta: 0,
        ColumnCountDelta: 0,
        IndexCountDelta: 0,
        ExpectedGeneratedAt: null);

    /// <summary>Read the drift body from a JSON object, tolerating missing / null fields.</summary>
    public static SchemaDrift FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        SchemaFingerprint current = o.TryGetProperty("current", out var c) ? SchemaFingerprint.FromJson(c) : SchemaFingerprint.Empty;
        SchemaFingerprint expected = o.TryGetProperty("expected", out var e) ? SchemaFingerprint.FromJson(e) : SchemaFingerprint.Empty;

        return new SchemaDrift(
            HasDrift: JsonReadHelpers.Bool(o, "has_drift") ?? false,
            Current: current,
            Expected: expected,
            TableCountDelta: JsonReadHelpers.Long(o, "table_count_delta") ?? 0,
            ColumnCountDelta: JsonReadHelpers.Long(o, "column_count_delta") ?? 0,
            IndexCountDelta: JsonReadHelpers.Long(o, "index_count_delta") ?? 0,
            ExpectedGeneratedAt: JsonReadHelpers.Str(o, "expected_generated_at"));
    }
}

/// <summary>
/// The schema-drift envelope — the native mirror of the web <c>SchemaDriftResponse</c>: the <see cref="Drift"/> body
/// plus the <see cref="IsDifferent"/> flag, and a <see cref="HasData"/> marker recording whether the server actually
/// returned a fingerprint (the web <c>query.data</c> presence test). Pure data; parsing is null-tolerant.
/// </summary>
public sealed record SchemaDriftSnapshot(bool HasData, SchemaDrift Drift, bool? IsDifferent)
{
    /// <summary>The empty snapshot (no fingerprint computed yet) — the default local-state feed result.</summary>
    public static SchemaDriftSnapshot Empty { get; } = new(false, SchemaDrift.Empty, null);

    /// <summary>
    /// Read the drift response from JSON, tolerating missing / null fields. A non-object payload, or an object with
    /// no <c>drift</c> body, is treated as "no fingerprint" (the web empty branch).
    /// </summary>
    public static SchemaDriftSnapshot FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty("drift", out var driftEl) || driftEl.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new SchemaDriftSnapshot(
            HasData: true,
            Drift: SchemaDrift.FromJson(driftEl),
            IsDifferent: JsonReadHelpers.Bool(o, "is_different"));
    }
}

/// <summary>
/// The data port the <see cref="SchemaDriftPageViewModel"/> reads the schema-drift report through — the native
/// parity of the web <c>useSchemaDrift</c> hook (GET /admin/observability/schema-drift). The view never performs HTTP
/// itself; the default <see cref="EmptySchemaDriftFeed"/> resolves to the empty state, and the generated-client-backed
/// <see cref="SchemaDriftClientFeed"/> binds to the generated OpenAPI contract client (ADR-004). A failing fetch
/// throws (carrying the HTTP status via <c>ApiException</c>) so the view-model can surface the 503 subsystem-unavailable
/// branch distinctly from a generic failure, exactly as the web <c>subsystemMissing</c> check does.
/// </summary>
public interface ISchemaDriftFeed
{
    /// <summary>Resolve the schema-drift snapshot (web <c>useSchemaDrift</c>).</summary>
    Task<SchemaDriftSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every fetch to the empty snapshot (the empty data state).</summary>
public sealed class EmptySchemaDriftFeed : ISchemaDriftFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptySchemaDriftFeed Instance { get; } = new();

    private EmptySchemaDriftFeed()
    {
    }

    /// <inheritdoc />
    public Task<SchemaDriftSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(SchemaDriftSnapshot.Empty);
    }
}

/// <summary>
/// The render-time data model the <c>SchemaDriftPage</c> projects from — the native analogue of the web page's
/// resolved query state (web/src/features/admin/pages/SchemaDriftPage.tsx). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="HasData">Whether the query produced a fingerprint (web <c>query.data</c>).</param>
/// <param name="Drift">The drift body (web <c>query.data.drift</c>).</param>
/// <param name="IsDifferent">The envelope drift flag (web <c>query.data.is_different</c>), null when absent.</param>
/// <param name="Loading">Whether the query is in flight with no data yet (web <c>query.isLoading</c>).</param>
/// <param name="HasError">Whether the query failed with a non-503 error.</param>
/// <param name="ErrorDetail">Optional failure detail appended to the error surface.</param>
/// <param name="SubsystemMissing">Whether the query failed with HTTP 503 (web <c>subsystemMissing</c>).</param>
public sealed record SchemaDriftModel(
    bool HasData,
    SchemaDrift Drift,
    bool? IsDifferent,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    bool SubsystemMissing)
{
    /// <summary>The initial model — the first load, no data yet.</summary>
    public static SchemaDriftModel Initial { get; } = new(
        HasData: false,
        Drift: SchemaDrift.Empty,
        IsDifferent: null,
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        SubsystemMissing: false);
}

/// <summary>
/// One projected, render-ready fingerprint card (web <c>FingerprintCard</c>): the card title, the SHA-256 (or its
/// em-dash fallback), the Tables / Columns / Indexes count labels + formatted values, and the optional "Captured …"
/// line shown only for the expected (seed) card. Pure data.
/// </summary>
public sealed record FingerprintCardDisplay(
    string Title,
    string Sha256,
    string TablesLabel,
    string TablesValue,
    string ColumnsLabel,
    string ColumnsValue,
    string IndexesLabel,
    string IndexesValue,
    bool ShowGeneratedAt,
    string GeneratedAtText);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade and every count formatted at the display boundary.
/// Holds the always-visible page header, the subsystem-unavailable banner, the four data-state flags (each a visible
/// region), the drift-summary panel (status badge + three delta stat cards) and the fingerprints panel (two
/// fingerprint cards). Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record SchemaDriftDisplay(
    SchemaDriftState State,
    string Title,
    string Subtitle,
    bool ShowSubsystemUnavailable,
    string SubsystemTitle,
    string SubsystemMessage,
    bool ShowLoading,
    string LoadingText,
    bool ShowError,
    string ErrorText,
    string RetryLabel,
    bool ShowEmpty,
    string EmptyTitle,
    string EmptyMessage,
    bool ShowSummary,
    string StatusTitle,
    bool IsDrifted,
    string StatusBadgeLabel,
    StatusKind StatusBadgeVariant,
    string TableDeltaLabel,
    string TableDeltaValue,
    string TableDeltaSub,
    string ColumnDeltaLabel,
    string ColumnDeltaValue,
    string ColumnDeltaSub,
    string IndexDeltaLabel,
    string IndexDeltaValue,
    string IndexDeltaSub,
    bool ShowDetails,
    string FingerprintTitle,
    FingerprintCardDisplay CurrentCard,
    FingerprintCardDisplay ExpectedCard,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="SchemaDriftModel"/> to its <see cref="SchemaDriftDisplay"/> — the native port of
/// the render logic in web/src/features/admin/pages/SchemaDriftPage.tsx. Every visible literal resolves through the
/// i18n facade using the exact web key names; counts format through <see cref="NumberFormatting"/> (the web
/// <c>fmtNumber</c>) and the seed timestamp through <see cref="DateTimeFormatting"/> (the web <c>formatDateTime</c>),
/// so the C# output matches the web truth. Every chrome string is resolved on every projection (visibility is gated
/// by the returned flags), so the i18n contract holds in every data state. No WinUI types — unit-tested without a UI
/// host.
/// </summary>
public static class SchemaDriftProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for timestamp formatting.</param>
    public static SchemaDriftDisplay Project(SchemaDriftModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Page header (web PageContainer title + subtitle) ────────────────────────────────────────────────
        string title = localizer.GetString("admin.schemaDrift.pageTitle", "Schema Drift");
        string subtitle = localizer.GetString(
            "admin.schemaDrift.subtitle",
            "Current database schema fingerprint compared against the recorded seed. Drift indicates a migration ran without a seed refresh, or raw DDL bypassed the migration system.");

        // ── Subsystem-unavailable banner (web 503 subsystemMissing AlertBanner) ─────────────────────────────
        string subsystemTitle = localizer.GetString("admin.subsystem.unavailableTitle", "Subsystem unavailable");
        string subsystemMessage = localizer.GetString(
            "admin.schemaDrift.notConfigured",
            "The schema-drift subsystem is not configured on this deployment. Enable schema fingerprinting in config to populate this page.");

        // ── Generic failure surface (native InfoBar + Retry) ────────────────────────────────────────────────
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        // ── Loading + empty branches ────────────────────────────────────────────────────────────────────────
        string loadingText = localizer.GetString("common.loading", "Loading...");
        string emptyTitle = localizer.GetString("admin.schemaDrift.emptyTitle", "No fingerprint available");
        string emptyMessage = localizer.GetString(
            "admin.schemaDrift.emptyMessage",
            "The schema fingerprint has not been computed yet. Restart the API to capture a seed fingerprint.");

        // ── Drift summary (web DriftSummary) ────────────────────────────────────────────────────────────────
        string statusTitle = localizer.GetString("admin.schemaDrift.statusTitle", "Drift status");
        bool isDrifted = model.IsDifferent ?? model.Drift.HasDrift;
        string statusDrifted = localizer.GetString("admin.schemaDrift.statusDrifted", "Drift detected");
        string statusClean = localizer.GetString("admin.schemaDrift.statusClean", "No drift");
        string statusBadgeLabel = isDrifted ? statusDrifted : statusClean;
        StatusKind statusBadgeVariant = isDrifted ? StatusKind.Warning : StatusKind.Success;

        string tableDeltaLabel = localizer.GetString("admin.schemaDrift.tableDelta", "Tables \u0394");
        string columnDeltaLabel = localizer.GetString("admin.schemaDrift.columnDelta", "Columns \u0394");
        string indexDeltaLabel = localizer.GetString("admin.schemaDrift.indexDelta", "Indexes \u0394");

        string tableSubTemplate = localizer.GetString("admin.schemaDrift.tableSub", "{0} current \u00b7 {1} expected");
        string columnSubTemplate = localizer.GetString("admin.schemaDrift.columnSub", "{0} current \u00b7 {1} expected");
        string indexSubTemplate = localizer.GetString("admin.schemaDrift.indexSub", "{0} current \u00b7 {1} expected");

        var drift = model.Drift;
        string tableDeltaSub = FormatSub(tableSubTemplate, drift.Current.TableCount, drift.Expected.TableCount);
        string columnDeltaSub = FormatSub(columnSubTemplate, drift.Current.ColumnCount, drift.Expected.ColumnCount);
        string indexDeltaSub = FormatSub(indexSubTemplate, drift.Current.IndexCount, drift.Expected.IndexCount);

        // ── Fingerprint details (web DriftDetails) ──────────────────────────────────────────────────────────
        string fingerprintTitle = localizer.GetString("admin.schemaDrift.fingerprintTitle", "Fingerprints");
        string currentTitle = localizer.GetString("admin.schemaDrift.fingerprintCurrent", "Current");
        string expectedTitle = localizer.GetString("admin.schemaDrift.fingerprintExpected", "Expected (seed)");
        string tablesLabel = localizer.GetString("admin.schemaDrift.tables", "Tables");
        string columnsLabel = localizer.GetString("admin.schemaDrift.columns", "Columns");
        string indexesLabel = localizer.GetString("admin.schemaDrift.indexes", "Indexes");
        string generatedAtTemplate = localizer.GetString("admin.schemaDrift.generatedAt", "Captured {0}");

        var currentCard = new FingerprintCardDisplay(
            Title: currentTitle,
            Sha256: string.IsNullOrEmpty(drift.Current.Sha256) ? EmDash : drift.Current.Sha256,
            TablesLabel: tablesLabel,
            TablesValue: FormatCount(drift.Current.TableCount),
            ColumnsLabel: columnsLabel,
            ColumnsValue: FormatCount(drift.Current.ColumnCount),
            IndexesLabel: indexesLabel,
            IndexesValue: FormatCount(drift.Current.IndexCount),
            ShowGeneratedAt: false,
            GeneratedAtText: string.Empty);

        bool showExpectedTimestamp = TryFormatTimestamp(drift.ExpectedGeneratedAt, now, out string expectedWhen);
        var expectedCard = new FingerprintCardDisplay(
            Title: expectedTitle,
            Sha256: string.IsNullOrEmpty(drift.Expected.Sha256) ? EmDash : drift.Expected.Sha256,
            TablesLabel: tablesLabel,
            TablesValue: FormatCount(drift.Expected.TableCount),
            ColumnsLabel: columnsLabel,
            ColumnsValue: FormatCount(drift.Expected.ColumnCount),
            IndexesLabel: indexesLabel,
            IndexesValue: FormatCount(drift.Expected.IndexCount),
            ShowGeneratedAt: showExpectedTimestamp,
            GeneratedAtText: showExpectedTimestamp
                ? string.Format(CultureInfo.CurrentCulture, generatedAtTemplate, expectedWhen)
                : string.Empty);

        // ── State selection (web render precedence) ─────────────────────────────────────────────────────────
        bool showLoading = model.Loading;
        bool showSubsystem = !model.Loading && model.SubsystemMissing;
        bool showError = !model.Loading && !model.SubsystemMissing && model.HasError;
        bool showSuccess = !model.Loading && !model.SubsystemMissing && !model.HasError && model.HasData;
        bool showEmpty = !model.Loading && !model.SubsystemMissing && !model.HasError && !model.HasData;

        SchemaDriftState state = showLoading
            ? SchemaDriftState.Loading
            : (showSubsystem || showError)
                ? SchemaDriftState.Error
                : showSuccess
                    ? SchemaDriftState.Success
                    : SchemaDriftState.Empty;

        return new SchemaDriftDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ShowSubsystemUnavailable: showSubsystem,
            SubsystemTitle: subsystemTitle,
            SubsystemMessage: subsystemMessage,
            ShowLoading: showLoading,
            LoadingText: loadingText,
            ShowError: showError,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowEmpty: showEmpty,
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            ShowSummary: showSuccess,
            StatusTitle: statusTitle,
            IsDrifted: isDrifted,
            StatusBadgeLabel: statusBadgeLabel,
            StatusBadgeVariant: statusBadgeVariant,
            TableDeltaLabel: tableDeltaLabel,
            TableDeltaValue: FormatDelta(drift.TableCountDelta),
            TableDeltaSub: tableDeltaSub,
            ColumnDeltaLabel: columnDeltaLabel,
            ColumnDeltaValue: FormatDelta(drift.ColumnCountDelta),
            ColumnDeltaSub: columnDeltaSub,
            IndexDeltaLabel: indexDeltaLabel,
            IndexDeltaValue: FormatDelta(drift.IndexCountDelta),
            IndexDeltaSub: indexDeltaSub,
            ShowDetails: showSuccess,
            FingerprintTitle: fingerprintTitle,
            CurrentCard: currentCard,
            ExpectedCard: expectedCard,
            AutomationName: title);
    }

    /// <summary>Format a count with en-US grouping (web <c>fmtNumber</c>).</summary>
    public static string FormatCount(long value) => NumberFormatting.Format(value, null, 0);

    /// <summary>Format a signed delta (web <c>formatDelta</c>): <c>0</c>, <c>+N</c> or <c>-N</c> with grouping.</summary>
    public static string FormatDelta(long delta)
    {
        if (delta == 0)
        {
            return "0";
        }

        string formatted = NumberFormatting.Format(delta, null, 0);
        return delta > 0 ? $"+{formatted}" : formatted;
    }

    private static string FormatSub(string template, long current, long expected) =>
        string.Format(CultureInfo.CurrentCulture, template, FormatCount(current), FormatCount(expected));

    // web formatDateTime(generatedAt): absolute date-time, or false (skip the line) for unparseable input.
    private static bool TryFormatTimestamp(string? raw, DateTimeOffset now, out string formatted)
    {
        if (!string.IsNullOrWhiteSpace(raw) && DateTimeOffset.TryParse(
                raw,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var value))
        {
            formatted = DateTimeFormatting.Format(value, DateTimeVariant.Full, now);
            return true;
        }

        formatted = string.Empty;
        return false;
    }
}

/// <summary>
/// Canonical metadata for the <c>SchemaDriftPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/admin/pages/SchemaDriftPage.tsx</c> (route <c>/admin/schema-drift</c>, nav name
/// <c>SchemaDrift</c>).
/// </summary>
public static class SchemaDriftRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SchemaDriftPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>SchemaDrift</c>).</summary>
    public const string RouteName = "SchemaDrift";

    /// <summary>The generated OpenAPI operation id for the drift query (web <c>useSchemaDrift</c>).</summary>
    public const string Operation = "get_api_v1_admin_observability_schema_drift";

    /// <summary>The localized page title (web <c>admin.schemaDrift.pageTitle</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("admin.schemaDrift.pageTitle", "Schema Drift");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SchemaDriftPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a fingerprint hash or count — so a diagnostics
/// line can never leak schema content. Thread-safe.
/// </summary>
public sealed class SchemaDriftDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SchemaDriftDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SchemaDriftPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SchemaDriftRegistration.Slug}");
    }
}
