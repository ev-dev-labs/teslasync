using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.A11y;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using UiLabel = TeslaSync.App.Components.UI.Label;

namespace TeslaSync.App.SharedSurfaces.LabelSurface;

/// <summary>
/// The native WinUI 3 <c>Label</c> shared surface — a parity port of the form-label primitive at
/// <c>web/src/components/ui/Label.tsx</c>. It renders a form field's visible label with the web component's
/// accessible required indicator: assign a <see cref="Model"/> (the web <c>children</c> / <c>required</c> /
/// <c>htmlFor</c> props) and it lays out the web composition — the label text, then (when required) a danger-token
/// <c>*</c> marked decorative for assistive technology (web <c>aria-hidden="true"</c>, so Narrator never voices
/// "asterisk") followed by a visually-hidden "required" word carried by the shared <see cref="TsVisuallyHidden"/>
/// atom (the native counterpart of the web <c>@/components/a11y</c> <c>VisuallyHidden</c>, so the word IS voiced).
/// The control's accessible name is therefore "<c>{label} required</c>" — satisfying WCAG 3.3.2 — and
/// <see cref="AssociateWith"/> wires that name onto a paired control (the native <c>htmlFor</c>), so the field
/// reads "Email required". All string resolution and name composition happen in the WinUI-free
/// <see cref="LabelViewModel"/> / <see cref="LabelProjection"/>; the view never reads strings itself. Because the
/// web component is synchronous and prop-driven (its only data source is <c>useTranslation</c>) it has no
/// loading / error / stale / offline chrome — the only conditional branch is the required marker, which always
/// renders rather than hiding the surface. The <c>view.opened</c> diagnostic is emitted exactly once on
/// <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class Label : ContentControl, IDisposable
{
    // web required marker `ml-1` (0.25rem) between the label text and the asterisk.
    private const double RequiredGap = 4;

    private readonly LabelViewModel _viewModel;
    private readonly LabelDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly UiLabel _text = new();
    private readonly Text _glyph = new() { Value = LabelProjection.RequiredGlyph };
    private readonly TsVisuallyHidden _requiredHidden = new();

    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface with the web prop defaults (empty label, not required) over the passthrough localizer — the parameterless host/designer entry point.</summary>
    public Label()
        : this(PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its i18n facade, an initial model and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade the required word resolves through (P1/S10).</param>
    /// <param name="model">The initial render model; defaults to <see cref="LabelModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Label(ILocalizer localizer, LabelModel? model = null, LabelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new LabelViewModel(localizer, model);
        _diagnostics = diagnostics ?? new LabelDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;

        // web required asterisk: `text-rose-300` (the danger token); the body Text atom inherits it.
        _glyph.Foreground = TypographyTokens.Brush("TsColorDangerBrush");

        // web `aria-hidden="true"`: the glyph is decorative, so it is removed from the automation tree and never
        // voiced as "asterisk"; the visually-hidden "required" word carries the meaning instead.
        AutomationProperties.SetAccessibilityView(_glyph, AccessibilityView.Raw);

        var host = new StackPanel { Orientation = Orientation.Horizontal, Spacing = RequiredGap };
        host.Children.Add(_text);
        host.Children.Add(_glyph);
        host.Children.Add(_requiredHidden);
        Content = host;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>Label</c>).</summary>
    public static string Slug => LabelRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public LabelViewModel ViewModel => _viewModel;

    /// <summary>The render model (web props); reassigning re-projects and re-renders the surface.</summary>
    public LabelModel Model
    {
        get => _viewModel.Model;
        set => _viewModel.Model = value;
    }

    /// <summary>
    /// Associate a control with this label — the native analogue of the web <c>htmlFor</c> attribute. Wires the
    /// control's <see cref="AutomationProperties.LabeledByProperty"/> to this label so Narrator announces the
    /// control with the label's composed accessible name (e.g. "Email required").
    /// </summary>
    /// <param name="control">The control this label names.</param>
    public void AssociateWith(FrameworkElement control)
    {
        ArgumentNullException.ThrowIfNull(control);
        AutomationProperties.SetLabeledBy(control, this);
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

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new LabelAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(LabelViewModel.Display))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        LabelDisplay display = _viewModel.Display;

        _text.Value = display.Text;

        _glyph.Visibility = display.ShowRequired ? Visibility.Visible : Visibility.Collapsed;

        if (display.ShowRequired && display.RequiredText is { } requiredText)
        {
            // The visually-hidden word (web VisuallyHidden) — present in the automation tree, clipped to 1x1 so
            // sighted users never see it.
            _requiredHidden.Text = requiredText;
            _requiredHidden.Visibility = Visibility.Visible;
        }
        else
        {
            _requiredHidden.Text = string.Empty;
            _requiredHidden.Visibility = Visibility.Collapsed;
        }

        // web label accessible name: "{label} required" (the aria-hidden "*" excluded, the visually-hidden word
        // included), so the label — and any control wired via AssociateWith — is announced with the marker.
        AutomationProperties.SetName(this, display.AccessibleName);
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

    private sealed class LabelAutomationPeer : FrameworkElementAutomationPeer
    {
        public LabelAutomationPeer(Label owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((Label)Owner).ViewModel.AccessibleName
                : name;
        }
    }
}
