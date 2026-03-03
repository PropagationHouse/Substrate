"""
Main App Integration - Add this code to your main Substrate application

Instructions:
1. Copy this code into your main application (proxy_server.py)
2. Add the following line to your main application's startup code:
   start_command_pipe_server(agent)
"""

import os
import sys
import json
import threading
import time
import logging
import traceback
import queue
import uuid

# Import the chat capture utility
try:
    from chat_capture import install_capture_hook, get_last_message
    chat_capture_available = True
    print("Chat capture utility available")
except ImportError:
    chat_capture_available = False
    print("Chat capture utility not available")
    
# Import the response notifier
try:
    from response_notifier import install_response_notifier
    response_notifier_available = True
    print("Response notifier available")
except ImportError:
    response_notifier_available = False
    print("Response notifier not available")

# Try to import the win32 modules
try:
    import win32pipe
    import win32file
    import win32api
    import win32event
    import pywintypes
    win32_available = True
except ImportError:
    win32_available = False
    print("Warning: win32 modules not available. Command pipe will not work.")

# Named pipe constants
PIPE_NAME = r'\\.\pipe\SubstrateCommandPipe'
BUFFER_SIZE = 64 * 1024  # 64KB buffer

def create_command_server_pipe():
    """Create a named pipe server for the main Substrate process"""
    if not win32_available:
        return None
        
    try:
        pipe = win32pipe.CreateNamedPipe(
            PIPE_NAME,
            win32pipe.PIPE_ACCESS_DUPLEX,
            win32pipe.PIPE_TYPE_MESSAGE | win32pipe.PIPE_READMODE_MESSAGE | win32pipe.PIPE_WAIT,
            1, BUFFER_SIZE, BUFFER_SIZE,
            0, None
        )
        print(f"Created command pipe server: {PIPE_NAME}")
        return pipe
    except Exception as e:
        print(f"Error creating command pipe: {e}")
        return None

def wait_for_connection(pipe):
    """Wait for a client to connect to the pipe"""
    if not win32_available:
        return False
        
    try:
        print("Waiting for client connection...")
        win32pipe.ConnectNamedPipe(pipe, None)
        print("Client connected to pipe")
        return True
    except Exception as e:
        print(f"Error waiting for connection: {e}")
        return False

def receive_command_from_pipe(pipe):
    """Receive a command from the named pipe"""
    if not win32_available:
        return None
        
    try:
        # Read the command
        print("Waiting for command...")
        result, data = win32file.ReadFile(pipe, BUFFER_SIZE)
        command_data = data.decode('utf-8')
        
        # Parse the command
        try:
            command = json.loads(command_data)
            print(f"Received command: {command}")
            return command
        except json.JSONDecodeError as e:
            print(f"Error parsing command: {e}")
            return None
    except Exception as e:
        print(f"Error receiving command from pipe: {e}")
        return None

def send_response_to_pipe(pipe, response):
    """Send a response to the named pipe"""
    if not win32_available:
        return False
        
    try:
        # Prepare the response data
        response_data = json.dumps(response).encode('utf-8')
        
        # Send the response
        print(f"Sending response to pipe: {response}")
        win32file.WriteFile(pipe, response_data)
        return True
    except Exception as e:
        print(f"Error sending response to pipe: {e}")
        return False

def command_pipe_server_loop(pipe, agent):
    """Main loop for the command pipe server"""
    if not win32_available:
        return
        
    try:
        while True:
            # Wait for a client to connect
            if not wait_for_connection(pipe):
                print("Failed to connect to client")
                time.sleep(1)
                continue
            
            # Receive the command
            command_data = receive_command_from_pipe(pipe)
            if not command_data:
                print("Failed to receive command")
                try:
                    win32pipe.DisconnectNamedPipe(pipe)
                except:
                    pass
                continue
            
            # Process the command
            try:
                command = command_data.get('command', '')
                print(f"Processing command: {command}")
                
                # Install the chat capture hook if available
                original_method = None
                if chat_capture_available and hasattr(agent, 'send_message_to_frontend'):
                    print("Installing chat capture hook")
                    # Save the original method
                    original_method = agent.send_message_to_frontend
                    # Install the hook
                    install_capture_hook(agent)
                
                # Process the message through the agent
                print(f"Processing message through agent: {command}")
                response = agent.process_message({'text': command})
                print(f"Direct response from process_message: {response}")
                
                # If we didn't get a direct response, try to get the captured message
                if (response is None or response == '') and chat_capture_available:
                    print("No direct response, checking for captured messages")
                    # Wait a moment for any async responses to be processed
                    time.sleep(0.5)
                    # Get the last captured message
                    captured_message = get_last_message(timeout=2)
                    if captured_message:
                        print(f"Found captured message: {captured_message}")
                        response = captured_message
                    else:
                        print("No captured message found")
                
                # Restore the original method if we replaced it
                if original_method and hasattr(agent, 'send_message_to_frontend'):
                    print("Restoring original send_message_to_frontend method")
                    agent.send_message_to_frontend = original_method
                
                # If we still don't have a response, create a default one
                if response is None or response == '':
                    print("No response from agent, creating default response")
                    
                    # Try to get the chat context from the agent
                    chat_context = None
                    if hasattr(agent, 'chat_context') and agent.chat_context:
                        print("Found chat_context in agent")
                        chat_context = agent.chat_context
                    elif hasattr(agent, 'context') and agent.context:
                        print("Found context in agent")
                        chat_context = agent.context
                    elif hasattr(agent, 'messages') and agent.messages:
                        print("Found messages in agent")
                        chat_context = agent.messages
                    
                    response = {
                        'status': 'error',
                        'result': 'No response generated.',
                        'messages': [
                            {'role': 'user', 'content': command},
                            {'role': 'assistant', 'content': 'No response generated.'}
                        ]
                    }
                    
                    # Add chat context if available
                    if chat_context:
                        response['chat_context'] = chat_context
                        print(f"Added chat context to response: {len(chat_context)} items")
                    else:
                        print("No chat context found in agent")
                
                # Format the response for the client
                # Make sure we're returning the full response structure
                if isinstance(response, dict):
                    # If it's already a dict, use it directly but ensure it has all needed fields
                    formatted_response = response.copy()  # Make a copy to avoid modifying the original
                    
                    # Log the response structure
                    print(f"Response structure keys: {list(formatted_response.keys())}")
                    
                    # Extract the assistant's message if available
                    assistant_message = None
                    if 'messages' in formatted_response:
                        for msg in reversed(formatted_response.get('messages', [])):
                            if msg.get('role') == 'assistant':
                                assistant_message = msg.get('content', '')
                                print(f"Found assistant message: {assistant_message[:100]}...")
                                break
                    
                    # Make sure it has a result field
                    if 'result' not in formatted_response and assistant_message:
                        formatted_response['result'] = assistant_message
                        print(f"Added result from assistant message: {assistant_message[:100]}...")
                    elif 'result' not in formatted_response:
                        # If no result and no assistant message, use a default
                        formatted_response['result'] = 'Command executed successfully'
                        print("Added default result text")
                    
                    # Make sure it has a status field
                    if 'status' not in formatted_response:
                        formatted_response['status'] = 'success'
                        print("Added success status")
                    
                    # Determine if this is a chat or command response
                    is_chat_response = False
                    
                    # Check if this looks like a chat response
                    if 'messages' in formatted_response:
                        is_chat_response = True
                        print("Detected chat response based on messages field")
                    elif 'result' in formatted_response and isinstance(formatted_response['result'], str) and len(formatted_response['result']) > 50:
                        # Longer responses are likely chat responses
                        is_chat_response = True
                        print("Detected chat response based on result length")
                    
                    # Make sure it has type and is_command fields
                    if 'type' not in formatted_response:
                        if is_chat_response:
                            formatted_response['type'] = 'chat'
                            print("Added chat type")
                        else:
                            formatted_response['type'] = 'command'
                            print("Added command type")
                    
                    if 'is_command' not in formatted_response:
                        formatted_response['is_command'] = not is_chat_response
                        print(f"Added is_command flag: {not is_chat_response}")
                else:
                    # If it's not a dict, create a simple response structure
                    response_text = str(response) if response is not None else 'Command executed successfully'
                    print(f"Creating new response structure with text: {response_text[:100]}...")
                    
                    # Determine if this is likely a chat response based on length
                    is_chat_response = len(response_text) > 50 and not response_text.startswith('Command executed')
                    
                    formatted_response = {
                        'status': 'success',
                        'result': response_text,
                        'type': 'chat' if is_chat_response else 'command',
                        'is_command': not is_chat_response,
                        'messages': [
                            {'role': 'user', 'content': command},
                            {'role': 'assistant', 'content': response_text}
                        ] if is_chat_response else []
                    }
                    
                    print(f"Created response structure with type: {formatted_response['type']}")
                    print(f"Is command: {formatted_response['is_command']}")
                    
                
                # Log the final formatted response
                print(f"Final formatted response: {formatted_response}")
                
                # Send the response back to the client
                response_data = {
                    'status': 'success',
                    'response': formatted_response
                }
                send_response_to_pipe(pipe, response_data)
            except Exception as e:
                print(f"Error processing command: {e}")
                traceback.print_exc()
                error_response = {
                    'status': 'error',
                    'message': f'Error processing command: {str(e)}'
                }
                send_response_to_pipe(pipe, error_response)
            
            # Disconnect the pipe
            try:
                win32pipe.DisconnectNamedPipe(pipe)
            except:
                pass
    except Exception as e:
        print(f"Error in command pipe server loop: {e}")
        traceback.print_exc()
    finally:
        try:
            win32file.CloseHandle(pipe)
        except:
            pass

def start_command_pipe_server(agent):
    """Start the command pipe server in the main Substrate process"""
    if not win32_available:
        print("Cannot start command pipe server: win32 modules not available")
        return False
        
    try:
        # Install the response notifier if available
        if response_notifier_available:
            print("Installing response notifier on agent")
            install_response_notifier(agent)
            print("Response notifier installed")
        
        # Create the pipe
        pipe = create_command_server_pipe()
        if not pipe:
            print("Failed to create command pipe")
            return False
        
        # Start the server loop in a separate thread
        server_thread = threading.Thread(target=command_pipe_server_loop, args=(pipe, agent))
        server_thread.daemon = True
        server_thread.start()
        print("Command pipe server started")
        return True
    except Exception as e:
        print(f"Error starting command pipe server: {e}")
        traceback.print_exc()
        return False

# Example usage in main application:
# if __name__ == "__main__":
#     # Start the command pipe server
#     start_command_pipe_server(agent)
