export default {
  async scheduled(event, env, ctx) {
    // 处理定时任务
    await processZhihuDaily(env);
  },

  async fetch(request, env) {
    // 允许手动触发
    if (request.url.includes('/trigger')) {
      await processZhihuDaily(env);
      return new Response('手动触发成功！');
    }
    
    return new Response('知乎日报自动发布服务运行中');
  }
};

async function processZhihuDaily(env) {
  try {
    // 1. 获取知乎日报数据
    const zhihuData = await fetchZhihuDaily(env.ALAPI_TOKEN);
    
    // 2. 解析数据
    const issueContent = formatIssueContent(zhihuData);
    const issueTitle = zhihuData.data.stories[0].title;
    
    // 3. 创建GitHub Issue
    const result = await createGitHubIssue(
      env.GITHUB_OWNER,
      env.GITHUB_REPO,
      issueTitle,
      issueContent,
      env.GITHUB_TOKEN
    );
    
    console.log(`Issue创建成功: ${result.html_url}`);
    return result;
  } catch (error) {
    console.error('处理过程中出错:', error);
    throw error;
  }
}

async function fetchZhihuDaily(token) {
  const response = await fetch(`https://v2.alapi.cn/api/zhihu/today?token=${token}`);
  if (!response.ok) {
    throw new Error(`知乎API请求失败: ${response.status}`);
  }
  
  const data = await response.json();
  if (!data.success) {
    throw new Error(`知乎API返回错误: ${data.message}`);
  }
  
  return data;
}

function formatIssueContent(zhihuData) {
  const date = zhihuData.data.date;
  const stories = zhihuData.data.stories;
  
  let content = `# 知乎日报 ${date.substr(0,4)}-${date.substr(4,2)}-${date.substr(6,2)}\n\n`;
  
  // 添加所有故事
  stories.forEach((story, index) => {
    content += `## ${index + 1}. ${story.title}\n`;
    content += `**阅读时间**: ${story.hint}\n\n`;
    
    if (story.images && story.images.length > 0) {
      content += `![图片](${story.images[0]})\n\n`;
    }
    
    content += `[阅读原文](${story.url})\n\n`;
    content += "---\n\n";
  });
  
  // 添加元数据
  content += `*自动生成于 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}*`;
  
  return content;
}

async function createGitHubIssue(owner, repo, title, body, token) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'User-Agent': 'Cloudflare-Worker',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: title,
      body: body,
      labels: ['documentation']
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API错误: ${response.status} - ${error}`);
  }
  
  return await response.json();
}

