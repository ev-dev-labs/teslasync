using System.Globalization;
using System.Runtime.InteropServices;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 <c>DashboardSettingsModal</c> surface — a parity port of
/// web/src/features/dashboard/components/DashboardSettingsModal.tsx. It presents a <see cref="TsModal"/>
/// ("Dashboard Settings") whose body stacks the web form: an Identity section (the dashboard name field plus an
/// 8-column icon picker), a Vehicle Filter section (a select scoping every widget to one vehicle, "All Vehicles"
/// first), an Auto-Refresh section (a select of the six cadence choices) and a Display section (the show-borders
/// and compact-mode toggles). Save / Cancel are the dialog's command buttons (the Windows idiom for the web
/// footer actions). The web component is a controlled form — its only data dependency is <c>useTranslation</c>
/// and the dashboard + vehicles arrive as props — so the surface has no loading / error / stale / offline branch;
/// the empty-data branch is the vehicle filter degrading to the lone "All Vehicles" option when no vehicles are
/// supplied. The view never performs HTTP — it binds the shared <see cref="DashboardSettingsModalViewModel"/>.
/// Every string resolves through the i18n facade, every interactive element carries a Narrator name, the dialog
/// inherits a focus trap + focus restoration from <see cref="ContentDialog"/>, and the surface adds no bespoke
/// motion so reduced-motion is honoured by construction.
/// </summary>
public sealed partial class DashboardSettingsModal : ContentControl, IDisposable
{
    private const double FormMinWidth = 380;
    private const double FormMaxHeight = 560;
    private const double SectionSpacing = 24;
    private const double GroupSpacing = 12;
    private const double FieldSpacing = 4;
    private const double EmojiCellSize = 44;
    private const double EmojiButtonSize = 40;
    private const double EmojiFontSize = 18;
    private const double EmojiRingThickness = 1.5;
    private const int EmojiColumns = 8;

    private readonly DashboardSettingsModalViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _form = new() { Spacing = SectionSpacing, MinWidth = FormMinWidth };
    private readonly TsInput _nameInput = new();
    private readonly TsSelect _vehicleSelect = new();
    private readonly TsSelect _refreshSelect = new();
    private readonly TsToggle _bordersToggle = new();
    private readonly TsToggle _compactToggle = new();
    private readonly Dictionary<string, Border> _emojiCells = new(StringComparer.Ordinal);

    private readonly Subhead _identityHeader = new();
    private readonly Label _nameLabel = new();
    private readonly Caption _iconLabel = new();
    private readonly Subhead _vehicleHeader = new();
    private readonly Caption _vehicleDescription = new();
    private readonly Subhead _refreshHeader = new();
    private readonly Subhead _displayHeader = new();

    private TsModal? _dialog;
    private bool _populating;
    private bool _shown;
    private bool _closeRaised;
    private bool _disposed;

    /// <summary>Creates the surface over its i18n facade and (optional) diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public DashboardSettingsModal(
        ILocalizer localizer, DashboardSettingsModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new DashboardSettingsModalViewModel(localizer, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        AutomationProperties.SetAutomationId(this, "dashboard-settings-modal");

        BuildForm();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.CloseRequested += OnViewModelCloseRequested;
        Unloaded += OnUnloaded;
    }

    /// <summary>Raised when the modal has closed (web <c>onClose</c>): after a save or a cancel.</summary>
    public event EventHandler? Closed;

    /// <summary>The canonical surface slug (<c>DashboardSettingsModal</c>).</summary>
    public static string SurfaceId => DashboardSettingsModalRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public DashboardSettingsModalViewModel ViewModel => _viewModel;

    /// <summary>
    /// Open the modal for <paramref name="dashboard"/> over <paramref name="xamlRoot"/> (web
    /// <c>&lt;Modal open&gt;</c>), seeding the form from the dashboard and offering <paramref name="vehicles"/> in
    /// the vehicle-filter dropdown. Idempotent: a second call while showing is a no-op. Resolves when closed.
    /// </summary>
    /// <param name="dashboard">The dashboard whose settings are edited.</param>
    /// <param name="vehicles">The vehicles offered in the vehicle-filter dropdown (may be empty).</param>
    /// <param name="xamlRoot">The root the dialog is presented over.</param>
    public async Task ShowAsync(
        SavedDashboardInput dashboard, IReadOnlyList<VehicleOption> vehicles, XamlRoot xamlRoot)
    {
        ArgumentNullException.ThrowIfNull(dashboard);
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(xamlRoot);
        if (_shown || _disposed)
        {
            return;
        }

        _shown = true;
        Open(dashboard, vehicles);

        var dialog = new TsModal
        {
            Title = _viewModel.Title,
            PrimaryButtonText = _viewModel.SaveLabel,
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
        AutomationProperties.SetAutomationId(dialog, "dashboard-settings-modal-dialog");
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

    /// <summary>Seed the view-model and the form controls from the dashboard (the web open-time reset).</summary>
    /// <param name="dashboard">The dashboard whose settings are edited.</param>
    /// <param name="vehicles">The vehicles offered in the vehicle-filter dropdown.</param>
    public void Open(SavedDashboardInput dashboard, IReadOnlyList<VehicleOption> vehicles)
    {
        _viewModel.Open(dashboard, vehicles);
        PopulateFromViewModel();
    }

    /// <summary>Detach from the view-model, dismiss the dialog and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.CloseRequested -= OnViewModelCloseRequested;
        DismissDialog();
        _viewModel.Dispose();
    }

    private void BuildForm()
    {
        _nameInput.Hint = _viewModel.NamePrompt;
        AutomationProperties.SetName(_nameInput, _viewModel.NameLabel);
        AutomationProperties.SetAutomationId(_nameInput, "dashboard-settings-modal-name");
        _nameInput.TextChanged += OnNameChanged;

        AutomationProperties.SetName(_vehicleSelect, _viewModel.VehicleFilterLabel);
        AutomationProperties.SetAutomationId(_vehicleSelect, "dashboard-settings-modal-vehicle");
        _vehicleSelect.HorizontalAlignment = HorizontalAlignment.Stretch;
        _vehicleSelect.SelectionChanged += OnVehicleChanged;

        AutomationProperties.SetName(_refreshSelect, _viewModel.RefreshLabel);
        AutomationProperties.SetAutomationId(_refreshSelect, "dashboard-settings-modal-refresh");
        _refreshSelect.HorizontalAlignment = HorizontalAlignment.Stretch;
        _refreshSelect.SelectionChanged += OnRefreshChanged;

        AutomationProperties.SetName(_bordersToggle, _viewModel.ShowBordersLabel);
        AutomationProperties.SetAutomationId(_bordersToggle, "dashboard-settings-modal-borders");
        _bordersToggle.Toggled += OnBordersToggled;

        AutomationProperties.SetName(_compactToggle, _viewModel.CompactModeLabel);
        AutomationProperties.SetAutomationId(_compactToggle, "dashboard-settings-modal-compact");
        _compactToggle.Toggled += OnCompactToggled;

        _form.Children.Add(BuildIdentitySection());
        _form.Children.Add(BuildVehicleSection());
        _form.Children.Add(BuildRefreshSection());
        _form.Children.Add(BuildDisplaySection());

        ApplyStaticLabels();
    }

    private StackPanel BuildIdentitySection()
    {
        var nameGroup = new StackPanel { Spacing = FieldSpacing };
        nameGroup.Children.Add(_nameLabel);
        nameGroup.Children.Add(_nameInput);

        var iconGroup = new StackPanel { Spacing = GroupSpacing - 4 };
        iconGroup.Children.Add(_iconLabel);
        iconGroup.Children.Add(BuildEmojiPicker());

        var section = new StackPanel { Spacing = GroupSpacing };
        section.Children.Add(_identityHeader);
        section.Children.Add(nameGroup);
        section.Children.Add(iconGroup);
        return section;
    }

    private Grid BuildEmojiPicker()
    {
        var grid = new Grid { ColumnSpacing = 4, RowSpacing = 4, HorizontalAlignment = HorizontalAlignment.Left };
        AutomationProperties.SetName(grid, _viewModel.IconLabel);
        AutomationProperties.SetAutomationId(grid, "dashboard-settings-modal-icons");

        IReadOnlyList<string> emojis = _viewModel.Emojis;
        int rows = (emojis.Count + EmojiColumns - 1) / EmojiColumns;
        for (int c = 0; c < EmojiColumns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        }

        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < emojis.Count; i++)
        {
            string emoji = emojis[i];
            var cell = BuildEmojiCell(emoji);
            Grid.SetColumn(cell, i % EmojiColumns);
            Grid.SetRow(cell, i / EmojiColumns);
            grid.Children.Add(cell);
            _emojiCells[emoji] = cell;
        }

        return grid;
    }

    private Border BuildEmojiCell(string emoji)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = emoji,
            FontSize = EmojiFontSize,
            Width = EmojiButtonSize,
            Height = EmojiButtonSize,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        AutomationProperties.SetName(button, emoji);
        button.Click += (_, _) => OnEmojiSelected(emoji);

        var cell = new Border
        {
            Width = EmojiCellSize,
            Height = EmojiCellSize,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderThickness = new Thickness(EmojiRingThickness),
            BorderBrush = new SolidColorBrush(Colors.Transparent),
            Child = button,
        };
        return cell;
    }

    private StackPanel BuildVehicleSection()
    {
        var section = new StackPanel { Spacing = GroupSpacing - 4 };
        section.Children.Add(_vehicleHeader);
        section.Children.Add(_vehicleDescription);
        section.Children.Add(_vehicleSelect);
        return section;
    }

    private StackPanel BuildRefreshSection()
    {
        var section = new StackPanel { Spacing = GroupSpacing - 4 };
        section.Children.Add(_refreshHeader);
        section.Children.Add(_refreshSelect);
        return section;
    }

    private StackPanel BuildDisplaySection()
    {
        var section = new StackPanel { Spacing = GroupSpacing };
        section.Children.Add(_displayHeader);
        section.Children.Add(_bordersToggle);
        section.Children.Add(_compactToggle);
        return section;
    }

    private void PopulateFromViewModel()
    {
        _populating = true;
        try
        {
            _nameInput.Text = _viewModel.Name;
            RebuildVehicleItems();
            RebuildRefreshItems();
            _bordersToggle.IsOn = _viewModel.ShowWidgetBorders;
            _compactToggle.IsOn = _viewModel.CompactMode;
            UpdateEmojiSelection();
            ApplyStaticLabels();
        }
        finally
        {
            _populating = false;
        }
    }

    private void RebuildVehicleItems()
    {
        _vehicleSelect.Items.Clear();
        IReadOnlyList<DashboardSelectOption> options = _viewModel.VehicleOptions;
        foreach (DashboardSelectOption option in options)
        {
            _vehicleSelect.Items.Add(new ComboBoxItem { Content = option.Label });
        }

        _vehicleSelect.SelectedIndex = options.Count > 0 ? IndexOfVehicle(options) : -1;
    }

    private int IndexOfVehicle(IReadOnlyList<DashboardSelectOption> options)
    {
        string target = _viewModel.VehicleId?.ToString(CultureInfo.InvariantCulture) ?? string.Empty;
        for (int i = 0; i < options.Count; i++)
        {
            if (string.Equals(options[i].Value, target, StringComparison.Ordinal))
            {
                return i;
            }
        }

        return 0;
    }

    private void RebuildRefreshItems()
    {
        _refreshSelect.Items.Clear();
        IReadOnlyList<DashboardSelectOption> options = _viewModel.RefreshOptions;
        foreach (DashboardSelectOption option in options)
        {
            _refreshSelect.Items.Add(new ComboBoxItem { Content = option.Label });
        }

        string target = _viewModel.RefreshIntervalSeconds.ToString(CultureInfo.InvariantCulture);
        int selected = 0;
        for (int i = 0; i < options.Count; i++)
        {
            if (string.Equals(options[i].Value, target, StringComparison.Ordinal))
            {
                selected = i;
                break;
            }
        }

        _refreshSelect.SelectedIndex = options.Count > 0 ? selected : -1;
    }

    private void UpdateEmojiSelection()
    {
        Brush ring = DisplayTokens.Accent;
        Brush surface = DisplayTokens.Surface;
        foreach (KeyValuePair<string, Border> entry in _emojiCells)
        {
            bool selected = string.Equals(entry.Key, _viewModel.Icon, StringComparison.Ordinal);
            entry.Value.BorderBrush = selected ? ring : new SolidColorBrush(Colors.Transparent);
            entry.Value.Background = selected ? surface : null;
        }
    }

    private void ApplyStaticLabels()
    {
        _identityHeader.Value = _viewModel.IdentityLabel;
        _nameLabel.Value = _viewModel.NameLabel;
        _nameInput.Hint = _viewModel.NamePrompt;
        _iconLabel.Value = _viewModel.IconLabel;
        _vehicleHeader.Value = _viewModel.VehicleFilterLabel;
        _vehicleDescription.Value = _viewModel.VehicleFilterDescription;
        _refreshHeader.Value = _viewModel.RefreshLabel;
        _displayHeader.Value = _viewModel.DisplayLabel;
        _bordersToggle.Header = _viewModel.ShowBordersLabel;
        _compactToggle.Header = _viewModel.CompactModeLabel;

        AutomationProperties.SetName(_nameInput, _viewModel.NameLabel);
        AutomationProperties.SetName(_vehicleSelect, _viewModel.VehicleFilterLabel);
        AutomationProperties.SetName(_refreshSelect, _viewModel.RefreshLabel);
        AutomationProperties.SetName(_bordersToggle, _viewModel.ShowBordersLabel);
        AutomationProperties.SetName(_compactToggle, _viewModel.CompactModeLabel);

        if (_dialog is { } dialog)
        {
            dialog.Title = _viewModel.Title;
            dialog.PrimaryButtonText = _viewModel.SaveLabel;
            dialog.CloseButtonText = _viewModel.CancelLabel;
            AutomationProperties.SetName(dialog, _viewModel.Title);
        }
    }

    private void OnNameChanged(object sender, TextChangedEventArgs e)
    {
        if (!_populating)
        {
            _viewModel.Name = _nameInput.Text;
        }
    }

    private void OnVehicleChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_populating)
        {
            return;
        }

        int index = _vehicleSelect.SelectedIndex;
        IReadOnlyList<DashboardSelectOption> options = _viewModel.VehicleOptions;
        if (index >= 0 && index < options.Count)
        {
            string value = options[index].Value;
            _viewModel.VehicleId = string.IsNullOrEmpty(value)
                ? null
                : long.Parse(value, CultureInfo.InvariantCulture);
        }
    }

    private void OnRefreshChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_populating)
        {
            return;
        }

        int index = _refreshSelect.SelectedIndex;
        IReadOnlyList<DashboardSelectOption> options = _viewModel.RefreshOptions;
        if (index >= 0 && index < options.Count)
        {
            _viewModel.RefreshIntervalSeconds = int.Parse(options[index].Value, CultureInfo.InvariantCulture);
        }
    }

    private void OnBordersToggled(object? sender, EventArgs e)
    {
        if (!_populating)
        {
            _viewModel.ShowWidgetBorders = _bordersToggle.IsOn;
        }
    }

    private void OnCompactToggled(object? sender, EventArgs e)
    {
        if (!_populating)
        {
            _viewModel.CompactMode = _compactToggle.IsOn;
        }
    }

    private void OnEmojiSelected(string emoji)
    {
        if (_populating)
        {
            return;
        }

        _viewModel.Icon = emoji;
        UpdateEmojiSelection();
    }

    private void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args) =>
        _viewModel.Save();

    private void OnCloseButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args) =>
        _viewModel.Cancel();

    private void OnDialogClosed(ContentDialog sender, ContentDialogClosedEventArgs args)
    {
        sender.PrimaryButtonClick -= OnPrimaryButtonClick;
        sender.CloseButtonClick -= OnCloseButtonClick;
        sender.Closed -= OnDialogClosed;
        _dialog = null;
        RaiseClosed();
    }

    private void OnViewModelCloseRequested(object? sender, EventArgs e) => Marshal(DismissDialog);

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(() => ApplyViewModelState(e.PropertyName));

    private void ApplyViewModelState(string? propertyName)
    {
        switch (propertyName)
        {
            case nameof(DashboardSettingsModalViewModel.Icon):
                UpdateEmojiSelection();
                break;
            case nameof(DashboardSettingsModalViewModel.VehicleOptions):
            case nameof(DashboardSettingsModalViewModel.RefreshOptions):
                // Option labels were re-projected (a language change); refresh the dropdowns without losing
                // the current selection.
                _populating = true;
                try
                {
                    RebuildVehicleItems();
                    RebuildRefreshItems();
                }
                finally
                {
                    _populating = false;
                }

                break;
            case nameof(DashboardSettingsModalViewModel.Name):
            case nameof(DashboardSettingsModalViewModel.VehicleId):
            case nameof(DashboardSettingsModalViewModel.RefreshIntervalSeconds):
            case nameof(DashboardSettingsModalViewModel.ShowWidgetBorders):
            case nameof(DashboardSettingsModalViewModel.CompactMode):
            case nameof(DashboardSettingsModalViewModel.State):
            case nameof(DashboardSettingsModalViewModel.IsOpen):
            case nameof(DashboardSettingsModalViewModel.HasVehicles):
                // Value / state properties: the controls are the source of truth, so there is nothing to echo.
                break;
            default:
                // A localized label changed (a language reload) — refresh the static chrome.
                ApplyStaticLabels();
                break;
        }
    }

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

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DashboardSettingsModalAutomationPeer(this);

    private sealed class DashboardSettingsModalAutomationPeer(DashboardSettingsModal owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((DashboardSettingsModal)Owner)._viewModel.Title : name;
        }
    }
}
