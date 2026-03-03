#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Check if an instance of the application is already running
"""

import os
import sys
import json
import time
import socket

def print_json(data):
    """Print JSON data to stdout and flush"""
    print(json.dumps(data))
    sys.stdout.flush()

def main():
    """Check if another instance is running by trying to bind to a port"""
    try:
        # Try to create a lock file
        lock_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'tp_speech.lock')
        
        # Check if the lock file exists and is recent (less than 10 seconds old)
        if os.path.exists(lock_file):
            file_age = time.time() - os.path.getmtime(lock_file)
            if file_age < 10:
                print_json({"status": "error", "message": "Another instance is already running"})
                return 1
            else:
                # Lock file is old, we can remove it
                try:
                    os.remove(lock_file)
                except:
                    pass
        
        # Create the lock file
        with open(lock_file, 'w') as f:
            f.write(str(os.getpid()))
        
        print_json({"status": "success", "message": "No other instance is running"})
        return 0
        
    except Exception as e:
        print_json({"status": "error", "message": f"Error checking instance: {str(e)}"})
        return 1

if __name__ == "__main__":
    sys.exit(main())
