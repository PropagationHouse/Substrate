# Tiny Pirate Configuration Panel Guide

This guide explains how to use Tiny Pirate's radial configuration panel to customize your agent's behavior, appearance, and capabilities.

## Accessing the Config Panel

To open the configuration panel:

1. Click the **Settings** icon in the top-right corner of the Tiny Pirate interface
2. The futuristic radial menu will appear with multiple configuration sections

## Navigating the Config Panel

The config panel uses a 3D radial interface with multiple navigation methods:

- **Arrow Buttons**: Click the ◀ and ▶ buttons to rotate between sections
- **Keyboard Navigation**: Use arrow keys (←/→ or ↑/↓) to move between sections
- **Mouse Wheel**: Scroll to rotate the wheel
- **Indicator Dots**: Click on the dots at the bottom to jump to a specific section
- **Drag Navigation**: Click and drag horizontally to rotate the wheel
- **Close Button**: Click the × in the top-right corner to close the panel

## Configuration Sections

The config panel contains six main sections, each controlling different aspects of Tiny Pirate:

### 1. Agent & Model

This section controls the agent's appearance and the AI model used for responses.

#### Agent Avatar
- **Choose Avatar**: Click to upload a custom image for your agent
- **Recommended Size**: 64x64 pixels or larger

#### Model Selection
- Click the dropdown to select from available AI models:
  - `llama4:16x17b`: Most powerful general-purpose model
  - `qwen2.5-coder:14b`: Specialized for coding tasks
  - `llama3.2-vision:11b`: Vision-capable model for image analysis
  - `dolphin-mixtral`: Balanced performance and capabilities
  - `dolphin-mistral:7b`: Faster, more efficient model
  - `dolphin3:8b`: Alternative balanced model

### 2. System Prompt

This section configures the foundation of how the agent behaves and responds.

- **System Prompt**: Edit the text that defines the agent's personality, capabilities, and behavior
- Changes to the system prompt will affect all future interactions with the agent
- Use this to make your agent more formal, casual, creative, or technical

### 3. Screenshot Prompt

This section determines how the agent responds when analyzing screenshots.

- **Screenshot Prompt**: Edit the text that guides how the agent interprets and responds to images
- Customize this to make the agent focus on specific aspects of screenshots
- Example: "Describe what you see in detail" vs. "Identify any text visible in the image"

### 4. Note Creation

This section controls how Tiny Pirate creates and formats notes.

#### YouTube Transcript Analysis
- **Analysis Prompt**: Configure how YouTube transcripts are analyzed and formatted into notes
- More detailed prompts will result in more comprehensive notes

#### General Note Creation
- **Enable Note Creation**: Toggle automatic note creation on/off
- **Minimum Interval**: Set the minimum time between automatic notes (seconds)
- **Maximum Interval**: Set the maximum time between automatic notes (seconds)

### 5. Autonomy Settings

This section controls the agent's autonomous behaviors, allowing it to act without explicit prompting.

#### Screen Observation
- **Enable**: Toggle automatic screenshot analysis on/off
- **Min/Max Interval**: Set the time range between automatic screenshots (seconds)
- **Screenshot Prompt**: Customize how the agent responds to autonomous screenshots

#### Autonomous Messages
- **Enable**: Toggle unprompted messages on/off
- **Min/Max Interval**: Set the time range between autonomous messages (seconds)
- **Message Prompt**: Guide what kinds of messages the agent sends autonomously

#### Autonomous Suggestions
- **Enable**: Toggle unprompted suggestions on/off
- **Min/Max Interval**: Set the time range between suggestions (seconds)

#### Midjourney Integration
- **Enable**: Toggle automatic image generation on/off
- **Min/Max Interval**: Set the time range between image generations (seconds)
- **Prompt**: Guide what kinds of images are generated
- **System Prompt**: Configure technical aspects of image generation

#### Autonomous Notes
- **Enable**: Toggle automatic note creation on/off
- **Min/Max Interval**: Set the time range between notes (seconds)
- **Note Prompt**: Configure how autonomous notes are created

### 6. API Settings

This section configures the connection to the AI model service.

- **API URL**: The endpoint for the language model service (default: http://localhost:11434/api/generate)
- **API Key**: Optional authentication key for the model provider
- **Temperature**: Slider to control response randomness (lower = more deterministic, higher = more creative)

## Saving Changes

Changes made in the config panel are automatically saved when you:

1. Edit any text field or change any setting
2. Upload a new avatar image
3. Select a different AI model

There's no need to click a save button - all changes take effect immediately.

## Best Practices

- **System Prompt**: Keep it concise but descriptive. Focus on personality traits and core capabilities.
- **Model Selection**: Use larger models (llama4, qwen2.5) for complex tasks, smaller models for speed.
- **Autonomy Settings**: Start with longer intervals and adjust based on how frequently you want the agent to act independently.
- **Temperature**: Use lower values (0.1-0.3) for factual responses, higher values (0.7-0.9) for creative content.

## Troubleshooting

- **Panel Not Opening**: Refresh the application and try again
- **Changes Not Saving**: Check that you have write permissions to the config.json file
- **Model Not Available**: Ensure the selected model is installed in your Ollama instance
- **Avatar Not Displaying**: Try a different image format (PNG or JPG recommended)
