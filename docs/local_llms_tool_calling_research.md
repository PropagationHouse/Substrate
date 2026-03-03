# Best Local LLMs for Tool Calling (2024)

## Top Performing Models for Local Tool Calling

### 1. **Llama 3.1 70B/8B Instruct** ⭐⭐⭐⭐⭐
- **Strengths**: Native tool calling support, excellent JSON parsing, well-documented
- **Hardware**: 70B needs ~40GB VRAM, 8B runs on 8-16GB
- **Frameworks**: Ollama, llama.cpp, vLLM
- **Tool Format**: OpenAI function calling format
- **Notes**: Meta's official tool calling implementation, very reliable

### 2. **CodeLlama 34B Instruct** ⭐⭐⭐⭐
- **Strengths**: Great for code generation tools, structured output
- **Hardware**: ~20GB VRAM required
- **Frameworks**: Ollama, llama.cpp
- **Tool Format**: Custom JSON schemas work well
- **Notes**: Excellent for programming-related tool calls

### 3. **Mistral 7B Instruct v0.3** ⭐⭐⭐⭐
- **Strengths**: Fast, efficient, good JSON adherence
- **Hardware**: 4-8GB VRAM
- **Frameworks**: Ollama, llama.cpp, Transformers
- **Tool Format**: OpenAI-compatible function calling
- **Notes**: Great balance of speed and capability

### 4. **Hermes 2 Pro (Llama 2/3 base)** ⭐⭐⭐⭐
- **Strengths**: Fine-tuned specifically for tool use and JSON
- **Hardware**: Varies by base model size
- **Frameworks**: Ollama, llama.cpp
- **Tool Format**: Multiple formats supported
- **Notes**: Community favorite for reliable tool calling

### 5. **Qwen 2.5 72B/14B/7B Instruct** ⭐⭐⭐⭐
- **Strengths**: Excellent multilingual tool calling, fast
- **Hardware**: 72B needs ~40GB, 14B needs ~10GB, 7B needs ~4GB
- **Frameworks**: Ollama, llama.cpp, vLLM
- **Tool Format**: OpenAI function calling format
- **Notes**: Alibaba's model, very good at following schemas

### 6. **Llama 3.2 Vision 11B/90B** ⭐⭐⭐⭐⭐
- **Strengths**: **MULTIMODAL** tool calling - can analyze images AND call tools
- **Hardware**: 11B needs ~12GB VRAM, 90B needs ~45GB
- **Frameworks**: Ollama, llama.cpp, Transformers
- **Tool Format**: OpenAI function calling + vision input
- **Notes**: Game-changer for visual tool calling - can analyze screenshots, documents, charts and trigger appropriate tools
- **Unique Capability**: Can look at your screen and decide which tools to call based on what it sees

## Framework Recommendations

### **Ollama** (Easiest Setup)
```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull recommended models
ollama pull llama3.1:8b
ollama pull mistral:7b-instruct
ollama pull qwen2.5:7b-instruct
```

### **llama.cpp** (Most Control)
```bash
# Build from source for optimal performance
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
make LLAMA_CUBLAS=1  # For NVIDIA GPUs
```

### **vLLM** (Best Performance)
```bash
pip install vllm
# Supports batched inference and faster serving
```

## Tool Calling Implementation Patterns

### OpenAI Function Calling Format
```json
{
  "functions": [
    {
      "name": "get_weather",
      "description": "Get weather information",
      "parameters": {
        "type": "object",
        "properties": {
          "location": {"type": "string"},
          "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}
        },
        "required": ["location"]
      }
    }
  ]
}
```

### Custom Schema Approach
```json
{
  "tool_name": "function_name",
  "parameters": {
    "param1": "value1",
    "param2": "value2"
  }
}
```

## Hardware Requirements Summary

| Model Size | VRAM Needed | RAM Needed | Performance Level |
|------------|-------------|------------|-------------------|
| 7B         | 4-8GB       | 8GB        | Good              |
| 13-14B     | 8-12GB      | 16GB       | Very Good         |
| 34B        | 20-24GB     | 32GB       | Excellent         |
| 70B+       | 40-48GB     | 64GB       | Outstanding       |

## Key Success Factors

1. **Prompt Engineering**: Clear, consistent system prompts
2. **Schema Design**: Well-defined JSON schemas
3. **Temperature**: Use 0.1-0.3 for reliable tool calling
4. **Context Management**: Keep tool definitions in context
5. **Error Handling**: Implement retry logic for malformed JSON

## Recommended Starting Setup

For most users starting with local tool calling:
1. **Hardware**: GPU with 8GB+ VRAM
2. **Model**: Llama 3.1 8B or Mistral 7B Instruct
3. **Framework**: Ollama (easiest) or llama.cpp (more control)
4. **Interface**: Use OpenAI-compatible API format

## Testing Your Setup
```python
# Test script for tool calling capability
import requests
import json

def test_tool_calling():
    payload = {
        "model": "llama3.1:8b",
        "messages": [
            {
                "role": "system", 
                "content": "You are a helpful assistant with access to tools."
            },
            {
                "role": "user",
                "content": "What's the weather like in New York?"
            }
        ],
        "functions": [
            {
                "name": "get_weather",
                "description": "Get current weather",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {"type": "string"}
                    },
                    "required": ["location"]
                }
            }
        ]
    }
    
    response = requests.post("http://localhost:11434/api/chat", json=payload)
    return response.json()

# Run test
result = test_tool_calling()
print(json.dumps(result, indent=2))
```

## Performance Benchmarks (Approximate)

| Model | Tool Call Accuracy | Speed (tokens/sec) | Memory Efficient | Special Features |
|-------|-------------------|-------------------|------------------|------------------|
| Llama 3.1 70B | 95% | 20-30 | ❌ | Text-only |
| Llama 3.1 8B | 85% | 80-120 | ✅ | Text-only |
| Llama 3.2 Vision 11B | 90% | 50-70 | ✅ | **Vision + Tools** |
| Llama 3.2 Vision 90B | 98% | 15-25 | ❌ | **Vision + Tools** |
| Mistral 7B | 80% | 90-140 | ✅ | Text-only |
| CodeLlama 34B | 90% | 40-60 | ⚠️ | Code-focused |
| Qwen 2.5 14B | 88% | 60-80 | ✅ | Multilingual |

Last Updated: January 2024