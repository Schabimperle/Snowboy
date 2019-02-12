#!/bin/bash

# exit script on error
set -e

# check run as sudo (-n => "To check for non-null/non-zero string variable")
if [ ! -n "$SUDO_USER" ] ; then
    echo "Error: Please execute with sudo"
    exit 1
fi

cat << EOF > /etc/systemd/system/speech-music-bot.service
[Unit]
Description=Discord Speech Music Bot
After=network.target

[Service]
Type=simple
User=$SUDO_USER
ExecStart=`which node` `pwd`/lib/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

echo "Successfully installed service speech-music-bot. Start by executing 'sudo systemctl start speech-music-bot'"