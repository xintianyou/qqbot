## qq机器人对接nodejs版

[qq机器人官方文档](https://bot.q.qq.com/wiki/)

[qq机器人接入到qq频道教程](https://qun.qq.com/qqweb/qunpro/share?_wv=3&_wwv=128&appChannel=share&inviteCode=20k6FXeIYvd&contentID=1ngfVN&businessType=2&from=181174&shareSource=5&biz=ka)

[点击链接加入QQ频道【Claude】体验](https://pd.qq.com/s/4u16y5blk)

### 部署
1. 先看教程，创建一个qq机器人
2. 复制`.env.example`命名为`.env`，填写相关环境变量。

### 数据库
- 数据库不是必须的，使用数据库主要是为了保存用户会话和上下文id关联，实现上下文对话