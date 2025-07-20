#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { authCommand } from '../src/commands/auth.js';
import { statsCommand } from '../src/commands/stats.js';
import { leaderboardCommand } from '../src/commands/leaderboard.js';
import { resetCommand } from '../src/commands/reset.js';
import { checkAuthStatus } from '../src/utils/config.js';
import { ensureHookInstalled } from '../src/utils/hook-installer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json for version
const packagePath = join(__dirname, '..', 'package.json');
const packageData = JSON.parse(await readFile(packagePath, 'utf-8'));

// Ensure hook is installed before running any commands
await ensureHookInstalled();

const program = new Command();

program
  .name('codebrag')
  .description('Track your Claude Code usage and compete on the leaderboard')
  .version(packageData.version);

// Default command (when no subcommand is specified)
program
  .action(async () => {
    console.log(chalk.blue('🚀 Codebrag'));
    console.log(chalk.gray('━'.repeat(40)));
    
    try {
      const authStatus = await checkAuthStatus();
      
      if (!authStatus.isAuthenticated) {
        console.log(chalk.yellow('🔐 Authentication required'));
        console.log(chalk.gray('To track your usage and join the leaderboard, you need to authenticate with Twitter.'));
        console.log();
        
        // Run authentication flow
        await authCommand();
      } else {
        console.log(chalk.green(`👋 Welcome back ${authStatus.twitterHandle}!`));
        console.log();
        
        // Show current stats
        await statsCommand();
      }
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
      process.exit(1);
    }
  });

// Auth command
program
  .command('auth')
  .description('Authenticate with Twitter')
  .action(async () => {
    try {
      await authCommand();
    } catch (error) {
      console.error(chalk.red('❌ Authentication failed:'), error.message);
      process.exit(1);
    }
  });

// Stats command
program
  .command('stats')
  .description('View your usage statistics')
  .action(async () => {
    try {
      await statsCommand();
    } catch (error) {
      console.error(chalk.red('❌ Error fetching stats:'), error.message);
      process.exit(1);
    }
  });

// Leaderboard command
program
  .command('leaderboard')
  .description('View the current leaderboard')
  .option('-l, --limit <number>', 'Number of users to show', '10')
  .action(async (options) => {
    try {
      await leaderboardCommand(options);
    } catch (error) {
      console.error(chalk.red('❌ Error fetching leaderboard:'), error.message);
      process.exit(1);
    }
  });

// Reset command
program
  .command('reset')
  .description('Reset configuration and clear authentication data')
  .option('-f, --force', 'Skip confirmation prompt')
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
  console.log(chalk.gray('Run'), chalk.cyan('codebrag --help'), chalk.gray('for available commands'));
  process.exit(1);
});

// Parse arguments
program.parse(process.argv);