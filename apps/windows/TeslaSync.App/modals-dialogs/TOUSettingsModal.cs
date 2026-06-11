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
/// The native WinUI 3 <c>TOUSettingsModal</c> surface — a parity port of
/// web/src/features/battery/components/TOUSettingsModal.tsx. It presents a <see cref="TsModal"/>
/// ("Update Rate Plan") whose body stacks the web form: an intro description, a two-tab switcher (Preset Tariff /
/// Custom JSON), the preset tab's rate-plan dropdown with a read-only tariff preview, the custom tab's
/// <c>tou_settings</c> JSON field with its hint, an inline error alert, and a saving busy indicator. The modal's
/// primary action runs the save mutation behind the client-side <c>getPayload()</c> gate; a success raises the
/// save toast, fires the site-info refresh and closes (web <c>onClose</c>), a failure raises the inline error
/// inside the still-open modal, and an invalid input surfaces the inline validation message. The web component is
/// a write-only modal with no read query, so the surface has no loading / stale / offline branch — and rather
/// than hiding the preview when no plan is chosen (as the web does), it shows a friendly hint. The view
/// never performs HTTP — it binds the shared <see cref="TouSettingsModalViewModel"/>. Every string resolves
/// through the i18n facade, every interactive element carries a Narrator name, and the surface adds no bespoke
/// motion so reduced-motion is honoured by construction.
/// </summary>
public sealed partial class TouSettingsModal : ContentControl, IDisposable
{
    private const double FormMinWidth = 420;
    private const double FormMaxHeight = 600;
    private const double PreviewMaxHeight = 220;
    private const double FieldSpacing = 16;
    private const double GroupSpacing = 4;
    private const double PanelSpacing = 6;

    private readonly TouSettingsModalViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _root = new() { Spacing = 12 };
    private readonly StackPanel _form = new() { Spacing = FieldSpacing, MinWidth = FormMinWidth };
    private readonly InfoBar _successToast = new() { IsOpen = false, IsClosable = true };
    private readonly InfoBar _errorBar = new() { IsOpen = false, IsClosable = true };
    private readonly Text _description = new();
    private readonly TsTabs _tabs = new();
    private readonly TabViewItem _presetItem = new() { IsClosable = false };
    private readonly TabViewItem _customItem = new() { IsClosable = false };
    private readonly TsSelect _planSelect = new();
    private readonly Code _previewCode = new();
    private readonly Text _previewEmpty = new();
    private readonly ScrollViewer _previewScroll = new()
    {
        VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        HorizontalScrollMode = ScrollMode.Disabled,
        MaxHeight = PreviewMaxHeight,
    };
    private readonly TsTextarea _customBox = new();
    private readonly StackPanel _savingRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        Visibility = Visibility.Collapsed,
    };
    private readonly ProgressRing _savingSpinner = new() { IsActive = false, Width = 18, Height = 18 };

    private TsModal? _dialog;
    private bool _started;
    private bool _shown;
    private bool _closeRaised;
    private bool _syncing;
    private bool _disposed;

    /// <summary>Creates the surface over the site id, its save + refresh sources, localizer and (optional) diagnostics.</summary>
    /// <param name="siteId">The Tesla energy-site id the save targets (web <c>siteId</c> prop).</param>
    /// <param name="update">The TOU save mutation port.</param>
    /// <param name="refresh">The site-info refresh port.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public TouSettingsModal(
        long siteId,
        ITouSettingsUpdateSource update,
        ITouSiteInfoRefreshSource refresh,
        ILocalizer localizer,
        TouSettingsModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(update);
        ArgumentNullException.ThrowIfNull(refresh);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new TouSettingsModalViewModel(siteId, update, refresh, localizer, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAutomationId(this, "tou-settings-modal");
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildForm();

        _successToast.Severity = InfoBarSeverity.Success;
        AutomationProperties.SetAutomationId(_successToast, "tou-settings-modal-toast");
        _root.Children.Add(_successToast);
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.ToastRequested += OnToastRequested;
        _viewModel.CloseRequested += OnViewModelCloseRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>Raised when the modal has closed (web <c>onClose</c>): cancel, successful save, or dismiss.</summary>
    public event EventHandler? Closed;

    /// <summary>The canonical surface slug (<c>TOUSettingsModal</c>).</summary>
    public static string SurfaceId => TouSettingsModalRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public TouSettingsModalViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory wiring the contract-client-backed save + refresh sources over the shared
    /// <see cref="IApiClient"/>.
    /// </summary>
    /// <param name="api">The shared generated contract client.</param>
    /// <param name="siteId">The Tesla energy-site id the save targets.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public static TouSettingsModal Create(
        IApiClient api,
        long siteId,
        ILocalizer localizer,
        TouSettingsModalDiagnostics? diagnostics = null) =>
        new(siteId, new TouSettingsUpdateSource(api), new TouSiteInfoRefreshSource(api), localizer, diagnostics);

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
        AutomationProperties.SetAutomationId(dialog, "tou-settings-modal-dialog");
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
        AutomationProperties.SetAutomationId(_errorBar, "tou-settings-modal-error");
        LiveRegion.Configure(_errorBar, assertive: true);

        _description.Value = _viewModel.Description;
        _description.Foreground = DisplayTokens.TextSecondary;

        BuildTabs();
        BuildSavingRow();

        _form.Children.Add(_errorBar);
        _form.Children.Add(_description);
        _form.Children.Add(_tabs);
        _form.Children.Add(_savingRow);
    }

    private void BuildTabs()
    {
        _presetItem.Header = _viewModel.PresetTabLabel;
        _customItem.Header = _viewModel.CustomTabLabel;
        _presetItem.Content = BuildPresetPanel();
        _customItem.Content = BuildCustomPanel();

        _tabs.TabItems.Add(_presetItem);
        _tabs.TabItems.Add(_customItem);
        _tabs.SelectedItem = _viewModel.IsCustomMode ? _customItem : _presetItem;
        _tabs.SelectionChanged += OnTabSelectionChanged;
        AutomationProperties.SetName(_tabs, _viewModel.Title);
    }

    private StackPanel BuildPresetPanel()
    {
        foreach (var option in _viewModel.RatePlanOptions)
        {
            _planSelect.Items.Add(new ComboBoxItem { Content = option.Label, Tag = option.Value });
        }

        _planSelect.SelectedIndex = -1;
        _planSelect.Hint = _viewModel.SelectPrompt;
        AutomationProperties.SetName(_planSelect, _viewModel.SelectPlanLabel);
        AutomationProperties.SetAutomationId(_planSelect, "tou-settings-modal-plan");
        _planSelect.SelectionChanged += OnPlanSelectionChanged;

        var planGroup = new StackPanel { Spacing = GroupSpacing };
        planGroup.Children.Add(new Label { Value = _viewModel.SelectPlanLabel });
        planGroup.Children.Add(_planSelect);

        _previewScroll.Content = _previewCode;
        _previewScroll.Visibility = Visibility.Collapsed;
        AutomationProperties.SetName(_previewCode, _viewModel.PreviewLabel);
        AutomationProperties.SetAutomationId(_previewCode, "tou-settings-modal-preview");
        _previewEmpty.Value = _viewModel.PreviewEmpty;
        _previewEmpty.Foreground = DisplayTokens.TextMuted;

        var previewContent = new StackPanel { Spacing = PanelSpacing };
        previewContent.Children.Add(new Caption { Value = _viewModel.PreviewLabel });
        previewContent.Children.Add(_previewScroll);
        previewContent.Children.Add(_previewEmpty);

        var previewPanel = new TsGlassPanel
        {
            Padding = new Thickness(12),
            Content = previewContent,
        };

        var panel = new StackPanel { Spacing = 12 };
        panel.Children.Add(planGroup);
        panel.Children.Add(previewPanel);
        return panel;
    }

    private StackPanel BuildCustomPanel()
    {
        _customBox.Hint = _viewModel.CustomPrompt;
        _customBox.MinHeight = 180;
        _customBox.FontFamily = TypographyTokens.Mono ?? _customBox.FontFamily;
        AutomationProperties.SetName(_customBox, _viewModel.CustomLabel);
        AutomationProperties.SetAutomationId(_customBox, "tou-settings-modal-json");
        _customBox.TextChanged += OnCustomChanged;

        var group = new StackPanel { Spacing = GroupSpacing };
        group.Children.Add(new Label { Value = _viewModel.CustomLabel });
        group.Children.Add(_customBox);

        var panel = new StackPanel { Spacing = 12 };
        panel.Children.Add(group);
        panel.Children.Add(new HelperText { Value = _viewModel.CustomHint });
        return panel;
    }

    private void BuildSavingRow()
    {
        AutomationProperties.SetName(_savingSpinner, _viewModel.SavingLabel);
        AutomationProperties.SetAutomationId(_savingRow, "tou-settings-modal-saving");
        LiveRegion.Configure(_savingRow);
        _savingRow.Children.Add(_savingSpinner);
        _savingRow.Children.Add(new Caption { Value = _viewModel.SavingLabel });
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

    private void OnTabSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_syncing)
        {
            return;
        }

        _viewModel.SetMode(ReferenceEquals(_tabs.SelectedItem, _customItem) ? TouInputMode.Custom : TouInputMode.Preset);
    }

    private void OnPlanSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_syncing)
        {
            return;
        }

        _viewModel.SelectedPlanId = (_planSelect.SelectedItem as ComboBoxItem)?.Tag as string ?? string.Empty;
    }

    private void OnCustomChanged(object sender, TextChangedEventArgs e)
    {
        if (_syncing)
        {
            return;
        }

        _viewModel.CustomJson = _customBox.Text;
    }

    private async void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        var deferral = args.GetDeferral();
        try
        {
            bool saved = await _viewModel.SubmitAsync();
            if (!saved)
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
            case nameof(TouSettingsModalViewModel.IsSubmitting):
            case nameof(TouSettingsModalViewModel.CanSubmit):
                if (_dialog is { } dialog)
                {
                    dialog.IsPrimaryButtonEnabled = _viewModel.CanSubmit;
                }

                _savingSpinner.IsActive = _viewModel.IsSubmitting;
                _savingRow.Visibility = _viewModel.IsSubmitting ? Visibility.Visible : Visibility.Collapsed;
                if (_viewModel.IsSubmitting)
                {
                    LiveRegion.Announce(_savingRow);
                }

                break;
            case nameof(TouSettingsModalViewModel.SelectedPreview):
            case nameof(TouSettingsModalViewModel.HasPreview):
                ApplyPreview();
                break;
            case nameof(TouSettingsModalViewModel.ErrorMessage):
            case nameof(TouSettingsModalViewModel.HasError):
                ApplyError();
                break;
            case nameof(TouSettingsModalViewModel.Mode):
            case nameof(TouSettingsModalViewModel.IsCustomMode):
                SyncSelectedTab();
                break;
            default:
                break;
        }
    }

    private void ApplyPreview()
    {
        _previewCode.Value = _viewModel.SelectedPreview;
        bool hasPreview = _viewModel.HasPreview;
        _previewScroll.Visibility = hasPreview ? Visibility.Visible : Visibility.Collapsed;
        _previewEmpty.Visibility = hasPreview ? Visibility.Collapsed : Visibility.Visible;
    }

    private void ApplyError()
    {
        bool hasError = _viewModel.HasError;
        _errorBar.Title = _viewModel.ErrorMessage ?? string.Empty;
        _errorBar.IsOpen = hasError;
        if (hasError)
        {
            LiveRegion.Announce(_errorBar);
        }
    }

    private void SyncSelectedTab()
    {
        var target = _viewModel.IsCustomMode ? _customItem : _presetItem;
        if (ReferenceEquals(_tabs.SelectedItem, target))
        {
            return;
        }

        _syncing = true;
        try
        {
            _tabs.SelectedItem = target;
        }
        finally
        {
            _syncing = false;
        }
    }

    private void OnToastRequested(object? sender, TouSettingsToast toast) =>
        Marshal(() =>
        {
            if (toast.IsError)
            {
                _errorBar.Title = toast.Message;
                _errorBar.IsOpen = !string.IsNullOrEmpty(toast.Message);
                LiveRegion.Announce(_errorBar);
            }
            else
            {
                _successToast.Title = toast.Message;
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
