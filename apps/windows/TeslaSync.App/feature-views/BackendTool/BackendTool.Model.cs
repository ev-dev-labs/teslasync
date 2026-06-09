using System.Text.Json;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="BackendToolViewModel"/> can be in — the native union of the surfaces the
/// web <c>BackendTool</c> renders (web/src/features/admin/components/devtools/BackendTool.tsx). Because the
/// web surface is a fire-on-demand <c>useMutation</c> action card (not a cache-then-network read), its
/// visible states are the four below rather than the freshness chrome of a data widget: <see cref="Idle"/>
/// (no run yet — the web component renders the card with the Run button and no badge/result), <see
/// cref="Running"/> (the web <c>mutation.isPending</c> button-spinner), <see cref="Success"/> (web
/// <c>mutation.data</c> with no <c>error</c> — the green badge + JSON result panel) and <see cref="Failed"/>
/// (web truthy <c>mutation.data.error</c> — the danger badge + error result panel). The mutation has no
/// fetched/cached value, so the stale and offline freshness states of a read surface do not exist here; an
/// API fault is folded into <see cref="Failed"/> exactly as the web <c>apiFetch</c> catch returns
/// <c>{ error }</c>.
/// </summary>
public enum BackendToolState
{
    /// <summary>No run has settled yet — render the card + Run button, no badge, an idle result region.</summary>
    Idle,

    /// <summary>A run is in flight — the Run button shows a progress ring and is disabled (web <c>isPending</c>).</summary>
    Running,

    /// <summary>The run returned a payload with no error — green "Success" badge + JSON result panel.</summary>
    Success,

    /// <summary>The run failed (transport fault or a truthy <c>error</c> field) — danger "Failed" badge + error panel.</summary>
    Failed,
}

/// <summary>
/// The configuration for one <c>BackendTool</c> action card — the native analogue of the web component's
/// props (<c>icon</c>, <c>color</c>, <c>title</c>, <c>description</c>, <c>endpoint</c>, <c>method</c>,
/// <c>bodyBuilder</c>). The web <c>endpoint</c> + <c>method</c> collapse into <see cref="OperationId"/>: the
/// generated OpenAPI operation id (e.g. <c>post_api_v1_dev_tools_fleet_status</c>) already carries both the
/// HTTP verb and the <c>/dev-tools/…</c> path, so the operation-id-based contract client resolves the same
/// request the web <c>request('/dev-tools/{endpoint}', { method })</c> issues. <see cref="Glyph"/> is the
/// Segoe Fluent code point standing in for the web Lucide icon and <see cref="AccentBrushKey"/> is the
/// semantic design-token key standing in for the web Tailwind colour (no ad-hoc hex in the control layer).
/// <see cref="Title"/> and <see cref="Description"/> are already-localized strings supplied by the parent
/// section — mirroring the web boundary where <c>BackendTool</c> receives them as props and localizes only
/// its own Run / Success / Failed labels.
/// </summary>
/// <param name="Glyph">Segoe Fluent header glyph (web Lucide <c>icon</c>).</param>
/// <param name="AccentBrushKey">Semantic accent token key for the glyph tint (web Tailwind <c>color</c>).</param>
/// <param name="Title">Localized card title supplied by the parent (web <c>title</c>).</param>
/// <param name="Description">Localized card description supplied by the parent (web <c>description</c>).</param>
/// <param name="OperationId">Generated OpenAPI operation id encoding the verb + <c>/dev-tools</c> path.</param>
/// <param name="Body">Optional JSON request body (web <c>bodyBuilder?.()</c>); omitted when null.</param>
public sealed record BackendToolDescriptor(
    string Glyph,
    string AccentBrushKey,
    string Title,
    string Description,
    string OperationId,
    object? Body = null);

/// <summary>
/// The settled result of one backend run — the native mirror of the value the web <c>apiFetch</c> resolves:
/// either the response object (success) or <c>{ error: message }</c> (a caught transport fault, or a 200
/// body that itself carries a truthy <c>error</c>). Kept pure so the success/failure classification is
/// unit-tested without a network. <see cref="Error"/> is intentionally nullable: the web only surfaces the
/// error text when <c>typeof data.error === 'string'</c>, so a truthy-but-non-string error reads as a
/// failure with no message (the result region then shows the idle line while the badge shows "Failed").
/// </summary>
/// <param name="Ok">Whether the run succeeded (web: no truthy <c>data.error</c>).</param>
/// <param name="Data">The response payload on success, otherwise null.</param>
/// <param name="Error">The failure message when the server returned a string <c>error</c>, otherwise null.</param>
public sealed record BackendToolOutcome(bool Ok, JsonElement? Data, string? Error)
{
    /// <summary>A successful outcome carrying the response payload.</summary>
    public static BackendToolOutcome Succeeded(JsonElement data) => new(true, data, null);

    /// <summary>A failed outcome carrying an optional message (null mirrors a truthy non-string error).</summary>
    public static BackendToolOutcome Failed(string? error) => new(false, null, error);

    /// <summary>
    /// Classify a run response exactly as the web <c>BackendTool</c> does: a JSON object with a truthy
    /// <c>error</c> property is a failure (the message is carried only when <c>error</c> is a string, per the
    /// web <c>typeof data.error === 'string'</c> guard); anything else is a success carrying the payload.
    /// </summary>
    public static BackendToolOutcome FromResponse(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty("error", out var error)
            && IsTruthy(error))
        {
            string? message = error.ValueKind == JsonValueKind.String ? error.GetString() : null;
            return Failed(string.IsNullOrEmpty(message) ? null : message);
        }

        return Succeeded(root);
    }

    // JavaScript truthiness for the web `mutation.data.error` test: non-empty string, non-zero number,
    // boolean true, or any object/array is truthy; null/undefined/false/0/"" are falsy.
    private static bool IsTruthy(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => !string.IsNullOrEmpty(value.GetString()),
        JsonValueKind.Number => value.TryGetDouble(out var n) && n != 0,
        JsonValueKind.True => true,
        JsonValueKind.Object or JsonValueKind.Array => true,
        _ => false,
    };
}

/// <summary>
/// Pure formatting helpers for the result region, kept UI-free so they are unit-tested without a XAML host.
/// </summary>
public static class BackendToolFormat
{
    private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

    /// <summary>
    /// Pretty-print a response payload the way the web <c>ResultPanel</c> does (<c>JSON.stringify(data, null,
    /// 2)</c>) — a two-space-indented JSON document for the result <c>pre</c> block and the copy affordance.
    /// </summary>
    public static string PrettyPrint(JsonElement data) => JsonSerializer.Serialize(data, Indented);
}
