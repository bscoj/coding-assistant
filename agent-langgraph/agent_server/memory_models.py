from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class StoredMessage:
    id: str
    conversation_id: str
    turn_index: int
    role: str
    content_json: str
    created_at: str


@dataclass(slots=True)
class MemoryFact:
    id: str
    conversation_id: str
    kind: str
    content: str
    status: str
    confidence: float
    source_turn_start: int
    source_turn_end: int
    created_at: str
    updated_at: str


@dataclass(slots=True)
class ConversationMemory:
    conversation_id: str
    summary_text: str
    summarized_through_turn: int
    updated_at: str


@dataclass(slots=True)
class MemoryState:
    conversation_id: str
    summary_text: str
    summarized_through_turn: int
    facts: list[MemoryFact]
    recent_messages: list[StoredMessage]


@dataclass(slots=True)
class FactUpsert:
    kind: str
    content: str
    status: str
    confidence: float
    source_turn_start: int
    source_turn_end: int


@dataclass(slots=True)
class FactStatusChange:
    match_content: str
    new_status: str


@dataclass(slots=True)
class MemoryUpdatePayload:
    summary_text: str
    summarized_through_turn: int
    fact_upserts: list[FactUpsert]
    fact_status_changes: list[FactStatusChange]
