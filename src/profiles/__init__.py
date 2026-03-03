import os
import shutil
import json
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ProfileManager:
    def __init__(self, base_dir):
        """Initialize the profile manager"""
        self.base_dir = base_dir
        self.profiles_dir = os.path.join(base_dir, 'profiles')
        self.custom_settings_path = os.path.join(base_dir, 'custom_settings.json')
        os.makedirs(self.profiles_dir, exist_ok=True)
        
    def create_profile(self, profile_name, config_data=None):
        """Create a new profile with the given configuration"""
        try:
            profile_dir = os.path.join(self.profiles_dir, profile_name)
            profile_config = os.path.join(profile_dir, 'config.json')
            
            logger.info(f"Creating profile directory: {profile_dir}")
            os.makedirs(profile_dir, exist_ok=True)
            
            # If no config provided, use current custom settings
            if config_data is None and os.path.exists(self.custom_settings_path):
                with open(self.custom_settings_path, 'r') as f:
                    config_data = json.load(f)
            
            # Save profile configuration
            logger.info(f"Saving profile config to: {profile_config}")
            with open(profile_config, 'w') as f:
                json.dump(config_data, f, indent=2)
            
            return {"status": "success", "message": f"Profile '{profile_name}' created successfully"}
            
        except Exception as e:
            logger.error(f"Error creating profile: {str(e)}")
            raise Exception(f"Failed to create profile: {str(e)}")

    def load_profile(self, profile_name):
        """Load a profile's configuration"""
        profile_config = os.path.join(self.profiles_dir, profile_name, 'config.json')
        if os.path.exists(profile_config):
            with open(profile_config, 'r') as f:
                config = json.load(f)
                
            # Save as current custom settings
            with open(self.custom_settings_path, 'w') as f:
                json.dump(config, f, indent=2)
                
            return config
        else:
            raise FileNotFoundError(f"Profile '{profile_name}' does not exist.")

    def list_profiles(self):
        """List all available profiles"""
        if not os.path.exists(self.profiles_dir):
            return []
            
        profiles = []
        for name in os.listdir(self.profiles_dir):
            profile_dir = os.path.join(self.profiles_dir, name)
            if os.path.isdir(profile_dir) and os.path.exists(os.path.join(profile_dir, 'config.json')):
                profiles.append(name)
        return profiles

    def delete_profile(self, profile_name):
        """Delete a profile"""
        if profile_name == 'default':
            raise ValueError("Cannot delete default profile")
            
        profile_dir = os.path.join(self.profiles_dir, profile_name)
        if os.path.exists(profile_dir):
            shutil.rmtree(profile_dir)
            return {"status": "success", "message": f"Profile '{profile_name}' deleted successfully"}
        else:
            raise FileNotFoundError(f"Profile '{profile_name}' does not exist.")
