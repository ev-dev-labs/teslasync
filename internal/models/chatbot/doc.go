// Package chatbot hosts persistence + transport DTOs for the
// AI chatbot bounded context: individual chat messages and per-session
// metadata for the chat sidebar.
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Per ADR-011 this package was carved out of the formerly-flat
// internal/models in phase-R5.4 (extracted from models.go). Recommended
// caller alias when importing alongside other models subpackages
// (per ADR-011 §3): `chatbotmodel "internal/models/chatbot"`.
package chatbot
