using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>IncidentForm</c> feature surface — a parity port of
/// web/src/features/system/components/status/IncidentForm.tsx. It presents a <see cref="TsModal"/>
/// ("Log an incident") whose body stacks the web form: a required title field (3..200), a side-by-side
/// severity / status pair of dropdowns, an optional comma-separated affected-components field, and an optional
/// initial timeline message. The modal's primary action runs the create mutation behind the client-side
/// title gate; a success raises the success toast and closes (web <c>onClose</c>), a failure raises the error
/// toast inside the still-open modal, and a too-short title surfaces an inline field error plus the validation
/// toast — the write-only modal has no read query, so it never shows a loading / empty / stale / offline state.
/// The view never performs HTTP — it binds the shared <see cref="IncidentFormViewModel"/>. Every string
/// resolves through the i18n facade, every interactive element carries a Narrator name, and the surface adds no
/// bespoke motion so reduced-motion is honoured by construction.
/// </summary>
public sealed partial class IncidentForm : ContentControl, IDisposable
{
    private const double FormMinWidth = 360;
    private const double FormMaxHeight = 540;

    private readonly IncidentFormViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _root = new() { Spacing = 12 };
    private readonly InfoBar _toast = new() { IsOpen = false, IsClosable = true };
    private readonly StackPanel _form = new() { Spacing = 16, MinWidth = FormMinWidth };
    private readonly InfoBar _formToast = new() { IsOpen = false, IsClosable = true };
    private readonly TsInput _titleInput = new();
    private readonly ErrorText _titleError = new() { Visibility = Visibility.Collapsed };
    private readonly TsSelect _severitySelect = new();
    private readonly TsSelect _statusSelect = new();
    private readonly TsInput _componentsInput = new();
    private readonly TsTextarea _messageInput = new();

    private TsModal? _dialog;
    private bool _started;
    private bool _shown;
    private bool _closeRaised;
    private bool _disposed;

    /// <summary>Creates the surface over its create source, localizer and (optional) diagnostics sink.</summary>
    /// <param name="source">The create-incident mutation port.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public IncidentForm(
        IIncidentCreateSource source,
        ILocalizer localizer,
        IncidentFormDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new IncidentFormViewModel(source, localizer, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAutomationId(this, "incident-form");
        AutomationProperties.SetName(this, _viewModel.ModalTitle);

        BuildForm();

        _root.Children.Add(_toast);
        AutomationProperties.SetAutomationId(_toast, "incident-form-toast");
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.ToastRequested += OnToastRequested;
        _viewModel.CloseRequested += OnViewModelCloseRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>Raised when the modal has closed (web <c>onClose</c>): cancel, successful submit, or dismiss.</summary>
    public event EventHandler? Closed;

    /// <summary>The canonical surface slug (<c>IncidentForm</c>).</summary>
    public static string SurfaceId => IncidentFormRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public IncidentFormViewModel ViewModel => _viewModel;

    /// <summary>Convenience factory wiring the contract-client-backed <see cref="IncidentCreateSource"/>.</summary>
    /// <param name="api">The shared generated contract client.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public static IncidentForm Create(
        IApiClient api,
        ILocalizer localizer,
        IncidentFormDiagnostics? diagnostics = null) =>
        new(new IncidentCreateSource(api), localizer, diagnostics);

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
            Title = _viewModel.ModalTitle,
            PrimaryButtonText = _viewModel.SubmitLabel,
            CloseButtonText = _viewModel.CancelLabel,
            DefaultButton = ContentDialogButton.Primary,
            IsPrimaryButtonEnabled = true,
            XamlRoot = xamlRoot,
            Content = new ScrollViewer
            {
                Content = _form,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollMode = ScrollMode.Disabled,
                MaxHeight = FormMaxHeight,
            },
        };
        AutomationProperties.SetAutomationId(dialog, "incident-form-dialog");
        AutomationProperties.SetName(dialog, _viewModel.ModalTitle);
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

    /// <summary>Detach from the view-model, dismiss the dialog and cancel in-flight work (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.ToastRequested -= OnToastRequested;
        _viewModel.CloseRequested -= OnViewModelCloseRequested;
        DismissDialog();
        _viewModel.Dispose();
    }

    private void BuildForm()
    {
        _formToast.Severity = InfoBarSeverity.Error;
        AutomationProperties.SetAutomationId(_formToast, "incident-form-error");

        _titleInput.MaxLength = IncidentFormRegistration.TitleMaxLength;
        _titleInput.Hint = _viewModel.TitlePrompt;
        AutomationProperties.SetName(_titleInput, _viewModel.TitleLabel);
        AutomationProperties.SetAutomationId(_titleInput, "incident-form-title");
        _titleInput.TextChanged += OnTitleChanged;
        _titleInput.Loaded += (_, _) => _titleInput.Focus(FocusState.Programmatic);

        AutomationProperties.SetAutomationId(_titleError, "incident-form-title-error");
        LiveRegion.Configure(_titleError, assertive: true);

        PopulateSelect(_severitySelect, _viewModel.SeverityOptions.Select(o => o.Label), "incident-form-severity", _viewModel.SeverityLabel);
        _severitySelect.SelectedIndex = IndexOfSeverity(_viewModel.Severity);
        _severitySelect.SelectionChanged += OnSeverityChanged;

        PopulateSelect(_statusSelect, _viewModel.StatusOptions.Select(o => o.Label), "incident-form-status", _viewModel.StatusLabel);
        _statusSelect.SelectedIndex = IndexOfStatus(_viewModel.Status);
        _statusSelect.SelectionChanged += OnStatusChanged;

        _componentsInput.Hint = _viewModel.ComponentsPrompt;
        AutomationProperties.SetName(_componentsInput, _viewModel.ComponentsLabel);
        AutomationProperties.SetAutomationId(_componentsInput, "incident-form-components");
        _componentsInput.TextChanged += OnComponentsChanged;

        _messageInput.MaxLength = IncidentFormRegistration.MessageMaxLength;
        _messageInput.Hint = _viewModel.MessagePrompt;
        _messageInput.MinHeight = 84;
        AutomationProperties.SetName(_messageInput, _viewModel.MessageLabel);
        AutomationProperties.SetAutomationId(_messageInput, "incident-form-message");
        _messageInput.TextChanged += OnMessageChanged;

        var titleGroup = new StackPanel { Spacing = 4 };
        titleGroup.Children.Add(BuildHeader(_viewModel.TitleLabel, null));
        titleGroup.Children.Add(_titleInput);
        titleGroup.Children.Add(_titleError);

        var severityStatus = new Grid { ColumnSpacing = 12 };
        severityStatus.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        severityStatus.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var severityGroup = BuildLabeledControl(_viewModel.SeverityLabel, null, _severitySelect);
        var statusGroup = BuildLabeledControl(_viewModel.StatusLabel, null, _statusSelect);
        Grid.SetColumn(severityGroup, 0);
        Grid.SetColumn(statusGroup, 1);
        severityStatus.Children.Add(severityGroup);
        severityStatus.Children.Add(statusGroup);

        var componentsGroup = BuildLabeledControl(_viewModel.ComponentsLabel, _viewModel.ComponentsHint, _componentsInput);
        var messageGroup = BuildLabeledControl(_viewModel.MessageLabel, _viewModel.MessageHint, _messageInput);

        _form.Children.Add(_formToast);
        _form.Children.Add(titleGroup);
        _form.Children.Add(severityStatus);
        _form.Children.Add(componentsGroup);
        _form.Children.Add(messageGroup);
    }

    private static void PopulateSelect(TsSelect select, IEnumerable<string> labels, string automationId, string name)
    {
        foreach (var label in labels)
        {
            select.Items.Add(new ComboBoxItem { Content = label });
        }

        AutomationProperties.SetName(select, name);
        AutomationProperties.SetAutomationId(select, automationId);
    }

    private static StackPanel BuildLabeledControl(string label, string? hint, FrameworkElement control)
    {
        var group = new StackPanel { Spacing = 4 };
        group.Children.Add(BuildHeader(label, hint));
        group.Children.Add(control);
        return group;
    }

    private static FrameworkElement BuildHeader(string label, string? hint)
    {
        if (string.IsNullOrEmpty(hint))
        {
            return new Label { Value = label };
        }

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        row.Children.Add(new Label { Value = label });
        row.Children.Add(new Caption { Value = hint, Foreground = DisplayTokens.TextMuted });
        return row;
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

    private void OnTitleChanged(object sender, TextChangedEventArgs e) => _viewModel.Title = _titleInput.Text;

    private void OnComponentsChanged(object sender, TextChangedEventArgs e) =>
        _viewModel.Components = _componentsInput.Text;

    private void OnMessageChanged(object sender, TextChangedEventArgs e) =>
        _viewModel.Message = _messageInput.Text;

    private void OnSeverityChanged(object sender, SelectionChangedEventArgs e)
    {
        int index = _severitySelect.SelectedIndex;
        if (index >= 0 && index < _viewModel.SeverityOptions.Count)
        {
            _viewModel.Severity = _viewModel.SeverityOptions[index].Value;
        }
    }

    private void OnStatusChanged(object sender, SelectionChangedEventArgs e)
    {
        int index = _statusSelect.SelectedIndex;
        if (index >= 0 && index < _viewModel.StatusOptions.Count)
        {
            _viewModel.Status = _viewModel.StatusOptions[index].Value;
        }
    }

    private async void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        var deferral = args.GetDeferral();
        try
        {
            bool created = await _viewModel.SubmitAsync();
            if (!created)
            {
                args.Cancel = true;
            }
        }
        finally
        {
            deferral.Complete();
        }
    }

    private void OnCloseButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        if (_viewModel.IsSubmitting)
        {
            args.Cancel = true;
            return;
        }

        _viewModel.RequestClose();
    }

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
            case nameof(IncidentFormViewModel.IsSubmitting):
            case nameof(IncidentFormViewModel.SubmitLabel):
                if (_dialog is { } dialog)
                {
                    dialog.PrimaryButtonText = _viewModel.SubmitLabel;
                    dialog.IsPrimaryButtonEnabled = !_viewModel.IsSubmitting;
                }

                break;
            case nameof(IncidentFormViewModel.TitleError):
            case nameof(IncidentFormViewModel.HasTitleError):
                ApplyTitleError();
                break;
            default:
                break;
        }
    }

    private void ApplyTitleError()
    {
        bool hasError = _viewModel.HasTitleError;
        _titleInput.HasError = hasError;
        _titleError.Value = _viewModel.TitleError ?? string.Empty;
        _titleError.Visibility = hasError ? Visibility.Visible : Visibility.Collapsed;
        if (hasError)
        {
            LiveRegion.Announce(_titleError);
        }
    }

    private void OnToastRequested(object? sender, IncidentFormToast toast) =>
        Marshal(() =>
        {
            if (toast.IsError)
            {
                _formToast.Title = toast.Message;
                _formToast.Message = string.Empty;
                _formToast.Severity = InfoBarSeverity.Error;
                _formToast.IsOpen = !string.IsNullOrEmpty(toast.Message);
            }
            else
            {
                _toast.Title = toast.Message;
                _toast.Message = string.Empty;
                _toast.Severity = InfoBarSeverity.Success;
                _toast.IsOpen = !string.IsNullOrEmpty(toast.Message);
            }
        });

    private void OnViewModelCloseRequested(object? sender, EventArgs e) => Marshal(DismissDialog);

    private void DismissDialog() => _dialog?.Hide();

    private void RaiseClosed()
    {
        if (_closeRaised)
        {
            return;
        }

        _closeRaised = true;
        Closed?.Invoke(this, EventArgs.Empty);
    }

    private int IndexOfSeverity(IncidentSeverity severity)
    {
        for (int i = 0; i < _viewModel.SeverityOptions.Count; i++)
        {
            if (_viewModel.SeverityOptions[i].Value == severity)
            {
                return i;
            }
        }

        return 0;
    }

    private int IndexOfStatus(IncidentStatus status)
    {
        for (int i = 0; i < _viewModel.StatusOptions.Count; i++)
        {
            if (_viewModel.StatusOptions[i].Value == status)
            {
                return i;
            }
        }

        return 0;
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
