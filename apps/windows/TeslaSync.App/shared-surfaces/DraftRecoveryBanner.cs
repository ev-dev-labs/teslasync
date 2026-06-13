using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Text = TeslaSync.App.Components.UI.Text;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>DraftRecoveryBanner</c> shared surface — a parity port of the web component
/// (web/src/components/feedback/DraftRecoveryBanner.tsx). It is the reassuring inline notice rendered at the top
/// of an editor that was hydrated from a stored draft: an info-tinted strip leading with a Segoe Fluent info
/// glyph (standing in for the web Lucide <c>Info</c>), the "your unsaved work was restored from {when}" message
/// (the noun-qualified or generic variant), a "Use draft" action (the web <c>ghost</c> button — a UX-only
/// acknowledgement, the draft is already applied on hydration) and a "Discard draft" action (the web
/// <c>secondary</c> button, which resets the editor to a clean baseline and clears the stored draft). It binds
/// the <see cref="DraftRecoveryBannerViewModel"/> (over the P1/S8 <see cref="IDraftRecoverySource"/>) and is
/// shown ONLY while a draft was restored and the user has not dismissed it via either action (the web
/// <c>if (!hasDraft || dismissed) return null</c> gate); otherwise it is collapsed. It is a polite status live
/// region named with the message (so Narrator announces the recovery when it drops in), reads no draft itself,
/// and emits the <c>view.opened</c> diagnostic once when mounted.
/// <para>
/// There is no loading / empty / error / stale / offline chrome: the web source has no data fetch (it is a
/// present-only, prop-driven notice — the draft has already been applied to the editor on hydration), so its
/// only render branches are the collapsed "no draft / dismissed" state and the visible banner (with its
/// known-time vs "a moment ago" and noun-qualified vs generic copy variants) — all reproduced here.
/// </para>
/// </summary>
public sealed partial class DraftRecoveryBanner : ContentControl, IDisposable
{
    private const double GlyphFontSize = 16;       // web Info h-4 w-4
    private const double ColumnSpacing = 12;       // web banner glyph/content gap (gap-3)
    private const double MessageActionsGap = 12;   // web message/actions gap (gap-3)
    private const double ActionsSpacing = 8;       // web gap-2 between the two buttons
    private const double AccentBarWidth = 3;        // web banner accent rail
    private const double SurfacePadH = 12;          // web banner px
    private const double SurfacePadV = 10;          // web banner py
    private const double CornerRadiusPx = 8;        // web rounded-lg

    private readonly DraftRecoveryBannerViewModel _viewModel;
    private readonly DraftRecoveryBannerDiagnostics _diagnostics;
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
        Glyph = DraftRecoveryBannerRegistration.Glyph,
        FontSize = GlyphFontSize,
        VerticalAlignment = VerticalAlignment.Top,
    };

    private readonly Text _message = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly TsButton _useDraft = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
    };

    private readonly TsButton _discard = new()
    {
        Variant = ButtonVariant.Secondary,
        Size = ControlSize.Small,
    };

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the banner with no composition root (the designer / parameterless host entry point): it binds a
    /// static restored-draft snapshot so the surface renders its visible state. Supply an explicit
    /// <see cref="ILocalizer"/> and a bound <see cref="IDraftRecoverySource"/> via the other constructors to drive
    /// i18n and the editor's draft lifecycle from the composition root.
    /// </summary>
    public DraftRecoveryBanner()
        : this(
            new DraftRecoveryBannerViewModel(
                PassthroughLocalizer.Instance,
                new DelegateDraftRecoverySource(new DraftRecoverySnapshot(true, null))),
            diagnostics: null)
    {
    }

    /// <summary>Creates the banner over the i18n facade and a bound draft seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade every string resolves through (web <c>useTranslation</c>).</param>
    /// <param name="source">The draft-recovery state-holder seam (web data props + <c>onRestore</c> / <c>onDiscard</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DraftRecoveryBanner(
        ILocalizer localizer,
        IDraftRecoverySource source,
        DraftRecoveryBannerDiagnostics? diagnostics = null)
        : this(new DraftRecoveryBannerViewModel(localizer, source), diagnostics)
    {
    }

    /// <summary>Creates the banner over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DraftRecoveryBanner(DraftRecoveryBannerViewModel viewModel, DraftRecoveryBannerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new DraftRecoveryBannerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ActionsSpacing,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        actions.Children.Add(_useDraft);
        actions.Children.Add(_discard);

        // web: <div class="flex flex-wrap items-center gap-3"><span class="flex-1 min-w-0">{message}</span>
        //      <div class="flex gap-2 shrink-0">…buttons…</div></div>
        var messageRow = new Grid { ColumnSpacing = MessageActionsGap };
        messageRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        messageRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_message, 0);
        Grid.SetColumn(actions, 1);
        messageRow.Children.Add(_message);
        messageRow.Children.Add(actions);

        var content = new Grid
        {
            ColumnSpacing = ColumnSpacing,
            Padding = new Thickness(SurfacePadH, SurfacePadV, SurfacePadH, SurfacePadV),
        };
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_glyph, 0);
        Grid.SetColumn(messageRow, 1);
        content.Children.Add(_glyph);
        content.Children.Add(messageRow);

        var inner = new Grid();
        inner.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        inner.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_accentBar, 0);
        Grid.SetColumn(content, 1);
        inner.Children.Add(_accentBar);
        inner.Children.Add(content);

        _surface.Child = inner;
        _surface.Background = TypographyTokens.Brush("TsColorSurfaceBrush");

        // The leading glyph is decorative; the control's Narrator name (the message) is authoritative.
        AutomationProperties.SetAccessibilityView(_glyph, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, DraftRecoveryBannerRegistration.BannerAutomationId);
        AutomationProperties.SetAutomationId(_useDraft, DraftRecoveryBannerRegistration.UseDraftAutomationId);
        AutomationProperties.SetAutomationId(_discard, DraftRecoveryBannerRegistration.DiscardAutomationId);

        // web AlertBanner is an inline notice; surface it as a polite status live region (info → non-interrupting).
        LiveRegion.Configure(this, assertive: false);

        _useDraft.Click += OnUseDraftClick;
        _discard.Click += OnDiscardClick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _surface;
        ApplyAccent();
        Render();
    }

    /// <summary>The canonical surface slug (<c>DraftRecoveryBanner</c>).</summary>
    public static string Slug => DraftRecoveryBannerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public DraftRecoveryBannerViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports (the banner message).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _useDraft.Click -= OnUseDraftClick;
        _discard.Click -= OnDiscardClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DraftRecoveryBannerAutomationPeer(this);

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

    private void OnUseDraftClick(object sender, RoutedEventArgs e)
    {
        _viewModel.UseDraft();
        _diagnostics.RecordUseDraft();
    }

    private void OnDiscardClick(object sender, RoutedEventArgs e)
    {
        _viewModel.Discard();
        _diagnostics.RecordDiscard();
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        var projection = _viewModel.Projection;

        _message.Value = projection.Message;
        _useDraft.Text = projection.UseDraftLabel;
        _discard.Text = projection.DiscardLabel;

        AutomationProperties.SetName(this, projection.AccessibleName);
        AutomationProperties.SetName(_useDraft, projection.UseDraftLabel);
        AutomationProperties.SetName(_discard, projection.DiscardLabel);

        Visibility = projection.IsVisible ? Visibility.Visible : Visibility.Collapsed;

        if (projection.IsVisible)
        {
            LiveRegion.Announce(this);
        }
    }

    private void ApplyAccent()
    {
        var accent = TypographyTokens.Brush(DraftRecoveryBannerRegistration.AccentBrushKey);
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

    private sealed class DraftRecoveryBannerAutomationPeer : FrameworkElementAutomationPeer
    {
        public DraftRecoveryBannerAutomationPeer(DraftRecoveryBanner owner)
            : base(owner)
        {
        }

        private DraftRecoveryBanner Surface => (DraftRecoveryBanner)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
