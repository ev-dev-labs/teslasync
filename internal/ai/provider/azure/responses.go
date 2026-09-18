package azure

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

// Foundry OpenAI v1 Responses API — official surface for gpt-5.6-sol
// and later reasoning models.
// https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses
//
// Chat Completions on gpt-5.6+ rejects function tools unless
// reasoning_effort=none. Helix uses tools, so this path is required.

type responsesCreate struct {
	Model           string           `json:"model"`
	Instructions    string           `json:"instructions,omitempty"`
	Input           []map[string]any `json:"input"`
	Tools           []responsesTool  `json:"tools,omitempty"`
	MaxOutputTokens int              `json:"max_output_tokens,omitempty"`
}

type responsesTool struct {
	Type        string          `json:"type"`
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Parameters  json.RawMessage `json:"parameters,omitempty"`
}

type responsesResult struct {
	OutputText string `json:"output_text"`
	Status     string `json:"status"`
	Output     []struct {
		Type      string `json:"type"`
		Role      string `json:"role"`
		CallID    string `json:"call_id"`
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
		Content   []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	} `json:"output"`
	Usage struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
	IncompleteDetails *struct {
		Reason string `json:"reason"`
	} `json:"incomplete_details"`
}

func (a *Adapter) chatViaResponses(ctx context.Context, req provider.ChatRequest) (*provider.ChatResponse, error) {
	model := a.chatDeployment(req)
	if model == "" {
		return nil, fmt.Errorf("azure: empty responses model")
	}
	endpoint, err := a.buildOpenAIV1URL("responses")
	if err != nil {
		return nil, err
	}
	body, err := encodeResponsesRequest(req, model)
	if err != nil {
		return nil, err
	}
	httpReq, err := a.newRequest(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	resp, err := a.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: azure responses: %v", provider.ErrUpstream, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("%w: azure responses read: %v", provider.ErrUpstream, err)
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("%w: azure responses status %d: %s", provider.ErrUpstream, resp.StatusCode, string(raw))
	}
	return decodeResponses(raw)
}

func encodeResponsesRequest(req provider.ChatRequest, model string) ([]byte, error) {
	var instructions []string
	input := make([]map[string]any, 0, len(req.Messages))
	for _, m := range req.Messages {
		switch m.Role {
		case provider.RoleSystem:
			if strings.TrimSpace(m.Content) != "" {
				instructions = append(instructions, m.Content)
			}
		case provider.RoleUser:
			input = append(input, map[string]any{"role": "user", "content": m.Content})
		case provider.RoleAssistant:
			if m.Content != "" {
				input = append(input, map[string]any{"role": "assistant", "content": m.Content})
			}
			if m.Tool != nil {
				input = append(input, functionCallItem(*m.Tool))
			}
			for _, tc := range m.ToolCalls {
				input = append(input, functionCallItem(tc))
			}
		case provider.RoleTool:
			input = append(input, map[string]any{
				"type":    "function_call_output",
				"call_id": m.ToolID,
				"output":  m.Content,
			})
		default:
			input = append(input, map[string]any{"role": m.Role, "content": m.Content})
		}
	}
	if len(input) == 0 {
		input = append(input, map[string]any{"role": "user", "content": "ping"})
	}
	tools := make([]responsesTool, 0, len(req.Tools))
	for _, t := range req.Tools {
		tools = append(tools, responsesTool{
			Type:        "function",
			Name:        t.Name,
			Description: t.Description,
			Parameters:  t.Parameters,
		})
	}
	n := req.MaxTokens
	if n <= 1 {
		n = defaultMaxCompletionTokens
	}
	wire := responsesCreate{
		Model:           model,
		Instructions:    strings.Join(instructions, "\n\n"),
		Input:           input,
		MaxOutputTokens: n,
	}
	if len(tools) > 0 {
		wire.Tools = tools
	}
	return json.Marshal(wire)
}

func functionCallItem(tc provider.ToolCall) map[string]any {
	args := string(tc.Arguments)
	if args == "" {
		args = "{}"
	}
	return map[string]any{
		"type":      "function_call",
		"call_id":   tc.ID,
		"name":      tc.Name,
		"arguments": args,
	}
}

func decodeResponses(raw []byte) (*provider.ChatResponse, error) {
	var wire responsesResult
	if err := json.Unmarshal(raw, &wire); err != nil {
		return nil, fmt.Errorf("%w: azure responses decode: %v", provider.ErrUpstream, err)
	}
	out := &provider.ChatResponse{
		InputTokens:  wire.Usage.InputTokens,
		OutputTokens: wire.Usage.OutputTokens,
		FinishReason: provider.FinishStop,
		Message: provider.Message{
			Role:    provider.RoleAssistant,
			Content: strings.TrimSpace(wire.OutputText),
		},
	}
	var text []string
	if out.Message.Content != "" {
		text = append(text, out.Message.Content)
	}
	for _, item := range wire.Output {
		switch item.Type {
		case "function_call":
			out.ToolCalls = append(out.ToolCalls, provider.ToolCall{
				ID:        item.CallID,
				Name:      item.Name,
				Arguments: json.RawMessage(item.Arguments),
			})
		case "message":
			for _, c := range item.Content {
				if c.Type == "output_text" && c.Text != "" {
					text = append(text, c.Text)
				}
			}
		}
	}
	if out.Message.Content == "" && len(text) > 0 {
		out.Message.Content = strings.Join(text, "")
	}
	if len(out.ToolCalls) > 0 {
		out.FinishReason = provider.FinishToolCalls
	}
	if wire.Status == "incomplete" {
		reason := ""
		if wire.IncompleteDetails != nil {
			reason = wire.IncompleteDetails.Reason
		}
		if reason == "max_output_tokens" {
			out.FinishReason = provider.FinishLength
		}
	}
	return out, nil
}
