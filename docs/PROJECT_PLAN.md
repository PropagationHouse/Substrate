# Substrate - Intelligent System Agent

## Project Overview
An intelligent agent capable of both chat and system control, built on top of the existing Substrate chat interface. The agent will understand and execute system commands, learn from interactions, and provide autonomous assistance while maintaining a conversational interface.

## Architecture

### Core Components

1. **Existing Chat System**
   - Electron-based UI
   - Python backend
   - Local LLM integration via Ollama

2. **Command System** (New)
   ```
   commands/
   ├── core/
   │   ├── registry.json        # Base command knowledge
   │   ├── shortcuts.json       # Keyboard shortcuts
   │   └── applications.json    # Common app paths/configs
   ├── parser.py               # Command interpretation
   ├── executor.py             # Command execution
   └── learner.py             # Pattern learning
   ```

3. **Knowledge Base** (New)
   ```
   knowledge/
   ├── windows/
   │   ├── cmd_commands.json
   │   ├── powershell_commands.json
   │   └── system_operations.json
   ├── shortcuts/
   │   ├── global_shortcuts.json
   │   └── app_specific/
   │       ├── browsers/
   │       │   ├── edge.json        # Primary browser
   │       │   └── chrome.json      # Secondary browser
   │       ├── creative/
   │       │   ├── adobe_lightroom.json
   │       │   ├── adobe_premiere.json
   │       │   ├── blender.json
   │       │   └── obsidian.json
   │       ├── development/
   │       │   ├── vscode.json
   │       │   └── windows_terminal.json
   │       ├── gaming/
   │       │   ├── unity.json
   │       │   ├── unreal_engine.json
   │       │   └── steam.json
   │       ├── music/
   │       │   ├── maschine.json
   │       │   └── ableton.json
   │       └── windows.json
   ├── workflows/
   │   ├── recorded_patterns.json
   │   └── learned_sequences.json
   └── app_discovery/
       ├── registry.json           # Tracks all known applications
       ├── learning_queue.json     # Apps pending knowledge acquisition
       └── monitoring/
           ├── usage_patterns.json # App usage frequency and patterns
           ├── new_apps.json      # Recently discovered applications
           └── shortcuts_learned.json # Newly discovered shortcuts
   ```

4. **Dynamic App Learning System** (New)
   ```
   app_learning/
   ├── monitors/
   │   ├── process_monitor.py     # Tracks new application launches
   │   ├── shortcut_monitor.py    # Captures keyboard shortcuts used
   │   └── usage_tracker.py       # Tracks application usage patterns
   ├── analyzers/
   │   ├── shortcut_analyzer.py   # Identifies common shortcuts
   │   ├── workflow_analyzer.py   # Identifies common sequences
   │   └── context_analyzer.py    # Understands usage context
   └── learners/
       ├── app_profiler.py        # Builds application profiles
       ├── shortcut_learner.py    # Learns new shortcuts
       └── workflow_learner.py    # Learns common workflows
   ```

## UI Components

### Chat Interface
1. **Main Chat Window**
   - Transparent background
   - Message bubbles with blur effects
   - User/Assistant message styling
   - Retro font (Press Start 2P)
   - Smooth animations

2. **Input Area**
   - Semi-transparent input container
   - Blur effects for readability
   - Centered layout
   - Avatar display behind input
   - Responsive sizing

3. **Tool Buttons**
   - Upload Image (+) button
   - Settings (⚙️) button
   - Tooltip system
   - Radial menu animation
   - Hover effects

4. **Configuration Panel**
   - Centered modal design
   - Semi-transparent overlay
   - Sections:
     1. Agent Avatar
     2. Model Selection
     3. System Prompt
     4. Advanced Settings
     5. Profile Management
   - White text on dark background
   - Smooth transitions
   - Blur effects
   - Responsive layout

5. **Profile System**
   - Default avatar support
   - Profile switching
   - Settings persistence
   - Avatar customization

### Styling Guidelines
1. **Colors**
   - White text (#FFFFFF)
   - Dark backgrounds (rgba(0, 0, 0, 0.95))
   - Semi-transparent elements
   - Consistent opacity levels

2. **Effects**
   - Blur effects for depth
   - Smooth transitions
   - Scale animations
   - Fade effects

3. **Layout**
   - Centered components
   - Responsive sizing
   - Proper spacing
   - Mobile-friendly design

4. **Interactions**
   - Hover effects
   - Click feedback
   - Smooth animations
   - Clear focus states

### Accessibility
1. **Text**
   - High contrast
   - Readable font sizes
   - Clear hierarchy
   - Proper spacing

2. **Controls**
   - Clear tooltips
   - Keyboard navigation
   - Focus indicators
   - Error states

3. **Feedback**
   - Visual confirmations
   - Loading states
   - Error messages
   - Success indicators

## Voice Integration

### Text-to-Speech (TTS) Integration
1. **Kokoro-82M Model**
   - **Installation:** Use `pip install kokoro` to add the TTS library.
   - **Functionality:** Convert agent text responses to speech.
   - **Playback:** Use `pyaudio` or `pygame` for audio playback.
   - **Integration:** Connect TTS to the agent's response system.

### Implementation Steps
1. **Install Kokoro**
   - Add the library to the project using pip.

2. **Generate Speech**
   - Convert text responses to speech using Kokoro.

3. **Audio Playback**
   - Implement audio playback using a suitable library.

4. **Testing and Tuning**
   - Ensure voice matches agent personality.
   - Test for smooth playback and synchronization.

5. **Deployment**
   - Integrate TTS into the production environment.

### Considerations
- Ensure compatibility with existing systems.
- Optimize for performance and responsiveness.

## Dependencies

### Python Packages
# Existing
electron==28.1.0
@electron/remote==2.0.11

# New Requirements
pyautogui==0.9.54          # System control
keyboard==0.13.5           # Keyboard monitoring
psutil==5.9.6             # Process management
pywin32==306              # Windows API access
watchdog==3.0.0           # File system monitoring
python-dotenv==1.0.0      # Environment management
requests==2.31.0          # HTTP requests

# App Learning System
win32gui==221             # Windows GUI interaction
win32process==300         # Process information
keyboard==0.13.5          # Keyboard monitoring
mouse==0.7.1              # Mouse monitoring
psutil==5.9.6             # Process monitoring
pywinauto==0.6.8         # Windows automation
accessibility-tools==1.5.0 # UI element detection

# Web & Automation
beautifulsoup4==4.12.2    # Web parsing
selenium==4.15.2          # Web automation
playwright==1.40.0        # Modern web automation

## Implementation Phases

### Phase 1: Command Foundation
1. **Knowledge Base Creation**
   - Document all Windows commands
   - Map keyboard shortcuts
   - Create application registry
   - Define system operations

2. **Command Parser**
   - Natural language understanding
   - Pattern matching
   - Intent classification
   - Context awareness

3. **Execution Engine**
   - Command validation
   - Safety checks
   - Execution monitoring
   - Error handling

### Phase 2: System Integration
1. **System Operations**
   - File management
   - Process control
   - Window management
   - Settings control

2. **Application Control**
   - Launch/close apps
   - Window manipulation
   - State management
   - Inter-app communication

### Phase 3: Learning System
1. **Pattern Recognition**
   - Command sequence recording
   - Success/failure tracking
   - Pattern extraction
   - Optimization

2. **Workflow Learning**
   - User behavior analysis
   - Common sequence detection
   - Automation suggestions
   - Performance optimization

### Phase 4: Advanced Features
1. **Autonomous Operations**
   - Task scheduling
   - Background monitoring
   - Proactive assistance
   - Resource management

2. **UI Improvements**
   - Command suggestions
   - Visual feedback
   - Progress tracking
   - Error reporting

## File Structure
```
tiny_pirate/
├── src/
│   ├── commands/          # Command system
│   ├── knowledge/         # Knowledge base
│   ├── learning/          # Learning system
│   ├── system/           # System operations
│   └── ui/               # User interface
├── tests/                # Test suite
├── docs/                 # Documentation
└── config/              # Configuration files
```

## Safety Considerations
1. Command validation before execution
2. Resource usage monitoring
3. Rollback capabilities
4. User confirmation for destructive operations
5. Rate limiting for system operations
6. Logging and audit trail

## Development Guidelines
1. Modular design for easy extension
2. Comprehensive error handling
3. Clear documentation
4. Test coverage for critical components
5. Performance monitoring
6. Security best practices

## Next Steps
1. Create base knowledge JSON files
2. Implement command parser
3. Build execution engine
4. Add learning system
5. Integrate with existing chat interface

## Future Enhancements
1. Multi-monitor support
2. Custom workflow creation
3. Task automation
4. Advanced pattern recognition
5. Natural language improvements
6. Performance optimizations
