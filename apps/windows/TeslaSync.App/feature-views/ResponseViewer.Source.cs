namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The source of the surface's current inputs (P1/S8 state-holder seam). ResponseViewer is presentational and
/// prop-driven — the web component (web/src/features/admin/components/ResponseViewer.tsx) is re-rendered by the
/// API-playground page with a fresh <c>{ response, loading, history }</c> on every request — so this seam
/// yields the current <see cref="ResponseViewerInput"/> rather than performing a network read. Routing the
/// input through a seam keeps the view-model free of literals and lets a test seed any state
/// (loading / empty / response, with or without history) to exercise every branch headlessly.
/// </summary>
public interface IResponseViewerSource
{
    /// <summary>The current inputs to project (the latest props the host fed the surface).</summary>
    ResponseViewerInput GetInput();
}

/// <summary>
/// An <see cref="IResponseViewerSource"/> wrapping a single, fixed <see cref="ResponseViewerInput"/> — the
/// seed the WinUI view constructs its view-model with (an idle input) and the seam a unit test substitutes to
/// drive a chosen state. Immutable and headless.
/// </summary>
public sealed class StaticResponseViewerSource : IResponseViewerSource
{
    private readonly ResponseViewerInput _input;

    /// <summary>Creates the source over the input it always returns.</summary>
    /// <param name="input">The fixed input returned by <see cref="GetInput"/>.</param>
    public StaticResponseViewerSource(ResponseViewerInput input) =>
        _input = input ?? throw new ArgumentNullException(nameof(input));

    /// <summary>An idle-seeded source — not loading, no response, no history (the view's resting input).</summary>
    /// <returns>A source over <see cref="ResponseViewerInput.Idle"/>.</returns>
    public static StaticResponseViewerSource Idle() => new(ResponseViewerInput.Idle);

    /// <inheritdoc />
    public ResponseViewerInput GetInput() => _input;
}
