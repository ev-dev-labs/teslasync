using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>SecretRotationPage</c> surface — the native mirror of the data
/// states the web page renders (web/src/features/admin/pages/SecretRotationPage.tsx). The web page runs the
/// <c>useSecretRotation</c> query and renders, in precedence order, the loading shimmer (web <c>query.isLoading</c>),
/// the subsystem-unavailable banner (web <c>subsystemMissing</c>, the HTTP 503 case) or the generic failure surface,
/// the tracked-secret stat cards + the rotation-status table (web <c>items.length &gt; 0</c>), or the "no tracked
/// secrets" empty state when no rotation events have been recorded. This enum is the top-level summary the ledger /
/// Narrator key off; per-region visibility is still driven by the projected flags so each branch renders exactly as
/// the web composes it.
/// </summary>
public enum SecretRotationState
{
    /// <summary>The rotation query is in flight (web <c>query.isLoading</c>) — the page shows the shimmer.</summary>
    Loading,

    /// <summary>The query resolved with no tracked secrets (web <c>items.length === 0</c>) — the table shows an empty state.</summary>
    Empty,

    /// <summary>The query failed (web <c>subsystemMissing</c> 503, or any other error) — a banner / InfoBar is shown.</summary>
    Error,

    /// <summary>The query produced tracked-secret rows (web <c>items.length &gt; 0</c>) — stat cards + table render.</summary>
    Success,
}

/// <summary>
/// The per-secret rotation severity tier — the native mirror of the web <c>SecretRotationSeverity</c>
/// (web/src/types/admin-operator-confidence.ts) and the Go <c>rotation.Severity</c> wire enum
/// (internal/rotation/tracker.go): the server computes the tier against per-kind warn/critical thresholds.
/// </summary>
public enum SecretRotationSeverity
{
    /// <summary>Within thresholds (web <c>'ok'</c>).</summary>
    Ok,

    /// <summary>Past the warn threshold — rotate soon (web <c>'warn'</c>).</summary>
    Warn,

    /// <summary>Past the critical threshold — overdue (web <c>'critical'</c>).</summary>
    Critical,

    /// <summary>No threshold computed (web <c>'unknown'</c>).</summary>
    Unknown,
}

/// <summary>
/// One per-(kind, target) rotation-status row — the native mirror of the web <c>SecretRotationStatus</c>
/// (web/src/types/admin-operator-confidence.ts) and the Go <c>rotation.Status</c> (internal/rotation/tracker.go): the
/// secret kind + optional target id, the last-rotated instant + its age in days, the optional expiry instant +
/// days-to-expiry, the per-kind warn/critical day thresholds, and the computed severity tier. Field names mirror the
/// Go API's snake_case JSON tags; parsing is null-tolerant. Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
public sealed record SecretRotationItem(
    string Kind,
    string? TargetId,
    string? LastRotated,
    long AgeDays,
    string? ExpiresAt,
    long? DaysToExpiry,
    long WarnDays,
    long CriticalDays,
    SecretRotationSeverity Severity)
{
    /// <summary>Read one row from a JSON object, tolerating missing / null fields.</summary>
    public static SecretRotationItem FromJson(JsonElement o) => new(
        Kind: JsonReadHelpers.Str(o, "kind") ?? string.Empty,
        TargetId: JsonReadHelpers.Str(o, "target_id"),
        LastRotated: JsonReadHelpers.Str(o, "last_rotated"),
        AgeDays: JsonReadHelpers.Long(o, "age_days") ?? 0,
        ExpiresAt: JsonReadHelpers.Str(o, "expires_at"),
        DaysToExpiry: JsonReadHelpers.Long(o, "days_to_expiry"),
        WarnDays: JsonReadHelpers.Long(o, "warn_days") ?? 0,
        CriticalDays: JsonReadHelpers.Long(o, "critical_days") ?? 0,
        Severity: ParseSeverity(JsonReadHelpers.Str(o, "severity")));

    /// <summary>Map the wire severity string (<c>ok</c>/<c>warn</c>/<c>critical</c>/<c>unknown</c>) to the tier enum.</summary>
    public static SecretRotationSeverity ParseSeverity(string? raw) => raw switch
    {
        "ok" => SecretRotationSeverity.Ok,
        "warn" => SecretRotationSeverity.Warn,
        "critical" => SecretRotationSeverity.Critical,
        _ => SecretRotationSeverity.Unknown,
    };
}

/// <summary>
/// The secret-rotation envelope — the native mirror of the web <c>SecretRotationResponse</c>: the per-secret
/// <see cref="Items"/> rows, and a <see cref="HasData"/> marker recording whether the server returned a response (the
/// web <c>query.data</c> presence test). The tolerant parser unwraps the platform <c>{data:…}</c> envelope
/// (internal/platform/httputil.Respond) so the snake_case wire shape round-trips losslessly. Pure data.
/// </summary>
public sealed record SecretRotationSnapshot(bool HasData, IReadOnlyList<SecretRotationItem> Items)
{
    /// <summary>The empty snapshot (no response yet) — the default local-state feed result.</summary>
    public static SecretRotationSnapshot Empty { get; } = new(false, Array.Empty<SecretRotationItem>());

    /// <summary>
    /// Read the secret-rotation response from JSON, tolerating missing / null fields and the platform <c>{data:…}</c>
    /// envelope. A non-object payload is treated as "no data" (the web empty branch).
    /// </summary>
    public static SecretRotationSnapshot FromJson(JsonElement root)
    {
        JsonElement o = root;
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("data", out var data) &&
            data.ValueKind == JsonValueKind.Object)
        {
            o = data;
        }

        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var items = new List<SecretRotationItem>();
        if (o.TryGetProperty("items", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var element in arr.EnumerateArray())
            {
                if (element.ValueKind == JsonValueKind.Object)
                {
                    items.Add(SecretRotationItem.FromJson(element));
                }
            }
        }

        return new SecretRotationSnapshot(true, items);
    }
}

/// <summary>
/// The data port the <see cref="SecretRotationPageViewModel"/> reads the rotation report through — the native parity
/// of the web <c>useSecretRotation()</c> hook (GET /admin/observability/secret-rotation). The view never performs HTTP
/// itself; the default <see cref="EmptySecretRotationFeed"/> resolves to the empty state, and the generated-client-backed
/// <see cref="SecretRotationClientFeed"/> binds to the generated OpenAPI contract client (ADR-004). A failing fetch
/// throws (carrying the HTTP status via <c>ApiException</c>) so the view-model can surface the 503 subsystem-unavailable
/// branch distinctly from a generic failure, exactly as the web <c>subsystemMissing</c> check does.
/// </summary>
public interface ISecretRotationFeed
{
    /// <summary>Resolve the secret-rotation snapshot (web <c>useSecretRotation</c>).</summary>
    Task<SecretRotationSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every fetch to the empty snapshot (the empty data state).</summary>
public sealed class EmptySecretRotationFeed : ISecretRotationFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptySecretRotationFeed Instance { get; } = new();

    private EmptySecretRotationFeed()
    {
    }

    /// <inheritdoc />
    public Task<SecretRotationSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(SecretRotationSnapshot.Empty);
    }
}

/// <summary>
/// The render-time data model the <c>SecretRotationPage</c> projects from — the native analogue of the web page's
/// resolved query state (web/src/features/admin/pages/SecretRotationPage.tsx). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="HasData">Whether the query produced a response (web <c>query.data</c>).</param>
/// <param name="Items">The per-secret rows (web <c>query.data.items</c>).</param>
/// <param name="Loading">Whether the query is in flight with no data yet (web <c>query.isLoading</c>).</param>
/// <param name="HasError">Whether the query failed with a non-503 error.</param>
/// <param name="ErrorDetail">Optional failure detail appended to the error surface.</param>
/// <param name="SubsystemMissing">Whether the query failed with HTTP 503 (web <c>subsystemMissing</c>).</param>
public sealed record SecretRotationModel(
    bool HasData,
    IReadOnlyList<SecretRotationItem> Items,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    bool SubsystemMissing)
{
    /// <summary>The initial model — the first load, no data yet.</summary>
    public static SecretRotationModel Initial { get; } = new(
        HasData: false,
        Items: Array.Empty<SecretRotationItem>(),
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        SubsystemMissing: false);
}

/// <summary>The four-way tracked-secret tally (web <c>counts</c>): total + per-tier ok/warn/critical counts.</summary>
public sealed record SecretRotationCounts(int Total, int Ok, int Warn, int Critical)
{
    /// <summary>The all-zero tally.</summary>
    public static SecretRotationCounts Empty { get; } = new(0, 0, 0, 0);

    /// <summary>Tally the items into total + per-tier counts (web <c>useMemo</c> reducer).</summary>
    public static SecretRotationCounts From(IReadOnlyList<SecretRotationItem> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        int ok = 0, warn = 0, critical = 0;
        foreach (var it in items)
        {
            switch (it.Severity)
            {
                case SecretRotationSeverity.Ok:
                    ok++;
                    break;
                case SecretRotationSeverity.Warn:
                    warn++;
                    break;
                case SecretRotationSeverity.Critical:
                    critical++;
                    break;
                default:
                    break;
            }
        }

        return new SecretRotationCounts(items.Count, ok, warn, critical);
    }
}

/// <summary>The localized header strings for the rotation-status table columns (web <c>columns</c> headers).</summary>
public sealed record SecretRotationColumns(
    string Kind,
    string Rotated,
    string Age,
    string Expiry,
    string Thresholds,
    string Severity);

/// <summary>
/// One projected, render-ready table row (web table <c>render</c> output): the formatted cells for the rotation-status
/// table, including the two-line kind / rotated / expiry cells and the severity chip. Pure data so the rows are
/// asserted headlessly.
/// </summary>
public sealed record SecretRotationRowDisplay(
    string Key,
    string Kind,
    string TargetId,
    bool ShowTarget,
    string Rotated,
    string RotatedRelative,
    string Age,
    string Expiry,
    string DaysToExpiry,
    bool ShowDaysToExpiry,
    string Thresholds,
    string SeverityLabel,
    StatusKind SeverityVariant);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade and every number formatted at the display boundary.
/// Holds the always-visible page header, the subsystem-unavailable banner, the overdue-rotations critical banner, the
/// four data-state flags, the four tracked-secret stat cards (Tracked secrets / OK / Warn / Critical) and the
/// rotation-status panel (table or empty state). Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record SecretRotationDisplay(
    SecretRotationState State,
    string Title,
    string Subtitle,
    bool ShowSubsystemUnavailable,
    string SubsystemTitle,
    string SubsystemMessage,
    bool ShowCriticalBanner,
    string CriticalTitle,
    string CriticalMessage,
    bool ShowLoading,
    string LoadingText,
    bool ShowError,
    string ErrorText,
    string RetryLabel,
    bool ShowContent,
    bool ShowStatCards,
    string TotalLabel,
    string TotalValue,
    string TotalGlyph,
    string OkLabel,
    string OkValue,
    string WarnLabel,
    string WarnValue,
    string CriticalLabel,
    string CriticalValue,
    string CriticalGlyph,
    string TableTitle,
    SecretRotationColumns Columns,
    IReadOnlyList<SecretRotationRowDisplay> Rows,
    bool ShowTable,
    bool ShowEmptyState,
    string EmptyTitle,
    string EmptyMessage,
    string EmptyTableMessage,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="SecretRotationModel"/> to its <see cref="SecretRotationDisplay"/> — the native
/// port of the render logic in web/src/features/admin/pages/SecretRotationPage.tsx. Every visible literal resolves
/// through the i18n facade using the exact web key names; counts and day values format through
/// <see cref="NumberFormatting"/> (the web <c>fmtNumber</c>), the rotation instants through
/// <see cref="FormatDateTime"/> (the web <c>formatDateTime</c>) and <see cref="FormatRelative"/> (the web
/// <c>formatRelative</c>), so the C# output matches the web truth. Every chrome string (including the per-row
/// templates) is resolved on every projection so the i18n contract holds in every data state. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class SecretRotationProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for relative timestamp formatting.</param>
    public static SecretRotationDisplay Project(SecretRotationModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var counts = SecretRotationCounts.From(model.Items);

        // ── Page header (web PageContainer title + subtitle) ────────────────────────────────────────────────
        string title = localizer.GetString("admin.secretRotation.pageTitle", "Secret Rotation");
        string subtitle = localizer.GetString(
            "admin.secretRotation.subtitle",
            "Status of every tracked credential. Severity reflects per-kind warn/critical thresholds; rotate anything in the critical tier as soon as possible.");

        // ── Subsystem-unavailable banner (web 503 subsystemMissing AlertBanner) ─────────────────────────────
        string subsystemTitle = localizer.GetString("admin.subsystem.unavailableTitle", "Subsystem unavailable");
        string subsystemMessage = localizer.GetString(
            "admin.secretRotation.notConfigured",
            "The rotation tracker is not configured on this deployment. Enable secret rotation tracking in config to populate this page.");

        // ── Overdue-rotations critical banner (web counts.critical > 0 AlertBanner) ─────────────────────────
        string criticalTitle = localizer.GetString("admin.secretRotation.criticalTitle", "Overdue rotations");
        string criticalMessageTemplate = localizer.GetString(
            "admin.secretRotation.criticalMessage",
            "{0} secrets are past their critical rotation threshold. These should be rotated immediately to reduce blast radius.");
        string criticalMessage = string.Format(CultureInfo.CurrentCulture, criticalMessageTemplate, counts.Critical);

        // ── Generic failure surface (native InfoBar + Retry) ────────────────────────────────────────────────
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;
        string retryLabel = localizer.GetString("common.retry", "Retry");
        string loadingText = localizer.GetString("common.loading", "Loading...");

        // ── Tracked-secret stat cards (web StatCard grid) ───────────────────────────────────────────────────
        string totalLabel = localizer.GetString("admin.secretRotation.totalLabel", "Tracked secrets");
        string okLabel = localizer.GetString("admin.secretRotation.okLabel", "OK");
        string warnLabel = localizer.GetString("admin.secretRotation.warnLabel", "Warn");
        string criticalLabel = localizer.GetString("admin.secretRotation.criticalLabel", "Critical");

        // ── Rotation-status panel chrome (web GlassPanel header + columns) ───────────────────────────────────
        string tableTitle = localizer.GetString("admin.secretRotation.tableTitle", "Rotation status");
        var columns = new SecretRotationColumns(
            Kind: localizer.GetString("admin.secretRotation.colKind", "Kind"),
            Rotated: localizer.GetString("admin.secretRotation.colRotated", "Last rotated"),
            Age: localizer.GetString("admin.secretRotation.colAge", "Age (days)"),
            Expiry: localizer.GetString("admin.secretRotation.colExpiry", "Expires"),
            Thresholds: localizer.GetString("admin.secretRotation.colThresholds", "Warn / critical"),
            Severity: localizer.GetString("admin.secretRotation.colSeverity", "Severity"));

        // ── Per-row template (resolved on every projection so the i18n contract holds even when empty) ───────
        string daysToExpiryTemplate = localizer.GetString("admin.secretRotation.daysToExpiry", "{0}d remaining");

        // ── Empty state (web EmptyState + DataTable emptyMessage) ───────────────────────────────────────────
        string emptyTitle = localizer.GetString("admin.secretRotation.emptyTitle", "No tracked secrets");
        string emptyMessage = localizer.GetString(
            "admin.secretRotation.emptyMessage",
            "No rotation events have been recorded yet. The tracker captures observations on every credential rotation.");
        string emptyTableMessage = localizer.GetString("admin.secretRotation.emptyTable", "No tracked secrets");

        // ── Table rows (web column render functions) ────────────────────────────────────────────────────────
        var rows = new List<SecretRotationRowDisplay>(model.Items.Count);
        foreach (var item in model.Items)
        {
            rows.Add(ProjectRow(item, localizer, daysToExpiryTemplate, now));
        }

        // ── State selection (web render precedence) ─────────────────────────────────────────────────────────
        bool showLoading = model.Loading;
        bool showSubsystem = !model.Loading && model.SubsystemMissing;
        bool showError = !model.Loading && !model.SubsystemMissing && model.HasError;
        bool showContent = !model.Loading && !model.SubsystemMissing && !model.HasError;
        bool hasItems = model.Items.Count > 0;
        bool showStatCards = showContent && hasItems;          // web items.length > 0 gate on the StatCard grid
        bool showCriticalBanner = showContent && counts.Critical > 0;
        bool showTable = showContent && hasItems;
        bool showEmptyState = showContent && !hasItems;

        SecretRotationState state = showLoading
            ? SecretRotationState.Loading
            : (showSubsystem || showError)
                ? SecretRotationState.Error
                : hasItems
                    ? SecretRotationState.Success
                    : SecretRotationState.Empty;

        return new SecretRotationDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ShowSubsystemUnavailable: showSubsystem,
            SubsystemTitle: subsystemTitle,
            SubsystemMessage: subsystemMessage,
            ShowCriticalBanner: showCriticalBanner,
            CriticalTitle: criticalTitle,
            CriticalMessage: criticalMessage,
            ShowLoading: showLoading,
            LoadingText: loadingText,
            ShowError: showError,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowContent: showContent,
            ShowStatCards: showStatCards,
            TotalLabel: totalLabel,
            TotalValue: FormatCount(counts.Total),
            TotalGlyph: SecretRotationRegistration.ShieldGlyph,
            OkLabel: okLabel,
            OkValue: FormatCount(counts.Ok),
            WarnLabel: warnLabel,
            WarnValue: FormatCount(counts.Warn),
            CriticalLabel: criticalLabel,
            CriticalValue: FormatCount(counts.Critical),
            CriticalGlyph: counts.Critical > 0 ? SecretRotationRegistration.AlertGlyph : string.Empty,
            TableTitle: tableTitle,
            Columns: columns,
            Rows: rows,
            ShowTable: showTable,
            ShowEmptyState: showEmptyState,
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            EmptyTableMessage: emptyTableMessage,
            AutomationName: title);
    }

    /// <summary>Format an integer count with en-US grouping (web <c>fmtNumber</c> at 0 decimals).</summary>
    public static string FormatCount(long value) => NumberFormatting.Format(value, null, 0);

    /// <summary>
    /// Absolute rotation-instant label (web <c>formatDateTime</c>): "MMM d, yyyy hh:mm tt", with the em-dash fallback
    /// for null / unparseable input.
    /// </summary>
    public static string FormatDateTime(string? raw, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(raw) || !TryParseInstant(raw, out var value))
        {
            return EmDash;
        }

        return DateTimeFormatting.Format(value, DateTimeVariant.Full, now);
    }

    /// <summary>
    /// Relative rotation-instant label (web <c>formatRelative</c>): "just now" / "Nm ago" / "Nh ago" / "Nd ago" for the
    /// first week, then an absolute "MMM d, yyyy" date; the em-dash fallback for null / unparseable input.
    /// </summary>
    public static string FormatRelative(string? raw, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(raw) || !TryParseInstant(raw, out var value))
        {
            return EmDash;
        }

        long seconds = (long)Math.Floor((now - value).TotalSeconds);
        if (seconds < 60)
        {
            return "just now";
        }

        long minutes = seconds / 60;
        if (minutes < 60)
        {
            return $"{minutes}m ago";
        }

        long hours = minutes / 60;
        if (hours < 24)
        {
            return $"{hours}h ago";
        }

        long days = hours / 24;
        if (days < 7)
        {
            return $"{days}d ago";
        }

        return DateTimeFormatting.Format(value, DateTimeVariant.Date, now);
    }

    /// <summary>Map a severity tier to the shared <see cref="StatusKind"/> chip variant (web <c>SEVERITY_VARIANT</c>).</summary>
    public static StatusKind SeverityVariant(SecretRotationSeverity severity) => severity switch
    {
        SecretRotationSeverity.Ok => StatusKind.Success,
        SecretRotationSeverity.Warn => StatusKind.Warning,
        SecretRotationSeverity.Critical => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>The localized severity chip label (web <c>SEVERITY_LABEL</c>); the em-dash for the unknown tier.</summary>
    public static string SeverityLabel(SecretRotationSeverity severity, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return severity switch
        {
            SecretRotationSeverity.Ok => localizer.GetString("admin.secretRotation.severityOk", "OK"),
            SecretRotationSeverity.Warn => localizer.GetString("admin.secretRotation.severityWarn", "Rotate soon"),
            SecretRotationSeverity.Critical => localizer.GetString("admin.secretRotation.severityCritical", "Overdue"),
            _ => EmDash,
        };
    }

    /// <summary>
    /// The friendly secret-kind label (web <c>formatKind</c> / <c>KIND_LABELS</c>); falls back to the raw kind so a
    /// newly-added kind still renders before this map is updated.
    /// </summary>
    public static string FormatKind(string raw, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return raw switch
        {
            "tesla_refresh_token" => localizer.GetString("admin.secretRotation.kindTeslaRefreshToken", "Tesla refresh token"),
            "mqtt_mtls_cert" => localizer.GetString("admin.secretRotation.kindMqttMtlsCert", "MQTT mTLS certificate"),
            "database_password" => localizer.GetString("admin.secretRotation.kindDatabasePassword", "Database password"),
            "session_jwk" => localizer.GetString("admin.secretRotation.kindSessionJwk", "Session JWK"),
            "app_signing_key" => localizer.GetString("admin.secretRotation.kindAppSigningKey", "App signing key"),
            "authentik_secret" => localizer.GetString("admin.secretRotation.kindAuthentikSecret", "Authentik client secret"),
            _ => string.IsNullOrEmpty(raw) ? EmDash : raw,
        };
    }

    private static SecretRotationRowDisplay ProjectRow(
        SecretRotationItem item,
        ILocalizer localizer,
        string daysToExpiryTemplate,
        DateTimeOffset now)
    {
        bool hasExpiry = !string.IsNullOrWhiteSpace(item.ExpiresAt);
        bool showDaysToExpiry = hasExpiry && item.DaysToExpiry is not null;
        string daysToExpiry = showDaysToExpiry
            ? string.Format(CultureInfo.CurrentCulture, daysToExpiryTemplate, item.DaysToExpiry!.Value)
            : string.Empty;

        string thresholds = $"{FormatCount(item.WarnDays)}d / {FormatCount(item.CriticalDays)}d";

        return new SecretRotationRowDisplay(
            Key: $"{item.Kind}:{item.TargetId ?? string.Empty}",
            Kind: FormatKind(item.Kind, localizer),
            TargetId: item.TargetId ?? string.Empty,
            ShowTarget: !string.IsNullOrEmpty(item.TargetId),
            Rotated: FormatDateTime(item.LastRotated, now),
            RotatedRelative: FormatRelative(item.LastRotated, now),
            Age: FormatCount(item.AgeDays),
            Expiry: hasExpiry ? FormatDateTime(item.ExpiresAt, now) : EmDash,
            DaysToExpiry: daysToExpiry,
            ShowDaysToExpiry: showDaysToExpiry,
            Thresholds: thresholds,
            SeverityLabel: SeverityLabel(item.Severity, localizer),
            SeverityVariant: SeverityVariant(item.Severity));
    }

    private static bool TryParseInstant(string raw, out DateTimeOffset value) =>
        DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out value);
}

/// <summary>
/// Canonical metadata for the <c>SecretRotationPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/admin/pages/SecretRotationPage.tsx</c> (route <c>/admin/secret-rotation</c>, nav name
/// <c>SecretRotation</c>).
/// </summary>
public static class SecretRotationRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SecretRotationPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>SecretRotation</c>).</summary>
    public const string RouteName = "SecretRotation";

    /// <summary>The generated OpenAPI operation id for the rotation query (web <c>useSecretRotation</c>).</summary>
    public const string Operation = "get_api_v1_admin_observability_secret_rotation";

    /// <summary>The Segoe Fluent Icons glyph for the Tracked-secrets card + empty state (web <c>ShieldCheck</c> icon).</summary>
    public const string ShieldGlyph = "\uEA18"; // Shield

    /// <summary>The Segoe Fluent Icons glyph for the overdue critical accent (web <c>AlertTriangle</c> icon).</summary>
    public const string AlertGlyph = "\uE7BA"; // Warning

    /// <summary>The localized page title (web <c>admin.secretRotation.pageTitle</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("admin.secretRotation.pageTitle", "Secret Rotation");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SecretRotationPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a secret kind, target id or count — so a
/// diagnostics line can never leak credential metadata. Thread-safe.
/// </summary>
public sealed class SecretRotationDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SecretRotationDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SecretRotationPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SecretRotationRegistration.Slug}");
    }
}
