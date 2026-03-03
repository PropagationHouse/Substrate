import threading
import time
import datetime
import json
import os
from pathlib import Path

class ClockService:
    def __init__(self):
        self.tasks = {}  # {task_id: {type: 'alarm|reminder', time: datetime, message: str}}
        self.running = True
        self.data_dir = os.path.join(os.path.dirname(__file__), 'data')
        self.tasks_file = os.path.join(self.data_dir, 'tasks.json')
        
        # Ensure data directory exists
        Path(self.data_dir).mkdir(parents=True, exist_ok=True)
        
        # Load saved tasks
        self.load_tasks()
        
        # Start background thread
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def load_tasks(self):
        """Load tasks from file"""
        if os.path.exists(self.tasks_file):
            try:
                with open(self.tasks_file, 'r') as f:
                    saved_tasks = json.load(f)
                    for task_id, task in saved_tasks.items():
                        # Convert ISO time string back to datetime
                        task['time'] = datetime.datetime.fromisoformat(task['time'])
                        # Only keep future tasks
                        if task['time'] > datetime.datetime.now():
                            self.tasks[task_id] = task
            except Exception as e:
                print(f"Error loading tasks: {e}")

    def save_tasks(self):
        """Save tasks to file"""
        try:
            # Convert datetime to ISO format for JSON serialization
            save_data = {}
            for task_id, task in self.tasks.items():
                save_data[task_id] = task.copy()
                save_data[task_id]['time'] = task['time'].isoformat()
            
            with open(self.tasks_file, 'w') as f:
                json.dump(save_data, f, indent=2)
        except Exception as e:
            print(f"Error saving tasks: {e}")

    def add_task(self, task_type, time_str, message=None):
        """Add a new task (alarm or reminder)"""
        try:
            # Parse the time string
            task_time = self._parse_time(time_str)
            
            # Create task ID
            task_id = str(int(time.time()))
            
            # Format message with 12-hour time
            if not message:
                message = f"{task_type.capitalize()} at {task_time.strftime('%I:%M %p')}"
            
            # Store task
            self.tasks[task_id] = {
                'type': task_type,
                'time': task_time,
                'message': message
            }
            
            # Save to file
            self.save_tasks()
            
            return {
                'status': 'success',
                'task_id': task_id,
                'time': task_time.strftime('%I:%M %p'),
                'message': self.tasks[task_id]['message']
            }
            
        except Exception as e:
            return {
                'status': 'error',
                'message': str(e)
            }

    def list_tasks(self):
        """List all pending tasks"""
        now = datetime.datetime.now()
        tasks = []
        for task_id, task in self.tasks.items():
            if task['time'] > now:  # Only include future tasks
                remaining = task['time'] - now
                remaining_str = str(remaining).split('.')[0]  # Remove microseconds
                tasks.append(
                    f"{task['message']} (in {remaining_str})"
                )
        return tasks

    def remove_task(self, task_id):
        """Remove a task by ID"""
        if task_id in self.tasks:
            del self.tasks[task_id]
            self.save_tasks()
            return True
        return False

    def _parse_time(self, time_str):
        """Parse time string into datetime"""
        now = datetime.datetime.now()
        time_str = time_str.lower().strip()
        
        try:
            # Handle relative times
            if 'in' in time_str:
                parts = time_str.split()
                try:
                    amount = int(parts[1])
                    unit = parts[2]
                    if unit.startswith('minute'):
                        delta = datetime.timedelta(minutes=amount)
                    elif unit.startswith('hour'):
                        delta = datetime.timedelta(hours=amount)
                    else:
                        raise ValueError(f"Unsupported time unit: {unit}")
                    return now + delta
                except:
                    raise ValueError("Invalid relative time format")
            
            # Handle absolute times
            time_str = time_str.replace(' ', '')
            
            # 12-hour format
            if 'pm' in time_str or 'am' in time_str:
                is_pm = 'pm' in time_str
                time_str = time_str.replace('pm', '').replace('am', '')
                
                if ':' in time_str:
                    hour, minute = map(int, time_str.split(':'))
                else:
                    hour = int(time_str)
                    minute = 0
                    
                if is_pm and hour != 12:
                    hour += 12
                elif not is_pm and hour == 12:
                    hour = 0
                    
            # 24-hour format
            else:
                if ':' in time_str:
                    hour, minute = map(int, time_str.split(':'))
                else:
                    hour = int(time_str)
                    minute = 0
            
            # Create datetime for today
            task_time = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            
            # If time has passed, set for tomorrow
            if task_time <= now:
                task_time += datetime.timedelta(days=1)
            
            return task_time
            
        except Exception as e:
            raise ValueError(f"Invalid time format. Use '5pm', '17:00', or 'in 5 minutes'")

    def _run(self):
        """Background thread to check and trigger tasks"""
        while self.running:
            now = datetime.datetime.now()
            triggered = []
            
            # Check for triggered tasks
            for task_id, task in self.tasks.items():
                if task['time'] <= now:
                    self._trigger_task(task)
                    triggered.append(task_id)
            
            # Remove triggered tasks
            for task_id in triggered:
                del self.tasks[task_id]
            
            if triggered:
                self.save_tasks()
            
            # Sleep for a bit
            time.sleep(1)

    def _trigger_task(self, task):
        """Handle a triggered task"""
        # For now, just print the message
        # Later we can add different actions based on task type
        print(f"\n[TASK TRIGGERED] {task['type'].upper()}: {task['message']}")

    def stop(self):
        """Stop the clock service"""
        self.running = False
        if self.thread.is_alive():
            self.thread.join()
