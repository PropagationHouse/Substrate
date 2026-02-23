import psutil
import os

def get_resources():
    print(f"System Load: {os.cpu_count()} cores detected.")
    
    # CPU
    procs = []
    for p in psutil.process_iter(['pid', 'name', 'cpu_percent']):
        try:
            procs.append(p.info)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    
    # Need to call cpu_percent twice to get an actual reading
    import time
    psutil.cpu_percent(interval=None)
    time.sleep(0.5)
    
    procs = sorted(psutil.process_iter(['pid', 'name', 'cpu_percent']), key=lambda p: p.info['cpu_percent'] or 0, reverse=True)
    
    print("\n--- Top CPU Usage ---")
    for p in procs[:10]:
        print(f"{p.info['name']} (PID {p.info['pid']}): {p.info['cpu_percent']}%")

    # Memory
    mem_procs = sorted(psutil.process_iter(['pid', 'name', 'memory_info']), key=lambda p: p.info['memory_info'].rss if p.info['memory_info'] else 0, reverse=True)
    
    print("\n--- Top Memory Usage ---")
    for p in mem_procs[:10]:
        rss = p.info['memory_info'].rss / (1024 * 1024)
        print(f"{p.info['name']} (PID {p.info['pid']}): {rss:.2f} MB")

if __name__ == '__main__':
    get_resources()
