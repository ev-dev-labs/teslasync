// Package aialert contains the AI natural-language alert-rule draft handler.
//
// It serves POST /api/v1/ai/alerts/rules/draft through the shared AI guard and
// delegates canonical typed alert-rule validation to the non-AI alerts package.
//
// Layer: handler
package aialert
