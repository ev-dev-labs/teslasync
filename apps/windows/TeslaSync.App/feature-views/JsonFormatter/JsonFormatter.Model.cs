using System.Text.Encodings.Web;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive surface state for the <see cref="JsonFormatterViewModel"/>. JsonFormatter is a
/// purely client-side devtools tool (web/src/features/admin/components/devtools/tools/JsonFormatter.tsx is
/// driven entirely by the local <c>inputVal</c> state and a synchronous <c>useMemo</c>, with no hook beyond
/// <c>useTranslation</c>), so it has exactly the three render branches the web component has — chosen in the
/// same precedence the web <c>result</c> memo computes: <see cref="Empty"/> (the web
/// <c>!inputVal.trim()</c> guard — neither the error line nor the formatted block renders), <see cref="Error"/>
/// (the web <c>catch</c> branch — the rose error line) and <see cref="Formatted"/> (the web success branch —
/// the green pretty-printed block with a copy affordance). There is deliberately no loading / stale / offline
/// state because the source has none: the transform resolves synchronously on every keystroke, exactly as
/// react recomputes the memo when <c>inputVal</c> changes.
/// </summary>
public enum JsonFormatterState
{
    /// <summary>The input is blank or whitespace — render only the editor, no output (web <c>!inputVal.trim()</c>).</summary>
    Empty,

    /// <summary>The input parsed — render the two-space-indented JSON with a copy affordance (web success branch).</summary>
    Formatted,

    /// <summary>The input failed to parse — render the parser message as danger text (web <c>catch</c> branch).</summary>
    Error,
}

/// <summary>
/// The input that drives one render of the surface — the native analogue of the web component's local
/// <c>inputVal</c> state (web/src/features/admin/components/devtools/tools/JsonFormatter.tsx). The editor
/// writes a fresh value on every keystroke and the view-model re-projects, mirroring the web
/// <c>setInputVal</c> → <c>useMemo</c> recompute. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Text">The raw text currently in the editor (web <c>inputVal</c>).</param>
public sealed record JsonFormatterInput(string Text)
{
    /// <summary>The resting input — an empty editor (web initial <c>useState('')</c>).</summary>
    public static JsonFormatterInput Blank { get; } = new(string.Empty);

    /// <summary>Wrap <paramref name="text"/> as an input, coalescing <see langword="null"/> to the empty editor.</summary>
    public static JsonFormatterInput From(string? text) => new(text ?? string.Empty);
}

/// <summary>
/// The pure parse/format outcome — the native analogue of the web <c>result</c> object
/// (<c>{ formatted, error }</c>) the <c>useMemo</c> returns in
/// web/src/features/admin/components/devtools/tools/JsonFormatter.tsx. Exactly one of
/// <see cref="Formatted"/> / <see cref="Error"/> is non-empty for the non-<see cref="JsonFormatterState.Empty"/>
/// states; both are empty when the editor is blank. Kept UI-free so the transform is unit-tested without a
/// XAML host.
/// </summary>
/// <param name="State">The render branch this outcome selects.</param>
/// <param name="Formatted">The two-space-indented JSON when <see cref="State"/> is formatted, else empty.</param>
/// <param name="Error">The parser message when <see cref="State"/> is error, else empty.</param>
public sealed record JsonFormatResult(JsonFormatterState State, string Formatted, string Error)
{
    /// <summary>The resting outcome for a blank editor (no formatted payload, no error).</summary>
    public static JsonFormatResult Blank { get; } =
        new(JsonFormatterState.Empty, string.Empty, string.Empty);
}

/// <summary>
/// The fully projected, render-ready view for one editor value — the native analogue of the web
/// <c>JsonFormatterTool</c> render output. Carries the chosen <see cref="State"/>, the formatted payload and
/// error message (mutually exclusive, mirroring the web <c>{result.error}</c> / <c>{result.formatted}</c>
/// guards), and the Narrator name announced for the output region on each state change. Pure data — no WinUI
/// types — so the projection is unit-tested headlessly.
/// </summary>
/// <param name="State">The mutually-exclusive render branch.</param>
/// <param name="FormattedText">The indented JSON, when <see cref="State"/> is <see cref="JsonFormatterState.Formatted"/>.</param>
/// <param name="ErrorMessage">The parser message, when <see cref="State"/> is <see cref="JsonFormatterState.Error"/>.</param>
/// <param name="OutputName">The Narrator name announced for the output live-region on each state change.</param>
public sealed record JsonFormatterDisplay(
    JsonFormatterState State,
    string FormattedText,
    string ErrorMessage,
    string OutputName)
{
    /// <summary>True when the formatted block should render (web truthy <c>result.formatted</c>).</summary>
    public bool HasFormatted => State == JsonFormatterState.Formatted;

    /// <summary>True when the error line should render (web truthy <c>result.error</c>).</summary>
    public bool HasError => State == JsonFormatterState.Error;

    /// <summary>True when neither branch renders — the blank editor (web <c>!inputVal.trim()</c>).</summary>
    public bool IsEmpty => State == JsonFormatterState.Empty;
}

/// <summary>
/// Pure projection from a <see cref="JsonFormatterInput"/> to the render-ready <see cref="JsonFormatterDisplay"/>
/// — the native port of the web <c>JsonFormatterTool</c> body in
/// web/src/features/admin/components/devtools/tools/JsonFormatter.tsx. It reproduces the web <c>useMemo</c>
/// precedence (<c>!inputVal.trim()</c> → blank; <c>JSON.parse</c> then <c>JSON.stringify(parsed, null, 2)</c>
/// → formatted; <c>catch</c> → the error message), serializing exactly as the web does (two-space-indented
/// JSON, with JS-relaxed escaping so <c>&lt;</c> / <c>&gt;</c> / <c>&amp;</c> are not HTML-escaped the way the
/// .NET default encoder would). It resolves the localized fallback for a parser with no message and the
/// output region's Narrator name through the i18n facade. No SI conversion applies — the surface carries no
/// measurements.
/// </summary>
public static class JsonFormatterProjection
{
    /// <summary>The i18n key for the fallback error message (web <c>t('Invalid Json')</c>).</summary>
    public const string InvalidJsonKey = "Invalid Json";

    /// <summary>The English fallback for the invalid-JSON message (web translation default).</summary>
    public const string InvalidJsonFallback = "Invalid Json";

    /// <summary>The untranslated example shown in the empty editor — the web tool's literal editor hint.</summary>
    public const string InputExample = "{\"key\":\"value\"}";

    /// <summary>Design-token key for the inset formatted surface (web <c>var(--surface-overlay)</c>).</summary>
    public const string OverlayBrushKey = "TsColorSurfaceGlassBrush";

    /// <summary>Design-token key for the formatted JSON text (web <c>text-emerald-300</c>, the valid/success accent).</summary>
    public const string FormattedBrushKey = "TsColorSuccessBrush";

    /// <summary>Design-token key for the error line (web <c>text-rose-300</c>).</summary>
    public const string ErrorBrushKey = "TsColorDangerBrush";

    // Match the web JSON.stringify(parsed, null, 2): two-space indentation (System.Text.Json's default) and
    // the relaxed JavaScript encoder so '<', '>', '&', '+' and quotes are emitted verbatim rather than as
    // Unicode escapes — the .NET default HTML-safe encoder would otherwise drift from JSON.stringify output.
    private static readonly JsonSerializerOptions IndentedJson = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>
    /// Parse and pretty-print <paramref name="text"/> the way the web <c>useMemo</c> does: a blank or
    /// whitespace-only value yields the empty outcome (web <c>!inputVal.trim()</c>); a value that parses is
    /// re-emitted as two-space-indented JSON (web <c>JSON.stringify(JSON.parse(inputVal), null, 2)</c>); a
    /// value that fails to parse yields the parser message, or <paramref name="invalidFallback"/> when the
    /// parser produced none (web <c>e instanceof Error ? e.message : t('Invalid Json')</c>).
    /// </summary>
    /// <param name="text">The raw editor value (web <c>inputVal</c>).</param>
    /// <param name="invalidFallback">The localized fallback message used when the parser has no message.</param>
    public static JsonFormatResult Compute(string? text, string invalidFallback)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return JsonFormatResult.Blank;
        }

        try
        {
            using var document = JsonDocument.Parse(text);
            // System.Text.Json emits the platform newline for indentation; normalize to '\n' so the output is
            // byte-identical to the web JSON.stringify(parsed, null, 2), which always uses '\n', on every OS.
            // Only structural newlines are affected — control characters inside string values are escaped as
            // '\r' / '\n' sequences rather than raw bytes, so payload content is never altered.
            string formatted = JsonSerializer.Serialize(document.RootElement, IndentedJson)
                .Replace("\r\n", "\n", StringComparison.Ordinal);
            return new JsonFormatResult(JsonFormatterState.Formatted, formatted, string.Empty);
        }
        catch (JsonException ex)
        {
            string message = string.IsNullOrWhiteSpace(ex.Message) ? invalidFallback : ex.Message;
            return new JsonFormatResult(JsonFormatterState.Error, string.Empty, message);
        }
    }

    /// <summary>Project <paramref name="input"/> into the render-ready display, resolving strings via <paramref name="localizer"/>.</summary>
    /// <param name="input">The current editor value to project.</param>
    /// <param name="localizer">The i18n facade resolving the fallback message and the output Narrator name.</param>
    public static JsonFormatterDisplay Project(JsonFormatterInput input, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(localizer);

        // Resolve the fallback unconditionally, mirroring the web component which always evaluates
        // t('Invalid Json') so the key is part of the render regardless of the branch taken.
        string invalidFallback = localizer.GetString(InvalidJsonKey, InvalidJsonFallback);
        JsonFormatResult result = Compute(input.Text, invalidFallback);

        string outputName = result.State switch
        {
            JsonFormatterState.Error => result.Error,
            JsonFormatterState.Formatted =>
                localizer.GetString("featureView.jsonFormatter.formattedReady", "JSON formatted"),
            _ => localizer.GetString("featureView.jsonFormatter.idle", "Enter JSON to format"),
        };

        return new JsonFormatterDisplay(result.State, result.Formatted, result.Error, outputName);
    }
}

/// <summary>
/// Canonical metadata for the JsonFormatter surface. The web source is an anonymous devtools tool
/// (web/src/features/admin/components/devtools/tools/JsonFormatter.tsx) registered only by id in the
/// <c>useToolList</c> catalog, so this carries the diagnostics <see cref="Slug"/> the P1/S11 contract emits
/// with <c>view.opened</c>.
/// </summary>
public static class JsonFormatterRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "JsonFormatter";
}

/// <summary>
/// PII-safe diagnostics for the JsonFormatter surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the editor value, the formatted payload
/// or any parser message — so a diagnostics line can never leak the content a user pasted. Thread-safe.
/// </summary>
public sealed class JsonFormatterDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public JsonFormatterDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=JsonFormatter</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={JsonFormatterRegistration.Slug}");
    }
}
