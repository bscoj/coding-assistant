from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

MAX_INSTRUCTION_FILES = 4
MAX_INSTRUCTION_LINES = 200
MAX_TOTAL_CHARS = 16_000
MAX_IMPORT_DEPTH = 3

INSTRUCTION_CANDIDATES = (
    "AGENTS.md",
    "CLAUDE.md",
    ".claude/CLAUDE.md",
    ".coding-buddy/INSTRUCTIONS.md",
)


def _resolve_import(base_file: Path, import_path: str, workspace_root: Path) -> Path | None:
    stripped = import_path.strip()
    if not stripped:
        return None
    candidate = Path(stripped)
    if not candidate.is_absolute():
        candidate = (base_file.parent / candidate).resolve()
    else:
        candidate = candidate.resolve()
    normalized_root = workspace_root.resolve()
    if candidate != normalized_root and normalized_root not in candidate.parents:
        return None
    return candidate


def _trimmed_block(path: Path, raw_text: str) -> str | None:
    text = raw_text.strip()
    if not text:
        return None
    lines = text.splitlines()
    truncated = len(lines) > MAX_INSTRUCTION_LINES
    excerpt = "\n".join(lines[:MAX_INSTRUCTION_LINES]).strip()
    if not excerpt:
        return None
    if truncated:
        excerpt += (
            f"\n\n[Truncated after {MAX_INSTRUCTION_LINES} lines. "
            "Keep this file concise and move deep reference material into linked docs.]"
        )
    return f"Repo instructions from {path.name}\n\n{excerpt}"


def _collect_blocks(
    path: Path,
    workspace_root: Path,
    *,
    depth: int,
    visited: set[Path],
) -> list[str]:
    if depth > MAX_IMPORT_DEPTH:
        return []
    resolved = path.resolve()
    if resolved in visited or not resolved.exists() or not resolved.is_file():
        return []
    visited.add(resolved)

    try:
        text = resolved.read_text(encoding="utf-8")
    except Exception:
        logger.exception("Failed to read repo instruction file %s", resolved)
        return []

    content_lines: list[str] = []
    imported_paths: list[Path] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("@") and len(stripped) > 1:
            imported = _resolve_import(resolved, stripped[1:], workspace_root)
            if imported is not None:
                imported_paths.append(imported)
                continue
        content_lines.append(line)

    blocks: list[str] = []
    block = _trimmed_block(resolved, "\n".join(content_lines))
    if block:
        blocks.append(block)
    for imported in imported_paths:
        blocks.extend(
            _collect_blocks(imported, workspace_root, depth=depth + 1, visited=visited)
        )
    return blocks


def build_repo_instruction_blocks(workspace_root: str | Path | None) -> list[str]:
    if not workspace_root:
        return []
    root = Path(workspace_root).resolve()
    if not root.exists() or not root.is_dir():
        return []

    visited: set[Path] = set()
    blocks: list[str] = []
    total_chars = 0

    for relative_path in INSTRUCTION_CANDIDATES:
        if len(blocks) >= MAX_INSTRUCTION_FILES or total_chars >= MAX_TOTAL_CHARS:
            break
        candidate = root / relative_path
        for block in _collect_blocks(candidate, root, depth=0, visited=visited):
            remaining = MAX_TOTAL_CHARS - total_chars
            if remaining <= 0 or len(blocks) >= MAX_INSTRUCTION_FILES:
                break
            final_block = block if len(block) <= remaining else block[:remaining].rstrip()
            if not final_block:
                continue
            blocks.append(final_block)
            total_chars += len(final_block)

    return blocks
