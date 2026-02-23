#!/usr/bin/env python
"""
Substrate Gateway Launcher
======================

Quick launcher for the gateway service.

Usage:
    python gateway.py              # Start with tray icon
    pythonw gateway.py             # Start hidden (no console)
    python gateway.py --install    # Add to Windows startup
    python gateway.py --uninstall  # Remove from startup
    python gateway.py --once       # Run single circuits pass
"""

import sys
from pathlib import Path

# Add src to path
src_path = Path(__file__).parent / "src"
sys.path.insert(0, str(src_path))

from gateway.tray_service import main

if __name__ == "__main__":
    main()
