#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { authCommand } from '../src/commands/auth.js';
import { resetCommand } from '../src/commands/reset.js';
import { checkAuthStatus, loadConfig } from '../src/utils/config.js';
import { ensureHookInstalled } from '../src/utils/hook-installer.js';
import { checkAndRunMigration } from '../src/utils/migration.js';
import { checkNeedsFullReset, performFullReset } from '../src/utils/auto-reset.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json for version
const packagePath = join(__dirname, '..', 'package.json');
const packageData = JSON.parse(await readFile(packagePath, 'utf-8'));

// Check if user needs a full reset (delete and re-auth)
// Skip this check if running the reset command
let needsReauth = false;
const isResetCommand = process.argv[2] === 'reset';

if (!isResetCommand) {
  const resetCheck = await checkNeedsFullReset();

  if (resetCheck.needsReset) {
    console.log(chalk.yellow('🔄 Account needs to be reset for CLI update...'));
    
    const config = await loadConfig();
    
    if (resetCheck.clearLocalOnly) {
      // User doesn't exist in DB, just clear local auth
      const { clearAuthData } = await import('../src/utils/config.js');
      await clearAuthData();
      needsReauth = true;
    } else {
      // Delete user and clear local auth
      await performFullReset(config);
      needsReauth = true;
      console.log(chalk.green('✅ Account reset complete'));
    }
  }
}

// Ensure hook is installed before running any commands
await ensureHookInstalled();

// Skip old migration logic - not needed with simplified approach
// await checkAndRunMigration(false);

const program = new Command();

program
  .name('claudecount')
  .description('Track your Claude Code usage and compete on the leaderboard')
  .version(packageData.version);

// Default command (when no subcommand is specified)
program
  .action(async () => {
    try {
      const authStatus = await checkAuthStatus();
      
      if (!authStatus.isAuthenticated || needsReauth) {
        // New user or needs re-auth after reset
        console.log(chalk.blue('🚀 CLAUDE COUNT'));
        console.log(chalk.gray('━'.repeat(40)));
        if (needsReauth) {
          console.log(chalk.yellow('👋 Let\'s reconnect your Twitter account...'));
        } else {
          console.log(chalk.yellow('👋 Welcome! Let\'s connect your Twitter account...'));
        }
        console.log();
        await authCommand({ forceReauth: true });
      } else {
        // Already authenticated and up to date
        console.log(chalk.green(`✅ Ready! Authenticated as ${authStatus.twitterHandle}`));
      }
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
      process.exit(1);
    }
  });



// Auth command - explicit authentication
program
  .command('auth')
  .description('Authenticate with Twitter')
  .action(async () => {
    try {
      await authCommand({ forceReauth: true });
    } catch (error) {
      console.error(chalk.red('❌ Authentication failed:'), error.message);
      process.exit(1);
    }
  });

// Reset command
program
  .command('reset')
  .description('Reset configuration and clear authentication data')
  .option('-f, --force', 'Skip confirmation prompt')
  .option('-d, --delete-account', 'Also delete account from database (requires --force or confirmation)')
  .option('-v, --verbose', 'Show detailed information about what was cleared')
  .action(async (options) => {
    try {
      await resetCommand(options);
    } catch (error) {
      console.error(chalk.red('❌ Error resetting configuration:'), error.message);
      process.exit(1);
    }
  });

// Help command
program
  .command('help')
  .description('Show help information')
  .action(() => {
    program.help();
  });

// Error handling
program.on('command:*', () => {
  console.error(chalk.red('❌ Invalid command:'), chalk.yellow(program.args.join(' ')));
  console.log(chalk.gray('Run'), chalk.cyan('claudecount --help'), chalk.gray('for available commands'));
  process.exit(1);
});

// Parse arguments
program.parse(process.argv);