using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// PII-safe diagnostics for the Base64 surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the input or converted value,
/// which can carry user-supplied secrets (tokens, credentials). Thread-safe.
/// </summary>
public sealed class Base64ToolDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public Base64ToolDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Base64Tool</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={Base64ToolRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="Base64Tool"/> view — the native port of
/// the web component's <c>useState</c> (<c>mode</c>, <c>inputVal</c>) + <c>useMemo</c> (<c>output</c>)
/// composition in web/src/features/admin/components/devtools/tools/Base64Tool.tsx. Setting
/// <see cref="Mode"/> or <see cref="Input"/> recomputes the conversion through the pure
/// <see cref="Base64Codec"/> and folds the result into the mutually-exclusive <see cref="State"/> +
/// <see cref="Output"/> so the view is a thin renderer. Every user-facing string and Narrator name is
/// resolved through the injected <see cref="ILocalizer"/>. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class Base64ToolViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;

    private Base64ToolMode _mode = Base64ToolMode.Encode;
    private string _input = string.Empty;
    private Base64ToolState _state = Base64ToolState.Empty;
    private string _output = string.Empty;

    /// <summary>Creates the holder over its localizer and computes the initial (empty) state.</summary>
    public Base64ToolViewModel(ILocalizer localizer)
    {
        _localizer = localizer ?? throw new ArgumentNullException(nameof(localizer));
        Recompute();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The active conversion direction; reassigning re-runs the conversion.</summary>
    public Base64ToolMode Mode
    {
        get => _mode;
        set
        {
            if (_mode == value)
            {
                return;
            }

            _mode = value;
            Raise(nameof(Mode));
            Raise(nameof(IsEncode));
            Raise(nameof(IsDecode));
            Raise(nameof(InputHint));
            Recompute();
        }
    }

    /// <summary>The raw input text; reassigning re-runs the conversion.</summary>
    public string Input
    {
        get => _input;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_input, next, StringComparison.Ordinal))
            {
                return;
            }

            _input = next;
            Raise(nameof(Input));
            Recompute();
        }
    }

    /// <summary>The current mutually-exclusive surface state (empty / success / invalid).</summary>
    public Base64ToolState State
    {
        get => _state;
        private set => _state = value;
    }

    /// <summary>The display string for the output panel: the converted value, or the localized "Invalid Input" copy.</summary>
    public string Output
    {
        get => _output;
        private set => _output = value;
    }

    /// <summary>True when the output panel should render (web truthy <c>output</c>): any non-empty state.</summary>
    public bool HasOutput => _state != Base64ToolState.Empty;

    /// <summary>True when the active mode is <see cref="Base64ToolMode.Encode"/> (drives the Encode toggle emphasis).</summary>
    public bool IsEncode => _mode == Base64ToolMode.Encode;

    /// <summary>True when the active mode is <see cref="Base64ToolMode.Decode"/> (drives the Decode toggle emphasis).</summary>
    public bool IsDecode => _mode == Base64ToolMode.Decode;

    /// <summary>Localized card title (web <c>devtools.utils.base64</c>).</summary>
    public string Title => Base64ToolRegistration.Name(_localizer);

    /// <summary>Localized card description (web <c>devtools.utils.base64Desc</c>).</summary>
    public string Description => Base64ToolRegistration.Description(_localizer);

    /// <summary>Localized Encode toggle label (web <c>t('Encode')</c>).</summary>
    public string EncodeLabel => _localizer.GetString("Encode", "Encode");

    /// <summary>Localized Decode toggle label (web <c>t('Decode')</c>).</summary>
    public string DecodeLabel => _localizer.GetString("Decode", "Decode");

    /// <summary>Localized input field label (web <c>t('Input Label')</c>).</summary>
    public string InputLabel => _localizer.GetString("Input Label", "Input Label");

    /// <summary>Localized output panel label (web <c>t('Output Label')</c>).</summary>
    public string OutputLabel => _localizer.GetString("Output Label", "Output Label");

    /// <summary>Localized invalid-input message (web <c>t('Invalid Input')</c>).</summary>
    public string InvalidMessage => _localizer.GetString("Invalid Input", "Invalid Input");

    /// <summary>Localized copy-button idle label (web <c>common.copyButton.copy</c>).</summary>
    public string CopyLabel => _localizer.GetString("common.copyButton.copy", "Copy");

    /// <summary>Localized copy-button confirmation label (web <c>common.copyButton.copied</c>).</summary>
    public string CopiedLabel => _localizer.GetString("common.copyButton.copied", "Copied");

    /// <summary>Mode-dependent example hint shown when the input field is empty (the web example inputs 'Hello World' / 'SGVsbG8gV29ybGQ=').</summary>
    public string InputHint => _mode == Base64ToolMode.Encode
        ? _localizer.GetString("devtools.base64.encodeHint", "Hello World")
        : _localizer.GetString("devtools.base64.decodeHint", "SGVsbG8gV29ybGQ=");

    /// <summary>Narrator name for the Encode toggle.</summary>
    public string EncodeAccessibleName => EncodeLabel;

    /// <summary>Narrator name for the Decode toggle.</summary>
    public string DecodeAccessibleName => DecodeLabel;

    /// <summary>Narrator name for the input text field.</summary>
    public string InputAccessibleName => InputLabel;

    /// <summary>Narrator name for the copy-output button.</summary>
    public string CopyAccessibleName => CopyLabel;

    private void Recompute()
    {
        if (string.IsNullOrEmpty(_input))
        {
            Apply(Base64ToolState.Empty, string.Empty);
            return;
        }

        Base64CodecResult result = Base64Codec.Transform(_mode, _input);
        if (!result.Ok)
        {
            Apply(Base64ToolState.Invalid, InvalidMessage);
            return;
        }

        if (string.IsNullOrEmpty(result.Value))
        {
            Apply(Base64ToolState.Empty, string.Empty);
            return;
        }

        Apply(Base64ToolState.Success, result.Value);
    }

    private void Apply(Base64ToolState state, string output)
    {
        bool hadOutput = HasOutput;
        bool stateChanged = _state != state;
        bool outputChanged = !string.Equals(_output, output, StringComparison.Ordinal);

        State = state;
        Output = output;

        if (stateChanged)
        {
            Raise(nameof(State));
        }

        if (outputChanged)
        {
            Raise(nameof(Output));
        }

        if (hadOutput != HasOutput)
        {
            Raise(nameof(HasOutput));
        }
    }

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
