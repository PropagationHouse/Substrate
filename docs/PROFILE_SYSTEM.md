# Substrate Profile Management System

This document details the profile management system in Substrate, which allows users to create and manage multiple configurations and personalized experiences.

> **Note**: For user instructions on managing profiles through the configuration panel, see the [Config Panel Guide](CONFIG_PANEL_GUIDE.md).

## Overview

The profile management system enables users to:
- Create multiple user profiles
- Switch between profiles
- Customize settings per profile
- Maintain separate configurations and avatar customizations

## Components

### ProfileManager Class

Located in `src/profiles/__init__.py`, the ProfileManager class handles all profile operations:

```python
class ProfileManager:
    def __init__(self, base_dir=None):
        """Initialize the profile manager"""
        self.base_dir = base_dir or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        self.profiles_dir = os.path.join(self.base_dir, "profiles")
        self.default_config_path = os.path.join(self.base_dir, "config.json")
        
        # Create profiles directory if it doesn't exist
        if not os.path.exists(self.profiles_dir):
            os.makedirs(self.profiles_dir)
            
        # Ensure default profile exists
        self.ensure_default_profile()
```

### Key Functions

#### Profile Creation

```python
def create_profile(self, profile_name):
    """Create a new profile"""
    if not profile_name or not isinstance(profile_name, str):
        return False, "Invalid profile name"
        
    # Sanitize profile name
    profile_name = self.sanitize_profile_name(profile_name)
    
    # Check if profile already exists
    profile_dir = os.path.join(self.profiles_dir, profile_name)
    if os.path.exists(profile_dir):
        return False, f"Profile '{profile_name}' already exists"
        
    try:
        # Create profile directory
        os.makedirs(profile_dir)
        
        # Copy default config to profile
        default_config = self.load_config(self.default_config_path)
        profile_config_path = os.path.join(profile_dir, "config.json")
        
        # Set profile name in config
        default_config["profile_name"] = profile_name
        
        # Save config to profile directory
        with open(profile_config_path, 'w') as f:
            json.dump(default_config, f, indent=2)
            
        return True, f"Profile '{profile_name}' created successfully"
    except Exception as e:
        logger.error(f"Error creating profile: {e}")
        return False, f"Error creating profile: {str(e)}"
```

#### Profile Switching

```python
def switch_profile(self, profile_name):
    """Switch to a different profile"""
    if not profile_name or not isinstance(profile_name, str):
        return False, "Invalid profile name"
        
    # Sanitize profile name
    profile_name = self.sanitize_profile_name(profile_name)
    
    # Check if profile exists
    profile_dir = os.path.join(self.profiles_dir, profile_name)
    if not os.path.exists(profile_dir):
        return False, f"Profile '{profile_name}' does not exist"
        
    try:
        # Load profile config
        profile_config_path = os.path.join(profile_dir, "config.json")
        if not os.path.exists(profile_config_path):
            return False, f"Profile configuration not found for '{profile_name}'"
            
        profile_config = self.load_config(profile_config_path)
        
        # Update main config with profile config
        with open(self.default_config_path, 'w') as f:
            # Set active profile in config
            profile_config["active_profile"] = profile_name
            json.dump(profile_config, f, indent=2)
            
        return True, f"Switched to profile '{profile_name}'"
    except Exception as e:
        logger.error(f"Error switching profile: {e}")
        return False, f"Error switching profile: {str(e)}"
```

#### Profile Deletion

```python
def delete_profile(self, profile_name):
    """Delete a profile"""
    if not profile_name or not isinstance(profile_name, str):
        return False, "Invalid profile name"
        
    # Sanitize profile name
    profile_name = self.sanitize_profile_name(profile_name)
    
    # Prevent deletion of default profile
    if profile_name == "default":
        return False, "Cannot delete the default profile"
        
    # Check if profile exists
    profile_dir = os.path.join(self.profiles_dir, profile_name)
    if not os.path.exists(profile_dir):
        return False, f"Profile '{profile_name}' does not exist"
        
    try:
        # Check if this is the active profile
        current_config = self.load_config(self.default_config_path)
        if current_config.get("active_profile") == profile_name:
            # Switch to default profile first
            self.switch_profile("default")
            
        # Delete profile directory
        import shutil
        shutil.rmtree(profile_dir)
        
        return True, f"Profile '{profile_name}' deleted successfully"
    except Exception as e:
        logger.error(f"Error deleting profile: {e}")
        return False, f"Error deleting profile: {str(e)}"
```

#### Profile Listing

```python
def list_profiles(self):
    """List all available profiles"""
    try:
        profiles = []
        
        # Get current active profile
        current_config = self.load_config(self.default_config_path)
        active_profile = current_config.get("active_profile", "default")
        
        # List all profile directories
        for item in os.listdir(self.profiles_dir):
            profile_dir = os.path.join(self.profiles_dir, item)
            if os.path.isdir(profile_dir):
                # Load profile config
                profile_config_path = os.path.join(profile_dir, "config.json")
                if os.path.exists(profile_config_path):
                    profile_config = self.load_config(profile_config_path)
                    
                    # Add profile info
                    profiles.append({
                        "name": item,
                        "active": item == active_profile,
                        "created": os.path.getctime(profile_dir),
                        "modified": os.path.getmtime(profile_config_path),
                        "config": profile_config
                    })
                    
        # Sort profiles by name
        profiles.sort(key=lambda x: x["name"])
        
        return True, profiles
    except Exception as e:
        logger.error(f"Error listing profiles: {e}")
        return False, f"Error listing profiles: {str(e)}"
```

### Helper Functions

```python
def sanitize_profile_name(self, name):
    """Sanitize profile name to prevent path traversal and invalid characters"""
    # Remove any path separators and special characters
    name = re.sub(r'[\\/*?:"<>|]', '', name)
    # Limit length
    name = name[:50]
    # Ensure not empty
    if not name:
        name = "profile"
    return name
    
def ensure_default_profile(self):
    """Ensure the default profile exists"""
    default_profile_dir = os.path.join(self.profiles_dir, "default")
    if not os.path.exists(default_profile_dir):
        os.makedirs(default_profile_dir)
        
    default_profile_config = os.path.join(default_profile_dir, "config.json")
    if not os.path.exists(default_profile_config):
        # Copy main config to default profile
        default_config = self.load_config(self.default_config_path)
        default_config["profile_name"] = "default"
        
        with open(default_profile_config, 'w') as f:
            json.dump(default_config, f, indent=2)
            
def load_config(self, config_path):
    """Load configuration from file"""
    try:
        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                return json.load(f)
        return {}
    except Exception as e:
        logger.error(f"Error loading config: {e}")
        return {}
```

## Integration with Backend

The profile manager is integrated with the main agent in `proxy_server.py`:

```python
class ChatAgent:
    def __init__(self, config_path='config.json'):
        """Initialize the agent"""
        self.config_path = config_path
        
        # Initialize profile manager with base directory
        self.profile_manager = ProfileManager(os.path.dirname(os.path.abspath(__file__)))
        
        # Load configuration
        self.load_config()
        
    def handle_profile_command(self, data):
        """Handle profile management commands"""
        action = data.get('action', 'list')
        profile_name = data.get('profile_name')
        
        if action == 'create':
            success, result = self.profile_manager.create_profile(profile_name)
            if success:
                # Reload config after profile creation
                self.load_config()
            return {
                'status': 'success' if success else 'error',
                'result': result
            }
        elif action == 'switch':
            success, result = self.profile_manager.switch_profile(profile_name)
            if success:
                # Reload config after profile switch
                self.load_config()
            return {
                'status': 'success' if success else 'error',
                'result': result
            }
        elif action == 'delete':
            success, result = self.profile_manager.delete_profile(profile_name)
            if success:
                # Reload config after profile deletion
                self.load_config()
            return {
                'status': 'success' if success else 'error',
                'result': result
            }
        elif action == 'list':
            success, profiles = self.profile_manager.list_profiles()
            return {
                'status': 'success' if success else 'error',
                'type': 'profile_list',
                'content': profiles if success else [],
                'result': f"Found {len(profiles)} profiles" if success else result
            }
        else:
            return {
                'status': 'error',
                'result': f"Unknown profile action: {action}"
            }
```

## Frontend Integration

The profile system is integrated with the Electron frontend through IPC messages:

```javascript
// In main.js
ipcMain.on('profile-action', (event, data) => {
    console.log('Profile action received:', data);
    try {
        if (!pythonProcess || pythonProcess.killed) {
            logError('Python process not running');
            return;
        }
        
        // Send profile command to Python backend
        pythonProcess.stdin.write(JSON.stringify({
            command: 'profile',
            action: data.action,
            profile_name: data.profileName
        }) + '\n');
    } catch (error) {
        logError('Error in profile action: ' + error);
    }
});

// In preload.js
contextBridge.exposeInMainWorld('electronAPI', {
    profileAction: (data) => ipcRenderer.send('profile-action', data),
    onProfileList: (callback) => ipcRenderer.on('profile-list', (_, data) => callback(data))
});
```

## UI Components

The profile management UI is implemented in the frontend:

```html
<!-- Profile Manager Panel -->
<div id="profile-manager" class="hidden">
    <div class="panel-header">
        <h2>Profile Manager</h2>
        <button id="close-profile-manager" class="close-button">×</button>
    </div>
    
    <div class="profile-actions">
        <input type="text" id="new-profile-name" placeholder="New profile name">
        <button id="create-profile">Create Profile</button>
    </div>
    
    <div class="profile-list" id="profile-list">
        <!-- Profile cards will be inserted here -->
    </div>
</div>
```

```javascript
// Profile Manager UI
function setupProfileManager() {
    // Create profile button
    document.getElementById('create-profile').addEventListener('click', () => {
        const profileName = document.getElementById('new-profile-name').value.trim();
        if (profileName) {
            window.electronAPI.profileAction({
                action: 'create',
                profileName: profileName
            });
            document.getElementById('new-profile-name').value = '';
        }
    });
    
    // Profile list handler
    window.electronAPI.onProfileList((data) => {
        const profileList = document.getElementById('profile-list');
        profileList.innerHTML = '';
        
        if (data && data.content && Array.isArray(data.content)) {
            data.content.forEach(profile => {
                const profileCard = document.createElement('div');
                profileCard.className = `profile-card ${profile.active ? 'active' : ''}`;
                
                profileCard.innerHTML = `
                    <h3>${profile.name}</h3>
                    <div class="profile-info">
                        <span>Created: ${new Date(profile.created * 1000).toLocaleDateString()}</span>
                    </div>
                    <div class="profile-actions">
                        ${profile.active ? 
                            '<button class="active-profile" disabled>Active</button>' : 
                            '<button class="switch-profile">Switch</button>'}
                        ${profile.name !== 'default' ? 
                            '<button class="delete-profile">Delete</button>' : ''}
                    </div>
                `;
                
                profileList.appendChild(profileCard);
                
                // Add event listeners
                if (!profile.active) {
                    profileCard.querySelector('.switch-profile').addEventListener('click', () => {
                        window.electronAPI.profileAction({
                            action: 'switch',
                            profileName: profile.name
                        });
                    });
                }
                
                if (profile.name !== 'default') {
                    profileCard.querySelector('.delete-profile').addEventListener('click', () => {
                        if (confirm(`Are you sure you want to delete profile "${profile.name}"?`)) {
                            window.electronAPI.profileAction({
                                action: 'delete',
                                profileName: profile.name
                            });
                        }
                    });
                }
            });
        }
    });
    
    // Request profile list
    window.electronAPI.profileAction({ action: 'list' });
}
```

## Profile Data Structure

Each profile consists of:

1. **Directory**: A dedicated folder in the `profiles/` directory
2. **Configuration**: A `config.json` file with profile-specific settings
3. **Avatar Customizations**: Custom avatar settings and preferences
4. **Knowledge Base**: Profile-specific knowledge and memory

```
profiles/
├── default/
│   ├── config.json
│   └── knowledge/
├── work/
│   ├── config.json
│   └── knowledge/
└── personal/
    ├── config.json
    └── knowledge/
```

## Configuration Synchronization

When a profile is active, its configuration is synchronized with the main `config.json`:

```python
def sync_profile_config(self):
    """Synchronize active profile configuration with main config"""
    try:
        # Get current active profile
        current_config = self.load_config(self.default_config_path)
        active_profile = current_config.get("active_profile", "default")
        
        # Get profile config path
        profile_dir = os.path.join(self.profiles_dir, active_profile)
        profile_config_path = os.path.join(profile_dir, "config.json")
        
        if os.path.exists(profile_config_path):
            # Load profile config
            profile_config = self.load_config(profile_config_path)
            
            # Update profile config with current config
            with open(profile_config_path, 'w') as f:
                json.dump(current_config, f, indent=2)
                
        return True
    except Exception as e:
        logger.error(f"Error syncing profile config: {e}")
        return False
```

## Security Considerations

1. **Path Sanitization**: Profile names are sanitized to prevent path traversal attacks
2. **Access Control**: Only authorized operations are allowed on profiles
3. **Default Protection**: The default profile cannot be deleted
4. **Error Handling**: Robust error handling prevents data corruption

## Best Practices for Extending

When extending the profile system:

1. Always sanitize user input for profile names
2. Maintain backward compatibility with existing profiles
3. Implement proper error handling for all profile operations
4. Use atomic operations when modifying profile data
5. Keep profile-specific data within the profile directory
