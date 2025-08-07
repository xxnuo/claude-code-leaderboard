#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { authCommand } from '../src/commands/auth.js';
import { resetCommand } from '../src/commands/reset.js';
import { checkAuthStatus } from '../src/utils/config.js';
import { ensureHookInstalled } from '../src/utils/hook-installer.js';
import { checkAndRunMigration } from '../src/utils/migration.js';
import { performSilentReset, shouldPerformReset } from '../src/utils/auto-reset.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json for version
const packagePath = join(__dirname, '..', 'package.json');
const packageData = JSON.parse(await readFile(packagePath, 'utf-8'));

// Perform silent auto-reset for authenticated users
// This runs BEFORE hook installation to ensure clean state
let didAutoReset = false;
if (await shouldPerformReset()) {
  const resetResult = await performSilentReset();
  didAutoReset = resetResult.success || resetResult.skipped;
  // Continue regardless of result - don't interrupt user flow
}

// Ensure hook is installed before running any commands
await ensureHookInstalled();

// Check for migration if authenticated
// Pass flag to indicate if auto-reset already ran
await checkAndRunMigration(didAutoReset);

const program = new Command();

program
  .name('claudecount')
  .description('Track your Claude Code usage and compete on the leaderboard')
  .version(packageData.version);

// Default command (when no subcommand is specified)
program
  .action(async () => {
    console.log(chalk.blue('🚀 CLAUDE COUNT'));
    console.log(chalk.gray('━'.repeat(40)));
    
    try {
      const authStatus = await checkAuthStatus();
      
      if (!authStatus.isAuthenticated) {
        console.log(chalk.yellow('👋 Welcome! Let\'s connect your Twitter account...'));
        console.log();
      }
      
      // Run authentication flow
      await authCommand();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
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
  console.log(chalk.gray('Run'), chalk.cyan('claudecount --help'), chalk.gray('for available commands'));
  process.exit(1);
});

// Parse arguments
program.parse(process.argv);