using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 <c>CommandInputDialog</c> surface — a parity port of
/// web/src/features/system/components/CommandInputDialog.tsx. It presents a <see cref="TsModal"/> whose header
/// stacks a Segoe Fluent glyph (standing in for the web lucide <c>def.icon</c>), the command title and the
/// prompt, and whose body stacks the input form: either one labelled field per <c>ic.fields</c> entry (the
/// multi-field branch, e.g. HomeLink latitude / longitude) or a single field keyed by <c>ic.paramName</c> with
/// an optional sub-label (e.g. the PIN / speed-limit / rename commands). PIN fields are masked
/// (web <c>type="password"</c>) and number / decimal fields request a numeric input scope
/// (web <c>resolveInputMode</c>); each field reveals its validation error only once it has been touched
/// (web <c>error={touched[name] ? errors[name] : undefined}</c>). The primary action ("Send") is gated on the
/// live validity of every field and no dispatch being in flight (web <c>disabled={!isValid()}</c> + the Button's
/// <c>disabled || loading</c>), showing a busy ring while a command runs; Cancel (and Escape) dismiss the
/// dialog. The parent owns the actual command dispatch (web <c>VehicleCommandCenter</c>), so this surface is a
/// pure callback form with no read query — it never shows an empty / error / stale / offline read state. The
/// view never performs HTTP or holds business logic — it binds the shared
/// <see cref="CommandInputDialogViewModel"/>. Every string resolves through the i18n facade, every interactive
/// element carries a Narrator name, and the surface adds no bespoke motion so reduced-motion is honoured by
/// construction.
/// </summary>
public sealed partial class CommandInputDialog : ContentControl, IDisposable
{
    private const double FormMinWidth = 360;
    private const double FormMaxHeight = 520;
    private const double FieldSpacing = 16;
    private const double GroupSpacing = 4;
    private const double HeaderSpacing = 12;
    private const double HeaderIconSize = 20;
    private const double BusyRingSize = 18;

    private readonly CommandInputDialogViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _form = new() { Spacing = FieldSpacing, MinWidth = FormMinWidth };
    private readonly List<CommandFieldView> _fieldViews = [];
    private readonly ProgressRing _busyRing = new()
    {
        IsActive = false,
        Visibility = Visibility.Collapsed,
        Width = BusyRingSize,
        Height = BusyRingSize,
        HorizontalAlignment = HorizontalAlignment.Right,
    };

    private TsModal? _dialog;
    private bool _started;
    private bool _shown;
    private bool _closeRaised;
    private bool _syncing;
    private bool _disposed;

    /// <summary>Creates the surface over the bound form, the active vehicle's name, the localizer and a sink.</summary>
    /// <param name="form">The command-input form to render (web <c>def</c> + <c>def.inputConfig</c>).</param>
    /// <param name="vehicleDisplayName">The active vehicle's display name used to seed a defaulted single field
    /// (web <c>vehicle?.display_name</c>); null when unknown.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public CommandInputDialog(
        CommandInputForm form,
        string? vehicleDisplayName,
        ILocalizer localizer,
        CommandInputDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(form);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new CommandInputDialogViewModel(form, vehicleDisplayName, localizer, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAutomationId(this, "command-input-dialog");
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildForm();
        Content = _form;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.SubmitRequested += OnViewModelSubmitRequested;
        _viewModel.CloseRequested += OnViewModelCloseRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>Raised when the user submits a valid form (web <c>onSubmit(values)</c>).</summary>
    public event EventHandler<CommandInputSubmission>? Submitted;

    /// <summary>Raised when the user cancels / dismisses the dialog without submitting (web <c>onClose</c>).</summary>
    public event EventHandler? Cancelled;

    /// <summary>Raised once the modal has closed (for any reason): submit, cancel or dismiss.</summary>
    public event EventHandler? Closed;

    /// <summary>The canonical surface slug (<c>CommandInputDialog</c>).</summary>
    public static string SurfaceId => CommandInputRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting — e.g. the parent drives <c>Loading</c>).</summary>
    public CommandInputDialogViewModel ViewModel => _viewModel;

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
        AutomationProperties.SetAutomationId(dialog, "command-input-dialog-surface");
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
        _viewModel.SubmitRequested -= OnViewModelSubmitRequested;
        _viewModel.CloseRequested -= OnViewModelCloseRequested;
        foreach (var view in _fieldViews)
        {
            view.State.PropertyChanged -= view.OnStateChanged;
        }

        _dialog?.Hide();
    }

    private void BuildForm()
    {
        _form.Children.Add(BuildHeader());

        foreach (var state in _viewModel.Fields)
        {
            var view = BuildField(state);
            _fieldViews.Add(view);
            _form.Children.Add(view.Container);
        }

        AutomationProperties.SetName(_busyRing, _viewModel.SubmitLabel);
        _form.Children.Add(_busyRing);
    }

    private StackPanel BuildHeader()
    {
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderSpacing,
        };

        if (_viewModel.HasIcon)
        {
            var icon = new FontIcon
            {
                Glyph = _viewModel.IconGlyph,
                FontSize = HeaderIconSize,
                VerticalAlignment = VerticalAlignment.Top,
            };
            AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
            header.Children.Add(icon);
        }

        var titleGroup = new StackPanel { Spacing = 2 };
        var title = new PanelTitle { Value = _viewModel.Title };
        AutomationProperties.SetAutomationId(title, "command-input-title");
        var prompt = new Caption { Value = _viewModel.Prompt };
        AutomationProperties.SetAutomationId(prompt, "command-input-prompt");
        titleGroup.Children.Add(title);
        titleGroup.Children.Add(prompt);
        header.Children.Add(titleGroup);

        return header;
    }

    private CommandFieldView BuildField(CommandInputFieldState state)
    {
        var container = new StackPanel { Spacing = GroupSpacing };

        if (state.HasLabel)
        {
            container.Children.Add(new Label { Value = state.Label! });
        }

        Control input;
        Func<string> getText;
        Action<string> setText;
        Action<bool> setError;

        if (state.IsSecret)
        {
            var box = new PasswordBox();
            box.PasswordChanged += (_, _) => OnFieldTextChanged(state, box.Password);
            box.LostFocus += (_, _) => _viewModel.Blur(state);
            input = box;
            getText = () => box.Password;
            setText = text => box.Password = text;
            setError = hasError => ApplyPasswordError(box, hasError);
        }
        else
        {
            var box = new TsInput
            {
                Hint = state.Hint,
                InputScope = ScopeFor(state.Validation),
            };
            box.TextChanged += (_, _) => OnFieldTextChanged(state, box.Text);
            box.LostFocus += (_, _) => _viewModel.Blur(state);
            input = box;
            getText = () => box.Text;
            setText = text => box.Text = text;
            setError = hasError => box.HasError = hasError;
        }

        AutomationProperties.SetName(input, state.HasLabel ? state.Label! : _viewModel.Prompt);
        AutomationProperties.SetAutomationId(input, $"command-input-field-{state.Name}");

        var error = new ErrorText { Value = string.Empty, Visibility = Visibility.Collapsed };
        AutomationProperties.SetAutomationId(error, $"command-input-error-{state.Name}");
        LiveRegion.Configure(error, assertive: true);

        container.Children.Add(input);
        container.Children.Add(error);

        var view = new CommandFieldView(state, container, input, getText, setText, setError, error);
        SetFieldText(view, state.Value);
        ApplyFieldError(view);
        state.PropertyChanged += view.OnStateChanged;
        view.Changed += () => Marshal(() => OnFieldStateChanged(view));
        return view;
    }

    private void OnFieldTextChanged(CommandInputFieldState state, string text)
    {
        if (_syncing)
        {
            return;
        }

        _viewModel.SetValue(state, text);
    }

    private void OnFieldStateChanged(CommandFieldView view)
    {
        SetFieldText(view, view.State.Value);
        ApplyFieldError(view);
    }

    private void SetFieldText(CommandFieldView view, string value)
    {
        if (string.Equals(view.GetText(), value, StringComparison.Ordinal))
        {
            return;
        }

        _syncing = true;
        try
        {
            view.SetText(value);
        }
        finally
        {
            _syncing = false;
        }
    }

    private static void ApplyFieldError(CommandFieldView view)
    {
        string? message = view.State.DisplayError;
        bool hasError = message is not null;
        view.SetError(hasError);
        view.Error.Value = message ?? string.Empty;
        view.Error.Visibility = hasError ? Visibility.Visible : Visibility.Collapsed;
        if (hasError)
        {
            LiveRegion.Announce(view.Error);
        }
    }

    private static void ApplyPasswordError(PasswordBox box, bool hasError)
    {
        if (hasError &&
            Application.Current.Resources.TryGetValue("TsColorDangerBrush", out var brush) &&
            brush is Brush dangerBrush)
        {
            box.BorderBrush = dangerBrush;
            box.BorderThickness = new Thickness(1.5);
        }
        else
        {
            box.ClearValue(Control.BorderBrushProperty);
            box.ClearValue(Control.BorderThicknessProperty);
        }
    }

    private static InputScope ScopeFor(CommandInputValidation validation) => validation switch
    {
        CommandInputValidation.Number => NumericInputScope(InputScopeNameValue.Number),
        CommandInputValidation.Real => NumericInputScope(InputScopeNameValue.Number),
        _ => NumericInputScope(InputScopeNameValue.Default),
    };

    private static InputScope NumericInputScope(InputScopeNameValue value)
    {
        var scope = new InputScope();
        scope.Names.Add(new InputScopeName(value));
        return scope;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        FocusFirstField();
        if (XamlRoot is { } xamlRoot)
        {
            _ = ShowAsync(xamlRoot);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void FocusFirstField()
    {
        if (_fieldViews.Count == 0)
        {
            return;
        }

        var first = _fieldViews[0].Input;
        first.Loaded += (_, _) => first.Focus(FocusState.Programmatic);
        first.Focus(FocusState.Programmatic);
    }

    private void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        if (!_viewModel.Submit())
        {
            // A field is invalid — keep the modal open (web handleSubmit only calls onSubmit when valid).
            args.Cancel = true;
        }
    }

    private void OnCloseButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args) =>
        _viewModel.RequestClose();

    private void OnViewModelSubmitRequested(object? sender, CommandInputSubmission submission) =>
        Submitted?.Invoke(this, submission);

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
            case nameof(CommandInputDialogViewModel.CanSubmit):
                if (_dialog is { } dialog)
                {
                    dialog.IsPrimaryButtonEnabled = _viewModel.CanSubmit;
                }

                break;
            case nameof(CommandInputDialogViewModel.Loading):
                _busyRing.IsActive = _viewModel.Loading;
                _busyRing.Visibility = _viewModel.Loading ? Visibility.Visible : Visibility.Collapsed;
                break;
            default:
                break;
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

    /// <summary>Binds one field state to its rendered input + error controls and relays state changes.</summary>
    private sealed class CommandFieldView
    {
        public CommandFieldView(
            CommandInputFieldState state,
            Panel container,
            Control input,
            Func<string> getText,
            Action<string> setText,
            Action<bool> setError,
            ErrorText error)
        {
            State = state;
            Container = container;
            Input = input;
            GetText = getText;
            SetText = setText;
            SetError = setError;
            Error = error;
        }

        public event Action? Changed;

        public CommandInputFieldState State { get; }

        public Panel Container { get; }

        public Control Input { get; }

        public Func<string> GetText { get; }

        public Action<string> SetText { get; }

        public Action<bool> SetError { get; }

        public ErrorText Error { get; }

        public void OnStateChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
            Changed?.Invoke();
    }
}
