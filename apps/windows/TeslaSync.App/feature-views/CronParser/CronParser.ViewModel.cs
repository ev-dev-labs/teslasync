using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.CronParser;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="CronParserTool"/> view — the native port of the
/// web <c>CronParserTool</c> component (web/src/features/admin/components/devtools/tools/CronParser.tsx). It
/// holds the current <see cref="Expression"/> (the web <c>expr</c> state), projects it through
/// <see cref="CronProjection"/> for the current clock instant and exposes the resulting <see cref="Display"/>
/// plus the mutually-exclusive <see cref="State"/> so the view is a thin renderer. The surface is
/// presentational — there is no asynchronous load — so projection is synchronous; reassigning
/// <see cref="Expression"/> (typing or pressing a preset, the web <c>setExpr</c>) re-parses and recomputes the
/// upcoming runs (the web <c>useMemo</c> recomputations). The clock is an injected <see cref="TimeProvider"/>
/// (defaulting to <see cref="TimeProvider.System"/>, the web <c>new Date()</c>) so the upcoming-run scan is
/// deterministic in tests. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class CronParserViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly TimeProvider _timeProvider;
    private readonly Func<DateTimeOffset, string> _formatRun;

    private string _expression = string.Empty;
    private CronDisplay _display;
    private CronParserState _state;

    /// <summary>Creates the holder over its preset source, localizer, clock and run formatter.</summary>
    /// <param name="source">The cron preset source (the canonical catalog).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="timeProvider">The clock the upcoming-run scan starts from (defaults to <see cref="TimeProvider.System"/>).</param>
    /// <param name="formatRun">The display formatter for each run time (defaults to the medium date-time format).</param>
    public CronParserViewModel(
        ICronPresetSource source,
        ILocalizer localizer,
        TimeProvider? timeProvider = null,
        Func<DateTimeOffset, string>? formatRun = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _timeProvider = timeProvider ?? TimeProvider.System;
        _formatRun = formatRun ?? DefaultFormat;

        Presets = ProjectPresets(source.GetPresets(), localizer);
        _display = Reproject();
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, render-ready preset chips (web <c>presets.map</c>).</summary>
    public IReadOnlyList<CronPresetButton> Presets { get; }

    /// <summary>The current mutually-exclusive surface state (parsed vs empty).</summary>
    public CronParserState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready result for the current expression (web <c>description</c> + <c>nextRuns</c>).</summary>
    public CronDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(Description));
            Raise(nameof(NextRuns));
            Raise(nameof(HasDescription));
            Raise(nameof(HasRuns));
        }
    }

    /// <summary>
    /// The current cron expression (the web <c>expr</c> state). Reassigning re-parses the expression and, when
    /// the validity changes, flips <see cref="State"/> between parsed and empty.
    /// </summary>
    public string Expression
    {
        get => _expression;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_expression, next, StringComparison.Ordinal))
            {
                return;
            }

            _expression = next;
            Raise(nameof(Expression));
            Display = Reproject();
            State = _display.State;
        }
    }

    /// <summary>The current human-readable description (empty when <see cref="State"/> is <see cref="CronParserState.Empty"/>).</summary>
    public string Description => _display.Description;

    /// <summary>The current ordered upcoming runs (empty for an impossible schedule).</summary>
    public IReadOnlyList<CronRun> NextRuns => _display.NextRuns;

    /// <summary>True when the description renders (web <c>description &amp;&amp; …</c>).</summary>
    public bool HasDescription => _display.HasDescription;

    /// <summary>True when the next-runs list renders (web <c>nextRuns.length &gt; 0 &amp;&amp; …</c>).</summary>
    public bool HasRuns => _display.HasRuns;

    /// <summary>Localized surface title (web <c>t('Cron Parser')</c>).</summary>
    public string Title => CronParserRegistration.Name(_localizer);

    /// <summary>Localized surface description (web <c>t('Cron Parser Desc')</c>).</summary>
    public string ToolDescription => CronParserRegistration.Description(_localizer);

    /// <summary>Localized expression field label (web <c>label={t('Cron Expression')}</c>).</summary>
    public string InputLabel => _localizer.GetString("Cron Expression", "Cron Expression");

    /// <summary>The expression field example hint shown until the user types (web sample <c>*/5 * * * *</c>).</summary>
    public string InputHint => _localizer.GetString("devtools.cron.hint", "*/5 * * * *");

    /// <summary>Localized description-block label (web <c>{t('Description')}</c>).</summary>
    public string DescriptionLabel => _localizer.GetString("Description", "Description");

    /// <summary>Localized next-runs-block label (web <c>{t('Next Runs')}</c>).</summary>
    public string NextRunsLabel => _localizer.GetString("Next Runs", "Next Runs");

    /// <summary>Localized empty-state message shown until a valid five-field expression is entered.</summary>
    public string EmptyMessage => _localizer.GetString(
        "devtools.cron.empty",
        "Enter a five-field cron expression (minute hour day month weekday) to preview its schedule");

    /// <summary>Localized message shown for a valid but impossible schedule with no upcoming runs.</summary>
    public string NoRunsMessage => _localizer.GetString(
        "devtools.cron.noRuns",
        "No upcoming runs in the next year");

    /// <summary>
    /// Apply a preset's expression (the web preset <c>onClick={() =&gt; setExpr(p.value)}</c>): reassigns
    /// <see cref="Expression"/> so the surface re-parses and previews the new schedule.
    /// </summary>
    /// <param name="value">The cron expression to apply.</param>
    public void ApplyPreset(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        Expression = value;
    }

    private CronDisplay Reproject() =>
        CronProjection.Project(_expression, _localizer, _timeProvider.GetLocalNow(), CronProjection.DefaultRunCount, _formatRun);

    private static List<CronPresetButton> ProjectPresets(
        IReadOnlyList<CronPreset> presets,
        ILocalizer localizer)
    {
        var chips = new List<CronPresetButton>(presets.Count);
        foreach (var preset in presets)
        {
            string label = localizer.GetString(preset.LabelKey, preset.LabelFallback);
            chips.Add(new CronPresetButton(label, preset.Value, label));
        }

        return chips;
    }

    private static string DefaultFormat(DateTimeOffset time) =>
        time.ToString("MMM d, yyyy, h:mm tt", CultureInfo.CurrentCulture);

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
