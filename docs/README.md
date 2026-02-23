# Tiny Pirate Documentation

Welcome to the Tiny Pirate documentation. This guide provides comprehensive information about all aspects of the Tiny Pirate system.

## Core Documentation

- [Main README](../README.md) - Overview, setup instructions, and basic usage
- [Setup Guide](../setup.bat) - Setup script for installing dependencies
- [Start Guide](../start.bat) - Instructions for starting the application

## System Components

- [Avatar Animation System](AVATAR_SYSTEM.md) - Detailed documentation of the avatar animation system
- [IPC Communication](IPC_COMMUNICATION.md) - How the Electron frontend and Python backend communicate
- [Voice System](VOICE_SYSTEM.md) - Voice synthesis capabilities and integration
- [Command System](COMMAND_SYSTEM.md) - Natural language command processing
- [Profile System](PROFILE_SYSTEM.md) - User profile management

## Architecture

Tiny Pirate uses a hybrid architecture combining:

1. **Electron Frontend**: 
   - Renders the UI and avatar
   - Handles user interactions
   - Manages animations and visual feedback

2. **Python Backend**:
   - Processes commands and requests
   - Integrates with external systems
   - Manages configuration and profiles
   - Handles voice synthesis

3. **Local LLM Integration**:
   - Connects to Ollama for AI capabilities
   - Processes natural language
   - Generates responses and content

4. **IPC Bridge**:
   - Enables bidirectional communication between components
   - Synchronizes state across the system

## Development Guide

### Project Structure

```
tiny-pirate/
├── main.js                 # Electron main process
├── preload.js              # IPC bridge
├── index.html              # Main UI
├── proxy_server.py         # Python backend server
├── main.py                 # Core backend logic
├── config.json             # Configuration file
├── setup.bat               # Setup script
├── start.bat               # Start script
├── requirements.txt        # Python dependencies
├── package.json            # Node.js dependencies
├── static/                 # Static assets
│   ├── css/                # Stylesheets
│   ├── js/                 # JavaScript files
│   └── img/                # Images and icons
├── src/                    # Python source modules
│   ├── commands/           # Command system
│   ├── voice/              # Voice synthesis
│   ├── profiles/           # Profile management
│   ├── screenshot/         # Screenshot handling
│   └── midjourney/         # Image generation
├── profiles/               # User profiles storage
└── docs/                   # Documentation
```

### Key Technologies

- **Frontend**: HTML, CSS, JavaScript, Electron
- **Backend**: Python, Flask
- **AI**: Ollama (Local LLM)
- **Voice**: Kokoro-82M
- **IPC**: Electron IPC, stdin/stdout

### Extending Tiny Pirate

When extending the system:

1. **New Commands**: Add to the CommandParser and CommandExecutor classes
2. **UI Enhancements**: Modify index.html and related CSS/JS files
3. **Backend Features**: Add new modules to the src/ directory
4. **Avatar Animations**: Extend the AnimatedAvatar class and related CSS

## Troubleshooting

For common issues and solutions, refer to the [Troubleshooting section](../README.md#troubleshooting) in the main README.

## Contributing

When contributing to Tiny Pirate:

1. Follow the existing code style and patterns
2. Document new features thoroughly
3. Test changes across different environments
4. Update documentation to reflect changes

## License

This project is proprietary software.
