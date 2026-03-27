import os
from flask import Flask, render_template, request, jsonify
from openai import OpenAI

app = Flask(__name__)

# Initialize OpenAI client (requires OPENAI_API_KEY env var)
try:
    client = OpenAI()
    has_openai = True
except Exception as e:
    has_openai = False
    print(f"OpenAI initialization failed: {e}")

SYSTEM_PROMPT = """You are the IBA Master Agent, an expert in International Bartenders Association (IBA) standards.
Your knowledge is strictly bound to IBA specs, the golden rules of cocktail building (e.g., stir spirit-forward, shake citrus-forward), and chronological build orders.
Answer questions directly, concisely, and with a tone of a seasoned, high-end bartender.
If a user asks for measurements, provide them in both oz and ml (1 oz = 30 ml)."""

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/chat', methods=['POST'])
def chat():
    if not has_openai:
        return jsonify({"reply": "[SYSTEM] OpenAI API key not found. Please set OPENAI_API_KEY environment variable."})
    
    user_message = request.json.get('message', '')
    if not user_message:
        return jsonify({"reply": "I need a question to answer, friend."})
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message}
            ],
            max_tokens=250,
            temperature=0.7
        )
        reply = response.choices[0].message.content
        return jsonify({"reply": reply})
    except Exception as e:
        return jsonify({"reply": f"[ERROR] {str(e)}"})

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)
