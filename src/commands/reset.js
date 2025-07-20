import chalk from 'chalk';
import inquirer from 'inquirer';
import { removeAllCodebragFiles, checkAuthStatus } from '../utils/config.js';

export async function resetCommand(options = {}) {
  console.log(chalk.red('🔄 Reset Configuration'));
  console.log(chalk.gray('━'.repeat(30)));
  
  // Check current auth status
  const authStatus = await checkAuthStatus();
  
  console.log(chalk.yellow('⚠️  This will remove all Codebrag files and settings:'));
  console.log(chalk.gray('   • ~/.claude/leaderboard.json (configuration & auth)'));
  console.log(chalk.gray('   • ~/.claude/count_tokens.js (token tracking hook)'));
  console.log(chalk.gray('   • Hook configurations from Claude Code settings'));
  
  if (authStatus.isAuthenticated) {
    console.log();
    console.log(chalk.yellow('📌 Current authentication:'));
    console.log(chalk.gray(`   • Twitter handle: ${chalk.cyan(authStatus.twitterHandle)}`));
    console.log(chalk.gray(`   • User ID: ${chalk.cyan(authStatus.twitterUserId)}`));
  }
  
  console.log();
  
  // Skip confirmation if --force flag is used
  if (!options.force) {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to completely reset Codebrag?',
        default: false
      }
    ]);
    
    if (!confirm) {
      console.log(chalk.yellow('Reset cancelled'));
      return;
    }
  }
  
  try {
    // Remove all Codebrag files
    const results = await removeAllCodebragFiles();
    
    console.log();
    console.log(chalk.green('✅ Codebrag has been completely reset!'));
    console.log(chalk.gray('Next time you run the CLI, it will:'));
    console.log(chalk.gray('  • Reinstall the token tracking hook'));
    console.log(chalk.gray('  • Create fresh configuration'));
    console.log(chalk.gray('  • Prompt for authentication'));
    console.log();
    console.log(chalk.cyan('Run `codebrag` to start fresh!'));
    
    if (options.verbose) {
      console.log();
      console.log(chalk.gray('Removal results:'));
      if (results.leaderboardConfig) {
        console.log(chalk.green('  ✓ Removed ~/.claude/leaderboard.json'));
      } else {
        console.log(chalk.gray('  - ~/.claude/leaderboard.json (not found)'));
      }
      if (results.hookScript) {
        console.log(chalk.green('  ✓ Removed ~/.claude/count_tokens.js'));
      } else {
        console.log(chalk.gray('  - ~/.claude/count_tokens.js (not found)'));
      }
      if (results.settingsJson) {
        console.log(chalk.green('  ✓ Removed hook from ~/.claude/settings.json'));
      } else {
        console.log(chalk.gray('  - Hook not found in ~/.claude/settings.json'));
      }
    }
  } catch (error) {
    console.error(chalk.red('❌ Error resetting configuration:'), error.message);
    throw error;
  }
}