#!/bin/bash

# exit script on error
set -e

systemctl --user stop speech-music-bot
systemctl --user disable speech-music-bot
rm ~/.config/systemd/user/speech-music-bot.service
systemctl --user daemon-reload
systemctl --user reset-failed

echo "Successfully removed service"