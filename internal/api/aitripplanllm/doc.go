// Package aitripplanllm serves the LLM-backed AI trip-planner draft endpoint.
//
// It owns POST /api/v1/ai/trips/plan/draft and the adapter that delegates AI
// tool calls to the canonical non-AI tripplanner ComputePlan path.
//
// Layer: handler
package aitripplanllm
