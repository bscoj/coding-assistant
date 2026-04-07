from __future__ import annotations

import json
import os
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import unified_diff
from pathlib import Path
from typing import Literal

from langchain_core.tools import tool
from mlflow.genai.agent_server import get_request_headers


PROJECT_ROOT = Path(__file__).resolve().parent.parent
APPROVAL_PREFIX = "APPROVE_WRITE:"
APPROVAL_SERVER_LABEL = "local-filesystem"
STAGED_WRITE_MARKER = "__staged_write_request__"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def workspace_root() -> Path:
    header_root = get_request_headers().get("x-codex-workspace-root")
    root = Path(header_root or os.getenv("FILES_WORKSPACE_ROOT", str(PROJECT_ROOT)))
    if not root.is_absolute():
        root = (PROJECT_ROOT / root).resolve()
    return root.resolve()


def staged_write_store_path() -> Path:
    path = Path(os.getenv("FILES_STAGED_WRITES_PATH", str(PROJECT_ROOT / ".local" / "staged_writes.json")))
    if not path.is_absolute():
        path = (PROJECT_ROOT / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def workspace_index_path() -> Path:
    path = Path(os.getenv("FILES_WORKSPACE_INDEX_PATH", str(PROJECT_ROOT / ".local" / "workspace_index.json")))
    if not path.is_absolute():
        path = (PROJECT_ROOT / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def max_read_bytes() -> int:
    return int(os.getenv("FILES_MAX_READ_BYTES", "60000"))


def max_search_results() -> int:
    return int(os.getenv("FILES_MAX_SEARCH_RESULTS", "50"))


def writes_enabled() -> bool:
    return os.getenv("FILES_WRITE_ENABLED", "true").lower() not in {"0", "false", "no"}


def _normalize_glob(glob: str | None) -> str | None:
    if glob is None:
        return None
    value = glob.strip()
    return value or None


def _user_requested_repo_wide_search() -> bool:
    summary = (_latest_user_request_summary() or "").lower()
    phrases = (
        "whole repo",
        "entire repo",
        "entire repository",
        "whole repository",
        "across the repo",
        "across the repository",
        "search everything",
        "search the repo",
        "search the repository",
        "all files",
    )
    return any(phrase in summary for phrase in phrases)


def _is_overly_broad_glob(glob: str | None) -> bool:
    normalized = _normalize_glob(glob)
    if normalized is None:
        return False
    broad_literals = {"*", "*.*", "**", "**/*", "**/*.*", "./**/*", "./**/*.*"}
    if normalized in broad_literals:
        return True
    if "**" not in normalized:
        return False
    # Treat recursive globs without a meaningful path prefix or extension filter as too broad.
    has_path_prefix = "/" in normalized.replace("./", "", 1)
    has_extension_filter = "." in normalized.split("/")[-1].replace("*", "")
    return not has_path_prefix and not has_extension_filter


def _search_scope_error(glob: str | None) -> str:
    requested = glob or "(none)"
    return (
        f"Refusing broad search scope for glob {requested!r}. "
        "Narrow the search first: use workspace_overview() to inspect the repo, "
        "find_files_by_name() to locate likely files, or search_files() with a scoped path/glob "
        "such as 'src/**/*.ts', 'agent_server/**/*.py', or a specific subdirectory. "
        "Repo-wide wildcard searches should only be used when the user explicitly requests them."
    )


def _resolve_path(path: str) -> Path:
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = workspace_root() / candidate
    resolved = candidate.resolve()
    root = workspace_root()
    if resolved != root and root not in resolved.parents:
        raise ValueError(f"Path {resolved} is outside workspace root {root}")
    return resolved


def _read_text(path: Path) -> str:
    size = path.stat().st_size
    if size > max_read_bytes():
        raise ValueError(
            f"File is too large to read directly ({size} bytes). Limit is {max_read_bytes()} bytes."
        )
    return path.read_text(encoding="utf-8")


def _load_staged_writes() -> dict[str, dict]:
    path = staged_write_store_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _save_staged_writes(data: dict[str, dict]) -> None:
    staged_write_store_path().write_text(
        json.dumps(data, indent=2, ensure_ascii=True, sort_keys=True), encoding="utf-8"
    )


def _scan_workspace(root: Path) -> dict:
    files: list[dict] = []
    extensions: dict[str, int] = {}
    top_dirs: dict[str, int] = {}
    important_files: list[str] = []
    important_names = {
        "package.json",
        "pyproject.toml",
        "requirements.txt",
        "Cargo.toml",
        "go.mod",
        "README.md",
        "Makefile",
        "vite.config.ts",
        "tsconfig.json",
        "databricks.yml",
    }
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(part.startswith(".git") or part == "node_modules" or part == ".venv" for part in rel.parts):
            continue
        ext = path.suffix.lower() or "[no_ext]"
        extensions[ext] = extensions.get(ext, 0) + 1
        top = rel.parts[0] if rel.parts else "."
        top_dirs[top] = top_dirs.get(top, 0) + 1
        if path.name in important_names:
            important_files.append(str(rel))
        files.append(
            {
                "path": str(rel),
                "name": path.name,
                "extension": ext,
                "size": path.stat().st_size,
            }
        )
    return {
        "generated_at": utc_now(),
        "root": str(root),
        "file_count": len(files),
        "extensions": dict(sorted(extensions.items(), key=lambda item: (-item[1], item[0]))[:20]),
        "top_level_dirs": dict(sorted(top_dirs.items(), key=lambda item: (-item[1], item[0]))[:20]),
        "important_files": sorted(important_files)[:50],
        "files": files,
    }


def build_workspace_index(force_refresh: bool = False) -> dict:
    path = workspace_index_path()
    if path.exists() and not force_refresh:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    index = _scan_workspace(workspace_root())
    path.write_text(json.dumps(index, ensure_ascii=True, indent=2), encoding="utf-8")
    return index


def _approval_texts(request_messages: list[dict] | None) -> list[str]:
    if not request_messages:
        return []
    texts: list[str] = []
    for item in request_messages:
        if item.get("role") != "user":
            continue
        content = item.get("content")
        if isinstance(content, str):
            texts.append(content)
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    texts.append(part["text"])
    return texts


def _latest_user_request_summary() -> str | None:
    texts = [text.strip() for text in _approval_texts(_CONTEXT.request_messages) if text.strip()]
    if not texts:
        return None
    latest = texts[-1].replace("\n", " ").strip()
    return latest[:220]


def _change_risk_level(changes: list[dict]) -> str:
    if any(change.get("mode") in {"overwrite", "create"} for change in changes):
        return "medium"
    if len(changes) >= 4:
        return "medium"
    return "low"


def is_staged_write_marker(text: str) -> bool:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return False
    return payload.get("type") == STAGED_WRITE_MARKER


def parse_staged_write_marker(text: str) -> dict:
    payload = json.loads(text)
    if payload.get("type") != STAGED_WRITE_MARKER:
        raise ValueError("Not a staged write marker")
    return payload


def detect_approval_response(request_messages: list[dict] | None) -> tuple[str | None, bool | None]:
    if not request_messages:
        return None, None
    for item in request_messages:
        item_type = item.get("type")
        if item_type == "mcp_approval_response":
            request_id = item.get("id") or item.get("call_id")
            approved = item.get("approve")
            if isinstance(request_id, str) and isinstance(approved, bool):
                return request_id, approved
        if item_type == "function_call_output":
            request_id = item.get("call_id") or item.get("id")
            output = item.get("output")
            if isinstance(output, str):
                try:
                    parsed = json.loads(output)
                except json.JSONDecodeError:
                    continue
                approved = parsed.get("__approvalStatus__")
                if isinstance(request_id, str) and isinstance(approved, bool):
                    return request_id, approved
    return None, None


@dataclass(slots=True)
class FilesystemToolContext:
    request_messages: list[dict] | None = None


_CONTEXT = FilesystemToolContext()


def set_filesystem_tool_context(request_messages: list[dict] | None) -> None:
    _CONTEXT.request_messages = request_messages


def clear_filesystem_tool_context() -> None:
    _CONTEXT.request_messages = None


def _has_user_approval(operation_id: str) -> bool:
    approval_token = f"{APPROVAL_PREFIX}{operation_id}"
    return any(approval_token in text for text in _approval_texts(_CONTEXT.request_messages))


def _make_diff(old_text: str, new_text: str, path_label: str) -> str:
    diff = unified_diff(
        old_text.splitlines(),
        new_text.splitlines(),
        fromfile=f"{path_label} (current)",
        tofile=f"{path_label} (proposed)",
        lineterm="",
    )
    lines = list(diff)
    return "\n".join(lines[:400])


def _stage_operation(operation: dict) -> str:
    operation_id = f"write_{uuid.uuid4().hex[:12]}"
    staged = _load_staged_writes()
    staged[operation_id] = {
        **operation,
        "operation_id": operation_id,
        "created_at": utc_now(),
    }
    _save_staged_writes(staged)
    return operation_id


def _build_marker(operation_id: str, tool_name: str, summary: str, changes: list[dict]) -> str:
    rationale = _latest_user_request_summary()
    return json.dumps(
        {
            "type": STAGED_WRITE_MARKER,
            "request_id": operation_id,
            "tool_name": tool_name,
            "server_label": APPROVAL_SERVER_LABEL,
            "summary": summary,
            "rationale": rationale,
            "risk_level": _change_risk_level(changes),
            "workspace_root": str(workspace_root()),
            "changes": changes,
            "instruction": "Requires explicit user approval before applying these file changes.",
        },
        ensure_ascii=True,
    )


@tool
def list_files(path: str = ".", recursive: bool = False) -> str:
    """List files or directories within the configured workspace root."""
    base = _resolve_path(path)
    if not base.exists():
        return f"Path not found: {base}"
    entries: list[str] = []
    if base.is_file():
        return str(base)
    if recursive:
        for child in sorted(base.rglob("*")):
            entries.append(str(child.relative_to(workspace_root())))
    else:
        for child in sorted(base.iterdir()):
            entries.append(str(child.relative_to(workspace_root())))
    return "\n".join(entries[:500]) or "(empty directory)"


@tool
def workspace_overview(force_refresh: bool = False) -> str:
    """Return a cached structural overview of the workspace to help the agent understand the repo."""
    index = build_workspace_index(force_refresh=force_refresh)
    summary = {
        "root": index["root"],
        "generated_at": index["generated_at"],
        "file_count": index["file_count"],
        "extensions": index["extensions"],
        "top_level_dirs": index["top_level_dirs"],
        "important_files": index["important_files"][:20],
    }
    return json.dumps(summary, indent=2, ensure_ascii=True)


@tool
def find_files_by_name(query: str, limit: int = 20) -> str:
    """Find files by partial name/path using the cached workspace index."""
    index = build_workspace_index(force_refresh=False)
    needle = query.lower().strip()
    matches = [
        file_info["path"]
        for file_info in index["files"]
        if needle in file_info["path"].lower() or needle in file_info["name"].lower()
    ]
    return "\n".join(matches[:limit]) if matches else "No matching files found."


@tool
def search_files(query: str, path: str = ".", glob: str | None = None) -> str:
    """Search for text in files under the workspace root. Returns matching file paths and lines."""
    base = _resolve_path(path)
    normalized_glob = _normalize_glob(glob)
    if _is_overly_broad_glob(normalized_glob) and not _user_requested_repo_wide_search():
        return _search_scope_error(normalized_glob)
    rg = shutil.which("rg")
    if rg:
        cmd = [rg, "-n", "--hidden", "--glob", "!.git", query, str(base)]
        if normalized_glob:
            cmd.extend(["-g", normalized_glob])
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        output = result.stdout.strip()
        if not output:
            return "No matches found."
        lines = output.splitlines()[: max_search_results()]
        return "\n".join(lines)

    matches: list[str] = []
    for file_path in sorted(base.rglob("*")):
        if not file_path.is_file():
            continue
        if normalized_glob and not file_path.match(normalized_glob):
            continue
        try:
            text = _read_text(file_path)
        except Exception:
            continue
        for idx, line in enumerate(text.splitlines(), start=1):
            if query in line:
                rel = file_path.relative_to(workspace_root())
                matches.append(f"{rel}:{idx}:{line}")
                if len(matches) >= max_search_results():
                    return "\n".join(matches)
    return "\n".join(matches) if matches else "No matches found."


@tool
def read_file(path: str, start_line: int = 1, end_line: int = 200) -> str:
    """Read a text file within the workspace root."""
    target = _resolve_path(path)
    if not target.exists():
        return f"File not found: {target}"
    if target.is_dir():
        return f"Path is a directory, not a file: {target}"
    text = _read_text(target)
    lines = text.splitlines()
    start = max(start_line, 1)
    end = min(max(end_line, start), len(lines))
    snippet = lines[start - 1 : end]
    numbered = [f"{i}: {line}" for i, line in enumerate(snippet, start=start)]
    return "\n".join(numbered) or "(empty file)"


@tool
def stage_file_write(
    path: str,
    content: str,
    mode: Literal["create", "overwrite"] = "overwrite",
) -> str:
    """Stage a file create/overwrite operation. The user must explicitly approve it in chat before it can be applied."""
    if not writes_enabled():
        return "File writes are disabled by configuration."

    target = _resolve_path(path)
    exists = target.exists()
    if mode == "create" and exists:
        return f"Refusing to create {target}: file already exists."
    if mode == "overwrite" and not exists:
        return f"Refusing to overwrite {target}: file does not exist."
    if exists and target.is_dir():
        return f"Refusing to write {target}: path is a directory."

    current_text = _read_text(target) if exists else ""
    diff_text = _make_diff(current_text, content, str(target.relative_to(workspace_root())))
    preview = diff_text or "(new file contents stored; no textual diff available)"
    rel_path = str(target.relative_to(workspace_root()))
    operation_id = _stage_operation(
        {
            "kind": "change_set",
            "tool_name": "write_file",
            "summary": f"{mode} {rel_path}",
            "changes": [
                {
                    "path": rel_path,
                    "mode": mode,
                    "content": content,
                    "preview": preview,
                }
            ],
        }
    )
    return _build_marker(
        operation_id=operation_id,
        tool_name="write_file",
        summary=f"{mode} {rel_path}",
        changes=[
            {
                "path": rel_path,
                "mode": mode,
                "preview": preview,
            }
        ],
    )


@tool
def stage_patch_edit(
    path: str,
    search_text: str,
    replace_text: str,
    replace_all: bool = False,
) -> str:
    """Stage an exact-text patch edit for a file. Preferred over raw overwrite for code edits."""
    target = _resolve_path(path)
    if not target.exists() or target.is_dir():
        return f"File not found: {target}"
    current_text = _read_text(target)
    occurrences = current_text.count(search_text)
    if occurrences == 0:
        return f"Search text not found in {target}"
    if occurrences > 1 and not replace_all:
        return (
            f"Search text appears {occurrences} times in {target}. "
            "Set replace_all=true or provide more specific search text."
        )
    new_text = current_text.replace(search_text, replace_text) if replace_all else current_text.replace(search_text, replace_text, 1)
    preview = _make_diff(current_text, new_text, str(target.relative_to(workspace_root())))
    rel_path = str(target.relative_to(workspace_root()))
    operation_id = _stage_operation(
        {
            "kind": "change_set",
            "tool_name": "patch_edit",
            "summary": f"Patch edit {rel_path}",
            "changes": [
                {
                    "path": rel_path,
                    "mode": "patch",
                    "content": new_text,
                    "preview": preview,
                }
            ],
        }
    )
    return _build_marker(
        operation_id=operation_id,
        tool_name="patch_edit",
        summary=f"Patch edit {rel_path}",
        changes=[
            {
                "path": rel_path,
                "mode": "patch",
                "preview": preview,
            }
        ],
    )


def _prepare_change(change: dict) -> dict:
    change_type = change.get("type", "patch")
    path = str(change.get("path", "")).strip()
    if not path:
        raise ValueError("Each change must include a path")
    target = _resolve_path(path)
    rel_path = str(target.relative_to(workspace_root()))
    if change_type in {"create", "overwrite"}:
        content = str(change.get("content", ""))
        exists = target.exists()
        if change_type == "create" and exists:
            raise ValueError(f"Cannot create {rel_path}; file already exists")
        if change_type == "overwrite" and (not exists or target.is_dir()):
            raise ValueError(f"Cannot overwrite {rel_path}; file does not exist")
        current_text = _read_text(target) if exists and target.is_file() else ""
        preview = _make_diff(current_text, content, rel_path) or "(new file contents stored; no textual diff available)"
        return {"path": rel_path, "mode": change_type, "content": content, "preview": preview}
    if change_type == "patch":
        if not target.exists() or target.is_dir():
            raise ValueError(f"Cannot patch {rel_path}; file does not exist")
        current_text = _read_text(target)
        search_text = str(change.get("search_text", ""))
        replace_text = str(change.get("replace_text", ""))
        replace_all = bool(change.get("replace_all", False))
        occurrences = current_text.count(search_text)
        if occurrences == 0:
            raise ValueError(f"Search text not found in {rel_path}")
        if occurrences > 1 and not replace_all:
            raise ValueError(f"Search text appears {occurrences} times in {rel_path}; use replace_all or narrower text")
        new_text = current_text.replace(search_text, replace_text) if replace_all else current_text.replace(search_text, replace_text, 1)
        preview = _make_diff(current_text, new_text, rel_path)
        return {"path": rel_path, "mode": "patch", "content": new_text, "preview": preview}
    raise ValueError(f"Unsupported change type: {change_type}")


@tool
def stage_change_plan(changes_json: str, summary: str = "Grouped file changes") -> str:
    """Stage a grouped multi-file change plan for one approval action."""
    try:
        raw_changes = json.loads(changes_json)
    except json.JSONDecodeError as exc:
        return f"Invalid JSON: {exc}"
    if not isinstance(raw_changes, list) or not raw_changes:
        return "changes_json must be a non-empty JSON array."
    try:
        changes = [_prepare_change(change) for change in raw_changes if isinstance(change, dict)]
    except ValueError as exc:
        return str(exc)
    operation_id = _stage_operation(
        {
            "kind": "change_set",
            "tool_name": "change_plan",
            "summary": summary,
            "changes": changes,
        }
    )
    return _build_marker(
        operation_id=operation_id,
        tool_name="change_plan",
        summary=summary,
        changes=[{"path": change["path"], "mode": change["mode"], "preview": change["preview"]} for change in changes],
    )


@tool
def apply_staged_write(operation_id: str) -> str:
    """Apply a previously staged file write after the user explicitly approves it in chat."""
    if not writes_enabled():
        return "File writes are disabled by configuration."
    if not _has_user_approval(operation_id):
        return (
            f"Write {operation_id} is not approved yet. "
            f"Ask the user to reply with {APPROVAL_PREFIX}{operation_id}"
        )
    staged = _load_staged_writes()
    operation = staged.get(operation_id)
    if not operation:
        return f"No staged write found for {operation_id}"
    return apply_staged_write_by_approval_id(operation_id)


@tool
def show_staged_write(operation_id: str) -> str:
    """Show the currently staged write operation and its diff preview."""
    staged = _load_staged_writes()
    operation = staged.get(operation_id)
    if not operation:
        return f"No staged write found for {operation_id}"
    payload = {
        "operation_id": operation_id,
        "summary": operation.get("summary"),
        "tool_name": operation.get("tool_name"),
        "created_at": operation["created_at"],
        "approved": _has_user_approval(operation_id),
        "changes": [
            {
                "path": change["path"],
                "mode": change["mode"],
                "preview": change["preview"],
            }
            for change in operation.get("changes", [])
        ],
    }
    return json.dumps(payload, indent=2, ensure_ascii=True)


def apply_staged_write_by_approval_id(operation_id: str) -> str:
    staged = _load_staged_writes()
    operation = staged.get(operation_id)
    if not operation:
        raise ValueError(f"No staged write found for {operation_id}")
    applied_paths: list[str] = []
    for change in operation.get("changes", []):
        target = _resolve_path(change["path"])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(change["content"], encoding="utf-8")
        applied_paths.append(str(target.relative_to(workspace_root())))
    staged.pop(operation_id, None)
    _save_staged_writes(staged)
    return f"Allowed. Applied file changes to: {', '.join(applied_paths)}"


FILESYSTEM_TOOLS = [
    workspace_overview,
    find_files_by_name,
    list_files,
    search_files,
    read_file,
    stage_file_write,
    stage_patch_edit,
    stage_change_plan,
    apply_staged_write,
    show_staged_write,
]
