# Claude Code Leaderboard CLI

Track your Claude Code usage and compete on the global leaderboard! This CLI automatically monitors your token usage and posts your stats to the leaderboard after each Claude Code session.

## Quick Start

```bash
npx claude-code-leaderboard
```

Follow the setup prompts to authenticate with Twitter and start tracking your usage automatically.

## How It Works

The CLI integrates with Claude Code's hook system to automatically track your usage:

1. **Automatic Setup**: Installs a tracking hook in your Claude Code configuration
2. **Usage Monitoring**: After each Claude Code session ends (STOP command), your token usage is collected
3. **Data Submission**: Usage data is automatically sent to our backend service 
4. **Leaderboard Updates**: Your stats appear on the public leaderboard at [claudecount.com](https://claudecount.com)

### What Gets Tracked

- Input tokens used
- Output tokens generated  
- Cache creation/read tokens
- Session timestamps
- Model used (e.g., claude-sonnet-4)

Your actual prompts and responses are never collected - only usage statistics.

## Understanding Claude Code Hooks

### What Are Hooks?
Claude Code hooks are user-defined shell commands that execute automatically at specific points during Claude Code's execution lifecycle. They allow you to inject deterministic, programmatic actions directly into the agent's workflow - ensuring that key tasks always occur exactly when intended, rather than relying on the AI to remember to do them.

### Hook Types
Claude Code supports hooks at different lifecycle events:
- **Start**: When a Claude Code session begins
- **Stop**: When a Claude Code session ends  
- **PreTool**: Before any tool or command is executed
- **PostTool**: After a tool or command completes

### How This Project Uses Hooks
This leaderboard CLI specifically uses a **Stop** hook, which means:
- Every time you finish a Claude Code session (when Claude Code exits)
- The hook automatically executes with your user permissions
- No confirmation is required - it runs silently in the background
- The hook scans your Claude Code usage data and sends statistics to our backend

This provides reliable, automatic tracking without you having to remember to manually submit your usage.

## File Installation Details

When you run the setup, the following files are created on your system:

### Hook Script
- **Location**: `~/.claude/count_tokens.js`
- **Purpose**: The actual script that collects and sends your usage data
- **Permissions**: Executes with your user permissions
- **When it runs**: Automatically after each Claude Code session ends

### Configuration Files
- **`~/.claude/settings.json`**: Updated to register the Stop hook
- **`~/.claude/leaderboard.json`**: Stores your Twitter authentication and API settings

### What the Hook Does
The `count_tokens.js` script:
1. Scans Claude Code project directories for usage log files (`.jsonl` files)
2. Extracts token usage statistics from the most recent session
3. Sends only the statistics (not your prompts/responses) to our backend
4. Updates your position on the leaderboard

## Commands

```bash
# Setup or re-authenticate
npx claude-code-leaderboard

# Reset/uninstall (with optional account deletion)
npx claude-code-leaderboard reset

# View help
npx claude-code-leaderboard --help
```

## Features

- **One-command setup**: Complete setup with a single command
- **Automatic tracking**: Seamless integration with Claude Code hooks
- **Twitter authentication**: Secure OAuth 1.0a authentication
- **Privacy-focused**: Only usage statistics are collected
- **Cross-platform**: Works on macOS, Linux, and Windows
- **View stats online**: Visit [claudecount.com](https://claudecount.com) to see your stats and the leaderboard

## Requirements

- Node.js 16.0.0 or higher
- Claude Code CLI installed and configured
- Twitter account for authentication

## Configuration

The CLI automatically manages your configuration in `~/.claude/leaderboard.json` including:
- Twitter authentication tokens
- API endpoint settings
- User preferences

## Privacy & Security

### What Data Is Collected
- **Usage statistics only**: Token counts, timestamps, model names
- **No content**: Your actual prompts and Claude's responses are never transmitted
- **Linked to Twitter**: All data is associated with your Twitter handle for leaderboard display

### Security Considerations
- **User permissions**: The hook runs with your full user permissions
- **Automatic execution**: No confirmation required when the hook runs
- **Trusted source**: Only install hooks from sources you trust
- **OAuth authentication**: Uses secure OAuth 1.0a for Twitter authentication

### What You Should Know
- Hooks execute automatically after each Claude Code session
- The script only reads Claude Code's own usage log files
- You can uninstall at any time by running the reset command
- All source code is available for inspection in this repository

## Uninstalling

### Complete Removal
The `reset` command provides a comprehensive uninstall process:

```bash
npx claude-code-leaderboard reset
```

This command will:
1. Remove all local CLAUDE COUNT files and settings
2. Unregister the hook from Claude Code
3. **Optionally**: Delete your account from the leaderboard database

### Account Deletion
If you're authenticated, the reset command will offer to permanently delete your account from the leaderboard. This includes:
- Your user account and all authentication data
- Complete token usage history
- Your position on the leaderboard

⚠️ **Warning**: Account deletion is permanent and cannot be undone. You'll need to type your Twitter handle to confirm this action.

## Development

```bash
# Install dependencies
npm install

# Test the CLI locally
node bin/cli.js --help
```

## Support

For issues or questions:
- Check that Claude Code is properly installed
- Verify your Twitter authentication
- Ensure Node.js 16+ is installed
- Check network connectivity

## Contributing

This is an open source project! Contributions are welcome.