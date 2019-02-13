#!/bin/bash

# exit script on error
set -e

mkdir -p ~/.config/systemd/user

cat << EOF > ~/.config/systemd/user/speech-music-bot.service
[Unit]
Description=Discord Speech Music Bot

[Service]
ExecStart=`which node` `pwd`/lib/index.js
Restart=on-failure

[Install]
WantedBy=default.target
EOF

# find newly created service file
systemctl --user daemon-reload
# start service
systemctl --user start speech-music-bot

# enable service start
systemctl --user enable speech-music-bot
# enable user to run services when logged out
loginctl enable-linger `whoami`

# get service status
systemctl --user status speech-music-bot

echo "Successfully installed service speech-music-bot"