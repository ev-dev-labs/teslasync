using System.ComponentModel;
using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// PII-safe diagnostics for the Regex Tester surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the pattern, flags or test
/// string, which can carry user-supplied secrets. Thread-safe.
/// </summary>
public sealed class RegexTesterDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public RegexTesterDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RegexTester</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RegexTesterRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="RegexTester"/> view — the native port of
/// the web component's <c>useState</c> (<c>pattern</c>, <c>flags</c>, <c>testStr</c>) + <c>useMemo</c>
/// (<c>matches</c>) composition in
/// web/src/features/admin/components/devtools/tools/RegexTester.tsx. Setting <see cref="Pattern"/>,
/// <see cref="Flags"/> or <see cref="TestString"/> re-runs the pure <see cref="RegexEvaluator"/> and
/// folds the result into <see cref="Matches"/> + the derived badge projection so the view is a thin
/// renderer. Every user-facing string and Narrator name resolves through the injected
/// <see cref="ILocalizer"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class RegexTesterViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;

    private string _pattern = string.Empty;
    private string _flags = RegexTesterRegistration.DefaultFlags;
    private string _testString = string.Empty;
    private IReadOnlyList<RegexTesterMatch> _matches = Array.Empty<RegexTesterMatch>();

    /// <summary>Creates the holder over its localizer and computes the initial (empty) result.</summary>
    public RegexTesterViewModel(ILocalizer localizer)
    {
        _localizer = localizer ?? throw new ArgumentNullException(nameof(localizer));
        Recompute();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The regex pattern (web <c>pattern</c> state); reassigning re-runs the evaluation.</summary>
    public string Pattern
    {
        get => _pattern;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_pattern, next, StringComparison.Ordinal))
            {
                return;
            }

            _pattern = next;
            Raise(nameof(Pattern));
            Recompute();
        }
    }

    /// <summary>The active flag combination (web <c>flags</c> state); reassigning re-runs the evaluation.</summary>
    public string Flags
    {
        get => _flags;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_flags, next, StringComparison.Ordinal))
            {
                return;
            }

            _flags = next;
            Raise(nameof(Flags));
            Recompute();
        }
    }

    /// <summary>The string the pattern is tested against (web <c>testStr</c> state); reassigning re-runs the evaluation.</summary>
    public string TestString
    {
        get => _testString;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_testString, next, StringComparison.Ordinal))
            {
                return;
            }

            _testString = next;
            Raise(nameof(TestString));
            Recompute();
        }
    }

    /// <summary>The current matches (web <c>matches</c> memo), in document order.</summary>
    public IReadOnlyList<RegexTesterMatch> Matches
    {
        get => _matches;
        private set => _matches = value;
    }

    /// <summary>The number of matches (web <c>matches.length</c>).</summary>
    public int MatchCount => _matches.Count;

    /// <summary>True when at least one match exists (web <c>matches.length &gt; 0</c>): drives the result list and the badge tone.</summary>
    public bool HasMatches => _matches.Count > 0;

    /// <summary>The current mutually-exclusive surface state (empty / matched).</summary>
    public RegexTesterState State => HasMatches ? RegexTesterState.Matched : RegexTesterState.Empty;

    /// <summary>Badge tone: success when matches exist, neutral otherwise (web <c>variant={matches.length &gt; 0 ? 'success' : 'neutral'}</c>).</summary>
    public StatusKind BadgeStatus => HasMatches ? StatusKind.Success : StatusKind.Neutral;

    /// <summary>Localized card title (web <c>t('Regex Tester')</c>).</summary>
    public string Title => RegexTesterRegistration.Name(_localizer);

    /// <summary>Localized card description (web <c>t('Regex Tester Desc')</c>).</summary>
    public string Description => RegexTesterRegistration.Description(_localizer);

    /// <summary>Localized pattern field label (web <c>t('Pattern')</c>).</summary>
    public string PatternLabel => _localizer.GetString("Pattern", "Pattern");

    /// <summary>Pattern field example hint (the web literal <c>\d+</c>, routed through the facade so the view holds no literal).</summary>
    public string PatternHint => _localizer.GetString("devtools.regex.patternHint", "\\d+");

    /// <summary>Localized flags field label (web <c>t('Flags')</c>).</summary>
    public string FlagsLabel => _localizer.GetString("Flags", "Flags");

    /// <summary>Localized test-string field label (web <c>t('Test String')</c>).</summary>
    public string TestStringLabel => _localizer.GetString("Test String", "Test String");

    /// <summary>Localized test-string field hint (the web test-string example copy).</summary>
    public string TestStringHint => _localizer.GetString("Test String Placeholder", "Test String Placeholder"); // parity:allow verbatim web i18n key from t('Test String Placeholder')

    /// <summary>Localized "Matches" badge noun (web <c>t('Matches')</c>).</summary>
    public string MatchesLabel => _localizer.GetString("Matches", "Matches");

    /// <summary>Localized "At Index" prefix shown beside each match (web <c>t('At Index')</c>).</summary>
    public string AtIndexLabel => _localizer.GetString("At Index", "At Index");

    /// <summary>The localized flag options feeding the drop-down (web <c>flagOptions</c>), in declaration order.</summary>
    public IReadOnlyList<RegexFlagChoice> FlagOptions => RegexTesterRegistration.FlagChoices(_localizer);

    /// <summary>The badge caption: count then noun (web <c>{matches.length} {t('Matches')}</c>).</summary>
    public string BadgeText => string.Format(CultureInfo.CurrentCulture, "{0} {1}", MatchCount, MatchesLabel);

    /// <summary>Narrator name for the pattern field.</summary>
    public string PatternAccessibleName => PatternLabel;

    /// <summary>Narrator name for the flags drop-down.</summary>
    public string FlagsAccessibleName => FlagsLabel;

    /// <summary>Narrator name for the test-string field.</summary>
    public string TestStringAccessibleName => TestStringLabel;

    /// <summary>Narrator name for the match-count badge (announced politely on change).</summary>
    public string MatchesAccessibleName => BadgeText;

    /// <summary>
    /// Project one match to its render-ready row strings — the ordinal chip caption (web <c>{i + 1}</c>),
    /// the matched value (web <c>m[0]</c>), the "At Index N" caption (web <c>{t('At Index')} {m.index}</c>)
    /// and a composed Narrator name. Centralizes the per-row localization + formatting so the view is a
    /// thin renderer.
    /// </summary>
    public RegexMatchDisplay DescribeMatch(RegexTesterMatch match)
    {
        string ordinal = match.Ordinal.ToString(CultureInfo.CurrentCulture);
        string indexCaption = string.Format(CultureInfo.CurrentCulture, "{0} {1}", AtIndexLabel, match.Index);
        string accessibleName = string.Format(CultureInfo.CurrentCulture, "{0}. {1}. {2}", ordinal, match.Value, indexCaption);
        return new RegexMatchDisplay(ordinal, match.Value, indexCaption, accessibleName);
    }

    private void Recompute() => ApplyMatches(RegexEvaluator.Evaluate(_pattern, _flags, _testString));

    private void ApplyMatches(IReadOnlyList<RegexTesterMatch> next)
    {
        bool hadMatches = HasMatches;
        int oldCount = _matches.Count;
        bool changed = !_matches.SequenceEqual(next);
        if (!changed)
        {
            return;
        }

        Matches = next;
        Raise(nameof(Matches));

        if (oldCount != next.Count)
        {
            Raise(nameof(MatchCount));
            Raise(nameof(BadgeText));
            Raise(nameof(MatchesAccessibleName));
        }

        if (hadMatches != HasMatches)
        {
            Raise(nameof(HasMatches));
            Raise(nameof(State));
            Raise(nameof(BadgeStatus));
        }
    }

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
