#!/bin/bash

systemctl stop speech-music-bot
systemctl disable speech-music-bot
rm /etc/systemd/system/speech-music-bot.service
systemctl daemon-reload
systemctl reset-failed