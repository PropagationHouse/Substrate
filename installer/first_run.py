"""
Substrate First-Run Setup
Checks prerequisites and installs Python dependencies on first launch.
Called by main.js before spawning the backend.
"""
import subprocess
import sys
import os
import shutil
import json

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# When running from installed app, we're in the app root
APP_DIR = SCRIPT_DIR if os.path.exists(os.path.join(SCRIPT_DIR, 'requirements.txt')) else os.path.dirname(SCRIPT_DIR)
REQUIREMENTS = os.path.join(APP_DIR, 'requirements.txt')
MARKER = os.path.join(APP_DIR, '.deps_installed')
PACKAGE_JSON = os.path.join(APP_DIR, 'package.json')


def _get_app_version():
    """Read current version from package.json."""
    try:
        with open(PACKAGE_JSON, 'r', encoding='utf-8') as f:
            return json.load(f).get('version', '0.0.0')
    except Exception:
        return '0.0.0'


def _get_installed_version():
    """Read installed version from marker file."""
    try:
        with open(MARKER, 'r', encoding='utf-8') as f:
            content = f.read().strip()
            # Old markers just had 'ok', new ones have version string
            if content == 'ok' or not content:
                return '0.0.0'
            return content
    except Exception:
        return None  # Not installed


def check_python():
    """Check if Python 3.10+ is available."""
    try:
        result = subprocess.run(
            [sys.executable, '--version'],
            capture_output=True, text=True, timeout=10
        )
        version_str = result.stdout.strip().split()[-1]
        major, minor = int(version_str.split('.')[0]), int(version_str.split('.')[1])
        if major >= 3 and minor >= 10:
            return {"ok": True, "version": version_str, "path": sys.executable}
        return {"ok": False, "error": f"Python {version_str} found but 3.10+ required"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def check_ollama():
    """Check if Ollama is installed and reachable."""
    ollama_path = shutil.which('ollama')
    if not ollama_path:
        return {"ok": False, "error": "Ollama not found in PATH"}
    try:
        result = subprocess.run(
            ['ollama', 'list'],
            capture_output=True, text=True, timeout=15
        )
        models = [l.split()[0] for l in result.stdout.strip().split('\n')[1:] if l.strip()]
        return {"ok": True, "path": ollama_path, "models": models}
    except Exception as e:
        return {"ok": False, "error": str(e), "path": ollama_path}


def check_deps_installed():
    """Check if pip dependencies have been installed and are up to date."""
    if not os.path.exists(MARKER):
        return False
    # Check if version matches — if not, deps need updating
    installed = _get_installed_version()
    current = _get_app_version()
    if installed and installed != current:
        return False  # Version mismatch, needs update
    return True


def needs_update():
    """Check if an update is needed (installed but version mismatch)."""
    if not os.path.exists(MARKER):
        return False  # Not installed at all, needs fresh install
    installed = _get_installed_version()
    current = _get_app_version()
    return installed is not None and installed != current


def install_deps():
    """Install Python dependencies from requirements.txt."""
    if not os.path.exists(REQUIREMENTS):
        return {"ok": False, "error": f"requirements.txt not found at {REQUIREMENTS}"}
    try:
        result = subprocess.run(
            [sys.executable, '-m', 'pip', 'install', '-r', REQUIREMENTS],
            capture_output=True, text=True, timeout=600
        )
        if result.returncode == 0:
            # Write marker with version
            version = _get_app_version()
            with open(MARKER, 'w') as f:
                f.write(version)
            return {"ok": True, "version": version,
                    "output": result.stdout[-500:] if len(result.stdout) > 500 else result.stdout}
        return {"ok": False, "error": result.stderr[-500:] if len(result.stderr) > 500 else result.stderr}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Installation timed out (10 min). Check your internet connection."}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def create_dirs():
    """Create necessary directories if they don't exist."""
    dirs = [
        'profiles', 'knowledge', 'workspace', 'data', 'logs',
        'uploads', 'screenshots', 'config', 'skills', 'certs',
        # v1.2.0: skill learning & event system
        os.path.join('workspace', 'recordings'),
        os.path.join('workspace', 'emergent'),
        os.path.join('workspace', 'output'),
        os.path.join('workspace', 'temp'),
        os.path.join('data', 'events'),
        os.path.join('data', 'sounds'),
    ]
    created = []
    for d in dirs:
        full_path = os.path.join(APP_DIR, d)
        if not os.path.exists(full_path):
            os.makedirs(full_path, exist_ok=True)
            created.append(d)
    return created


def run_all_checks():
    """Run all prerequisite checks and return combined status."""
    results = {
        "python": check_python(),
        "ollama": check_ollama(),
        "deps_installed": check_deps_installed(),
        "needs_update": needs_update(),
        "dirs_created": create_dirs(),
        "app_version": _get_app_version(),
        "installed_version": _get_installed_version(),
    }
    results["ready"] = (
        results["python"]["ok"] and
        results["deps_installed"]
    )
    return results


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Substrate First-Run Setup')
    parser.add_argument('--check', action='store_true', help='Check prerequisites only')
    parser.add_argument('--install', action='store_true', help='Install pip dependencies')
    parser.add_argument('--json', action='store_true', help='Output as JSON')
    args = parser.parse_args()

    if args.install:
        result = install_deps()
        if args.json:
            print(json.dumps(result))
        else:
            if result["ok"]:
                print("Dependencies installed successfully!")
            else:
                print(f"Error: {result['error']}")
                sys.exit(1)
    elif args.check:
        results = run_all_checks()
        if args.json:
            print(json.dumps(results))
        else:
            print(f"Python: {'OK' if results['python']['ok'] else results['python']['error']}")
            print(f"Ollama: {'OK' if results['ollama']['ok'] else results['ollama']['error']}")
            print(f"Deps:   {'Installed' if results['deps_installed'] else 'Not installed'}")
            if results['dirs_created']:
                print(f"Created dirs: {', '.join(results['dirs_created'])}")
    else:
        # Default: check and install if needed
        results = run_all_checks()
        if not results["python"]["ok"]:
            print(f"ERROR: {results['python']['error']}")
            print("Please install Python 3.10+ from https://python.org")
            sys.exit(1)
        if not results["deps_installed"]:
            if results["needs_update"]:
                print(f"Updating from v{results['installed_version']} to v{results['app_version']}...")
            else:
                print("Installing dependencies (this may take a few minutes)...")
            install_result = install_deps()
            if not install_result["ok"]:
                print(f"ERROR: {install_result['error']}")
                sys.exit(1)
            print(f"Dependencies installed (v{results['app_version']})!")
        if not results["ollama"]["ok"]:
            print("WARNING: Ollama not found. Install from https://ollama.com for local LLM support.")
        print(f"Substrate v{results['app_version']} is ready!")
