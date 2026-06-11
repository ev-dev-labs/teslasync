using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 <c>AcknowledgeAlertDialog</c> surface — a parity port of
/// web/src/features/admin/components/AcknowledgeAlertDialog.tsx. It presents a <see cref="TsModal"/>
/// ("Acknowledge alert") whose body stacks the web form: an optional acked-alert subtitle (shown only when an
/// alert title is supplied), an auto-focused optional note field (a multi-line <see cref="TsTextarea"/> capped at
/// <see cref="AcknowledgeAlertRegistration.NoteInputMaxLength"/> with a too-long validation error once the trimmed
/// note exceeds <see cref="AcknowledgeAlertRegistration.NoteMaxLength"/>) and an always-shown hint. The primary
/// action ("Acknowledge") is gated on the note being within the cap and no ack being in flight
/// (web <c>disabled={submitting || tooLong}</c>); confirming raises <see cref="Acknowledged"/> with the trimmed
/// note (which may be empty) and closes, while Cancel raises <see cref="Cancelled"/> — and is blocked while an ack
/// is in flight (web <c>onClose</c> guarded by <c>!submitting</c>). The actual ack mutation is owned by the parent
/// (web <c>AlertsPage</c>), so this surface is a pure callback form with no read query — it never shows a loading /
/// empty / error / stale / offline state. The view never performs HTTP or holds business logic — it binds the
/// shared <see cref="AcknowledgeAlertDialogViewModel"/>. Every string resolves through the i18n facade, every
/// interactive element carries a Narrator name, and the surface adds no bespoke motion so reduced-motion is
/// honoured by construction.
/// </summary>
public sealed partial class AcknowledgeAlertDialog : ContentControl, IDisposable
{
    private const double FormMinWidth = 420;
    private const double FormMaxHeight = 480;
    private const double FieldSpacing = 16;
    private const double GroupSpacing = 4;
    private const double NoteMinHeight = 96;

    private readonly AcknowledgeAlertDialogViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _form = new() { Spacing = FieldSpacing, MinWidth = FormMinWidth };
    private readonly TsTextarea _noteInput = new();
    private readonly ErrorText _noteError = new() { Visibility = Visibility.Collapsed };

    private TsModal? _dialog;
    private bool _started;
    private bool _shown;
    private bool _closeRaised;
    private bool _disposed;

    /// <summary>Creates the surface over the optional acked-alert title, the localizer and a diagnostics sink.</summary>
    /// <param name="alertTitle">The title of the alert being acked, shown as a subtitle (web <c>alertTitle</c>).</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public AcknowledgeAlertDialog(
        string? alertTitle,
        ILocalizer localizer,
        AcknowledgeAlertDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new AcknowledgeAlertDialogViewModel(alertTitle, localizer, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAutomationId(this, "acknowledge-alert-dialog");
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildForm();
        Content = _form;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.AcknowledgeRequested += OnViewModelAcknowledgeRequested;
        _viewModel.CloseRequested += OnViewModelCloseRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>Raised when the user acknowledges the alert with the trimmed note (web <c>onSubmit</c>).</summary>
    public event EventHandler<AcknowledgeAlertDraft>? Acknowledged;

    /// <summary>Raised when the user cancels / dismisses the dialog without acknowledging (web <c>onClose</c>).</summary>
    public event EventHandler? Cancelled;

    /// <summary>Raised once the modal has closed (for any reason): acknowledge, cancel, or dismiss.</summary>
    public event EventHandler? Closed;

    /// <summary>The canonical surface slug (<c>AcknowledgeAlertDialog</c>).</summary>
    public static string SurfaceId => AcknowledgeAlertRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting — e.g. the parent drives <c>Submitting</c>).</summary>
    public AcknowledgeAlertDialogViewModel ViewModel => _viewModel;

    /// <summary>
    /// Present the modal over <paramref name="xamlRoot"/> (web <c>&lt;Modal open&gt;</c>). Idempotent: a second
    /// call while the dialog is showing is a no-op. Resolves when the modal has closed.
    /// </summary>
    public async Task ShowAsync(XamlRoot xamlRoot)
    {
        ArgumentNullException.ThrowIfNull(xamlRoot);
        if (_shown || _disposed)
        {
            return;
        }

        _shown = true;
        var dialog = new TsModal
        {
            Title = _viewModel.Title,
            PrimaryButtonText = _viewModel.SubmitLabel,
            CloseButtonText = _viewModel.CancelLabel,
            DefaultButton = ContentDialogButton.Primary,
            IsPrimaryButtonEnabled = _viewModel.CanSubmit,
            XamlRoot = xamlRoot,
            Content = new ScrollViewer
            {
                Content = _form,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollMode = ScrollMode.Disabled,
                MaxHeight = FormMaxHeight,
            },
        };
        AutomationProperties.SetAutomationId(dialog, "acknowledge-alert-dialog-surface");
        AutomationProperties.SetName(dialog, _viewModel.Title);
        dialog.PrimaryButtonClick += OnPrimaryButtonClick;
        dialog.CloseButtonClick += OnCloseButtonClick;
        dialog.Closed += OnDialogClosed;
        _dialog = dialog;

        try
        {
            await dialog.ShowAsync();
        }
        catch (COMException)
        {
            // Another ContentDialog is already open on this XamlRoot — the host owns ordering; surface nothing.
            _shown = false;
            _dialog = null;
        }
    }

    /// <summary>Detach from the view-model, dismiss the dialog and release handlers (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.AcknowledgeRequested -= OnViewModelAcknowledgeRequested;
        _viewModel.CloseRequested -= OnViewModelCloseRequested;
        _dialog?.Hide();
    }

    private void BuildForm()
    {
        if (_viewModel.HasAlertTitle)
        {
            var subtitle = new Subhead { Value = _viewModel.AlertTitle };
            AutomationProperties.SetAutomationId(subtitle, "acknowledge-alert-subtitle");
            _form.Children.Add(subtitle);
        }

        _noteInput.MaxLength = AcknowledgeAlertRegistration.NoteInputMaxLength;
        _noteInput.Hint = _viewModel.NotePrompt;
        _noteInput.MinHeight = NoteMinHeight;
        AutomationProperties.SetName(_noteInput, _viewModel.NoteLabel);
        AutomationProperties.SetFullDescription(_noteInput, _viewModel.NoteHint);
        AutomationProperties.SetAutomationId(_noteInput, "acknowledge-alert-note");
        _noteInput.TextChanged += OnNoteChanged;
        _noteInput.Loaded += (_, _) => _noteInput.Focus(FocusState.Programmatic);

        AutomationProperties.SetAutomationId(_noteError, "acknowledge-alert-note-error");
        LiveRegion.Configure(_noteError, assertive: true);

        var noteGroup = new StackPanel { Spacing = GroupSpacing };
        noteGroup.Children.Add(new Label { Value = _viewModel.NoteLabel });
        noteGroup.Children.Add(_noteInput);
        noteGroup.Children.Add(_noteError);
        noteGroup.Children.Add(new HelperText { Value = _viewModel.NoteHint });

        _form.Children.Add(noteGroup);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        if (XamlRoot is { } xamlRoot)
        {
            _ = ShowAsync(xamlRoot);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnNoteChanged(object sender, TextChangedEventArgs e) => _viewModel.Note = _noteInput.Text;

    private void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        if (!_viewModel.Submit())
        {
            // Over the length cap or an ack already in flight — keep the modal open (web early-return parity).
            args.Cancel = true;
        }
    }

    private void OnCloseButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        if (!_viewModel.RequestClose())
        {
            // An ack is in flight — block dismissal (web onClose guarded by !submitting).
            args.Cancel = true;
        }
    }

    private void OnViewModelAcknowledgeRequested(object? sender, AcknowledgeAlertDraft draft) =>
        Acknowledged?.Invoke(this, draft);

    private void OnViewModelCloseRequested(object? sender, EventArgs e) =>
        Marshal(() =>
        {
            Cancelled?.Invoke(this, EventArgs.Empty);
            _dialog?.Hide();
        });

    private void OnDialogClosed(ContentDialog sender, ContentDialogClosedEventArgs args)
    {
        sender.PrimaryButtonClick -= OnPrimaryButtonClick;
        sender.CloseButtonClick -= OnCloseButtonClick;
        sender.Closed -= OnDialogClosed;
        _dialog = null;
        RaiseClosed();
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(() => ApplyViewModelState(e.PropertyName));

    private void ApplyViewModelState(string? propertyName)
    {
        switch (propertyName)
        {
            case nameof(AcknowledgeAlertDialogViewModel.CanSubmit):
                if (_dialog is { } dialog)
                {
                    dialog.IsPrimaryButtonEnabled = _viewModel.CanSubmit;
                }

                break;
            case nameof(AcknowledgeAlertDialogViewModel.Submitting):
                _noteInput.IsEnabled = !_viewModel.Submitting;
                break;
            case nameof(AcknowledgeAlertDialogViewModel.HasNoteError):
            case nameof(AcknowledgeAlertDialogViewModel.NoteError):
                ApplyFieldError(_noteError, _viewModel.HasNoteError, _viewModel.NoteError);
                break;
            default:
                break;
        }
    }

    private static void ApplyFieldError(ErrorText error, bool hasError, string? message)
    {
        error.Value = message ?? string.Empty;
        error.Visibility = hasError ? Visibility.Visible : Visibility.Collapsed;
        if (hasError)
        {
            LiveRegion.Announce(error);
        }
    }

    private void RaiseClosed()
    {
        if (_closeRaised)
        {
            return;
        }

        _closeRaised = true;
        Closed?.Invoke(this, EventArgs.Empty);
    }

    private void Marshal(DispatcherQueueHandler action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(action);
        }
        else
        {
            action();
        }
    }
}
