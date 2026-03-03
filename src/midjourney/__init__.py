import random
import time
import logging
import traceback
import requests
from threading import Thread, Event

logger = logging.getLogger(__name__)

class MidjourneyHandler:
    def __init__(self, proxy_server):
        """Initialize Midjourney handler"""
        self.proxy_server = proxy_server
        self.running = False
        self.thread = None
        self.stop_event = Event()  # Add an event to gracefully stop the thread
    
    def start(self):
        """Start the autonomous Midjourney generation thread"""
        if not self.running:
            self.running = True
            self.thread = Thread(target=self._run_loop, daemon=True)
            self.thread.start()
            logger.info("Started Midjourney handler thread")
    
    def stop(self):
        """Stop the Midjourney generation thread"""
        self.running = False
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=2.0)  # Add timeout to avoid blocking
    
    def _run_loop(self):
        """Main loop for autonomous Midjourney generation"""
        logger.debug("[MIDJOURNEY] Starting autonomous loop")
        while self.running:
            try:
                # Get current config
                config = self.proxy_server.config.get('autonomy', {}).get('midjourney', {})
                enabled = config.get('enabled', False)
                
                # Convert to boolean explicitly to handle string values like "false"
                if isinstance(enabled, str):
                    enabled = enabled.lower() == "true"
                
                if not enabled:
                    time.sleep(10)  # Sleep longer when disabled
                    continue
                
                # Get intervals from config
                min_interval = int(config.get('min_interval', 300))
                max_interval = int(config.get('max_interval', 900))
                
                logger.debug(f"[MIDJOURNEY] intervals: min={min_interval}s, max={max_interval}s")
                
                # Wait for a random time between min and max interval
                wait_time = random.uniform(min_interval, max_interval)
                logger.debug(f"[MIDJOURNEY] Waiting {wait_time:.0f}s")
                
                # Use a loop with small sleeps to allow for graceful shutdown
                start_time = time.time()
                while time.time() - start_time < wait_time and self.running:
                    time.sleep(1.0)  # Sleep in 1-second increments
                    
                # Check if we're still running after the wait
                if not self.running:
                    logger.debug("[MIDJOURNEY] Loop stopped")
                    break
                    
                logger.debug("[MIDJOURNEY] Generating prompt")
                
                # Generate and execute prompt
                prompt_template = config.get('prompt', "Create an imaginative and creative image prompt.")
                system_prompt = config.get('system_prompt', "Always start with 'imagine'. Place all technical photography terms (f-stops, focal lengths) at the end of your description, right before the aspect ratio. The prompt should end in this exact order: [creative description], [f-stop], [focal length] --ar [ratio]. Example: 'imagine neon-lit street market in rain, steam rising from vents, cyberpunk aesthetic, f/1.4, 35mm --ar 16:9'. Do not use --art, only use --ar. Never include explanatory text.")
                logger.info("Generating new Midjourney prompt...")
                
                override_messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Generate a creative and unique Midjourney prompt inspired by this theme: {prompt_template}. Create something new and imaginative, don't just repeat the theme. Output ONLY the prompt, nothing else."}
                ]
                
                # Call the LLM to generate a creative prompt based on the theme
                logger.info("[MIDJOURNEY_AUTONOMOUS] Calling LLM to generate creative prompt from theme")
                
                try:
                    # Use the proxy server's LLM to generate a new prompt
                    response = self.proxy_server.call_llm_sync(override_messages)
                    
                    if response and response.get('content'):
                        generated_prompt = response['content'].strip()
                        logger.info(f"[MIDJOURNEY_AUTONOMOUS] LLM generated prompt: {generated_prompt}")
                    else:
                        # Fallback to theme if LLM fails
                        logger.warning("[MIDJOURNEY_AUTONOMOUS] LLM returned empty, using theme as fallback")
                        generated_prompt = prompt_template
                except Exception as llm_error:
                    logger.error(f"[MIDJOURNEY_AUTONOMOUS] LLM call failed: {llm_error}, using theme as fallback")
                    generated_prompt = prompt_template
                
                # Make sure the prompt starts with 'imagine'
                if not generated_prompt.lower().startswith('imagine ') and not generated_prompt.lower().startswith('/imagine '):
                    prompt = f"imagine {generated_prompt}"
                else:
                    prompt = generated_prompt
                    
                logger.info(f"[MIDJOURNEY_AUTONOMOUS] Final prompt: {prompt}")
                
                # Create a response object to maintain compatibility with the rest of the code
                response = {"content": prompt}
                
                # Skip the response check since we're using a direct prompt
                if response and 'content' in response:
                    prompt = response['content'].strip()
                    logger.info(f"Generated Midjourney prompt: {prompt}")
                    
                    # Process the prompt using the same command parser and executor that handles manual commands
                    # This ensures consistent behavior between autonomous and manual commands
                    
                    # Make sure the prompt starts with 'imagine' to trigger the command parser
                    if not prompt.lower().startswith('imagine ') and not prompt.lower().startswith('/imagine '):
                        prompt = f"imagine {prompt}"
                        logger.info(f"Added 'imagine' prefix to prompt: {prompt}")
                    
                    logger.info(f"[MIDJOURNEY_AUTONOMOUS] Routing prompt through command parser: {prompt}")
                    
                    try:
                        # Use the command parser to parse the command
                        from src.commands.command_parser import CommandParser
                        from src.commands.command_executor import CommandExecutor
                        
                        logger.info("[MIDJOURNEY_AUTONOMOUS] Creating CommandParser instance")
                        command_parser = CommandParser()
                        
                        logger.info(f"[MIDJOURNEY_AUTONOMOUS] Parsing command: {prompt}")
                        command_info = command_parser.parse(prompt)
                        
                        logger.info(f"[MIDJOURNEY_AUTONOMOUS] Parsed command info: {command_info}")
                        
                        if command_info:
                            logger.info(f"[MIDJOURNEY_AUTONOMOUS] Command type: {command_info.get('type')}, source: {command_info.get('source')}")
                        
                        if command_info and command_info.get('source') == 'midjourney':
                            # Create a new command executor instance directly
                            logger.info("[MIDJOURNEY_AUTONOMOUS] Creating CommandExecutor instance")
                            command_executor = CommandExecutor()
                            
                            # Set the config from proxy server to ensure consistent behavior
                            if hasattr(self.proxy_server, 'config'):
                                logger.info("[MIDJOURNEY_AUTONOMOUS] Setting config for CommandExecutor")
                                command_executor.set_config(self.proxy_server.config)
                            
                            # Execute the command using the same path as manual commands
                            logger.info(f"[MIDJOURNEY_AUTONOMOUS] Executing command: {command_info}")
                            result = command_executor.execute(command_info)
                            
                            logger.info(f"[MIDJOURNEY_AUTONOMOUS] Command execution result: {result}")
                            
                            if result and result.get('status') == 'success':
                                logger.info("[MIDJOURNEY_AUTONOMOUS] Command executed successfully through command executor")
                                # Add a success message to the chat
                                self.proxy_server.add_message({
                                    'role': 'assistant',
                                    'content': f"🎨 Autonomous Midjourney prompt submitted: {prompt_text if 'prompt_text' in locals() else prompt}"
                                })
                                # Continue the loop instead of returning
                                continue
                            else:
                                logger.warning(f"[MIDJOURNEY_AUTONOMOUS] Command execution failed: {result}")
                    except Exception as e:
                        logger.error(f"[MIDJOURNEY_AUTONOMOUS] Error in command parsing/execution: {str(e)}")
                        logger.error(f"[MIDJOURNEY_AUTONOMOUS] Full error: {traceback.format_exc()}")
                        # Continue to fallback method
                    
                    # If we get here, the command parser or executor didn't handle it properly
                    logger.warning("Command parser/executor didn't handle the command, falling back to direct execution")
                    
                    # Extract the prompt text (remove 'imagine' prefix if present)
                    if prompt.lower().startswith('imagine '):
                        prompt_text = prompt[8:].strip()
                    elif prompt.lower().startswith('/imagine '):
                        prompt_text = prompt[9:].strip()
                    else:
                        prompt_text = prompt
                    
                    try:
                        # Calculate window size (similar to command executor)
                        window_pos = (50, 50, 1067, 840)  # Default from CommandExecutor
                        midjourney_height = int(window_pos[3] * 1.45)  # 45% taller
                        midjourney_window = (
                            window_pos[0],  # x
                            window_pos[1],  # y
                            window_pos[2],  # width
                            midjourney_height    # height
                        )
                        
                        # Use a simpler approach with direct URL opening
                        # This is more reliable in background threads
                        import urllib.parse
                        import os
                        import webbrowser
                        
                        # Encode the prompt for URL
                        encoded_prompt = urllib.parse.quote(prompt_text)
                        url = f'https://www.midjourney.com/imagine?prompt={encoded_prompt}'
                        
                        logger.info(f"Opening URL with encoded prompt: {url}")
                        
                        # Try multiple methods to open the browser
                        # Method 1: Use os.startfile with the URL directly
                        try:
                            logger.info("Attempting to open URL with os.startfile")
                            os.startfile(url)
                            time.sleep(1)  # Give it a moment to open
                            logger.info("Successfully opened URL with os.startfile")
                            result = True
                        except Exception as e1:
                            logger.error(f"os.startfile failed: {e1}")
                            
                            # Method 2: Try webbrowser module
                            try:
                                logger.info("Attempting to open URL with webbrowser module")
                                webbrowser.open(url, new=2)  # new=2 forces a new browser window
                                time.sleep(1)  # Give it a moment to open
                                logger.info("Successfully opened URL with webbrowser module")
                                result = True
                            except Exception as e2:
                                logger.error(f"webbrowser.open failed: {e2}")
                                
                                # Method 3: Try with a direct shell command
                                try:
                                    logger.info("Attempting to open URL with direct shell command")
                                    import subprocess
                                    subprocess.run(["cmd", "/c", "start", url], shell=True)
                                    time.sleep(1)  # Give it a moment to open
                                    logger.info("Successfully opened URL with shell command")
                                    result = True
                                except Exception as e3:
                                    logger.error(f"Shell command failed: {e3}")
                                    result = False
                    except Exception as e:
                        logger.error(f"Error launching Edge for Midjourney: {str(e)}")
                        logger.error(f"Full error: {traceback.format_exc()}")
                        result = False
                    
                    logger.info(f"Midjourney automation result: {result}")
                    
                    # Only add a chat message if the browser automation failed
                    # This prevents the prompt from appearing as a chat message when the browser opens successfully
                    if not result:
                        logger.warning("Browser automation failed, sending prompt as chat message instead")
                        self.proxy_server.add_message({
                            'role': 'assistant',
                            'content': f"⚠️ Failed to open Midjourney. Prompt was: {prompt_text}"
                        })
                    else:
                        logger.info("Browser automation successful, not sending chat message")
                
            except Exception as e:
                logger.error(f"[MIDJOURNEY_AUTONOMOUS] Error in Midjourney handler: {str(e)}")
                logger.error(f"[MIDJOURNEY_AUTONOMOUS] Full error: {traceback.format_exc()}")
                logger.error(f"[MIDJOURNEY_AUTONOMOUS] Sleeping for 60 seconds before retry")
                time.sleep(60)  # Sleep for a minute on error
