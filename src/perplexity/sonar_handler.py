"""
Perplexity Sonar API Handler
Provides functionality to query the Perplexity Sonar API for up-to-date information
"""
import os
import json
import requests
import time
from datetime import datetime


class SonarHandler:
    """Handler for Perplexity Sonar API integration"""
    
    def __init__(self, api_key=None, config=None):
        """Initialize the Sonar API handler with API key and configuration"""
        self.api_key = api_key
        self.config = config or {}
        self.endpoint = "https://api.perplexity.ai/chat/completions"
        self.default_model = "sonar"  # Use current Perplexity model name
        self.last_request_time = 0
        self.min_request_interval = 1.0  # Minimum seconds between requests to avoid rate limiting
        
        # Load API key from config if not provided
        if not self.api_key and config and 'perplexity_api_key' in config:
            self.api_key = config['perplexity_api_key']
        
        # Load API key from environment variable if still not found
        if not self.api_key:
            self.api_key = os.environ.get('PERPLEXITY_API_KEY', '')
        
        # Strip any whitespace from the API key
        if self.api_key:
            self.api_key = self.api_key.strip()
            
        self.is_configured = bool(self.api_key)
        
        # Sonar handler initialized
        
    def get_sonar_response(self, query, model=None, temperature=0.7, max_tokens=1024, 
                          search_focus=None, should_cite=True):
        """
        Query the Perplexity Sonar API for information
        
        Args:
            query (str): The query or question to ask
            model (str): The Sonar model to use (sonar-medium-online, sonar-small-online, etc.)
            temperature (float): Controls randomness of the output (0.0 to 1.0)
            max_tokens (int): Maximum tokens to generate in the response
            search_focus (list): Optional list of domains to focus the search on
            should_cite (bool): Whether to include citations in the response
            
        Returns:
            dict: The parsed JSON response from the API or an error message
        """
        # Rate limiting check
        current_time = time.time()
        time_since_last_request = current_time - self.last_request_time
        if time_since_last_request < self.min_request_interval:
            time.sleep(self.min_request_interval - time_since_last_request)
        
        # Check if API is configured
        if not self.is_configured:
            return {
                'error': 'Perplexity API key not configured',
                'message': 'Please set your Perplexity API key in the configuration'
            }
        
        # Use specified model or default - ensure we're using a valid model name
        model = model or self.config.get('perplexity_model', self.default_model)
        
        # Make sure we're using a valid model name (updated for current Perplexity API)
        valid_models = ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro"]
        if model not in valid_models:
            model = self.default_model  # Fall back to 'sonar'
        
        # Construct the system message to control output format and behavior
        system_message = (
            "You are a helpful assistant that provides accurate, up-to-date information. "
            "Be concise but thorough."
        )
        
        # Add citation instruction if requested
        if should_cite:
            system_message += " Include relevant citations for your information."
        
        # Create the request payload according to the API documentation
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_message},
                {"role": "user", "content": query}
            ],
            "temperature": temperature,
            "max_tokens": max_tokens
        }
        
        # Add search focus if provided
        if search_focus:
            payload["search_domain_filter"] = {
                "type": "include",
                "domains": search_focus if isinstance(search_focus, list) else [search_focus]
            }
        
        headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "authorization": f"Bearer {self.api_key}"
        }
        
        try:
            # Log minimal request details to avoid terminal flooding
            # Sending Sonar request
            
            # Make the API request
            self.last_request_time = time.time()
            response = requests.post(self.endpoint, json=payload, headers=headers, timeout=15)
            
            # Log minimal response status for debugging
            # Response received
            
            # Write detailed logs to file instead of terminal
            try:
                log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..\\..\\logs")
                os.makedirs(log_dir, exist_ok=True)
                log_file = os.path.join(log_dir, f"sonar_api_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")
                
                with open(log_file, 'w', encoding='utf-8') as f:
                    f.write(f"Request to: {self.endpoint}\n")
                    f.write(f"Headers: {str(headers)}\n")
                    f.write(f"Payload: {json.dumps(payload, indent=2)}\n\n")
                    f.write(f"Response status: {response.status_code}\n")
                    f.write(f"Response headers: {dict(response.headers)}\n\n")
                    f.write(f"Response content: {response.text[:1000]}\n")
                
                pass  # Logs written
            except Exception as log_error:
                pass  # Log write failed
                # Continue with the API response processing even if logging fails
            
            # Check for HTTP errors
            if response.status_code != 200:
                error_message = f"API request failed with status code {response.status_code}"
                try:
                    error_data = response.json()
                    if 'error' in error_data:
                        error_message += f": {error_data['error']}"
                except:
                    error_message += f": {response.text[:200]}"
                
                return {
                    'error': error_message,
                    'status_code': response.status_code,
                    'raw_response': response.text[:500]  # Limit response size
                }
            
            # Parse the response
            result = response.json()
            
            # Extract the actual response text
            if 'choices' in result and result['choices']:
                content = result['choices'][0]['message']['content']
                return {
                    'success': True,
                    'content': content,
                    'meta': {
                        'model': model,
                        'timestamp': datetime.now().isoformat(),
                        'query': query
                    }
                }
            else:
                return {
                    'error': 'No content in response',
                    'raw_response': result
                }
                
        except requests.exceptions.RequestException as e:
            print(f"[ERROR] Perplexity API request failed: {str(e)}")
            return {
                'error': f'API request failed: {str(e)}',
                'details': str(e)
            }
        except json.JSONDecodeError as e:
            print(f"[ERROR] Failed to parse Perplexity API response: {str(e)}")
            return {
                'error': 'Failed to parse API response',
                'raw_response': response.text[:500] if 'response' in locals() else 'No response'
            }
        except Exception as e:
            print(f"[ERROR] Unexpected error in Perplexity API call: {str(e)}")
            return {
                'error': f'Unexpected error: {str(e)}',
                'details': str(e)
            }
    
    def detect_information_seeking_query(self, text):
        """
        Detect if a query is likely seeking factual or up-to-date information
        
        NOTE: This method has been disabled to ensure Sonar is only triggered by explicit commands
        in the first five words of a query. It now always returns False.
        
        Args:
            text (str): Query to analyze
            
        Returns:
            bool: Always False - automatic detection is disabled
        """
        # This method is now disabled - we only use explicit commands in the first five words
        # to trigger Sonar searches, not automatic detection
        # Info query detection disabled
        return False
