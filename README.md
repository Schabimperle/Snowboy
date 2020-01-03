# SpeechMusicBot

A discord bot which play's music on speech commands.

## Usage

### Text commands:
- !join
- !leave
- !play \<query | spotify playlist link\>

### Speech commands:
- "play \<query\>"
- "pause"
- "resume"
- "skip"
- "stop"
- "leave"

## Development
Pushes to the master branch will automatically update and restart the main snowboy bot

### Prequisites
- node version v10.16.0
- repository access rights

### Setup environment
- clone repository: `git clone git@github.com:Schabimperle/Snowboy.git`
- npm install
- get google-keys.json from google cloud platform (https://console.cloud.google.com/apis/api/speech.googleapis.com/ -> Credentials/Service Accounts) and store the file in Snowboy folder
- fill src/config.json.example with reasonable values and remove the '.example' ending