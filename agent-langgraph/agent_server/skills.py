from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SKILLS_ROOT = PROJECT_ROOT / "skills"


@dataclass(frozen=True, slots=True)
class RegisteredSkill:
    name: str
    description: str
    triggers: tuple[str, ...]
    skill_dir: Path
    instruction_path: Path

    def render_block(self) -> str:
        instructions = self.instruction_path.read_text(encoding="utf-8").strip()
        return (
            f"Activated skill: {self.name}\n\n"
            f"{instructions}\n\n"
            f"Skill directory: {self.skill_dir}"
        )


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
    return " ".join(texts).strip().lower()


def load_registered_skills() -> list[RegisteredSkill]:
    if not SKILLS_ROOT.exists():
        return []

    skills: list[RegisteredSkill] = []
    for skill_dir in sorted(SKILLS_ROOT.iterdir()):
        if not skill_dir.is_dir():
            continue
        metadata_path = skill_dir / "skill.json"
        instruction_path = skill_dir / "SKILL.md"
        if not metadata_path.exists() or not instruction_path.exists():
            continue
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        name = str(metadata.get("name", skill_dir.name)).strip()
        description = str(metadata.get("description", "")).strip()
        triggers = tuple(
            trigger.strip().lower()
            for trigger in metadata.get("triggers", [])
            if isinstance(trigger, str) and trigger.strip()
        )
        skills.append(
            RegisteredSkill(
                name=name,
                description=description,
                triggers=triggers,
                skill_dir=skill_dir,
                instruction_path=instruction_path,
            )
        )
    return skills


def select_relevant_skills(
    request_items: list[dict[str, Any]], max_skills: int = 3
) -> list[RegisteredSkill]:
    latest = _latest_user_text(request_items)
    if not latest:
        return []

    selected: list[RegisteredSkill] = []
    for skill in load_registered_skills():
        explicit_mentions = {
            skill.name.lower(),
            f"${skill.name.lower()}",
            skill.skill_dir.name.lower(),
            f"${skill.skill_dir.name.lower()}",
        }
        if any(token in latest for token in explicit_mentions):
            selected.append(skill)
            continue
        if skill.triggers and any(trigger in latest for trigger in skill.triggers):
            selected.append(skill)

    deduped: list[RegisteredSkill] = []
    seen: set[str] = set()
    for skill in selected:
        key = skill.name.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(skill)
        if len(deduped) >= max_skills:
            break
    return deduped


def build_skill_blocks(request_items: list[dict[str, Any]]) -> list[str]:
    return [skill.render_block() for skill in select_relevant_skills(request_items)]
