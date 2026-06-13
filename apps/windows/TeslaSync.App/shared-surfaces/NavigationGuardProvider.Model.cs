namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// One registered "form is dirty" guard — the native port of the web <c>NavigationGuardEntry</c>
/// (web/src/components/feedback/NavigationGuardProvider.tsx L13-L24). A dirty-form consumer (e.g. the
/// <c>GeneralSettings</c> view's <c>IsDirty</c> / <c>UnsavedChangesMessage</c>, the native analogue of the web
/// <c>useNavigationGuard</c> hook) registers one of these with the provider; the provider owns the
/// <c>Map&lt;id, entry&gt;</c> and consults <see cref="IsDirty"/> when navigation is attempted. The callbacks
/// are read on demand (web reads them from refs) so registering does not have to re-run on every change. Pure
/// data (no WinUI types) so the registration / dirty-scan logic is unit-tested without a UI host.
/// </summary>
public sealed class NavigationGuardEntry
{
    private readonly Func<bool> _isDirty;
    private readonly Func<string?>? _getMessage;

    /// <summary>Creates a guard entry over its stable id and dirty/message callbacks.</summary>
    /// <param name="id">Stable per-mount id (web <c>useId()</c> from the consumer hook); the registry key.</param>
    /// <param name="isDirty">Returns true when the consumer has unsaved edits (web <c>isDirty</c>).</param>
    /// <param name="getMessage">
    /// Optional caller-localized prompt shown when THIS guard blocks navigation (web <c>getMessage</c>); when
    /// omitted the provider falls back to the generic <c>forms.unsavedWarning</c> copy.
    /// </param>
    public NavigationGuardEntry(string id, Func<bool> isDirty, Func<string?>? getMessage = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(id);
        ArgumentNullException.ThrowIfNull(isDirty);

        Id = id;
        _isDirty = isDirty;
        _getMessage = getMessage;
    }

    /// <summary>Stable per-mount id — typically the consumer's <c>useId()</c> (web <c>entry.id</c>).</summary>
    public string Id { get; }

    /// <summary>True when the consumer has unsaved edits (web <c>entry.isDirty()</c>).</summary>
    public bool IsDirty() => _isDirty();

    /// <summary>
    /// The caller-localized prompt for this guard, or <c>null</c> to fall back to the generic warning (web
    /// <c>entry.getMessage()</c>, whose return is <c>string | undefined</c>).
    /// </summary>
    public string? GetMessage() => _getMessage?.Invoke();
}

/// <summary>
/// The mutually-exclusive state the <see cref="NavigationGuardProviderViewModel"/> renders — the native
/// expression of the web <c>NavigationGuardProvider</c>'s only visible gate, the <c>ConfirmDialog</c>
/// <c>open={pending != null}</c> (web/src/components/feedback/NavigationGuardProvider.tsx L217).
/// <para>
/// The web source holds its entire state in-process (a <c>Map</c> of guards plus a <c>pending</c> confirm) and
/// reads it synchronously — it performs <b>no</b> network I/O. So, exactly like the shipped
/// <c>BreadcrumbOverridesContext</c> / <c>DraftRestorePrompt</c> sibling surfaces document, it has <b>no</b>
/// loading / error / stale / offline chrome: there is nothing to fetch, fail, go stale, or fall offline. The
/// states it actually has are reproduced in full: <see cref="Inert"/> (no guard is dirty, nothing is shown —
/// the provider renders its children transparently, web <c>pending == null</c>) and <see cref="Confirming"/>
/// (a dirty guard blocked navigation, so the warning confirm dialog is shown, web <c>pending != null</c>). The
/// generic "empty" state maps to an empty guard registry (no consumer has registered, so
/// <see cref="INavigationGuardRegistry.FindDirty"/> always returns <c>null</c> and navigation is never
/// blocked); the silenced path (the user ticked "Don't ask again") is a behaviour, not a separate visible
/// surface — <see cref="INavigationGuardController.ConfirmIfDirtyAsync"/> auto-resolves without entering
/// <see cref="Confirming"/>.
/// </para>
/// </summary>
public enum NavigationGuardState
{
    /// <summary>No guard is dirty / no confirm in flight — the provider renders children, no dialog (web <c>pending == null</c>).</summary>
    Inert,

    /// <summary>A dirty guard blocked navigation — the warning confirm dialog is shown (web <c>pending != null</c>).</summary>
    Confirming,
}

/// <summary>
/// Canonical metadata + i18n keys/fallbacks for the navigation-guard provider surface — the native mirror of the
/// web <c>NavigationGuardProvider</c> (web/src/components/feedback/NavigationGuardProvider.tsx). It carries the
/// diagnostics slug the surface registers under and every render-contract i18n key/fallback the web source
/// passes to <c>t()</c>, reproducing the web English copy verbatim (verified against
/// <c>web/src/i18n/en.json</c>). Keys mirror the web keys directly, resolved against the English fallback
/// headlessly through the P1/S10 i18n facade. UI-free so it is asserted without a XAML host.
/// </summary>
public static class NavigationGuardProviderRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "NavigationGuardProvider";

    /// <summary>i18n key for the confirm-dialog title (web <c>forms.unsavedTitle</c>).</summary>
    public const string TitleKey = "forms.unsavedTitle";

    /// <summary>English fallback for <see cref="TitleKey"/> (web second arg, verbatim).</summary>
    public const string TitleFallback = "Unsaved changes";

    /// <summary>i18n key for the generic confirm-dialog message (web <c>forms.unsavedWarning</c>).</summary>
    public const string MessageKey = "forms.unsavedWarning";

    /// <summary>English fallback for <see cref="MessageKey"/> (web second arg, verbatim).</summary>
    public const string MessageFallback = "You have unsaved changes. Discard them?";

    /// <summary>i18n key for the confirm (discard) action (web <c>forms.discard</c>).</summary>
    public const string DiscardKey = "forms.discard";

    /// <summary>English fallback for <see cref="DiscardKey"/> (web second arg, verbatim).</summary>
    public const string DiscardFallback = "Discard changes";

    /// <summary>i18n key for the cancel (keep editing) action (web <c>forms.keepEditing</c>).</summary>
    public const string KeepEditingKey = "forms.keepEditing";

    /// <summary>English fallback for <see cref="KeepEditingKey"/> (web second arg, verbatim).</summary>
    public const string KeepEditingFallback = "Keep editing";

    /// <summary>
    /// i18n key for the "Don't ask again" silence checkbox the rendered warning <c>ConfirmDialog</c> shows when
    /// a <c>silenceKey</c> is set (web <c>confirm.silence.checkbox</c>, ConfirmDialog.tsx L182/L184).
    /// </summary>
    public const string SilenceCheckboxKey = "confirm.silence.checkbox";

    /// <summary>English fallback for <see cref="SilenceCheckboxKey"/> (web second arg, verbatim).</summary>
    public const string SilenceCheckboxFallback = "Don't ask again for this action";

    /// <summary>
    /// The stable silence action id the surface confirms under (web <c>silenceKey="unsaved-navigation"</c>,
    /// NavigationGuardProvider.tsx L223). NOT an i18n key — it is the persistence key the
    /// <see cref="IConfirmSilenceStore"/> records the user's "Don't ask again" choice against.
    /// </summary>
    public const string SilenceActionKey = "unsaved-navigation";
}

/// <summary>
/// The accessibility contract for the <c>NavigationGuardProvider</c> view — the native expression of the web
/// source rendering its <c>children</c> plus an out-of-flow <c>ConfirmDialog</c>
/// (web/src/components/feedback/NavigationGuardProvider.tsx L214-L227). The provider itself is a transparent
/// wrapper: it contributes no visible chrome and no accessible node of its own (the WinUI view maps this to
/// <c>AccessibilityView.Raw</c> so Narrator traverses straight through to the hosted content), exactly like the
/// <c>BreadcrumbOverridesProvider</c> sibling. The only accessible surface it raises is the confirm dialog,
/// which is modal (a WinUI <c>ContentDialog</c>, like the web <c>Modal</c> focus trap) and whose title and
/// every button carry a Narrator name. Exposed as constants so the (headless) accessibility test asserts the
/// contract the WinUI view consumes.
/// </summary>
public static class NavigationGuardAccessibility
{
    /// <summary>
    /// Whether the provider contributes an accessible node of its own. Always <c>false</c>: the web source is a
    /// transparent wrapper, so the native provider is an accessibility-raw structural element.
    /// </summary>
    public const bool ProviderContributesAccessibleNode = false;

    /// <summary>
    /// Whether the confirm surface is modal. Always <c>true</c>: the web <c>ConfirmDialog</c> renders inside a
    /// <c>Modal</c> (focus trap + focus restoration on close), and the native view hosts it in a
    /// <c>ContentDialog</c> which provides the same modal semantics.
    /// </summary>
    public const bool ConfirmSurfaceIsModal = true;
}

/// <summary>
/// PII-safe diagnostics for the navigation-guard provider (P1/S11 diagnostics contract). A guard's
/// <see cref="NavigationGuardEntry.GetMessage"/> can carry caller-authored copy describing what the user was
/// editing, so the collector records ONLY operational counters with the surface slug — never a guard message,
/// a guard id, or any form content. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class NavigationGuardProviderDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _confirmsShown;
    private long _discarded;
    private long _kept;
    private long _silencedAutoConfirms;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink (no message/id is ever passed).</summary>
    public NavigationGuardProviderDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been mounted (the <c>view.opened</c> count).</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times the confirm dialog was shown (a dirty guard blocked navigation).</summary>
    public long ConfirmsShown => Interlocked.Read(ref _confirmsShown);

    /// <summary>Number of confirms resolved as Discard (web <c>onConfirm</c>).</summary>
    public long Discarded => Interlocked.Read(ref _discarded);

    /// <summary>Number of confirms resolved as Keep editing (web <c>onCancel</c>).</summary>
    public long Kept => Interlocked.Read(ref _kept);

    /// <summary>Number of times a prior "Don't ask again" choice auto-resolved a confirm without showing the dialog.</summary>
    public long SilencedAutoConfirms => Interlocked.Read(ref _silencedAutoConfirms);

    /// <summary>Record that the provider mounted, emitting <c>view.opened slug=NavigationGuardProvider</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={NavigationGuardProviderRegistration.Slug}");
    }

    /// <summary>Record that the confirm dialog was shown, emitting <c>confirm.shown slug=NavigationGuardProvider</c> (no message).</summary>
    public void RecordConfirmShown()
    {
        Interlocked.Increment(ref _confirmsShown);
        _sink?.Invoke($"confirm.shown slug={NavigationGuardProviderRegistration.Slug}");
    }

    /// <summary>Record a Discard resolution, emitting <c>confirm.discarded slug=NavigationGuardProvider</c>.</summary>
    public void RecordDiscarded()
    {
        Interlocked.Increment(ref _discarded);
        _sink?.Invoke($"confirm.discarded slug={NavigationGuardProviderRegistration.Slug}");
    }

    /// <summary>Record a Keep-editing resolution, emitting <c>confirm.kept slug=NavigationGuardProvider</c>.</summary>
    public void RecordKept()
    {
        Interlocked.Increment(ref _kept);
        _sink?.Invoke($"confirm.kept slug={NavigationGuardProviderRegistration.Slug}");
    }

    /// <summary>Record a silenced auto-confirm, emitting <c>confirm.silenced slug=NavigationGuardProvider</c>.</summary>
    public void RecordSilencedAutoConfirm()
    {
        Interlocked.Increment(ref _silencedAutoConfirms);
        _sink?.Invoke($"confirm.silenced slug={NavigationGuardProviderRegistration.Slug}");
    }
}
