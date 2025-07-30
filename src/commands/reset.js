import chalk from 'chalk';
import inquirer from 'inquirer';
import { removeAllClaudeCountFiles, checkAuthStatus } from '../utils/config.js';
import { authenticatedFetch } from '../utils/api.js';

export async function resetCommand(options = {}) {
  console.log(chalk.red('🔄 Reset Configuration'));
  console.log(chalk.gray('━'.repeat(30)));
  
  // Check current auth status
  const authStatus = await checkAuthStatus();
  
  console.log(chalk.yellow('⚠️  This will remove all CLAUDE COUNT files and settings:'));
  console.log(chalk.gray('   • ~/.claude/leaderboard.json (configuration & auth)'));
  console.log(chalk.gray('   • ~/.claude/count_tokens.js (token tracking hook)'));
  console.log(chalk.gray('   • ~/.claude/.encryption_key (token encryption key)'));
  console.log(chalk.gray('   • ~/.claude/leaderboard_submitted.json (submission tracking)'));
  console.log(chalk.gray('   • Hook configurations from Claude Code settings'));
  
  if (authStatus.isAuthenticated) {
    console.log();
    console.log(chalk.yellow('📌 Current authentication:'));
    console.log(chalk.gray(`   • Twitter handle: ${chalk.cyan(authStatus.twitterHandle)}`));
    console.log(chalk.gray(`   • User ID: ${chalk.cyan(authStatus.twitterUserId)}`));
  }
  
  console.log();
  
  let deleteFromDatabase = false;
  
  // Skip confirmation if --force flag is used
  if (!options.force) {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to completely reset CLAUDE COUNT?',
        default: false
      }
    ]);
    
    if (!confirm) {
      console.log(chalk.yellow('Reset cancelled'));
      return;
    }
    
    // If authenticated, ask if they also want to delete from database
    if (authStatus.isAuthenticated) {
      console.log();
      console.log(chalk.red('🗑️  PERMANENT DATA DELETION'));
      console.log(chalk.yellow('⚠️  Would you also like to DELETE your account from the leaderboard?'));
      console.log(chalk.gray('   This will permanently remove:'));
      console.log(chalk.gray('   • Your user account from the database'));
      console.log(chalk.gray('   • All your token usage history'));
      console.log(chalk.gray('   • Your position on the leaderboard'));
      console.log();
      console.log(chalk.red.bold('   ⚠️  This action CANNOT be undone!'));
      console.log();
      
      const { confirmDelete } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmDelete',
          message: 'Delete your account from the leaderboard database?',
          default: false
        }
      ]);
      
      if (confirmDelete) {
        // Double confirmation for database deletion
        const { confirmDeleteFinal } = await inquirer.prompt([
          {
            type: 'input',
            name: 'confirmDeleteFinal',
            message: `Type "${authStatus.twitterHandle}" to confirm permanent account deletion:`,
            validate: (input) => {
              if (input === authStatus.twitterHandle) {
                return true;
              }
              return `Please type exactly "${authStatus.twitterHandle}" to confirm`;
            }
          }
        ]);
        
        deleteFromDatabase = true;
      }
    }
  }
  
  try {
    // Delete from database first if requested (before removing local auth)
    if (deleteFromDatabase) {
      console.log();
      console.log(chalk.yellow('🗑️  Deleting account from database...'));
      
      try {
        const response = await authenticatedFetch('/api/user/delete', {
          method: 'DELETE'
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || 'Failed to delete account');
        }
        
        const result = await response.json();
        console.log(chalk.green('✅ Account successfully deleted from leaderboard!'));
        console.log(chalk.gray(`   • Removed user: ${result.deleted.user}`));
        console.log(chalk.gray(`   • Deleted ${result.deleted.usage_entries} usage entries`));
      } catch (error) {
        console.error(chalk.red('❌ Failed to delete account from database:'), error.message);
        console.log(chalk.yellow('⚠️  Continuing with local file removal...'));
      }
    }
    
    // Remove all CLAUDE COUNT files
    const results = await removeAllClaudeCountFiles();
    
    console.log();
    console.log(chalk.green('✅ CLAUDE COUNT has been completely reset!'));
    console.log(chalk.gray('Next time you run the CLI, it will:'));
    console.log(chalk.gray('  • Reinstall the token tracking hook'));
    console.log(chalk.gray('  • Create fresh configuration'));
    console.log(chalk.gray('  • Prompt for authentication'));
    console.log();
    console.log(chalk.cyan('Run `claudecount` to start fresh!'));
    
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
      if (results.encryptionKey) {
        console.log(chalk.green('  ✓ Removed ~/.claude/.encryption_key'));
      } else {
        console.log(chalk.gray('  - ~/.claude/.encryption_key (not found)'));
      }
      if (results.submittedFile) {
        console.log(chalk.green('  ✓ Removed ~/.claude/leaderboard_submitted.json'));
      } else {
        console.log(chalk.gray('  - ~/.claude/leaderboard_submitted.json (not found)'));
      }
    }
  } catch (error) {
    console.error(chalk.red('❌ Error resetting configuration:'), error.message);
    throw error;
  }
}