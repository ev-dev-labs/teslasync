using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 <c>FeedbackModal</c> surface — a parity port of
/// web/src/components/feedback/FeedbackModal.tsx. It presents a <see cref="TsModal"/>
/// ("Report a bug / Send feedback") whose body stacks the web form: a category dropdown, a required title field
/// (5..120), a required details field (20..4000), an auto-attached-context panel (page route, app version, the
/// Windows runtime descriptor) with the two consent toggles (attach recent errors — on by default; attach recent
/// log messages — off by default), and an inline failure alert. The modal's primary action runs the submit
/// mutation behind the client-side zod gate; a success raises the success toast and closes (web <c>onClose</c>), a
/// failure raises the inline error alert inside the still-open modal, and an out-of-bounds field surfaces an inline
/// field error. The auto-attached context resolves synchronously, so the surface has no loading / stale / offline
/// branch — a missing context value renders the friendly <c>unknown</c> fallback rather than a blank box. The
/// view never performs HTTP — it binds the shared <see cref="FeedbackModalViewModel"/>. Every string resolves
/// through the i18n facade, every interactive element carries a Narrator name, and the surface adds no bespoke
/// motion so reduced-motion is honoured by construction.
/// </summary>
public sealed partial class FeedbackModal : ContentControl, IDisposable
{
    private const double FormMinWidth = 380;
    private const double FormMaxHeight = 600;
    private const double FieldSpacing = 16;
    private const double GroupSpacing = 4;
    private const double ContextSpacing = 12;
    private const double RowSpacing = 6;

    private readonly FeedbackModalViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _root = new() { Spacing = 12 };
    private readonly InfoBar _successToast = new() { IsOpen = false, IsClosable = true };
    private readonly StackPanel _form = new() { Spacing = FieldSpacing, MinWidth = FormMinWidth };
    private readonly InfoBar _errorBar = new() { IsOpen = false, IsClosable = true };
    private readonly TsSelect _categorySelect = new();
    private readonly TsInput _titleInput = new();
    private readonly ErrorText _titleError = new() { Visibility = Visibility.Collapsed };
    private readonly TsTextarea _bodyInput = new();
    private readonly ErrorText _bodyError = new() { Visibility = Visibility.Collapsed };
    private readonly Code _pageValue = new();
    private readonly Code _appVersionValue = new();
    private readonly Text _runtimeValue = new();
    private readonly TsToggle _errorsToggle = new();
    private readonly TsToggle _consoleToggle = new();

    private TsModal? _dialog;
    private bool _started;
    private bool _shown;
    private bool _closeRaised;
    private bool _disposed;

    /// <summary>Creates the surface over its submit + context sources, localizer and (optional) diagnostics sink.</summary>
    /// <param name="submit">The feedback submit mutation port.</param>
    /// <param name="context">The auto-attached-context port (route / app version / runtime / recent errors).</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public FeedbackModal(
        IFeedbackSubmitSource submit,
        IFeedbackContextSource context,
        ILocalizer localizer,
        FeedbackModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(submit);
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new FeedbackModalViewModel(submit, context, localizer, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAutomationId(this, "feedback-modal");
        AutomationProperties.SetName(this, _viewModel.ModalTitle);

        BuildForm();

        _successToast.Severity = InfoBarSeverity.Success;
        AutomationProperties.SetAutomationId(_successToast, "feedback-modal-toast");
        _root.Children.Add(_successToast);
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.ToastRequested += OnToastRequested;
        _viewModel.CloseRequested += OnViewModelCloseRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>Raised when the modal has closed (web <c>onClose</c>): cancel, successful submit, or dismiss.</summary>
    public event EventHandler? Closed;

    /// <summary>The canonical surface slug (<c>FeedbackModal</c>).</summary>
    public static string SurfaceId => FeedbackModalRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public FeedbackModalViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory wiring the contract-client-backed <see cref="FeedbackSubmitSource"/>. The host supplies
    /// the composed <paramref name="context"/> source (with its real current-route provider + diagnostics ring).
    /// </summary>
    /// <param name="api">The shared generated contract client.</param>
    /// <param name="context">The auto-attached-context port.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public static FeedbackModal Create(
        IApiClient api,
        IFeedbackContextSource context,
        ILocalizer localizer,
        FeedbackModalDiagnostics? diagnostics = null) =>
        new(new FeedbackSubmitSource(api), context, localizer, diagnostics);

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
        AutomationProperties.SetAutomationId(dialog, "feedback-modal-dialog");
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
        _errorBar.Severity = InfoBarSeverity.Error;
        _errorBar.Title = _viewModel.SubmitErrorText;
        AutomationProperties.SetAutomationId(_errorBar, "feedback-modal-error");
        LiveRegion.Configure(_errorBar, assertive: true);

        foreach (var option in _viewModel.CategoryOptions)
        {
            _categorySelect.Items.Add(new ComboBoxItem { Content = option.Label });
        }

        _categorySelect.SelectedIndex = IndexOfCategory(_viewModel.Category);
        AutomationProperties.SetName(_categorySelect, _viewModel.CategoryLabel);
        AutomationProperties.SetAutomationId(_categorySelect, "feedback-modal-category");
        _categorySelect.SelectionChanged += OnCategoryChanged;

        _titleInput.MaxLength = FeedbackModalRegistration.TitleMaxLength;
        _titleInput.Hint = _viewModel.TitlePrompt;
        AutomationProperties.SetName(_titleInput, _viewModel.TitleLabel);
        AutomationProperties.SetAutomationId(_titleInput, "feedback-modal-title");
        _titleInput.TextChanged += OnTitleChanged;
        _titleInput.LostFocus += OnTitleBlur;
        _titleInput.Loaded += (_, _) => _titleInput.Focus(FocusState.Programmatic);

        AutomationProperties.SetAutomationId(_titleError, "feedback-modal-title-error");
        LiveRegion.Configure(_titleError, assertive: true);

        _bodyInput.MaxLength = FeedbackModalRegistration.BodyMaxLength;
        _bodyInput.Hint = _viewModel.BodyPrompt;
        _bodyInput.MinHeight = 120;
        AutomationProperties.SetName(_bodyInput, _viewModel.BodyLabel);
        AutomationProperties.SetAutomationId(_bodyInput, "feedback-modal-body");
        _bodyInput.TextChanged += OnBodyChanged;
        _bodyInput.LostFocus += OnBodyBlur;

        AutomationProperties.SetAutomationId(_bodyError, "feedback-modal-body-error");
        LiveRegion.Configure(_bodyError, assertive: true);

        var categoryGroup = BuildLabeledControl(_viewModel.CategoryLabel, _categorySelect);

        var titleGroup = new StackPanel { Spacing = GroupSpacing };
        titleGroup.Children.Add(new Label { Value = _viewModel.TitleLabel });
        titleGroup.Children.Add(_titleInput);
        titleGroup.Children.Add(_titleError);

        var bodyGroup = new StackPanel { Spacing = GroupSpacing };
        bodyGroup.Children.Add(new Label { Value = _viewModel.BodyLabel });
        bodyGroup.Children.Add(_bodyInput);
        bodyGroup.Children.Add(_bodyError);

        _form.Children.Add(_errorBar);
        _form.Children.Add(categoryGroup);
        _form.Children.Add(titleGroup);
        _form.Children.Add(bodyGroup);
        _form.Children.Add(BuildContextPanel());
    }

    private TsGlassPanel BuildContextPanel()
    {
        var content = new StackPanel { Spacing = ContextSpacing };
        content.Children.Add(new Caption { Value = _viewModel.ContextTitle });

        var rows = new StackPanel { Spacing = GroupSpacing };
        rows.Children.Add(BuildContextRow(_viewModel.ContextPageLabel, _pageValue));
        rows.Children.Add(BuildContextRow(_viewModel.ContextAppVersionLabel, _appVersionValue));
        rows.Children.Add(BuildContextRow(_viewModel.ContextRuntimeLabel, _runtimeValue));
        content.Children.Add(rows);

        _pageValue.Value = _viewModel.PageRouteDisplay;
        _appVersionValue.Value = _viewModel.AppVersionDisplay;
        _runtimeValue.Value = _viewModel.RuntimeDisplay;

        content.Children.Add(BuildToggleGroup(
            _errorsToggle, _viewModel.IncludeErrorsLabel, _viewModel.IncludeErrorsHint,
            _viewModel.IncludeRecentErrors, "feedback-modal-include-errors", OnIncludeErrorsToggled));
        content.Children.Add(BuildToggleGroup(
            _consoleToggle, _viewModel.IncludeConsoleLabel, _viewModel.IncludeConsoleHint,
            _viewModel.IncludeConsoleTail, "feedback-modal-include-console", OnIncludeConsoleToggled));

        return new TsGlassPanel
        {
            Padding = new Thickness(ContextSpacing),
            Content = content,
        };
    }

    private static StackPanel BuildContextRow(string label, FrameworkElement value)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RowSpacing,
            VerticalAlignment = VerticalAlignment.Top,
        };
        row.Children.Add(new Text { Value = label, Foreground = DisplayTokens.TextSecondary });
        row.Children.Add(value);
        return row;
    }

    private static StackPanel BuildToggleGroup(
        TsToggle toggle,
        string label,
        string hint,
        bool initialState,
        string automationId,
        EventHandler handler)
    {
        toggle.Header = label;
        toggle.IsOn = initialState;
        AutomationProperties.SetName(toggle, label);
        AutomationProperties.SetAutomationId(toggle, automationId);
        toggle.Toggled += handler;

        var group = new StackPanel { Spacing = GroupSpacing };
        group.Children.Add(toggle);
        group.Children.Add(new HelperText { Value = hint });
        return group;
    }

    private static StackPanel BuildLabeledControl(string label, FrameworkElement control)
    {
        var group = new StackPanel { Spacing = GroupSpacing };
        group.Children.Add(new Label { Value = label });
        group.Children.Add(control);
        return group;
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

    private void OnBodyChanged(object sender, TextChangedEventArgs e) => _viewModel.Body = _bodyInput.Text;

    private void OnTitleBlur(object sender, RoutedEventArgs e) => _viewModel.MarkTitleTouched();

    private void OnBodyBlur(object sender, RoutedEventArgs e) => _viewModel.MarkBodyTouched();

    private void OnCategoryChanged(object sender, SelectionChangedEventArgs e)
    {
        int index = _categorySelect.SelectedIndex;
        if (index >= 0 && index < _viewModel.CategoryOptions.Count)
        {
            _viewModel.Category = _viewModel.CategoryOptions[index].Value;
        }
    }

    private void OnIncludeErrorsToggled(object? sender, EventArgs e) =>
        _viewModel.IncludeRecentErrors = _errorsToggle.IsOn;

    private void OnIncludeConsoleToggled(object? sender, EventArgs e) =>
        _viewModel.IncludeConsoleTail = _consoleToggle.IsOn;

    private async void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        var deferral = args.GetDeferral();
        try
        {
            bool submitted = await _viewModel.SubmitAsync();
            if (!submitted)
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
            case nameof(FeedbackModalViewModel.IsSubmitting):
            case nameof(FeedbackModalViewModel.SubmitLabel):
            case nameof(FeedbackModalViewModel.CanSubmit):
                if (_dialog is { } dialog)
                {
                    dialog.PrimaryButtonText = _viewModel.SubmitLabel;
                    dialog.IsPrimaryButtonEnabled = _viewModel.CanSubmit;
                }

                break;
            case nameof(FeedbackModalViewModel.TitleError):
            case nameof(FeedbackModalViewModel.HasTitleError):
                ApplyFieldError(_titleInput, _titleError, _viewModel.HasTitleError, _viewModel.TitleError);
                break;
            case nameof(FeedbackModalViewModel.BodyError):
            case nameof(FeedbackModalViewModel.HasBodyError):
                ApplyFieldError(_bodyInput, _bodyError, _viewModel.HasBodyError, _viewModel.BodyError);
                break;
            case nameof(FeedbackModalViewModel.PageRouteDisplay):
                _pageValue.Value = _viewModel.PageRouteDisplay;
                break;
            case nameof(FeedbackModalViewModel.AppVersionDisplay):
                _appVersionValue.Value = _viewModel.AppVersionDisplay;
                break;
            case nameof(FeedbackModalViewModel.RuntimeDisplay):
                _runtimeValue.Value = _viewModel.RuntimeDisplay;
                break;
            case nameof(FeedbackModalViewModel.IncludeErrorsLabel):
                _errorsToggle.Header = _viewModel.IncludeErrorsLabel;
                AutomationProperties.SetName(_errorsToggle, _viewModel.IncludeErrorsLabel);
                break;
            default:
                break;
        }
    }

    private static void ApplyFieldError(TsInput input, ErrorText error, bool hasError, string? message)
    {
        input.HasError = hasError;
        error.Value = message ?? string.Empty;
        error.Visibility = hasError ? Visibility.Visible : Visibility.Collapsed;
        if (hasError)
        {
            LiveRegion.Announce(error);
        }
    }

    private static void ApplyFieldError(TsTextarea input, ErrorText error, bool hasError, string? message)
    {
        error.Value = message ?? string.Empty;
        error.Visibility = hasError ? Visibility.Visible : Visibility.Collapsed;
        if (hasError)
        {
            LiveRegion.Announce(error);
        }
    }

    private void OnToastRequested(object? sender, FeedbackModalToast toast) =>
        Marshal(() =>
        {
            if (toast.IsError)
            {
                _errorBar.Title = toast.Message;
                _errorBar.Message = string.Empty;
                _errorBar.IsOpen = !string.IsNullOrEmpty(toast.Message);
                LiveRegion.Announce(_errorBar);
            }
            else
            {
                _successToast.Title = toast.Message;
                _successToast.Message = string.Empty;
                _successToast.IsOpen = !string.IsNullOrEmpty(toast.Message);
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

    private int IndexOfCategory(FeedbackCategory category)
    {
        for (int i = 0; i < _viewModel.CategoryOptions.Count; i++)
        {
            if (_viewModel.CategoryOptions[i].Value == category)
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
