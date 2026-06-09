using System.Text;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive surface state for the <see cref="JwtDecoderViewModel"/> — the native union of the
/// branches the web <c>JwtDecoderTool</c> renders
/// (web/src/features/admin/components/devtools/tools/JwtDecoder.tsx). The web tool is a purely client-side,
/// synchronous utility: it reads the textarea, runs the decode inside a <c>useMemo</c>, and never touches the
/// network — so its visible states are the three below rather than the freshness chrome of a data widget.
/// <see cref="Idle"/> is the empty-input resting surface (web <c>!jwt.trim()</c> → no header, no payload, no
/// error — just the input). <see cref="Invalid"/> is the decode-failure surface (web <c>parts.length &lt; 2</c>
/// or a thrown <c>atob</c> / <c>JSON.parse</c> → the rose "Invalid Jwt" line). <see cref="Decoded"/> is the
/// success surface (web both parts parsed → the header and payload <c>ResultPanel</c>s). There is deliberately
/// no loading / stale / offline state because the web source has none: the decode resolves synchronously on
/// this device, exactly as the sibling client utilities (see <c>ClientUtilityToolState</c>) document.
/// </summary>
public enum JwtDecoderState
{
    /// <summary>The input is empty or whitespace — render just the input field (web <c>!jwt.trim()</c>).</summary>
    Idle,

    /// <summary>The token could not be decoded — render the "Invalid Jwt" message (web <c>error</c> branch).</summary>
    Invalid,

    /// <summary>Both segments decoded — render the header and payload result panels (web success branch).</summary>
    Decoded,
}

/// <summary>
/// The settled result of decoding one JWT string — the native analogue of the web <c>JwtDecoded</c> shape
/// (<c>{ header, payload, error? }</c> in web/src/features/admin/components/devtools/tools/JwtDecoder.tsx).
/// <see cref="Header"/> and <see cref="Payload"/> are the parsed segments (the web
/// <c>JSON.parse(atob(part))</c> values) or <see langword="null"/> when absent — a parsed JSON <c>null</c>
/// is normalized to <see langword="null"/> so a segment panel is shown only when the web <c>data != null</c>
/// guard would show it. Kept UI-free (no WinUI types) so the decode adapter is unit-tested headlessly.
/// </summary>
public sealed class JwtDecodeResult
{
    private JwtDecodeResult(JwtDecoderState state, JsonElement? header, JsonElement? payload)
    {
        State = state;
        Header = header;
        Payload = payload;
    }

    /// <summary>The chosen mutually-exclusive surface state.</summary>
    public JwtDecoderState State { get; }

    /// <summary>The decoded JWT header object, or <see langword="null"/> when absent (web <c>header</c>).</summary>
    public JsonElement? Header { get; }

    /// <summary>The decoded JWT payload object, or <see langword="null"/> when absent (web <c>payload</c>).</summary>
    public JsonElement? Payload { get; }

    /// <summary>The resting empty-input result (web <c>{ header: null, payload: null }</c>).</summary>
    public static JwtDecodeResult Idle { get; } = new(JwtDecoderState.Idle, null, null);

    /// <summary>The decode-failure result (web <c>{ header: null, payload: null, error }</c>).</summary>
    public static JwtDecodeResult Invalid { get; } = new(JwtDecoderState.Invalid, null, null);

    /// <summary>A successful decode carrying the parsed header and payload segments.</summary>
    /// <param name="header">The decoded header object, or <see langword="null"/>.</param>
    /// <param name="payload">The decoded payload object, or <see langword="null"/>.</param>
    public static JwtDecodeResult Decoded(JsonElement? header, JsonElement? payload) =>
        new(JwtDecoderState.Decoded, header, payload);
}

/// <summary>
/// The pure JWT decode adapter — the native port of the web <c>JwtDecoderTool</c>'s <c>useMemo</c> body
/// (web/src/features/admin/components/devtools/tools/JwtDecoder.tsx). It reproduces the web decode
/// branch-for-branch: a blank / whitespace token is <see cref="JwtDecodeResult.Idle"/> (web
/// <c>!jwt.trim()</c>); a token that splits into fewer than two dot-separated segments is
/// <see cref="JwtDecodeResult.Invalid"/> (web <c>parts.length &lt; 2</c>); otherwise the first two segments
/// are base64-decoded and JSON-parsed, and any failure is folded into <see cref="JwtDecodeResult.Invalid"/>
/// exactly as the web <c>try/catch</c> returns <c>{ error }</c>. The base64 step mirrors the browser
/// <c>atob</c> the web relies on — the standard base64 alphabet (so a base64url-only character such as
/// <c>-</c> or <c>_</c> fails the decode, just as <c>atob</c> throws) with ASCII whitespace ignored and
/// missing padding tolerated. The decoded bytes are read as UTF-8 (the JWT-spec encoding) before parsing, so
/// every all-ASCII token — the overwhelming norm — yields byte-identical data to the web. Kept UI-free so it
/// is unit-tested without a XAML host.
/// </summary>
public static class JwtDecoderCodec
{
    /// <summary>
    /// Decode <paramref name="jwt"/> into its settled <see cref="JwtDecodeResult"/>, mirroring the web
    /// <c>useMemo</c>: blank → idle, fewer than two segments → invalid, otherwise base64-decode + JSON-parse
    /// the header and payload segments, folding any failure into <see cref="JwtDecoderState.Invalid"/>.
    /// </summary>
    /// <param name="jwt">The raw JWT string from the input field.</param>
    public static JwtDecodeResult Decode(string? jwt)
    {
        if (string.IsNullOrWhiteSpace(jwt))
        {
            return JwtDecodeResult.Idle;
        }

        string[] parts = jwt.Split('.');
        if (parts.Length < 2)
        {
            return JwtDecodeResult.Invalid;
        }

        try
        {
            JsonElement header = ParseSegment(parts[0]);
            JsonElement payload = ParseSegment(parts[1]);
            return JwtDecodeResult.Decoded(NormalizeNull(header), NormalizeNull(payload));
        }
        catch (FormatException)
        {
            // A non-base64 segment — the native analogue of the web atob throwing.
            return JwtDecodeResult.Invalid;
        }
        catch (JsonException)
        {
            // A segment that decoded but is not valid JSON — the web JSON.parse throwing.
            return JwtDecodeResult.Invalid;
        }
    }

    private static JsonElement ParseSegment(string segment)
    {
        byte[] bytes = DecodeBase64(segment);
        string json = Encoding.UTF8.GetString(bytes);
        return JsonSerializer.Deserialize<JsonElement>(json);
    }

    // A parsed JSON `null` is treated as "absent" so a panel is shown only when the web `data != null`
    // guard (ResultPanel.tsx) would show it.
    private static JsonElement? NormalizeNull(JsonElement element) =>
        element.ValueKind == JsonValueKind.Null ? null : element;

    private static byte[] DecodeBase64(string segment)
    {
        // atob parity: strip the ASCII whitespace atob ignores, keep the standard base64 alphabet (so a
        // base64url-only `-`/`_` is rejected by Convert below exactly as atob throws), and tolerate missing
        // padding by re-padding to a multiple of four.
        var builder = new StringBuilder(segment.Length);
        foreach (char c in segment)
        {
            if (c is ' ' or '\t' or '\n' or '\r' or '\f')
            {
                continue;
            }

            builder.Append(c);
        }

        string cleaned = builder.ToString();
        int remainder = cleaned.Length % 4;
        if (remainder == 1)
        {
            // A length that can never be valid base64 — atob throws here too.
            throw new FormatException("Invalid base64 length.");
        }

        if (remainder != 0)
        {
            cleaned = cleaned.PadRight(cleaned.Length + (4 - remainder), '=');
        }

        return Convert.FromBase64String(cleaned);
    }
}

/// <summary>
/// The fully projected, render-ready view for one decode result — the native analogue of the web
/// <c>JwtDecoderTool</c> render output. Carries the chosen <see cref="State"/>, the localized
/// <see cref="ToolCard"/> chrome (title, description, accent glyph), the input field's label and example
/// token hint, the "Invalid Jwt" message for the failure branch, and the two segment
/// <see cref="ResultPanelInput"/>s the header / payload <see cref="ResultPanel"/>s bind to. Pure data — no
/// WinUI types — so the projection is unit-tested headlessly.
/// </summary>
/// <param name="State">The mutually-exclusive render branch.</param>
/// <param name="Title">The localized card title (web <c>t('Jwt Decoder')</c>).</param>
/// <param name="Description">The localized card description (web <c>t('Jwt Decoder Desc')</c>).</param>
/// <param name="Glyph">The Segoe Fluent key glyph for the card badge (web Lucide <c>KeyRound</c>).</param>
/// <param name="Accent">The card accent name (web <c>color="purple"</c>).</param>
/// <param name="InputLabel">The localized input label (web <c>t('Jwt Input')</c>).</param>
/// <param name="InputExample">The example token hint shown in the empty field (web literal).</param>
/// <param name="HasError">True when the failure message should be shown (web <c>decoded.error</c>).</param>
/// <param name="ErrorMessage">The localized "Invalid Jwt" message, or <see langword="null"/>.</param>
/// <param name="HasHeader">True when the header panel should be shown (web <c>decoded.header</c>).</param>
/// <param name="HeaderPanel">The header <see cref="ResultPanelInput"/> (title + decoded header data).</param>
/// <param name="HasPayload">True when the payload panel should be shown (web <c>decoded.payload</c>).</param>
/// <param name="PayloadPanel">The payload <see cref="ResultPanelInput"/> (title + decoded payload data).</param>
/// <param name="RegionName">The surface's Narrator name (the localized card title).</param>
/// <param name="StatusAnnouncement">The text announced to the live region on a state change, or null.</param>
public sealed record JwtDecoderDisplay(
    JwtDecoderState State,
    string Title,
    string Description,
    string Glyph,
    string Accent,
    string InputLabel,
    string InputExample,
    bool HasError,
    string? ErrorMessage,
    bool HasHeader,
    ResultPanelInput HeaderPanel,
    bool HasPayload,
    ResultPanelInput PayloadPanel,
    string RegionName,
    string? StatusAnnouncement);

/// <summary>
/// Pure projection from a <see cref="JwtDecodeResult"/> to the render-ready <see cref="JwtDecoderDisplay"/> —
/// the native port of the web <c>JwtDecoderTool</c> render in
/// web/src/features/admin/components/devtools/tools/JwtDecoder.tsx. It resolves every owned string through
/// the i18n facade using the web's natural keys (<c>t('Jwt Decoder')</c>, <c>t('Jwt Input')</c>, …), selects
/// the failure message only for the <see cref="JwtDecoderState.Invalid"/> branch, and composes the header /
/// payload segment inputs so each panel renders only when its segment is present (web <c>data != null</c>).
/// No SI conversion applies — the surface carries no measurements.
/// </summary>
public static class JwtDecoderProjection
{
    /// <summary>i18n key + English fallback for the card title (web <c>t('Jwt Decoder')</c>).</summary>
    public const string TitleKey = "Jwt Decoder";

    /// <summary>i18n key + English fallback for the card description (web <c>t('Jwt Decoder Desc')</c>).</summary>
    public const string DescriptionKey = "Jwt Decoder Desc";

    /// <summary>i18n key + English fallback for the input label (web <c>t('Jwt Input')</c>).</summary>
    public const string InputLabelKey = "Jwt Input";

    /// <summary>i18n key + English fallback for the failure message (web <c>t('Invalid Jwt')</c>).</summary>
    public const string ErrorKey = "Invalid Jwt";

    /// <summary>i18n key + English fallback for the header panel title (web <c>t('Jwt Header')</c>).</summary>
    public const string HeaderKey = "Jwt Header";

    /// <summary>i18n key + English fallback for the payload panel title (web <c>t('Jwt Payload')</c>).</summary>
    public const string PayloadKey = "Jwt Payload";

    /// <summary>Segoe Fluent "Permissions" key glyph standing in for the web Lucide <c>KeyRound</c> icon.</summary>
    public const string Glyph = "\uE192";

    /// <summary>The card accent name (web <c>color="purple"</c>); resolved by <see cref="ToolCardAccent"/>.</summary>
    public const string Accent = "purple";

    /// <summary>The example token hint shown in the empty input (web literal hint attribute).</summary>
    public const string ExampleToken = "eyJhbGciOiJSUzI1NiIs...";

    /// <summary>Project <paramref name="result"/> into the render-ready display, resolving strings via <paramref name="localizer"/>.</summary>
    /// <param name="result">The settled decode result to project.</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public static JwtDecoderDisplay Project(JwtDecodeResult result, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(result);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString(TitleKey, TitleKey);
        string description = localizer.GetString(DescriptionKey, DescriptionKey);
        string inputLabel = localizer.GetString(InputLabelKey, InputLabelKey);
        string headerTitle = localizer.GetString(HeaderKey, HeaderKey);
        string payloadTitle = localizer.GetString(PayloadKey, PayloadKey);

        bool invalid = result.State == JwtDecoderState.Invalid;
        string? error = invalid ? localizer.GetString(ErrorKey, ErrorKey) : null;

        object? headerData = result.Header is { } header ? header : null;
        object? payloadData = result.Payload is { } payload ? payload : null;

        return new JwtDecoderDisplay(
            State: result.State,
            Title: title,
            Description: description,
            Glyph: Glyph,
            Accent: Accent,
            InputLabel: inputLabel,
            InputExample: ExampleToken,
            HasError: invalid,
            ErrorMessage: error,
            HasHeader: headerData is not null,
            HeaderPanel: new ResultPanelInput(headerTitle, headerData, null, null),
            HasPayload: payloadData is not null,
            PayloadPanel: new ResultPanelInput(payloadTitle, payloadData, null, null),
            RegionName: title,
            StatusAnnouncement: invalid ? error : null);
    }
}

/// <summary>
/// Canonical metadata for the JwtDecoder surface — the native anchor for the web component at
/// web/src/features/admin/components/devtools/tools/JwtDecoder.tsx. The diagnostics <see cref="Slug"/> is the
/// stable surface name emitted with the <c>view.opened</c> event (P1/S11 diagnostics contract).
/// </summary>
public static class JwtDecoderRegistration
{
    /// <summary>The stable client-utility tool id this surface bodies (web <c>id: 'jwt'</c>).</summary>
    public const string ToolId = "jwt";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "JwtDecoder";
}

/// <summary>
/// PII-safe diagnostics for the JwtDecoder surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the token, its decoded header / payload
/// or any field value — so a diagnostics line can never leak a credential. Thread-safe.
/// </summary>
public sealed class JwtDecoderDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public JwtDecoderDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=JwtDecoder</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={JwtDecoderRegistration.Slug}");
    }
}
