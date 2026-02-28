# Midjourney Automation Testing Guide

This guide provides step-by-step instructions for testing the Midjourney automation feature in the Substrate 9-3 system.

## Prerequisites

1. Ensure the Substrate 9-3 application is running
2. Microsoft Edge browser is installed
3. PyAutoGUI is installed and working properly
4. You have an active internet connection

## Test 1: Verify Configuration Toggle

1. Open the application
2. Click on the config button to open the configuration panel
3. Navigate to the "Midjourney Generation" section
4. Ensure the "Enable Auto-Generation" checkbox is checked
5. Click "Save" to apply the configuration
6. Verify in the console logs that the configuration was saved successfully
   - Look for messages like: "Toggle state change: enabled = true"
   - And: "Midjourney handler current state: enabled=True"

## Test 2: Manual Midjourney Command Test

1. In the chat input field, type a Midjourney command:
   ```
   imagine a futuristic city with flying cars and neon lights
   ```
   or
   ```
   /imagine a futuristic city with flying cars and neon lights
   ```

2. Press Enter to send the command

3. Observe the following sequence of events:
   - The command should be detected by the command parser (creating a search command with source 'midjourney')
   - The command executor should directly route it to the _handle_midjourney_imagine function
   - Microsoft Edge should open with the Midjourney website
   - The prompt should be automatically typed into the input field
   - The prompt should be submitted

4. If any step fails, check the console logs for error messages

## Test 3: Autonomous Midjourney Generation

1. Ensure the Midjourney automation is enabled in the config
2. Set reasonable min and max intervals (e.g., 60-120 seconds) for testing
3. Wait for the autonomous generation to trigger
4. Observe the following sequence:
   - The MidjourneyHandler will generate a prompt using the LLM
   - It will extract the prompt text (removing any 'imagine' prefix)
   - It will directly call the _handle_midjourney_imagine function
   - Microsoft Edge will open with the Midjourney website
   - The prompt will be automatically typed and submitted
   - A confirmation message will appear in the chat: "🎨 Autonomous Midjourney prompt submitted: [prompt]"
5. Verify that multiple generations occur at the configured intervals

## Troubleshooting

If the automation is not working as expected, check the following:

1. **Command Detection**:
   - Verify the command parser is correctly detecting Midjourney commands
   - Check console logs for "[DEBUG] Command type: search" and "source: midjourney"

2. **Command Routing**:
   - Verify the command executor is directly routing Midjourney commands to the handler
   - Look for logs indicating "[DEBUG] Midjourney imagine detected" and "_handle_midjourney_imagine" is being called

3. **Browser Automation**:
   - Ensure Microsoft Edge is installed and can be launched
   - Check if PyAutoGUI is working properly (move mouse to screen corner to abort if stuck)
   - Verify the window positioning and sizing is correct

4. **Toggle State**:
   - Check if the toggle state is being properly saved in the config
   - Verify the MidjourneyHandler is correctly reading the enabled state

5. **Error Handling**:
   - Look for any exception messages in the console logs
   - Check for timeouts or failures in the automation sequence

## Expected Results

When working correctly, the Midjourney automation should:

1. Detect commands starting with "imagine" or "/imagine"
2. Open Microsoft Edge with the Midjourney website
3. Type the prompt text into the input field
4. Submit the prompt
5. Return control to the application

For autonomous generation, it should periodically generate and submit prompts based on the configured intervals when enabled.
