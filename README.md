# Codebrag CLI

NPX package for tracking Claude Code usage and participating in the leaderboard with Twitter authentication.

## Installation

```bash
npx codebrag
```

## Usage

### First Time Setup
```bash
# Run the CLI and follow the authentication prompts
npx codebrag
```

### Commands

```bash
# Authenticate with Twitter
npx codebrag auth

# View your usage statistics
npx codebrag stats

# View the leaderboard
npx codebrag leaderboard

# View help
npx codebrag --help
```

## Features

- **One-command setup**: `npx codebrag` handles everything
- **Automatic hook installation**: Token tracking is set up automatically on first run
- **Seamless Twitter Authentication**: OAuth 1.0a skips login if you're already signed in
- **Usage tracking**: Seamless integration with Claude Code
- **Leaderboard**: See how you rank among other users
- **Real-time stats**: View your usage statistics
- **Secure storage**: Encrypted token storage

## Requirements

- Node.js 16.0.0 or higher
- Claude Code with hook system configured
- Twitter account for authentication

## Configuration

The CLI automatically creates and manages `~/.claude/leaderboard.json` with your authentication data and API endpoint configuration.

## Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Test the CLI
node bin/cli.js --help
```

## Environment Variables

### Optional
- `ENCRYPTION_KEY`: Key for encrypting stored tokens (default provided)
- `API_BASE_URL`: Backend API URL (default: https://codebrag.example.com)

## Support

If you encounter issues, please check:
- Your internet connection
- Backend API is running
- Twitter app configuration is correct
- Claude Code hook system is properly configured

## How It Works

1. **Automatic Setup**: On first run, Codebrag automatically installs a token counting hook
2. **Token Tracking**: Every time you use Claude Code, your usage is tracked
3. **Authentication**: Link your Twitter account to join the leaderboard
4. **Real-time Updates**: Your stats update automatically after each Claude Code session

The hook is installed to:
- `~/.claude/count_tokens.js` - The counting script
- `~/.claude/settings.toml` & `settings.json` - Hook configuration
- `~/.claude/leaderboard.json` - Your authentication data

## OAuth 1.0a Authentication

This CLI uses Twitter OAuth 1.0a authentication which provides:
- **Seamless login**: If you're already logged into Twitter, you skip directly to authorization
- **No expiration**: Tokens are valid indefinitely (until revoked)
- **Better for CLI tools**: No need to refresh tokens
- **Simple setup**: Just need consumer key and secret from Twitter Developer Portal