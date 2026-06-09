using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="UnixPermissionToolViewModel"/> can be in — the native union of the
/// surfaces the web <c>UnixPermissionTool</c> renders
/// (web/src/features/admin/components/devtools/tools/UnixPermissionTool.tsx). The web surface is a pure
/// client-side calculator: its only "data source" is <c>useTranslation</c> and a synchronous
/// <c>useMemo</c> over the typed octal mode — there is no query, no cache and no network. Its single
/// conditional render branch is <c>{symbolic &amp;&amp; (…)}</c>, where <c>symbolic</c> is <c>null</c> for
/// any value that is not exactly three octal digits and the nine-character permission string otherwise.
/// So this surface has exactly the two states below, not the freshness chrome of a cache-then-network
/// read widget:
/// <list type="bullet">
///   <item><see cref="Empty"/> — the web <c>symbolic === null</c> branch: no valid three-digit octal yet,
///   so the inputs render with no breakdown grid. The native view fills that region with a friendly empty
///   hint so it is never a blank box.</item>
///   <item><see cref="Resolved"/> — the web truthy-<c>symbolic</c> branch: a valid octal mode, so the
///   owner / group / other breakdown grid and the copyable symbolic string render.</item>
/// </list>
/// The data-widget freshness states do not exist here and are intentionally absent: <b>loading</b> (the
/// projection is synchronous and instant — there is nothing to await), <b>error</b> (the only failure is a
/// malformed octal, which the web folds into <see cref="Empty"/> exactly like an empty field; the view
/// adds a non-blocking validity affordance for screen readers), and <b>stale</b> / <b>offline</b> (there
/// is no fetched or cached value and no connectivity dependency, so a freshness window is meaningless).
/// This mirrors the way the sibling <c>ByteSizeConverter</c> documents why a pure-calculator surface has a
/// different state union than a read surface.
/// </summary>
public enum UnixPermissionState
{
    /// <summary>No valid three-digit octal — render the inputs and a friendly empty hint, no breakdown grid.</summary>
    Empty,

    /// <summary>A valid octal mode was entered — render the owner / group / other grid and the symbolic string.</summary>
    Resolved,
}

/// <summary>
/// The octal-digit → symbolic-triad lookup — the native mirror of the web <c>PERMS</c> constant
/// (web/src/features/admin/components/devtools/constants.ts). Each octal digit (0–7) maps to its
/// three-character <c>rwx</c> triad; the value is a dimensionless data label (not translated in the web
/// source), so the triads are kept verbatim rather than routed through the i18n facade.
/// </summary>
public static class PermissionMap
{
    /// <summary>The triad returned for a digit outside 0–7 (the web <c>PERMS[d] ?? '---'</c> fallback).</summary>
    public const string Unknown = "---";

    /// <summary>The octal digit → <c>rwx</c> triad map, verbatim from the web <c>PERMS</c> constant.</summary>
    public static IReadOnlyDictionary<char, string> Triads { get; } = new Dictionary<char, string>
    {
        ['7'] = "rwx",
        ['6'] = "rw-",
        ['5'] = "r-x",
        ['4'] = "r--",
        ['3'] = "-wx",
        ['2'] = "-w-",
        ['1'] = "--x",
        ['0'] = "---",
    };

    /// <summary>
    /// The symbolic triad for <paramref name="digit"/>, or <see cref="Unknown"/> when it is not an octal
    /// digit — the native mirror of the web <c>PERMS[d] ?? '---'</c> lookup.
    /// </summary>
    public static string Triad(char digit) =>
        Triads.TryGetValue(digit, out string? triad) ? triad : Unknown;
}

/// <summary>
/// One preset option offered by the mode picker — the native mirror of a single web
/// <c>presetOptions</c> entry <c>{ value, label }</c>
/// (web/src/features/admin/components/devtools/tools/UnixPermissionTool.tsx). <see cref="Value"/> is the
/// three-digit octal the option applies (the web <c>option.value</c>); <see cref="Label"/> is the human
/// label shown in the drop-down (the web <c>option.label</c>, e.g. "755 (rwxr-xr-x)"). The labels are
/// dimensionless data (not translated in the web source), so they are kept verbatim.
/// </summary>
/// <param name="Value">The three-digit octal mode this preset applies (web <c>option.value</c>).</param>
/// <param name="Label">The drop-down label (web <c>option.label</c>).</param>
public sealed record PermissionPreset(string Value, string Label);

/// <summary>
/// The mode presets the picker offers — the native mirror of the web component's <c>presetOptions</c>
/// array (web/src/features/admin/components/devtools/tools/UnixPermissionTool.tsx). Order is preserved so
/// the native drop-down lists them identically.
/// </summary>
public static class UnixPermissionPresets
{
    /// <summary>The initial octal mode the surface selects (web <c>useState('755')</c>).</summary>
    public const string Default = "755";

    /// <summary>The six presets, verbatim from the web <c>presetOptions</c> array.</summary>
    public static IReadOnlyList<PermissionPreset> All { get; } = new[]
    {
        new PermissionPreset("755", "755 (rwxr-xr-x)"),
        new PermissionPreset("644", "644 (rw-r--r--)"),
        new PermissionPreset("700", "700 (rwx------)"),
        new PermissionPreset("600", "600 (rw-------)"),
        new PermissionPreset("777", "777 (rwxrwxrwx)"),
        new PermissionPreset("444", "444 (r--r--r--)"),
    };
}

/// <summary>
/// The resolved permission breakdown — the native projection of the web <c>symbolic</c> memo and the three
/// slices it is rendered through (<c>symbolic.slice(0,3)</c> / <c>slice(3,6)</c> / <c>slice(6)</c>).
/// <see cref="Symbolic"/> is the full nine-character string (web <c>symbolic</c>) used by the code row and
/// the clipboard; <see cref="Owner"/> / <see cref="Group"/> / <see cref="Other"/> are its three triads used
/// by the breakdown grid. Kept as a record so the projection is unit-tested without a render host.
/// </summary>
/// <param name="Symbolic">The full nine-character symbolic permission string (web <c>symbolic</c>).</param>
/// <param name="Owner">The owner triad (web <c>symbolic.slice(0, 3)</c>).</param>
/// <param name="Group">The group triad (web <c>symbolic.slice(3, 6)</c>).</param>
/// <param name="Other">The other triad (web <c>symbolic.slice(6)</c>).</param>
public sealed record PermissionBreakdown(string Symbolic, string Owner, string Group, string Other);

/// <summary>
/// Canonical identity + presentation metadata for the UnixPermissionTool surface — the native mirror of the
/// web tool's registry entry (web <c>ClientUtilitiesSection</c>:
/// <c>{ id: 'unix-perm', name: t('Unix Perm'), desc: t('Unix Perm Desc'), icon: Lock, color: 'green' }</c>).
/// Surfaced as constants so the values are asserted in unit tests and consumed token-first by the view.
/// </summary>
public static class UnixPermissionToolRegistration
{
    /// <summary>Stable surface id (web registry <c>id: 'unix-perm'</c>).</summary>
    public const string Id = "unix-perm";

    /// <summary>Surface category (the web devtools "client utilities" group).</summary>
    public const string Category = "devtools";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "UnixPermissionTool";

    /// <summary>Segoe Fluent "Lock" glyph — the native stand-in for the web Lucide <c>Lock</c> icon.</summary>
    public const string IconGlyph = "\uE72E";

    /// <summary>Accent colour token key (green) backing the icon chip — the web <c>color: 'green'</c> entry.</summary>
    public const string AccentColorKey = "TsColorSuccessColor";

    /// <summary>Accent brush token key (green) for the icon glyph foreground.</summary>
    public const string AccentBrushKey = "TsColorSuccessBrush";

    /// <summary>Localized title (web <c>t('Unix Perm')</c>).</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("translation.Unix Perm", "Unix Perm");
    }

    /// <summary>Localized description (web <c>t('Unix Perm Desc')</c>).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("translation.Unix Perm Desc", "Unix Perm Desc");
    }
}

/// <summary>
/// PII-safe diagnostics for the UnixPermissionTool surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the typed octal or the computed
/// permissions — so a diagnostics line can never leak operator input. Thread-safe.
/// </summary>
public sealed class UnixPermissionToolDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public UnixPermissionToolDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=UnixPermissionTool</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={UnixPermissionToolRegistration.Slug}");
    }
}
