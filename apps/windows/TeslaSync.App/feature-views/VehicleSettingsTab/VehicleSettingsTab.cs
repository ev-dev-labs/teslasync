using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// The native WinUI 3 per-vehicle settings surface — a parity port of
/// web/src/features/vehicles/components/VehicleSettingsTab.tsx. It reproduces the web component inside one glass
/// panel: the header (title + subtitle + freshness chip), and one row per whitelist key with the human-readable
/// label, a "source" pill (override / user / vehicle / default), the current effective value rendered through a typed
/// input (text, a local date + time picker for <c>mute_until</c>, or a select), a Save button armed only when the
/// draft differs from the effective value, and a "Reset to default" button enabled only for overrides. Because it
/// binds its own cache-then-network <see cref="VehicleSettingsTabViewModel"/>, it renders every state the P2 contract
/// requires — the skeleton while loading, a retry surface on a hard failure, and the rows otherwise (with a stale /
/// offline chip in the header). The view never performs HTTP; every string resolves through the i18n facade and every
/// interactive element carries a Narrator name.
/// </summary>
public sealed partial class VehicleSettingsTab : ContentControl, IDisposable
{
    private const double PanelPadding = 24;   // web GlassPanel p-6
    private const double SectionSpacing = 16; // web mb-4 / space-y
    private const double RowSpacing = 16;
    private const double SkeletonBlockHeight = 48;

    private enum RenderMode
    {
        None,
        Loading,
        Error,
        Content,
    }

    private readonly VehicleSettingsTabViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly VehicleSettingsTabDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsFadeIn _fade = new();
    private readonly InfoBar _toast = new()
    {
        IsOpen = false,
        IsClosable = true,
        Severity = InfoBarSeverity.Informational,
        Margin = new Thickness(0, 0, 0, 12),
    };

    private readonly List<RowControls> _rowControls = new();

    private RenderMode _mode = RenderMode.None;
    private bool _contentBuilt;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    private TsGlassPanel? _contentPanel;
    private StackPanel? _rowsHost;
    private StackPanel? _freshnessHost;

    /// <summary>Creates the surface over its data source, localizer, vehicle id and (optional) diagnostics sink.</summary>
    /// <param name="source">The per-vehicle settings data port (read + upsert + reset).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="vehicleId">The vehicle id from the route (web <c>vehicleId</c> prop).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehicleSettingsTab(
        IVehicleSettingsTabSource source,
        ILocalizer localizer,
        long vehicleId,
        VehicleSettingsTabDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new VehicleSettingsTabDiagnostics();
        _viewModel = new VehicleSettingsTabViewModel(source, localizer, vehicleId);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        var root = new StackPanel { Spacing = 0 };
        root.Children.Add(_toast);
        root.Children.Add(_fade);
        Content = root;
        AutomationProperties.SetName(this, _viewModel.Display.AutomationName);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.NoticeRequested += OnNoticeRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>vehicle-settings</c>).</summary>
    public static string SurfaceId => VehicleSettingsTabRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public VehicleSettingsTabViewModel ViewModel => _viewModel;

    /// <summary>The current projected surface chrome.</summary>
    public VehicleSettingsTabDisplay Display => _viewModel.Display;

    /// <summary>
    /// Convenience factory that wires the generated-client-backed <see cref="VehicleSettingsTabSource"/> from the
    /// shared data layer (the host's P2-core dependencies).
    /// </summary>
    /// <param name="api">The generated contract client (read + mutations).</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (JSON settings).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="vehicleId">The vehicle id from the route.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public static VehicleSettingsTab Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long vehicleId,
        VehicleSettingsTabDiagnostics? diagnostics = null)
    {
        var source = new VehicleSettingsTabSource(api, engine, options);
        return new VehicleSettingsTab(source, localizer, vehicleId, diagnostics);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.NoticeRequested -= OnNoticeRequested;
        foreach (var row in _rowControls)
        {
            row.Dispose();
        }

        _rowControls.Clear();
        _viewModel.Dispose();
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void OnNoticeRequested(object? sender, VehicleSettingsTabNotice notice)
    {
        _toast.Severity = notice.Kind == VehicleSettingsTabNoticeKind.Error
            ? InfoBarSeverity.Error
            : InfoBarSeverity.Success;
        _toast.Title = notice.Message;
        _toast.Message = string.Empty;
        _toast.IsOpen = !string.IsNullOrEmpty(notice.Message);
    }

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        AutomationProperties.SetName(this, _viewModel.Display.AutomationName);

        switch (_viewModel.State)
        {
            case VehicleSettingsTabState.Loading:
                ShowLoading();
                break;
            case VehicleSettingsTabState.Error:
                ShowError();
                break;
            default:
                ShowContent();
                break;
        }
    }

    // ── Loading (skeleton chrome) ───────────────────────────────────────────────────────────────────────

    private void ShowLoading()
    {
        if (_mode == RenderMode.Loading)
        {
            return;
        }

        _mode = RenderMode.Loading;
        _fade.Content = BuildLoading();
    }

    private TsGlassPanel BuildLoading()
    {
        var content = new StackPanel { Spacing = SectionSpacing };
        content.Children.Add(new TsSkeleton { BlockHeight = 28, ReduceMotion = MotionPreference.ReduceMotion });
        for (int i = 0; i < 3; i++)
        {
            content.Children.Add(new TsSkeleton { BlockHeight = SkeletonBlockHeight, ReduceMotion = MotionPreference.ReduceMotion });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
        AutomationProperties.SetName(panel, _localizer.GetString("translation.common.loading", "Loading..."));
        return panel;
    }

    // ── Error surface (web ErrorDisplay) ────────────────────────────────────────────────────────────────

    private void ShowError()
    {
        _mode = RenderMode.Error;
        _fade.Content = BuildError();
    }

    private TsGlassPanel BuildError()
    {
        var display = _viewModel.Display;
        var error = new TsErrorDisplay
        {
            Title = display.Title,
            Message = _viewModel.ErrorMessage ?? display.ErrorText,
            ActionText = display.RetryLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = error };
        AutomationProperties.SetName(panel, error.Message);
        return panel;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Content (Loaded / Empty / Stale / Offline): the rows ────────────────────────────────────────────

    private void ShowContent()
    {
        EnsureContent();

        if (_mode != RenderMode.Content)
        {
            _mode = RenderMode.Content;
            _fade.Content = _contentPanel;
        }

        UpdateFreshness();
    }

    private void EnsureContent()
    {
        if (_contentBuilt)
        {
            return;
        }

        _contentBuilt = true;
        var display = _viewModel.Display;

        var sections = new StackPanel { Spacing = SectionSpacing };
        sections.Children.Add(BuildHeader(display));

        _rowsHost = new StackPanel { Spacing = RowSpacing };
        foreach (var rowVm in _viewModel.Rows)
        {
            var controls = new RowControls(this, rowVm);
            _rowControls.Add(controls);
            _rowsHost.Children.Add(controls.Root);
        }

        sections.Children.Add(_rowsHost);

        _contentPanel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = sections };
        AutomationProperties.SetName(_contentPanel, display.AutomationName);
    }

    private Grid BuildHeader(VehicleSettingsTabDisplay display)
    {
        var titles = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(new SectionTitle { Value = display.Title });
        titles.Children.Add(new Caption { Value = display.Subtitle });

        _freshnessHost = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(titles, 0);
        Grid.SetColumn(_freshnessHost, 1);
        header.Children.Add(titles);
        header.Children.Add(_freshnessHost);
        return header;
    }

    private void UpdateFreshness()
    {
        if (_freshnessHost is null)
        {
            return;
        }

        _freshnessHost.Children.Clear();

        var display = _viewModel.Display;
        if (display.ShowFreshnessChip)
        {
            bool offline = _viewModel.State == VehicleSettingsTabState.Offline;
            string text = offline ? display.OfflineLabel : display.StaleLabel;
            var badge = new TsBadge
            {
                Status = offline ? StatusKind.Danger : StatusKind.Warning,
                Content = new TextBlock { Text = text, FontSize = 12 },
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetName(badge, text);
            _freshnessHost.Children.Add(badge);
        }

        _freshnessHost.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == VehicleSettingsTabState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });
    }

    private void Save(VehicleSettingRowViewModel row) => _ = _viewModel.SaveRowAsync(row);

    private void Reset(VehicleSettingRowViewModel row) => _ = _viewModel.ResetRowAsync(row);

    /// <summary>
    /// The persistent controls for one settings row. Built once, then driven by the row view-model's
    /// <see cref="System.ComponentModel.INotifyPropertyChanged"/> so a field keeps focus while a background refresh
    /// runs. Owns the typed input (text, a local date + time picker for the timestamp kind, or a select), the source
    /// pill, the inline validation text and the Save / Reset buttons.
    /// </summary>
    private sealed class RowControls : IDisposable
    {
        private readonly VehicleSettingsTab _view;
        private readonly VehicleSettingRowViewModel _row;

        private readonly TsBadge _sourceBadge = new() { VerticalAlignment = VerticalAlignment.Center };
        private readonly ErrorText _validation = new() { Visibility = Visibility.Collapsed, Margin = new Thickness(0, 4, 0, 0) };
        private readonly TsButton _save = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Small };
        private readonly TsButton _reset = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small };

        private TsInput? _textInput;
        private TsSelect? _select;
        private CalendarDatePicker? _datePicker;
        private TimePicker? _timePicker;

        private bool _suppress;
        private bool _disposed;

        public RowControls(VehicleSettingsTab view, VehicleSettingRowViewModel row)
        {
            _view = view;
            _row = row;
            Root = Build();
            _row.PropertyChanged += OnRowPropertyChanged;
            Apply();
        }

        /// <summary>The row's root container.</summary>
        public Border Root { get; }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _row.PropertyChanged -= OnRowPropertyChanged;
            _save.Click -= OnSaveClick;
            _reset.Click -= OnResetClick;
        }

        private Border Build()
        {
            var display = _row.Display;

            // Left column: label + source pill + help.
            var labelRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
            labelRow.Children.Add(new Text { Value = display.Label, VerticalAlignment = VerticalAlignment.Center });
            labelRow.Children.Add(_sourceBadge);

            var left = new StackPanel { Spacing = 4 };
            left.Children.Add(labelRow);
            var help = new Caption { Value = display.Help };
            help.Visibility = string.IsNullOrEmpty(display.Help) ? Visibility.Collapsed : Visibility.Visible;
            left.Children.Add(help);

            // Middle column: the typed input + inline validation.
            var inputColumn = new StackPanel { Spacing = 0 };
            inputColumn.Children.Add(BuildInput(display));
            inputColumn.Children.Add(_validation);

            // Right column: Save + Reset.
            _save.Click += OnSaveClick;
            _reset.Click += OnResetClick;
            AutomationProperties.SetAutomationId(_save, display.SaveAutomationId);
            AutomationProperties.SetAutomationId(_reset, display.ResetAutomationId);
            var actions = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 8,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Top,
            };
            actions.Children.Add(_save);
            actions.Children.Add(_reset);

            var grid = new Grid { ColumnSpacing = 12, RowSpacing = 8 };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(4, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(5, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(3, GridUnitType.Star) });
            Grid.SetColumn(left, 0);
            Grid.SetColumn(inputColumn, 1);
            Grid.SetColumn(actions, 2);
            grid.Children.Add(left);
            grid.Children.Add(inputColumn);
            grid.Children.Add(actions);

            AutomationProperties.SetAutomationId(grid, display.RowAutomationId);
            AutomationProperties.SetName(grid, display.Label);

            return new Border { Padding = new Thickness(0, 8, 0, 8), Child = grid };
        }

        private FrameworkElement BuildInput(VehicleSettingRowDisplay display)
        {
            switch (display.Kind)
            {
                case VehicleSettingKind.Select:
                    _select = new TsSelect { HorizontalAlignment = HorizontalAlignment.Stretch };
                    foreach (var option in display.Options)
                    {
                        _select.Items.Add(new ComboBoxItem { Content = option.Label, Tag = option.Value });
                    }

                    _select.SelectionChanged += OnSelectChanged;
                    AutomationProperties.SetAutomationId(_select, display.InputAutomationId);
                    AutomationProperties.SetName(_select, display.Label);
                    return _select;

                case VehicleSettingKind.Timestamp:
                    _datePicker = new CalendarDatePicker
                    {
                        PlaceholderText = display.Label, // parity:allow CalendarDatePicker prompt text mirroring the web datetime-local field, not a stub
                        HorizontalAlignment = HorizontalAlignment.Stretch,
                    };
                    _timePicker = new TimePicker { ClockIdentifier = "24HourClock" };
                    _datePicker.DateChanged += OnDateChanged;
                    _timePicker.SelectedTimeChanged += OnTimeChanged;
                    AutomationProperties.SetAutomationId(_datePicker, display.InputAutomationId);
                    AutomationProperties.SetName(_datePicker, display.Label);
                    AutomationProperties.SetName(_timePicker, display.Label);

                    var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
                    row.Children.Add(_datePicker);
                    row.Children.Add(_timePicker);
                    return row;

                default:
                    _textInput = new TsInput { HorizontalAlignment = HorizontalAlignment.Stretch };
                    if (display.MaxLength is { } max)
                    {
                        _textInput.MaxLength = max;
                    }

                    _textInput.TextChanged += OnTextChanged;
                    AutomationProperties.SetAutomationId(_textInput, display.InputAutomationId);
                    AutomationProperties.SetName(_textInput, display.Label);
                    return _textInput;
            }
        }

        private void OnRowPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => Apply();

        private void Apply()
        {
            var display = _row.Display;

            // Source pill.
            _sourceBadge.Status = display.SourceStatus;
            _sourceBadge.Content = new TextBlock { Text = display.SourceText, FontSize = 12 };
            AutomationProperties.SetName(_sourceBadge, display.SourceText);
            AutomationProperties.SetAutomationId(_sourceBadge, display.SourceAutomationId);

            // Draft -> input (suppressed so the push does not echo back as an edit).
            _suppress = true;
            try
            {
                PushDraft(display);
            }
            finally
            {
                _suppress = false;
            }

            // Inline validation.
            bool hasError = _row.HasValidationError;
            _validation.Value = _row.ValidationError ?? string.Empty;
            _validation.Visibility = hasError ? Visibility.Visible : Visibility.Collapsed;
            if (_textInput is not null)
            {
                _textInput.HasError = hasError;
            }

            // Save / Reset buttons.
            var surface = _view._viewModel.Display;
            _save.Text = _row.IsSaving ? surface.SavingLabel : surface.SaveLabel;
            _save.IsLoading = _row.IsSaving;
            _save.IsEnabled = _row.CanSave;
            AutomationProperties.SetName(_save, _save.Text);

            _reset.Text = _row.IsResetting ? surface.ResettingLabel : surface.ResetLabel;
            _reset.IsLoading = _row.IsResetting;
            _reset.IsEnabled = _row.CanReset;
            AutomationProperties.SetName(_reset, _reset.Text);
        }

        private void PushDraft(VehicleSettingRowDisplay display)
        {
            string draft = _row.Draft;
            switch (display.Kind)
            {
                case VehicleSettingKind.Select when _select is not null:
                    int index = -1;
                    for (int i = 0; i < _select.Items.Count; i++)
                    {
                        if (_select.Items[i] is ComboBoxItem item &&
                            string.Equals(item.Tag as string, draft, StringComparison.Ordinal))
                        {
                            index = i;
                            break;
                        }
                    }

                    _select.SelectedIndex = index;
                    break;

                case VehicleSettingKind.Timestamp when _datePicker is not null && _timePicker is not null:
                    if (DateTime.TryParseExact(
                            draft,
                            VehicleSettingDraft.LocalInputFormat,
                            CultureInfo.InvariantCulture,
                            DateTimeStyles.None,
                            out var parsed))
                    {
                        _datePicker.Date = new DateTimeOffset(parsed.Date, DateTimeOffset.Now.Offset);
                        _timePicker.SelectedTime = parsed.TimeOfDay;
                    }
                    else
                    {
                        _datePicker.Date = null;
                        _timePicker.SelectedTime = null;
                    }

                    break;

                default:
                    if (_textInput is not null && !string.Equals(_textInput.Text, draft, StringComparison.Ordinal))
                    {
                        _textInput.Text = draft;
                    }

                    break;
            }
        }

        private void OnTextChanged(object sender, TextChangedEventArgs e)
        {
            if (_suppress || _textInput is null)
            {
                return;
            }

            _row.Draft = _textInput.Text;
        }

        private void OnSelectChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_suppress || _select is null)
            {
                return;
            }

            _row.Draft = (_select.SelectedItem as ComboBoxItem)?.Tag as string ?? string.Empty;
        }

        private void OnDateChanged(CalendarDatePicker sender, CalendarDatePickerDateChangedEventArgs args) => CommitTimestamp();

        private void OnTimeChanged(TimePicker sender, TimePickerSelectedValueChangedEventArgs args) => CommitTimestamp();

        private void CommitTimestamp()
        {
            if (_suppress || _datePicker is null || _timePicker is null)
            {
                return;
            }

            if (_datePicker.Date is not { } date)
            {
                _row.Draft = string.Empty;
                return;
            }

            TimeSpan time = _timePicker.SelectedTime ?? TimeSpan.Zero;
            var local = date.Date.Add(time);
            _row.Draft = local.ToString(VehicleSettingDraft.LocalInputFormat, CultureInfo.InvariantCulture);
        }

        private void OnSaveClick(object sender, RoutedEventArgs e) => _view.Save(_row);

        private void OnResetClick(object sender, RoutedEventArgs e) => _view.Reset(_row);
    }
}
