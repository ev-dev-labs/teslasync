using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive surface state for the <see cref="ResultPanelViewModel"/>. ResultPanel is a pure
/// presentational surface (web/src/features/admin/components/devtools/ResultPanel.tsx is driven entirely by
/// its props and owns no data source), so it has exactly the three render branches the web component has —
/// <see cref="Error"/>, <see cref="Result"/> and <see cref="Idle"/> — chosen in the same precedence order
/// (error first, then a non-null payload, then the friendly idle surface). There is deliberately no
/// loading / stale / offline state because the web source has none: the parent feeds an already-resolved
/// title, payload or error string, exactly as react re-renders the component with new props.
/// </summary>
public enum ResultPanelState
{
    /// <summary>A non-null payload resolved — render the indented JSON with a copy affordance (web green branch).</summary>
    Result,

    /// <summary>An error string is present — render it as danger text (web rose branch); takes precedence over a payload.</summary>
    Error,

    /// <summary>No payload and no error — render the friendly idle message, never a blank box (web idle branch).</summary>
    Idle,
}

/// <summary>
/// The inputs that drive one render of the surface — the native analogue of the web
/// <c>ResultPanelProps</c> (<c>{ title, data, error, idleMessage }</c> in
/// web/src/features/admin/components/devtools/ResultPanel.tsx). <see cref="Data"/> mirrors the web
/// <c>data?: unknown</c> (any payload or <see langword="null"/>); <see cref="Error"/> mirrors
/// <c>error?: string</c>; <see cref="IdleMessage"/> mirrors <c>idleMessage?: string</c> (the override for the
/// idle text). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Title">The caller-supplied (already-localized) header label (web <c>title</c>).</param>
/// <param name="Data">The resolved payload to render as JSON, or <see langword="null"/> (web <c>data</c>).</param>
/// <param name="Error">The error string, or <see langword="null"/> when there is none (web <c>error</c>).</param>
/// <param name="IdleMessage">An optional override for the idle text (web <c>idleMessage</c>).</param>
public sealed record ResultPanelInput(
    string Title,
    object? Data,
    string? Error,
    string? IdleMessage)
{
    /// <summary>An idle input carrying just a header label (no payload, no error) — the surface's resting input.</summary>
    public static ResultPanelInput Idle(string title, string? idleMessage = null) =>
        new(title ?? string.Empty, null, null, idleMessage);
}

/// <summary>
/// The fully projected, render-ready view for one set of inputs — the native analogue of the web
/// <c>ResultPanel</c> render output. Carries the chosen <see cref="State"/>, the resolved body strings, the
/// copy affordance (visible iff a payload resolved, mirroring the web <c>hasData</c> header rule even while
/// an error is shown), the semantic tint token for the container, and the Narrator names for the region and
/// the body live-region. Pure data — no WinUI types — so the projection is unit-tested headlessly.
/// </summary>
/// <param name="State">The mutually-exclusive render branch.</param>
/// <param name="Title">The header label shown verbatim (web title span).</param>
/// <param name="RegionName">The surface's Narrator name (the title, or a localized fallback when blank).</param>
/// <param name="BodyName">The Narrator name announced for the body live-region on each state change.</param>
/// <param name="ErrorMessage">The danger text, when <see cref="State"/> is <see cref="ResultPanelState.Error"/>.</param>
/// <param name="SerializedData">The indented JSON, when <see cref="State"/> is <see cref="ResultPanelState.Result"/>.</param>
/// <param name="IdleMessage">The resolved idle text, when <see cref="State"/> is <see cref="ResultPanelState.Idle"/>.</param>
/// <param name="HasCopyAction">True iff a payload resolved (web <c>data != null</c>) — drives the copy button.</param>
/// <param name="CopyValue">The clipboard payload for the copy button (the serialized JSON).</param>
/// <param name="CopyLabel">The localized idle copy-button label (web <c>common.copyButton.copy</c>).</param>
/// <param name="CopiedLabel">The localized post-copy label (web <c>common.copyButton.copied</c>).</param>
/// <param name="TintBrushKey">The semantic design-token key tinting the container for this state.</param>
/// <param name="TintOpacity">The opacity applied to <see cref="TintBrushKey"/> for the faint container wash.</param>
public sealed record ResultPanelDisplay(
    ResultPanelState State,
    string Title,
    string RegionName,
    string BodyName,
    string? ErrorMessage,
    string? SerializedData,
    string IdleMessage,
    bool HasCopyAction,
    string CopyValue,
    string CopyLabel,
    string CopiedLabel,
    string TintBrushKey,
    double TintOpacity);

/// <summary>
/// Pure projection from <see cref="ResultPanelInput"/> to the render-ready <see cref="ResultPanelDisplay"/> —
/// the native port of the web <c>ResultPanel</c> body in
/// web/src/features/admin/components/devtools/ResultPanel.tsx. It reproduces the web branch precedence
/// (<c>error ? … : hasData ? … : …</c>), serializes the payload exactly as the web does
/// (<c>JSON.stringify(data, null, 2)</c> → two-space-indented JSON), resolves every owned string through the
/// i18n facade, and selects the semantic container tint per state (the native analogue of
/// <c>bg-neon-red/5</c> / <c>bg-neon-green/5</c> / <c>bg-white/[0.02]</c>). No SI conversion applies — the
/// surface carries no measurements.
/// </summary>
public static class ResultPanelProjection
{
    /// <summary>Design-token key for the danger tint (web <c>bg-neon-red/5</c> + rose error text).</summary>
    public const string DangerBrushKey = "TsColorDangerBrush";

    /// <summary>Design-token key for the success tint shown with a payload (web <c>bg-neon-green/5</c>).</summary>
    public const string SuccessBrushKey = "TsColorSuccessBrush";

    /// <summary>Design-token key for the neutral idle tint (web <c>bg-white/[0.02]</c>).</summary>
    public const string NeutralBrushKey = "TsColorTextPrimaryBrush";

    /// <summary>Design-token key for the inset JSON surface (web <c>var(--surface-overlay)</c>).</summary>
    public const string OverlayBrushKey = "TsColorSurfaceGlassBrush";

    /// <summary>Container wash opacity for the error / result tints (faint, like the web <c>/5</c> alpha).</summary>
    public const double StateTintOpacity = 0.06;

    /// <summary>Container wash opacity for the neutral idle tint (the web <c>/[0.02]</c> alpha).</summary>
    public const double IdleTintOpacity = 0.03;

    private static readonly JsonSerializerOptions IndentedJson = new() { WriteIndented = true };

    /// <summary>Serialize <paramref name="data"/> to two-space-indented JSON (web <c>JSON.stringify(data, null, 2)</c>).</summary>
    public static string Serialize(object? data) =>
        JsonSerializer.Serialize(data, IndentedJson);

    /// <summary>Project <paramref name="input"/> into the render-ready display, resolving strings via <paramref name="localizer"/>.</summary>
    public static ResultPanelDisplay Project(ResultPanelInput input, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = input.Title ?? string.Empty;
        bool hasData = input.Data is not null;
        bool hasError = !string.IsNullOrEmpty(input.Error);

        // Mirror the web header rule: the copy affordance appears whenever a payload exists, even if an
        // error is also being shown in the body.
        string serialized = hasData ? Serialize(input.Data) : string.Empty;

        string copyLabel = localizer.GetString("common.copyButton.copy", "Copy");
        string copiedLabel = localizer.GetString("common.copyButton.copied", "Copied");
        string idleMessage = !string.IsNullOrEmpty(input.IdleMessage)
            ? input.IdleMessage!
            : localizer.GetString("featureView.resultPanel.noResult", "No result yet");

        string regionName = !string.IsNullOrEmpty(title)
            ? title
            : localizer.GetString("featureView.resultPanel.title", "Result");

        // Branch precedence exactly as the web component: error first, then a payload, then the idle surface.
        ResultPanelState state = hasError
            ? ResultPanelState.Error
            : hasData
                ? ResultPanelState.Result
                : ResultPanelState.Idle;

        (string bodyName, string tintKey, double tintOpacity) = state switch
        {
            ResultPanelState.Error => (input.Error!, DangerBrushKey, StateTintOpacity),
            ResultPanelState.Result => (
                localizer.GetString("featureView.resultPanel.resultReady", "Result ready"),
                SuccessBrushKey,
                StateTintOpacity),
            _ => (idleMessage, NeutralBrushKey, IdleTintOpacity),
        };

        return new ResultPanelDisplay(
            State: state,
            Title: title,
            RegionName: regionName,
            BodyName: bodyName,
            ErrorMessage: state == ResultPanelState.Error ? input.Error : null,
            SerializedData: state == ResultPanelState.Result ? serialized : null,
            IdleMessage: idleMessage,
            HasCopyAction: hasData,
            CopyValue: serialized,
            CopyLabel: copyLabel,
            CopiedLabel: copiedLabel,
            TintBrushKey: tintKey,
            TintOpacity: tintOpacity);
    }
}

/// <summary>
/// Canonical metadata for the ResultPanel surface. The web source is an anonymous devtools sub-component
/// (web/src/features/admin/components/devtools/ResultPanel.tsx) with no registry entry, so this carries only
/// the diagnostics <see cref="Slug"/> the P1/S11 contract emits with <c>view.opened</c>.
/// </summary>
public static class ResultPanelRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ResultPanel";
}

/// <summary>
/// PII-safe diagnostics for the ResultPanel surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the title, payload or error text — so a
/// diagnostics line can never leak a probe result. Thread-safe.
/// </summary>
public sealed class ResultPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ResultPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ResultPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ResultPanelRegistration.Slug}");
    }
}
