using System.Globalization;

namespace TeslaSync.App.SharedSurfaces.MaskedValueSurface;

/// <summary>
/// Canonical metadata + i18n keys for the <c>MaskedValue</c> shared surface — the native mirror of the web
/// privacy primitive (web/src/components/ui/MaskedValue.tsx). The web component renders a sensitive string in
/// masked form by default with a click-to-reveal eye toggle, an optional copy affordance that always copies the
/// cleartext, a 30-second auto-hide after a reveal, and an opt-in fire-and-forget reveal audit. This metadata
/// carries the diagnostics slug the surface registers under, the auto-hide lifetime (web
/// <c>DEFAULT_AUTO_HIDE_MS = 30_000</c>), the reveal-audit payload shape (web <c>postRevealAudit</c>) and every
/// render-contract i18n key/fallback the web source passes to <c>t()</c>, so the native surface reproduces the
/// web copy verbatim. Every key carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects
/// and resolves against the English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class MaskedValueRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "MaskedValue";

    /// <summary>
    /// The auto-hide lifetime in milliseconds — how long a revealed value stays visible before it is re-masked
    /// (web <c>DEFAULT_AUTO_HIDE_MS = 30_000</c>). The timing itself is a view concern (a one-shot timer in the
    /// WinUI host), but the value is pinned here so it stays web-verbatim and is asserted headlessly.
    /// </summary>
    public const int DefaultAutoHideMs = 30_000;

    /// <summary>i18n key for the hide-toggle label shown while revealed (web <c>mask.hide</c>).</summary>
    public const string HideKey = "translation.mask.hide";

    /// <summary>English fallback for <see cref="HideKey"/> (web second arg, verbatim).</summary>
    public const string HideFallback = "Hide value";

    /// <summary>i18n key for the reveal-toggle label shown while masked (web <c>mask.reveal</c>).</summary>
    public const string RevealKey = "translation.mask.reveal";

    /// <summary>English fallback for <see cref="RevealKey"/> (web second arg, verbatim).</summary>
    public const string RevealFallback = "Reveal value";

    /// <summary>i18n key for the copy affordance's accessible name (web <c>mask.copy</c>).</summary>
    public const string CopyKey = "translation.mask.copy";

    /// <summary>English fallback for <see cref="CopyKey"/> (web second arg, verbatim).</summary>
    public const string CopyFallback = "Copy value";

    /// <summary>The reveal-audit kind recorded on each opt-in reveal (web <c>kind: 'masked_reveal'</c>).</summary>
    public const string AuditKind = "masked_reveal";

    /// <summary>The reveal-audit endpoint the host POSTs to (web <c>apiUrl('/audit/reveal')</c>).</summary>
    public const string AuditPath = "/audit/reveal";

    /// <summary>The auto-hide lifetime as a <see cref="TimeSpan"/> (web 30 000 ms), for the view's one-shot timer.</summary>
    public static TimeSpan DefaultAutoHide => TimeSpan.FromMilliseconds(DefaultAutoHideMs);
}

/// <summary>
/// The masking strategy — the native port of the web <c>MaskVariant</c> union
/// (web/src/lib/maskValue.ts: <c>'token' | 'vin' | 'coords' | 'email' | 'generic'</c>). Distinct from the
/// atomic <c>TeslaSync.App.Core.MaskVariant</c> so this surface reproduces the web variant set exactly,
/// including <see cref="Coords"/> and <see cref="Generic"/>.
/// </summary>
public enum MaskedValueVariant
{
    /// <summary>Opaque API/auth tokens — a fixed 12-bullet run plus the last few characters (web <c>token</c>).</summary>
    Token,

    /// <summary>Tesla 17-char VIN — the 3-char WMI prefix plus a bulleted serial (web <c>vin</c>).</summary>
    Vin,

    /// <summary>A <c>lat,lng</c> pair rendered as whole-degree-only bullets (web <c>coords</c>).</summary>
    Coords,

    /// <summary>An email whose local part is masked while the domain stays visible (web <c>email</c>).</summary>
    Email,

    /// <summary>A bullet run to length with an optional visible suffix (web <c>generic</c>).</summary>
    Generic,
}

/// <summary>
/// UI-free masking projection — the native port of the pure helpers in <c>web/src/lib/maskValue.ts</c>
/// (<c>maskFor</c> and its per-variant strategies). <see cref="Mask"/> is total: it never throws, even on
/// empty input or an unexpected variant (treated as <see cref="MaskedValueVariant.Generic"/>), so callers can
/// wrap render paths in it without null checks. Empty input projects to the empty string (matching web
/// <c>maskFor</c>); the em-dash shown for a missing value is the surface's render concern, applied by the
/// view-model, exactly as the web component (not <c>maskFor</c>) renders the em-dash. This is the surface's
/// data adapter and is unit-tested without a XAML host.
/// </summary>
public static class MaskedValueProjection
{
    private const char Bullet = '\u2022';
    private const string Separator = ", ";
    private const int TokenBulletRun = 12;
    private const int VinPrefixLength = 3;
    private const int VinMinLength = 11;

    /// <summary>The missing-value glyph the surface renders for an empty value (web em-dash, U+2014).</summary>
    public const string EmDash = "\u2014";

    /// <summary>
    /// The default number of trailing characters left visible per variant when the caller does not override
    /// <c>showLast</c> (web <c>DEFAULT_SHOW_LAST</c>). The defaults err on the side of less-visible.
    /// </summary>
    public static int DefaultShowLast(MaskedValueVariant variant) => variant switch
    {
        MaskedValueVariant.Token => 4,
        MaskedValueVariant.Vin => 4,
        MaskedValueVariant.Coords => 0,
        MaskedValueVariant.Email => 1,
        _ => 0,
    };

    /// <summary>
    /// The wire identifier for the variant — the literal the web source passes to the reveal audit
    /// (web <c>postRevealAudit(variant)</c> where <c>variant</c> is the union string). Lower-case, matching
    /// the web union members.
    /// </summary>
    public static string WireName(MaskedValueVariant variant) => variant switch
    {
        MaskedValueVariant.Token => "token",
        MaskedValueVariant.Vin => "vin",
        MaskedValueVariant.Coords => "coords",
        MaskedValueVariant.Email => "email",
        _ => "generic",
    };

    /// <summary>
    /// Return the user-visible masked representation of <paramref name="value"/> (web <c>maskFor</c>). Pure and
    /// total; a null value and an empty value both project to the empty string, and an unknown variant is
    /// treated as <see cref="MaskedValueVariant.Generic"/>.
    /// </summary>
    /// <param name="value">The raw sensitive value.</param>
    /// <param name="variant">The masking strategy.</param>
    /// <param name="showLast">Optional override of the variant's default visible-suffix length.</param>
    public static string Mask(string? value, MaskedValueVariant variant, int? showLast = null)
    {
        if (value is null)
        {
            return string.Empty;
        }

        int last = showLast ?? DefaultShowLast(variant);
        return variant switch
        {
            MaskedValueVariant.Token => MaskToken(value, last),
            MaskedValueVariant.Vin => MaskVin(value, last),
            MaskedValueVariant.Coords => MaskCoords(value),
            MaskedValueVariant.Email => MaskEmail(value, last),
            _ => MaskGeneric(value, last),
        };
    }

    private static string Bullets(int count) => count <= 0 ? string.Empty : new string(Bullet, count);

    private static string LastChars(string value, int visible) =>
        visible <= 0 ? string.Empty : value.Substring(value.Length - visible);

    private static string MaskGeneric(string value, int showLast)
    {
        if (value.Length == 0)
        {
            return string.Empty;
        }

        int visible = Math.Clamp(showLast, 0, value.Length);
        int hidden = value.Length - visible;
        return Bullets(hidden) + LastChars(value, visible);
    }

    private static string MaskToken(string value, int showLast)
    {
        if (value.Length == 0)
        {
            return string.Empty;
        }

        int visible = Math.Clamp(showLast, 0, value.Length);

        // A fixed-length bullet run so the masked form never leaks the original length: a 16-char token and a
        // 64-char token must look the same when masked (web maskToken).
        return Bullets(TokenBulletRun) + LastChars(value, visible);
    }

    private static string MaskVin(string value, int showLast)
    {
        if (value.Length == 0)
        {
            return string.Empty;
        }

        // A real Tesla VIN is 17 chars; expose the 3-char WMI plus the last few. A short input almost certainly
        // is not a VIN, so fall back to a fully-bulleted mask rather than leak its prefix (web maskVin).
        if (value.Length >= VinMinLength)
        {
            int visibleSuffix = Math.Clamp(showLast, 0, value.Length - VinPrefixLength);
            int hidden = value.Length - VinPrefixLength - visibleSuffix;
            string serial = Bullets(hidden) + LastChars(value, visibleSuffix);
            return string.Concat(value.AsSpan(0, VinPrefixLength), serial);
        }

        return Bullets(value.Length);
    }

    private static string MaskEmail(string value, int showLast)
    {
        int at = value.IndexOf('@', StringComparison.Ordinal);
        if (at <= 0)
        {
            return MaskGeneric(value, Math.Max(showLast, 0));
        }

        string local = value.Substring(0, at);
        string domain = value.Substring(at);
        int visible = Math.Clamp(showLast, 0, local.Length);
        string masked = string.Concat(local.AsSpan(0, visible), Bullets(Math.Max(local.Length - visible, 1)));
        return masked + domain;
    }

    private static string MaskCoords(string value)
    {
        string trimmed = value.Trim();
        if (trimmed.Length == 0)
        {
            return string.Empty;
        }

        string[] rawParts = trimmed.Split(',');
        var parts = new List<string>(rawParts.Length);
        foreach (string raw in rawParts)
        {
            string part = raw.Trim();
            if (part.Length > 0)
            {
                parts.Add(part);
            }
        }

        if (parts.Count == 0)
        {
            return string.Empty;
        }

        foreach (string part in parts)
        {
            if (!IsFiniteNumber(part))
            {
                return MaskGeneric(trimmed, 0);
            }
        }

        // Round every component to whole-degree-only context (hundreds of km of uncertainty): `••.•••`.
        string maskedPart = new string(Bullet, 2) + "." + new string(Bullet, 3);
        var maskedParts = new string[parts.Count];
        for (int i = 0; i < parts.Count; i++)
        {
            maskedParts[i] = maskedPart;
        }

        return string.Join(Separator, maskedParts);
    }

    private static bool IsFiniteNumber(string token) =>
        double.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out double value)
        && !double.IsNaN(value)
        && !double.IsInfinity(value);
}

/// <summary>
/// PII-safe diagnostics for the masked-value surface (P1/S11 diagnostics contract). The masked value is
/// caller-supplied sensitive content (tokens, VINs, coordinates, emails) and is NEVER recorded; the collector
/// emits ONLY the operational <see cref="RecordViewOpened"/> open event with the surface slug. The reveal
/// audit itself is a silent, fire-and-forget side effect (web <c>postRevealAudit</c> swallows every error), so
/// it intentionally produces no diagnostic of its own. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class MaskedValueDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public MaskedValueDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=MaskedValue</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(CultureInfo.InvariantCulture, $"view.opened slug={MaskedValueRegistration.Slug}"));
    }
}
