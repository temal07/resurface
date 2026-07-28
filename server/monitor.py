"""
Live request monitor for the Resurface backend.

    export BACKEND_URL=... API_SECRET=...
    python3 monitor.py

Polls /monitor and redraws a scrolling request log with a load bar. Ctrl-C to
quit. Shows endpoint, status and duration only — no IPs, no URLs, nothing that
identifies what anyone was browsing.
"""

import os
import sys
import time
import json
import urllib.request

BACKEND_URL = os.environ.get("BACKEND_URL", "").rstrip("/")
API_SECRET = os.environ.get("API_SECRET", "")
POLL_S = 2
ROWS = 24

# Requests-per-minute at which the load bar reads full. Tune to taste.
LOAD_CEILING = 10

GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
DIM = "\033[2m"
RESET = "\033[0m"
CLEAR = "\033[2J\033[H"
HIDE_CURSOR = "\033[?25l"
SHOW_CURSOR = "\033[?25h"


def fetch() -> dict:
    req = urllib.request.Request(
        f"{BACKEND_URL}/monitor",
        headers={"x-api-key": API_SECRET},
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.load(res)


def load_bar(rpm: float, width: int = 58) -> str:
    frac = min(rpm / LOAD_CEILING, 1.0)
    filled = int(frac * width)
    colour = GREEN if frac < 0.5 else (YELLOW if frac < 0.8 else RED)
    return f"{colour}<{'=' * filled}{' ' * (width - filled)}>{RESET}"


def status_colour(status: int) -> str:
    if status < 300:
        return GREEN
    if status < 500:
        return YELLOW
    return RED


def render(data: dict) -> None:
    requests = data.get("requests", [])
    counts = data.get("counts", {})

    now = time.time()
    last_min = [r for r in requests if now - r["at"] < 60]
    rpm = len(last_min)

    out = [CLEAR]
    out.append(f"{len(requests)} recent requests · {sum(counts.values())} gemini calls since restart\n")
    out.append(f"\n    Load:  {load_bar(rpm)}   {rpm}/min\n\n")

    # Newest last, like a tail. Pad so the block doesn't jump around in height.
    window = requests[-ROWS:]
    for i, r in enumerate(window, start=1):
        age = now - r["at"]
        colour = status_colour(r["status"])
        out.append(
            f"{DIM}{i:02d}:{RESET} {colour}{r['path']:<20}{RESET}"
            f" {DIM}->{RESET} {r['status']:<4}"
            f" {r['ms']:>6}ms   {DIM}{age:>6.1f}s ago{RESET}\n"
        )
    for _ in range(ROWS - len(window)):
        out.append("\n")

    if counts:
        out.append(f"\n{DIM}{'  '.join(f'{k}={v}' for k, v in sorted(counts.items()))}{RESET}\n")

    sys.stdout.write("".join(out))
    sys.stdout.flush()


def main() -> None:
    if not BACKEND_URL or not API_SECRET:
        sys.exit("Set BACKEND_URL and API_SECRET first.")

    sys.stdout.write(HIDE_CURSOR)
    try:
        while True:
            try:
                render(fetch())
            except Exception as e:
                # Render cold starts take 30-50s; keep polling rather than dying.
                sys.stdout.write(f"{CLEAR}{RED}unreachable: {e}{RESET}\n")
                sys.stdout.flush()
            time.sleep(POLL_S)
    except KeyboardInterrupt:
        pass
    finally:
        sys.stdout.write(SHOW_CURSOR + "\n")


if __name__ == "__main__":
    main()