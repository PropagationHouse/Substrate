# XGO Rider CM4 Analysis - Button & Motion Control

## Button Hardware Mapping (GPIO)

From `RaspberryPi-CM4-main/key.py` and `uiutils.py`:

| Button | GPIO BCM | Method | Current Behavior |
|--------|----------|--------|------------------|
| **A** (Top-Left?) | 24 | `press_a()` | Returns `True` on press; no built-in action |
| **B** (Top-Right?) | 23 | `press_b()` | Returns `True` + `os.system('pkill mplayer')` |
| **C** (Bottom-Left?) | 17 | `press_c()` | Returns `True` on press; no built-in action |
| **D** (Bottom-Right?) | 22 | `press_d()` | Returns `True` on press; no built-in action |

**Button Behavior:**
- All methods block until button is released (debounced)
- Return `True` if pressed, `False` if not currently pressed
- Used in `demoen.py` menu: C=left nav, D=right nav, A=enter/confirm, B=exit

---

## XGO SDK Motion API

From inspecting `demos/dog_show.py`, `demos/pose_dog.py`, `demos/pose.py`, `extra_demos/fit.py`:

### Core Commands

```python
from xgolib import XGO

# Initialize (version can be "xgomini", "xgolite", or "xgorider")
dog = XGO(port="/dev/ttyAMA0", version="xgorider")

# Motion Control
dog.perform(0)           # STOP / PARK - disables motors, robot relaxes
dog.perform(1)           # START / ACTIVATE - enables motors, ready to move
dog.reset()              # Return to neutral standing posture
dog.translation('z', height)  # Adjust vertical height (e.g., 75-115 range)

# Info
dog.read_firmware()      # Returns firmware version string (e.g., "R1.0")
```

### Motion Patterns Observed

- **`dog.perform(0)`** → Used at end of demos to park/disable the robot
- **`dog.perform(1)`** → Used at start to activate/enable the robot
- **`dog.reset()`** → Returns to neutral stance (used after demos finish)
- **`dog.translation('z', height)`** → Continuous height adjustment (seen in pose_dog.py, fit.py)
  - Height range appears to be ~75-115 (lower = more crouched, higher = more standing)
  - Called in a loop to track user movement (e.g., squat detection)

---

## Low-Power Mode Strategy

**Current Finding:** No explicit "low power" or "sleep" command found in the inspected demos.

**Likely Implementation:**
Based on the API, low-power mode would be:
```python
dog.perform(0)  # Disable motors, robot relaxes to ground
```

This is already used at the end of every demo to "park" the robot. To toggle low-power:

1. **Enter Low-Power:** `dog.perform(0)` → motors disabled, robot sits/lies down
2. **Exit Low-Power:** `dog.perform(1)` → motors enabled, robot stands up

---

## Button Integration Plan

### Option 1: Modify `key.py` Button Class
Add a method to detect long-press:

```python
def press_a_long(self, duration=2.0):
    """Detect long press on button A (GPIO 24)"""
    start = time.time()
    if not GPIO.input(self.key1):  # Button pressed
        while not GPIO.input(self.key1):
            if time.time() - start >= duration:
                return "long"
            time.sleep(0.02)
        return "short"
    return None
```

### Option 2: Create a New Low-Power Toggle Script
File: `c:\Users\Bl0ck\Desktop\Substrate\xgo_low_power_toggle.py`

```python
#!/usr/bin/env python3
"""
XGO Rider Low-Power Mode Toggle
Listens to Button A (GPIO 24) and toggles low-power mode on/off
"""
import time
import sys
sys.path.insert(0, '/home/pi/RaspberryPi-CM4-main')
from key import Button
from xgolib import XGO

dog = XGO(port="/dev/ttyAMA0", version="xgorider")
button = Button()

low_power_active = False

print("XGO Low-Power Toggle Started")
print("Press Button A to toggle low-power mode")

while True:
    if button.press_a():
        low_power_active = not low_power_active
        
        if low_power_active:
            print("[LOW-POWER] Entering low-power mode...")
            dog.perform(0)  # Disable motors
            print("[LOW-POWER] Motors disabled. Robot relaxed.")
        else:
            print("[LOW-POWER] Exiting low-power mode...")
            dog.perform(1)  # Enable motors
            dog.reset()     # Return to neutral stance
            print("[LOW-POWER] Motors enabled. Robot standing.")
        
        time.sleep(0.5)  # Debounce delay
```

---

## Integration with Substrate

To integrate with the Substrate system on the XGO Rider:

1. **Copy `key.py` to Substrate** (if not already present)
2. **Create `xgo_low_power_toggle.py`** as a background service
3. **Wire into `proxy_server.py`** or run as a separate daemon that listens to buttons
4. **Add UI toggle** in `index.html` to reflect low-power state

---

## Files Analyzed

- `RaspberryPi-CM4-main/key.py` - Button GPIO definitions
- `RaspberryPi-CM4-main/uiutils.py` - Button class + UI utilities
- `RaspberryPi-CM4-main/demoen.py` - Menu system using buttons
- `RaspberryPi-CM4-main/demos/dog_show.py` - Motion control example
- `RaspberryPi-CM4-main/demos/pose_dog.py` - Height adjustment via `translation('z', height)`
- `RaspberryPi-CM4-main/demos/pose.py` - Similar height control
- `RaspberryPi-CM4-main/extra_demos/fit.py` - Fitness tracking with height control
- `RaspberryPi-CM4-main/demos/volume.py` - Settings UI pattern
- `RaspberryPi-CM4-main/edublock.py` - Edublock integration

---

## Next Steps

1. **Confirm button physical layout** (which GPIO maps to which corner)
2. **Test `dog.perform(0)` and `dog.perform(1)`** to verify low-power behavior
3. **Implement button listener** (either modify `key.py` or create standalone script)
4. **Integrate with Substrate** (add to startup or wire into voice handler)
5. **Add UI indicator** to show low-power state in Substrate chat/avatar
