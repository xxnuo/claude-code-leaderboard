# Quick Twitter App Setup for Testing

## 1. Create Twitter App (5 minutes)

1. Go to https://developer.twitter.com/en/portal/dashboard
2. Click "Create App" or "Add App"
3. **App Environment**: Select "Development"
4. **App Name**: `Codebrag Dev`

## 2. Configure OAuth 2.0

In your app settings:

1. Navigate to "User authentication settings"
2. Click "Set up" or "Edit"
3. Configure:
   - **App permissions**: Read
   - **Type of App**: Native App (Public client)
   - **Callback URI**: `http://localhost:3000/callback`
   - **Website URL**: `https://github.com/georgepickett/codebrag`

## 3. Get Your Client ID

1. After saving, go to "Keys and tokens"
2. Under "OAuth 2.0 Client ID and Client Secret"
3. Copy the **Client ID** (looks like: `ABC123...`)

## 4. Test Your Setup

```bash
# Set your client ID
export TWITTER_CLIENT_ID="your_client_id_here"

# Test the auth flow
cd cli
node bin/cli.js auth
```

## Important Notes

- **DO NOT** commit your Client ID to git
- For development, you can have up to 5 apps
- Rate limits are lower for dev apps (that's ok for testing)
- You can delete test apps after testing

## Troubleshooting

If auth fails:
1. Check callback URL is exactly `http://localhost:3000/callback`
2. Ensure app type is "Native App" not "Web App"
3. Try regenerating the Client ID
4. Check if port 3000 is available