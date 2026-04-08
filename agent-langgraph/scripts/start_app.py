#!/usr/bin/env python3
"""
Start script for running frontend and backend processes concurrently.

Requirements:
1. Not reporting ready until BOTH frontend and backend processes are ready
2. Exiting as soon as EITHER process fails
3. Printing error logs if either process fails

Usage:
    start-app [OPTIONS]

All options are passed through to the backend server (start-server).
See 'uv run start-server --help' for available options.
"""

import argparse
import os
import re
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

from dotenv import load_dotenv

# Readiness patterns
BACKEND_READY = [r"Uvicorn running on", r"Application startup complete", r"Started server process"]
UI_BACKEND_READY = [r"Backend service is running on", r"Server is running on http://localhost"]
UI_FRONTEND_READY = [r"Local:\s+http://localhost", r"localhost:\d+"]


def is_windows() -> bool:
    return os.name == "nt"


def npm_command() -> str:
    return "npm.cmd" if is_windows() else "npm"


def backend_command() -> list[str]:
    if is_windows():
        return ["uv.exe", "run", "start-server"]
    return ["uv", "run", "start-server"]


def check_port_available(port: int) -> bool:
    """Check if a port is available by attempting to bind to it."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("localhost", port))
        return True
    except OSError:
        return False


class ProcessManager:
    def __init__(self, port=8000, no_ui=False):
        self.repo_root = Path(__file__).resolve().parent.parent
        self.backend_process = None
        self.frontend_process = None
        self.backend_ready = False
        self.ui_backend_ready = False
        self.frontend_ready = False
        self.failed = threading.Event()
        self.backend_log = None
        self.frontend_log = None
        self.port = port
        self.no_ui = no_ui

    def check_ports(self):
        """Check that required ports are available before starting processes."""
        backend_port = self.port

        errors = []
        if not check_port_available(backend_port):
            errors.append(
                f"Port {backend_port} (backend) is already in use.\n"
                f"  To free it: lsof -ti :{backend_port} | xargs kill -9"
            )

        if not self.no_ui:
            ui_server_port = self.ui_server_port()
            ui_client_port = self.ui_client_port()

            seen_ports = {
                backend_port: "agent backend",
                ui_server_port: "UI backend",
                ui_client_port: "UI frontend",
            }
            if len(seen_ports) < 3:
                print("ERROR: backend/UI ports must all be different.")
                print(
                    f"  Current values: backend={backend_port}, ui backend={ui_server_port}, ui frontend={ui_client_port}"
                )
                print(
                    "  Set CHAT_APP_SERVER_PORT and CHAT_APP_CLIENT_PORT in e2e-chatbot-app-next/.env"
                )
                sys.exit(1)

            for port, label in [
                (ui_server_port, "UI backend"),
                (ui_client_port, "UI frontend"),
            ]:
                if not check_port_available(port):
                    errors.append(
                        f"Port {port} ({label}) is already in use.\n"
                        f"  Change it in e2e-chatbot-app-next/.env or stop the process using that port."
                    )

        if errors:
            print("ERROR: Port(s) already in use:\n")
            for error in errors:
                print(f"  {error}\n")
            sys.exit(1)

    def monitor_process(self, process, name, log_file, patterns):
        try:
            for line in iter(process.stdout.readline, ""):
                if not line:
                    break

                line = line.rstrip()
                log_file.write(line + "\n")
                print(f"[{name}] {line}")

                # Check readiness
                if name == "backend" and not self.backend_ready and any(
                    re.search(p, line, re.IGNORECASE) for p in patterns
                ):
                    if name == "backend":
                        self.backend_ready = True
                    print(f"✓ {name.capitalize()} is ready!")
                elif name == "frontend":
                    if not self.ui_backend_ready and any(
                        re.search(p, line, re.IGNORECASE) for p in UI_BACKEND_READY
                    ):
                        self.ui_backend_ready = True
                        print("✓ Ui-backend is ready!")
                    if not self.frontend_ready and any(
                        re.search(p, line, re.IGNORECASE) for p in UI_FRONTEND_READY
                    ):
                        self.frontend_ready = True
                        print("✓ Frontend is ready!")

                    if self.no_ui and self.backend_ready:
                        print("\n" + "=" * 50)
                        print("✓ Backend is ready! (running without UI)")
                        print(f"✓ API available at http://localhost:{self.port}")
                        print("=" * 50 + "\n")
                    elif self.backend_ready and self.ui_backend_ready and self.frontend_ready:
                        print("\n" + "=" * 50)
                        print("✓ Backend and UI are ready!")
                        frontend_port = self.ui_client_port()
                        print(f"✓ Open the frontend at http://localhost:{frontend_port}")
                        print("=" * 50 + "\n")

            process.wait()
            if process.returncode != 0:
                self.failed.set()

        except Exception as e:
            print(f"Error monitoring {name}: {e}")
            self.failed.set()

    def resolve_frontend_dir(self):
        frontend_dir = self.repo_root / "e2e-chatbot-app-next"
        if frontend_dir.exists():
            return frontend_dir

        print(f"ERROR: Frontend directory not found at {frontend_dir}")
        print("The UI is expected to live inside agent-langgraph/e2e-chatbot-app-next.")
        return None

    def ui_server_port(self) -> int:
        return int(os.environ.get("CHAT_APP_SERVER_PORT", "3001"))

    def ui_client_port(self) -> int:
        return int(
            os.environ.get(
                "CHAT_APP_CLIENT_PORT",
                os.environ.get("CHAT_APP_PORT", os.environ.get("PORT", "3002")),
            )
        )

    def start_process(self, cmd, name, log_file, patterns, cwd=None):
        print(f"Starting {name}...")
        process = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, cwd=cwd
        )

        thread = threading.Thread(
            target=self.monitor_process, args=(process, name, log_file, patterns), daemon=True
        )
        thread.start()
        return process

    def print_logs(self, log_path):
        print(f"\nLast 50 lines of {log_path}:")
        print("-" * 40)
        try:
            lines = Path(log_path).read_text().splitlines()
            print("\n".join(lines[-50:]))
        except FileNotFoundError:
            print(f"(no {log_path} found)")
        print("-" * 40)

    def cleanup(self):
        print("\n" + "=" * 42)
        print("Shutting down..." if self.no_ui else "Shutting down both processes...")
        print("=" * 42)

        for proc in [self.backend_process, self.frontend_process]:
            if proc:
                try:
                    proc.terminate()
                    proc.wait(timeout=5)
                except (subprocess.TimeoutExpired, Exception):
                    proc.kill()

        if self.backend_log:
            self.backend_log.close()
        if self.frontend_log:
            self.frontend_log.close()

    def run(self, backend_args=None):
        load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)
        if not os.environ.get("DATABRICKS_APP_NAME"):
            self.check_ports()

        frontend_dir = None
        if not self.no_ui:
            frontend_dir = self.resolve_frontend_dir()
            if frontend_dir is None:
                print("WARNING: Failed to locate frontend. Continuing with backend only.")
                self.no_ui = True
            else:
                ui_server_port = self.ui_server_port()
                ui_client_port = self.ui_client_port()
                os.environ["API_PROXY"] = f"http://localhost:{self.port}/invocations"
                os.environ.setdefault("LOCAL_AUTH_BYPASS", "true")
                os.environ["CHAT_APP_SERVER_PORT"] = str(ui_server_port)
                os.environ["CHAT_APP_CLIENT_PORT"] = str(ui_client_port)
                os.environ.setdefault(
                    "CHAT_APP_CORS_ORIGIN", f"http://localhost:{ui_client_port}"
                )

        # Open log files
        backend_log_path = self.repo_root / "backend.log"
        frontend_log_path = self.repo_root / "frontend.log"
        self.backend_log = open(backend_log_path, "w", buffering=1)
        if not self.no_ui:
            self.frontend_log = open(frontend_log_path, "w", buffering=1)

        try:
            # Build backend command, passing through all arguments
            backend_cmd = backend_command()
            if backend_args:
                backend_cmd.extend(backend_args)

            # Start backend
            self.backend_process = self.start_process(
                backend_cmd,
                "backend",
                self.backend_log,
                BACKEND_READY,
                cwd=self.repo_root,
            )

            if not self.no_ui:
                node_modules_dir = frontend_dir / "node_modules"
                if not node_modules_dir.exists():
                    print("Installing UI dependencies...")
                    result = subprocess.run(
                        [npm_command(), "install"],
                        cwd=frontend_dir,
                        capture_output=True,
                        text=True,
                    )
                    if result.returncode != 0:
                        print(f"npm install failed: {result.stderr}")
                        return 1

                self.frontend_process = self.start_process(
                    [npm_command(), "run", "dev"],
                    "frontend",
                    self.frontend_log,
                    [],
                    cwd=frontend_dir,
                )

                print(
                    f"\nMonitoring processes (Backend PID: {self.backend_process.pid}, Frontend PID: {self.frontend_process.pid})\n"
                )
            else:
                print(f"\nMonitoring backend process (PID: {self.backend_process.pid})\n")

            # Wait for failure
            while not self.failed.is_set():
                time.sleep(0.1)
                if self.backend_process.poll() is not None:
                    self.failed.set()
                    break
                if (
                    not self.no_ui
                    and self.frontend_process
                    and self.frontend_process.poll() is not None
                ):
                    self.failed.set()
                    break

            # Determine which failed
            if self.no_ui or self.backend_process.poll() is not None:
                failed_name = "backend"
                failed_proc = self.backend_process
            else:
                failed_name = "frontend"
                failed_proc = self.frontend_process
            exit_code = failed_proc.returncode if failed_proc else 1

            print(
                f"\n{'=' * 42}\nERROR: {failed_name} process exited with code {exit_code}\n{'=' * 42}"
            )
            self.print_logs(str(backend_log_path))
            if not self.no_ui:
                self.print_logs(str(frontend_log_path))
            return exit_code

        except KeyboardInterrupt:
            print("\nInterrupted")
            return 0

        except Exception as exc:
            print(f"\nLauncher error: {exc}")
            import traceback

            traceback.print_exc()
            return 1

        finally:
            self.cleanup()


def main():
    parser = argparse.ArgumentParser(
        description="Start agent frontend and backend",
        usage="%(prog)s [OPTIONS]\n\nAll options are passed through to start-server. "
        "Use 'uv run start-server --help' for available options.",
    )
    parser.add_argument(
        "--no-ui",
        action="store_true",
        help="Run backend only, skip frontend UI",
    )
    args, backend_args = parser.parse_known_args()

    # Extract port from backend_args if specified
    port = 8000
    for i, arg in enumerate(backend_args):
        if arg == "--port" and i + 1 < len(backend_args):
            try:
                port = int(backend_args[i + 1])
            except ValueError:
                pass
            break

    sys.exit(ProcessManager(port=port, no_ui=args.no_ui).run(backend_args))


if __name__ == "__main__":
    main()
