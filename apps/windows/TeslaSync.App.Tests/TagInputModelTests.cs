using TeslaSync.App.Core.Forms;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class TagInputModelTests
{
    [Fact]
    public void Add_TrimsAndRejectsBlank()
    {
        var model = new TagInputModel();
        Assert.True(model.Add("  hello  "));
        Assert.False(model.Add("   "));
        Assert.Equal(["hello"], model.Tags);
    }

    [Fact]
    public void Add_RejectsDuplicatesCaseInsensitiveByDefault()
    {
        var model = new TagInputModel();
        model.Add("Tag");
        Assert.False(model.Add("tag"));
        Assert.Single(model.Tags);
    }

    [Fact]
    public void Add_AllowsDuplicatesWhenConfigured()
    {
        var model = new TagInputModel(allowDuplicates: true);
        model.Add("x");
        Assert.True(model.Add("x"));
        Assert.Equal(2, model.Count);
    }

    [Fact]
    public void MaxTags_Caps()
    {
        var model = new TagInputModel(maxTags: 2);
        model.Add("a");
        model.Add("b");
        Assert.False(model.CanAddMore);
        Assert.False(model.Add("c"));
    }

    [Fact]
    public void AddMany_SplitsOnSeparators()
    {
        var model = new TagInputModel();
        var added = model.AddMany("one, two;three\nfour");
        Assert.Equal(["one", "two", "three", "four"], added);
    }

    [Fact]
    public void RemoveAndRemoveLast()
    {
        var model = new TagInputModel();
        model.AddMany("a,b,c");
        Assert.True(model.Remove("b"));
        Assert.Equal(["a", "c"], model.Tags);
        Assert.True(model.RemoveLast());
        Assert.Equal(["a"], model.Tags);
    }

    [Fact]
    public void Set_ReplacesRespectingRules()
    {
        var model = new TagInputModel();
        model.Set(["a", " a ", "b", ""]);
        Assert.Equal(["a", "b"], model.Tags);
    }
}
