#!/usr/bin/env python3
"""
Image Processor for Substrate
Handles image processing for chat messages with images
"""

import sys
import json
import base64
import logging
import traceback
import requests
from io import BytesIO
from PIL import Image

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('image_processor')

# Define the vision model API endpoint
VISION_MODEL_ID = "llama3.2-vision:11b"
VISION_API_ENDPOINT = "http://localhost:11434/api/generate"

def analyze_image_with_llm(image_base64, prompt_text):
    """
    Send the image to the Llama 3.2 Vision model for analysis
    
    Args:
        image_base64 (str): Base64 encoded image data
        prompt_text (str): Text prompt to send with the image
        
    Returns:
        str: Model's response text
    """
    try:
        # Prepare the prompt for the vision model
        if not prompt_text:
            prompt_text = "Describe this image in detail. What do you see?"
        
        # Format the request payload for Ollama API - match the format used in proxy_server.py
        payload = {
            "model": VISION_MODEL_ID,
            "prompt": prompt_text,
            "stream": False,
            "options": {
                # Encourage maximum GPU offload
                "num_gpu": 999,
                # Keep generations concise to avoid tail degeneracy
                "num_predict": 96,
                # Reduce repetition/looping
                "repeat_penalty": 1.18,
                "repeat_last_n": 256,
                "presence_penalty": 0.25,
                "frequency_penalty": 0.1,
                # Mild sampling constraints for stable outputs
                "temperature": 0.7,
                "top_p": 0.9
            }
        }
        
        # Add image to payload in the correct format
        payload["images"] = [image_base64]
        
        logger.info(f"Sending image to vision model: {VISION_MODEL_ID}")
        
        # Make the API request
        response = requests.post(VISION_API_ENDPOINT, json=payload)
        response.raise_for_status()
        
        # Parse the response
        result = response.json()
        return result.get('response', "No response from vision model")
        
    except Exception as e:
        logger.error(f"Error analyzing image with vision model: {e}")
        return f"Error analyzing image: {str(e)}"

def process_image(image_data, text=""):
    """
    Process an image from base64 data
    
    Args:
        image_data (str): Base64 encoded image data
        text (str): Optional text accompanying the image
        
    Returns:
        dict: Response with processed image and status
    """
    try:
        # Extract base64 string if it includes the data URL prefix
        if isinstance(image_data, str) and ',' in image_data:
            img_str = image_data.split(',', 1)[1]
        else:
            img_str = image_data
            
        # Decode the base64 image
        image_bytes = base64.b64decode(img_str)
        
        # Open the image with PIL
        with Image.open(BytesIO(image_bytes)) as img:
            # Get image details
            width, height = img.size
            format_name = img.format
            mode = img.mode
            
            logger.info(f"Processed image: {width}x{height} {format_name} {mode}")
            
            # Send the image to the vision model for analysis
            analysis_result = analyze_image_with_llm(img_str, text)
            
            # Return success response with the original image data and analysis
            return {
                "status": "success",
                "result": analysis_result,
                "image_details": {
                    "width": width,
                    "height": height,
                    "format": format_name,
                    "mode": mode
                },
                "image": f"data:image/{format_name.lower()};base64,{img_str}",
                "text": text,
                "clear_thinking": True
            }
    
    except Exception as e:
        logger.error(f"Error processing image: {e}")
        logger.error(traceback.format_exc())
        return {
            "status": "error",
            "result": f"Error processing image: {str(e)}",
            "clear_thinking": True
        }

def main():
    """
    Main function to handle stdin input and process images
    """
    try:
        # Read input from stdin
        input_data = sys.stdin.read().strip()
        
        # Parse the JSON input
        data = json.loads(input_data)
        
        # Extract text and image
        text = data.get('text', '').strip()
        image_data = data.get('image')
        
        if not image_data:
            result = {
                "status": "error",
                "result": "No image data provided",
                "clear_thinking": True
            }
        else:
            # Process the image
            result = process_image(image_data, text)
        
        # Output the result as JSON
        print(json.dumps(result))
        sys.stdout.flush()
        
    except Exception as e:
        logger.error(f"Error in main function: {e}")
        logger.error(traceback.format_exc())
        
        # Return error response
        error_response = {
            "status": "error",
            "result": f"Error processing request: {str(e)}",
            "clear_thinking": True
        }
        print(json.dumps(error_response))
        sys.stdout.flush()

if __name__ == "__main__":
    main()
