using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="HashCalculator"/> view — the native port of the
/// web <c>HashCalculator</c> tool's hook composition
/// (web/src/features/admin/components/devtools/tools/HashCalculator.tsx). It holds the
/// <see cref="InputText"/> (web <c>inputVal</c>), computes its SHA-256 digest through the
/// <see cref="IHashComputer"/> seam (web <c>crypto.subtle.digest</c>), tracks the mutually-exclusive
/// <see cref="State"/> (empty → computing → computed/failed) and resolves every one of the tool's labels (web
/// <c>t('Hash Calculator')</c>, <c>t('Hash Input')</c>, the input hint, <c>t('devtools.utils.computeSha256')</c>,
/// <c>t('Hash Error')</c>, plus the shared copy affordance) through the i18n facade. The view is a thin
/// renderer over these properties. Drive it from one confinement; it
/// raises <see cref="PropertyChanged"/> from whatever thread the digest resumes on, and the view marshals the
/// render onto the UI thread.
/// </summary>
public sealed class HashCalculatorViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IHashComputer _computer;
    private readonly ILocalizer _localizer;

    private string _input = string.Empty;
    private bool _running;
    private string? _hash;
    private bool _faulted;
    private HashCalculatorState _state = HashCalculatorState.Empty;
    private string? _lastAnnouncement;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    /// <summary>Creates the holder over its digest seam and localizer.</summary>
    /// <param name="computer">The SHA-256 digest port (web <c>crypto.subtle.digest</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public HashCalculatorViewModel(IHashComputer computer, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(computer);
        ArgumentNullException.ThrowIfNull(localizer);
        _computer = computer;
        _localizer = localizer;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public HashCalculatorState State
    {
        get => _state;
        private set
        {
            if (_state == value)
            {
                return;
            }

            _state = value;
            Raise(nameof(State));
            Raise(nameof(IsComputing));
            Raise(nameof(IsEmpty));
            Raise(nameof(HasHash));
            Raise(nameof(ShowError));
            Raise(nameof(ShowResultIdle));
            Raise(nameof(ResultTrayStatus));
            Raise(nameof(CanCompute));
        }
    }

    /// <summary>
    /// The text to hash (the web <c>inputVal</c> state). Reassigning re-enables / disables the Compute action
    /// (web <c>if (!inputVal) return</c>); it does not clear a previously computed digest, mirroring the web
    /// tool, which only replaces <c>hashResult</c> on the next compute.
    /// </summary>
    public string InputText
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
            Raise(nameof(InputText));
            Raise(nameof(CanCompute));
        }
    }

    /// <summary>True while the digest is in flight — the Compute button spins and disables (web <c>computing</c>).</summary>
    public bool IsComputing => _state == HashCalculatorState.Computing;

    /// <summary>True before any digest has settled and none is in flight (the initial card surface).</summary>
    public bool IsEmpty => _state == HashCalculatorState.Empty;

    /// <summary>True when a successful digest is available to show + copy (web <c>hashResult</c> truthy).</summary>
    public bool HasHash => _hash is not null;

    /// <summary>True when the last run faulted — render the localized "Hash Error" line (web <c>catch</c>).</summary>
    public bool ShowError => _faulted;

    /// <summary>
    /// True when the result region shows the friendly idle line: before any run and while a first run is in
    /// flight. The region is never a blank box (the web hides its result block; the native surface always
    /// shows a resting line per the engineering guideline).
    /// </summary>
    public bool ShowResultIdle => !HasHash && !ShowError;

    /// <summary>The lowercase SHA-256 hex digest of the last successful run, or null (web <c>hashResult</c>).</summary>
    public string? HashResult => _hash;

    /// <summary>True when a digest run can be started now: none is in flight and the input is non-empty.</summary>
    public bool CanCompute => !_running && !string.IsNullOrEmpty(_input);

    /// <summary>The semantic tint for the result tray (danger for a hex digest or an error, neutral when idle).</summary>
    public StatusKind ResultTrayStatus => HasHash || ShowError ? StatusKind.Danger : StatusKind.Neutral;

    /// <summary>The last settled-run message surfaced to the accessibility live region (null until a run settles).</summary>
    public string? LastAnnouncement
    {
        get => _lastAnnouncement;
        private set
        {
            if (string.Equals(_lastAnnouncement, value, StringComparison.Ordinal))
            {
                return;
            }

            _lastAnnouncement = value;
            Raise(nameof(LastAnnouncement));
        }
    }

    /// <summary>Localized card title (web <c>t('Hash Calculator')</c>).</summary>
    public string Title => HashCalculatorRegistration.Title(_localizer);

    /// <summary>Localized card description (web <c>t('Hash Calculator Desc')</c>).</summary>
    public string Description => HashCalculatorRegistration.Description(_localizer);

    /// <summary>Localized input-field label (web <c>t('Hash Input')</c>).</summary>
    public string InputLabel => _localizer.GetString("Hash Input", "Hash Input");

    /// <summary>Localized empty-field hint shown in the input before typing (the web textarea prompt text).</summary>
    public string InputHint => _localizer.GetString("Hash Placeholder", "Hash Placeholder"); // parity:allow web HashCalculator.tsx t('Hash Placeholder') i18n key

    /// <summary>Localized Compute button label (web <c>t('devtools.utils.computeSha256', 'Compute Sha256')</c>).</summary>
    public string ComputeLabel => _localizer.GetString("devtools.utils.computeSha256", "Compute Sha256");

    /// <summary>Localized Compute button Narrator name (the action label, scoped to SHA-256).</summary>
    public string ComputeActionName => ComputeLabel;

    /// <summary>Localized in-flight Narrator announcement for the Compute action.</summary>
    public string ComputingLabel => _localizer.GetString("devtools.hashCalculator.computing", "Computing hash");

    /// <summary>Localized fault message (web <c>t('Hash Error')</c>).</summary>
    public string HashErrorLabel => _localizer.GetString("Hash Error", "Hash Error");

    /// <summary>Localized idle result line shown before the first digest (the never-blank resting line).</summary>
    public string NoResultLabel => _localizer.GetString("devtools.hashCalculator.noResult", "No hash yet");

    /// <summary>Localized Narrator name / title for the result region.</summary>
    public string ResultLabel => _localizer.GetString("devtools.hashCalculator.result", "SHA-256 hash");

    /// <summary>Localized success announcement surfaced to the accessibility live region.</summary>
    public string ReadyAnnouncement => _localizer.GetString("devtools.hashCalculator.ready", "SHA-256 hash ready");

    /// <summary>Localized copy affordance idle label (the shared web <c>CopyButton</c>).</summary>
    public string CopyLabel => _localizer.GetString("common.copyButton.copy", "Copy");

    /// <summary>Localized copy affordance confirmation label (the shared web <c>CopyButton</c>).</summary>
    public string CopiedLabel => _localizer.GetString("common.copyButton.copied", "Copied");

    /// <summary>
    /// Compute the SHA-256 digest of <see cref="InputText"/> — the native port of the web <c>compute()</c>: it
    /// no-ops on an empty input (web <c>if (!inputVal) return</c>) and while a run is in flight, marks the
    /// surface computing (the button spins), drives the input through the digest seam, and folds the settled
    /// outcome into <see cref="State"/> + the result tray, announcing the outcome to the accessibility live
    /// region. A superseding run (or disposal) cancels the prior one and is dropped silently.
    /// </summary>
    /// <param name="cancellationToken">Cancels this run when superseded or disposed.</param>
    public async Task ComputeAsync(CancellationToken cancellationToken = default)
    {
        if (_running || _disposed || string.IsNullOrEmpty(_input))
        {
            return;
        }

        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        string input = _input;
        LastAnnouncement = null;
        _running = true;
        RecomputeState();
        Raise(nameof(CanCompute));

        try
        {
            var outcome = await _computer.ComputeAsync(input, cts.Token).ConfigureAwait(false);
            ApplyOutcome(outcome);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer run (or disposed) — drop this emission silently.
        }
        finally
        {
            if (ReferenceEquals(Volatile.Read(ref _cts), cts))
            {
                Interlocked.CompareExchange(ref _cts, null, cts);
                cts.Dispose();
            }
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
        GC.SuppressFinalize(this);
    }

    private void ApplyOutcome(HashCalculatorOutcome outcome)
    {
        _running = false;

        if (outcome.Ok && outcome.Hash is { } hash)
        {
            _hash = hash;
            _faulted = false;
            RecomputeState();
            Raise(nameof(HashResult));
            LastAnnouncement = ReadyAnnouncement;
        }
        else
        {
            _hash = null;
            _faulted = true;
            RecomputeState();
            Raise(nameof(HashResult));
            LastAnnouncement = HashErrorLabel;
        }

        Raise(nameof(CanCompute));
    }

    private void RecomputeState() =>
        State = _running
            ? HashCalculatorState.Computing
            : _faulted
                ? HashCalculatorState.Failed
                : _hash is not null
                    ? HashCalculatorState.Computed
                    : HashCalculatorState.Empty;

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
