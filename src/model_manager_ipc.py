import json
import logging
import threading
import time
from model_manager import ModelManager

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ModelManagerIPC:
    """
    Handles IPC communication between the Electron frontend and the ModelManager
    """
    
    def __init__(self, proxy_server=None):
        self.proxy_server = proxy_server
        self.model_manager = ModelManager()
        self.current_operations = {}
        
        # Register operations callback
        self.operation_callback = self._handle_operation_update
    
    def handle_message(self, message):
        """
        Handle incoming IPC messages from the frontend
        
        Args:
            message: The message from the frontend
            
        Returns:
            Response to send back to the frontend
        """
        try:
            if not isinstance(message, dict):
                return {"error": "Invalid message format"}
            
            action = message.get('action')
            if not action:
                return {"error": "No action specified"}
            
            # Handle different actions
            if action == 'refresh-models':
                return self._handle_refresh_models()
            elif action == 'install-model':
                return self._handle_install_model(message)
            elif action == 'remove-model':
                return self._handle_remove_model(message)
            elif action == 'get-operation-status':
                return self._handle_get_operation_status(message)
            else:
                return {"error": f"Unknown action: {action}"}
        except Exception as e:
            logger.error(f"Error handling model manager message: {str(e)}")
            return {"error": str(e)}
    
    def _handle_refresh_models(self):
        """Handle request to refresh model lists"""
        try:
            models = self.model_manager.refresh_models()
            
            # Get current model from config
            current_model = ""
            if self.proxy_server and hasattr(self.proxy_server, 'config'):
                current_model = self.proxy_server.config.get('model', '')
            
            return {
                "action": "models-refreshed",
                "models": models,
                "currentModel": current_model
            }
        except Exception as e:
            logger.error(f"Error refreshing models: {str(e)}")
            return {"error": str(e)}
    
    def _handle_install_model(self, message):
        """Handle request to install a model"""
        try:
            model_name = message.get('model')
            if not model_name:
                return {"error": "No model specified"}
            
            # Start installation
            operation_id = self.model_manager.install_model(model_name, self.operation_callback)
            
            if operation_id:
                return {
                    "action": "operation-started",
                    "operationId": operation_id,
                    "type": "install",
                    "model": model_name
                }
            else:
                return {"error": "Failed to start installation"}
        except Exception as e:
            logger.error(f"Error installing model: {str(e)}")
            return {"error": str(e)}
    
    def _handle_remove_model(self, message):
        """Handle request to remove a model"""
        try:
            model_name = message.get('model')
            if not model_name:
                return {"error": "No model specified"}
            
            # Start removal
            operation_id = self.model_manager.remove_model(model_name, self.operation_callback)
            
            if operation_id:
                return {
                    "action": "operation-started",
                    "operationId": operation_id,
                    "type": "remove",
                    "model": model_name
                }
            else:
                return {"error": "Failed to start removal"}
        except Exception as e:
            logger.error(f"Error removing model: {str(e)}")
            return {"error": str(e)}
    
    def _handle_get_operation_status(self, message):
        """Handle request to get operation status"""
        try:
            operation_id = message.get('operationId')
            if not operation_id:
                return {"error": "No operation ID specified"}
            
            status = self.model_manager.get_operation_status(operation_id)
            
            if status:
                return {
                    "action": "operation-status",
                    "operation": status
                }
            else:
                return {"error": "Operation not found"}
        except Exception as e:
            logger.error(f"Error getting operation status: {str(e)}")
            return {"error": str(e)}
    
    def _handle_operation_update(self, update):
        """
        Callback for operation updates
        
        Args:
            update: The operation update
        """
        try:
            # Send update to frontend
            if self.proxy_server and hasattr(self.proxy_server, 'send_message_to_frontend'):
                self.proxy_server.send_message_to_frontend({
                    "type": "model-manager",
                    "action": "operation-update",
                    "operation": update
                })
        except Exception as e:
            logger.error(f"Error handling operation update: {str(e)}")
