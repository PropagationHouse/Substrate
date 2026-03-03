#!/usr/bin/env python3
"""
XGO Vision Client
----------------
Client for the XGO Face Tracking with LLM Integration

This script provides a GUI to:
1. Connect to the XGO camera server
2. Request snapshots
3. View the camera feed
4. Send images to LLM for analysis
5. Toggle face tracking on/off

Usage:
- Run this script on your PC
- Connect to the XGO's HTTP server
- Capture snapshots and send to LLM
"""

import os
import sys
import time
import json
import base64
import random
import requests
import threading
import socket
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
from PIL import Image, ImageTk
from io import BytesIO
from datetime import datetime

# Configuration
DEFAULT_XGO_IP = "10.147.17.147"  # ZeroTier IP (primary)
DEFAULT_XGO_LOCAL_IP = "10.0.0.144"  # Local WiFi IP (fallback)
DEFAULT_XGO_PORT = 8765
DEFAULT_CONTROL_PORT = 12349
DEFAULT_PROXY_SERVER_URL = "http://localhost:8765"
DEFAULT_LLM_URL = "http://localhost:11434/api/generate"
DEFAULT_LLM_MODEL = "llama3.2-vision:11b"
# Alternative models that might be available
AVAILABLE_MODELS = [
    "llama3.2-vision:11b",
    "llama3.1-vision:8b",
    "bakllava:latest",
    "llava:latest"
]
SNAPSHOT_DIR = os.path.join(os.path.expanduser("~"), "XGO_Snapshots")
os.makedirs(SNAPSHOT_DIR, exist_ok=True)

# Settings file path
SETTINGS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vision_client_settings.json")

# Default settings
DEFAULT_SETTINGS = {
    "xgo_ip": "10.147.17.147",
    "xgo_local_ip": "10.0.0.144",
    "xgo_port": "8765",
    "llm_url": "http://localhost:8765/api/vision/analyze",
    "llm_model": "llama3.2-vision:11b",
    "auto_connect": True,
    "auto_snapshot": False,
    "auto_start": True,  # Auto-start Vision Client on system startup
    "vision_prompt": "Analyze this image from the XGO robot's camera. Describe what you see in detail.",
    "snapshot_interval_min": 30,
    "snapshot_interval_max": 60,
    "proxy_server_url": "http://localhost:8765"
}

# Load settings
def load_settings():
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r') as f:
                return json.load(f)
        return DEFAULT_SETTINGS
    except Exception as e:
        print(f"Error loading settings: {e}")
        return DEFAULT_SETTINGS
        
# Save settings
def save_settings(settings):
    try:
        with open(SETTINGS_FILE, 'w') as f:
            json.dump(settings, f, indent=2)
        return True
    except Exception as e:
        print(f"Error saving settings: {e}")
        return False

class XGOVisionClient:
    def __init__(self, root):
        self.root = root
        self.root.title("XGO Vision Client")
        self.root.geometry("1000x800")
        self.root.minsize(800, 600)
        
        # Connection state
        self.connected = False
        self.xgo_ip = tk.StringVar(value=DEFAULT_XGO_IP)
        self.xgo_port = tk.IntVar(value=DEFAULT_XGO_PORT)
        self.control_port = tk.IntVar(value=DEFAULT_CONTROL_PORT)
        self.face_tracking_active = tk.BooleanVar(value=True)
        
        # LLM configuration
        self.llm_url = tk.StringVar(value=DEFAULT_LLM_URL)
        self.llm_model = tk.StringVar(value=DEFAULT_LLM_MODEL)
        
        # Image data
        self.current_image = None
        self.current_image_data = None
        
        # Load saved settings
        self.settings = load_settings()
        
        # Auto-connect flag
        self.auto_connect = tk.BooleanVar(value=self.settings.get("auto_connect", True))
        self.auto_snapshot = tk.BooleanVar(value=self.settings.get("auto_snapshot", False))
        self.auto_start = tk.BooleanVar(value=self.settings.get("auto_start", True))
        self.vision_prompt = tk.StringVar(value=self.settings.get("vision_prompt", "Analyze this image from the XGO robot's camera. Describe what you see in detail."))
        
        # Randomized timer settings
        self.snapshot_interval_min = tk.IntVar(value=self.settings.get("snapshot_interval_min", 15))
        self.snapshot_interval_max = tk.IntVar(value=self.settings.get("snapshot_interval_max", 45))
        self.auto_snapshot_interval = tk.IntVar(value=30)  # Will be randomized
        
        self.auto_snapshot_running = False
        self.auto_snapshot_thread = None
        
        # Create UI
        self.create_ui()
        
        # Start status update thread
        self.status_thread = threading.Thread(target=self.update_status_thread, daemon=True)
        self.status_thread.start()
        
        # Auto-fetch available models on startup (silent, no response display)
        self.root.after(500, lambda: self.check_available_models(show_response=False))
        
        # Auto-connect if enabled
        if self.auto_connect.get():
            self.initial_connect = True  # Flag to suppress notification on initial connect
            self.root.after(1000, self.connect)  # Connect after 1 second
    
    def create_ui(self):
        """Create the user interface"""
        # Main frame with two columns
        main_frame = ttk.Frame(self.root, padding=10)
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        # Left column - Connection and controls
        left_frame = ttk.LabelFrame(main_frame, text="Connection & Controls", padding=10)
        left_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=False, padx=(0, 5))
        
        # Connection settings
        conn_frame = ttk.Frame(left_frame)
        conn_frame.pack(fill=tk.X, pady=5)
        
        ttk.Label(conn_frame, text="XGO IP:").grid(row=0, column=0, sticky=tk.W, pady=2)
        ttk.Entry(conn_frame, textvariable=self.xgo_ip, width=15).grid(row=0, column=1, sticky=tk.W, pady=2)
        
        ttk.Label(conn_frame, text="HTTP Port:").grid(row=1, column=0, sticky=tk.W, pady=2)
        ttk.Entry(conn_frame, textvariable=self.xgo_port, width=15).grid(row=1, column=1, sticky=tk.W, pady=2)
        
        ttk.Label(conn_frame, text="Control Port:").grid(row=2, column=0, sticky=tk.W, pady=2)
        ttk.Entry(conn_frame, textvariable=self.control_port, width=15).grid(row=2, column=1, sticky=tk.W, pady=2)
        
        # Auto-start checkbox
        auto_start_chk = ttk.Checkbutton(conn_frame, text="Auto-Start on System Startup", variable=self.auto_start, 
                                       command=self.save_settings)
        auto_start_chk.grid(row=3, column=0, columnspan=2, sticky=tk.W, pady=5)
        
        # Connection buttons
        btn_frame = ttk.Frame(left_frame)
        btn_frame.pack(fill=tk.X, pady=5)
        
        self.connect_btn = ttk.Button(btn_frame, text="Connect", command=self.on_connect)
        self.connect_btn.pack(side=tk.LEFT, padx=5)
        
        self.status_lbl = ttk.Label(btn_frame, text="Status: Disconnected")
        self.status_lbl.pack(side=tk.LEFT, padx=5)
        
        # Control buttons
        ctrl_frame = ttk.LabelFrame(left_frame, text="Controls", padding=10)
        ctrl_frame.pack(fill=tk.X, pady=5)
        
        self.face_tracking_chk = ttk.Checkbutton(
            ctrl_frame, 
            text="Face Tracking Active", 
            variable=self.face_tracking_active,
            command=self.toggle_face_tracking
        )
        self.face_tracking_chk.pack(anchor=tk.W, pady=2)
        
        # Auto-connect checkbox
        self.auto_connect_chk = ttk.Checkbutton(
            ctrl_frame,
            text="Auto-Connect on Launch",
            variable=self.auto_connect,
            command=self.save_settings
        )
        self.auto_connect_chk.pack(anchor=tk.W, pady=2)
        
        # Snapshot controls
        snapshot_frame = ttk.Frame(ctrl_frame)
        snapshot_frame.pack(fill=tk.X, pady=5)
        
        self.snapshot_btn = ttk.Button(snapshot_frame, text="Take Snapshot", command=self.take_snapshot)
        self.snapshot_btn.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 2))
        
        self.send_llm_btn = ttk.Button(snapshot_frame, text="Send to LLM", command=self.send_to_llm)
        self.send_llm_btn.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(2, 0))
        
        # Auto-snapshot controls
        auto_snap_frame = ttk.Frame(ctrl_frame)
        auto_snap_frame.pack(fill=tk.X, pady=5)
        
        self.auto_snapshot_chk = ttk.Checkbutton(
            auto_snap_frame,
            text="Auto-Snapshot",
            variable=self.auto_snapshot,
            command=self.toggle_auto_snapshot
        )
        self.auto_snapshot_chk.pack(side=tk.LEFT, padx=(0, 5))
        
        # Interval range frame
        interval_frame = ttk.LabelFrame(ctrl_frame, text="Snapshot Interval (seconds)")
        interval_frame.pack(fill=tk.X, pady=5)
        
        # Min interval
        min_frame = ttk.Frame(interval_frame)
        min_frame.pack(fill=tk.X, pady=2)
        ttk.Label(min_frame, text="Min:").pack(side=tk.LEFT, padx=(5, 0))
        self.min_spinbox = ttk.Spinbox(
            min_frame,
            from_=5,
            to=120,
            width=5,
            textvariable=self.snapshot_interval_min,
            command=self.validate_intervals
        )
        self.min_spinbox.pack(side=tk.LEFT, padx=5)
        
        # Max interval
        max_frame = ttk.Frame(interval_frame)
        max_frame.pack(fill=tk.X, pady=2)
        ttk.Label(max_frame, text="Max:").pack(side=tk.LEFT, padx=(5, 0))
        self.max_spinbox = ttk.Spinbox(
            max_frame,
            from_=10,
            to=300,
            width=5,
            textvariable=self.snapshot_interval_max,
            command=self.validate_intervals
        )
        self.max_spinbox.pack(side=tk.LEFT, padx=5)
        
        # LLM settings
        llm_frame = ttk.LabelFrame(left_frame, text="LLM Settings", padding=10)
        llm_frame.pack(fill=tk.X, pady=5)
        
        ttk.Label(llm_frame, text="LLM API URL:").grid(row=0, column=0, sticky=tk.W, pady=2)
        ttk.Entry(llm_frame, textvariable=self.llm_url, width=30).grid(row=0, column=1, sticky=tk.W, pady=2)
        
        ttk.Label(llm_frame, text="Model:").grid(row=1, column=0, sticky=tk.W, pady=2)
        self.model_combo = ttk.Combobox(llm_frame, textvariable=self.llm_model, width=28)
        self.model_combo.grid(row=1, column=1, sticky=tk.W, pady=2)
        self.model_combo['values'] = AVAILABLE_MODELS
        
        # Vision prompt input
        prompt_frame = ttk.LabelFrame(left_frame, text="Vision Prompt", padding=10)
        prompt_frame.pack(fill=tk.X, pady=5)
        
        prompt_entry = ttk.Entry(prompt_frame, textvariable=self.vision_prompt, width=40)
        prompt_entry.pack(fill=tk.X, pady=2)
        
        # Add a reset button for the prompt
        reset_btn = ttk.Button(prompt_frame, text="Reset to Default", 
                              command=lambda: self.vision_prompt.set("Analyze this image from the XGO robot's camera. Describe what you see in detail."))
        reset_btn.pack(anchor=tk.E, pady=2)
        
        # Add a button to check available models
        check_models_btn = ttk.Button(llm_frame, text="Check Available Models", command=self.check_available_models)
        check_models_btn.grid(row=2, column=0, columnspan=2, sticky=tk.EW, pady=5)
        
        # Right column - Image display and LLM response
        right_frame = ttk.Frame(main_frame)
        right_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        # Image display
        img_frame = ttk.LabelFrame(right_frame, text="Camera View", padding=10)
        img_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 5))
        
        self.image_canvas = tk.Canvas(img_frame, bg="black")
        self.image_canvas.pack(fill=tk.BOTH, expand=True)
        
        # LLM response
        resp_frame = ttk.LabelFrame(right_frame, text="LLM Response", padding=10)
        resp_frame.pack(fill=tk.BOTH, expand=True)
        
        self.response_text = scrolledtext.ScrolledText(resp_frame, wrap=tk.WORD, height=10)
        self.response_text.pack(fill=tk.BOTH, expand=True)
        
    def on_connect(self):
        """Handle connect button click"""
        if not self.connected:
            self.connect()
            
            # If auto-snapshot is enabled in settings, start it after connecting
            if self.auto_snapshot.get() and self.connected:
                self.toggle_auto_snapshot()
        else:
            self.disconnect()
    
    def resolve_xgo_ip(self):
        """Resolve the best XGO IP: probe all known IPs, verify reachability."""
        port = self.xgo_port.get()
        zt_ip = self.settings.get("xgo_ip", DEFAULT_XGO_IP)
        local_ip = self.settings.get("xgo_local_ip", DEFAULT_XGO_LOCAL_IP)
        # Probe all known IPs: ZeroTier first (works anywhere), local WiFi as fallback
        for candidate in [zt_ip, local_ip]:
            try:
                s = socket.create_connection((candidate, port), timeout=2)
                s.close()
                self.xgo_ip.set(candidate)
                print(f"[Vision] XGO reachable at {candidate}")
                return
            except (OSError, socket.timeout):
                continue
        print(f"[Vision] Could not reach XGO on any IP, keeping: {self.xgo_ip.get()}")

    def connect(self):
        """Connect to the XGO"""
        # Resolve best IP before connecting (handles WiFi ↔ ZeroTier transitions)
        self.resolve_xgo_ip()
        
        try:
            # Test connection by requesting status
            response = requests.get(
                f"http://{self.xgo_ip.get()}:{self.xgo_port.get()}/status",
                timeout=5
            )
            
            if response.status_code == 200:
                self.connected = True
                self.connect_btn.config(text="Disconnect")
                self.status_lbl.config(text=f"Status: Connected ({self.xgo_ip.get()})")
                self.snapshot_btn.state(['!disabled'])
                
                # Update face tracking status from server
                status = response.json()
                self.face_tracking_active.set(status.get("face_tracking_active", True))
                
                if not self.initial_connect:
                    messagebox.showinfo("Connected", f"Connected to XGO at {self.xgo_ip.get()}")
            else:
                # Only show error if this is not an initial auto-connect attempt
                if not hasattr(self, 'initial_connect') or not self.initial_connect:
                    messagebox.showerror("Connection Error", f"Failed to connect: {response.status_code}")
                else:
                    print(f"Initial connection attempt failed: {response.status_code} - will retry later")
        
        except Exception as e:
            # Only show error if this is not an initial auto-connect attempt
            if not hasattr(self, 'initial_connect') or not self.initial_connect:
                messagebox.showerror("Connection Error", f"Failed to connect: {e}")
            else:
                print(f"Initial connection attempt failed: {e} - will retry later")
    
    def disconnect(self):
        """Disconnect from the XGO"""
        self.connected = False
        self.connect_btn.config(text="Connect")
        self.status_lbl.config(text="Status: Disconnected")
        self.snapshot_btn.state(['disabled'])
        self.send_llm_btn.state(['disabled'])
    
    def update_status_thread(self):
        """Thread to periodically update status"""
        # Add a delay before starting the status checks to allow the system to initialize
        time.sleep(2)
        
        # Counter for auto-reconnect attempts
        reconnect_counter = 0
        
        while True:
            if self.connected:
                try:
                    response = requests.get(
                        f"http://{self.xgo_ip.get()}:{self.xgo_port.get()}/status",
                        timeout=2
                    )
                    
                    if response.status_code == 200:
                        status = response.json()
                        # Update UI based on status
                        self.root.after(0, lambda: self.face_tracking_active.set(status.get("face_tracking_active", True)))
                        # Reset reconnect counter on successful connection
                        reconnect_counter = 0
                    else:
                        # Silently disconnect without showing error
                        self.root.after(0, self.disconnect)
                
                except Exception:
                    # Connection lost - silently disconnect
                    self.root.after(0, self.disconnect)
            else:
                # If we're not connected and auto-connect is enabled, try to reconnect periodically
                # but limit the frequency of reconnection attempts
                reconnect_counter += 1
                if self.auto_connect.get() and reconnect_counter >= 12:  # Try every ~60 seconds (12 * 5s)
                    reconnect_counter = 0
                    self.initial_connect = True  # Suppress notifications
                    self.root.after(0, self.connect)
            
            # Sleep for a while
            time.sleep(5)
    
    def toggle_face_tracking(self):
        """Toggle face tracking on/off"""
        if not self.connected:
            return
        
        try:
            # Send command to control server
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            command = json.dumps({"face_tracking": self.face_tracking_active.get()})
            sock.sendto(command.encode('utf-8'), (self.xgo_ip.get(), self.control_port.get()))
            
            # Wait for response
            sock.settimeout(2.0)
            data, _ = sock.recvfrom(1024)
            response = json.loads(data.decode('utf-8'))
            
            if response.get("status") == "ok":
                print(f"Face tracking {'enabled' if self.face_tracking_active.get() else 'disabled'}")
            else:
                messagebox.showerror("Command Error", "Failed to set face tracking state")
                
        except Exception as e:
            messagebox.showerror("Command Error", f"Failed to set face tracking state: {e}")
            
        finally:
            sock.close()
            
    def toggle_auto_snapshot(self, force_start=False):
        """Toggle automatic snapshot and LLM analysis
        
        Args:
            force_start (bool): If True, force start auto-snapshot even if checkbox is not checked
        """
        # If force_start is True, set the checkbox to checked
        if force_start:
            self.auto_snapshot.set(True)
            
        if self.auto_snapshot.get():
            if not self.connected:
                messagebox.showwarning("Not Connected", "Please connect to XGO first")
                self.auto_snapshot.set(False)
                return
                
            # Start auto-snapshot thread if not already running
            if not self.auto_snapshot_running:
                self.auto_snapshot_running = True
                self.auto_snapshot_thread = threading.Thread(target=self.auto_snapshot_loop, daemon=True)
                self.auto_snapshot_thread.start()
                
                # Update status with interval range
                min_interval = self.snapshot_interval_min.get()
                max_interval = self.snapshot_interval_max.get()
                self.status_lbl.config(text=f"Status: Auto-Snapshot ON ({min_interval}-{max_interval}s)")
            
            # Save settings
            self.save_settings()
        else:
            # Stop auto-snapshot thread
            self.auto_snapshot_running = False
            if self.connected:
                self.status_lbl.config(text="Status: Connected")
            else:
                self.status_lbl.config(text="Status: Disconnected")
            
            # Save settings
            self.save_settings()
                
    def auto_snapshot_loop(self):
        """Loop for automatic snapshot and LLM analysis"""
        # Initial delay to ensure UI is fully initialized
        time.sleep(2)
        
        while self.auto_snapshot_running and self.connected:
            try:
                # Take snapshot (returns True if successful)
                snapshot_success = self.take_snapshot()
                
                # Wait a moment for the image to be processed
                time.sleep(1)
                
                # If we have an image and snapshot was successful, send to LLM
                if snapshot_success and self.current_image is not None:
                    self.send_to_llm()
                
                # Get a random interval within the specified range
                min_interval = self.snapshot_interval_min.get()
                max_interval = self.snapshot_interval_max.get()
                random_interval = random.randint(min_interval, max_interval)
                
                # Wait for the randomized interval
                for _ in range(random_interval):
                    if not self.auto_snapshot_running or not self.connected:
                        break
                    time.sleep(1)
                    
            except Exception as e:
                print(f"Error in auto-snapshot loop: {e}")
                time.sleep(5)  # Wait before retrying
                
    def update_vision_prompt(self):
        """Update the vision prompt and save settings"""
        new_prompt = self.prompt_text.get(1.0, tk.END).strip()
        self.vision_prompt.set(new_prompt)
        self.save_settings()
        
    def reset_vision_prompt(self):
        """Reset the vision prompt to default"""
        default_prompt = "Analyze this image from the XGO robot's camera. Describe what you see in detail."
        self.prompt_text.delete(1.0, tk.END)
        self.prompt_text.insert(tk.END, default_prompt)
        self.vision_prompt.set(default_prompt)
        self.save_settings()
        
    def validate_intervals(self):
        """Ensure min is less than max for interval settings"""
        min_val = self.snapshot_interval_min.get()
        max_val = self.snapshot_interval_max.get()
        
        if min_val >= max_val:
            self.snapshot_interval_max.set(min_val + 5)
        
        self.save_settings()
        
    def save_settings(self):
        """Save current settings to file"""
        settings = {
            "xgo_ip": self.xgo_ip.get(),
            "xgo_port": self.xgo_port.get(),
            "llm_url": self.llm_url.get(),
            "llm_model": self.llm_model.get(),
            "auto_connect": self.auto_connect.get(),
            "auto_snapshot": self.auto_snapshot.get(),
            "auto_start": self.auto_start.get(),
            "vision_prompt": self.vision_prompt.get(),
            "snapshot_interval_min": self.snapshot_interval_min.get(),
            "snapshot_interval_max": self.snapshot_interval_max.get()
        }
        save_settings(settings)
    
    def take_snapshot(self):
        """Take a snapshot from the XGO camera"""
        if not self.connected:
            return
        
        # Track if this is an auto-snapshot (from auto-snapshot thread)
        is_auto = threading.current_thread() != threading.main_thread()
        
        try:
            # Request snapshot
            response = requests.get(
                f"http://{self.xgo_ip.get()}:{self.xgo_port.get()}/snapshot",
                timeout=5
            )
            
            if response.status_code == 200:
                # Get image data
                image_data = response.content
                self.current_image_data = image_data
                
                # Save the image
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"xgo_snapshot_{timestamp}.jpg"
                filepath = os.path.join(SNAPSHOT_DIR, filename)
                
                with open(filepath, 'wb') as f:
                    f.write(image_data)
                
                # Display the image
                image = Image.open(BytesIO(image_data))
                self.current_image = image
                
                # Resize to fit canvas
                self.display_image(image)
                
                # Enable send to LLM button
                self.root.after(0, lambda: self.send_llm_btn.state(['!disabled']))
                
                print(f"Snapshot saved to {filepath}")
                return True
            else:
                error_msg = f"Failed to take snapshot: {response.status_code}"
                print(error_msg)
                if not is_auto:  # Only show error dialog for manual snapshots
                    self.root.after(0, lambda: messagebox.showerror("Snapshot Error", error_msg))
                return False
        
        except Exception as e:
            error_msg = f"Failed to take snapshot: {e}"
            print(error_msg)
            if not is_auto:  # Only show error dialog for manual snapshots
                self.root.after(0, lambda: messagebox.showerror("Snapshot Error", error_msg))
            return False
    
    def display_image(self, image):
        """Display an image on the canvas"""
        # Get canvas size
        canvas_width = self.image_canvas.winfo_width()
        canvas_height = self.image_canvas.winfo_height()
        
        # Check if canvas has valid dimensions
        if canvas_width <= 1 or canvas_height <= 1:
            # Canvas not ready yet, schedule this function to run again after a short delay
            self.root.after(100, lambda: self.display_image(image))
            return
        
        try:
            # Resize image to fit canvas while maintaining aspect ratio
            img_width, img_height = image.size
            scale = min(canvas_width / img_width, canvas_height / img_height)
            
            new_width = int(img_width * scale)
            new_height = int(img_height * scale)
            
            # Ensure dimensions are valid
            if new_width <= 0 or new_height <= 0:
                # Use original size if scaling fails
                new_width = img_width
                new_height = img_height
            
            resized_image = image.resize((new_width, new_height), Image.LANCZOS)
            
            # Convert to PhotoImage
            photo = ImageTk.PhotoImage(resized_image)
            
            # Clear canvas
            self.image_canvas.delete("all")
            
            # Calculate position to center the image
            x = (canvas_width - new_width) // 2
            y = (canvas_height - new_height) // 2
            
            # Display image
            self.image_canvas.create_image(x, y, anchor=tk.NW, image=photo)
            self.image_canvas.image = photo  # Keep a reference
        except Exception as e:
            # Silently handle errors during image display
            # This prevents error messages during startup or window resizing
            print(f"Image display error (handled): {e}")
            return
    
    def check_available_models(self, show_response=True):
        """Check which vision models are available in Ollama"""
        try:
            if show_response:
                # Clear previous response
                self.response_text.delete(1.0, tk.END)
                self.response_text.insert(tk.END, "Checking available models...\n\n")
                self.root.update()
            
            # Get list of models from Ollama
            response = requests.get(
                "http://localhost:11434/api/tags",
                timeout=5
            )
            
            if response.status_code == 200:
                models = response.json().get("models", [])
                
                # Get all model names, sorted
                all_models = sorted([m["name"] for m in models])
                
                if all_models:
                    if show_response:
                        self.response_text.delete(1.0, tk.END)
                        self.response_text.insert(tk.END, f"Available models ({len(all_models)}):\n\n")
                        for model in all_models:
                            self.response_text.insert(tk.END, f"- {model}\n")
                    
                    # Update the model combobox with all available models
                    self.model_combo['values'] = all_models
                    
                    # Set first model as default if current one isn't available
                    if all_models and self.llm_model.get() not in all_models:
                        self.llm_model.set(all_models[0])
                else:
                    if show_response:
                        self.response_text.delete(1.0, tk.END)
                        self.response_text.insert(tk.END, "No models found. Please install one with Ollama:\n\n")
                        self.response_text.insert(tk.END, "ollama pull llava:latest")
            else:
                if show_response:
                    self.response_text.delete(1.0, tk.END)
                    self.response_text.insert(tk.END, f"Error checking models: {response.status_code}\n{response.text}")
        
        except Exception as e:
            if show_response:
                self.response_text.delete(1.0, tk.END)
                self.response_text.insert(tk.END, f"Error checking models: {e}\n\nMake sure Ollama is running.")
    
    def send_to_llm(self):
        """Send the current image to the LLM for analysis"""
        if self.current_image_data is None:
            messagebox.showerror("Error", "No image available")
            return
        
        try:
            # Convert image to base64
            img_base64 = base64.b64encode(self.current_image_data).decode('utf-8')
            
            # Get prompt text from the UI
            prompt_text = self.vision_prompt.get()
            
            # Clear previous response
            self.response_text.delete(1.0, tk.END)
            self.response_text.insert(tk.END, "Sending image to backend for analysis...\n\n")
            self.root.update()
            
            # Send to the main app's working input endpoint to mirror other image sends
            # This uses the exact same path the main UI uses (proxy_server /api/input)
            backend_url = "http://localhost:8765/api/input"

            # Prepare the request payload expected by /api/input
            # It accepts image_data_url or image_base64 and optional text
            payload = {
                "image_data_url": f"data:image/jpeg;base64,{img_base64}",
                "text": prompt_text
            }
            
            # Send to backend
            response = requests.post(
                backend_url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=180
            )
            
            if response.status_code == 200:
                result = response.json()
                
                # Handle different response formats
                if isinstance(result, dict):
                    # If result is a dict, try to get 'result' key
                    if "result" in result:
                        llm_response = result["result"]
                        # Handle if result["result"] is itself a dict or string
                        if isinstance(llm_response, dict):
                            llm_response = json.dumps(llm_response, indent=2)
                        elif llm_response is None:
                            # If result["result"] is None, use a default message
                            llm_response = "Image processed successfully. Check the main application for the response."
                    else:
                        # If no 'result' key, use the whole response
                        llm_response = json.dumps(result, indent=2)
                elif isinstance(result, str):
                    # If result is already a string
                    llm_response = result
                else:
                    # Fallback for any other type
                    llm_response = str(result)
                    
                # If response is empty or None, provide a helpful message
                if not llm_response or llm_response == "None" or llm_response == "none":
                    llm_response = "Image processed successfully. Check the main application for the response."
                
                # Display response
                self.response_text.delete(1.0, tk.END)
                self.response_text.insert(tk.END, llm_response)
            else:
                # If backend fails, fall back to direct Ollama Generate API
                self.response_text.delete(1.0, tk.END)
                self.response_text.insert(tk.END, "Backend connection failed. Falling back to direct Ollama Generate API...\n\n")
                self.root.update()

                # Build Generate payload matching image_processor.analyze_image_with_llm()
                generate_payload = {
                    "model": self.llm_model.get(),
                    "prompt": prompt_text or "Describe this image in detail.",
                    "images": [img_base64],  # raw base64, no data URL prefix
                    "stream": False
                }

                # Ensure we post to /api/generate
                generate_url = self.llm_url.get()
                try:
                    direct_response = requests.post(
                        generate_url,
                        json=generate_payload,
                        headers={"Content-Type": "application/json"},
                        timeout=30
                    )

                    if direct_response.status_code == 200:
                        direct_result = direct_response.json()
                        direct_llm_response = direct_result.get("response") or json.dumps(direct_result, indent=2)

                        # Display direct response
                        self.response_text.delete(1.0, tk.END)
                        self.response_text.insert(tk.END, direct_llm_response)
                    else:
                        error_msg = f"Direct Generate API error: {direct_response.status_code}\n{direct_response.text}"
                        self.response_text.delete(1.0, tk.END)
                        self.response_text.insert(tk.END, error_msg)
                except Exception as e:
                    error_msg = f"Error calling Generate API: {e}"
                    self.response_text.delete(1.0, tk.END)
                    self.response_text.insert(tk.END, error_msg)
                
        except Exception as e:
            error_msg = f"Error sending to LLM: {e}"
            self.response_text.delete(1.0, tk.END)
            self.response_text.insert(tk.END, error_msg)

def launch_vision_client(background_mode=False):
    """Launch the XGO Vision Client as a standalone application
    
    Args:
        background_mode (bool): If True, start minimized in background mode
    """
    # Create root window
    root = tk.Tk()
    app = XGOVisionClient(root)
    
    # Configure window resize behavior
    def on_resize(event):
        if hasattr(app, 'current_image') and app.current_image:
            app.display_image(app.current_image)
    
    root.bind("<Configure>", on_resize)
    
    # Handle window close event
    def on_closing():
        # Stop any running auto-snapshot thread
        app.auto_snapshot_running = False
        
        if app.auto_snapshot.get() and app.connected and not background_mode:
            # If auto-snapshot is enabled and not in background mode, ask if user wants to minimize
            if messagebox.askyesno("Vision Client", 
                                "Auto-snapshot is enabled. Minimize to background instead of closing?"):
                root.iconify()
                return
        
        # Otherwise, close the application
        root.destroy()
    
    root.protocol("WM_DELETE_WINDOW", on_closing)
    
    # If background mode is enabled, start minimized and auto-connect
    if background_mode:
        # Start minimized
        root.withdraw()  # Hide window completely
        
        # Schedule auto-connect and minimize after a short delay
        def delayed_start():
            if app.auto_connect.get():
                app.initial_connect = True  # Suppress connection notification
                app.connect()
                
                # If auto-snapshot is enabled in settings, start it after connecting
                if app.auto_snapshot.get():
                    app.toggle_auto_snapshot()
                    
            root.iconify()  # Minimize to taskbar
        
        root.after(1000, delayed_start)
    
    # Start the application
    root.mainloop()

if __name__ == "__main__":
    # Check for command line arguments
    import sys
    background_mode = "--background" in sys.argv
    launch_vision_client(background_mode=background_mode)
