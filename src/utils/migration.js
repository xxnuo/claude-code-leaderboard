import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import ora from 'ora';
import chalk from 'chalk';
import { scanAllHistoricalUsage } from './usage-scanner.js';
import { uploadShardedNdjson } from './bulk-uploader.js';
import { getValidAccessToken } from '../auth/tokens.js';
import { loadConfig, clearAuthData } from './config.js';
import { CLI_VERSION } from './constants.js';
import { authCommand } from '../commands/auth.js';

const MIGRATION_MARKER_PATH = path.join(homedir(), '.claude', 'migration_v2_complete');

/**
 * Check if migration to v2 has been completed
 */
export async function isMigrationComplete() {
  return existsSync(MIGRATION_MARKER_PATH);
}

/**
 * Mark migration as complete
 */
async function markMigrationComplete() {
  await writeFile(MIGRATION_MARKER_PATH, JSON.stringify({
    migrated_at: new Date().toISOString(),
    version: CLI_VERSION
  }));
}

/**
 * Reset user data on backend
 */
async function resetUserData(tokens) {
  const config = await loadConfig();
  const base = process.env.API_BASE_URL || config.endpoint || 'https://api.claudecount.com';
  const url = `${base}/api/user/reset`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OAuth-Token': tokens.oauth_token,
      'X-OAuth-Token-Secret': tokens.oauth_token_secret,
      'X-CLI-Version': CLI_VERSION
    }
  });
  
  if (!response.ok) {
    const error = await response.text();
    
    // If user doesn't exist (404), they're probably a new user or haven't synced yet
    // Skip migration in this case
    if (response.status === 404 && error.includes('User not found')) {
      throw new Error('USER_NOT_FOUND');
    }
    
    throw new Error(`Failed to reset user data: ${error}`);
  }
  
  return await response.json();
}

/**
 * Run the migration process
 * @param {boolean} isNewAuth - True if this is being called right after authentication
 */
export async function runMigration(isNewAuth = false) {
  // Check if already migrated
  if (await isMigrationComplete()) {
    return { alreadyMigrated: true };
  }
  
  // If this is a new authentication, mark as migrated and skip
  // (OAuth flow will handle bulk import for new users)
  if (isNewAuth) {
    await markMigrationComplete();
    return { alreadyMigrated: true, newUser: true };
  }
  
  console.log();
  console.log(chalk.blue('🔄 Important Update Required'));
  console.log(chalk.gray('━'.repeat(40)));
  console.log(chalk.yellow('We need to update your data to work with the new CLI version.'));
  console.log(chalk.gray('This is a one-time process that will:'));
  console.log(chalk.gray('  1. Reset your backend data'));
  console.log(chalk.gray('  2. Re-import all your historical usage'));
  console.log(chalk.gray('  3. Ensure everything is synced correctly'));
  console.log();
  
  const migrationSpinner = ora('Starting migration...').start();
  
  try {
    // Get OAuth tokens
    const tokens = await getValidAccessToken();
    if (!tokens) {
      migrationSpinner.fail('Not authenticated. Please run auth first.');
      return { success: false, error: 'Not authenticated' };
    }
    
    // Step 1: Reset backend data
    migrationSpinner.text = 'Resetting backend data...';
    try {
      const resetResult = await resetUserData(tokens);
      migrationSpinner.succeed(`Backend data reset for ${resetResult.user_id}`);
    } catch (error) {
      if (error.message === 'USER_NOT_FOUND') {
        // User doesn't exist in backend - clear invalid auth and trigger re-auth
        migrationSpinner.info('User not found in backend - clearing invalid auth');
        await clearAuthData();
        return { success: false, needsAuth: true };
      }
      throw error;
    }
    
    // Step 2: Scan all historical usage
    const scanSpinner = ora('Scanning historical usage...').start();
    const { entries, totals } = await scanAllHistoricalUsage(false);
    
    if (entries.length === 0) {
      scanSpinner.info('No historical usage found to import');
      await markMigrationComplete();
      return { success: true, imported: 0 };
    }
    
    scanSpinner.succeed(`Found ${entries.length.toLocaleString()} usage entries (${totals.total.toLocaleString()} tokens)`);
    
    // Step 3: Bulk upload all data
    const uploadSpinner = ora('Re-importing all usage data...').start();
    
    // Convert entries to NDJSON lines for upload
    const lines = entries.map(e => JSON.stringify({
      timestamp: e.timestamp,
      tokens: e.tokens,
      model: e.model,
      interaction_id: e.interaction_id
    }));
    
    const { processed, failed } = await uploadShardedNdjson({ 
      lines,
      tokens
    });
    
    if (failed > 0) {
      uploadSpinner.warn(`Imported ${processed.toLocaleString()} entries (${failed} failed)`);
    } else {
      uploadSpinner.succeed(`Successfully imported ${processed.toLocaleString()} entries`);
    }
    
    // Step 4: Mark migration as complete
    await markMigrationComplete();
    
    console.log();
    console.log(chalk.green('✅ Migration complete!'));
    console.log(chalk.gray('Your data has been successfully updated to work with the new CLI.'));
    console.log();
    
    return { success: true, imported: processed, failed };
    
  } catch (error) {
    migrationSpinner.fail(`Migration failed: ${error.message}`);
    console.error(chalk.red('Please try again or contact support if the issue persists.'));
    return { success: false, error: error.message };
  }
}

/**
 * Check if user needs migration and prompt if necessary
 */
export async function checkAndRunMigration() {
  // Check if migration is needed
  if (await isMigrationComplete()) {
    return;
  }
  
  // Check if authenticated (need OAuth tokens for migration)
  try {
    const tokens = await getValidAccessToken();
    if (!tokens) {
      // No tokens, skip migration
      return;
    }
  } catch (error) {
    // Not authenticated or tokens invalid, skip migration
    return;
  }
  
  // Run migration
  console.log();
  console.log(chalk.yellow('📢 A data migration is required for this new version.'));
  const result = await runMigration();
  
  // If user needs auth, run auth command directly
  if (result.needsAuth) {
    console.log(chalk.yellow('🔐 Re-authentication required...'));
    await authCommand();
    return; // Auth command handles migration after successful auth
  }
  
  if (!result.success && !result.alreadyMigrated) {
    console.error(chalk.red('❌ Migration failed. Some features may not work correctly.'));
    console.error(chalk.yellow('Please try running the command again.'));
    process.exit(1);
  }
}