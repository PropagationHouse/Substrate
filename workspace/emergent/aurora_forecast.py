#!/usr/bin/env python
# aurora_forecast.py - A simple script to open aurora forecast pages
import webbrowser
import time
import sys

def open_aurora_forecast():
    """Open aurora forecast pages in the default web browser"""
    print("Opening aurora forecast pages...")
    
    # URL for aurora forecast
    urls = [
        # Comprehensive NOAA Aurora Dashboard
        'https://www.swpc.noaa.gov/communities/aurora-dashboard-experimental'
    ]
    
    # Open each URL with a brief pause between
    for url in urls:
        try:
            webbrowser.open(url, new=2)  # new=2 opens in a new browser window
            time.sleep(0.5)  # Brief pause between opening tabs
        except Exception as e:
            print(f"Error opening URL {url}: {e}")
    
    print("Aurora forecast pages opened successfully.")

if __name__ == "__main__":
    open_aurora_forecast()
    sys.exit(0)  # Exit with success code
