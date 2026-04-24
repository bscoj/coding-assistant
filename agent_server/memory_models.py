from __future__ import annotations

from dataclasses import dataclass, field


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
class TaskJournal:
    conversation_id: str
    objective: str
    repo: str | None
    status: str
    files_inspected: list[str]
    files_changed: list[str]
    generated_code_artifacts: list[str]
    key_decisions: list[str]
    open_questions: list[str]
    known_errors: list[str]
    next_steps: list[str]
    updated_at: str


@dataclass(slots=True)
class PinnedTurn:
    id: str
    conversation_id: str
    turn_index: int
    message_id: str | None
    kind: str
    summary: str
    content_excerpt: str
    created_at: str
    updated_at: str


@dataclass(slots=True)
class MemoryState:
    conversation_id: str
    summary_text: str
    summarized_through_turn: int
    facts: list[MemoryFact]
    task_journal: TaskJournal | None
    pinned_turns: list[PinnedTurn]
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
class PinnedTurnUpsert:
    turn_index: int
    kind: str
    summary: str
    content_excerpt: str


@dataclass(slots=True)
class MemoryUpdatePayload:
    summary_text: str
    summarized_through_turn: int
    fact_upserts: list[FactUpsert] = field(default_factory=list)
    fact_status_changes: list[FactStatusChange] = field(default_factory=list)
    task_journal: TaskJournal | None = None
    pinned_turn_upserts: list[PinnedTurnUpsert] = field(default_factory=list)
