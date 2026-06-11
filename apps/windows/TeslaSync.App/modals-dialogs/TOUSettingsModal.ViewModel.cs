using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TouSettingsModal"/> view — the native port of the web
/// <c>TOUSettingsModal</c> component (web/src/features/battery/components/TOUSettingsModal.tsx). It owns the
/// editable fields (the active <see cref="Mode"/>, the chosen <see cref="SelectedPlanId"/> and the
/// <see cref="CustomJson"/> text — the web <c>useState</c> values), exposes the read-only preset
/// <see cref="SelectedPreview"/>, runs the <c>getPayload()</c> validation behind the submit gate and drives the
/// save mutation (web <c>useUpdateTOUSettings</c>) plus the follow-up site-info refresh (web
/// <c>useRefreshTeslaEnergySiteInfo</c>). The web component is a write-only modal — there is no read query, so
/// the surface never shows a loading / stale / offline state; its states are the two input tabs, the read-only
/// preview (with a friendly empty hint before a plan is chosen), the inline validation / submit error, the
/// in-flight (saving) state, and the success-and-close path. Drive it from one confinement (the UI thread); it is
/// not internally synchronised.
/// </summary>
public sealed class TouSettingsModalViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly long _siteId;
    private readonly ITouSettingsUpdateSource _update;
    private readonly ITouSiteInfoRefreshSource _refresh;
    private readonly ILocalizer _localizer;
    private readonly TouSettingsModalDiagnostics _diagnostics;
    private readonly CancellationTokenSource _cts = new();

    private TouInputMode _mode = TouInputMode.Preset;
    private string _selectedPlanId = string.Empty;
    private string _customJson = string.Empty;
    private string _selectedPreview = string.Empty;
    private string? _errorMessage;
    private bool _isSubmitting;
    private bool _disposed;

    /// <summary>Creates the holder over the site id, its save + refresh sources, localizer and (optional) diagnostics.</summary>
    /// <param name="siteId">The Tesla energy-site id the save targets (web <c>siteId</c> prop).</param>
    /// <param name="update">The TOU save mutation port (web <c>useUpdateTOUSettings</c>).</param>
    /// <param name="refresh">The site-info refresh port (web <c>useRefreshTeslaEnergySiteInfo</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public TouSettingsModalViewModel(
        long siteId,
        ITouSettingsUpdateSource update,
        ITouSiteInfoRefreshSource refresh,
        ILocalizer localizer,
        TouSettingsModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(update);
        ArgumentNullException.ThrowIfNull(refresh);
        ArgumentNullException.ThrowIfNull(localizer);

        _siteId = siteId;
        _update = update;
        _refresh = refresh;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new TouSettingsModalDiagnostics();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with a localized message for the toast surface (web save / refresh mutation toasts).</summary>
    public event EventHandler<TouSettingsToast>? ToastRequested;

    /// <summary>Raised when the modal should close (web <c>onClose()</c>): after a successful save or a cancel.</summary>
    public event EventHandler? CloseRequested;

    // ── Static content ───────────────────────────────────────────────────────────────────────────────────

    /// <summary>The rate-plan dropdown options in web render order (web <c>presetOptions</c>).</summary>
    public IReadOnlyList<TouRatePlanOption> RatePlanOptions { get; } = TouSettingsModalProjection.RatePlanOptions;

    // ── Header / field copy (the Narrator-label source) ──────────────────────────────────────────────────

    /// <summary>Modal title (web <c>Update Rate Plan</c>).</summary>
    public string Title => TouSettingsModalRegistration.Title(_localizer);

    /// <summary>Intro description paragraph (web <c>energy.tou.description</c>).</summary>
    public string Description => TouSettingsModalRegistration.Description(_localizer);

    /// <summary>Preset tab label (web <c>Preset Tariff</c>).</summary>
    public string PresetTabLabel => TouSettingsModalRegistration.PresetTabLabel(_localizer);

    /// <summary>Custom tab label (web <c>Custom JSON</c>).</summary>
    public string CustomTabLabel => TouSettingsModalRegistration.CustomTabLabel(_localizer);

    /// <summary>Rate-plan dropdown label (web <c>Rate Plan</c>).</summary>
    public string SelectPlanLabel => TouSettingsModalRegistration.SelectPlanLabel(_localizer);

    /// <summary>Rate-plan dropdown prompt (web <c>Choose a rate plan…</c>).</summary>
    public string SelectPrompt => TouSettingsModalRegistration.SelectPrompt(_localizer);

    /// <summary>Preset preview panel label (web <c>Preview</c>).</summary>
    public string PreviewLabel => TouSettingsModalRegistration.PreviewLabel(_localizer);

    /// <summary>Friendly empty-state shown in the preview panel before a plan is chosen.</summary>
    public string PreviewEmpty => TouSettingsModalRegistration.PreviewEmpty(_localizer);

    /// <summary>Custom JSON field label (web <c>TOU Settings JSON</c>).</summary>
    public string CustomLabel => TouSettingsModalRegistration.CustomLabel(_localizer);

    /// <summary>Custom JSON field prompt (the web textarea template).</summary>
    public string CustomPrompt => TouSettingsModalRegistration.CustomPrompt(_localizer);

    /// <summary>Custom JSON field hint (web <c>energy.tou.customHint</c>).</summary>
    public string CustomHint => TouSettingsModalRegistration.CustomHint(_localizer);

    /// <summary>Submit button label (web <c>Update Rate Plan</c>); unchanged while saving (web keeps the label).</summary>
    public string SubmitLabel => TouSettingsModalRegistration.SubmitLabel(_localizer);

    /// <summary>Busy-indicator accessible label shown while saving (stands in for the web submit spinner).</summary>
    public string SavingLabel => TouSettingsModalRegistration.SavingLabel(_localizer);

    /// <summary>Cancel button label (web <c>Cancel</c>).</summary>
    public string CancelLabel => TouSettingsModalRegistration.CancelLabel(_localizer);

    // ── Editable fields (web useState) ───────────────────────────────────────────────────────────────────

    /// <summary>The active input mode (web <c>activeTab</c>; default preset).</summary>
    public TouInputMode Mode
    {
        get => _mode;
        private set
        {
            if (Set(ref _mode, value))
            {
                Raise(nameof(IsPresetMode));
                Raise(nameof(IsCustomMode));
            }
        }
    }

    /// <summary>True while the preset tab is active (web <c>activeTab === 'preset'</c>).</summary>
    public bool IsPresetMode => _mode == TouInputMode.Preset;

    /// <summary>True while the custom-JSON tab is active (web <c>activeTab === 'custom'</c>).</summary>
    public bool IsCustomMode => _mode == TouInputMode.Custom;

    /// <summary>The chosen preset id (web <c>selectedPreset</c>). Setting it re-projects the preview.</summary>
    public string SelectedPlanId
    {
        get => _selectedPlanId;
        set
        {
            if (Set(ref _selectedPlanId, value ?? string.Empty))
            {
                _selectedPreview = TouSettingsModalProjection.PreviewFor(_selectedPlanId);
                Raise(nameof(SelectedPreview));
                Raise(nameof(HasPreview));
            }
        }
    }

    /// <summary>The pasted custom JSON (web <c>customJSON</c>).</summary>
    public string CustomJson
    {
        get => _customJson;
        set => Set(ref _customJson, value ?? string.Empty);
    }

    /// <summary>The pretty-printed preview of the chosen preset (web <c>JSON.stringify(settings, null, 2)</c>), or empty.</summary>
    public string SelectedPreview => _selectedPreview;

    /// <summary>True once a preset is chosen and a preview is available (web <c>selectedPreset &amp;&amp; …</c>).</summary>
    public bool HasPreview => _selectedPreview.Length > 0;

    // ── Interaction state ────────────────────────────────────────────────────────────────────────────────

    /// <summary>The inline validation / submit-failure message, or null (web <c>error</c>).</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set
        {
            if (Set(ref _errorMessage, value))
            {
                Raise(nameof(HasError));
            }
        }
    }

    /// <summary>True while an inline error should render (web <c>{error &amp;&amp; …}</c>).</summary>
    public bool HasError => _errorMessage is not null;

    /// <summary>True while the save mutation is in flight (web <c>updateMutation.isPending</c>): buttons disabled.</summary>
    public bool IsSubmitting
    {
        get => _isSubmitting;
        private set
        {
            if (Set(ref _isSubmitting, value))
            {
                Raise(nameof(CanSubmit));
            }
        }
    }

    /// <summary>
    /// True when the submit button is enabled — whenever no save is in flight (web parity: the submit button is
    /// only disabled while pending; validation runs on click, not as an enable gate).
    /// </summary>
    public bool CanSubmit => !_isSubmitting;

    /// <summary>
    /// The in-flight site-info refresh task started after a successful save (web fire-and-forget
    /// <c>refreshSiteInfo.mutate(siteId)</c>), or null before the first successful save. Exposed so a host can
    /// keep its toast subscription alive until the refresh settles and so tests can await it deterministically.
    /// </summary>
    public Task? PendingRefresh { get; private set; }

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Emit the <c>view.opened</c> diagnostics event (web mount).</summary>
    public void NotifyOpened()
    {
        if (!_disposed)
        {
            _diagnostics.RecordViewOpened();
        }
    }

    /// <summary>Switch the active input tab (web <c>setActiveTab</c>).</summary>
    public void SetMode(TouInputMode mode) => Mode = mode;

    /// <summary>
    /// Validate and save the rate plan (web <c>handleSubmit</c>). It clears any prior error, assembles the payload
    /// from the active tab (an invalid input surfaces the inline error without saving), then runs the save
    /// mutation. A success records the diagnostic, raises the save toast, fires the site-info refresh (web
    /// <c>refreshSiteInfo.mutate</c>) and a close request; a failure surfaces the inline error + error toast and
    /// keeps the modal open. Returns true only when the settings were saved (the view then closes).
    /// </summary>
    public async Task<bool> SubmitAsync(CancellationToken cancellationToken = default)
    {
        if (_isSubmitting || _disposed)
        {
            return false;
        }

        // web getPayload() begins with setError('').
        ErrorMessage = null;

        var result = TouSettingsModalProjection.BuildPayload(_mode, _selectedPlanId, _customJson);
        if (!result.Success)
        {
            ErrorMessage = TouSettingsModalRegistration.ValidationMessage(_localizer, result.Error);
            return false;
        }

        IsSubmitting = true;
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token, cancellationToken);
        try
        {
            var outcome = await _update.UpdateAsync(_siteId, result.Payload!, linked.Token).ConfigureAwait(false);
            if (outcome.Success)
            {
                _diagnostics.RecordSettingsSaved();
                RaiseToast(TouSettingsModalRegistration.SaveSuccessToast(_localizer), isError: false);

                // Refresh site info from Tesla so the parent UI shows the updated tariff (web fire-and-forget).
                PendingRefresh = RefreshSiteInfoAsync();
                RaiseClose();
                return true;
            }

            ErrorMessage = outcome.Error?.Message ?? TouSettingsModalRegistration.SaveErrorToast(_localizer);
            RaiseToast(TouSettingsModalRegistration.SaveErrorToast(_localizer), isError: true);
            return false;
        }
        catch (OperationCanceledException)
        {
            // Superseded / disposed — leave the surface as-is (web no-ops on an aborted mutation).
            return false;
        }
        finally
        {
            IsSubmitting = false;
        }
    }

    /// <summary>Dismiss the modal without saving (web <c>Cancel</c> / <c>handleClose</c>); ignored while saving.</summary>
    public void RequestClose()
    {
        if (_isSubmitting)
        {
            return;
        }

        RaiseClose();
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

    // The site-info refresh runs independent of the modal's lifetime (web fires it then closes immediately), so it
    // uses an uncancellable token; its toast is suppressed once the surface is disposed.
    private async Task RefreshSiteInfoAsync()
    {
        TouSettingsOutcome outcome;
        try
        {
            outcome = await _refresh.RefreshAsync(_siteId, CancellationToken.None).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        if (_disposed)
        {
            return;
        }

        RaiseToast(
            outcome.Success
                ? TouSettingsModalRegistration.RefreshSuccessToast(_localizer)
                : TouSettingsModalRegistration.RefreshErrorToast(_localizer),
            isError: !outcome.Success);
    }

    private void RaiseToast(string message, bool isError) =>
        ToastRequested?.Invoke(this, new TouSettingsToast(message, isError));

    private void RaiseClose() => CloseRequested?.Invoke(this, EventArgs.Empty);

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
