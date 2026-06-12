using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.FormFieldSurface;

/// <summary>
/// The native WinUI 3 <c>FormField</c> shared surface — a parity port of
/// <c>web/src/components/forms/FormField.tsx</c>. It is the opinionated label + control + hint/error wrapper
/// the web component is: assign a <see cref="Model"/> (the web <c>label</c> / <c>htmlFor</c> / <c>hint</c> /
/// <c>error</c> / <c>required</c> props) and a <see cref="FieldContent"/> (the web <c>children</c> control),
/// and it renders the web layout — a label (with an optional required asterisk), the hosted control, then a
/// validation error row XOR a helper-hint row. It composes the shared tokenized typography atoms
/// (<see cref="Label"/>, <see cref="ErrorText"/>, <see cref="HelperText"/>) rather than the encapsulated
/// <c>TsFormField</c> primitive, because the surface must drive the web component's defining accessibility
/// behaviour — the <c>useId</c>-derived <c>htmlFor</c> association — which requires direct control over the
/// hosted element's automation id, its label association, and the error / hint element ids: the resolved
/// <c>fieldId</c> becomes the hosted control's <see cref="AutomationProperties.AutomationIdProperty"/> and
/// the label is wired as its <see cref="AutomationProperties.LabeledByProperty"/>, so Narrator reads the
/// control with its label; the error row carries the assertive <see cref="LiveRegion"/> the web
/// <c>role="alert"</c> implies. All id derivation and i18n happen in the WinUI-free
/// <see cref="FormFieldViewModel"/> / <see cref="FormFieldProjection"/>; the view never generates ids or
/// reads strings itself. Because the web component is synchronous and prop-driven (its parent owns the
/// control and any data fetching) it has no loading / error / stale / offline chrome — only the web's own
/// conditional branches (the required marker, and the error-row XOR hint-row), every one of which always
/// renders rather than hiding the surface. The <c>view.opened</c> diagnostic is emitted exactly once on
/// <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class FormField : ContentControl, IDisposable
{
    // web wrapper `space-y-1.5` (0.375rem) between the label, control and hint/error rows.
    private const double RowSpacing = 6;

    // web required marker `ml-1` (0.25rem) between the label text and the asterisk.
    private const double LabelGap = 4;

    private readonly FormFieldViewModel _viewModel;
    private readonly FormFieldDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Label _label = new();
    private readonly Text _required = new() { Value = "*" };
    private readonly ContentPresenter _content = new();
    private readonly ErrorText _error = new();
    private readonly HelperText _hint = new();

    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over its i18n facade, an initial model, the id seam, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade the required marker resolves through (P1/S10).</param>
    /// <param name="model">The initial render model; defaults to <see cref="FormFieldModel.Empty"/>.</param>
    /// <param name="idProvider">The field-id seam; defaults to the process-wide <see cref="FieldIdProvider.Shared"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public FormField(
        ILocalizer localizer,
        FormFieldModel? model = null,
        IFieldIdProvider? idProvider = null,
        FormFieldDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new FormFieldViewModel(localizer, model, idProvider);
        _diagnostics = diagnostics ?? new FormFieldDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        // web required asterisk: `text-rose-300` (the danger token); the body Text atom inherits it.
        _required.Foreground = TypographyTokens.Brush("TsColorDangerBrush");

        var labelRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = LabelGap };
        labelRow.Children.Add(_label);
        labelRow.Children.Add(_required);

        var column = new StackPanel { Spacing = RowSpacing };
        column.Children.Add(labelRow);
        column.Children.Add(_content);
        column.Children.Add(_error);
        column.Children.Add(_hint);
        Content = column;

        // web error `<p role="alert">`: an assertive live region so a validation error is voiced without
        // the user moving focus.
        LiveRegion.Configure(_error, assertive: true);

        // The web wrapper `<div>` carries no ARIA role of its own; keep it out of the automation tree so the
        // label, control and hint/error rows are the only nodes Narrator sees.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>FormField</c>).</summary>
    public static string Slug => FormFieldRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public FormFieldViewModel ViewModel => _viewModel;

    /// <summary>The render model (web props); reassigning re-projects and re-renders the surface.</summary>
    public FormFieldModel Model
    {
        get => _viewModel.Model;
        set => _viewModel.Model = value;
    }

    /// <summary>The hosted editing control (web <c>children</c>); setting it (re)wires the label association.</summary>
    public object? FieldContent
    {
        get => _content.Content;
        set
        {
            _content.Content = value;
            ApplyFieldAccessibility(_viewModel.Display);
        }
    }

    /// <summary>Detach from the state holder and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(FormFieldViewModel.Display))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        FormFieldDisplay display = _viewModel.Display;

        _label.Value = display.Label;

        _required.Visibility = display.ShowRequired ? Visibility.Visible : Visibility.Collapsed;
        if (display.RequiredAutomationName is { } requiredName)
        {
            // web `aria-label="required"` replaces the visible "*" for assistive tech.
            AutomationProperties.SetName(_required, requiredName);
        }

        _error.Value = display.ErrorText ?? string.Empty;
        _error.Visibility = display.ShowError ? Visibility.Visible : Visibility.Collapsed;
        SetOptionalAutomationId(_error, display.ErrorId);

        _hint.Value = display.HintText ?? string.Empty;
        _hint.Visibility = display.ShowHint ? Visibility.Visible : Visibility.Collapsed;
        SetOptionalAutomationId(_hint, display.HintId);

        ApplyFieldAccessibility(display);

        // Voice the validation error on the assertive live region (web role="alert" announcement).
        if (display.ShowError)
        {
            LiveRegion.Announce(_error);
        }
    }

    private void ApplyFieldAccessibility(FormFieldDisplay display)
    {
        if (_content.Content is FrameworkElement field)
        {
            // web `htmlFor` / `useId` association: the control gets the resolved field id and is labelled by
            // the field's label, so Narrator announces the control with its label text.
            AutomationProperties.SetAutomationId(field, display.FieldId);
            AutomationProperties.SetLabeledBy(field, _label);
        }
    }

    private static void SetOptionalAutomationId(FrameworkElement element, string? automationId)
    {
        // web sets the element id only when the row renders (errorId / hintId are otherwise undefined).
        AutomationProperties.SetAutomationId(element, automationId ?? string.Empty);
    }

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }
}
