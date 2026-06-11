namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// How a <see cref="IImportFilePicker.PickJsonAsync"/> attempt resolved — the three outcomes the modal's
/// "From File" flow must distinguish (the native analogue of the web file-input + drop branches: a chosen file
/// whose text was read, a cancelled picker, and a file whose text could not be read).
/// </summary>
public enum ImportFilePickOutcome
{
    /// <summary>A file was chosen and its text read (web <c>file.text()</c> resolved).</summary>
    Picked,

    /// <summary>The user dismissed the picker without choosing a file (no web equivalent action runs).</summary>
    Cancelled,

    /// <summary>A file was chosen but its text could not be read (web <c>file.text().catch(...)</c>).</summary>
    Failed,
}

/// <summary>
/// The result of a browse-for-file attempt — the <see cref="Outcome"/> plus the file's text when the outcome
/// is <see cref="ImportFilePickOutcome.Picked"/> (else empty). Pure data so the "From File" flow is asserted
/// headlessly with a <see cref="StaticImportFilePicker"/>.
/// </summary>
/// <param name="Outcome">How the pick resolved.</param>
/// <param name="Text">The chosen file's text when <see cref="Outcome"/> is <see cref="ImportFilePickOutcome.Picked"/>; else empty.</param>
public sealed record ImportFilePick(ImportFilePickOutcome Outcome, string Text)
{
    /// <summary>A cancelled pick (the user dismissed the picker).</summary>
    public static ImportFilePick Cancelled { get; } = new(ImportFilePickOutcome.Cancelled, string.Empty);

    /// <summary>A failed pick (the chosen file could not be read).</summary>
    public static ImportFilePick Failed { get; } = new(ImportFilePickOutcome.Failed, string.Empty);

    /// <summary>A successful pick carrying the chosen file's <paramref name="text"/>.</summary>
    public static ImportFilePick Picked(string text) => new(ImportFilePickOutcome.Picked, text ?? string.Empty);
}

/// <summary>
/// The browse-for-file seam the <see cref="ImportPreviewModalViewModel"/> binds to (P1/S8 state-holder seam) —
/// the native analogue of the web modal's hidden <c>&lt;input type="file" accept=".json"&gt;</c> + its
/// <c>handleFileImport</c> read. The view never opens a picker or touches the file system directly; the app
/// wires the concrete WinUI picker (a <c>FileOpenPicker</c> initialized with the window handle, reading the
/// chosen file's text) while headless callers and unit tests use <see cref="StaticImportFilePicker"/>.
/// Implementations classify a read failure as <see cref="ImportFilePickOutcome.Failed"/> rather than throwing,
/// so the view-model can surface the web "Failed to read file" parse error.
/// </summary>
public interface IImportFilePicker
{
    /// <summary>
    /// Prompt the user to choose a <c>.json</c> dashboard file and read its text (web Browse + <c>file.text()</c>).
    /// Returns a <see cref="ImportFilePickOutcome.Picked"/> result with the text, a
    /// <see cref="ImportFilePickOutcome.Cancelled"/> result when dismissed, or a
    /// <see cref="ImportFilePickOutcome.Failed"/> result when the file could not be read.
    /// </summary>
    /// <param name="cancellationToken">Cancels a pending pick (e.g. the modal closing).</param>
    Task<ImportFilePick> PickJsonAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// A fixed <see cref="IImportFilePicker"/> for the headless tests (and any caller with a pre-resolved result).
/// Returns the configured <see cref="ImportFilePick"/> (defaulting to <see cref="ImportFilePick.Cancelled"/>);
/// the Windows app registers the concrete window-backed <c>FileOpenPicker</c> adapter instead.
/// </summary>
public sealed class StaticImportFilePicker : IImportFilePicker
{
    private readonly ImportFilePick _result;

    /// <summary>Creates the picker over a fixed <paramref name="result"/> (defaults to a cancelled pick).</summary>
    public StaticImportFilePicker(ImportFilePick? result = null) => _result = result ?? ImportFilePick.Cancelled;

    /// <inheritdoc />
    public Task<ImportFilePick> PickJsonAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(_result);
}
