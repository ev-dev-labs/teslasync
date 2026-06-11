using System.Globalization;
using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using Windows.UI;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 <c>AddAnnotationPopover</c> modal surface — a parity port of
/// web/src/components/charts/AddAnnotationPopover.tsx. It presents a <see cref="TsModal"/> ("Add Annotation")
/// whose body stacks the web form: an optional editable date (a <see cref="CalendarDatePicker"/> capped at
/// today when <c>editableDate</c> is set, else the read-only annotated instant), a required label field
/// (max 50, auto-focused), a wrapping row of single-select category pills (milestone / maintenance / trip /
/// issue / upgrade / custom, each tinted with its web <c>ANNOTATION_COLORS</c> accent when selected) and an
/// optional description field (max 200). The primary action ("Add Annotation") is gated on a non-empty label
/// (web <c>disabled={!label.trim()}</c>); a successful add raises <see cref="AnnotationSubmitted"/> and closes,
/// while Cancel raises <see cref="Cancelled"/>. The web component has no read query — it is a pure callback
/// form — so it never shows a loading / empty / error / stale / offline state. The view never performs HTTP or
/// holds business logic — it binds the shared <see cref="AddAnnotationPopoverViewModel"/>. Every string resolves
/// through the i18n facade, every interactive element carries a Narrator name, and the surface adds no bespoke
/// motion so reduced-motion is honoured by construction.
/// </summary>
public sealed partial class AddAnnotationPopover : ContentControl, IDisposable
{
    private const double FormMinWidth = 320;
    private const double FormMaxHeight = 540;
    private const double PillCellWidth = 132;
    private const double PillCellHeight = 40;

    private readonly AddAnnotationPopoverViewModel _viewModel;
    private readonly StackPanel _form = new() { Spacing = 16, MinWidth = FormMinWidth };
    private readonly TsInput _labelInput = new();
    private readonly TsInput _descriptionInput = new();
    private readonly CalendarDatePicker _datePicker = new();
    private readonly List<CategoryPill> _pills = [];

    private TsModal? _dialog;
    private bool _started;
    private bool _shown;
    private bool _closeRaised;
    private bool _suppressDateSync;
    private bool _disposed;

    /// <summary>Creates the surface over the annotated instant, the editable-date mode, the localizer and an
    /// optional diagnostics sink.</summary>
    /// <param name="timestamp">The annotated instant (web <c>timestamp</c>).</param>
    /// <param name="editableDate">When true the instant is chosen via the date field (web <c>editableDate</c>).</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public AddAnnotationPopover(
        string timestamp,
        bool editableDate,
        ILocalizer localizer,
        AddAnnotationDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new AddAnnotationPopoverViewModel(timestamp, editableDate, localizer, diagnostics);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAutomationId(this, "add-annotation-popover");
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildForm();
        Content = _form;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.AnnotationSubmitted += OnViewModelAnnotationSubmitted;
        _viewModel.CloseRequested += OnViewModelCloseRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>Raised when the user adds an annotation (web <c>onAdd</c>).</summary>
    public event EventHandler<AnnotationDraft>? AnnotationSubmitted;

    /// <summary>Raised when the user cancels / dismisses the form without adding (web <c>onCancel</c>).</summary>
    public event EventHandler? Cancelled;

    /// <summary>Raised once the modal has closed (for any reason): add, cancel, or dismiss.</summary>
    public event EventHandler? Closed;

    /// <summary>The canonical surface slug (<c>AddAnnotationPopover</c>).</summary>
    public static string SurfaceId => AddAnnotationRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public AddAnnotationPopoverViewModel ViewModel => _viewModel;

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
            PrimaryButtonText = _viewModel.AddLabel,
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
        AutomationProperties.SetAutomationId(dialog, "add-annotation-dialog");
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
        _viewModel.AnnotationSubmitted -= OnViewModelAnnotationSubmitted;
        _viewModel.CloseRequested -= OnViewModelCloseRequested;
        _dialog?.Hide();
    }

    private void BuildForm()
    {
        if (_viewModel.EditableDate)
        {
            _datePicker.MaxDate = DateTimeOffset.Now;
            _datePicker.Date = ToOffset(_viewModel.EditedDate);
            _datePicker.DateChanged += OnDateChanged;
            AutomationProperties.SetName(_datePicker, _viewModel.DateLabel);
            AutomationProperties.SetAutomationId(_datePicker, "add-annotation-date");
            _form.Children.Add(BuildLabeledControl(_viewModel.DateLabel, _datePicker));
        }
        else
        {
            var instant = new Caption { Value = _viewModel.Timestamp };
            AutomationProperties.SetName(instant, _viewModel.DateLabel);
            AutomationProperties.SetAutomationId(instant, "add-annotation-timestamp");
            _form.Children.Add(instant);
        }

        _labelInput.MaxLength = AddAnnotationRegistration.LabelMaxLength;
        _labelInput.Hint = _viewModel.LabelPrompt;
        AutomationProperties.SetName(_labelInput, _viewModel.LabelLabel);
        AutomationProperties.SetAutomationId(_labelInput, "add-annotation-label");
        _labelInput.TextChanged += OnLabelChanged;
        _labelInput.Loaded += (_, _) => _labelInput.Focus(FocusState.Programmatic);
        _form.Children.Add(BuildLabeledControl(_viewModel.LabelLabel, _labelInput));

        _form.Children.Add(BuildLabeledControl(_viewModel.CategoryLabel, BuildCategoryPills()));

        _descriptionInput.MaxLength = AddAnnotationRegistration.DescriptionMaxLength;
        _descriptionInput.Hint = _viewModel.DescriptionPrompt;
        AutomationProperties.SetName(_descriptionInput, _viewModel.DescriptionLabel);
        AutomationProperties.SetAutomationId(_descriptionInput, "add-annotation-description");
        _descriptionInput.TextChanged += OnDescriptionChanged;
        _form.Children.Add(BuildLabeledControl(_viewModel.DescriptionLabel, _descriptionInput));
    }

    private VariableSizedWrapGrid BuildCategoryPills()
    {
        var wrap = new VariableSizedWrapGrid
        {
            Orientation = Orientation.Horizontal,
            ItemWidth = PillCellWidth,
            ItemHeight = PillCellHeight,
        };
        foreach (var option in _viewModel.CategoryOptions)
        {
            var icon = new FontIcon { Glyph = option.Glyph, FontSize = 14 };
            var row = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 6,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            row.Children.Add(icon);
            row.Children.Add(new TextBlock { Text = option.Label, VerticalAlignment = VerticalAlignment.Center });

            var pill = new ToggleButton
            {
                Content = row,
                Tag = option.Value,
                CornerRadius = new CornerRadius(999),
                Padding = new Thickness(10, 4, 10, 4),
                Margin = new Thickness(0, 0, 6, 6),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Center,
            };
            AutomationProperties.SetName(pill, option.Label);
            AutomationProperties.SetAutomationId(pill, $"add-annotation-category-{AnnotationCategories.ToWire(option.Value)}");
            pill.Click += OnCategoryPillClick;

            _pills.Add(new CategoryPill(pill, icon, option.Value, ParseHexColor(option.Color)));
            wrap.Children.Add(pill);
        }

        UpdatePillStates();
        return wrap;
    }

    private static StackPanel BuildLabeledControl(string label, FrameworkElement control)
    {
        var group = new StackPanel { Spacing = 4 };
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

    private void OnLabelChanged(object sender, TextChangedEventArgs e) => _viewModel.Label = _labelInput.Text;

    private void OnDescriptionChanged(object sender, TextChangedEventArgs e) =>
        _viewModel.Description = _descriptionInput.Text;

    private void OnDateChanged(CalendarDatePicker sender, CalendarDatePickerDateChangedEventArgs args)
    {
        if (_suppressDateSync)
        {
            return;
        }

        _viewModel.EditedDate = FromOffset(args.NewDate);
    }

    private void OnCategoryPillClick(object sender, RoutedEventArgs e)
    {
        if (sender is ToggleButton { Tag: AnnotationCategory category })
        {
            _viewModel.Category = category;
            UpdatePillStates();
        }
    }

    private void UpdatePillStates()
    {
        foreach (var entry in _pills)
        {
            bool selected = entry.Value == _viewModel.Category;
            entry.Button.IsChecked = selected;
            entry.Icon.Foreground = selected ? new SolidColorBrush(entry.Accent) : DisplayTokens.TextMuted;
        }
    }

    private void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        if (!_viewModel.Submit())
        {
            // Empty label or unresolved instant — keep the modal open (web early-return parity).
            args.Cancel = true;
        }
    }

    private void OnCloseButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args) =>
        _viewModel.RequestClose();

    private void OnViewModelAnnotationSubmitted(object? sender, AnnotationDraft draft) =>
        AnnotationSubmitted?.Invoke(this, draft);

    private void OnViewModelCloseRequested(object? sender, EventArgs e) =>
        Cancelled?.Invoke(this, EventArgs.Empty);

    private void OnDialogClosed(ContentDialog sender, ContentDialogClosedEventArgs args)
    {
        sender.PrimaryButtonClick -= OnPrimaryButtonClick;
        sender.CloseButtonClick -= OnCloseButtonClick;
        sender.Closed -= OnDialogClosed;
        _dialog = null;
        RaiseClosed();
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(AddAnnotationPopoverViewModel.CanSubmit):
                if (_dialog is { } dialog)
                {
                    dialog.IsPrimaryButtonEnabled = _viewModel.CanSubmit;
                }

                break;
            case nameof(AddAnnotationPopoverViewModel.EditedDate):
                SyncDatePicker();
                break;
            default:
                break;
        }
    }

    private void SyncDatePicker()
    {
        if (!_viewModel.EditableDate)
        {
            return;
        }

        _suppressDateSync = true;
        _datePicker.Date = ToOffset(_viewModel.EditedDate);
        _suppressDateSync = false;
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

    private static DateTimeOffset? ToOffset(string yyyymmdd)
    {
        if (DateOnly.TryParseExact(yyyymmdd, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
        {
            return new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified));
        }

        return null;
    }

    private static string FromOffset(DateTimeOffset? offset) =>
        offset is { } value ? value.DateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : string.Empty;

    private static Color ParseHexColor(string hex)
    {
        ReadOnlySpan<char> span = hex.AsSpan(hex.StartsWith('#') ? 1 : 0);
        byte r = byte.Parse(span[..2], NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        byte g = byte.Parse(span.Slice(2, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        byte b = byte.Parse(span.Slice(4, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        return Color.FromArgb(255, r, g, b);
    }

    private sealed record CategoryPill(ToggleButton Button, FontIcon Icon, AnnotationCategory Value, Color Accent);
}
