import json
import os
import time
import datetime
import threading
import winsound
from pathlib import Path

class AlarmManager:
    def __init__(self):
        self.alarms = {}  # Dictionary to store active alarms
        self.alarm_file = os.path.join(os.path.dirname(__file__), 'alarms.json')
        self.load_alarms()
        self.running = True
        self.thread = threading.Thread(target=self._check_alarms, daemon=True)
        self.thread.start()

    def load_alarms(self):
        """Load saved alarms from file"""
        if os.path.exists(self.alarm_file):
            try:
                with open(self.alarm_file, 'r') as f:
                    saved_alarms = json.load(f)
                    # Convert string timestamps back to datetime objects
                    for alarm_id, alarm_data in saved_alarms.items():
                        alarm_time = datetime.datetime.fromisoformat(alarm_data['time'])
                        if alarm_time > datetime.datetime.now():
                            self.alarms[alarm_id] = {
                                'time': alarm_time,
                                'active': alarm_data['active']
                            }
            except Exception as e:
                print(f"Error loading alarms: {e}")

    def save_alarms(self):
        """Save current alarms to file"""
        try:
            # Convert datetime objects to ISO format strings for JSON serialization
            save_data = {}
            for alarm_id, alarm_data in self.alarms.items():
                save_data[alarm_id] = {
                    'time': alarm_data['time'].isoformat(),
                    'active': alarm_data['active']
                }
            with open(self.alarm_file, 'w') as f:
                json.dump(save_data, f, indent=2)
        except Exception as e:
            print(f"Error saving alarms: {e}")

    def set_alarm(self, alarm_time):
        """Set a new alarm"""
        alarm_id = str(int(time.time()))
        self.alarms[alarm_id] = {
            'time': alarm_time,
            'active': True
        }
        self.save_alarms()
        return alarm_id

    def cancel_alarm(self, alarm_id):
        """Cancel an existing alarm"""
        if alarm_id in self.alarms:
            del self.alarms[alarm_id]
            self.save_alarms()
            return True
        return False

    def list_alarms(self):
        """List all active alarms"""
        current_alarms = []
        for alarm_id, alarm_data in self.alarms.items():
            if alarm_data['active']:
                current_alarms.append({
                    'id': alarm_id,
                    'time': alarm_data['time'].strftime('%Y-%m-%d %H:%M:%S'),
                    'remaining': str(alarm_data['time'] - datetime.datetime.now()).split('.')[0]
                })
        return current_alarms

    def _check_alarms(self):
        """Background thread to check and trigger alarms"""
        while self.running:
            now = datetime.datetime.now()
            triggered_alarms = []
            
            for alarm_id, alarm_data in self.alarms.items():
                if alarm_data['active'] and alarm_data['time'] <= now:
                    self._trigger_alarm()
                    triggered_alarms.append(alarm_id)
            
            # Remove triggered alarms
            for alarm_id in triggered_alarms:
                del self.alarms[alarm_id]
            
            if triggered_alarms:
                self.save_alarms()
            
            time.sleep(1)  # Check every second

    def _trigger_alarm(self):
        """Trigger the alarm sound"""
        # Play Windows default notification sound
        winsound.PlaySound("SystemExclamation", winsound.SND_ALIAS)

    def stop(self):
        """Stop the alarm manager"""
        self.running = False
        if self.thread.is_alive():
            self.thread.join()
