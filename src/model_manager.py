import os
import json
import requests
import logging
import subprocess
import threading
import time
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ModelManager:
    """
    Handles Ollama model management operations including listing, installing,
    removing, and getting information about models.
    """
    
    def __init__(self, api_base="http://localhost:11434"):
        self.api_base = api_base
        self.installed_models = []
        self.available_models = []
        self.model_details = {}
        self.current_operations = {}  # Track ongoing operations
        
        # Llama 4 models we want to highlight
        self.featured_models = [
            "llama4-8b",
            "llama4-12b",
            "llama4-8b-scout",
            "llama4-12b-scout",
            "llama4-8b-maverick",
            "llama4-12b-maverick"
        ]

        # Remote (online) model offerings
        self.remote_models = [
            {
                "name": "grok-latest",
                "display_name": "Grok (xAI)",
                "provider": "xAI",
                "endpoint": "https://api.x.ai/v1/chat/completions",
                "auth_env": "XAI_API_KEY",
                "notes": "Requires XAI_API_KEY. Ideal when you want latest Grok intelligence without local GPU load."
            },
            {
                "name": "claude-3.7-sonnet",
                "display_name": "Claude 3.7 Sonnet",
                "provider": "Anthropic",
                "endpoint": "https://api.anthropic.com/v1/messages",
                "auth_env": "ANTHROPIC_API_KEY",
                "notes": "Requires ANTHROPIC_API_KEY. High reasoning capability with 200K context window."
            }
        ]
        
        # Initialize by fetching installed models
        self.refresh_models()
    
    def refresh_models(self):
        """Refresh the list of installed models and available models"""
        self._fetch_installed_models()
        self._fetch_available_models()
        return {
            "installed": self.installed_models,
            "available": self.available_models,
            "featured": self._get_featured_models(),
            "remote": self._get_remote_models()
        }
    
    def _fetch_installed_models(self):
        """Fetch the list of installed models from Ollama"""
        try:
            response = requests.get(f"{self.api_base}/api/tags", timeout=5)
            if response.status_code == 200:
                data = response.json()
                self.installed_models = [model["name"] for model in data.get("models", [])]
                
                # Also update model details
                for model in data.get("models", []):
                    self.model_details[model["name"]] = {
                        "size": model.get("size", 0),
                        "modified_at": model.get("modified_at", ""),
                        "digest": model.get("digest", "")
                    }
                
                logger.info(f"Found {len(self.installed_models)} installed models")
                return self.installed_models
            else:
                logger.error(f"Failed to fetch installed models: {response.status_code}")
                return []
        except Exception as e:
            logger.error(f"Error fetching installed models: {str(e)}")
            return []
    
    def _fetch_available_models(self):
        """Fetch list of available models from Ollama library"""
        try:
            # This is a simplified approach - in reality, we'd need to parse the Ollama library page
            # or use their API if available
            # Updated to match the user's installed models based on ollama list output
            available_models = [
                "llama4:16x17b",
                "qwen2.5-coder:14b",
                "llama3.2-vision:11b",
                "dolphin-mixtral:latest",
                "dolphin-mistral:7b",
                "dolphin3:8b"
            ]
            
            # Filter out already installed models
            self.available_models = [model for model in available_models if model not in self.installed_models]
            return self.available_models
        except Exception as e:
            logger.error(f"Error fetching available models: {str(e)}")
            return []
    
    def _get_featured_models(self):
        """Get featured models with their installation status"""
        featured = []
        for model_name in self.featured_models:
            is_installed = model_name in self.installed_models
            featured.append({
                "name": model_name,
                "installed": is_installed,
                "details": self.model_details.get(model_name, {})
            })
        return featured

    def _get_remote_models(self):
        """Return remote model catalog with provider metadata"""
        return self.remote_models.copy()
    
    def get_model_info(self, model_name):
        """Get detailed information about a specific model"""
        if model_name in self.installed_models:
            return {
                "name": model_name,
                "installed": True,
                "details": self.model_details.get(model_name, {})
            }
        elif model_name in self.available_models:
            return {
                "name": model_name,
                "installed": False,
                "details": {}
            }
        else:
            return None
    
    def install_model(self, model_name, callback=None):
        """
        Install a model from Ollama library
        
        Args:
            model_name: Name of the model to install
            callback: Function to call with progress updates
        
        Returns:
            operation_id: ID to track the installation progress
        """
        if model_name in self.installed_models:
            logger.info(f"Model {model_name} is already installed")
            if callback:
                callback({
                    "model": model_name,
                    "status": "completed",
                    "progress": 100,
                    "message": "Model is already installed"
                })
            return None
        
        # Generate an operation ID
        operation_id = f"install_{model_name}_{int(time.time())}"
        
        # Start installation in a separate thread
        thread = threading.Thread(
            target=self._run_install_process,
            args=(model_name, operation_id, callback)
        )
        thread.daemon = True
        thread.start()
        
        # Track the operation
        self.current_operations[operation_id] = {
            "type": "install",
            "model": model_name,
            "status": "running",
            "progress": 0,
            "thread": thread
        }
        
        return operation_id
    
    def _run_install_process(self, model_name, operation_id, callback=None):
        """Run the model installation process"""
        try:
            logger.info(f"Starting installation of {model_name}")
            
            # Update status
            self.current_operations[operation_id]["status"] = "running"
            if callback:
                callback({
                    "operation_id": operation_id,
                    "model": model_name,
                    "status": "running",
                    "progress": 0,
                    "message": f"Starting installation of {model_name}"
                })
            
            # Run the Ollama pull command
            process = subprocess.Popen(
                ["ollama", "pull", model_name],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True
            )
            
            # Process output to track progress
            for line in process.stdout:
                progress = self._parse_progress(line)
                if progress is not None:
                    self.current_operations[operation_id]["progress"] = progress
                    if callback:
                        callback({
                            "operation_id": operation_id,
                            "model": model_name,
                            "status": "running",
                            "progress": progress,
                            "message": f"Downloading {model_name}: {progress}% complete"
                        })
            
            # Wait for process to complete
            process.wait()
            
            if process.returncode == 0:
                logger.info(f"Successfully installed {model_name}")
                self.current_operations[operation_id]["status"] = "completed"
                self.current_operations[operation_id]["progress"] = 100
                
                # Update our model lists
                self._fetch_installed_models()
                self._fetch_available_models()
                
                if callback:
                    callback({
                        "operation_id": operation_id,
                        "model": model_name,
                        "status": "completed",
                        "progress": 100,
                        "message": f"Successfully installed {model_name}"
                    })
            else:
                logger.error(f"Failed to install {model_name}")
                self.current_operations[operation_id]["status"] = "failed"
                if callback:
                    callback({
                        "operation_id": operation_id,
                        "model": model_name,
                        "status": "failed",
                        "progress": 0,
                        "message": f"Failed to install {model_name}"
                    })
        except Exception as e:
            logger.error(f"Error installing model {model_name}: {str(e)}")
            self.current_operations[operation_id]["status"] = "failed"
            if callback:
                callback({
                    "operation_id": operation_id,
                    "model": model_name,
                    "status": "failed",
                    "progress": 0,
                    "message": f"Error: {str(e)}"
                })
    
    def _parse_progress(self, line):
        """Parse progress information from Ollama output"""
        try:
            if "%" in line:
                # Extract percentage from line like "Download progress: 45.23%"
                parts = line.split("%")
                if len(parts) > 0:
                    percent_part = parts[0].split(":")
                    if len(percent_part) > 1:
                        return float(percent_part[1].strip())
            return None
        except Exception:
            return None
    
    def remove_model(self, model_name, callback=None):
        """
        Remove an installed model
        
        Args:
            model_name: Name of the model to remove
            callback: Function to call with progress updates
        
        Returns:
            operation_id: ID to track the removal progress
        """
        if model_name not in self.installed_models:
            logger.info(f"Model {model_name} is not installed")
            if callback:
                callback({
                    "model": model_name,
                    "status": "failed",
                    "progress": 0,
                    "message": "Model is not installed"
                })
            return None
        
        # Generate an operation ID
        operation_id = f"remove_{model_name}_{int(time.time())}"
        
        # Start removal in a separate thread
        thread = threading.Thread(
            target=self._run_remove_process,
            args=(model_name, operation_id, callback)
        )
        thread.daemon = True
        thread.start()
        
        # Track the operation
        self.current_operations[operation_id] = {
            "type": "remove",
            "model": model_name,
            "status": "running",
            "progress": 0,
            "thread": thread
        }
        
        return operation_id
    
    def _run_remove_process(self, model_name, operation_id, callback=None):
        """Run the model removal process"""
        try:
            logger.info(f"Starting removal of {model_name}")
            
            # Update status
            self.current_operations[operation_id]["status"] = "running"
            if callback:
                callback({
                    "operation_id": operation_id,
                    "model": model_name,
                    "status": "running",
                    "progress": 50,
                    "message": f"Removing {model_name}"
                })
            
            # Run the Ollama rm command
            process = subprocess.run(
                ["ollama", "rm", model_name],
                capture_output=True,
                text=True
            )
            
            if process.returncode == 0:
                logger.info(f"Successfully removed {model_name}")
                self.current_operations[operation_id]["status"] = "completed"
                self.current_operations[operation_id]["progress"] = 100
                
                # Update our model lists
                self._fetch_installed_models()
                self._fetch_available_models()
                
                if callback:
                    callback({
                        "operation_id": operation_id,
                        "model": model_name,
                        "status": "completed",
                        "progress": 100,
                        "message": f"Successfully removed {model_name}"
                    })
            else:
                logger.error(f"Failed to remove {model_name}: {process.stderr}")
                self.current_operations[operation_id]["status"] = "failed"
                if callback:
                    callback({
                        "operation_id": operation_id,
                        "model": model_name,
                        "status": "failed",
                        "progress": 0,
                        "message": f"Failed to remove {model_name}: {process.stderr}"
                    })
        except Exception as e:
            logger.error(f"Error removing model {model_name}: {str(e)}")
            self.current_operations[operation_id]["status"] = "failed"
            if callback:
                callback({
                    "operation_id": operation_id,
                    "model": model_name,
                    "status": "failed",
                    "progress": 0,
                    "message": f"Error: {str(e)}"
                })
    
    def get_operation_status(self, operation_id):
        """Get the status of an ongoing operation"""
        if operation_id in self.current_operations:
            operation = self.current_operations[operation_id]
            return {
                "operation_id": operation_id,
                "type": operation["type"],
                "model": operation["model"],
                "status": operation["status"],
                "progress": operation["progress"]
            }
        else:
            return None
