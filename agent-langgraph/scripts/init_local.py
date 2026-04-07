#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent_server.memory_store import get_memory_store
from agent_server.user_profile import (
    get_user_profile_store,
    project_profile_dir,
    user_profile_path,
)

ENV_EXAMPLE = ROOT / ".env.example"
ENV_FILE = ROOT / ".env"


def _read_env_values(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _write_default_env() -> None:
    ENV_FILE.write_text(ENV_EXAMPLE.read_text(), encoding="utf-8")


def main() -> None:
    created_env = False
    if not ENV_FILE.exists():
        _write_default_env()
        created_env = True

    env_values = _read_env_values(ENV_FILE)
    if env_values.get("MEMORY_DB_PATH"):
        os.environ["MEMORY_DB_PATH"] = str(env_values["MEMORY_DB_PATH"])

    db_path = Path(env_values.get("MEMORY_DB_PATH") or ".local/conversation_memory.db")
    if not db_path.is_absolute():
        db_path = ROOT / db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)

    get_memory_store()
    get_user_profile_store()

    print("Local initialization complete.")
    if created_env:
        print(f"Created {ENV_FILE}")
    else:
        print(f"Using existing {ENV_FILE}")
    print(f"Local memory DB ready at {db_path}")
    print(f"Persistent user profile ready at {user_profile_path()}")
    print(f"Project profiles directory ready at {project_profile_dir()}")
    print("Next steps:")
    print("  1. Fill in Databricks auth settings in .env")
    print("  2. Run: uv run start-app")


if __name__ == "__main__":
    main()
