
import requests

try:
    response = requests.get("https://jsonplaceholder.typicode.com/todos/1")
    response.raise_for_status()  # Raise an exception for bad status codes
    data = response.json()
    print(data)
except requests.exceptions.RequestException as e:
    print(f"Error fetching JSON: {e}")
except Exception as e:
    print(f"An unexpected error occurred: {e}")
