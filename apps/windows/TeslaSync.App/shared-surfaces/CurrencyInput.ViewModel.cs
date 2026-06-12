using System.ComponentModel;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <see cref="CurrencyInput"/> view — the native port of the web
/// <c>&lt;CurrencyInput&gt;</c> component body (web/src/components/forms/CurrencyInput.tsx). Like the web component it
/// keeps a local editing <see cref="Text"/> buffer separate from the canonical micro value so the user can type
/// freely without each keystroke triggering a parse / re-format round-trip that would jump the cursor, and it
/// re-syncs that buffer to the formatted display whenever the bound <see cref="ICurrencyInputSource"/> publishes new
/// props — UNLESS the field is currently focused and being edited (the web <c>focusedRef</c> guard around the resync
/// effect). It observes the seam (the P1/S8 props), projects each change through <see cref="CurrencyInputDisplay"/>,
/// commits a parse on blur / Enter (raising <see cref="ValueCommitted"/>, the web <c>onChange</c>) and re-normalises
/// the visible text to the canonical-rounded form. It carries no view-framework dependency so it is verified
/// headlessly; the WinUI view marshals its notifications onto the dispatcher.
/// </summary>
public sealed class CurrencyInputViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly PropertyChangedEventArgs DisplayChangedArgs = new(nameof(Display));
    private static readonly PropertyChangedEventArgs TextChangedArgs = new(nameof(Text));

    private readonly ICurrencyInputSource _source;
    private readonly ILocalizer _localizer;
    private CurrencyInputProps _props;
    private CurrencyInputDisplay _display;
    private string _text;
    private bool _focused;
    private bool _disposed;

    /// <summary>Creates the holder over its data seam and localizer, projecting the initial frame.</summary>
    /// <param name="source">The P1/S8 props seam.</param>
    /// <param name="localizer">The i18n facade the default accessible label resolves through.</param>
    public CurrencyInputViewModel(ICurrencyInputSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _props = source.Props ?? new CurrencyInputProps();
        _display = CurrencyInputDisplay.Project(_props, _localizer);

        // web: the initial text buffer is the formatted display (useState(display)).
        _text = _display.FormattedValue;
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// Raised when the field commits an edit on blur / Enter — the native port of the web <c>onChange</c> callback.
    /// Carries the parsed canonical micro value (or null when the field was cleared).
    /// </summary>
    public event EventHandler<CurrencyInputCommit>? ValueCommitted;

    /// <summary>The diagnostics slug this surface registers under (<c>CurrencyInput</c>).</summary>
    public static string Slug => CurrencyInputRegistration.Slug;

    /// <summary>The render-ready projection of the current props.</summary>
    public CurrencyInputDisplay Display => _display;

    /// <summary>
    /// The text the field currently shows — the local editing buffer (web <c>text</c>). It holds the formatted
    /// display while unfocused and whatever the user has typed while editing, and is re-normalised to the
    /// canonical-rounded form on commit.
    /// </summary>
    public string Text => _text;

    /// <summary>Which value branch is showing (empty vs populated).</summary>
    public CurrencyInputState State => _display.State;

    /// <summary>The leading currency-symbol adornment (web <c>symbol</c>).</summary>
    public string Symbol => _display.Symbol;

    /// <summary>The accessible name the field announces (web <c>aria-label</c>).</summary>
    public string AccessibleName => _display.AccessibleName;

    /// <summary>Whether the field accepts input (web <c>!disabled</c>).</summary>
    public bool IsEnabled => _display.IsEnabled;

    /// <summary>Whether the field is in the error state (web <c>error</c>).</summary>
    public bool HasError => _display.HasError;

    /// <summary>True while the field is empty.</summary>
    public bool IsEmpty => _display.IsEmpty;

    /// <summary>True while the field is being edited (between <see cref="Focus"/> and <see cref="Blur"/>).</summary>
    public bool IsFocused => _focused;

    /// <summary>
    /// Update the editing buffer to what the user has typed — the native port of the web
    /// <c>onChange={(e) =&gt; setText(e.target.value)}</c>. It does NOT parse or commit (that happens on blur / Enter),
    /// so the field never re-formats mid-keystroke. A no-op when the text is unchanged.
    /// </summary>
    /// <param name="text">The raw text now in the field.</param>
    public void SetText(string? text)
    {
        string next = text ?? string.Empty;
        if (string.Equals(_text, next, StringComparison.Ordinal))
        {
            return;
        }

        _text = next;
        PropertyChanged?.Invoke(this, TextChangedArgs);
    }

    /// <summary>Mark the field focused so an external props change does not clobber the in-progress text (web handleFocus).</summary>
    public void Focus() => _focused = true;

    /// <summary>
    /// Mark the field unfocused and commit the current buffer — the native port of the web <c>handleBlur</c>
    /// (focusedRef = false, then commit).
    /// </summary>
    public void Blur()
    {
        _focused = false;
        Commit(_text);
    }

    /// <summary>
    /// Commit the current buffer without changing focus — the native port of the web <c>handleKeyDown</c> Enter
    /// branch (commit while the field stays focused).
    /// </summary>
    public void CommitFromEnter() => Commit(_text);

    /// <summary>Detach from the data seam (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSourceChanged;
        GC.SuppressFinalize(this);
    }

    /// <summary>
    /// Parse the raw text into canonical micros, push it back through <see cref="ValueCommitted"/> (web
    /// <c>onChange({ valueMicro })</c>) and re-normalise the visible text to the canonical-rounded form (web
    /// <c>setText(formatCurrencyMicro(parsed, …))</c>) so typing "1.5001" then committing settles to "$1.50". The
    /// projected value state is updated optimistically so the field reflects the commit before the parent echoes the
    /// new value back through the seam.
    /// </summary>
    private void Commit(string raw)
    {
        long? parsed = CurrencyMicro.Parse(raw, _props.Currency, _props.Culture);

        _props = _props with { ValueMicro = parsed };
        ApplyDisplay(CurrencyInputDisplay.Project(_props, _localizer), syncText: true);

        ValueCommitted?.Invoke(this, new CurrencyInputCommit(parsed));
    }

    private void OnSourceChanged(object? sender, EventArgs e)
    {
        _props = _source.Props ?? new CurrencyInputProps();

        // web useEffect: re-sync the buffer to the formatted display ONLY when the field is not being edited, so an
        // external value / currency / locale change does not clobber in-progress input.
        ApplyDisplay(CurrencyInputDisplay.Project(_props, _localizer), syncText: !_focused);
    }

    private void ApplyDisplay(CurrencyInputDisplay next, bool syncText)
    {
        bool displayChanged = !next.Equals(_display);
        if (displayChanged)
        {
            _display = next;
        }

        bool textChanged = false;
        if (syncText && !string.Equals(_text, next.FormattedValue, StringComparison.Ordinal))
        {
            _text = next.FormattedValue;
            textChanged = true;
        }

        if (displayChanged)
        {
            PropertyChanged?.Invoke(this, DisplayChangedArgs);
        }

        if (textChanged)
        {
            PropertyChanged?.Invoke(this, TextChangedArgs);
        }
    }
}
