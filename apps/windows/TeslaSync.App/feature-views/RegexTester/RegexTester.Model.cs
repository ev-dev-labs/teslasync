using System.Text.RegularExpressions;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The display state the Regex Tester surface can be in — the honest union of the branches the web
/// source actually renders in web/src/features/admin/components/devtools/tools/RegexTester.tsx. The
/// tool is a pure client-side evaluator (its only hook is <c>useTranslation</c>; it performs no I/O),
/// so there is no loading / error / stale / offline branch to reproduce: the web's <c>matches</c> memo
/// collapses to exactly these two outcomes, gated by <c>{matches.length &gt; 0 &amp;&amp; (…)}</c>. An
/// invalid pattern is caught by the web <c>try/catch</c> and returns <c>[]</c>, which renders as
/// <see cref="Empty"/> (zero matches) — never a distinct error surface.
/// </summary>
public enum RegexTesterState
{
    /// <summary>Zero matches — no pattern / no test string, no match found, or an invalid pattern (web falsy/empty <c>matches</c>). The badge reads "0" and the result list is not rendered.</summary>
    Empty,

    /// <summary>One or more matches — the badge reads the count and the result list renders one row per match.</summary>
    Matched,
}

/// <summary>
/// A single regex match — the native port of the web result object <c>{ match, index }</c> pushed
/// into <c>results</c> by the <c>RegExp.exec</c> loop. <see cref="Ordinal"/> is the 1-based match
/// number shown in the leading chip (the web <c>i + 1</c>), <see cref="Value"/> is the matched text
/// (web <c>m[0]</c>) and <see cref="Index"/> is its position in the test string (web <c>m.index</c>).
/// A value type with structural equality so the view-model can diff result sets cheaply.
/// </summary>
/// <param name="Ordinal">The 1-based match number (web <c>i + 1</c>).</param>
/// <param name="Value">The matched substring (web <c>m[0]</c>).</param>
/// <param name="Index">The match's start offset in the test string (web <c>m.index</c>).</param>
public readonly record struct RegexTesterMatch(int Ordinal, string Value, int Index);

/// <summary>
/// A selectable regex flag combination — the native port of one entry in the web <c>flagOptions</c>
/// array (a <c>{ value, label }</c> pair feeding the <c>Select</c>). The <see cref="Label"/> is
/// already localized by <see cref="RegexTesterRegistration.FlagChoices"/>.
/// </summary>
/// <param name="Value">The raw flag string fed to the evaluator ('g', 'gi', 'gm', 'gim' or '').</param>
/// <param name="Label">The localized option label shown in the drop-down.</param>
public sealed record RegexFlagChoice(string Value, string Label);

/// <summary>
/// The render-ready strings for one match row — the ordinal chip caption (web <c>{i + 1}</c>), the
/// matched value (web <c>m[0]</c>), the "At Index N" caption (web <c>{t('At Index')} {m.index}</c>) and
/// the composed Narrator name. Produced by <see cref="RegexTesterViewModel.DescribeMatch"/> so the view
/// holds no formatting or localization logic.
/// </summary>
/// <param name="Ordinal">The 1-based match number caption.</param>
/// <param name="Value">The matched substring.</param>
/// <param name="IndexCaption">The localized "At Index N" caption.</param>
/// <param name="AccessibleName">The composed Narrator name for the row.</param>
public sealed record RegexMatchDisplay(string Ordinal, string Value, string IndexCaption, string AccessibleName);

/// <summary>
/// Pure regex evaluator — the native port of the web source's <c>matches</c> memo. It reproduces the
/// browser <c>RegExp</c> semantics the web relies on: an empty pattern or empty test string yields no
/// matches (the web <c>if (!pattern || !testStr) return []</c> early-return); the <c>g</c> flag
/// collects every match by re-scanning from the end of the previous one (the web
/// <c>while ((m = re.exec(testStr)) !== null)</c> loop, including the zero-width-match
/// <c>if (!m[0]) break</c> guard that prevents an infinite loop); without <c>g</c> only the first
/// match is returned; and a pattern the platform engine rejects surfaces as no matches (the web
/// <c>try/catch</c> returning <c>[]</c>). A <see cref="MatchTimeout"/> bounds catastrophic backtracking
/// so a hand-typed pattern can never hang the UI thread. UI-free and deterministic so it is fully
/// unit-testable. Evaluation runs on the platform .NET regex engine, so exotic pattern syntax can
/// differ from the browser engine — the data shape, flag semantics and match projection are what this
/// port reproduces.
/// </summary>
public static class RegexEvaluator
{
    /// <summary>The per-evaluation backtracking budget; an over-budget pattern yields the matches gathered so far rather than hanging the UI.</summary>
    public static readonly TimeSpan MatchTimeout = TimeSpan.FromMilliseconds(250);

    /// <summary>
    /// Evaluate <paramref name="pattern"/> with <paramref name="flags"/> against
    /// <paramref name="testStr"/>, projecting each match to a <see cref="RegexTesterMatch"/>. Returns
    /// an empty list for an empty pattern, an empty test string, or a pattern the engine rejects —
    /// exactly mirroring the web memo.
    /// </summary>
    public static IReadOnlyList<RegexTesterMatch> Evaluate(string? pattern, string? flags, string? testStr)
    {
        if (string.IsNullOrEmpty(pattern) || string.IsNullOrEmpty(testStr))
        {
            return Array.Empty<RegexTesterMatch>();
        }

        (RegexOptions options, bool global) = ParseFlags(flags);
        var results = new List<RegexTesterMatch>();

        try
        {
            var regex = new Regex(pattern, options, MatchTimeout);
            if (global)
            {
                int start = 0;
                while (start <= testStr.Length)
                {
                    Match match = regex.Match(testStr, start);
                    if (!match.Success)
                    {
                        break;
                    }

                    results.Add(new RegexTesterMatch(results.Count + 1, match.Value, match.Index));

                    // Web parity: `if (!m[0]) break` — a zero-width match would never advance
                    // RegExp.lastIndex, so the web records it once and stops to avoid an infinite loop.
                    if (match.Length == 0)
                    {
                        break;
                    }

                    start = match.Index + match.Length;
                }
            }
            else
            {
                Match match = regex.Match(testStr);
                if (match.Success)
                {
                    results.Add(new RegexTesterMatch(1, match.Value, match.Index));
                }
            }
        }
        catch (ArgumentException)
        {
            // Invalid pattern (RegexParseException : ArgumentException) — the web catch returns [].
            return Array.Empty<RegexTesterMatch>();
        }
        catch (RegexMatchTimeoutException)
        {
            // Catastrophic backtracking — surface whatever was gathered, never hang the UI thread.
        }

        return results;
    }

    /// <summary>
    /// Map a flag string to the engine options and the "collect all" switch: <c>i</c> →
    /// <see cref="RegexOptions.IgnoreCase"/>, <c>m</c> → <see cref="RegexOptions.Multiline"/>, and
    /// <c>g</c> → collect every match (the web <c>flags.includes('g')</c> branch). Unknown characters
    /// are ignored — the web <c>Select</c> only offers 'g' / 'gi' / 'gm' / 'gim' / ''.
    /// </summary>
    public static (RegexOptions Options, bool Global) ParseFlags(string? flags)
    {
        string value = flags ?? string.Empty;
        var options = RegexOptions.None;

        if (value.Contains('i', StringComparison.Ordinal))
        {
            options |= RegexOptions.IgnoreCase;
        }

        if (value.Contains('m', StringComparison.Ordinal))
        {
            options |= RegexOptions.Multiline;
        }

        bool global = value.Contains('g', StringComparison.Ordinal);
        return (options, global);
    }
}

/// <summary>
/// Canonical identity + presentation metadata for the Regex Tester surface — the native mirror of the
/// web tool's registry entry (color 'red', icon <c>Regex</c>, titles <c>t('Regex Tester')</c> /
/// <c>t('Regex Tester Desc')</c>) and its <c>flagOptions</c> list. Surfaced as constants + UI-free
/// helpers so the values are asserted in unit tests and consumed token-first by the view.
/// </summary>
public static class RegexTesterRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "regex";

    /// <summary>Surface category (the web devtools "client utilities" group).</summary>
    public const string Category = "devtools";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "RegexTester";

    /// <summary>The flag combination selected on first render (the web <c>useState('g')</c>).</summary>
    public const string DefaultFlags = "g";

    /// <summary>Segoe Fluent "Code" glyph — the native stand-in for the web Lucide <c>Regex</c> icon.</summary>
    public const string IconGlyph = "\uE943";

    /// <summary>Accent colour token key (red) backing the icon chip — the web 'red' <c>ICON_COLOR_MAP</c> entry.</summary>
    public const string AccentColorKey = "TsColorDangerColor";

    /// <summary>Accent brush token key (red) for the icon glyph foreground and the matched-text mono code.</summary>
    public const string AccentBrushKey = "TsColorDangerBrush";

    // The five flag rows the web `flagOptions` array declares, in order. The first four are literal
    // labels in the web source; native routes them through the i18n facade (English fallback identical
    // to the web text) so the view carries no English literals. The last is the web `t('No Flags')`.
    private static readonly (string Value, string Key, string Fallback)[] FlagRows =
    [
        ("g", "devtools.regex.flagGlobal", "g (global)"),
        ("gi", "devtools.regex.flagGlobalCaseInsensitive", "gi (global, case-insensitive)"),
        ("gm", "devtools.regex.flagGlobalMultiline", "gm (global, multiline)"),
        ("gim", "devtools.regex.flagAll", "gim (all)"),
        ("", "No Flags", "No Flags"),
    ];

    /// <summary>Localized card title (web <c>t('Regex Tester')</c>).</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Regex Tester", "Regex Tester");
    }

    /// <summary>Localized card description (web <c>t('Regex Tester Desc')</c>).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Regex Tester Desc", "Regex Tester Desc");
    }

    /// <summary>Project the web <c>flagOptions</c> array into localized <see cref="RegexFlagChoice"/> rows, in declaration order.</summary>
    public static IReadOnlyList<RegexFlagChoice> FlagChoices(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var choices = new List<RegexFlagChoice>(FlagRows.Length);
        foreach ((string value, string key, string fallback) in FlagRows)
        {
            choices.Add(new RegexFlagChoice(value, localizer.GetString(key, fallback)));
        }

        return choices;
    }
}
