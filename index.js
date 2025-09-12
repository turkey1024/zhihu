export default {
  async scheduled(event, env, ctx) {
    // 处理定时任务
    try {
      await processZhihuDaily(env);
    } catch (error) {
      console.error('定时任务执行失败:', error.message);
    }
  },

  async fetch(request, env) {
    // 设置CORS头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // 处理预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 允许手动触发
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
  
  // 1. 获取知乎日报数据
  const zhihuData = await fetchZhihuDaily(env.ALAPI_TOKEN);
  console.log('知乎数据获取成功，故事数量:', zhihuData.data.stories.length);
  
  // 2. 解析数据
  const issueContent = formatIssueContent(zhihuData);
  const issueTitle = zhihuData.data.stories[0].title;
  console.log('Issue标题:', issueTitle);
  
  // 3. 创建GitHub Issue
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
  console.log('正在调用知乎API v3...');
  
  // 使用v3 API地址
  const apiUrl = `https://v3.alapi.cn/api/zhihu/today?token=${token}`;
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
  console.log('知乎API响应消息:', data.message);
  
  if (data.code !== 200 || !data.success) {
    throw new Error(`知乎API返回错误: ${data.message || '未知错误'}`);
  }
  
  if (!data.data || !data.data.stories) {
    throw new Error('知乎API返回数据格式不正确');
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
  
  // 添加top_stories（如果有）
  if (zhihuData.data.top_stories && zhihuData.data.top_stories.length > 0) {
    content += `# 热门故事\n\n`;
    zhihuData.data.top_stories.forEach((story, index) => {
      content += `## 热门 ${index + 1}. ${story.title}\n`;
      content += `**作者**: ${story.hint}\n\n`;
      
      if (story.image) {
        content += `![热门图片](${story.image})\n\n`;
      }
      
      content += `[阅读热门原文](${story.url})\n\n`;
      content += "---\n\n";
    });
  }
  
  // 添加元数据
  content += `*自动生成于 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}*\n`;
  content += `*数据来源: 知乎日报 API*`;
  
  return content;
}

async function createGitHubIssue(owner, repo, title, body, token) {
  console.log('正在创建GitHub Issue...');
  console.log('仓库:', `${owner}/${repo}`);
  
  if (!token) {
    throw new Error('GitHub Token未设置');
  }
  
  // 截断过长的标题（GitHub Issue标题限制）
  const truncatedTitle = title.length > 100 ? title.substring(0, 97) + '...' : title;
  
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Cloudflare-Worker-Zhihu-Daily',
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: truncatedTitle,
      body: body,
      labels: ['documentation', 'zhihu-daily']
    })
  });
  
  const responseText = await response.text();
  console.log('GitHub API响应状态:', response.status);
  
  if (!response.ok) {
    console.error('GitHub API错误详情:', responseText);
    throw new Error(`GitHub API错误: ${response.status} - ${responseText}`);
  }
  
  return JSON.parse(responseText);
}

