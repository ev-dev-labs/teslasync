using System.Threading.Tasks;

namespace TeslaSync.App.SharedSurfaces.MaskedValueSurface;

/// <summary>
/// The reveal-audit seam the <c>MaskedValue</c> surface posts through (P1/S8 state-holder layer) — the native
/// port of the web <c>postRevealAudit</c> helper (web/src/components/ui/MaskedValue.tsx L82-96), which fires a
/// best-effort <c>fetch(apiUrl('/audit/reveal'))</c> when <c>auditOnReveal</c> is set. Implementations
/// encapsulate ALL network I/O and its failure handling: <see cref="PostRevealAsync"/> records the reveal and
/// MUST NOT throw — the web helper's <c>try</c> / <c>catch</c> (and the <c>.catch()</c> on the promise) are
/// reproduced inside the implementation, so a missing endpoint or transient backend failure never interferes
/// with the reveal UX. The production binding (an HTTP POST of <c>{ kind: 'masked_reveal', variant }</c> to
/// <see cref="MaskedValueRegistration.AuditPath"/>) is wired by the host; <see cref="NoOpRevealAuditSink"/> is
/// the inert default for hosts that have not opted into reveal auditing — matching the web default
/// (<c>auditOnReveal = false</c>), under which no audit is ever posted.
/// </summary>
public interface IRevealAuditSink
{
    /// <summary>
    /// Record a reveal of the given variant (web <c>postRevealAudit(variant)</c>). Implementations swallow
    /// their own errors and never throw, reproducing the web helper's fire-and-forget contract.
    /// </summary>
    /// <param name="variant">The wire identifier of the revealed value's variant (e.g. <c>token</c>).</param>
    /// <returns>A task that completes when the best-effort post is dispatched.</returns>
    Task PostRevealAsync(string variant);
}

/// <summary>
/// A delegate-backed <see cref="IRevealAuditSink"/> — lets a host supply the reveal-audit post as a function
/// (used by the WinUI host to forward to the API client, and by tests to observe the variant). A null delegate
/// degrades to a completed no-op task, matching a host that has not wired an audit endpoint.
/// </summary>
public sealed class DelegateRevealAuditSink : IRevealAuditSink
{
    private readonly Func<string, Task>? _post;

    /// <summary>Creates the sink from a reveal-audit post delegate.</summary>
    /// <param name="post">Posts the audit for the given variant; may be null.</param>
    public DelegateRevealAuditSink(Func<string, Task>? post) => _post = post;

    /// <inheritdoc />
    public Task PostRevealAsync(string variant) => _post?.Invoke(variant) ?? Task.CompletedTask;
}

/// <summary>
/// The inert reveal-audit sink — every post is a completed no-op (no audit endpoint wired). Used as the safe
/// default, matching the web component's default <c>auditOnReveal = false</c> under which no reveal is ever
/// audited; a reveal still works exactly the same, it is simply not recorded.
/// </summary>
public sealed class NoOpRevealAuditSink : IRevealAuditSink
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpRevealAuditSink Instance { get; } = new();

    private NoOpRevealAuditSink()
    {
    }

    /// <inheritdoc />
    public Task PostRevealAsync(string variant) => Task.CompletedTask;
}
