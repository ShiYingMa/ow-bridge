import os from 'node:os';
import path from 'node:path';

// CodeBuddy（腾讯云代码助手）用户级模型配置，与 WorkBuddy 同源 models.json 结构。
// 用户级目录为 ~/.codebuddy，项目级为 <workspace>/.codebuddy；这里默认写用户级。
export function resolveCodeBuddyModelsFile({ env = process.env, home = os.homedir() } = {}) {
  return env.BUDDY_CODEBUDDY_MODELS_FILE?.trim() || path.join(home, '.codebuddy', 'models.json');
}
