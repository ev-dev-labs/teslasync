using System.Security.Cryptography;
using System.Text;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="HashCalculatorViewModel"/> can be in — the native union of the surfaces
/// the web <c>HashCalculator</c> tool renders
/// (web/src/features/admin/components/devtools/tools/HashCalculator.tsx). The web tool is a purely local,
/// on-device computation (<c>crypto.subtle.digest('SHA-256', …)</c> over a <c>TextEncoder</c> buffer) with
/// no fetch, cache or data source, so its visible branches are the four below rather than the freshness
/// chrome of a read surface: <see cref="Empty"/> (no hash computed yet — the web renders the card with no
/// result block), <see cref="Computing"/> (the web <c>computing</c> flag — the Compute button shows a
/// progress ring), <see cref="Computed"/> (the web <c>hashResult</c> hex — the monospace result row with a
/// copy affordance) and <see cref="Failed"/> (the web <c>catch</c> branch — the localized "Hash Error"
/// message). Because the digest is computed synchronously on this device, the stale and offline freshness
/// states of a network read do not exist here; the web source has none.
/// </summary>
public enum HashCalculatorState
{
    /// <summary>No hash has been computed yet — render the card + Compute button with a friendly idle result line.</summary>
    Empty,

    /// <summary>A digest is in flight — the Compute button shows a progress ring and is disabled (web <c>computing</c>).</summary>
    Computing,

    /// <summary>The digest settled successfully — the lowercase SHA-256 hex result row with a copy affordance.</summary>
    Computed,

    /// <summary>The digest threw — render the localized "Hash Error" message (web <c>catch</c> branch).</summary>
    Failed,
}

/// <summary>
/// The settled result of one hash run — the native mirror of the value the web tool stores in
/// <c>hashResult</c>: either the computed lowercase SHA-256 hex string (success) or a fault marker (the web
/// <c>catch</c> that sets <c>hashResult = t('Hash Error')</c>). Kept pure — no WinUI types — so the
/// success/failure classification is unit-tested without a UI host.
/// </summary>
/// <param name="Ok">Whether the digest computed successfully.</param>
/// <param name="Hash">The lowercase SHA-256 hex on success, otherwise null.</param>
public sealed record HashCalculatorOutcome(bool Ok, string? Hash)
{
    /// <summary>A successful outcome carrying the lowercase SHA-256 hex digest.</summary>
    /// <param name="hash">The lowercase hex digest.</param>
    public static HashCalculatorOutcome Succeeded(string hash) => new(true, hash);

    /// <summary>A failed outcome (the web <c>catch</c> that surfaces the localized "Hash Error" line).</summary>
    public static HashCalculatorOutcome Faulted() => new(false, null);
}

/// <summary>
/// Pure SHA-256 helpers, kept UI-free so they are unit-tested against fixed vectors without a XAML host. The
/// digest matches the web tool exactly (web/src/features/admin/components/devtools/tools/HashCalculator.tsx):
/// the input is UTF-8 encoded (web <c>new TextEncoder().encode(inputVal)</c>), hashed with SHA-256 (web
/// <c>crypto.subtle.digest('SHA-256', …)</c>) and rendered as a lowercase, zero-padded hex string (web
/// <c>Array.from(bytes).map(b =&gt; b.toString(16).padStart(2, '0')).join('')</c>).
/// </summary>
public static class HashCalculatorFormat
{
    /// <summary>
    /// Compute the lowercase SHA-256 hex digest of <paramref name="input"/> exactly as the web tool does
    /// (UTF-8 bytes → SHA-256 → lowercase hex). A null input is treated as the empty string.
    /// </summary>
    /// <param name="input">The text to hash (web <c>inputVal</c>).</param>
    public static string Sha256Hex(string? input)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(input ?? string.Empty);
        byte[] digest = SHA256.HashData(bytes);
        return Convert.ToHexStringLower(digest);
    }
}

/// <summary>
/// Canonical metadata for the HashCalculator surface — the native anchor for the web tool at
/// web/src/features/admin/components/devtools/tools/HashCalculator.tsx. The diagnostics <see cref="Slug"/> is
/// the stable surface name emitted with the <c>view.opened</c> event (P1/S11 diagnostics contract); the
/// localized <see cref="Title(ILocalizer)"/> / <see cref="Description(ILocalizer)"/> back the surface's
/// Narrator name and the card header (web <c>ToolCard title</c> / <c>description</c>). <see cref="Glyph"/> is
/// the Segoe Fluent code point standing in for the web Lucide <c>Hash</c> icon, and <see cref="AccentBrushKey"/>
/// is the semantic design token standing in for the web Tailwind neon colour (web <c>color="red"</c> →
/// <c>ICON_COLOR_MAP.red</c>; no ad-hoc hex in the control layer).
/// </summary>
public static class HashCalculatorRegistration
{
    /// <summary>Stable kebab-case surface id.</summary>
    public const string Id = "hash-calculator";

    /// <summary>Surface category (the web dev-tools live under the admin feature).</summary>
    public const string Category = "admin";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "HashCalculator";

    /// <summary>Segoe Fluent header glyph standing in for the web Lucide <c>Hash</c> icon.</summary>
    public const string Glyph = "\uE8EF";

    /// <summary>Semantic accent token key for the header glyph tint (web Tailwind <c>red</c>).</summary>
    public const string AccentBrushKey = "TsColorDangerBrush";

    /// <summary>Localized card title (web <c>t('Hash Calculator')</c>).</summary>
    /// <param name="localizer">The i18n facade resolving the label.</param>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Hash Calculator", "Hash Calculator");
    }

    /// <summary>Localized card description (web <c>t('Hash Calculator Desc')</c>).</summary>
    /// <param name="localizer">The i18n facade resolving the label.</param>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Hash Calculator Desc", "Hash Calculator Desc");
    }
}

/// <summary>
/// PII-safe diagnostics for the HashCalculator surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the input text or the computed digest —
/// so a diagnostics line can never leak operator data. Thread-safe.
/// </summary>
public sealed class HashCalculatorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public HashCalculatorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=HashCalculator</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={HashCalculatorRegistration.Slug}");
    }
}
