namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive surface state for the <see cref="UuidGeneratorViewModel"/> — the native union of
/// the surfaces the web <c>UuidGeneratorTool</c> renders
/// (web/src/features/admin/components/devtools/tools/UuidGenerator.tsx). The web tool is a purely client-side
/// surface: its only hook is <c>useTranslation</c> and it holds a single <c>useState&lt;string[]&gt;([])</c>,
/// generating values synchronously from <c>safeRandomUUID()</c> with no network read. It therefore has only
/// two states — the generated-id list (<see cref="Ready"/>, the web <c>{uuids.length &gt; 0 &amp;&amp; …}</c>
/// rows) and the no-result surface (<see cref="Empty"/>, before the first generate, where the web renders
/// nothing below the button). There is deliberately no loading / error / stale / offline state because the
/// web source has none (generation cannot fault and never touches the network), exactly as the sibling
/// <c>ColorConverter</c> and <c>Base64Tool</c> surfaces document.
/// </summary>
public enum UuidGeneratorState
{
    /// <summary>No UUID has been generated yet — render the friendly empty surface, never a blank box.</summary>
    Empty,

    /// <summary>At least one UUID exists — render the capped, newest-first list (web <c>{uuids…}</c>).</summary>
    Ready,
}

/// <summary>
/// The UUID generation seam backing the <see cref="UuidGeneratorViewModel"/> (P1/S8 state-holder dependency)
/// — the native analogue of the web tool's <c>safeRandomUUID()</c> call
/// (web/src/lib/safeUUID.ts). Routing generation through a seam keeps the view-model deterministically
/// testable (a fake can return a fixed sequence) while the app uses the platform's cryptographic generator.
/// </summary>
public interface IUuidFactory
{
    /// <summary>Produce a fresh RFC 4122 version-4 UUID as a lowercase, hyphenated 8-4-4-4-12 string.</summary>
    string NewUuid();
}

/// <summary>
/// The default <see cref="IUuidFactory"/> — the native-idiomatic equivalent of the web
/// <c>safeRandomUUID()</c> helper. The web helper exists only to work around browsers gating
/// <c>crypto.randomUUID</c> behind a secure context (it is <c>undefined</c> over a LAN IP / custom HTTP
/// hostname), falling back to <c>crypto.getRandomValues</c> and then <c>Math.random</c>. That constraint
/// does not exist in a native .NET app: <see cref="Guid.NewGuid"/> always yields a cryptographically strong
/// RFC 4122 §4.4 version-4 GUID, so no fallback ladder is needed. Formatting with <c>"D"</c> produces the
/// same canonical lowercase hyphenated shape the web emits.
/// </summary>
public sealed class GuidUuidFactory : IUuidFactory
{
    /// <summary>The shared, stateless singleton.</summary>
    public static GuidUuidFactory Instance { get; } = new();

    /// <inheritdoc />
    public string NewUuid() => Guid.NewGuid().ToString("D");
}

/// <summary>
/// Pure RFC 4122 version-4 UUID format validation — kept UI-free so the generator's contract (and the
/// web-parity shape: lowercase, hyphenated 8-4-4-4-12, version nibble <c>4</c>, variant nibble in
/// <c>8..b</c>) is asserted without a UI host. Matches the structure produced by both the web
/// <c>safeRandomUUID()</c> constructed branch and <see cref="GuidUuidFactory"/>.
/// </summary>
public static class UuidFormat
{
    /// <summary>The canonical length of a hyphenated UUID (32 hex digits + 4 hyphens).</summary>
    public const int Length = 36;

    /// <summary>True when <paramref name="value"/> is a canonical RFC 4122 version-4 UUID string.</summary>
    /// <param name="value">The candidate UUID string (case-insensitive hex).</param>
    public static bool IsV4(string? value)
    {
        if (value is null || value.Length != Length)
        {
            return false;
        }

        for (int i = 0; i < Length; i++)
        {
            char c = value[i];
            bool isSeparator = i is 8 or 13 or 18 or 23;
            if (isSeparator)
            {
                if (c != '-')
                {
                    return false;
                }
            }
            else if (!IsHex(c))
            {
                return false;
            }
        }

        if (value[14] != '4')
        {
            return false;
        }

        char variant = char.ToLowerInvariant(value[19]);
        return variant is '8' or '9' or 'a' or 'b';
    }

    private static bool IsHex(char c) =>
        c is (>= '0' and <= '9') or (>= 'a' and <= 'f') or (>= 'A' and <= 'F');
}

/// <summary>
/// Pure projection of the web tool's history update — the native port of
/// <c>setUuids((prev) =&gt; [uuid, ...prev].slice(0, 10))</c>
/// (web/src/features/admin/components/devtools/tools/UuidGenerator.tsx). It prepends the new value and caps
/// the list at <paramref name="max"/>, newest first, returning a fresh immutable list so the previous one is
/// never mutated. UI-free so the capping/ordering is verified row-for-row without a XAML host.
/// </summary>
public static class UuidHistory
{
    /// <summary>
    /// Prepend <paramref name="next"/> to <paramref name="previous"/> (newest first) and truncate to
    /// <paramref name="max"/> entries — the web <c>[uuid, ...prev].slice(0, max)</c>. A non-positive
    /// <paramref name="max"/> yields an empty list.
    /// </summary>
    /// <param name="previous">The existing newest-first history (not mutated).</param>
    /// <param name="next">The newly generated value to place at the front.</param>
    /// <param name="max">The maximum number of entries to retain.</param>
    public static IReadOnlyList<string> Prepend(IReadOnlyList<string> previous, string next, int max)
    {
        ArgumentNullException.ThrowIfNull(previous);
        ArgumentNullException.ThrowIfNull(next);

        if (max <= 0)
        {
            return Array.Empty<string>();
        }

        int capacity = Math.Min(previous.Count + 1, max);
        var result = new List<string>(capacity) { next };
        for (int i = 0; i < previous.Count && result.Count < max; i++)
        {
            result.Add(previous[i]);
        }

        return result;
    }
}

/// <summary>
/// Canonical registry metadata for the UUID generator surface — the native anchor for the web tool at
/// web/src/features/admin/components/devtools/tools/UuidGenerator.tsx, matching the <c>uuid</c> entry the
/// sibling <c>ClientUtilityToolSource</c> catalog already registers. The diagnostics <see cref="Slug"/> is
/// the stable surface identifier emitted with the <c>view.opened</c> event (P1/S11 diagnostics contract);
/// <see cref="Glyph"/> is the Segoe Fluent code point standing in for the web Lucide <c>Fingerprint</c> icon;
/// <see cref="AccentBrushKey"/> / <see cref="AccentColorKey"/> are the semantic design tokens standing in for
/// the web Tailwind neon-purple colour (web <c>color="purple"</c> / <c>ICON_COLOR_MAP</c>);
/// <see cref="MaxHistory"/> is the web <c>slice(0, 10)</c> cap.
/// </summary>
public static class UuidGeneratorRegistration
{
    /// <summary>Stable tool id (web <c>id: 'uuid'</c>).</summary>
    public const string Id = "uuid";

    /// <summary>Surface category (the web devtools "client utilities" group).</summary>
    public const string Category = "devtools";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "UuidGenerator";

    /// <summary>Segoe Fluent "Fingerprint" glyph — the native stand-in for the web Lucide <c>Fingerprint</c> icon.</summary>
    public const string Glyph = "\uE8D7";

    /// <summary>Semantic accent brush token (purple) for the header glyph — the web neon-purple <c>ICON_COLOR_MAP</c> entry.</summary>
    public const string AccentBrushKey = "TsColorAccentBrush";

    /// <summary>Semantic accent colour token (purple) backing the tinted icon chip fill / ring.</summary>
    public const string AccentColorKey = "TsColorAccentColor";

    /// <summary>The history cap (web <c>slice(0, 10)</c>).</summary>
    public const int MaxHistory = 10;
}

/// <summary>
/// PII-safe diagnostics for the UUID generator surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a generated UUID — so a diagnostics
/// line can never leak a value the operator produced. Thread-safe.
/// </summary>
public sealed class UuidGeneratorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public UuidGeneratorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=UuidGenerator</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={UuidGeneratorRegistration.Slug}");
    }
}
