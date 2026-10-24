package catalogparser

import (
	"strings"
	"testing"
)

const acceptedCorpus = `version: 1

slos:
  - name: api_availability
    description: "HTTP request success ratio across /api/v1/."
    sli:
      good_events: "sum(rate(http_requests_total{status_class!=\"5xx\",tag=\"#primary\"}[5m]))"
      valid_events: 'sum(rate(http_requests_total[5m]))'
    objective: 99.5
    window: 30d
    owner: platform
    fast_burn_severity: ticket
    tags: [http, "red#alerts", 'budget']
`

func TestAcceptedCorpus(t *testing.T) {
	t.Parallel()
	c, err := Parse(strings.ReplaceAll(acceptedCorpus, "\n", "\r\n"))
	if err != nil {
		t.Fatalf("Parse(CRLF): %v", err)
	}
	if err := Validate(c); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if len(c.SLOs) != 1 {
		t.Fatalf("SLO count = %d, want 1", len(c.SLOs))
	}
	s := c.SLOs[0]
	if s.Name != "api_availability" {
		t.Errorf("name = %q", s.Name)
	}
	if got := s.SLI.GoodEvents; got != `sum(rate(http_requests_total{status_class!="5xx",tag="#primary"}[5m]))` {
		t.Errorf("good_events = %q", got)
	}
	if got, want := s.Tags, []string{"http", "red#alerts", "budget"}; strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("tags = %v, want %v", got, want)
	}
}

func TestCommentsQuotesAndEscapes(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		line string
		want string
	}{
		{"full comment", `# comment`, ""},
		{"tail comment", `owner: platform # comment`, "owner: platform"},
		{"hash in double quote", `description: "a # hash" # comment`, `description: "a # hash"`},
		{"hash in escaped double quote", `description: "a \"#\" hash" # comment`, `description: "a \"#\" hash"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := strings.TrimRight(StripComment(tt.line), " \t"); got != tt.want {
				t.Errorf("StripComment(%q) = %q, want %q", tt.line, got, tt.want)
			}
		})
	}
}

func TestScalarQuotesAndEscapes(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "plain", input: "platform", want: "platform"},
		{name: "double quote escape", input: `"sum(label!=\"5xx\")"`, want: `sum(label!="5xx")`},
		{name: "single quote escape", input: `'owner''s team'`, want: "owner's team"},
		{name: "unterminated double quote", input: `"unterminated`, wantErr: true},
		{name: "unterminated single quote", input: `'unterminated`, wantErr: true},
		{name: "malformed double quote escape", input: `"bad\qvalue"`, wantErr: true},
		{name: "unexpected quote in plain scalar", input: `pla"te"`, wantErr: true},
		{name: "empty scalar", input: "", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := parseScalar(tt.input, 0, "test")
			if tt.wantErr {
				if err == nil {
					t.Fatalf("parseScalar(%q) unexpectedly succeeded: %q", tt.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseScalar(%q): %v", tt.input, err)
			}
			if got != tt.want {
				t.Errorf("parseScalar(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestInlineArrays(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		input   string
		want    []string
		wantErr bool
	}{
		{name: "empty", input: `[]`, want: []string{}},
		{name: "plain", input: `[http, red]`, want: []string{"http", "red"}},
		{name: "quoted comma", input: `[http, "red,blue"]`, want: []string{"http", "red,blue"}},
		{name: "single quote doubled apostrophe", input: `['owner''s', budget]`, want: []string{"owner's", "budget"}},
		{name: "trailing comma", input: `[http,]`, wantErr: true},
		{name: "missing brackets", input: `http, red`, wantErr: true},
		{name: "unterminated quote", input: `[http, "red]`, wantErr: true},
		{name: "nested array", input: `[http, [red]]`, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := ParseInlineArray(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("ParseInlineArray(%q) unexpectedly succeeded: %v", tt.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseInlineArray(%q): %v", tt.input, err)
			}
			if strings.Join(got, "\x00") != strings.Join(tt.want, "\x00") {
				t.Errorf("got %v, want %v", got, tt.want)
			}
		})
	}
}

func TestRejectedCorpus(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		src  string
		want string
	}{
		{name: "unknown top-level field", src: "version: 1\nslos:\nextra: x\n", want: "top-level"},
		{name: "inline slos", src: "version: 1\nslos: []\n", want: "inline value"},
		{name: "empty version", src: "version:\nslos:\n", want: "version requires"},
		{name: "malformed version", src: "version: nope\nslos:\n", want: "version"},
		{name: "missing slos", src: "version: 1\n", want: "missing top-level slos"},
		{name: "missing version", src: "slos:\n", want: "missing top-level version"},
		{name: "unknown SLO field", src: acceptedCorpus + "    mystery: x\n", want: "unknown SLO field"},
		{name: "unknown nested field", src: strings.Replace(acceptedCorpus, "      good_events:", "      mystery:", 1), want: "unknown sli field"},
		{name: "nested indentation under wrong field", src: "version: 1\nslos:\n  - name: api_availability\n      good_events: x\n", want: "nested field outside"},
		{name: "uneven indentation", src: "version: 1\nslos:\n   - name: api_availability\n    description: \"long enough description\"\n", want: "unexpected indentation"},
		{name: "tab indentation", src: "version: 1\nslos:\n\t- name: api_availability\n", want: "tabs"},
		{name: "SLO item before name", src: "version: 1\nslos:\n  - description: \"long enough description\"\n", want: "SLO item must start"},
		{name: "empty name", src: "version: 1\nslos:\n  - name:\n", want: "name requires"},
		{name: "empty objective", src: strings.Replace(acceptedCorpus, "    objective: 99.5", "    objective:", 1), want: "objective requires"},
		{name: "malformed objective text", src: strings.Replace(acceptedCorpus, "    objective: 99.5", "    objective: nope", 1), want: "malformed number"},
		{name: "malformed objective number", src: strings.Replace(acceptedCorpus, "    objective: 99.5", "    objective: 99.5x", 1), want: "malformed number"},
		{name: "empty description", src: strings.Replace(acceptedCorpus, `description: "HTTP request success ratio across /api/v1/."`, "description:", 1), want: "description requires"},
		{name: "empty tags", src: strings.Replace(acceptedCorpus, "    tags: [http, \"red#alerts\", 'budget']", "    tags:", 1), want: "tags requires"},
		{name: "block tags", src: strings.Replace(acceptedCorpus, "    tags: [http, \"red#alerts\", 'budget']", "    tags:\n      - http", 1), want: "tags"},
		{name: "inline array nested", src: strings.Replace(acceptedCorpus, "    tags: [http, \"red#alerts\", 'budget']", "    tags: [http, [red]]", 1), want: "nested"},
		{name: "duplicate top-level version", src: acceptedCorpus + "version: 1\n", want: "duplicate top-level"},
		{name: "duplicate top-level slos", src: acceptedCorpus + "slos:\n", want: "duplicate top-level"},
		{name: "duplicate SLO field", src: strings.Replace(acceptedCorpus, "    owner: platform\n", "    owner: platform\n    owner: duplicate\n", 1), want: "duplicate SLO field"},
		{name: "duplicate nested field", src: strings.Replace(acceptedCorpus, "      valid_events:", "      good_events: \"also_good\"\n      valid_events:", 1), want: "duplicate SLO field"},
		{name: "inline SLI", src: strings.Replace(acceptedCorpus, "    sli:\n      good_events:", "    sli: {good_events:", 1), want: "sli must be"},
		{name: "duplicate name entries", src: acceptedCorpus + "\n  - name: api_availability\n    description: \"A second valid description.\"\n    sli:\n      good_events: x\n      valid_events: y\n    objective: 99\n    window: 7d\n    owner: platform\n    tags: [http]\n", want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			c, err := Parse(tt.src)
			if err == nil && tt.want == "" {
				err = Validate(c)
			}
			if err == nil {
				t.Fatalf("unexpectedly accepted corpus:\n%s", tt.src)
			}
			if tt.want != "" && !strings.Contains(err.Error(), tt.want) {
				t.Errorf("error = %q, want substring %q", err, tt.want)
			}
		})
	}
}
