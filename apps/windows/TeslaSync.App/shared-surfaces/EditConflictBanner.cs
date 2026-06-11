using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using Text = TeslaSync.App.Components.UI.Text;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>EditConflictBanner</c> shared surface — a parity port of the web component
/// (web/src/components/feedback/EditConflictBanner.tsx). It is the in-place "another tab/window is editing this"
/// warning: a warning-tinted strip leading with a Segoe Fluent warning glyph (standing in for the web Lucide
/// <c>AlertTriangle</c>), a heading, the body copy (the generic or labelled variant), a "Take over editing"
/// action and an informational switch-to-other-tab hint. It binds the <see cref="EditConflictBannerViewModel"/>
/// (over the P1/S8 <see cref="IEditLeaseSource"/>) and is shown ONLY while a peer holds the lease and this
/// tab/window does not (the web <c>if (isOwner || otherTab === null) return null</c> gate); otherwise it is
/// collapsed. Activating "Take over editing" forwards to the seam's <c>Claim()</c> (web <c>onClick={claim}</c>),
/// which makes this window the owner and yields the peer in lockstep. It is a polite status live region named with
/// the heading + body (so Narrator announces the conflict when it drops in), reads no lease itself, and emits the
/// <c>view.opened</c> diagnostic once when mounted.
/// <para>
/// There is no loading / empty / error / stale / offline chrome: the web source has no data fetch (it is a
/// same-origin tab-to-tab handshake, not a query), so its only states are the collapsed "no conflict" state
/// (this window owns the lease, or no peer has announced) and the visible conflict banner — both reproduced here.
/// </para>
/// </summary>
public sealed partial class EditConflictBanner : ContentControl, IDisposable
{
    private const double GlyphFontSize = 16;     // web AlertTriangle h-4 w-4
    private const double ColumnSpacing = 12;     // web banner glyph/content gap
    private const double TextSpacing = 2;        // web title/body stack
    private const double ActionsTopMargin = 8;   // web mt-2 on the action row
    private const double ActionsSpacing = 8;     // web gap-2
    private const double AccentBarWidth = 3;     // web banner accent rail
    private const double SurfacePadH = 12;       // web banner px
    private const double SurfacePadV = 10;       // web banner py
    private const double CornerRadiusPx = 8;     // web rounded-lg

    private readonly EditConflictBannerViewModel _viewModel;
    private readonly EditConflictBannerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Border _surface = new()
    {
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(CornerRadiusPx),
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly Rectangle _accentBar = new() { Width = AccentBarWidth };

    private readonly FontIcon _glyph = new()
    {
        Glyph = EditConflictBannerRegistration.Glyph,
        FontSize = GlyphFontSize,
        VerticalAlignment = VerticalAlignment.Top,
    };

    private readonly PanelTitle _title = new();
    private readonly Text _body = new();

    private readonly TsButton _takeOver = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
    };

    private readonly Caption _switchHint = new();

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the banner with no composition root (the designer / parameterless host entry point): it binds a
    /// static in-conflict lease so the surface renders its visible state. Supply an explicit
    /// <see cref="ILocalizer"/> and a bound <see cref="IEditLeaseSource"/> via the other constructors to drive
    /// i18n and the cross-tab lease from the composition root.
    /// </summary>
    public EditConflictBanner()
        : this(
            new EditConflictBannerViewModel(
                PassthroughLocalizer.Instance,
                new StaticEditLeaseSource(new EditLeaseSnapshot(false, new EditLeasePeer("peer-tab", 0)))),
            diagnostics: null)
    {
    }

    /// <summary>Creates the banner over the i18n facade and a bound lease seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade every string resolves through (web <c>useTranslation</c>).</param>
    /// <param name="source">The edit-lease state-holder seam (web <c>useEditLease</c>).</param>
    /// <param name="resourceLabel">Optional already-localized resource noun (web <c>resourceLabel</c> prop).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public EditConflictBanner(
        ILocalizer localizer,
        IEditLeaseSource source,
        string? resourceLabel = null,
        EditConflictBannerDiagnostics? diagnostics = null)
        : this(new EditConflictBannerViewModel(localizer, source, resourceLabel), diagnostics)
    {
    }

    /// <summary>Creates the banner over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public EditConflictBanner(EditConflictBannerViewModel viewModel, EditConflictBannerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new EditConflictBannerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ActionsSpacing,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, ActionsTopMargin, 0, 0),
        };
        _switchHint.VerticalAlignment = VerticalAlignment.Center;
        actions.Children.Add(_takeOver);
        actions.Children.Add(_switchHint);

        var textColumn = new StackPanel { Spacing = TextSpacing, VerticalAlignment = VerticalAlignment.Center };
        textColumn.Children.Add(_title);
        textColumn.Children.Add(_body);
        textColumn.Children.Add(actions);

        var content = new Grid { ColumnSpacing = ColumnSpacing, Padding = new Thickness(SurfacePadH, SurfacePadV, SurfacePadH, SurfacePadV) };
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_glyph, 0);
        Grid.SetColumn(textColumn, 1);
        content.Children.Add(_glyph);
        content.Children.Add(textColumn);

        var inner = new Grid();
        inner.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        inner.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_accentBar, 0);
        Grid.SetColumn(content, 1);
        inner.Children.Add(_accentBar);
        inner.Children.Add(content);

        _surface.Child = inner;
        _surface.Background = TypographyTokens.Brush("TsColorSurfaceBrush");

        // The leading glyph is decorative; the control's Narrator name (heading + body) is authoritative.
        AutomationProperties.SetAccessibilityView(_glyph, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, EditConflictBannerRegistration.BannerAutomationId);
        AutomationProperties.SetAutomationId(_takeOver, EditConflictBannerRegistration.TakeOverAutomationId);
        AutomationProperties.SetAutomationId(_switchHint, EditConflictBannerRegistration.SwitchHintAutomationId);

        // web wraps the banner in role="status" aria-live="polite"; surface it as a polite status live region.
        LiveRegion.Configure(this, assertive: false);

        _takeOver.Click += OnTakeOverClick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _surface;
        ApplyAccent();
        Render();
    }

    /// <summary>The canonical surface slug (<c>EditConflictBanner</c>).</summary>
    public static string Slug => EditConflictBannerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public EditConflictBannerViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports (the heading and body).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _takeOver.Click -= OnTakeOverClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new EditConflictBannerAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        if (_viewModel.Projection.IsVisible)
        {
            LiveRegion.Announce(this);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnTakeOverClick(object sender, RoutedEventArgs e)
    {
        _viewModel.TakeOver();
        _diagnostics.RecordTakeOver();
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        var projection = _viewModel.Projection;

        _title.Value = projection.Title;
        _body.Value = projection.Body;
        _takeOver.Text = projection.TakeOverLabel;
        _switchHint.Value = projection.SwitchHint;

        AutomationProperties.SetName(this, projection.AccessibleName);
        AutomationProperties.SetName(_takeOver, projection.TakeOverLabel);
        AutomationProperties.SetName(_switchHint, projection.SwitchHint);

        Visibility = projection.IsVisible ? Visibility.Visible : Visibility.Collapsed;

        if (projection.IsVisible)
        {
            LiveRegion.Announce(this);
        }
    }

    private void ApplyAccent()
    {
        var accent = TypographyTokens.Brush(EditConflictBannerRegistration.AccentBrushKey);
        if (accent is not null)
        {
            _glyph.Foreground = accent;
            _accentBar.Fill = accent;
            _surface.BorderBrush = accent;
        }
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

    private sealed class EditConflictBannerAutomationPeer : FrameworkElementAutomationPeer
    {
        public EditConflictBannerAutomationPeer(EditConflictBanner owner)
            : base(owner)
        {
        }

        private EditConflictBanner Surface => (EditConflictBanner)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
