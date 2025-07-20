import chalk from 'chalk';
import { checkAuthStatus } from '../utils/config.js';
import { authenticatedFetch } from '../utils/api.js';

export async function statsCommand() {
  console.log(chalk.blue('📊 Your Usage Statistics'));
  console.log(chalk.gray('━'.repeat(30)));
  
  const authStatus = await checkAuthStatus();
  
  if (!authStatus.isAuthenticated) {
    console.log(chalk.yellow('⚠️ You need to authenticate first'));
    console.log(chalk.gray('Run'), chalk.cyan('codebrag auth'), chalk.gray('to get started'));
    return;
  }
  
  try {
    // Fetch user stats from API with automatic token refresh
    const response = await authenticatedFetch(`/api/user/stats?twitter_user_id=${authStatus.twitterUserId}`);
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    console.log(chalk.green(`👤 User: ${chalk.cyan(authStatus.twitterHandle)}`));
    console.log(chalk.green(`🏆 Rank: ${chalk.cyan(`#${data.user.rank}`)} of ${chalk.cyan(data.user.total_users)} users`));
    console.log();
    console.log(chalk.blue('📈 Usage Stats:'));
    console.log(chalk.gray('━'.repeat(20)));
    console.log(`Total Tokens: ${chalk.cyan(data.stats.total_tokens.toLocaleString())}`);
    console.log(`This Month: ${chalk.cyan(data.stats.monthly_tokens.toLocaleString())}`);
    console.log(`Sessions: ${chalk.cyan(data.stats.sessions_count)}`);
    console.log(`Favorite Model: ${chalk.cyan(data.stats.favorite_model)}`);
    console.log(`Last Activity: ${chalk.cyan(new Date(data.stats.last_activity).toLocaleString())}`);
    
    console.log();
    console.log(chalk.gray('💡 Run'), chalk.cyan('codebrag leaderboard'), chalk.gray('to see the full leaderboard'));
    
  } catch (error) {
    console.error(chalk.red('❌ Error fetching stats:'), error.message);
    
    if (error.message.includes('API error')) {
      console.log(chalk.yellow('🔧 Common solutions:'));
      console.log(chalk.gray('• Check if the backend server is running'));
      console.log(chalk.gray('• Verify your internet connection'));
      console.log(chalk.gray('• Try running the command again'));
    }
    
    throw error;
  }
}