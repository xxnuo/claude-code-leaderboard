import chalk from 'chalk';
import { checkAuthStatus } from '../utils/config.js';
import { authenticatedFetch } from '../utils/api.js';

export async function leaderboardCommand(options = {}) {
  console.log(chalk.blue('🏆 Codebrag'));
  console.log(chalk.gray('━'.repeat(30)));
  
  const authStatus = await checkAuthStatus();
  
  if (!authStatus.isAuthenticated) {
    console.log(chalk.yellow('⚠️ You need to authenticate first'));
    console.log(chalk.gray('Run'), chalk.cyan('codebrag auth'), chalk.gray('to get started'));
    return;
  }
  
  try {
    const limit = parseInt(options.limit) || 10;
    
    // Fetch leaderboard from API with automatic token refresh
    const response = await authenticatedFetch(`/api/leaderboard?limit=${limit}&offset=0`);
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    console.log(chalk.green(`📅 Last Updated: ${chalk.cyan(new Date(data.last_updated).toLocaleString())}`));
    console.log(chalk.green(`👥 Total Users: ${chalk.cyan(data.total_users)}`));
    console.log();
    
    // Display leaderboard
    console.log(chalk.blue('🏅 Top Users:'));
    console.log(chalk.gray('━'.repeat(60)));
    
    data.leaderboard.forEach((user, index) => {
      const rank = user.rank;
      const username = user.twitter_username;
      const totalTokens = user.total_tokens.toLocaleString();
      const monthlyTokens = user.monthly_tokens.toLocaleString();
      
      // Highlight current user
      const isCurrentUser = username === authStatus.twitterHandle.replace('@', '');
      const color = isCurrentUser ? chalk.yellow : chalk.white;
      
      // Medal for top 3
      let medal = '';
      if (rank === 1) medal = '🥇';
      else if (rank === 2) medal = '🥈';
      else if (rank === 3) medal = '🥉';
      else medal = '  ';
      
      console.log(
        `${medal} ${color(`#${rank.toString().padStart(2)}`)} ${color(username.padEnd(20))} ` +
        `${color(totalTokens.padStart(12))} total ${color(`(${monthlyTokens} this month)`)}`
      );
    });
    
    console.log();
    console.log(chalk.gray('💡 Run'), chalk.cyan('codebrag stats'), chalk.gray('to see your detailed statistics'));
    
  } catch (error) {
    console.error(chalk.red('❌ Error fetching leaderboard:'), error.message);
    
    if (error.message.includes('API error')) {
      console.log(chalk.yellow('🔧 Common solutions:'));
      console.log(chalk.gray('• Check if the backend server is running'));
      console.log(chalk.gray('• Verify your internet connection'));
      console.log(chalk.gray('• Try running the command again'));
    }
    
    throw error;
  }
}