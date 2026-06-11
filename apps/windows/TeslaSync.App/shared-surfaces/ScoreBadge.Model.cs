using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.ScoreBadgeSurface;

/// <summary>
/// Canonical metadata for the <c>ScoreBadge</c> shared surface — the native mirror of the web component at
/// <c>web/src/components/data-display/ScoreBadge.tsx</c>: the stable diagnostics slug. UI-free so the metadata
/// is asserted in tests.
/// </summary>
public static class ScoreBadgeRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ScoreBadge";
}

/// <summary>
/// The display size — the native mirror of the web <c>ScoreBadgeSize</c> union
/// (<c>'sm' | 'md' | 'lg'</c> in web/src/components/data-display/ScoreBadge.tsx). The badge font size is a
/// parity-driven scale (the web Tailwind <c>text-xs</c> / <c>text-xl</c> / <c>text-3xl</c> classes), not a
/// typographic role, so <see cref="ScoreBadgeProjection.FontSizeFor"/> maps each member to the matching pixel
/// size rather than a token role.
/// </summary>
public enum ScoreBadgeSize
{
    /// <summary>web <c>'sm'</c> — <c>text-xs</c> (≈12&#160;px), used inline next to other text.</summary>
    Sm,

    /// <summary>web <c>'md'</c> (default) — <c>text-xl</c> (≈20&#160;px), used in list rows.</summary>
    Md,

    /// <summary>web <c>'lg'</c> — <c>text-3xl</c> (≈30&#160;px), used in section headers.</summary>
    Lg,
}

/// <summary>
/// The render-time data model the <c>ScoreBadge</c> view binds to — the native analogue of the web
/// <c>ScoreBadgeProps</c> discriminated union (web/src/components/data-display/ScoreBadge.tsx). The web
/// component is purely presentational: its parent (a Drives / Charging / Trips row or a section header) owns any
/// data fetching and feeds an already-resolved score or grade, so — exactly like React re-rendering the element
/// with already-resolved props — there is no fetch-driven loading / error / stale / offline branch to reproduce
/// here; the only branches are "graded" (A+ … F) and "no data" (the muted em dash that
/// <see cref="ScoreScale.NumericToGrade"/> returns for a null / non-finite score). The two web input styles are
/// mutually exclusive (<c>score</c> + optional <c>thresholds</c>, XOR a pre-computed <c>grade</c>); the private
/// constructor and the <see cref="FromScore"/> / <see cref="FromGrade"/> factories enforce that invariant. Pure
/// data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record ScoreBadgeModel
{
    private ScoreBadgeModel(
        ScoreGrade? grade,
        double? score,
        IReadOnlyList<ScoreThreshold>? thresholds,
        ScoreBadgeSize size,
        string? ariaLabel,
        string? testId)
    {
        Grade = grade;
        Score = score;
        Thresholds = thresholds;
        Size = size;
        AriaLabel = ariaLabel;
        TestId = testId;
    }

    /// <summary>The pre-computed grade (web <c>GradeInputProps.grade</c>); null when the model is score-driven.</summary>
    public ScoreGrade? Grade { get; }

    /// <summary>The numeric 0–100 score (web <c>ScoreInputProps.score</c>); null / non-finite renders the muted dash.</summary>
    public double? Score { get; }

    /// <summary>Optional non-default scale for the score path (web <c>ScoreInputProps.thresholds</c>); null uses the default 0–100 scale.</summary>
    public IReadOnlyList<ScoreThreshold>? Thresholds { get; }

    /// <summary>The display size (web <c>size</c>, default <see cref="ScoreBadgeSize.Md"/>).</summary>
    public ScoreBadgeSize Size { get; }

    /// <summary>Optional override for the auto-generated accessible name (web <c>ariaLabel</c>).</summary>
    public string? AriaLabel { get; }

    /// <summary>Optional automation id mirroring the web test hook (web <c>testId</c> → <c>AutomationProperties.AutomationId</c>).</summary>
    public string? TestId { get; }

    /// <summary>The initial / no-data model — a null score, rendering the muted em dash (web <c>score={null}</c>).</summary>
    public static ScoreBadgeModel Unknown { get; } = FromScore(null);

    /// <summary>
    /// A score-driven model (web <c>ScoreInputProps</c>): the numeric score is mapped to a letter grade via
    /// <see cref="ScoreScale.NumericToGrade"/>.
    /// </summary>
    /// <param name="score">The numeric 0–100 score (web <c>score</c>); null / non-finite renders the muted dash.</param>
    /// <param name="thresholds">Optional non-default scale (web <c>thresholds</c>); null uses the default 0–100 scale.</param>
    /// <param name="size">The display size (web <c>size</c>, default <see cref="ScoreBadgeSize.Md"/>).</param>
    /// <param name="ariaLabel">Optional accessible-name override (web <c>ariaLabel</c>).</param>
    /// <param name="testId">Optional automation id (web <c>testId</c>).</param>
    public static ScoreBadgeModel FromScore(
        double? score,
        IReadOnlyList<ScoreThreshold>? thresholds = null,
        ScoreBadgeSize size = ScoreBadgeSize.Md,
        string? ariaLabel = null,
        string? testId = null) =>
        new(null, score, thresholds, size, ariaLabel, testId);

    /// <summary>
    /// A grade-driven model (web <c>GradeInputProps</c>): the caller already mapped score → grade, so the badge
    /// renders the supplied grade directly via <see cref="ScoreScale.Info"/>.
    /// </summary>
    /// <param name="grade">The pre-computed grade (web <c>grade</c>).</param>
    /// <param name="size">The display size (web <c>size</c>, default <see cref="ScoreBadgeSize.Md"/>).</param>
    /// <param name="ariaLabel">Optional accessible-name override (web <c>ariaLabel</c>).</param>
    /// <param name="testId">Optional automation id (web <c>testId</c>).</param>
    public static ScoreBadgeModel FromGrade(
        ScoreGrade grade,
        ScoreBadgeSize size = ScoreBadgeSize.Md,
        string? ariaLabel = null,
        string? testId = null) =>
        new(grade, null, null, size, ariaLabel, testId);
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="ScoreBadgeModel"/> — the native analogue of everything
/// the web component derives before returning JSX (web/src/components/data-display/ScoreBadge.tsx): the resolved
/// <see cref="Grade"/> and its <see cref="Label"/> (the letter IS the badge — no extra "SCORE" sub-label) and
/// shared-palette <see cref="ColorHex"/>, the parity <see cref="FontSize"/> for the chosen <see cref="Size"/>,
/// the <see cref="HasScore"/> guard (false for the muted no-data dash), the composed <see cref="AutomationName"/>
/// (the web <c>aria-label</c>, always present), and the optional <see cref="AutomationId"/> (the web
/// <c>testId</c>). Pure data so every value is asserted headlessly.
/// </summary>
/// <param name="Grade">The resolved letter grade (web <c>info.label</c> source).</param>
/// <param name="Label">The display label ("A+" … "F", or "—" for no data) — the web <c>info.label</c>.</param>
/// <param name="ColorHex">The shared A–F palette hex colour for the badge text (web <c>info.color</c>).</param>
/// <param name="Size">The display size (web <c>size</c>).</param>
/// <param name="FontSize">The resolved badge font size in pixels (web <c>SIZE_CLASS[size]</c>).</param>
/// <param name="HasScore">True when a real grade resolved; false for the muted no-data dash (the empty branch).</param>
/// <param name="AutomationName">The accessible name Narrator reads (web <c>aria-label</c>).</param>
/// <param name="AutomationId">The optional automation id (web <c>testId</c>); null when not supplied.</param>
public sealed record ScoreBadgeDisplay(
    ScoreGrade Grade,
    string Label,
    string ColorHex,
    ScoreBadgeSize Size,
    double FontSize,
    bool HasScore,
    string AutomationName,
    string? AutomationId);

/// <summary>
/// Pure projection from a <see cref="ScoreBadgeModel"/> to its <see cref="ScoreBadgeDisplay"/> — the native port
/// of web/src/components/data-display/ScoreBadge.tsx. Reproduces the web derivations exactly:
/// <list type="bullet">
///   <item><description>a grade-driven model resolves through <see cref="ScoreScale.Info"/> (web
///   <c>gradeInfo(props.grade)</c>); a score-driven model resolves through <see cref="ScoreScale.NumericToGrade"/>
///   with the supplied or default thresholds (web <c>numericToGrade(props.score, props.thresholds)</c>).</description></item>
///   <item><description>a null / non-finite score yields the muted em dash "—" with <see cref="ScoreScale"/>'s
///   no-data colour — the empty branch, which always renders rather than hiding the surface.</description></item>
///   <item><description>the badge font size maps the web <c>SIZE_CLASS</c> (<c>text-xs</c> / <c>text-xl</c> /
///   <c>text-3xl</c>) to <see cref="SmFontSize"/> / <see cref="MdFontSize"/> / <see cref="LgFontSize"/>.</description></item>
///   <item><description>the accessible name is the caller override if present, else the interpolated
///   <c>score.aria</c> template ("Score {{grade}}") with the grade label substituted (web
///   <c>ariaLabel ?? t('score.aria', 'Score {{grade}}', { grade: info.label })</c>).</description></item>
/// </list>
/// Every string resolves through the i18n facade with the exact key the web source uses. No WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
public static class ScoreBadgeProjection
{
    /// <summary>Badge font size for <see cref="ScoreBadgeSize.Sm"/> — web <c>text-xs</c> (0.75rem ≈ 12&#160;px).</summary>
    public const double SmFontSize = 12;

    /// <summary>Badge font size for <see cref="ScoreBadgeSize.Md"/> — web <c>text-xl</c> (1.25rem ≈ 20&#160;px).</summary>
    public const double MdFontSize = 20;

    /// <summary>Badge font size for <see cref="ScoreBadgeSize.Lg"/> — web <c>text-3xl</c> (1.875rem ≈ 30&#160;px).</summary>
    public const double LgFontSize = 30;

    /// <summary>i18n key for the accessible name (web <c>'score.aria'</c>).</summary>
    public const string AriaKey = "score.aria";

    /// <summary>English fallback for <see cref="AriaKey"/>, with the web interpolation token (web default value).</summary>
    public const string AriaFallback = "Score {{grade}}";

    private const string GradeToken = "{{grade}}";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade the accessible name resolves through (P1/S10).</param>
    /// <returns>The render-ready display model.</returns>
    public static ScoreBadgeDisplay Project(ScoreBadgeModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // web: 'grade' in props ? gradeInfo(props.grade) : numericToGrade(props.score, props.thresholds).
        ScoreGradeInfo info = model.Grade is { } grade
            ? ScoreScale.Info(grade)
            : ScoreScale.NumericToGrade(model.Score, model.Thresholds);

        string aria = model.AriaLabel ?? FormatAria(localizer.GetString(AriaKey, AriaFallback), info.Label);

        return new ScoreBadgeDisplay(
            Grade: info.Grade,
            Label: info.Label,
            ColorHex: info.ColorHex,
            Size: model.Size,
            FontSize: FontSizeFor(model.Size),
            HasScore: info.Grade != ScoreGrade.None,
            AutomationName: aria,
            AutomationId: model.TestId);
    }

    /// <summary>The parity badge font size for a size (the web <c>SIZE_CLASS[size]</c> Tailwind mapping).</summary>
    /// <param name="size">The display size.</param>
    public static double FontSizeFor(ScoreBadgeSize size) => size switch
    {
        ScoreBadgeSize.Sm => SmFontSize,
        ScoreBadgeSize.Lg => LgFontSize,
        _ => MdFontSize,
    };

    // react-i18next interpolation of the resolved 'score.aria' template — substitutes the {{grade}} token with
    // the same grade label the web passes in its options object ({ grade: info.label }).
    private static string FormatAria(string template, string label) =>
        template.Replace(GradeToken, label, StringComparison.Ordinal);
}

/// <summary>
/// PII-safe diagnostics for the <c>ScoreBadge</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the score or grade — so a diagnostics line
/// can never leak fleet state. Thread-safe.
/// </summary>
public sealed class ScoreBadgeDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public ScoreBadgeDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ScoreBadge</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ScoreBadgeRegistration.Slug}");
    }
}
