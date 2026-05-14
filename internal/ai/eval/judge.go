package eval

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"text/template"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

//go:embed judge_prompt.tmpl
var judgePromptTemplateRaw string

// judgePromptTpl is the parsed template; failure to parse at startup
// is a programming error and panics so a malformed template can never
// silently degrade the judge step.
var judgePromptTpl = template.Must(template.New("judge").Parse(judgePromptTemplateRaw))

// judgePromptInput is the data passed to the embedded template.
type judgePromptInput struct {
	Question string
	Answer   string
	Rubric   string
	Seed     int
}

// renderJudgePrompt produces the judge's user prompt from the
// embedded template. Exposed (lower-case) so tests can compare
// rendered output without depending on the raw template literal.
func renderJudgePrompt(question, answer, rubric string, seed int) (string, error) {
	var sb strings.Builder
	err := judgePromptTpl.Execute(&sb, judgePromptInput{
		Question: question,
		Answer:   answer,
		Rubric:   rubric,
		Seed:     seed,
	})
	if err != nil {
		return "", fmt.Errorf("eval: render judge prompt: %w", err)
	}
	return sb.String(), nil
}

// runJudge invokes the LLM-as-judge for one golden. The judge sees:
//
//   - The user question that was originally asked.
//   - The dispatcher's final answer text.
//   - The rubric authored on the golden's expectations.
//
// The judge MUST return JSON: `{"score": <1-5>, "reason": "..."}`.
// runJudge parses that JSON; any parse failure surfaces as an error.
//
// Determinism (R6 mitigation): the judge is invoked at temperature=0
// with a seed embedded in the prompt template (the F6 design pinned
// 42). Adapters that honour the `Temperature` request field run at 0;
// adapters that don't read seed from request still see a deterministic
// prompt because the seed is in the user message text.
func runJudge(ctx context.Context, p provider.Provider, model string, seed int, question, answer, rubric string) (int, string, error) {
	if p == nil {
		return 0, "", errors.New("eval: judge requested but no JudgeProvider configured")
	}
	prompt, err := renderJudgePrompt(question, answer, rubric, seed)
	if err != nil {
		return 0, "", err
	}
	req := provider.ChatRequest{
		Model:       model,
		Temperature: 0,
		Messages: []provider.Message{
			{Role: provider.RoleUser, Content: prompt},
		},
	}
	resp, err := p.Chat(ctx, req)
	if err != nil {
		return 0, "", fmt.Errorf("eval: judge chat: %w", err)
	}
	score, reason, perr := parseJudgeReply(resp.Message.Content)
	if perr != nil {
		return 0, "", fmt.Errorf("eval: parse judge reply %q: %w", truncate(resp.Message.Content, 200), perr)
	}
	return score, reason, nil
}

// parseJudgeReply extracts {score, reason} from a judge response.
// Accepts either a bare JSON object or a JSON object embedded in
// surrounding text (the template asks for JSON but some judges add
// preamble; we tolerate that by extracting the first {...} block).
func parseJudgeReply(s string) (int, string, error) {
	body, ok := extractJSONObject(s)
	if !ok {
		return 0, "", errors.New("no JSON object found in reply")
	}
	var v struct {
		Score  int    `json:"score"`
		Reason string `json:"reason"`
	}
	if err := json.Unmarshal([]byte(body), &v); err != nil {
		return 0, "", fmt.Errorf("unmarshal: %w", err)
	}
	if v.Score < 1 || v.Score > 5 {
		return v.Score, v.Reason, fmt.Errorf("score %d not in [1,5]", v.Score)
	}
	return v.Score, v.Reason, nil
}

// extractJSONObject returns the first balanced {...} substring of s.
// Tolerates leading/trailing prose around the JSON object.
func extractJSONObject(s string) (string, bool) {
	start := strings.IndexByte(s, '{')
	if start < 0 {
		return "", false
	}
	depth := 0
	for i := start; i < len(s); i++ {
		switch s[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return s[start : i+1], true
			}
		}
	}
	return "", false
}
