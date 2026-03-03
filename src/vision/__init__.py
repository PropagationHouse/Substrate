"""Vision client handler for processing XGO camera images."""

import logging
import base64
import threading
import json
from io import BytesIO
from PIL import Image
from flask import request, jsonify

logger = logging.getLogger(__name__)

class VisionClientHandler:
    def __init__(self, chat_agent):
        """Initialize the VisionClientHandler with a chat agent."""
        self.chat_agent = chat_agent
        self.vision_prompt = "This is your POV through your palm sized robotic body as you roll & stand about on two wheels. Make jokes, puns & comments about what you see in 8 words or less. Do not dryly analyze the room, speak as though you are right there yourself without making it a visual report."
        logger.info("Vision client handler initialized")
    
    def handle_request(self):
        """Handle HTTP request for vision client image analysis."""
        try:
            # Get data from request
            data = request.get_json()
            if not data:
                return jsonify({"status": "error", "result": "No data provided"}), 400
            
            # Extract image, prompt, and model
            image_data = data.get('image')
            prompt = data.get('prompt', self.vision_prompt)
            model = data.get('model', 'llama3.2-vision:11b')
            
            if not image_data:
                return jsonify({"status": "error", "result": "No image data provided"}), 400
            
            # Process the image
            result = self.process_image(image_data, prompt, model)
            
            # Return the result
            return jsonify(result)
            
        except Exception as e:
            logger.error(f"Error handling vision client request: {e}")
            return jsonify({
                "status": "error",
                "result": f"Error processing request: {e}"
            }), 500
        
    def process_image(self, image_data, prompt=None, model=None):
        """Process an image from the vision client.
        
        Args:
            image_data (str): Base64 encoded image data
            prompt (str, optional): Custom prompt to use. Defaults to None.
            model (str, optional): Model to use for analysis. Defaults to None.
            
        Returns:
            dict: Response from the chat agent
        """
        try:
            # Use the provided prompt or the default vision prompt
            prompt_text = prompt or self.vision_prompt
            
            # Extract base64 string if it includes the data URL prefix
            if isinstance(image_data, str) and ',' in image_data:
                img_str = image_data.split(',', 1)[1]
            else:
                img_str = image_data
            
            # Create messages for the vision client
            messages = [
                {
                    "role": "system",
                    "content": prompt_text
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_str}"}}
                    ]
                }
            ]
            
            # Process the image
            logger.info("Sending vision client image to chat...")
            response = self.chat_agent.chat_response(
                prompt_text,
                image_data=f"data:image/jpeg;base64,{img_str}",
                override_messages=messages,
                model_override=model
            )
            
            return response
            
        except Exception as e:
            logger.error(f"Error processing vision client image: {e}")
            return {
                "status": "error",
                "result": f"Error processing image: {e}",
                "speak": False
            }
