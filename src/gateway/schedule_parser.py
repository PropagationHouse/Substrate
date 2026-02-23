"""
Schedule Parser for CIRCUITS.md
================================

Parses natural-language schedules from CIRCUITS.md into structured jobs
with computed next-run times. Uses a schedule-aware timer approach:
each job has a next_run_at timestamp, and the scheduler sleeps until
the earliest one — zero polling, zero wasted model calls.

Supported schedule formats:
  - "Every morning at H:MM AM/PM"
  - "Every day at H:MM AM/PM"
  - "Every day at H:MM AM/PM, H:MM PM, and H:MM PM"
  - "Every N days at H:MM AM/PM"
  - "Every three days at H:MM AM/PM"
  - "Every N hours"
  - Cron expressions: "0 8 * * *: Daily at 8 AM"
  - Cron expressions: "*/30 * * * *: Every 30 minutes"
  - Cron expressions: "0 9 * * 1-5: Weekdays at 9 AM"
  - Random windows: "3 random between 8:00 AM and 10:00 PM: Post to X"
"""

import re
import random
import hashlib
import logging
import subprocess
import shutil
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Dict
from dataclasses import dataclass, field
from pathlib import Path

# Croner (JS) for cron expression parsing — called via Node subprocess.
# Preferred over croniter (Python, unmaintained) for active maintenance.
_CRON_HELPER = Path(__file__).parent / "cron_next.js"
_NODE_BIN = shutil.which("node")
HAS_CRONER = bool(_NODE_BIN and _CRON_HELPER.exists())

logger = logging.getLogger("gateway.schedule")


def _croner_next(expr: str) -> Optional[datetime]:
    """Compute next run time for a cron expression using croner (Node.js)."""
    if not HAS_CRONER:
        return None
    try:
        result = subprocess.run(
            [_NODE_BIN, str(_CRON_HELPER), expr],
            capture_output=True, text=True, timeout=5,
        )
        line = result.stdout.strip()
        if not line or line in ("INVALID", "NONE"):
            return None
        # croner returns UTC ISO 8601 — convert to local time
        utc_dt = datetime.fromisoformat(line.replace("Z", "+00:00"))
        return utc_dt.astimezone().replace(tzinfo=None)
    except Exception as e:
        logger.warning(f"croner subprocess failed for '{expr}': {e}")
        return None


def _croner_validate(expr: str) -> bool:
    """Check if a cron expression is valid using croner."""
    return _croner_next(expr) is not None

def _generate_random_times(count: int, start_hour: int, end_hour: int,
                           date, task_name: str) -> List[tuple]:
    """Generate N deterministic random (hour, minute) pairs within a time window.

    Seeded by date + task name so times are stable within a single day
    but different across days. This prevents the scheduler from picking
    new random times every time it re-parses CIRCUITS.md.
    """
    seed_str = f"{date.isoformat()}:{task_name}"
    seed = int(hashlib.md5(seed_str.encode()).hexdigest()[:8], 16)
    rng = random.Random(seed)

    # Total minutes in window
    if end_hour <= start_hour:
        end_hour += 24
    total_minutes = (end_hour - start_hour) * 60

    # Generate N random minute-offsets, sorted
    offsets = sorted(rng.sample(range(total_minutes), min(count, total_minutes)))

    times = []
    for offset in offsets:
        h = (start_hour + offset // 60) % 24
        m = offset % 60
        times.append((h, m))

    return times


# Word-to-number mapping for schedule parsing
_WORD_NUMBERS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20,
    "thirty": 30,
}


@dataclass
class CircuitsJob:
    """A single scheduled task parsed from CIRCUITS.md."""
    name: str                          # Short identifier (e.g. "RSS Intelligence Check")
    description: str                   # Full task description
    times: List[str]                   # ["08:00"] in 24h format
    interval_days: int = 1             # 1 = daily, 3 = every 3 days, etc.
    interval_hours: Optional[int] = None  # For "every N hours" schedules
    cron_expr: Optional[str] = None    # Cron expression (e.g. "0 8 * * *")
    random_count: Optional[int] = None # N times per day in random window
    random_window: Optional[tuple] = None  # (start_hour, end_hour) e.g. (8, 22)
    last_run_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = None
    enabled: bool = True

    def compute_next_run(self, now: Optional[datetime] = None) -> Optional[datetime]:
        """Compute the next run time based on schedule + last run."""
        now = now or datetime.now()

        # Random window — generate N random times per day within a window
        if self.random_count and self.random_window:
            start_h, end_h = self.random_window
            today_times = _generate_random_times(
                self.random_count, start_h, end_h, now.date(), self.name
            )
            # Find the next random time that hasn't passed
            candidates = []
            for h, m in today_times:
                t = now.replace(hour=h, minute=m, second=0, microsecond=0)
                if t > now:
                    # Skip if we already ran within 30 min of this slot
                    if self.last_run_at and abs((t - self.last_run_at).total_seconds()) < 1800:
                        continue
                    candidates.append(t)
            if not candidates:
                # All today's slots passed — generate tomorrow's
                tomorrow = now.date() + timedelta(days=1)
                tomorrow_times = _generate_random_times(
                    self.random_count, start_h, end_h, tomorrow, self.name
                )
                for h, m in tomorrow_times:
                    t = datetime.combine(tomorrow, datetime.min.time()).replace(
                        hour=h, minute=m
                    )
                    candidates.append(t)
            if candidates:
                self.next_run_at = min(candidates)
                return self.next_run_at
            return None

        # Cron expression — use croner (Node.js) for precise scheduling
        if self.cron_expr:
            next_dt = _croner_next(self.cron_expr)
            if next_dt:
                self.next_run_at = next_dt
                return self.next_run_at
            else:
                logger.warning(f"Could not compute next run for cron '{self.cron_expr}'")
                return None

        # "Every N hours" — simple interval from last run
        if self.interval_hours is not None:
            if self.last_run_at:
                candidate = self.last_run_at + timedelta(hours=self.interval_hours)
                if candidate > now:
                    self.next_run_at = candidate
                    return self.next_run_at
                # Overdue — run now (next poll)
                self.next_run_at = now
                return self.next_run_at
            else:
                # Never run — due now
                self.next_run_at = now
                return self.next_run_at

        # Time-of-day schedules
        if not self.times:
            return None

        candidates = []
        for time_str in self.times:
            hour, minute = map(int, time_str.split(":"))

            # Today at this time
            today_at = now.replace(hour=hour, minute=minute, second=0, microsecond=0)

            if self.interval_days == 1:
                # Daily: next occurrence is today if not passed, else tomorrow
                if today_at > now:
                    candidates.append(today_at)
                else:
                    candidates.append(today_at + timedelta(days=1))
            else:
                # Every N days: anchor from last_run_at
                if self.last_run_at:
                    # Next due = last_run date + interval_days, at scheduled time
                    next_date = self.last_run_at.date() + timedelta(days=self.interval_days)
                    candidate = datetime.combine(next_date, today_at.time())
                    if candidate > now:
                        candidates.append(candidate)
                    else:
                        # Overdue — due now
                        candidates.append(now)
                else:
                    # Never run — due now
                    candidates.append(now)

        if candidates:
            self.next_run_at = min(candidates)
            return self.next_run_at

        return None


def _parse_time_12h(match_str: str) -> Optional[str]:
    """Convert '8:00 AM' or '11:00 PM' to 24h 'HH:MM' string."""
    m = re.match(r'(\d{1,2}):(\d{2})\s*(AM|PM)', match_str.strip(), re.IGNORECASE)
    if not m:
        return None
    hour = int(m.group(1))
    minute = int(m.group(2))
    ampm = m.group(3).upper()
    if ampm == "PM" and hour != 12:
        hour += 12
    elif ampm == "AM" and hour == 12:
        hour = 0
    return f"{hour:02d}:{minute:02d}"


def _parse_number(text: str) -> Optional[int]:
    """Parse a number from text — supports digits and words."""
    text = text.strip().lower()
    if text.isdigit():
        return int(text)
    return _WORD_NUMBERS.get(text)


def _extract_task_name(description: str) -> str:
    """Extract a short task name from the description after the colon."""
    # Take first ~6 meaningful words after the colon
    words = description.split()[:6]
    name = " ".join(words)
    if len(name) > 50:
        name = name[:47] + "..."
    return name


def parse_schedule_line(line: str) -> Optional[CircuitsJob]:
    """Parse a single Active Tasks line into a CircuitsJob.

    Examples:
      "Every morning at 8:00 AM: Run RSS Intelligence Check..."
      "Every day at approximately 10:00 AM, 4:00 PM, and 11:00 PM: Post..."
      "Every three days at 9:00 AM: Remind user..."
      "Every 2 hours: Check something..."
    """
    line = line.strip()
    if line.startswith("- "):
        line = line[2:].strip()

    lower = line.lower()

    # --- Cron expression ---
    # Detect lines starting with a cron pattern: 5 or 6 space-separated fields
    # e.g. "0 8 * * *: Run RSS check" or "*/30 * * * *: Check something"
    cron_match = re.match(
        r'((?:[\d\*\/\-\,]+\s+){4}[\d\*\/\-\,A-Za-z]+)\s*[:\-]\s*(.*)',
        line
    )
    if cron_match and HAS_CRONER:
        expr = cron_match.group(1).strip()
        desc = cron_match.group(2).strip()
        if _croner_validate(expr):
            name = _extract_task_name(desc) if desc else f"Cron {expr}"
            return CircuitsJob(
                name=name,
                description=desc or line,
                times=[],
                cron_expr=expr,
            )

    # --- Random window ---
    # e.g. "3 random between 8:00 AM and 10:00 PM: Post to X"
    # e.g. "three times randomly between 9:00 AM and 9:00 PM: Do something"
    rand_match = re.match(
        r'(\d+|[a-z]+)\s+(?:random|times?\s+random(?:ly)?)\s+between\s+'
        r'(\d{1,2}:\d{2}\s*(?:AM|PM))\s+and\s+(\d{1,2}:\d{2}\s*(?:AM|PM))'
        r'\s*[:\-]\s*(.*)',
        line, re.IGNORECASE
    )
    if rand_match:
        n = _parse_number(rand_match.group(1))
        start_time = _parse_time_12h(rand_match.group(2))
        end_time = _parse_time_12h(rand_match.group(3))
        desc = rand_match.group(4).strip()
        if n and start_time and end_time:
            start_h = int(start_time.split(":")[0])
            end_h = int(end_time.split(":")[0])
            name = _extract_task_name(desc) if desc else f"{n}x random task"
            return CircuitsJob(
                name=name,
                description=desc or line,
                times=[],
                random_count=n,
                random_window=(start_h, end_h),
            )

    # --- "Every N hours" ---
    m = re.match(r'every\s+(\d+|[a-z]+)\s+hours?\s*[:\-]?\s*(.*)', line, re.IGNORECASE)
    if m:
        n = _parse_number(m.group(1))
        desc = m.group(2).strip()
        if n:
            name = _extract_task_name(desc) if desc else f"Every {n}h task"
            return CircuitsJob(
                name=name,
                description=desc or line,
                times=[],
                interval_hours=n,
            )

    # --- Extract all H:MM AM/PM times from the line ---
    time_matches = re.findall(r'(\d{1,2}:\d{2}\s*(?:AM|PM))', line, re.IGNORECASE)
    times_24h = []
    for tm in time_matches:
        converted = _parse_time_12h(tm)
        if converted:
            times_24h.append(converted)

    if not times_24h:
        return None

    # --- Determine interval ---
    interval_days = 1

    # "Every N days" or "Every three days"
    m = re.match(r'every\s+(\d+|[a-z]+)\s+days?\s', lower)
    if m:
        n = _parse_number(m.group(1))
        if n:
            interval_days = n

    # --- Extract description (after the colon) ---
    colon_idx = line.find(":")
    # Skip colons that are part of times (e.g. "8:00")
    while colon_idx != -1:
        # Check if this colon is part of a time pattern
        before = line[max(0, colon_idx-2):colon_idx]
        after = line[colon_idx+1:colon_idx+3] if colon_idx+3 <= len(line) else ""
        if before.strip().isdigit() and after.strip()[:2].isdigit():
            # This is a time colon, skip it
            colon_idx = line.find(":", colon_idx + 1)
        else:
            break

    if colon_idx != -1 and colon_idx < len(line) - 1:
        description = line[colon_idx + 1:].strip()
    else:
        description = line

    name = _extract_task_name(description)

    return CircuitsJob(
        name=name,
        description=description,
        times=times_24h,
        interval_days=interval_days,
    )


def parse_last_runs(content: str) -> Dict[str, datetime]:
    """Parse the '## Last Run' section into {label: datetime} dict."""
    last_runs: Dict[str, datetime] = {}
    in_section = False

    for line in content.split("\n"):
        stripped = line.strip()
        if stripped.startswith("## Last Run"):
            in_section = True
            continue
        if stripped.startswith("## ") and in_section:
            break
        if not in_section:
            continue
        if not stripped.startswith("- "):
            continue

        # Format: "- Label: YYYY-MM-DD HH:MM"
        m = re.match(r'-\s+(.+?):\s+(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2})', stripped)
        if m:
            label = m.group(1).strip()
            try:
                dt = datetime.strptime(m.group(2).strip(), "%Y-%m-%d %H:%M")
                last_runs[label] = dt
            except ValueError:
                pass

    return last_runs


def _match_job_to_last_run(job: CircuitsJob, last_runs: Dict[str, datetime]) -> Optional[datetime]:
    """Fuzzy-match a job to its last-run entry."""
    desc_lower = job.description.lower()
    name_lower = job.name.lower()
    # Combine all text for matching
    all_text = f"{name_lower} {desc_lower}"
    # Also stem common word forms for better matching
    all_words = set(all_text.split())

    # Try exact substring match first
    for label, dt in last_runs.items():
        label_lower = label.lower()
        if label_lower in all_text or all(w in all_text for w in label_lower.split()):
            return dt

    # Try keyword overlap — match if any label word (3+ chars) appears
    # in the description, or word stems overlap (e.g. "plant" in "plants")
    best_match = None
    best_score = 0
    for label, dt in last_runs.items():
        label_words = [w for w in label.lower().split() if len(w) >= 3]
        if not label_words:
            continue
        score = 0
        for lw in label_words:
            for aw in all_words:
                # Stem match: one contains the other (plant/plants, remind/reminder)
                if lw in aw or aw in lw:
                    score += 1
                    break
        if score > best_score:
            best_score = score
            best_match = dt

    # Require at least 1 word match
    if best_score >= 1:
        return best_match

    return None


def parse_circuits_file(file_path: Path) -> List[CircuitsJob]:
    """Parse CIRCUITS.md into a list of CircuitsJobs with computed next_run_at.

    Returns jobs sorted by next_run_at (earliest first).
    """
    if not file_path.exists():
        return []

    try:
        content = file_path.read_text(encoding="utf-8")
    except Exception as e:
        logger.error(f"Failed to read {file_path}: {e}")
        return []

    # Parse active tasks
    jobs: List[CircuitsJob] = []
    in_active = False
    for line in content.split("\n"):
        stripped = line.strip()
        if stripped.startswith("## Active Tasks"):
            in_active = True
            continue
        if stripped.startswith("## ") and in_active:
            break
        if in_active and stripped.startswith("- "):
            job = parse_schedule_line(stripped)
            if job:
                jobs.append(job)

    if not jobs:
        return []

    # Parse last-run times and match to jobs
    last_runs = parse_last_runs(content)
    for job in jobs:
        lr = _match_job_to_last_run(job, last_runs)
        if lr:
            job.last_run_at = lr

    # Compute next_run_at for each job
    now = datetime.now()
    for job in jobs:
        job.compute_next_run(now)

    # Sort by next_run_at (None last)
    jobs.sort(key=lambda j: j.next_run_at or datetime.max)

    logger.info(f"Parsed {len(jobs)} jobs from CIRCUITS.md")
    for job in jobs:
        delta = ""
        if job.next_run_at:
            secs = (job.next_run_at - now).total_seconds()
            if secs <= 0:
                delta = " (due NOW)"
            else:
                hours = secs / 3600
                if hours >= 1:
                    delta = f" (in {hours:.1f}h)"
                else:
                    delta = f" (in {secs/60:.0f}m)"
        logger.info(f"  [{job.name}] next={job.next_run_at}{delta}")

    return jobs


def next_wake_at(jobs: List[CircuitsJob]) -> Optional[datetime]:
    """Return the earliest next_run_at across all enabled jobs, or None."""
    enabled = [j for j in jobs if j.enabled and j.next_run_at is not None]
    if not enabled:
        return None
    return min(j.next_run_at for j in enabled)


def get_due_jobs(jobs: List[CircuitsJob], now: Optional[datetime] = None) -> List[CircuitsJob]:
    """Return jobs that are due (next_run_at <= now)."""
    now = now or datetime.now()
    return [j for j in jobs if j.enabled and j.next_run_at is not None and j.next_run_at <= now]
