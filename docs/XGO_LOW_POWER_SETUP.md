# XGO Rider Low-Power Toggle Setup

## Quick Start

### Option A: Manual Run (Testing)
```bash
# SSH into XGO Rider
ssh pi@192.168.4.1

# Copy the script to the XGO
scp xgo_low_power_toggle.py pi@192.168.4.1:/home/pi/

# Run it
python3 /home/pi/xgo_low_power_toggle.py
```

**Usage:**
- Press **Button A (top-left)** to toggle low-power mode
- Watch the terminal for state changes
- Press `Ctrl+C` to stop

---

### Option B: Auto-Start as Service (Production)

#### 1. Copy files to XGO
```bash
scp xgo_low_power_toggle.py pi@192.168.4.1:/home/pi/
scp xgo_low_power_toggle.service pi@192.168.4.1:/tmp/
```

#### 2. SSH into XGO and install service
```bash
ssh pi@192.168.4.1

# Move service file to systemd directory
sudo mv /tmp/xgo_low_power_toggle.service /etc/systemd/system/

# Reload systemd daemon
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable xgo_low_power_toggle.service

# Start the service now
sudo systemctl start xgo_low_power_toggle.service

# Check status
sudo systemctl status xgo_low_power_toggle.service
```

#### 3. Verify it's running
```bash
# View logs
sudo journalctl -u xgo_low_power_toggle.service -f

# Or check the log file
tail -f ~/xgo_low_power_toggle.log
```

---

## Button Mapping

| Button | GPIO | Location | Function |
|--------|------|----------|----------|
| **A** | 24 | Top-Left | **LOW-POWER TOGGLE** |
| B | 23 | Top-Right | (Reserved) |
| C | 17 | Bottom-Left | (Reserved) |
| D | 22 | Bottom-Right | (Reserved) |

---

## How It Works

**Low-Power Mode (Motors OFF):**
- Press Button A once
- `dog.perform(0)` is called
- Motors disable, robot relaxes/sits down
- Battery consumption drops significantly

**Active Mode (Motors ON):**
- Press Button A again
- `dog.perform(1)` is called
- Motors enable, robot stands up
- `dog.reset()` returns to neutral stance

---

## Troubleshooting

### Script won't start
```bash
# Check if xgolib is installed
python3 -c "from xgolib import XGO; print('OK')"

# If missing, install it
pip3 install xgo-pythonlib
```

### Button not responding
- Verify GPIO 24 is not in use by another process
- Check that Button class is properly initialized
- Try running with `sudo` if permission issues occur

### Service won't auto-start
```bash
# Check service status
sudo systemctl status xgo_low_power_toggle.service

# View detailed logs
sudo journalctl -u xgo_low_power_toggle.service -n 50

# Restart service
sudo systemctl restart xgo_low_power_toggle.service
```

### Motors not responding
- Verify XGO connection: `dog.read_firmware()`
- Check serial port: `ls -la /dev/ttyAMA0`
- Ensure XGO firmware is up to date

---

## Stopping the Service

```bash
# Stop the service
sudo systemctl stop xgo_low_power_toggle.service

# Disable auto-start
sudo systemctl disable xgo_low_power_toggle.service

# Remove service file
sudo rm /etc/systemd/system/xgo_low_power_toggle.service
sudo systemctl daemon-reload
```

---

## Log Locations

- **Service logs:** `sudo journalctl -u xgo_low_power_toggle.service`
- **File logs:** `~/xgo_low_power_toggle.log` (on XGO)
- **Console output:** Visible when running manually

---

## Notes

- The script runs independently of Substrate
- Button press is debounced by the `Button` class
- Graceful shutdown on `Ctrl+C` (exits low-power mode first)
- Auto-restart on crash (if running as service)
