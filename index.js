export default {
  async scheduled(event, env, ctx) {
    try {
      await processZhihuDaily(env);
    } catch (error) {
      console.error('定时任务执行失败:', error.message);
    }
  },

  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (url.pathname === '/trigger') {
      try {
        const result = await processZhihuDaily(env);
        return new Response(JSON.stringify({
          success: true,
          message: '手动触发成功',
          issue_url: result.html_url
        }), {
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error.message
        }), {
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }
    
    return new Response('知乎日报自动发布服务运行中\n访问 /trigger 手动触发', {
      headers: corsHeaders
    });
  }
};

async function processZhihuDaily(env) {
  console.log('开始处理知乎日报数据...');
  
  const zhihuData = await fetchZhihuDaily(env.ALAPI_TOKEN);
  console.log('知乎数据获取成功，故事数量:', zhihuData.data.stories.length);
  
  const issueContent = formatIssueContent(zhihuData);
  
  // 修改：使用日期作为Issue标题
  const date = zhihuData.data.date;
  const formattedDate = `${date.substr(0,4)}-${date.substr(4,2)}-${date.substr(6,2)}`;
  const issueTitle = `知乎日报 ${formattedDate}`;
  
  console.log('Issue标题:', issueTitle);
  
  const result = await createGitHubIssue(
    env.GITHUB_OWNER,
    env.GITHUB_REPO,
    issueTitle,
    issueContent,
    env.GITHUB_TOKEN
  );
  
  console.log('Issue创建成功:', result.html_url);
  return result;
}

async function fetchZhihuDaily(token) {
  console.log('正在调用知乎API...');
  
  const apiUrl = `https://v3.alapi.cn/api/zhihu?token=${token}`;
  console.log('API URL:', apiUrl);
  
  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Cloudflare-Worker-Zhihu-Daily/1.0'
    }
  });
  
  if (!response.ok) {
    throw new Error(`知乎API请求失败: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  console.log('知乎API响应代码:', data.code);
  
  if (data.code !== 200 || !data.success) {
    throw new Error(`知乎API返回错误: ${data.message || '未知错误'}`);
  }
  
  return data;
}

// 解析hint字段的函数
function parseHint(hint) {
  let author = '未知作者';
  let readingTime = '';
  
  if (hint) {
    // 匹配模式：作者 · 时间阅读 或 作者 / 时间阅读
    const match = hint.match(/^(.+?)[·/]\s*(\d+\s*分钟阅读)$/);
    if (match) {
      author = match[1].trim();
      readingTime = match[2].trim();
    } else if (hint.includes('分钟阅读')) {
      // 如果只有时间没有作者
      readingTime = hint.trim();
    } else {
      // 如果只有作者没有时间，或者格式不符
      author = hint.trim();
    }
  }
  
  return { author, readingTime };
}

function formatIssueContent(zhihuData) {
  const date = zhihuData.data.date;
  const stories = zhihuData.data.stories;
  
  let content = `# 知乎日报 ${date.substr(0,4)}-${date.substr(4,2)}-${date.substr(6,2)}\n\n`;
  
  // 添加所有故事
  stories.forEach((story, index) => {
    const { author, readingTime } = parseHint(story.hint);
    
    content += `## ${index + 1}. ${story.title}\n`;
    content += `**作者**: ${author}\n`;
    
    if (readingTime) {
      content += `**阅读时间**: ${readingTime}\n\n`;
    } else {
      content += '\n';
    }
    
    if (story.images && story.images.length > 0) {
      content += `![图片](${story.images[0]})\n\n`;
    }
    
    content += `[阅读原文](${story.url})\n\n`;
    content += "---\n\n";
  });
  
  content += `*自动生成于 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}*`;
  
  return content;
}

async function createGitHubIssue(owner, repo, title, body, token) {
  console.log('正在创建GitHub Issue...');
  
  if (!token) {
    throw new Error('GitHub Token未设置');
  }
  
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Cloudflare-Worker-Zhihu-Daily',
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: title,
      body: body,
      labels: ['documentation']
    })
  });
  
  const responseText = await response.text();
  console.log('GitHub API响应状态:', response.status);
  
  if (!response.ok) {
    throw new Error(`GitHub API错误: ${response.status} - ${responseText}`);
  }
  
  return JSON.parse(responseText);
}

