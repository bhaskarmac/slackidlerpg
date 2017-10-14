# Installing on Slack

 - the channel name *must be* `#idlerpg`.



# Running slackidlerpg

Environment variables:
- `REDIS_HOST` (default `127.0.0.1`)
- `REDIS_PORT` (default `6379`)
- `API_PORT` (default: `8010`)

- `OAUTH_REDIRECT_URI` - the redirect URI you've set up in slack. Find it under "OAuth & Permissions > Redirect URLs" in your app's settings.
- `CLIENT_ID` - your app's client ID.
- `CLIENT_SECRET` - your app's client secret.
- `VERIFICATION_TOKEN` - your app's verification token. Find these under "Basic Information > App Credentials" in your app's settings.
