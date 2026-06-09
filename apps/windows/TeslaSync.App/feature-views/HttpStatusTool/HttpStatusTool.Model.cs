using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive surface state for the <see cref="HttpStatusToolViewModel"/>. The web
/// <c>HttpStatusTool</c> (web/src/features/admin/components/devtools/tools/HttpStatusTool.tsx) is a purely
/// client-side surface — its rows come from the in-memory <c>HTTP_CODES</c> constant
/// (web/src/features/admin/components/devtools/constants.ts), not a network read — so it has only two
/// states: the populated reference table (<see cref="Ready"/>) and the no-search-match empty surface
/// (<see cref="Empty"/>, the web <c>DataTable</c>'s <c>emptyMessage</c> branch when <c>filtered</c> is
/// empty). There is deliberately no loading / error / stale / offline state because the web source has none
/// (the constant resolves synchronously).
/// </summary>
public enum HttpStatusToolState
{
    /// <summary>At least one code matched the current search — render the reference table.</summary>
    Ready,

    /// <summary>No code matched the current search — render the friendly empty surface (never a blank box).</summary>
    Empty,
}

/// <summary>
/// One canonical HTTP status code entry — the native analogue of a web <c>HTTP_CODES</c> record
/// (<c>{ code, text, desc }</c> in web/src/features/admin/components/devtools/constants.ts). The values are
/// raw reference data (not localized): the web renders <c>c.text</c> / <c>c.desc</c> verbatim without a
/// <c>t()</c> call, so the native catalog carries the same English literals.
/// </summary>
/// <param name="Code">Numeric status code (web <c>code</c>, e.g. <c>404</c>).</param>
/// <param name="Text">Reason phrase (web <c>text</c>, e.g. <c>Not Found</c>).</param>
/// <param name="Description">Short explanation (web <c>desc</c>, e.g. <c>Resource not found</c>).</param>
public sealed record HttpStatusCode(int Code, string Text, string Description);

/// <summary>
/// One projected, render-ready status-code row consumed by the WinUI view — the native analogue of a web
/// <c>DataTable</c> row render. <see cref="CodeText"/> is the code formatted for display inside the semantic
/// badge (web <c>&lt;Badge&gt;{r.code}&lt;/Badge&gt;</c>), <see cref="Status"/> is the badge's semantic tint
/// derived from the code class (web <c>r.code &lt; 300 ? 'success' : r.code &lt; 400 ? 'info' : r.code &lt;
/// 500 ? 'warning' : 'danger'</c>), and <see cref="AutomationName"/> is the Narrator name for the whole row
/// (code, reason phrase and description). Pure data — no WinUI types — so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Code">Numeric status code (used as the stable row key).</param>
/// <param name="CodeText">The code formatted for the badge label.</param>
/// <param name="Text">Reason phrase shown in the second column.</param>
/// <param name="Description">Short explanation shown in the third column.</param>
/// <param name="Status">Semantic badge tint derived from the code class.</param>
/// <param name="AutomationName">Narrator name for the row (code, reason phrase and description).</param>
public sealed record HttpStatusCodeRow(
    int Code,
    string CodeText,
    string Text,
    string Description,
    StatusKind Status,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view for one search query — the native analogue of the web
/// <c>filtered</c> list render: the ordered code rows that matched the search, plus the catalog size
/// (<see cref="TotalCount"/>) so a "showing N of M" affordance and tests can reason about the unfiltered
/// reference table. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Rows">The ordered, search-matched code rows (web <c>filtered</c>).</param>
/// <param name="TotalCount">The total number of codes in the catalog before filtering (web <c>HTTP_CODES.length</c>).</param>
public sealed record HttpStatusDisplay(IReadOnlyList<HttpStatusCodeRow> Rows, int TotalCount);

/// <summary>
/// Canonical registry metadata for the HTTP Status surface — the native mirror of the web devtools
/// <c>HttpStatusTool</c>. The diagnostics <see cref="Slug"/> is the stable surface identifier emitted with the
/// <c>view.opened</c> event (P1/S11 diagnostics contract); <see cref="Glyph"/> is the Segoe Fluent code point
/// standing in for the web Lucide <c>Network</c> icon and <see cref="AccentColor"/> is the <see cref="ToolCard"/>
/// accent name standing in for the web Tailwind <c>color="amber"</c> (no ad-hoc hex in the control layer). The
/// localized <see cref="Title(ILocalizer)"/> / <see cref="Description(ILocalizer)"/> back the card header and
/// the surface's Narrator name.
/// </summary>
public static class HttpStatusToolRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "HttpStatusTool";

    /// <summary>Segoe Fluent header glyph (web Lucide <c>Network</c> icon).</summary>
    public const string Glyph = "\uEC05";

    /// <summary>The <see cref="ToolCard"/> accent name (web Tailwind <c>color="amber"</c>).</summary>
    public const string AccentColor = "amber";

    /// <summary>Localized card title (web <c>t('Http Status')</c>).</summary>
    /// <param name="localizer">The i18n facade resolving the label.</param>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Http Status", "Http Status");
    }

    /// <summary>Localized card description (web <c>t('Http Status Desc')</c>).</summary>
    /// <param name="localizer">The i18n facade resolving the label.</param>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Http Status Desc", "Http Status Desc");
    }
}

/// <summary>
/// Pure mapping from a numeric HTTP status code to its semantic badge tint — the native port of the web
/// <c>HttpStatusTool</c>'s inline <c>variant</c> ternary
/// (web/src/features/admin/components/devtools/tools/HttpStatusTool.tsx): <c>code &lt; 300 ? 'success' :
/// code &lt; 400 ? 'info' : code &lt; 500 ? 'warning' : 'danger'</c>. Kept UI-free so the mapping is
/// unit-tested without a XAML runtime.
/// </summary>
public static class HttpStatusClassifier
{
    /// <summary>
    /// Classify <paramref name="code"/> into the badge tint the web uses: 1xx/2xx are
    /// <see cref="StatusKind.Success"/>, 3xx are <see cref="StatusKind.Info"/>, 4xx are
    /// <see cref="StatusKind.Warning"/> and 5xx (and above) are <see cref="StatusKind.Danger"/>.
    /// </summary>
    /// <param name="code">The numeric status code to classify.</param>
    public static StatusKind Classify(int code) =>
        code < 300 ? StatusKind.Success :
        code < 400 ? StatusKind.Info :
        code < 500 ? StatusKind.Warning :
        StatusKind.Danger;
}

/// <summary>
/// Pure projection from the canonical <see cref="HttpStatusCode"/> catalog to the render-ready
/// <see cref="HttpStatusDisplay"/> — the native port of the web <c>HttpStatusTool</c>'s <c>filtered</c>
/// memo (web/src/features/admin/components/devtools/tools/HttpStatusTool.tsx). A blank or whitespace-only
/// query returns every code in catalog order (web <c>if (!search.trim()) return HTTP_CODES</c>); otherwise
/// the lower-cased query matches the code digits, the reason phrase or the description
/// (web <c>String(c.code).includes(q) || c.text.toLowerCase().includes(q) ||
/// c.desc.toLowerCase().includes(q)</c>). No SI conversion applies (the surface carries no measurements).
/// </summary>
public static class HttpStatusProjection
{
    /// <summary>
    /// Project <paramref name="codes"/> for <paramref name="search"/>, classifying each match's badge tint
    /// and composing its Narrator name. The match mirrors the web exactly: the empty-query guard trims the
    /// query, but the substring match itself uses the raw lower-cased query so it stays faithful to the web
    /// <c>search.toLowerCase()</c> (which is not trimmed).
    /// </summary>
    /// <param name="codes">The canonical status-code catalog to project.</param>
    /// <param name="search">The current search query (null / blank returns every code).</param>
    public static HttpStatusDisplay Project(IReadOnlyList<HttpStatusCode> codes, string? search)
    {
        ArgumentNullException.ThrowIfNull(codes);

        string raw = search ?? string.Empty;
        bool filtering = !string.IsNullOrWhiteSpace(raw);
        string query = raw.ToLowerInvariant();

        var rows = new List<HttpStatusCodeRow>(codes.Count);
        foreach (var code in codes)
        {
            if (filtering && !Matches(code, query))
            {
                continue;
            }

            string codeText = code.Code.ToString(CultureInfo.InvariantCulture);
            string automationName = string.Create(
                CultureInfo.CurrentCulture,
                $"{codeText} {code.Text}. {code.Description}");

            rows.Add(new HttpStatusCodeRow(
                code.Code,
                codeText,
                code.Text,
                code.Description,
                HttpStatusClassifier.Classify(code.Code),
                automationName));
        }

        return new HttpStatusDisplay(rows, codes.Count);
    }

    /// <summary>True when the lower-cased <paramref name="query"/> is a substring of the code digits, reason phrase or description.</summary>
    private static bool Matches(HttpStatusCode code, string query) =>
        code.Code.ToString(CultureInfo.InvariantCulture).Contains(query, StringComparison.Ordinal) ||
        code.Text.ToLowerInvariant().Contains(query, StringComparison.Ordinal) ||
        code.Description.ToLowerInvariant().Contains(query, StringComparison.Ordinal);
}

/// <summary>
/// PII-safe diagnostics for the HTTP Status surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a search query or any user data — so a
/// diagnostics line can never leak operational data. Thread-safe.
/// </summary>
public sealed class HttpStatusToolDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public HttpStatusToolDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=HttpStatusTool</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={HttpStatusToolRegistration.Slug}");
    }
}
