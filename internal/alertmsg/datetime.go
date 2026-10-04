package alertmsg

import (
	"strconv"
	"strings"
	"time"

	"golang.org/x/text/language"
	"golang.org/x/text/message"
	"golang.org/x/text/number"
)

// These seven locales are the persisted choices in GeneralSettings. Patterns
// and contextual months mirror dateFormat.ts's Intl fields, not Go's English
// time layouts. No browser/Node runtime is needed by notification workers.
type dateLocale struct {
	months                       []string
	absolute, date, short, clock string
	hour12                       bool
	now                          string
	past, future                 [3]string
}

var dateLocales = []dateLocale{
	{strings.Fields("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec"), "{month} {day}, {year}, {hour}:{minute} {period}", "{month} {day}, {year}", "{month} {day}", "{hour}:{minute} {period}", true, "just now", [3]string{"{n}m ago", "{n}h ago", "{n}d ago"}, [3]string{"in {n}m", "in {n}h", "in {n}d"}},
	{strings.Fields("Jan Feb Mar Apr May Jun Jul Aug Sept Oct Nov Dec"), "{day} {month} {year}, {hour}:{minute}", "{day} {month} {year}", "{day} {month}", "{hour}:{minute}", false, "just now", [3]string{"{n}m ago", "{n}h ago", "{n}d ago"}, [3]string{"in {n}m", "in {n}h", "in {n}d"}},
	{strings.Fields("Jan. Feb. März Apr. Mai Juni Juli Aug. Sept. Okt. Nov. Dez."), "{day}. {month} {year}, {hour}:{minute}", "{day}. {month} {year}", "{day}. {month}", "{hour}:{minute}", false, "jetzt", [3]string{"vor {n} m", "vor {n} Std.", "vor {n} Tagen"}, [3]string{"in {n} m", "in {n} Std.", "in {n} Tagen"}},
	{strings.Fields("janv. févr. mars avr. mai juin juil. août sept. oct. nov. déc."), "{day} {month} {year}, {hour}:{minute}", "{day} {month} {year}", "{day} {month}", "{hour}:{minute}", false, "maintenant", [3]string{"-{n} min", "-{n} h", "-{n} j"}, [3]string{"+{n} min", "+{n} h", "+{n} j"}},
	{strings.Fields("ene feb mar abr may jun jul ago sept oct nov dic"), "{day} {month} {year}, {hour}:{minute}", "{day} {month} {year}", "{day} {month}", "{hour}:{minute}", false, "ahora", [3]string{"hace {n} min", "hace {n} h", "hace {n} d"}, [3]string{"dentro de {n} min", "dentro de {n} h", "dentro de {n} d"}},
	{strings.Fields("1 2 3 4 5 6 7 8 9 10 11 12"), "{year}年{month}月{day}日 {hour}:{minute}", "{year}年{month}月{day}日", "{month}月{day}日", "{hour}:{minute}", false, "今", [3]string{"{n}分前", "{n}時間前", "{n}日前"}, [3]string{"{n}分後", "{n}時間後", "{n}日後"}},
	{strings.Fields("1 2 3 4 5 6 7 8 9 10 11 12"), "{year}年{month}月{day}日 {hour}:{minute}", "{year}年{month}月{day}日", "{month}月{day}日", "{hour}:{minute}", false, "现在", [3]string{"{n}分钟前", "{n}小时前", "{n}天前"}, [3]string{"{n}分钟后", "{n}小时后", "{n}天后"}},
}

var dateLanguageMatcher = language.NewMatcher([]language.Tag{
	language.MustParse("en-US"), language.MustParse("en-GB"), language.German,
	language.French, language.Spanish, language.Japanese, language.SimplifiedChinese,
})

type timestampText struct {
	at        time.Time
	valid     bool
	style     string
	prefs     Preferences
	reference time.Time
}

func timestamp(v any) (time.Time, bool) {
	switch value := v.(type) {
	case time.Time:
		return value, !value.IsZero()
	case string:
		t, err := time.Parse(time.RFC3339Nano, value)
		return t, err == nil
	default:
		return time.Time{}, false
	}
}

func (v timestampText) String() string {
	if !v.valid {
		return "—"
	}
	tag, err := language.Parse(v.prefs.Locale)
	if err != nil {
		tag = language.MustParse("en-US")
	}
	_, index, _ := dateLanguageMatcher.Match(tag)
	locale := dateLocales[index]
	zone, err := time.LoadLocation(v.prefs.Timezone)
	if err != nil {
		zone = time.UTC
	}
	at := v.at.In(zone)
	style := v.style
	if style == "auto" {
		style = v.prefs.TimeFormat
	}
	if style == "relative" {
		diff := v.reference.Sub(v.at)
		future := diff < 0
		if future {
			diff = -diff
		}
		if diff < time.Minute {
			return locale.now
		}
		unit, count := 0, int64(diff/time.Minute)
		if diff >= time.Hour {
			unit, count = 1, int64(diff/time.Hour)
		}
		if diff >= 24*time.Hour {
			unit, count = 2, int64(diff/(24*time.Hour))
		}
		if diff < 7*24*time.Hour {
			pattern := locale.past[unit]
			if future {
				pattern = locale.future[unit]
			}
			if index == 2 && unit == 2 && count == 1 {
				pattern = strings.ReplaceAll(pattern, "Tagen", "Tag")
			}
			n := message.NewPrinter(tag).Sprint(number.Decimal(count, number.MaxFractionDigits(0)))
			return strings.ReplaceAll(pattern, "{n}", n)
		}
		style = "date"
	}
	pattern := locale.absolute
	switch style {
	case "date":
		pattern = locale.date
	case "short":
		pattern = locale.short
	case "time":
		pattern = locale.clock
	}
	hour, period := at.Hour(), "AM"
	if locale.hour12 {
		if hour >= 12 {
			period = "PM"
		}
		hour %= 12
		if hour == 0 {
			hour = 12
		}
	}
	padded := func(n int) string {
		s := strconv.Itoa(n)
		if n < 10 {
			s = "0" + s
		}
		return s
	}
	return strings.NewReplacer(
		"{year}", strconv.Itoa(at.Year()), "{month}", locale.months[int(at.Month())-1],
		"{day}", strconv.Itoa(at.Day()), "{hour}", padded(hour),
		"{minute}", padded(at.Minute()), "{period}", period,
	).Replace(pattern)
}

func applyTimestampPreferences(ctx Context, p Preferences) {
	at, valid := timestamp(ctx["Now"])
	reference := p.ReferenceTime
	if reference.IsZero() {
		reference = time.Now().UTC()
	}
	for key, style := range map[string]string{
		"NowDisplay": "auto", "NowAbsolute": "absolute", "NowRelative": "relative",
		"NowDate": "date", "NowDateShort": "short", "NowTime": "time",
	} {
		ctx[key] = timestampText{at: at, valid: valid, style: style, prefs: p, reference: reference}
	}
	if valid {
		ctx["NowRFC3339"] = at.UTC().Format(time.RFC3339Nano)
	} else {
		ctx["NowRFC3339"] = "—"
	}
}
