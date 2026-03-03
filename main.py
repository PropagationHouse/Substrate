from src.commands.command_parser import CommandParser
from src.commands.command_executor import CommandExecutor
import sys
import os
import traceback
import subprocess
import signal

def _kill_stale_proxies():
    """Kill any leftover proxy_server.py processes and port 8765 holders from previous sessions."""
    if sys.platform != 'win32':
        return
    my_pid = os.getpid()
    killed = set()

    # 1) Kill any python process whose command line contains proxy_server.py
    try:
        out = subprocess.check_output(
            'wmic process where "CommandLine like \'%%proxy_server.py%%\'" get ProcessId /format:list',
            shell=True, text=True, stderr=subprocess.DEVNULL)
        for line in out.strip().split('\n'):
            line = line.strip()
            if line.startswith('ProcessId='):
                try:
                    pid = int(line.split('=')[1])
                    if pid != my_pid and pid not in killed:
                        subprocess.call(f'taskkill /PID {pid} /T /F', shell=True,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        killed.add(pid)
                        print(f"[STARTUP] Killed stale proxy_server process (PID {pid})")
                except (ValueError, Exception):
                    pass
    except Exception:
        pass

    # 2) Kill anything holding port 8765 or 8766
    for port in (8765, 8766):
        try:
            out = subprocess.check_output(
                f'netstat -ano | findstr "LISTENING" | findstr ":{port}"',
                shell=True, text=True, stderr=subprocess.DEVNULL)
            for line in out.strip().split('\n'):
                parts = line.split()
                if parts:
                    try:
                        pid = int(parts[-1])
                        if pid != my_pid and pid not in killed:
                            subprocess.call(f'taskkill /PID {pid} /T /F', shell=True,
                                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                            killed.add(pid)
                            print(f"[STARTUP] Killed stale process on port {port} (PID {pid})")
                    except (ValueError, Exception):
                        pass
        except Exception:
            pass

    if killed:
        import time
        time.sleep(1)  # Give OS time to release ports
        print(f"[STARTUP] Cleaned up {len(killed)} stale process(es)")

try:
    # Main application code
    if __name__ == "__main__":
        try:
            print("Starting Substrate application...")
            
            # Kill any stale proxy_server processes from previous sessions
            _kill_stale_proxies()
            
            # Start the proxy server (use venv python to avoid system python duplicate)
            venv_python = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'venv', 'Scripts', 'python.exe')
            python_cmd = venv_python if os.path.exists(venv_python) else sys.executable
            proxy_server = subprocess.Popen(
                [python_cmd, "proxy_server.py"], 
                stdout=subprocess.PIPE, 
                stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
            )
            print(f"Proxy server started (PID {proxy_server.pid})")
            
            # Start the Electron app
            electron_app = subprocess.Popen(
                ["npx", "electron", "."], 
                stdout=subprocess.PIPE, 
                stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
            )
            print("Electron app started")
            
            # Register signal handlers for graceful shutdown
            def signal_handler(sig, frame):
                print("\nReceived signal to terminate. Shutting down gracefully...")
                try:
                    if 'proxy_server' in locals() and proxy_server:
                        proxy_server.terminate()
                    if 'electron_app' in locals() and electron_app:
                        electron_app.terminate()
                except Exception as e:
                    print(f"Error during shutdown: {e}")
                finally:
                    print("Application terminated.")
                    sys.exit(0)
            
            # Register signal handlers
            signal.signal(signal.SIGINT, signal_handler)
            signal.signal(signal.SIGTERM, signal_handler)
            
            print("Application running. Press Ctrl+C to exit.")
            
            # Wait for the processes to complete
            proxy_server.wait()
            electron_app.wait()
            
        except KeyboardInterrupt:
            print("\nKeyboard interrupt received. Shutting down gracefully...")
            try:
                if 'proxy_server' in locals() and proxy_server:
                    proxy_server.terminate()
                if 'electron_app' in locals() and electron_app:
                    electron_app.terminate()
            except Exception as e:
                print(f"Error during shutdown after keyboard interrupt: {e}")
            finally:
                print("Application terminated after keyboard interrupt.")
                sys.exit(0)
        except Exception as e:
            print(f"Error in main application: {e}")
            traceback.print_exc()
            
            # Try to terminate child processes
            try:
                if 'proxy_server' in locals() and proxy_server:
                    proxy_server.terminate()
                if 'electron_app' in locals() and electron_app:
                    electron_app.terminate()
            except Exception as cleanup_error:
                print(f"Error during cleanup: {cleanup_error}")
            
            # Keep the console open so the user can see the error
            input("Press Enter to exit...")
            sys.exit(1)
except Exception as outer_e:
    print(f"Critical error: {outer_e}")
    traceback.print_exc()
    input("Press Enter to exit...")
    sys.exit(1)
