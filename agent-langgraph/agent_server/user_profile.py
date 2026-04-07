from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import tempfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
logger = logging.getLogger(__name__)

DEFAULT_PROFILE_MIN_CONFIDENCE = 0.7
DEFAULT_PROFILE_MAX_ITEMS = 40
PROFILE_KINDS = {
    "coding_preference",
    "workstyle_preference",
    "user_fact",
    "constraint",
}


@dataclass(slots=True)
class UserProfileEntry:
    kind: str
    content: str
    status: str
    confidence: float
    created_at: str
    updated_at: str


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("Invalid float for %s=%s. Using default %s.", name, raw, default)
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("Invalid integer for %s=%s. Using default %s.", name, raw, default)
        return default


def _sanitize_name(value: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-_.")
    return sanitized or "workspace"


def user_profile_enabled() -> bool:
    return os.getenv("USER_PROFILE_ENABLED", "true").lower() not in {"0", "false", "no"}


def user_profile_path() -> Path:
    configured = Path(os.getenv("USER_PROFILE_PATH", ".local/user_profile.json"))
    return configured if configured.is_absolute() else PROJECT_ROOT / configured


def project_profile_dir() -> Path:
    configured = Path(os.getenv("PROJECT_PROFILE_DIR", ".local/project_profiles"))
    return configured if configured.is_absolute() else PROJECT_ROOT / configured


def project_profile_path(workspace_root: str | Path) -> Path:
    workspace = Path(workspace_root).resolve()
    digest = hashlib.sha256(str(workspace).encode("utf-8")).hexdigest()[:16]
    filename = f"{_sanitize_name(workspace.name)}-{digest}.json"
    return project_profile_dir() / filename


def min_profile_confidence() -> float:
    return _env_float("USER_PROFILE_MIN_CONFIDENCE", DEFAULT_PROFILE_MIN_CONFIDENCE)


def max_profile_items() -> int:
    return _env_int("USER_PROFILE_MAX_ITEMS", DEFAULT_PROFILE_MAX_ITEMS)


def profile_model_endpoint() -> str:
    return os.getenv(
        "USER_PROFILE_MODEL_ENDPOINT",
        os.getenv(
            "MEMORY_MODEL_ENDPOINT",
            os.getenv("AGENT_MODEL_ENDPOINT", "databricks-gpt-5-2"),
        ),
    )


def profile_runtime_config() -> dict[str, Any]:
    return {
        "enabled": user_profile_enabled(),
        "global_path": str(user_profile_path()),
        "project_dir": str(project_profile_dir()),
        "min_confidence": min_profile_confidence(),
        "max_items": max_profile_items(),
        "model_endpoint": profile_model_endpoint(),
    }


def _default_document(
    *,
    scope: str,
    title: str,
    workspace_root: str | None = None,
    workspace_name: str | None = None,
) -> dict[str, Any]:
    now = _utc_now()
    return {
        "version": 1,
        "scope": scope,
        "title": title,
        "workspace_root": workspace_root,
        "workspace_name": workspace_name,
        "updated_at": now,
        "entries": [],
    }


class UserProfileStore:
    def __init__(
        self,
        path: Path,
        *,
        scope: str,
        title: str,
        workspace_root: str | None = None,
        workspace_name: str | None = None,
    ):
        self.path = path
        self.scope = scope
        self.title = title
        self.workspace_root = workspace_root
        self.workspace_name = workspace_name
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._initialize()

    def _initialize(self) -> None:
        if self.path.exists():
            return
        self._write_document(
            _default_document(
                scope=self.scope,
                title=self.title,
                workspace_root=self.workspace_root,
                workspace_name=self.workspace_name,
            )
        )

    def _read_document(self) -> dict[str, Any]:
        with self._lock:
            if not self.path.exists():
                self._write_document(
                    _default_document(
                        scope=self.scope,
                        title=self.title,
                        workspace_root=self.workspace_root,
                        workspace_name=self.workspace_name,
                    )
                )
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                logger.exception("Failed to read user profile. Resetting to empty profile.")
                raw = _default_document(
                    scope=self.scope,
                    title=self.title,
                    workspace_root=self.workspace_root,
                    workspace_name=self.workspace_name,
                )
                self._write_document(raw)
            if not isinstance(raw, dict):
                raw = _default_document(
                    scope=self.scope,
                    title=self.title,
                    workspace_root=self.workspace_root,
                    workspace_name=self.workspace_name,
                )
            raw.setdefault("version", 1)
            raw.setdefault("scope", self.scope)
            raw.setdefault("title", self.title)
            raw.setdefault("workspace_root", self.workspace_root)
            raw.setdefault("workspace_name", self.workspace_name)
            raw.setdefault("updated_at", _utc_now())
            raw.setdefault("entries", [])
            if not isinstance(raw["entries"], list):
                raw["entries"] = []
            return raw

    def _write_document(self, document: dict[str, Any]) -> None:
        with self._lock:
            document["scope"] = self.scope
            document["title"] = self.title
            document["workspace_root"] = self.workspace_root
            document["workspace_name"] = self.workspace_name
            document["updated_at"] = _utc_now()
            fd, tmp_path = tempfile.mkstemp(
                dir=str(self.path.parent), prefix=f"{self.path.name}.", suffix=".tmp"
            )
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    json.dump(document, handle, indent=2, ensure_ascii=True, sort_keys=True)
                    handle.write("\n")
                os.replace(tmp_path, self.path)
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)

    def load_entries(self) -> list[UserProfileEntry]:
        document = self._read_document()
        entries: list[UserProfileEntry] = []
        for raw in document.get("entries", []):
            if not isinstance(raw, dict):
                continue
            kind = str(raw.get("kind", "")).strip()
            content = str(raw.get("content", "")).strip()
            status = str(raw.get("status", "active")).strip() or "active"
            if not kind or not content or kind not in PROFILE_KINDS:
                continue
            entries.append(
                UserProfileEntry(
                    kind=kind,
                    content=content,
                    status=status,
                    confidence=float(raw.get("confidence", 0.0)),
                    created_at=str(raw.get("created_at", document["updated_at"])),
                    updated_at=str(raw.get("updated_at", document["updated_at"])),
                )
            )
        return entries

    def export_document(self) -> dict[str, Any]:
        document = self._read_document()
        return {
            "scope": self.scope,
            "title": self.title,
            "path": str(self.path),
            "workspace_root": self.workspace_root,
            "workspace_name": self.workspace_name,
            "updated_at": document.get("updated_at"),
            "entries": [
                {
                    "kind": entry.kind,
                    "content": entry.content,
                    "status": entry.status,
                    "confidence": entry.confidence,
                    "created_at": entry.created_at,
                    "updated_at": entry.updated_at,
                }
                for entry in self.load_entries()
            ],
        }

    def replace_entries(self, entries: list[dict[str, Any]]) -> dict[str, Any]:
        now = _utc_now()
        normalized_entries: list[dict[str, Any]] = []
        for raw in entries:
            if not isinstance(raw, dict):
                continue
            kind = str(raw.get("kind", "")).strip()
            content = str(raw.get("content", "")).strip()
            status = str(raw.get("status", "active")).strip() or "active"
            if kind not in PROFILE_KINDS or not content:
                continue
            normalized_entries.append(
                {
                    "kind": kind,
                    "content": content,
                    "status": status,
                    "confidence": float(raw.get("confidence", 1.0)),
                    "created_at": str(raw.get("created_at", now)),
                    "updated_at": now,
                }
            )

        active_entries = [
            entry for entry in normalized_entries if entry["status"] == "active"
        ]
        inactive_entries = [
            entry for entry in normalized_entries if entry["status"] != "active"
        ]
        active_entries.sort(
            key=lambda entry: (
                str(entry.get("updated_at", "")),
                float(entry.get("confidence", 0.0)),
            ),
            reverse=True,
        )
        document = self._read_document()
        document["entries"] = active_entries[: max_profile_items()] + inactive_entries
        self._write_document(document)
        return self.export_document()

    def render_memory_block(self) -> str | None:
        active_entries = [entry for entry in self.load_entries() if entry.status == "active"]
        if not active_entries:
            return None

        grouped: dict[str, list[str]] = {
            "coding_preference": [],
            "workstyle_preference": [],
            "user_fact": [],
            "constraint": [],
        }
        for entry in active_entries:
            grouped.setdefault(entry.kind, []).append(entry.content)

        sections: list[str] = []
        labels = {
            "coding_preference": "Coding preferences",
            "workstyle_preference": "Workstyle preferences",
            "user_fact": "Durable facts",
            "constraint": "Constraints",
        }
        for kind in ("coding_preference", "workstyle_preference", "user_fact", "constraint"):
            items = grouped.get(kind) or []
            if items:
                sections.append(labels[kind] + ":\n" + "\n".join(f"- {item}" for item in items))

        if not sections:
            return None

        if self.scope == "project":
            trailing = (
                "Use this profile only for durable project-specific context. "
                "If it conflicts with recent conversation turns, prefer the newer conversation context."
            )
        else:
            trailing = (
                "Use this profile only for durable cross-conversation context. "
                "If it conflicts with recent conversation turns, prefer the newer conversation context."
            )

        sections.append(trailing)
        return f"{self.title}\n\n" + "\n\n".join(sections)

    def apply_update(
        self,
        upserts: list[dict[str, Any]],
        status_changes: list[dict[str, Any]],
    ) -> None:
        document = self._read_document()
        now = _utc_now()
        entries = [raw for raw in document.get("entries", []) if isinstance(raw, dict)]

        for change in status_changes:
            match_content = str(change.get("match_content", "")).strip()
            new_status = str(change.get("new_status", "")).strip()
            if not match_content or not new_status:
                continue
            for entry in entries:
                if (
                    str(entry.get("content", "")).strip() == match_content
                    and str(entry.get("status", "active")).strip() == "active"
                ):
                    entry["status"] = new_status
                    entry["updated_at"] = now

        for raw in upserts:
            kind = str(raw.get("kind", "")).strip()
            content = str(raw.get("content", "")).strip()
            status = str(raw.get("status", "active")).strip() or "active"
            confidence = float(raw.get("confidence", 0.0))
            if not content or kind not in PROFILE_KINDS:
                continue

            existing_active = next(
                (
                    entry
                    for entry in entries
                    if str(entry.get("kind")) == kind
                    and str(entry.get("content")).strip() == content
                    and str(entry.get("status", "active")).strip() == "active"
                ),
                None,
            )
            if existing_active:
                existing_active["confidence"] = max(
                    float(existing_active.get("confidence", 0.0)), confidence
                )
                existing_active["updated_at"] = now
                continue

            entries.append(
                {
                    "kind": kind,
                    "content": content,
                    "status": status,
                    "confidence": confidence,
                    "created_at": now,
                    "updated_at": now,
                }
            )

        active_entries = [
            entry for entry in entries if str(entry.get("status", "active")).strip() == "active"
        ]
        inactive_entries = [
            entry for entry in entries if str(entry.get("status", "active")).strip() != "active"
        ]
        active_entries.sort(
            key=lambda entry: (
                str(entry.get("updated_at", "")),
                float(entry.get("confidence", 0.0)),
            ),
            reverse=True,
        )
        document["entries"] = active_entries[: max_profile_items()] + inactive_entries
        self._write_document(document)


def item_text(item: dict[str, Any]) -> str:
    content = item.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if not isinstance(part, dict):
                continue
            if isinstance(part.get("text"), str):
                parts.append(part["text"])
        if parts:
            return "\n".join(parts)
    return json.dumps(content if content is not None else item, ensure_ascii=True)


def render_items(items: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for item in items:
        role = str(item.get("role") or item.get("type") or "unknown")
        lines.append(f"{role}: {item_text(item)}")
    return "\n\n".join(lines)


async def _invoke_text(system_prompt: str, human_prompt: str) -> str:
    from databricks_langchain import ChatDatabricks
    from langchain_core.messages import HumanMessage, SystemMessage

    llm = ChatDatabricks(endpoint=profile_model_endpoint())
    response = await llm.ainvoke(
        [SystemMessage(content=system_prompt), HumanMessage(content=human_prompt)]
    )
    content = response.content
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
            elif isinstance(part, str):
                parts.append(part)
        return "\n".join(parts).strip()
    return str(content).strip()


PROFILE_SYSTEM_PROMPT_TEMPLATE = """You maintain a {profile_kind} for a coding assistant.

Extract only durable information that should persist for future conversations.

Allowed categories:
- coding_preference
- workstyle_preference
- user_fact
- constraint

Store only information that is likely to remain useful across future conversations.
Good examples:
- coding style preferences
- how the user likes explanations or approvals handled
- durable environment or workflow facts
- durable security constraints

Do not store:
- small talk
- one-off task details
- speculative or weakly implied facts
- anything that is already captured unless it changed
- transient details that should stay only in conversation memory

{scope_specific_guidance}

If a new statement replaces an old one, mark the old entry as superseded.

Return valid JSON with this shape:
{{
  "upserts": [
    {{
      "kind": "coding_preference | workstyle_preference | user_fact | constraint",
      "content": "string",
      "status": "active",
      "confidence": 0.0
    }}
  ],
  "status_changes": [
    {{
      "match_content": "existing entry content to update",
      "new_status": "superseded"
    }}
  ]
}}"""


def _profile_prompt(scope: str, workspace_root: str | None = None) -> str:
    if scope == "project":
        guidance = (
            "Keep only durable repo-scoped conventions, constraints, and facts. "
            f"This profile is for the workspace rooted at {workspace_root or '[unknown workspace]'}. "
            "Do not copy generic user preferences here unless they are specific to this project."
        )
        profile_kind = "persistent project profile"
    else:
        guidance = (
            "Keep only durable user-level preferences and facts that should apply across projects "
            "and conversations. Do not store repo-specific conventions here."
        )
        profile_kind = "persistent user profile"
    return PROFILE_SYSTEM_PROMPT_TEMPLATE.format(
        profile_kind=profile_kind,
        scope_specific_guidance=guidance,
    )


def _extract_json_block(text: str) -> dict[str, Any]:
    candidate = text.strip()
    if "```" in candidate:
        for block in candidate.split("```"):
            block = block.strip()
            if block.startswith("json"):
                block = block[4:].strip()
            if block.startswith("{") and block.endswith("}"):
                candidate = block
                break
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found in user profile extractor output")
    return json.loads(candidate[start : end + 1])


async def _maybe_refresh_profile(
    store: UserProfileStore,
    interaction_items: list[dict[str, Any]],
) -> None:
    active_entries = [entry for entry in store.load_entries() if entry.status == "active"]
    interaction_text = render_items(interaction_items)

    try:
        response_text = await _invoke_text(
            _profile_prompt(store.scope, store.workspace_root),
            (
                f"Existing active profile entries:\n"
                f"{json.dumps([asdict(entry) for entry in active_entries], ensure_ascii=True)}\n\n"
                f"New interaction:\n{interaction_text}\n"
            ),
        )
        parsed = _extract_json_block(response_text)
    except Exception:
        logger.exception(
            "Persistent %s refresh skipped because the extraction model was unavailable.",
            store.scope,
        )
        return

    upserts: list[dict[str, Any]] = []
    for raw in parsed.get("upserts", []):
        if not isinstance(raw, dict):
            continue
        kind = str(raw.get("kind", "")).strip()
        content = str(raw.get("content", "")).strip()
        if kind not in PROFILE_KINDS or not content:
            continue
        confidence = float(raw.get("confidence", 0.0))
        if confidence < min_profile_confidence():
            continue
        upserts.append(
            {
                "kind": kind,
                "content": content,
                "status": "active",
                "confidence": confidence,
            }
        )

    status_changes: list[dict[str, Any]] = []
    for raw in parsed.get("status_changes", []):
        if not isinstance(raw, dict):
            continue
        match_content = str(raw.get("match_content", "")).strip()
        new_status = str(raw.get("new_status", "")).strip()
        if match_content and new_status in {"superseded", "resolved"}:
            status_changes.append(
                {"match_content": match_content, "new_status": new_status}
            )

    if upserts or status_changes:
        store.apply_update(upserts=upserts, status_changes=status_changes)


_USER_PROFILE_STORE: UserProfileStore | None = None
_PROJECT_PROFILE_STORES: dict[str, UserProfileStore] = {}


def get_user_profile_store() -> UserProfileStore:
    global _USER_PROFILE_STORE
    if _USER_PROFILE_STORE is None:
        _USER_PROFILE_STORE = UserProfileStore(
            user_profile_path(),
            scope="global",
            title="Persistent user profile",
        )
    return _USER_PROFILE_STORE


def get_project_profile_store(workspace_root: str | Path | None) -> UserProfileStore | None:
    if not workspace_root:
        return None
    workspace = str(Path(workspace_root).resolve())
    store = _PROJECT_PROFILE_STORES.get(workspace)
    if store is None:
        path = project_profile_path(workspace)
        store = UserProfileStore(
            path,
            scope="project",
            title=f"Project profile: {Path(workspace).name}",
            workspace_root=workspace,
            workspace_name=Path(workspace).name,
        )
        _PROJECT_PROFILE_STORES[workspace] = store
    return store


def build_profile_blocks(workspace_root: str | Path | None) -> list[str]:
    blocks: list[str] = []
    global_block = get_user_profile_store().render_memory_block()
    if global_block:
        blocks.append(global_block)
    project_store = get_project_profile_store(workspace_root)
    if project_store:
        project_block = project_store.render_memory_block()
        if project_block:
            blocks.append(project_block)
    return blocks


async def maybe_refresh_user_profiles(
    interaction_items: list[dict[str, Any]],
    workspace_root: str | Path | None,
) -> None:
    if not user_profile_enabled() or not interaction_items:
        return

    await _maybe_refresh_profile(get_user_profile_store(), interaction_items)
    project_store = get_project_profile_store(workspace_root)
    if project_store is not None:
        await _maybe_refresh_profile(project_store, interaction_items)
