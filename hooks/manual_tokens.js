#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { homedir } from "node:os";
import https from "node:https";
import http from "node:http";
import crypto from "node:crypto";
import readline from "node:readline";
import { createGzip } from "node:zlib";
import { Readable } from "node:stream";
import { uploadShardedNdjson } from "../src/utils/bulk-uploader.js";
import { getValidAccessToken } from "../src/auth/tokens.js";
import { loadConfig } from "../src/utils/config.js";
import { CLI_VERSION } from "../src/utils/constants.js";

const USER_HOME_DIR = homedir();

// 创建命令行交互界面
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// 生成随机的交互ID
function generateInteractionHash() {
  const timestamp = new Date().toISOString();
  const randomValue = Math.random().toString();
  return crypto
    .createHash("sha256")
    .update(`${timestamp}${randomValue}`)
    .digest("hex");
}

// 生成随机用量数据
function generateRandomUsage(config, count = 1) {
  const entries = [];

  for (let i = 0; i < count; i++) {
    // 生成随机的输入token数量 (1000-32000)
    const input = Math.floor(Math.random() * 31001) + 1000;
    // 生成随机的输出token数量 (10000-32000)
    const output = Math.floor(Math.random() * 22001) + 10000;
    // 模型名称
    const modelName = "claude-opus-4-1-20250805";

    // 随机日期在过去30天内
    const date = new Date();
    date.setDate(date.getDate() - Math.floor(Math.random() * 30));
    const timestamp = date.toISOString();

    const interactionHash = generateInteractionHash();

    entries.push({
      twitter_handle: config.twitterUrl,
      twitter_user_id: config.twitterUserId || config.twitterUrl,
      timestamp: timestamp,
      tokens: {
        input: input,
        output: output,
        cache_creation: 0,
        cache_read: 0,
      },
      model: modelName,
      interaction_id: interactionHash,
      interaction_hash: interactionHash,
    });
  }

  return entries;
}

// 保存进度
async function saveProgress(progress) {
  const progressPath = path.join(
    USER_HOME_DIR,
    ".claude",
    "manual_upload_progress.json"
  );
  try {
    await writeFile(progressPath, JSON.stringify(progress, null, 2), "utf-8");
    return true;
  } catch (error) {
    console.error(`❌ 保存进度失败: ${error.message}`);
    return false;
  }
}

// 加载进度
async function loadProgress() {
  const progressPath = path.join(
    USER_HOME_DIR,
    ".claude",
    "manual_upload_progress.json"
  );
  try {
    const content = await readFile(progressPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// 主函数
async function main() {
  try {
    // 加载配置
    const config = await loadConfig();
    if (!config || config.twitterUrl === "@your_handle") {
      console.error(
        "❌ 未找到有效的认证配置。请先运行 'npx claude-code-leaderboard auth' 进行认证。"
      );
      process.exit(1);
    }

    console.log("🚀 Claude Code 批量用量上传工具");
    console.log("━".repeat(50));
    console.log(`👤 当前用户: ${config.twitterUrl}`);

    // 获取认证令牌
    const tokens = await getValidAccessToken();
    if (!tokens) {
      console.error(
        "❌ 未找到有效的认证令牌。请先运行 'npx claude-code-leaderboard auth' 进行认证。"
      );
      process.exit(1);
    }

    console.log("🔐 OAuth认证: ✅ 已配置");
    console.log("━".repeat(50));

    // 检查是否有未完成的上传
    const savedProgress = await loadProgress();
    let resumeUpload = false;
    let entries = [];

    if (
      savedProgress &&
      savedProgress.pendingEntries &&
      savedProgress.pendingEntries.length > 0
    ) {
      console.log("\n⚠️ 检测到未完成的上传任务:");
      console.log(`   待上传记录: ${savedProgress.pendingEntries.length}`);
      console.log(`   已上传记录: ${savedProgress.uploadedCount || 0}`);

      resumeUpload = await new Promise((resolve) => {
        rl.question("是否恢复上传? (y/n): ", (answer) => {
          resolve(
            answer.toLowerCase() === "y" || answer.toLowerCase() === "yes"
          );
        });
      });

      if (resumeUpload) {
        entries = savedProgress.pendingEntries;
        console.log(`\n🔄 恢复上传 ${entries.length} 条记录...`);
      }
    }

    if (!resumeUpload) {
      // 询问用户要生成多少条记录
      const askForCount = () => {
        return new Promise((resolve) => {
          rl.question("📊 请输入要生成的记录数量 (1-1000): ", (answer) => {
            const count = parseInt(answer, 10);
            if (isNaN(count) || count < 1 || count > 1000) {
              console.log("❌ 请输入1到1000之间的有效数字。");
              resolve(askForCount());
            } else {
              resolve(count);
            }
          });
        });
      };

      const count = await askForCount();

      console.log(`\n🔄 生成 ${count} 条随机用量数据...`);
      entries = generateRandomUsage(config, count);

      // 保存生成的数据，以便中断时恢复
      await saveProgress({
        pendingEntries: entries,
        uploadedCount: 0,
        timestamp: new Date().toISOString(),
      });
    }

    // 准备上传
    console.log("\n⏳ 正在上传数据...");
    console.log("💡 提示: 上传过程可能需要一些时间，请耐心等待");

    // 将条目转换为NDJSON行以供上传
    const lines = entries.map((entry) => JSON.stringify(entry));

    // 使用bulk-uploader.js中的uploadShardedNdjson函数上传
    try {
      // 捕获SIGINT信号，以便在中断时保存进度
      let interrupted = false;
      const sigintHandler = async () => {
        if (!interrupted) {
          interrupted = true;
          console.log("\n\n⚠️ 检测到中断信号，正在保存进度...");
          // 进度保存由uploadShardedNdjson内部处理
          console.log("✅ 进度已保存。您可以稍后继续上传。");
          process.exit(0);
        }
      };

      // 添加信号处理程序
      process.on("SIGINT", sigintHandler);

      const { processed, failed } = await uploadShardedNdjson({
        lines,
        tokens,
      });

      // 移除信号处理程序
      process.removeListener("SIGINT", sigintHandler);

      console.log("\n━".repeat(50));
      console.log(`✨ 批量上传完成!`);
      console.log(
        `📊 总计: 成功处理 ${processed} 条记录, 失败 ${failed} 条记录`
      );

      // 清除进度文件
      await saveProgress({
        pendingEntries: [],
        uploadedCount: processed,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`\n❌ 上传过程中出错: ${error.message}`);
      console.log("您可以稍后重试，进度已保存。");
    }

    rl.close();
  } catch (error) {
    console.error(`❌ 错误: ${error.message}`);
    rl.close();
    process.exit(1);
  }
}

// 启动程序
main();
