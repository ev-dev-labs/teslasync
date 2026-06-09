namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The source of the surface's initial editor value (P1/S8 state-holder seam). The web
/// <c>JsonFormatterTool</c> seeds its <c>inputVal</c> from <c>useState('')</c>
/// (web/src/features/admin/components/devtools/tools/JsonFormatter.tsx) rather than from the network — but
/// routing the seed through a seam keeps the view-model free of literals and lets a test seed any starting
/// value (blank, valid, or malformed) to exercise every branch headlessly. After construction the editor
/// drives subsequent values directly through <see cref="JsonFormatterViewModel.SetText(string?)"/>, mirroring
/// the web <c>onChange</c> → <c>setInputVal</c> flow.
/// </summary>
public interface IJsonFormatterSource
{
    /// <summary>The initial editor value to project (web initial <c>inputVal</c>).</summary>
    JsonFormatterInput GetInput();
}

/// <summary>
/// An <see cref="IJsonFormatterSource"/> wrapping a single, fixed <see cref="JsonFormatterInput"/> — the seed
/// the WinUI view constructs its view-model with (a blank editor) and the seam a unit test substitutes to
/// drive a chosen starting value. Immutable and headless.
/// </summary>
public sealed class StaticJsonFormatterSource : IJsonFormatterSource
{
    private readonly JsonFormatterInput _input;

    /// <summary>Creates the source over the input it always returns.</summary>
    /// <param name="input">The fixed initial editor value.</param>
    public StaticJsonFormatterSource(JsonFormatterInput input) =>
        _input = input ?? throw new ArgumentNullException(nameof(input));

    /// <summary>A blank-seeded source — the view's resting input (web initial <c>useState('')</c>).</summary>
    public static StaticJsonFormatterSource Blank() => new(JsonFormatterInput.Blank);

    /// <summary>A source seeded with <paramref name="text"/> (a test convenience to exercise a starting value).</summary>
    /// <param name="text">The initial editor value to seed.</param>
    public static StaticJsonFormatterSource Of(string? text) => new(JsonFormatterInput.From(text));

    /// <inheritdoc />
    public JsonFormatterInput GetInput() => _input;
}
