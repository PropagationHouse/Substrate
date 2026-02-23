#!/bin/bash
# Installation script for Perfect Tiny Pirate Avatar
# This script installs the avatar display script and sets it up to run on boot

# Exit on error
set -e

echo "Installing Perfect Tiny Pirate Avatar..."
echo "========================================"

# Ensure running as root
if [ "$(id -u)" -ne 0 ]; then
    echo "This script must be run as root. Please use sudo."
    exit 1
fi

# Create backup directory
BACKUP_DIR="/home/pi/backup_$(date +%Y%m%d%H%M%S)"
echo "Creating backup directory: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

# Backup original files
echo "Backing up original files..."
if [ -f /home/pi/tiny_pirate_avatar.py ]; then
    cp /home/pi/tiny_pirate_avatar.py "$BACKUP_DIR/"
fi

if [ -f /etc/systemd/system/tiny-pirate-avatar.service ]; then
    cp /etc/systemd/system/tiny-pirate-avatar.service "$BACKUP_DIR/"
fi

if [ -f /etc/rc.local ]; then
    cp /etc/rc.local "$BACKUP_DIR/"
fi

# Copy the avatar script
echo "Installing avatar script..."
cp xgo_perfect_avatar.py /home/pi/tiny_pirate_avatar.py
chmod +x /home/pi/tiny_pirate_avatar.py

# Create systemd service
echo "Creating systemd service..."
cat > /etc/systemd/system/tiny-pirate-avatar.service << 'EOF'
[Unit]
Description=Tiny Pirate Avatar Display
After=network.target

[Service]
ExecStart=/usr/bin/python3 /home/pi/tiny_pirate_avatar.py
Restart=always
User=pi
Group=pi
Environment=DISPLAY=:0
Environment="XAUTHORITY=/home/pi/.Xauthority"
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=tinypirate

[Install]
WantedBy=multi-user.target
EOF

# Update rc.local to start the service on boot
echo "Updating rc.local..."
# Check if rc.local exists, if not create it
if [ ! -f /etc/rc.local ]; then
    cat > /etc/rc.local << 'EOF'
#!/bin/sh -e
#
# rc.local
#
# This script is executed at the end of each multiuser runlevel.
# Make sure that the script will "exit 0" on success or any other
# value on error.
#
# In order to enable or disable this script just change the execution
# bits.
#
# By default this script does nothing.

exit 0
EOF
    chmod +x /etc/rc.local
fi

# Add our service to rc.local before the exit 0 line
sed -i '/exit 0/d' /etc/rc.local
cat >> /etc/rc.local << 'EOF'
# Kill any competing UI processes
pkill -f chromium || true
pkill -f remix.py || true
pkill -f main.py || true
pkill -f start1.sh || true

# Ensure SPI is available
chmod 666 /dev/spidev0.0

# Start Tiny Pirate Avatar
systemctl restart tiny-pirate-avatar.service

exit 0
EOF

# Disable competing services
echo "Disabling competing services..."
systemctl disable lightdm || true
systemctl disable xgo-ui.service || true

# Enable our service
echo "Enabling avatar service..."
systemctl daemon-reload
systemctl enable tiny-pirate-avatar.service

# Ensure SPI is available now
chmod 666 /dev/spidev0.0

echo ""
echo "Installation complete!"
echo "The system will now reboot to apply changes."
echo "The Perfect Tiny Pirate Avatar will start automatically after reboot."
echo ""

# Prompt for reboot
read -p "Press Enter to reboot now, or Ctrl+C to cancel..." dummy

# Reboot
reboot
