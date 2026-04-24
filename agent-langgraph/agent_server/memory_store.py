from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agent_server.memory_models import (
    ConversationMemory,
    FactStatusChange,
    FactUpsert,
    MemoryFact,
    MemoryState,
    MemoryUpdatePayload,
    PinnedTurn,
    PinnedTurnUpsert,
    StoredMessage,
    TaskJournal,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_item(item: Any) -> dict[str, Any]:
    if hasattr(item, "model_dump"):
        return item.model_dump()
    if isinstance(item, dict):
        return item
    raise TypeError(f"Unsupported message item type: {type(item)!r}")


def infer_role(item: dict[str, Any]) -> str:
    role = item.get("role")
    if isinstance(role, str):
        return role
    if item.get("type") == "message":
        return "assistant"
    if isinstance(item.get("type"), str):
        return item["type"]
    return "unknown"


def _json_list(values: list[str]) -> str:
    return json.dumps(values, ensure_ascii=True)


def _parse_json_list(raw: Any) -> list[str]:
    if not isinstance(raw, str) or not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def message_storage_id(conversation_id: str, item: dict[str, Any]) -> str:
    item_id = item.get("id")
    if isinstance(item_id, str) and item_id:
        return item_id
    payload = json.dumps(item, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(f"{conversation_id}:{payload}".encode("utf-8")).hexdigest()
    return f"msg_{digest[:32]}"


class MemoryStore:
    def __init__(self, db_path: str):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _initialize(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS conversations (
                  id TEXT PRIMARY KEY,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  title TEXT
                );

                CREATE TABLE IF NOT EXISTS messages (
                  id TEXT PRIMARY KEY,
                  conversation_id TEXT NOT NULL,
                  turn_index INTEGER NOT NULL,
                  role TEXT NOT NULL,
                  content_json TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_turn
                ON messages(conversation_id, turn_index);

                CREATE TABLE IF NOT EXISTS conversation_memory (
                  conversation_id TEXT PRIMARY KEY,
                  summary_text TEXT NOT NULL DEFAULT '',
                  summarized_through_turn INTEGER NOT NULL DEFAULT 0,
                  updated_at TEXT NOT NULL,
                  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
                );

                CREATE TABLE IF NOT EXISTS memory_facts (
                  id TEXT PRIMARY KEY,
                  conversation_id TEXT NOT NULL,
                  kind TEXT NOT NULL,
                  content TEXT NOT NULL,
                  status TEXT NOT NULL,
                  confidence REAL NOT NULL,
                  source_turn_start INTEGER NOT NULL,
                  source_turn_end INTEGER NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
                );

                CREATE INDEX IF NOT EXISTS idx_memory_facts_conversation_status
                ON memory_facts(conversation_id, status);

                CREATE TABLE IF NOT EXISTS conversation_task_journal (
                  conversation_id TEXT PRIMARY KEY,
                  objective TEXT NOT NULL DEFAULT '',
                  repo TEXT,
                  status TEXT NOT NULL DEFAULT 'planning',
                  files_inspected_json TEXT NOT NULL DEFAULT '[]',
                  files_changed_json TEXT NOT NULL DEFAULT '[]',
                  generated_code_artifacts_json TEXT NOT NULL DEFAULT '[]',
                  key_decisions_json TEXT NOT NULL DEFAULT '[]',
                  open_questions_json TEXT NOT NULL DEFAULT '[]',
                  known_errors_json TEXT NOT NULL DEFAULT '[]',
                  next_steps_json TEXT NOT NULL DEFAULT '[]',
                  updated_at TEXT NOT NULL,
                  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
                );

                CREATE TABLE IF NOT EXISTS pinned_turns (
                  id TEXT PRIMARY KEY,
                  conversation_id TEXT NOT NULL,
                  turn_index INTEGER NOT NULL,
                  message_id TEXT,
                  kind TEXT NOT NULL,
                  summary TEXT NOT NULL,
                  content_excerpt TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_pinned_turns_unique
                ON pinned_turns(conversation_id, turn_index, kind);

                CREATE INDEX IF NOT EXISTS idx_pinned_turns_conversation_updated
                ON pinned_turns(conversation_id, updated_at DESC, turn_index DESC);
                """
            )

    def ensure_conversation(self, conversation_id: str) -> None:
        now = utc_now()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO conversations (id, created_at, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at
                """,
                (conversation_id, now, now),
            )
            conn.execute(
                """
                INSERT INTO conversation_memory (conversation_id, summary_text, summarized_through_turn, updated_at)
                VALUES (?, '', 0, ?)
                ON CONFLICT(conversation_id) DO NOTHING
                """,
                (conversation_id, now),
            )
            conn.execute(
                """
                INSERT INTO conversation_task_journal (
                  conversation_id, objective, repo, status, files_inspected_json,
                  files_changed_json, generated_code_artifacts_json, key_decisions_json,
                  open_questions_json, known_errors_json, next_steps_json, updated_at
                )
                VALUES (?, '', NULL, 'planning', '[]', '[]', '[]', '[]', '[]', '[]', '[]', ?)
                ON CONFLICT(conversation_id) DO NOTHING
                """,
                (conversation_id, now),
            )

    def save_messages(self, conversation_id: str, items: list[Any]) -> list[StoredMessage]:
        if not items:
            return []
        normalized_items = [normalize_item(item) for item in items]
        now = utc_now()
        self.ensure_conversation(conversation_id)
        stored: list[StoredMessage] = []
        with self._connect() as conn:
            turn_index = conn.execute(
                "SELECT COALESCE(MAX(turn_index), 0) FROM messages WHERE conversation_id = ?",
                (conversation_id,),
            ).fetchone()[0]
            for item in normalized_items:
                message_id = message_storage_id(conversation_id, item)
                existing = conn.execute(
                    """
                    SELECT id, conversation_id, turn_index, role, content_json, created_at
                    FROM messages
                    WHERE id = ?
                    """,
                    (message_id,),
                ).fetchone()
                if existing:
                    stored.append(self._row_to_message(existing))
                    continue
                turn_index += 1
                created_at = now
                content_json = json.dumps(item, ensure_ascii=True)
                role = infer_role(item)
                conn.execute(
                    """
                    INSERT INTO messages (id, conversation_id, turn_index, role, content_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (message_id, conversation_id, turn_index, role, content_json, created_at),
                )
                stored.append(
                    StoredMessage(
                        id=message_id,
                        conversation_id=conversation_id,
                        turn_index=turn_index,
                        role=role,
                        content_json=content_json,
                        created_at=created_at,
                    )
                )
            conn.execute(
                "UPDATE conversations SET updated_at = ? WHERE id = ?",
                (now, conversation_id),
            )
        return stored

    def load_memory_state(self, conversation_id: str, recent_messages_limit: int) -> MemoryState:
        self.ensure_conversation(conversation_id)
        with self._connect() as conn:
            memory_row = conn.execute(
                """
                SELECT conversation_id, summary_text, summarized_through_turn, updated_at
                FROM conversation_memory
                WHERE conversation_id = ?
                """,
                (conversation_id,),
            ).fetchone()
            fact_rows = conn.execute(
                """
                SELECT id, conversation_id, kind, content, status, confidence, source_turn_start,
                       source_turn_end, created_at, updated_at
                FROM memory_facts
                WHERE conversation_id = ? AND status = 'active'
                ORDER BY updated_at DESC, created_at DESC
                """,
                (conversation_id,),
            ).fetchall()
            journal_row = conn.execute(
                """
                SELECT conversation_id, objective, repo, status, files_inspected_json,
                       files_changed_json, generated_code_artifacts_json, key_decisions_json,
                       open_questions_json, known_errors_json, next_steps_json, updated_at
                FROM conversation_task_journal
                WHERE conversation_id = ?
                """,
                (conversation_id,),
            ).fetchone()
            pinned_rows = conn.execute(
                """
                SELECT id, conversation_id, turn_index, message_id, kind, summary,
                       content_excerpt, created_at, updated_at
                FROM pinned_turns
                WHERE conversation_id = ?
                ORDER BY updated_at DESC, turn_index DESC
                LIMIT 12
                """,
                (conversation_id,),
            ).fetchall()
            message_rows = conn.execute(
                """
                SELECT id, conversation_id, turn_index, role, content_json, created_at
                FROM messages
                WHERE conversation_id = ?
                ORDER BY turn_index DESC
                LIMIT ?
                """,
                (conversation_id, recent_messages_limit),
            ).fetchall()

        memory = ConversationMemory(
            conversation_id=memory_row["conversation_id"],
            summary_text=memory_row["summary_text"],
            summarized_through_turn=memory_row["summarized_through_turn"],
            updated_at=memory_row["updated_at"],
        )
        facts = [self._row_to_fact(row) for row in fact_rows]
        journal = self._row_to_task_journal(journal_row) if journal_row is not None else None
        pinned_turns = [self._row_to_pinned_turn(row) for row in reversed(pinned_rows)]
        recent_messages = [self._row_to_message(row) for row in reversed(message_rows)]
        return MemoryState(
            conversation_id=conversation_id,
            summary_text=memory.summary_text,
            summarized_through_turn=memory.summarized_through_turn,
            facts=facts,
            task_journal=journal,
            pinned_turns=pinned_turns,
            recent_messages=recent_messages,
        )

    def load_unsummarized_messages(self, conversation_id: str, keep_recent_messages: int) -> list[StoredMessage]:
        self.ensure_conversation(conversation_id)
        with self._connect() as conn:
            memory_row = conn.execute(
                "SELECT summarized_through_turn FROM conversation_memory WHERE conversation_id = ?",
                (conversation_id,),
            ).fetchone()
            latest_turn = conn.execute(
                "SELECT COALESCE(MAX(turn_index), 0) FROM messages WHERE conversation_id = ?",
                (conversation_id,),
            ).fetchone()[0]
            upper_turn = max(memory_row["summarized_through_turn"], latest_turn - keep_recent_messages)
            rows = conn.execute(
                """
                SELECT id, conversation_id, turn_index, role, content_json, created_at
                FROM messages
                WHERE conversation_id = ?
                  AND turn_index > ?
                  AND turn_index <= ?
                ORDER BY turn_index ASC
                """,
                (conversation_id, memory_row["summarized_through_turn"], upper_turn),
            ).fetchall()
        return [self._row_to_message(row) for row in rows]

    def apply_memory_update(self, conversation_id: str, payload: MemoryUpdatePayload) -> None:
        now = utc_now()
        self.ensure_conversation(conversation_id)
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE conversation_memory
                SET summary_text = ?, summarized_through_turn = ?, updated_at = ?
                WHERE conversation_id = ?
                """,
                (payload.summary_text, payload.summarized_through_turn, now, conversation_id),
            )
            if payload.task_journal is not None:
                conn.execute(
                    """
                    INSERT INTO conversation_task_journal (
                      conversation_id, objective, repo, status, files_inspected_json,
                      files_changed_json, generated_code_artifacts_json, key_decisions_json,
                      open_questions_json, known_errors_json, next_steps_json, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(conversation_id) DO UPDATE SET
                      objective=excluded.objective,
                      repo=excluded.repo,
                      status=excluded.status,
                      files_inspected_json=excluded.files_inspected_json,
                      files_changed_json=excluded.files_changed_json,
                      generated_code_artifacts_json=excluded.generated_code_artifacts_json,
                      key_decisions_json=excluded.key_decisions_json,
                      open_questions_json=excluded.open_questions_json,
                      known_errors_json=excluded.known_errors_json,
                      next_steps_json=excluded.next_steps_json,
                      updated_at=excluded.updated_at
                    """,
                    (
                        conversation_id,
                        payload.task_journal.objective,
                        payload.task_journal.repo,
                        payload.task_journal.status,
                        _json_list(payload.task_journal.files_inspected),
                        _json_list(payload.task_journal.files_changed),
                        _json_list(payload.task_journal.generated_code_artifacts),
                        _json_list(payload.task_journal.key_decisions),
                        _json_list(payload.task_journal.open_questions),
                        _json_list(payload.task_journal.known_errors),
                        _json_list(payload.task_journal.next_steps),
                        now,
                    ),
                )
            for change in payload.fact_status_changes:
                conn.execute(
                    """
                    UPDATE memory_facts
                    SET status = ?, updated_at = ?
                    WHERE conversation_id = ? AND content = ? AND status = 'active'
                    """,
                    (change.new_status, now, conversation_id, change.match_content),
                )
            for upsert in payload.fact_upserts:
                existing_fact = conn.execute(
                    """
                    SELECT id
                    FROM memory_facts
                    WHERE conversation_id = ? AND kind = ? AND content = ? AND status = ?
                    """,
                    (conversation_id, upsert.kind, upsert.content, upsert.status),
                ).fetchone()
                if existing_fact is not None:
                    conn.execute(
                        """
                        UPDATE memory_facts
                        SET confidence = ?, source_turn_start = ?, source_turn_end = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (
                            upsert.confidence,
                            upsert.source_turn_start,
                            upsert.source_turn_end,
                            now,
                            existing_fact["id"],
                        ),
                    )
                else:
                    conn.execute(
                        """
                        INSERT INTO memory_facts (
                          id, conversation_id, kind, content, status, confidence, source_turn_start,
                          source_turn_end, created_at, updated_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            f"fact_{uuid.uuid4().hex}",
                            conversation_id,
                            upsert.kind,
                            upsert.content,
                            upsert.status,
                            upsert.confidence,
                            upsert.source_turn_start,
                            upsert.source_turn_end,
                            now,
                            now,
                        ),
                    )
            for pin in payload.pinned_turn_upserts:
                message_row = conn.execute(
                    """
                    SELECT id
                    FROM messages
                    WHERE conversation_id = ? AND turn_index = ?
                    """,
                    (conversation_id, pin.turn_index),
                ).fetchone()
                if message_row is None:
                    continue
                conn.execute(
                    """
                    INSERT INTO pinned_turns (
                      id, conversation_id, turn_index, message_id, kind, summary,
                      content_excerpt, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(conversation_id, turn_index, kind) DO UPDATE SET
                      message_id=excluded.message_id,
                      summary=excluded.summary,
                      content_excerpt=excluded.content_excerpt,
                      updated_at=excluded.updated_at
                    """,
                    (
                        f"pin_{uuid.uuid4().hex}",
                        conversation_id,
                        pin.turn_index,
                        message_row["id"],
                        pin.kind,
                        pin.summary,
                        pin.content_excerpt,
                        now,
                        now,
                    ),
                )
            conn.execute(
                """
                DELETE FROM pinned_turns
                WHERE id IN (
                  SELECT id
                  FROM pinned_turns
                  WHERE conversation_id = ?
                  ORDER BY updated_at DESC, turn_index DESC
                  LIMIT -1 OFFSET 40
                )
                """,
                (conversation_id,),
            )
            conn.execute(
                "UPDATE conversations SET updated_at = ? WHERE id = ?",
                (now, conversation_id),
            )

    def get_message_by_turn_index(self, conversation_id: str, turn_index: int) -> StoredMessage | None:
        self.ensure_conversation(conversation_id)
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, conversation_id, turn_index, role, content_json, created_at
                FROM messages
                WHERE conversation_id = ? AND turn_index = ?
                """,
                (conversation_id, turn_index),
            ).fetchone()
        return self._row_to_message(row) if row is not None else None

    def search_messages(self, conversation_id: str, query: str, limit: int = 8) -> list[StoredMessage]:
        self.ensure_conversation(conversation_id)
        needle = f"%{query.strip().lower()}%"
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, conversation_id, turn_index, role, content_json, created_at
                FROM messages
                WHERE conversation_id = ?
                  AND lower(content_json) LIKE ?
                ORDER BY turn_index DESC
                LIMIT ?
                """,
                (conversation_id, needle, max(1, min(limit, 20))),
            ).fetchall()
        return [self._row_to_message(row) for row in rows]

    def latest_turn_index(self, conversation_id: str) -> int:
        self.ensure_conversation(conversation_id)
        with self._connect() as conn:
            return conn.execute(
                "SELECT COALESCE(MAX(turn_index), 0) FROM messages WHERE conversation_id = ?",
                (conversation_id,),
            ).fetchone()[0]

    @staticmethod
    def _row_to_message(row: sqlite3.Row) -> StoredMessage:
        return StoredMessage(
            id=row["id"],
            conversation_id=row["conversation_id"],
            turn_index=row["turn_index"],
            role=row["role"],
            content_json=row["content_json"],
            created_at=row["created_at"],
        )

    @staticmethod
    def _row_to_fact(row: sqlite3.Row) -> MemoryFact:
        return MemoryFact(
            id=row["id"],
            conversation_id=row["conversation_id"],
            kind=row["kind"],
            content=row["content"],
            status=row["status"],
            confidence=row["confidence"],
            source_turn_start=row["source_turn_start"],
            source_turn_end=row["source_turn_end"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _row_to_task_journal(row: sqlite3.Row) -> TaskJournal:
        return TaskJournal(
            conversation_id=row["conversation_id"],
            objective=row["objective"],
            repo=row["repo"],
            status=row["status"],
            files_inspected=_parse_json_list(row["files_inspected_json"]),
            files_changed=_parse_json_list(row["files_changed_json"]),
            generated_code_artifacts=_parse_json_list(row["generated_code_artifacts_json"]),
            key_decisions=_parse_json_list(row["key_decisions_json"]),
            open_questions=_parse_json_list(row["open_questions_json"]),
            known_errors=_parse_json_list(row["known_errors_json"]),
            next_steps=_parse_json_list(row["next_steps_json"]),
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _row_to_pinned_turn(row: sqlite3.Row) -> PinnedTurn:
        return PinnedTurn(
            id=row["id"],
            conversation_id=row["conversation_id"],
            turn_index=row["turn_index"],
            message_id=row["message_id"],
            kind=row["kind"],
            summary=row["summary"],
            content_excerpt=row["content_excerpt"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )


_MEMORY_STORE: MemoryStore | None = None


def get_memory_store() -> MemoryStore:
    global _MEMORY_STORE
    if _MEMORY_STORE is None:
        db_path = Path(os.getenv("MEMORY_DB_PATH", ".local/conversation_memory.db"))
        if not db_path.is_absolute():
            db_path = PROJECT_ROOT / db_path
        _MEMORY_STORE = MemoryStore(db_path=db_path)
    return _MEMORY_STORE
