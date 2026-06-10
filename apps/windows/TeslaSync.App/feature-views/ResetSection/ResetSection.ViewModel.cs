using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ResetSection"/> view — the native port of the web
/// <c>ResetSection</c> component (web/src/features/settings/components/ResetSection.tsx). It owns the static,
/// always-rendered section list and deny-list (web <c>useSectionRows</c> / <c>useDeniedRows</c>) and drives the
/// two reset mutations (web <c>useResetSection</c> / <c>useResetAllSettings</c>) behind their confirmation
/// gates: a per-section danger confirm and a danger-zone confirm that requires the user to type
/// <c>RESET</c> (web <c>requireTypedConfirmation</c>). There is no read-side query, so the list never shows a
/// loading / empty / stale / offline state — only the in-flight (busy) state of each mutation and the inline
/// success / failure line that mirrors the web toast. Drive it from one confinement (the UI thread); it is
/// not internally synchronised.
/// </summary>
public sealed class ResetSectionViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISettingsResetSource _source;
    private readonly ILocalizer _localizer;
    private readonly ResetSectionDiagnostics _diagnostics;
    private readonly CancellationTokenSource _cts = new();

    private ResetSectionRow? _pendingSection;
    private bool _isSectionConfirmOpen;
    private bool _isResetAllOpen;
    private bool _isSectionBusy;
    private bool _isResetAllBusy;
    private string? _statusMessage;
    private bool _statusIsError;
    private bool _disposed;

    /// <summary>Creates the holder over its reset source, localizer and (optional) diagnostics sink.</summary>
    /// <param name="source">The reset mutation port (single-section + global reset).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public ResetSectionViewModel(
        ISettingsResetSource source,
        ILocalizer localizer,
        ResetSectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new ResetSectionDiagnostics();

        Sections = ResetSectionProjection.Sections(localizer);
        DeniedRows = ResetSectionProjection.DeniedRows(localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with a localized transient message for the toast surface (web <c>useToast</c>).</summary>
    public event EventHandler<string>? ToastRequested;

    // ── Static content (web useSectionRows / useDeniedRows) ──────────────────────────────────────────────

    /// <summary>The eight whitelisted, user-resettable section rows (web <c>useSectionRows</c>).</summary>
    public IReadOnlyList<ResetSectionRow> Sections { get; }

    /// <summary>The two read-only deny-list rows (web <c>useDeniedRows</c>).</summary>
    public IReadOnlyList<ResetDeniedRow> DeniedRows { get; }

    // ── Header / panel copy ──────────────────────────────────────────────────────────────────────────────

    /// <summary>By-section panel heading (web <c>settingsReset.title</c>).</summary>
    public string Title => ResetSectionRegistration.Title(_localizer);

    /// <summary>By-section panel subtitle (web <c>settingsReset.subtitle</c>).</summary>
    public string Subtitle => ResetSectionRegistration.Subtitle(_localizer);

    /// <summary>Per-row reset button label (web <c>settingsReset.actions.reset</c>).</summary>
    public string ResetActionLabel => ResetSectionRegistration.ResetAction(_localizer);

    /// <summary>Deny-list panel title (web <c>settingsReset.deniedTitle</c>).</summary>
    public string DeniedTitle => ResetSectionRegistration.DeniedTitle(_localizer);

    /// <summary>Deny-list panel subtitle (web <c>settingsReset.deniedSubtitle</c>).</summary>
    public string DeniedSubtitle => ResetSectionRegistration.DeniedSubtitle(_localizer);

    /// <summary>Danger-zone panel title (web <c>settingsReset.dangerZone.title</c>).</summary>
    public string DangerZoneTitle => ResetSectionRegistration.DangerZoneTitle(_localizer);

    /// <summary>Danger-zone panel subtitle (web <c>settingsReset.dangerZone.subtitle</c>).</summary>
    public string DangerZoneSubtitle => ResetSectionRegistration.DangerZoneSubtitle(_localizer);

    /// <summary>Danger-zone helper line (web <c>settingsReset.dangerZone.help</c>).</summary>
    public string DangerZoneHelp => ResetSectionRegistration.DangerZoneHelp(_localizer);

    /// <summary>Danger-zone CTA label (web <c>settingsReset.dangerZone.cta</c>).</summary>
    public string DangerZoneCta => ResetSectionRegistration.DangerZoneCta(_localizer);

    // ── Confirm-dialog copy ──────────────────────────────────────────────────────────────────────────────

    /// <summary>Per-section confirm primary label (web <c>settingsReset.confirm.confirmLabel</c>).</summary>
    public string ConfirmLabel => ResetSectionRegistration.ConfirmLabel(_localizer);

    /// <summary>Shared cancel label (web <c>settingsReset.confirm.cancelLabel</c>).</summary>
    public string CancelLabel => ResetSectionRegistration.CancelLabel(_localizer);

    /// <summary>Danger-zone confirm title (web <c>settingsReset.confirm.allTitle</c>).</summary>
    public string AllConfirmTitle => ResetSectionRegistration.AllConfirmTitle(_localizer);

    /// <summary>Danger-zone confirm message (web <c>settingsReset.confirm.allMessage</c>).</summary>
    public string AllConfirmMessage => ResetSectionRegistration.AllConfirmMessage(_localizer);

    /// <summary>Danger-zone confirm primary label (web <c>settingsReset.confirm.allConfirmLabel</c>).</summary>
    public string AllConfirmLabel => ResetSectionRegistration.AllConfirmLabel(_localizer);

    /// <summary>Danger-zone typed-confirmation field label (web <c>settingsReset.confirm.typedLabel</c>).</summary>
    public string TypedConfirmationLabel => ResetSectionRegistration.TypedConfirmationLabel(_localizer);

    /// <summary>The per-section confirm title for the pending row (empty when no section is pending).</summary>
    public string SectionConfirmTitle =>
        _pendingSection is { } row ? ResetSectionProjection.SectionConfirmTitle(row, _localizer) : string.Empty;

    /// <summary>The per-section confirm message for the pending row (empty when no section is pending).</summary>
    public string SectionConfirmMessage =>
        _pendingSection is { } row ? ResetSectionProjection.SectionConfirmMessage(row, _localizer) : string.Empty;

    // ── Interaction state ────────────────────────────────────────────────────────────────────────────────

    /// <summary>The section currently being confirmed / reset, or null.</summary>
    public ResetSectionRow? PendingSection
    {
        get => _pendingSection;
        private set
        {
            if (Set(ref _pendingSection, value))
            {
                Raise(nameof(SectionConfirmTitle));
                Raise(nameof(SectionConfirmMessage));
            }
        }
    }

    /// <summary>True while the per-section confirm dialog should be shown (web <c>open={pending !== null}</c>).</summary>
    public bool IsSectionConfirmOpen
    {
        get => _isSectionConfirmOpen;
        private set => Set(ref _isSectionConfirmOpen, value);
    }

    /// <summary>True while the danger-zone confirm dialog should be shown (web <c>open={resetAllOpen}</c>).</summary>
    public bool IsResetAllOpen
    {
        get => _isResetAllOpen;
        private set => Set(ref _isResetAllOpen, value);
    }

    /// <summary>True while a single-section reset is in flight (web <c>sectionMut.isPending</c>).</summary>
    public bool IsSectionBusy
    {
        get => _isSectionBusy;
        private set
        {
            if (Set(ref _isSectionBusy, value))
            {
                Raise(nameof(IsBusy));
            }
        }
    }

    /// <summary>True while the global reset is in flight (web <c>allMut.isPending</c>).</summary>
    public bool IsResetAllBusy
    {
        get => _isResetAllBusy;
        private set
        {
            if (Set(ref _isResetAllBusy, value))
            {
                Raise(nameof(IsBusy));
            }
        }
    }

    /// <summary>True while any reset is in flight.</summary>
    public bool IsBusy => _isSectionBusy || _isResetAllBusy;

    /// <summary>The inline status line text after a reset (web success / error toast), or null.</summary>
    public string? StatusMessage
    {
        get => _statusMessage;
        private set => Set(ref _statusMessage, value);
    }

    /// <summary>True when <see cref="StatusMessage"/> describes a failure (renders as an error line).</summary>
    public bool StatusIsError
    {
        get => _statusIsError;
        private set => Set(ref _statusIsError, value);
    }

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The per-row busy flag (web <c>busy={sectionBusy &amp;&amp; pending?.id === row.id}</c>).</summary>
    public bool IsBusyForSection(ResetSectionRow row)
    {
        ArgumentNullException.ThrowIfNull(row);
        return _isSectionBusy && string.Equals(_pendingSection?.Id, row.Id, StringComparison.Ordinal);
    }

    /// <summary>Record that the surface was opened (web mount) — emits the <c>view.opened</c> diagnostics event.</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Open the per-section confirm dialog for <paramref name="row"/> (web row "Reset" click).</summary>
    public void RequestSectionReset(ResetSectionRow row)
    {
        ArgumentNullException.ThrowIfNull(row);
        if (IsBusy)
        {
            return;
        }

        PendingSection = row;
        IsSectionConfirmOpen = true;
    }

    /// <summary>Dismiss the per-section confirm dialog without resetting (web <c>onCancel</c>).</summary>
    public void CancelSectionReset()
    {
        IsSectionConfirmOpen = false;
        if (!_isSectionBusy)
        {
            PendingSection = null;
        }
    }

    /// <summary>
    /// Confirm and run the pending single-section reset (web <c>handleConfirmSection</c>): POST the section,
    /// announce the success detail, and clear the pending row. A failure surfaces the error line; a
    /// cancellation is swallowed silently.
    /// </summary>
    public async Task ConfirmSectionResetAsync()
    {
        if (_pendingSection is not { } row || IsBusy)
        {
            return;
        }

        IsSectionConfirmOpen = false;
        ClearStatus();
        IsSectionBusy = true;
        try
        {
            var result = await _source.ResetSectionAsync(row.Id, _cts.Token).ConfigureAwait(false);
            _diagnostics.RecordSectionReset();
            AnnounceSuccess(result);
        }
        catch (OperationCanceledException)
        {
            // Superseded / disposed — leave the surface as-is (web no-ops on a cancelled step-up).
        }
        catch (Exception)
        {
            AnnounceError(ResetSectionRegistration.SectionErrorMessage(_localizer));
        }
        finally
        {
            IsSectionBusy = false;
            PendingSection = null;
        }
    }

    /// <summary>Open the danger-zone confirm dialog (web "Reset ALL settings" click).</summary>
    public void RequestResetAll()
    {
        if (IsBusy)
        {
            return;
        }

        IsResetAllOpen = true;
    }

    /// <summary>Dismiss the danger-zone confirm dialog without resetting (web <c>onCancel</c>).</summary>
    public void CancelResetAll() => IsResetAllOpen = false;

    /// <summary>
    /// Confirm and run the global reset (web <c>handleConfirmAll</c>): POST the empty body, announce the
    /// success detail, and close the dialog. A failure surfaces the error line; a cancellation is swallowed.
    /// </summary>
    public async Task ConfirmResetAllAsync()
    {
        if (IsBusy)
        {
            return;
        }

        IsResetAllOpen = false;
        ClearStatus();
        IsResetAllBusy = true;
        try
        {
            var result = await _source.ResetAllAsync(_cts.Token).ConfigureAwait(false);
            _diagnostics.RecordAllReset();
            AnnounceSuccess(result);
        }
        catch (OperationCanceledException)
        {
            // Superseded / disposed — leave the surface as-is.
        }
        catch (Exception)
        {
            AnnounceError(ResetSectionRegistration.AllErrorMessage(_localizer));
        }
        finally
        {
            IsResetAllBusy = false;
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
        _cts.Cancel();
        _cts.Dispose();
    }

    private void AnnounceSuccess(SettingsResetResult result)
    {
        StatusIsError = false;
        string detail = ResetSectionProjection.SuccessDetail(result.Reset, result.Sections.Count, _localizer);
        StatusMessage = detail;
        RaiseToast(detail);
    }

    private void AnnounceError(string message)
    {
        StatusIsError = true;
        StatusMessage = message;
        RaiseToast(message);
    }

    private void ClearStatus()
    {
        StatusMessage = null;
        StatusIsError = false;
    }

    private void RaiseToast(string message) => ToastRequested?.Invoke(this, message);

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
