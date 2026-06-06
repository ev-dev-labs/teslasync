using TeslaSync.App.Core.Push;
using Xunit;

namespace TeslaSync.App.Tests.Push;

/// <summary>Verifies the push redaction/fingerprint helpers never leak a channel URI.</summary>
public sealed class PushRedactionTests
{
    private const string Channel = "https://db5.notify.windows.com/?token=SECRET-ABC";

    [Fact]
    public void Fingerprint_is_stable_opaque_and_does_not_contain_the_uri()
    {
        var a = PushRedaction.Fingerprint(Channel);
        var b = PushRedaction.Fingerprint(Channel);

        Assert.Equal(a, b);
        Assert.StartsWith("wns:", a, StringComparison.Ordinal);
        Assert.DoesNotContain("SECRET", a, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("notify.windows.com", a, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Fingerprint_differs_for_different_channels()
    {
        Assert.NotEqual(
            PushRedaction.Fingerprint(Channel),
            PushRedaction.Fingerprint("https://db5.notify.windows.com/?token=OTHER"));
    }

    [Fact]
    public void Fingerprint_handles_empty()
    {
        Assert.Equal("wns:none", PushRedaction.Fingerprint(null));
        Assert.Equal("wns:none", PushRedaction.Fingerprint(string.Empty));
    }

    [Fact]
    public void Redact_replaces_uri_tokens_in_a_log_line()
    {
        var line = $"push channel created uri={Channel} ok";

        var redacted = PushRedaction.Redact(line);

        Assert.DoesNotContain("notify.windows.com", redacted, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SECRET", redacted, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(PushRedaction.Marker, redacted, StringComparison.Ordinal);
        Assert.Contains("push channel created", redacted, StringComparison.Ordinal);
    }
}
