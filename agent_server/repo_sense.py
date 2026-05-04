from __future__ import annotations

import ast
import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Literal

from langchain_core.tools import tool

from agent_server.filesystem_tools import (
    PROJECT_ROOT,
    build_workspace_index,
    configured_workspace_root,
    max_read_lines,
    utc_now,
    workspace_root,
    workspace_selected,
    workspace_selection_error,
    _ordered_unique,
    _read_text,
    _resolve_path,
    _top_matches,
    _truncate_output,
)


PROJECT_MAP_STORE_PATH = PROJECT_ROOT / ".local" / "project_file_maps.json"
SYMBOL_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}
TEXT_SNIPPET_BYTES = 32000
MAX_SYMBOL_FILE_BYTES = 400000

PY_KIND_BY_NODE = {
    ast.FunctionDef: "function",
    ast.AsyncFunctionDef: "function",
    ast.ClassDef: "class",
}

JS_SYMBOL_PATTERNS = [
    (re.compile(r"\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b"), "function"),
    (re.compile(r"\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b"), "class"),
    (re.compile(r"\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b"), "interface"),
    (re.compile(r"\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\b"), "type"),
    (
        re.compile(
            r"\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>"
        ),
        "function",
    ),
    (
        re.compile(
            r"\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:memo|forwardRef|lazy|useCallback|useMemo)?\s*\("
        ),
        "value",
    ),
]

TASK_KIND_KEYWORDS: dict[str, tuple[str, ...]] = {
    "debug": (
        "error",
        "traceback",
        "exception",
        "failing",
        "failed",
        "bug",
        "broken",
        "regression",
        "cannot",
        "can't",
    ),
    "ml": (
        "model",
        "training",
        "train",
        "feature",
        "mlflow",
        "experiment",
        "evaluate",
        "metric",
        "serving",
        "inference",
        "scoring",
    ),
    "databricks": (
        "databricks",
        "bundle",
        "lakebase",
        "genie",
        "unity catalog",
        "uc ",
        "serving endpoint",
        "job",
        "workflow",
    ),
    "sql": (
        "sql",
        "query",
        "table",
        "join",
        "filter",
        "metric",
        "cohort",
        "gold",
        "silver",
        "bronze",
    ),
    "frontend": (
        "ui",
        "frontend",
        "react",
        "component",
        "button",
        "modal",
        "page",
        "layout",
    ),
    "test": ("test", "pytest", "playwright", "spec", "coverage", "lint", "build"),
}


TASK_RECIPES: dict[str, list[str]] = {
    "debug": [
        "Anchor on the concrete symptom and exact error text.",
        "Read the top stack-frame file, then its caller/import owner.",
        "Read the closest config/env path that can affect the failure.",
        "Read the related test or smoke path before proposing edits.",
    ],
    "ml": [
        "Read the training entrypoint, feature/data builder, evaluation path, and inference/serving contract.",
        "Check split logic, label timing, feature parity, MLflow logging, and schema assumptions.",
        "Prefer evidence from configs and tests before tuning model code.",
    ],
    "databricks": [
        "Read databricks.yml and any resource/job/bundle files before code changes.",
        "Check app env vars, permissions, serving endpoints, experiments, and Lakebase/SQL settings.",
        "Use Databricks validation or preflight once a safe runner is available.",
    ],
    "sql": [
        "Start with validated SQL and curated analytics context.",
        "Prefer known-good tables, joins, metrics, and exact filter mappings over guessing.",
        "Verify important SQL against stored joins and known table context before finalizing.",
    ],
    "frontend": [
        "Read the component, its hook/context, the route/server API it calls, and a nearby test.",
        "Check mobile/desktop layout constraints and existing component conventions.",
    ],
    "test": [
        "Read the failing test or likely test file first.",
        "Follow fixtures/helpers before changing application code.",
        "Prefer a focused verification command after the patch is approved.",
    ],
    "general": [
        "Read repo instructions, README/config, likely entrypoints, and related tests.",
        "Use symbol tools to jump from names to definitions before broad file reads.",
    ],
}


def _store_path() -> Path:
    PROJECT_MAP_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    return PROJECT_MAP_STORE_PATH


def _load_store() -> dict[str, Any]:
    path = _store_path()
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return value if isinstance(value, dict) else {}


def _save_store(store: dict[str, Any]) -> None:
    _store_path().write_text(
        json.dumps(store, indent=2, ensure_ascii=True, sort_keys=True),
        encoding="utf-8",
    )


def _root_key(root: Path) -> str:
    return hashlib.sha256(str(root.resolve()).encode("utf-8")).hexdigest()[:24]


def _latest_user_text(request_items: list[dict[str, Any]]) -> str:
    texts: list[str] = []
    for item in request_items:
        if item.get("role") != "user":
            continue
        content = item.get("content")
        if isinstance(content, str):
            texts.append(content)
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    texts.append(part["text"])
    return " ".join(texts).strip()


def classify_task(text: str) -> str:
    lowered = f" {text.lower()} "
    scores: dict[str, int] = {}
    for kind, keywords in TASK_KIND_KEYWORDS.items():
        scores[kind] = sum(1 for keyword in keywords if keyword in lowered)
    if not scores or max(scores.values()) == 0:
        return "general"
    return sorted(scores.items(), key=lambda item: (-item[1], item[0]))[0][0]


def _task_keywords(text: str, limit: int = 8) -> list[str]:
    words = re.findall(r"[A-Za-z_][A-Za-z0-9_./-]{2,}", text)
    stop = {
        "this",
        "that",
        "with",
        "from",
        "have",
        "make",
        "what",
        "where",
        "when",
        "code",
        "file",
        "files",
        "agent",
        "repo",
        "implement",
        "update",
    }
    output: list[str] = []
    seen: set[str] = set()
    for word in words:
        normalized = word.strip(".,:;()[]{}").lower()
        if normalized in stop or normalized in seen:
            continue
        seen.add(normalized)
        output.append(word)
        if len(output) >= limit:
            break
    return output


def _safe_read(path: Path, max_bytes: int = TEXT_SNIPPET_BYTES) -> str:
    try:
        if not path.is_file() or path.stat().st_size > max_bytes:
            return ""
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _line_snippet(path: Path, max_lines_count: int = 80) -> str:
    text = _safe_read(path)
    if not text:
        return ""
    lines = text.splitlines()[: max(1, min(max_lines_count, max_read_lines()))]
    return "\n".join(f"{index}: {line}" for index, line in enumerate(lines, start=1))


def _role_paths(paths: list[str]) -> dict[str, list[str]]:
    return {
        "docs": _top_matches(paths, ("readme", "docs", "guide", "quickstart"), limit=8),
        "repo_instructions": _top_matches(
            paths,
            ("AGENTS.md", "CLAUDE.md", ".coding-buddy", "INSTRUCTIONS.md"),
            limit=8,
        ),
        "config": _top_matches(
            paths,
            (
                "pyproject.toml",
                "package.json",
                "requirements",
                "tsconfig",
                "vite.config",
                "drizzle",
                ".env.example",
            ),
            limit=12,
        ),
        "databricks": _top_matches(
            paths,
            ("databricks.yml", "app.yaml", "bundle", "mlflow", "lakebase", "serving", "endpoint"),
            limit=12,
        ),
        "training": _top_matches(paths, ("train", "trainer", "fit", "feature", "dataset"), limit=10),
        "evaluation": _top_matches(paths, ("eval", "evaluate", "metric", "scorer", "benchmark"), limit=10),
        "inference": _top_matches(paths, ("predict", "score", "infer", "serve", "endpoint"), limit=10),
        "frontend": _top_matches(paths, ("client/src", "component", "page", "hook", ".tsx"), limit=12),
        "backend": _top_matches(paths, ("server/src", "agent_server", "route", "api", ".py"), limit=12),
        "tests": _top_matches(paths, ("test", "tests", "spec", "fixture", "playwright"), limit=14),
        "ci": _top_matches(paths, (".github/workflows", "ci", "deploy", "preflight"), limit=10),
    }


def _candidate_paths_for_task(
    task_kind: str,
    roles: dict[str, list[str]],
    text: str,
    root: Path,
    limit: int = 10,
) -> list[str]:
    ordered: list[str] = []
    exact_defaults = {
        "debug": ["AGENTS.md", "CLAUDE.md", "README.md", "pyproject.toml", "package.json"],
        "ml": [
            "AGENTS.md",
            "README.md",
            "pyproject.toml",
            "databricks.yml",
            "agent_server/evaluate_agent.py",
        ],
        "databricks": [
            "AGENTS.md",
            "README.md",
            "databricks.yml",
            "app.yaml",
            ".env.example",
            "scripts/quickstart.py",
            "scripts/preflight.py",
        ],
        "sql": ["AGENTS.md", "README.md", "databricks.yml", "agent_server/sql_memory_tools.py"],
        "frontend": [
            "AGENTS.md",
            "README.md",
            "e2e-chatbot-app-next/package.json",
            "e2e-chatbot-app-next/client/src/App.tsx",
        ],
        "test": ["AGENTS.md", "README.md", "pyproject.toml", "e2e-chatbot-app-next/package.json"],
        "general": ["AGENTS.md", "CLAUDE.md", "README.md", "pyproject.toml", "databricks.yml"],
    }.get(task_kind, [])
    for rel_path in exact_defaults:
        if (root / rel_path).exists():
            ordered.append(rel_path)
    role_order = {
        "debug": ["repo_instructions", "tests", "backend", "frontend", "config", "databricks"],
        "ml": ["repo_instructions", "training", "evaluation", "inference", "databricks", "tests", "config"],
        "databricks": ["repo_instructions", "databricks", "config", "backend", "tests"],
        "sql": ["repo_instructions", "databricks", "backend", "tests", "config"],
        "frontend": ["repo_instructions", "frontend", "backend", "tests", "config"],
        "test": ["repo_instructions", "tests", "config", "backend", "frontend"],
        "general": ["repo_instructions", "docs", "config", "backend", "frontend", "tests"],
    }.get(task_kind, ["repo_instructions", "docs", "config", "tests"])
    for role in role_order:
        ordered.extend(roles.get(role, []))

    rg = shutil.which("rg")
    keywords = _task_keywords(text, limit=5)
    if rg and keywords:
        for keyword in keywords:
            result = subprocess.run(
                [
                    rg,
                    "-l",
                    "-i",
                    "-m",
                    "1",
                    "--glob",
                    "!.git",
                    "--glob",
                    "!node_modules",
                    "--glob",
                    "!dist",
                    "--glob",
                    "!build",
                    keyword,
                    str(root),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode not in {0, 1}:
                continue
            for line in result.stdout.splitlines()[:4]:
                try:
                    ordered.append(str(Path(line).resolve().relative_to(root)))
                except ValueError:
                    continue

    return _ordered_unique(ordered, limit=limit)


def _py_symbols(path: Path, rel_path: str) -> list[dict[str, Any]]:
    text = _safe_read(path, max_bytes=MAX_SYMBOL_FILE_BYTES)
    if not text:
        return []
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return []
    symbols: list[dict[str, Any]] = []
    parents: list[str] = []

    class Visitor(ast.NodeVisitor):
        def _visit_symbol(self, node: ast.AST, name: str, kind: str) -> None:
            qualname = ".".join([*parents, name]) if parents else name
            symbols.append(
                {
                    "name": name,
                    "qualname": qualname,
                    "kind": kind,
                    "path": rel_path,
                    "line": getattr(node, "lineno", 1),
                    "end_line": getattr(node, "end_lineno", getattr(node, "lineno", 1)),
                }
            )
            if isinstance(node, ast.ClassDef):
                parents.append(name)
                self.generic_visit(node)
                parents.pop()
            else:
                self.generic_visit(node)

        def visit_FunctionDef(self, node: ast.FunctionDef) -> None:  # noqa: N802
            self._visit_symbol(node, node.name, "function")

        def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:  # noqa: N802
            self._visit_symbol(node, node.name, "function")

        def visit_ClassDef(self, node: ast.ClassDef) -> None:  # noqa: N802
            self._visit_symbol(node, node.name, "class")

    Visitor().visit(tree)
    return symbols


def _js_extent(lines: list[str], start_index: int) -> int:
    brace_balance = 0
    saw_brace = False
    for index in range(start_index, min(len(lines), start_index + 180)):
        line = re.sub(r"(['\"]).*?\1", "", lines[index])
        brace_balance += line.count("{")
        brace_balance -= line.count("}")
        if "{" in line:
            saw_brace = True
        if saw_brace and brace_balance <= 0 and index > start_index:
            return index + 1
        if not saw_brace and index > start_index and not lines[index].strip():
            return index + 1
    return min(len(lines), start_index + 80)


def _js_symbols(path: Path, rel_path: str) -> list[dict[str, Any]]:
    text = _safe_read(path, max_bytes=MAX_SYMBOL_FILE_BYTES)
    if not text:
        return []
    lines = text.splitlines()
    symbols: list[dict[str, Any]] = []
    for line_index, line in enumerate(lines):
        for pattern, kind in JS_SYMBOL_PATTERNS:
            match = pattern.search(line)
            if not match:
                continue
            name = match.group(1)
            symbols.append(
                {
                    "name": name,
                    "qualname": name,
                    "kind": kind,
                    "path": rel_path,
                    "line": line_index + 1,
                    "end_line": _js_extent(lines, line_index),
                }
            )
            break
    return symbols


def build_symbol_index(limit_files: int = 250) -> list[dict[str, Any]]:
    if not workspace_selected():
        return []
    root = workspace_root()
    index = build_workspace_index(force_refresh=False)
    files = [item["path"] for item in index["files"] if isinstance(item, dict)]
    preferred = _ordered_unique(
        _top_matches(files, ("agent_server", "server/src", "client/src", "src", "lib", "package"), limit=limit_files)
        + [path for path in files if Path(path).suffix.lower() in SYMBOL_EXTENSIONS],
        limit=limit_files,
    )
    symbols: list[dict[str, Any]] = []
    for rel_path in preferred:
        suffix = Path(rel_path).suffix.lower()
        if suffix not in SYMBOL_EXTENSIONS:
            continue
        path = root / rel_path
        if suffix == ".py":
            symbols.extend(_py_symbols(path, rel_path))
        else:
            symbols.extend(_js_symbols(path, rel_path))
    return symbols


def _auto_project_map(force_refresh: bool = False) -> dict[str, Any]:
    root = workspace_root()
    store = _load_store()
    key = _root_key(root)
    existing = store.get(key) if isinstance(store.get(key), dict) else {}
    if existing.get("auto") and not force_refresh:
        return existing

    index = build_workspace_index(force_refresh=force_refresh)
    paths = [item["path"] for item in index["files"] if isinstance(item, dict)]
    roles = _role_paths(paths)
    symbols = build_symbol_index(limit_files=220)
    auto = {
        "generated_at": utc_now(),
        "root": str(root),
        "file_count": index.get("file_count", 0),
        "top_level_dirs": index.get("top_level_dirs", {}),
        "roles": roles,
        "top_symbols": symbols[:120],
    }
    updated = {
        "root": str(root),
        "updated_at": utc_now(),
        "auto": auto,
        "notes": existing.get("notes", {}),
    }
    store[key] = updated
    _save_store(store)
    return updated


def _saved_project_notes(root: Path | None = None) -> dict[str, Any]:
    root = root or workspace_root()
    store = _load_store()
    entry = store.get(_root_key(root))
    if not isinstance(entry, dict):
        return {}
    notes = entry.get("notes")
    return notes if isinstance(notes, dict) else {}


def _context_pack_payload(request_items: list[dict[str, Any]]) -> dict[str, Any] | None:
    root = configured_workspace_root()
    if root is None:
        return None
    text = _latest_user_text(request_items)
    task_kind = classify_task(text)
    project_map = _auto_project_map(force_refresh=False)
    roles = project_map.get("auto", {}).get("roles", {})
    paths = _candidate_paths_for_task(task_kind, roles, text, root, limit=12)
    snippets: list[dict[str, str]] = []
    for rel_path in paths[:4]:
        snippet = _line_snippet(root / rel_path, max_lines_count=70)
        if snippet:
            snippets.append({"path": rel_path, "snippet": _truncate_output(snippet, 4500)})

    return {
        "task_kind": task_kind,
        "task_keywords": _task_keywords(text),
        "recipe": TASK_RECIPES.get(task_kind, TASK_RECIPES["general"]),
        "recommended_files": paths,
        "snippets": snippets,
        "saved_project_notes": _saved_project_notes(root),
        "project_map_updated_at": project_map.get("updated_at"),
    }


def build_context_pack_block(
    request_items: list[dict[str, Any]],
) -> tuple[str | None, dict[str, Any] | None]:
    payload = _context_pack_payload(request_items)
    if payload is None:
        return None, None
    lines = [
        "Automatic repo context pack",
        "",
        f"Task kind: {payload['task_kind']}",
        "Task recipe:",
        *[f"- {step}" for step in payload["recipe"]],
    ]
    if payload["recommended_files"]:
        lines.extend(
            [
                "",
                "Recommended read order:",
                *[f"- {path}" for path in payload["recommended_files"][:12]],
            ]
        )
    notes = payload.get("saved_project_notes") or {}
    if notes:
        note_lines = []
        for path, entries in list(notes.items())[:8]:
            if not isinstance(entries, list):
                continue
            for entry in entries[:2]:
                if not isinstance(entry, dict):
                    continue
                role = str(entry.get("role") or "note").strip()
                note = str(entry.get("notes") or "").strip()
                note_lines.append(f"- {path}: {role}" + (f" - {note}" if note else ""))
        if note_lines:
            lines.extend(["", "Saved project file map notes:", *note_lines[:12]])
    if payload["snippets"]:
        lines.append("")
        lines.append("Starter snippets:")
        for item in payload["snippets"]:
            lines.append(f"\nFile: {item['path']}\n{item['snippet']}")
    lines.extend(
        [
            "",
            "Use this context pack as the starting point. Expand with symbol tools or targeted file reads only when a concrete gap remains.",
        ]
    )
    metadata = {
        "taskKind": payload["task_kind"],
        "recommendedFiles": payload["recommended_files"][:8],
        "recipe": payload["recipe"],
        "message": f"Built {payload['task_kind']} repo focus from project map",
    }
    return "\n".join(lines), metadata


@tool
def project_map_overview(force_refresh: bool = False) -> str:
    """Return and persist a structured project file map: key file roles, likely entrypoints, tests, Databricks files, and symbols."""
    if not workspace_selected():
        return workspace_selection_error()
    payload = _auto_project_map(force_refresh=force_refresh)
    auto = payload.get("auto", {})
    response = {
        "root": payload.get("root"),
        "updated_at": payload.get("updated_at"),
        "file_count": auto.get("file_count"),
        "top_level_dirs": auto.get("top_level_dirs", {}),
        "roles": auto.get("roles", {}),
        "top_symbols": auto.get("top_symbols", [])[:40],
        "saved_notes": payload.get("notes", {}),
        "guidance": "Use register_project_file_role(path, role, notes) when the user confirms a durable project file role.",
    }
    return json.dumps(response, indent=2, ensure_ascii=True)


@tool
def register_project_file_role(
    path: str,
    role: str,
    notes: str = "",
    related_paths_csv: str = "",
) -> str:
    """Persist a durable project-map note for a file. Use only when the user explicitly confirms a stable file role or project convention."""
    if not workspace_selected():
        return workspace_selection_error()
    target = _resolve_path(path)
    root = workspace_root()
    rel_path = str(target.relative_to(root))
    store = _load_store()
    key = _root_key(root)
    entry = store.get(key) if isinstance(store.get(key), dict) else _auto_project_map(force_refresh=False)
    notes_by_path = entry.setdefault("notes", {})
    path_notes = notes_by_path.setdefault(rel_path, [])
    related_paths = [value.strip() for value in related_paths_csv.split(",") if value.strip()]
    record = {
        "role": role.strip() or "project file",
        "notes": notes.strip(),
        "related_paths": related_paths,
        "updated_at": utc_now(),
    }
    path_notes.append(record)
    entry["updated_at"] = utc_now()
    store[key] = entry
    _save_store(store)
    return json.dumps({"saved": {rel_path: record}}, indent=2, ensure_ascii=True)


@tool
def search_project_file_map(query: str, limit: int = 8) -> str:
    """Search the persisted project file map and auto-discovered roles/symbols for likely files."""
    if not workspace_selected():
        return workspace_selection_error()
    needle = query.strip().lower()
    if not needle:
        return "Provide a non-empty query."
    payload = _auto_project_map(force_refresh=False)
    roles = payload.get("auto", {}).get("roles", {})
    notes = payload.get("notes", {})
    symbols = payload.get("auto", {}).get("top_symbols", [])
    results: list[dict[str, Any]] = []
    for role, paths in roles.items():
        for rel_path in paths:
            haystack = f"{role} {rel_path}".lower()
            if needle in haystack:
                results.append({"kind": "role", "role": role, "path": rel_path})
    for rel_path, entries in notes.items():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            haystack = json.dumps(entry, ensure_ascii=True).lower() + " " + rel_path.lower()
            if needle in haystack:
                results.append({"kind": "saved_note", "path": rel_path, **entry})
    for symbol in symbols:
        if not isinstance(symbol, dict):
            continue
        haystack = f"{symbol.get('name')} {symbol.get('qualname')} {symbol.get('path')}".lower()
        if needle in haystack:
            results.append({"kind": "symbol", **symbol})
    return json.dumps(
        {"query": query, "results": results[: max(1, min(limit, 25))]},
        indent=2,
        ensure_ascii=True,
    )


@tool
def task_file_recipe(task: str) -> str:
    """Classify a task and return the recommended file-reading recipe plus likely starting files."""
    if not workspace_selected():
        return workspace_selection_error()
    task_kind = classify_task(task)
    project_map = _auto_project_map(force_refresh=False)
    root = workspace_root()
    paths = _candidate_paths_for_task(
        task_kind,
        project_map.get("auto", {}).get("roles", {}),
        task,
        root,
        limit=12,
    )
    return json.dumps(
        {
            "task_kind": task_kind,
            "recipe": TASK_RECIPES.get(task_kind, TASK_RECIPES["general"]),
            "recommended_files": paths,
        },
        indent=2,
        ensure_ascii=True,
    )


@tool
def find_symbol(name: str, kind: Literal["any", "function", "class", "interface", "type", "value"] = "any", limit: int = 20) -> str:
    """Find function/class/component/type symbols by name across Python and JS/TS files in the selected repo."""
    if not workspace_selected():
        return workspace_selection_error()
    needle = name.strip().lower()
    if not needle:
        return "Provide a non-empty symbol name."
    symbols = build_symbol_index()
    matches = []
    for symbol in symbols:
        symbol_kind = str(symbol.get("kind", ""))
        if kind != "any" and symbol_kind != kind:
            continue
        haystack = f"{symbol.get('name')} {symbol.get('qualname')}".lower()
        if needle in haystack:
            score = 0 if str(symbol.get("name", "")).lower() == needle else 1
            matches.append((score, symbol))
    matches.sort(key=lambda item: (item[0], item[1].get("path", ""), item[1].get("line", 0)))
    return json.dumps(
        {"query": name, "kind": kind, "results": [item for _, item in matches[: max(1, min(limit, 50))]]},
        indent=2,
        ensure_ascii=True,
    )


@tool
def read_symbol(path: str, symbol_name: str, context_lines: int = 4) -> str:
    """Read the code range for a symbol in a specific file, with a little surrounding context."""
    if not workspace_selected():
        return workspace_selection_error()
    target = _resolve_path(path)
    rel_path = str(target.relative_to(workspace_root()))
    wanted = symbol_name.strip().lower()
    if not wanted:
        return "Provide a non-empty symbol name."
    symbols = [
        symbol
        for symbol in build_symbol_index()
        if symbol.get("path") == rel_path
        and wanted in f"{symbol.get('name')} {symbol.get('qualname')}".lower()
    ]
    if not symbols:
        return f"No symbol named {symbol_name!r} found in {rel_path}."
    symbol = sorted(symbols, key=lambda item: item.get("line", 0))[0]
    text = _read_text(target)
    lines = text.splitlines()
    start = max(1, int(symbol.get("line", 1)) - max(0, context_lines))
    end = min(len(lines), int(symbol.get("end_line", symbol.get("line", 1))) + max(0, context_lines))
    numbered = "\n".join(f"{idx}: {lines[idx - 1]}" for idx in range(start, end + 1))
    return _truncate_output(
        json.dumps(
            {
                "symbol": symbol,
                "range": {"start_line": start, "end_line": end},
                "content": numbered,
            },
            indent=2,
            ensure_ascii=True,
        )
    )


@tool
def find_references(symbol: str, path: str = ".", limit: int = 30) -> str:
    """Find textual references to a symbol using a word-boundary search under the selected repo."""
    if not workspace_selected():
        return workspace_selection_error()
    needle = symbol.strip()
    if not needle:
        return "Provide a non-empty symbol."
    base = _resolve_path(path)
    rg = shutil.which("rg")
    pattern = rf"\b{re.escape(needle)}\b"
    if rg:
        result = subprocess.run(
            [rg, "-n", "--hidden", "--glob", "!.git", "--glob", "!node_modules", pattern, str(base)],
            capture_output=True,
            text=True,
            check=False,
        )
        if not result.stdout.strip():
            return "No references found."
        lines = result.stdout.splitlines()[: max(1, min(limit, 80))]
        return _truncate_output("\n".join(lines))
    matches: list[str] = []
    for file_path in sorted(base.rglob("*")):
        if not file_path.is_file():
            continue
        try:
            text = _read_text(file_path)
        except Exception:
            continue
        for line_no, line in enumerate(text.splitlines(), start=1):
            if re.search(pattern, line):
                matches.append(f"{file_path.relative_to(workspace_root())}:{line_no}:{line}")
                if len(matches) >= limit:
                    return _truncate_output("\n".join(matches))
    return _truncate_output("\n".join(matches)) if matches else "No references found."


@tool
def read_related_tests(path: str, limit: int = 8) -> str:
    """Find likely tests related to a source file and include compact snippets for the top few candidates."""
    if not workspace_selected():
        return workspace_selection_error()
    target = _resolve_path(path)
    rel_path = str(target.relative_to(workspace_root()))
    index = build_workspace_index(force_refresh=False)
    paths = [item["path"] for item in index["files"] if isinstance(item, dict)]
    stem = target.stem.lower()
    parent_names = {part.lower() for part in Path(rel_path).parts[:-1]}
    candidates: list[tuple[int, str]] = []
    for candidate in paths:
        lowered = candidate.lower()
        if "test" not in lowered and "spec" not in lowered:
            continue
        score = 0
        if stem and stem in lowered:
            score += 5
        score += sum(1 for part in parent_names if part and part in lowered)
        if target.suffix and candidate.endswith(target.suffix):
            score += 1
        if score:
            candidates.append((score, candidate))
    candidates.sort(key=lambda item: (-item[0], item[1]))
    selected = [candidate for _, candidate in candidates[: max(1, min(limit, 20))]]
    snippets = []
    for rel_candidate in selected[:3]:
        snippet = _line_snippet(workspace_root() / rel_candidate, max_lines_count=60)
        if snippet:
            snippets.append({"path": rel_candidate, "snippet": _truncate_output(snippet, 3000)})
    return json.dumps(
        {"source": rel_path, "related_tests": selected, "snippets": snippets},
        indent=2,
        ensure_ascii=True,
    )


def _imports_for_text(path: Path, text: str) -> list[str]:
    suffix = path.suffix.lower()
    imports: list[str] = []
    if suffix == ".py":
        try:
            tree = ast.parse(text)
        except SyntaxError:
            return []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                module = "." * node.level + (node.module or "")
                imports.append(module)
        return _ordered_unique(imports, limit=40)
    for raw_line in text.splitlines():
        line = raw_line.strip()
        match = re.search(r"\bfrom\s+['\"]([^'\"]+)['\"]", line)
        if match:
            imports.append(match.group(1))
            continue
        match = re.search(r"\bimport\s+.*?\s+from\s+['\"]([^'\"]+)['\"]", line)
        if match:
            imports.append(match.group(1))
            continue
        match = re.search(r"\brequire\(['\"]([^'\"]+)['\"]\)", line)
        if match:
            imports.append(match.group(1))
    return _ordered_unique(imports, limit=40)


@tool
def read_import_graph(path: str, direction: Literal["imports", "imported_by"] = "imports", limit: int = 20) -> str:
    """Read direct imports for a file, or find likely files that import it."""
    if not workspace_selected():
        return workspace_selection_error()
    target = _resolve_path(path)
    rel_path = str(target.relative_to(workspace_root()))
    text = _read_text(target)
    if direction == "imports":
        return json.dumps(
            {"path": rel_path, "imports": _imports_for_text(target, text)[: max(1, min(limit, 80))]},
            indent=2,
            ensure_ascii=True,
        )

    module_stem = target.stem
    candidates = {
        module_stem,
        rel_path.removesuffix(target.suffix).replace("/", "."),
        "./" + target.stem,
    }
    rg = shutil.which("rg")
    matches: list[str] = []
    if rg:
        for candidate in candidates:
            result = subprocess.run(
                [rg, "-n", "--hidden", "--glob", "!.git", "--glob", "!node_modules", re.escape(candidate), str(workspace_root())],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode not in {0, 1}:
                continue
            matches.extend(result.stdout.splitlines())
            if len(matches) >= limit:
                break
    return _truncate_output(
        json.dumps(
            {"path": rel_path, "imported_by_candidates": _ordered_unique(matches, limit=max(1, min(limit, 80)))},
            indent=2,
            ensure_ascii=True,
        )
    )


REPO_SENSE_TOOLS = [
    project_map_overview,
    search_project_file_map,
    register_project_file_role,
    task_file_recipe,
    find_symbol,
    read_symbol,
    find_references,
    read_related_tests,
    read_import_graph,
]
