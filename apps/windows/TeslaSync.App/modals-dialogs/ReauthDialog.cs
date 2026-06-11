using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 <c>ReauthDialog</c> surface — a parity port of
/// web/src/components/feedback/ReauthDialog.tsx. The web component is the sudo step-up reauth dialog the
/// API client opens when the backend gates a sensitive action (401 + <c>SUDO_REQUIRED</c>): forward-auth
/// installs render a credential form (a password tab plus an authenticator tab when per-user TOTP is
/// enrolled), while open-mode installs render a typed-confirmation form that resolves locally. The native
/// counterpart hosts a tokenized <see cref="TsModal"/> (a <see cref="ContentDialog"/> that already provides
/// the focus trap, Escape-to-dismiss and focus restoration this overlay tier requires) and drives it from
/// the shared <see cref="ReauthDialogViewModel"/>; the view never performs HTTP. Every state the dialog can
/// be in is rendered — the credential password/authenticator tabs, the typed-confirmation field, the
/// in-flight submitting indicator, and the inline error — so none is ever a hidden surface. Every string
/// resolves through the i18n facade, each field carries a Narrator name, the dialog re-opens for queued
/// challenges, and the surface adds no custom motion so reduced-motion is honoured by construction.
/// </summary>
public sealed partial class ReauthDialog : ContentControl, IDisposable
{
    private readonly ReauthDialogViewModel _viewModel;
    private readonly ReauthDialogDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsModal _modal = new();
    private readonly StackPanel _body = new() { Spacing = 16, MinWidth = 320 };
    private readonly Text _description = new() { Value = string.Empty };
    private readonly TsTabs _tabs = new();
    private readonly TabViewItem _passwordItem = new() { IsClosable = false };
    private readonly TabViewItem _totpItem = new() { IsClosable = false };
    private readonly PasswordBox _passwordBox = new();
    private readonly TsInput _totpBox = new() { InputScope = NumericInputScope() };
    private readonly StackPanel _credentialPanel = new() { Spacing = 12 };
    private readonly HelperText _helper = new() { Value = string.Empty };
    private readonly TsInput _confirmBox = new();
    private readonly ErrorText _error = new() { Value = string.Empty, Visibility = Visibility.Collapsed };
    private readonly ProgressRing _submitSpinner = new()
    {
        IsActive = false,
        Visibility = Visibility.Collapsed,
        Width = 18,
        Height = 18,
        HorizontalAlignment = HorizontalAlignment.Left,
    };

    private bool _started;
    private bool _syncing;
    private bool _showing;
    private bool _totpTabAttached = true;
    private bool _disposed;

    /// <summary>Creates the dialog over its challenge queue, data sources, submitter, localizer and diagnostics.</summary>
    public ReauthDialog(
        IReauthChallengeBroker queue,
        ISessionAuthModeSource modeSource,
        ITotpStatusSource totpSource,
        IReauthSubmitter submitter,
        ILocalizer localizer,
        ReauthDialogDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(queue);
        ArgumentNullException.ThrowIfNull(modeSource);
        ArgumentNullException.ThrowIfNull(totpSource);
        ArgumentNullException.ThrowIfNull(submitter);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new ReauthDialogViewModel(queue, modeSource, totpSource, submitter, localizer);
        _diagnostics = diagnostics ?? new ReauthDialogDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        BuildLayout();
        IsTabStop = false;
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
    }

    /// <summary>The view-model the dialog binds to (exposed for host wiring and tests of the view contract).</summary>
    public ReauthDialogViewModel ViewModel => _viewModel;

    /// <summary>The diagnostics surface slug this view registers under.</summary>
    public static string Slug => ReauthDialogRegistration.Slug;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void BuildLayout()
    {
        _passwordBox.PasswordChanged += OnPasswordChanged;
        _totpBox.MaxLength = ReauthDialogRegistration.MaxTotpLength;
        _totpBox.TextChanged += OnTotpChanged;
        _confirmBox.TextChanged += OnConfirmChanged;

        _passwordItem.Content = WrapField(_passwordBox);
        _totpItem.Content = WrapField(_totpBox);
        _tabs.TabItems.Add(_passwordItem);
        _tabs.TabItems.Add(_totpItem);
        _tabs.SelectionChanged += OnTabSelectionChanged;

        _credentialPanel.Children.Add(_tabs);
        _credentialPanel.Children.Add(_helper);

        _body.Children.Add(_description);
        _body.Children.Add(_credentialPanel);
        _body.Children.Add(_confirmBox);
        _body.Children.Add(_submitSpinner);
        _body.Children.Add(_error);

        _modal.Content = _body;
        _modal.PrimaryButtonClick += OnPrimaryButtonClick;
        _modal.CloseButtonClick += OnCloseButtonClick;

        // The dialog frame is hosted by this control; the body composition lives in the modal content.
        Content = _modal;
        SyncAll();
    }

    private static StackPanel WrapField(Control field)
    {
        var panel = new StackPanel { Spacing = 4 };
        panel.Children.Add(field);
        return panel;
    }

    private static InputScope NumericInputScope()
    {
        var scope = new InputScope();
        scope.Names.Add(new InputScopeName(InputScopeNameValue.NumericPin));
        return scope;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_started)
        {
            _started = true;
            _diagnostics.RecordViewOpened();
        }

        ReconcileModalVisibility();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        void Apply()
        {
            SyncAll();
            ReconcileModalVisibility();
        }

        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(Apply);
        }
        else
        {
            Apply();
        }
    }

    private void SyncAll()
    {
        _syncing = true;
        try
        {
            _modal.Title = _viewModel.Title;
            _modal.PrimaryButtonText = _viewModel.SubmitLabel;
            _modal.CloseButtonText = _viewModel.CancelLabel;
            _modal.IsPrimaryButtonEnabled = !_viewModel.IsSubmitting;

            _description.Value = _viewModel.BodyText;

            _credentialPanel.Visibility = _viewModel.IsCredentialMode ? Visibility.Visible : Visibility.Collapsed;
            _confirmBox.Visibility = _viewModel.IsConfirmMode ? Visibility.Visible : Visibility.Collapsed;

            // Credential tabs + fields.
            _passwordItem.Header = _viewModel.PasswordTabLabel;
            _totpItem.Header = _viewModel.TotpTabLabel;
            AutomationProperties.SetName(_tabs, _viewModel.TabsAriaLabel);

            _passwordBox.Header = _viewModel.PasswordFieldLabel;
            AutomationProperties.SetName(_passwordBox, _viewModel.PasswordFieldLabel);
            _totpBox.Header = _viewModel.TotpFieldLabel;
            AutomationProperties.SetName(_totpBox, _viewModel.TotpFieldLabel);

            _helper.Value = _viewModel.HelperTextValue;

            // Confirm field.
            _confirmBox.Header = _viewModel.TypedConfirmationFieldLabel;
            AutomationProperties.SetName(_confirmBox, _viewModel.TypedConfirmationFieldLabel);

            UpdateTotpTabAttachment();
            UpdateSelectedTab();
            UpdateFieldValues();

            bool hasError = _viewModel.HasError;
            _error.Value = _viewModel.ErrorMessage ?? string.Empty;
            _error.Visibility = hasError ? Visibility.Visible : Visibility.Collapsed;

            _submitSpinner.IsActive = _viewModel.IsSubmitting;
            _submitSpinner.Visibility = _viewModel.IsSubmitting ? Visibility.Visible : Visibility.Collapsed;
        }
        finally
        {
            _syncing = false;
        }
    }

    private void UpdateTotpTabAttachment()
    {
        if (_viewModel.TotpTabAvailable && !_totpTabAttached)
        {
            _tabs.TabItems.Add(_totpItem);
            _totpTabAttached = true;
        }
        else if (!_viewModel.TotpTabAvailable && _totpTabAttached)
        {
            _tabs.TabItems.Remove(_totpItem);
            _totpTabAttached = false;
        }
    }

    private void UpdateSelectedTab()
    {
        var target = _viewModel.IsTotpTab && _totpTabAttached ? _totpItem : _passwordItem;
        if (!ReferenceEquals(_tabs.SelectedItem, target))
        {
            _tabs.SelectedItem = target;
        }
    }

    private void UpdateFieldValues()
    {
        if (_passwordBox.Password != _viewModel.Password)
        {
            _passwordBox.Password = _viewModel.Password;
        }

        if (_totpBox.Text != _viewModel.Totp)
        {
            _totpBox.Text = _viewModel.Totp;
        }

        if (_confirmBox.Text != _viewModel.ConfirmText)
        {
            _confirmBox.Text = _viewModel.ConfirmText;
        }
    }

    private void OnPasswordChanged(object sender, RoutedEventArgs e)
    {
        if (_syncing)
        {
            return;
        }

        _viewModel.Password = _passwordBox.Password;
    }

    private void OnTotpChanged(object sender, TextChangedEventArgs e)
    {
        if (_syncing)
        {
            return;
        }

        _viewModel.Totp = _totpBox.Text;
    }

    private void OnConfirmChanged(object sender, TextChangedEventArgs e)
    {
        if (_syncing)
        {
            return;
        }

        _viewModel.ConfirmText = _confirmBox.Text;
    }

    private void OnTabSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_syncing)
        {
            return;
        }

        _viewModel.SetActiveTab(ReferenceEquals(_tabs.SelectedItem, _totpItem) ? ReauthTab.Totp : ReauthTab.Password);
    }

    private async void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        // The dialog stays open or closes purely as a function of the queue (IsOpen); never auto-close here.
        args.Cancel = true;
        var deferral = args.GetDeferral();
        try
        {
            await _viewModel.SubmitAsync().ConfigureAwait(true);
        }
        finally
        {
            deferral.Complete();
        }
    }

    private void OnCloseButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        // Map the dialog's dismiss affordance (button + Escape) to the web onClose/Cancel handler.
        args.Cancel = true;
        _viewModel.Cancel();
    }

    private void ReconcileModalVisibility()
    {
        if (_viewModel.IsOpen && !_showing && XamlRoot is not null)
        {
            _ = ShowModalAsync();
        }
        else if (!_viewModel.IsOpen && _showing)
        {
            _modal.Hide();
        }
    }

    private async Task ShowModalAsync()
    {
        _showing = true;
        _modal.XamlRoot = XamlRoot;
        try
        {
            await _modal.ShowAsync().AsTask().ConfigureAwait(true);
        }
        catch (InvalidOperationException)
        {
            // Another ContentDialog is already open; the host serializes presentation — retry on next sync.
        }
        finally
        {
            _showing = false;

            // A queued challenge may have advanced the active one while this was open — re-present for it.
            ReconcileModalVisibility();
        }
    }
}
