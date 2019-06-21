#!/bin/bash

# exit script on error
set -e

SERVICE_NAME=speech-music-bot

case "$1" in
"install" | "i") 
    mkdir -p ~/.config/systemd/user

    cat << EOF > ~/.config/systemd/user/$SERVICE_NAME.service
[Unit]
Description=Discord Speech Music Bot

[Service]
ExecStart=`which node` `pwd`/lib/index.js
Restart=on-failure
WorkingDirectory=`pwd`

[Install]
WantedBy=default.target
EOF

    # find newly created service file
    systemctl --user daemon-reload
    # start service
    systemctl --user restart $SERVICE_NAME

    # enable service start
    systemctl --user enable $SERVICE_NAME
    # enable user to run services when logged out
    loginctl enable-linger `whoami`

    echo "Successfully installed and started service, check status by executing 'systemctl --user status $SERVICE_NAME'"
    ;;

"uninstall" | "u")
    systemctl --user stop $SERVICE_NAME
    systemctl --user disable $SERVICE_NAME
    rm ~/.config/systemd/user/$SERVICE_NAME.service
    systemctl --user daemon-reload
    systemctl --user reset-failed

    echo "Successfully removed service"
    ;;

"restart" | "r")
    systemctl --user restart $SERVICE_NAME
    ;;

*)
    echo "You need to pass an argument"
    ;;
esac
