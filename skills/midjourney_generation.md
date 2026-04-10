# Midjourney Generation
Generates an image on Midjourney by opening the web interface and typing the prompt.

## Usage
Run this script to execute the skill:
```
python workspace/emergent/midjourney_generation.md
```

## Source
```md
# Midjourney Generation

Generates an image on Midjourney by opening the web interface and typing the prompt.

## Usage

```
midjourney(prompt="a cyberpunk cat")
```

## Implementation

```powershell
$prompt = "{{prompt}}"
# Open the Midjourney create page
Start-Process "https://www.midjourney.com/imagine"

# Wait for page to load (adjust seconds if slow internet)
Start-Sleep -Seconds 2

# Focus is usually on the input box automatically, but we can try to ensure it
# Sending keys
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait($prompt)
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
```

```
