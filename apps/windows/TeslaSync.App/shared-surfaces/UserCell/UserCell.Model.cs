using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the UserCell surface — the native mirror of the module-level contract
/// in <c>web/src/components/data-display/UserCell.tsx</c>. The web component is a drop-in cell for
/// user-attributed table columns (an audit-log "actor", a feedback-queue "reporter", a notification-log
/// "delivered to", …): it renders the shared <c>Avatar</c> alongside the resolved display name with an
/// optional muted email line, and collapses to an em-dash when there is no user so empty rows stay scannable.
/// This metadata carries the diagnostics slug, the automation ids mirroring the web <c>data-testid</c>s, the
/// em-dash empty marker the web renders verbatim, and the single i18n key/fallback the source passes to
/// <c>t()</c> (the same <c>avatar.unknown</c> key the composed <see cref="Avatar"/> uses, so the copy is
/// resolved once across both surfaces). UI-free so it is asserted without a XAML host.
/// </summary>
public static class UserCellRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "UserCell";

    /// <summary>Root automation id — the native analogue of the web <c>data-testid="user-cell"</c>.</summary>
    public const string RootAutomationId = "user-cell";

    /// <summary>Automation id for the em-dash empty cell (web <c>data-testid="user-cell-empty"</c>).</summary>
    public const string EmptyAutomationId = "user-cell-empty";

    /// <summary>Automation id for the display-name line (native addressing aid for the web name span).</summary>
    public const string NameAutomationId = "user-cell-name";

    /// <summary>Automation id for the optional email line (native addressing aid for the web email span).</summary>
    public const string EmailAutomationId = "user-cell-email";

    /// <summary>
    /// The em-dash the empty cell renders (web literal <c>—</c>, U+2014). A bare symbol, not English copy, so
    /// it needs no translation — it keeps dense, user-attributed tables scannable when a row has no user.
    /// </summary>
    public const string EmptyMarker = "\u2014";

    /// <summary>
    /// i18n key for the unknown-user fallback name (web <c>t('avatar.unknown', 'Unknown user')</c>). This is the
    /// exact key the composed <see cref="Avatar"/> resolves, so the cell's last-resort display name and the
    /// avatar tooltip agree; it carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects
    /// and exists in <c>Strings/{en,he,ar}/Resources.resw</c>.
    /// </summary>
    public const string UnknownUserKey = AvatarRegistration.UnknownKey;

    /// <summary>English fallback for <see cref="UnknownUserKey"/> (web second arg, verbatim).</summary>
    public const string UnknownUserFallback = AvatarRegistration.UnknownFallback;
}

/// <summary>
/// Pixel metrics for the UserCell layout — the native port of the web Tailwind utilities: the row gap
/// (<c>gap-2</c> = 8px between the avatar and the text column), the display-name text size (<c>text-sm</c> =
/// 14px) and the email text size (<c>text-xs</c> = 12px). Pure and side-effect-free so the view and tests
/// share one source of truth for dimensions.
/// </summary>
public static class UserCellMetrics
{
    /// <summary>Gap between the avatar and the text column in pixels (web <c>gap-2</c>).</summary>
    public const double RowSpacing = 8;

    /// <summary>Display-name font size in pixels (web <c>text-sm</c>).</summary>
    public const double NameFontPx = 14;

    /// <summary>Email font size in pixels (web <c>text-xs</c>).</summary>
    public const double EmailFontPx = 12;
}

/// <summary>
/// The user a cell attributes to — the native port of the web <c>UserCellUser</c> interface
/// (web/src/components/data-display/UserCell.tsx). Every field is optional and may be absent, mirroring the
/// web optional/nullable shape; a cell with no usable signal renders the em-dash empty state. A record so two
/// equal users project identically.
/// </summary>
/// <param name="Id">Stable user id (web <c>id</c>) — the avatar's deterministic colour seed and a last-resort display name.</param>
/// <param name="Name">Display name (web <c>name</c>) — the preferred display name and the avatar initials source.</param>
/// <param name="Email">Email address (web <c>email</c>) — the local-part is the second-choice display name, and the optional muted line.</param>
/// <param name="AvatarUrl">Optional avatar image URL (web <c>avatarUrl</c>) — rendered by the composed avatar, with its own initials/glyph fallback.</param>
public sealed record UserCellUser(
    string? Id = null,
    string? Name = null,
    string? Email = null,
    string? AvatarUrl = null);

/// <summary>
/// The render inputs for a user cell — the native port of the web <c>UserCellProps</c> interface (minus the
/// web <c>className</c>, which has no native analogue). Defaults mirror the web defaults exactly:
/// <c>showEmail=false</c> and <c>size='sm'</c>. A record so two equal prop sets project identically.
/// </summary>
/// <param name="User">The user to attribute to, or <c>null</c> for the empty cell (web <c>user</c>).</param>
/// <param name="ShowEmail">When true, renders the email beneath the name (web <c>showEmail</c>); defaults to false.</param>
/// <param name="Size">The avatar size token (web <c>size</c>); defaults to <see cref="AvatarSize.Sm"/>.</param>
public sealed record UserCellProps(
    UserCellUser? User = null,
    bool ShowEmail = false,
    AvatarSize Size = AvatarSize.Sm);

/// <summary>
/// Which of the two cell visuals renders — the native projection of the web early-return: the em-dash empty
/// cell when there is no usable user signal, otherwise the populated avatar + name (+ optional email) cell.
/// Exposed so the view and tests agree on the rendered branch without a XAML host.
/// </summary>
public enum UserCellContentMode
{
    /// <summary>The em-dash cell — no user, or a user with no name, email or id (web empty early-return).</summary>
    Empty,

    /// <summary>The avatar + display name (+ optional email) cell (web populated branch).</summary>
    Populated,
}

/// <summary>
/// The resolved render decisions for a user cell — the native port of the web component body
/// (web/src/components/data-display/UserCell.tsx): the content branch, the resolved display name following the
/// web priority chain (name → email local-part → id → localized "Unknown user"), whether the muted email line
/// shows, the composed <see cref="AvatarProps"/> the cell hands to the shared <see cref="Avatar"/>, and the
/// cell's accessible name. A <see langword="readonly"/> <see langword="record"/> <see langword="struct"/> so a
/// given input projects to a stable, value-equal snapshot the tests assert per state. Side-effect-free; both
/// the <see cref="UserCellViewModel"/> and the WinUI view render from it.
/// </summary>
public readonly record struct UserCellProjection
{
    private UserCellProjection(
        UserCellContentMode contentMode,
        string displayName,
        bool showEmailLine,
        string email,
        AvatarProps avatarProps,
        string accessibleName)
    {
        ContentMode = contentMode;
        DisplayName = displayName;
        ShowEmailLine = showEmailLine;
        Email = email;
        AvatarProps = avatarProps;
        AccessibleName = accessibleName;
    }

    /// <summary>Which of the two visuals renders (empty em-dash vs populated identity).</summary>
    public UserCellContentMode ContentMode { get; }

    /// <summary>The resolved display name (web <c>displayName</c>); empty in the <see cref="UserCellContentMode.Empty"/> branch.</summary>
    public string DisplayName { get; }

    /// <summary>Whether the muted email line shows beneath the name (web <c>showEmail &amp;&amp; user.email</c>).</summary>
    public bool ShowEmailLine { get; }

    /// <summary>The email text for the optional line (web <c>user.email</c>); empty when no email line shows.</summary>
    public string Email { get; }

    /// <summary>The props the cell hands to the composed avatar (web <c>&lt;Avatar userId name src size showTooltip /&gt;</c>).</summary>
    public AvatarProps AvatarProps { get; }

    /// <summary>
    /// The cell's accessible name — the display name (with the email appended when the email line shows) for a
    /// populated cell, or the em-dash for an empty cell. Narrator announces this once for the whole cell so the
    /// avatar and text lines do not read three times in a dense table.
    /// </summary>
    public string AccessibleName { get; }

    /// <summary>
    /// Project the render decisions from the props and the i18n facade. Mirrors the web component body exactly:
    /// the empty branch when there is no user or the user has no name, email or id (web <c>!user.name &amp;&amp;
    /// !user.email &amp;&amp; !user.id</c>, where a falsy value is null/empty); otherwise the display name is the
    /// trimmed name, else the email local-part, else the id, else the localized "Unknown user" label (web
    /// <c>||</c> chain); the email line shows only when <c>showEmail</c> is set and an email is present; and the
    /// composed avatar is seeded by the id, named by the display name, sourced by the avatar url and tooltipped.
    /// </summary>
    /// <param name="props">The cell render inputs.</param>
    /// <param name="localizer">The i18n facade the unknown-user label resolves through.</param>
    public static UserCellProjection Project(UserCellProps props, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(props);
        ArgumentNullException.ThrowIfNull(localizer);

        UserCellUser? user = props.User;

        // web: if (!user || (!user.name && !user.email && !user.id)) → the em-dash empty cell. A JS falsy
        // string is null/undefined OR the empty string, so the native guard tests IsNullOrEmpty (not
        // whitespace) to match: a whitespace-only name keeps the cell populated, exactly as the web does.
        bool isEmpty = user is null
            || (string.IsNullOrEmpty(user.Name)
                && string.IsNullOrEmpty(user.Email)
                && string.IsNullOrEmpty(user.Id));

        if (isEmpty)
        {
            return new UserCellProjection(
                UserCellContentMode.Empty,
                displayName: string.Empty,
                showEmailLine: false,
                email: string.Empty,
                avatarProps: new AvatarProps(),
                accessibleName: UserCellRegistration.EmptyMarker);
        }

        // web display priority: name?.trim() || email.split('@')[0] || id || t('avatar.unknown', 'Unknown user').
        // The web `||` chain skips any falsy (null/empty) candidate, so the same FirstNonEmpty walk reproduces it;
        // the localized unknown label is always non-empty, so a display name is always resolved.
        string unknownLabel = localizer.GetString(
            UserCellRegistration.UnknownUserKey, UserCellRegistration.UnknownUserFallback);
        string displayName = FirstNonEmpty(
            user!.Name?.Trim(),
            EmailLocalPart(user.Email),
            user.Id,
            unknownLabel);

        // web: showEmail && user.email — the line shows only when requested and an email is present.
        bool showEmailLine = props.ShowEmail && !string.IsNullOrEmpty(user.Email);
        string email = user.Email ?? string.Empty;

        // web: <Avatar userId={user.id ?? undefined} name={displayName} src={user.avatarUrl ?? undefined}
        //              size={size} showTooltip />.
        var avatarProps = new AvatarProps(
            UserId: user.Id,
            Name: displayName,
            Src: user.AvatarUrl,
            Size: props.Size,
            ShowTooltip: true);

        string accessibleName = showEmailLine
            ? string.Create(CultureInfo.CurrentCulture, $"{displayName}, {email}")
            : displayName;

        return new UserCellProjection(
            UserCellContentMode.Populated,
            displayName,
            showEmailLine,
            email,
            avatarProps,
            accessibleName);
    }

    /// <summary>
    /// The web <c>user.email?.split('@')[0]</c> — the email local-part, or <c>null</c> when there is no email.
    /// A null email yields null (the chain falls through); a present email yields the substring before the
    /// first <c>@</c> (which may itself be empty for a leading-<c>@</c> address, and is then skipped too).
    /// </summary>
    private static string? EmailLocalPart(string? email) =>
        email is null ? null : email.Split('@')[0];

    /// <summary>
    /// The first non-null, non-empty candidate — the native analogue of the web string <c>||</c> chain, where
    /// null/undefined and the empty string are falsy and skipped. Returns the empty string only if every
    /// candidate is falsy (callers pass a guaranteed-non-empty final fallback, so this never happens here).
    /// </summary>
    private static string FirstNonEmpty(params string?[] candidates)
    {
        foreach (string? candidate in candidates)
        {
            if (!string.IsNullOrEmpty(candidate))
            {
                return candidate;
            }
        }

        return string.Empty;
    }
}

/// <summary>
/// PII-safe diagnostics for the UserCell surface (P1/S11 diagnostics contract). A user cell carries user
/// identity (name, email, id, avatar), so the collector records ONLY the operational <c>view.opened</c> signal
/// with the surface slug — never the name, email, id or avatar url. Thread-safe; mirrors the shipped surfaces'
/// collectors.
/// </summary>
public sealed class UserCellDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public UserCellDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=UserCell</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(CultureInfo.InvariantCulture, $"view.opened slug={UserCellRegistration.Slug}"));
    }
}
