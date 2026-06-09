namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The source of the surface's current inputs (P1/S8 state-holder seam). ResultPanel is presentational and
/// prop-driven — the web component (web/src/features/admin/components/devtools/ResultPanel.tsx) is re-rendered
/// by its devtools parent with a fresh <c>{ title, data, error }</c> each probe — so this seam yields the
/// current <see cref="ResultPanelInput"/> rather than performing a network read. Routing the input through a
/// seam keeps the view-model free of literals and lets a test seed any state (idle / payload / error) to
/// exercise every branch headlessly.
/// </summary>
public interface IResultPanelSource
{
    /// <summary>The current inputs to project (the latest props the host fed the surface).</summary>
    ResultPanelInput GetInput();
}

/// <summary>
/// An <see cref="IResultPanelSource"/> wrapping a single, fixed <see cref="ResultPanelInput"/> — the seed the
/// WinUI view constructs its view-model with (an idle input) and the seam a unit test substitutes to drive a
/// chosen state. Immutable and headless.
/// </summary>
public sealed class StaticResultPanelSource : IResultPanelSource
{
    private readonly ResultPanelInput _input;

    /// <summary>Creates the source over the input it always returns.</summary>
    public StaticResultPanelSource(ResultPanelInput input) =>
        _input = input ?? throw new ArgumentNullException(nameof(input));

    /// <summary>An idle-seeded source carrying just a header label (the view's resting input).</summary>
    public static StaticResultPanelSource Idle(string title, string? idleMessage = null) =>
        new(ResultPanelInput.Idle(title, idleMessage));

    /// <inheritdoc />
    public ResultPanelInput GetInput() => _input;
}
