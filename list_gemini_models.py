
import google.generativeai as genai

# Assuming API key is set as an environment variable or configured otherwise
# If not, you might need to pass it directly: genai.configure(api_key="YOUR_API_KEY")

try:
    for model in genai.list_models():
        print(model.name)
except Exception as e:
    print(f"Error listing models: {e}")
