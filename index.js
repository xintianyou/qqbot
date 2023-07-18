// ESModule | TypeScript
// import { createOpenAPI, createWebsocket } from 'qq-guild-bot';

// CommonJs
const { createOpenAPI, createWebsocket } = require('qq-guild-bot');
const axios = require('axios');
const mysql = require('mysql');
const dotenv = require('dotenv');
dotenv.config('./env');

const connection = mysql.createPool({
  host: process.env.HOST,	//连接的数据库地址。（默认:localhost）
  user: process.env.USER,		//mysql的连接用户名
  port: process.env.PORT,
  password: process.env.PASSWORD,		// 对应用户的密码
  database: process.env.DATABASE,  		//所需要连接的数据库的名称（可选）
  // useConnectionPooling: true //增加该配置
  connectionLimit : 10,
});

// connection.connect();

function insertDataBase({ uid, message_id, answer, conversationId, question, isPrivate }) {
  return new Promise((resolve, reject) => {
    connection.query(
      `INSERT INTO messages(uid, message_id, answer, conversationId, question, isPrivate, createdAt) VALUES(?,?,?,?,?,?,?)`,
      [uid, message_id, answer, conversationId, question, isPrivate, +new Date()],
      (error, result) => {
        if (error) {
          reject(error)
          return
        }
        resolve(result)
      }
    )
  })
}
function parseData(res) {
  return JSON.parse(JSON.stringify(res))
}
function getMsgByUid(uid, isPrivate) {
  return new Promise((resolve, reject) => {
    connection.query(`SELECT * from messages WHERE uid = ${uid} AND isPrivate = ${isPrivate} ORDER BY createdAt DESC`, (error, results, fields) => {
      if (error) {
        reject(error)
        return
      }
      resolve(parseData(results)[0])
    });
  })
}

function delMsgByUid(uid) {
  return new Promise((resolve, reject) => {
    connection.query(`DELETE from messages WHERE uid = ${uid}`, (error, result) => {
      if (error) {
        reject(error)
        return
      }
      resolve(result)
    });
  })
}

function getMsgByMsgId(msg_id) {
  return new Promise((resolve, reject) => {
    connection.query(`SELECT * from messages WHERE message_id = '${msg_id}'`, (error, results, fields) => {
      if (error) {
        reject(error)
        return
      }
      resolve(parseData(results)[0])
    });
  })
}


const CLAUDE_CONFIG = {
  appID: process.env.CLAUDE_APPID, // 申请机器人时获取到的机器人 BotAppID
  token: process.env.CLAUDE_TOKEN, // 申请机器人时获取到的机器人 BotToken
  intents: ['PUBLIC_GUILD_MESSAGES', 'DIRECT_MESSAGE'], // 事件订阅,用于开启可接收的消息类型
  sandbox: false, // 沙箱支持，可选，默认false. v2.7.0+
}
const GPT4_CONFIG = {
  appID: process.env.GPT4_APPID, // 申请机器人时获取到的机器人 BotAppID
  token: process.env.GPT4_TOKEN, // 申请机器人时获取到的机器人 BotToken
  intents: ['PUBLIC_GUILD_MESSAGES', 'DIRECT_MESSAGE'], // 事件订阅,用于开启可接收的消息类型
  sandbox: false, // 沙箱支持，可选，默认false. v2.7.0+
}

claudeInit()
// gpt4Init()

async function claudeInit() {
  // 创建 client
  const client = createOpenAPI(CLAUDE_CONFIG);

  // // 获取当前用户信息
  let { data: botInfo } = await client.meApi.me();
  // console.log('[ userData ] >', botInfo)

  // // 获取频道列表
  // let { data: channelData } = await client.meApi.meGuilds({});
  // console.log('[ channelData ] >', channelData)

  // 创建 websocket 连接
  const ws = createWebsocket(CLAUDE_CONFIG);

  ws.on('DIRECT_MESSAGE', async data => {
    console.log('Claude [DIRECT_MESSAGE] 私聊事件接收 :', data);
    if (data.eventType !== 'DIRECT_MESSAGE_CREATE') {
      return
    }
    try {
      const question = data.msg.content

      if (question.trim() === '/reset') {
        await delMsgByUid(data.msg.author.id)
        await replyPrivateChat(data, '好的，已为您清空上下文', client)
        return
      }
      
      // 获取上下文
      const res = await getMsgByUid(data.msg.author.id, 1)
      // 获取Claude回复
      const { answer, conversationId } = await getClaudeReply(question, res?.conversationId)
      
      let content = handleReplyText(answer || '')
      console.log('[ 私聊回复内容 ] >', content, conversationId)

      // 回复私聊消息给用户
      const botReply = await replyPrivateChat(data, content, client)
      console.log('[ botReply ] >', botReply)
      
      // 向数据库插入
      await insertDataBase({
        uid: data.msg.author.id, 
        message_id: data.msg.id,
        answer,
        conversationId,
        question,
        isPrivate: 1
      })
      
    } catch (error) {
      console.log('[ error ] >', error)
      await replyPrivateChat(data, 'Error ' + JSON.stringify(error), client)
    }
  })
  
  ws.on('PUBLIC_GUILD_MESSAGES', async data => {
    console.log('Claude [PUBLIC_GUILD_MESSAGES] 群聊事件接收 :', data);
    if (data.eventType !== 'AT_MESSAGE_CREATE') {
      return
    }
    try {
      if (!data.msg.content.startsWith(`<@!${botInfo.id}>`)) {
        // 群聊必须@机器人，否则格式不正确，不管它
        console.log('格式不正确');
        return
      }
      // 拿到用户的提问
      const content = data.msg.content.match(/> (.*)/)
      if (!content) {
        // 只有@没有提问
        await replyPublicChat(data, '请问你有什么要问的', client)
      }
      const question = content[1]
      
      if (question.trim().includes("/私聊")) {
        try {
          // 创建私信会话
          let { data: createDirectMsgRes } = await client.directMessageApi.createDirectMessage({
            source_guild_id: data.msg.guild_id,
            recipient_id: data.msg.author.id
          });
          console.log('[ 创建私信会话 createDirectMsgRes ] >', createDirectMsgRes)
          // 主动发送私信
          const sendPrivateCbData = await replyPrivateChat({
            msg: {
              guild_id: createDirectMsgRes.guild_id,
            }
          }, '你好，我们可以开始私聊了', client)
          console.log('[ 群聊中 "/私聊" 指令发送私信执行结果 ] >', sendPrivateCbData)

          // 回复消息
          await replyPublicChat(data, '请查收私信', client)
        } catch (error) {
          console.log('[ error ] >', error)
          await replyPublicChat(data, JSON.stringify(error), client)
        }
      } else {
        await replyPublicChat(data, '机器人正在思考中，请稍后...', client)

        let res;
        if (data.msg.message_reference) {
          // 拿到用户引用回复机器人的消息id
          const { message_id } = data.msg.message_reference 
          // 通过message_id拿到上下文
          res = await getMsgByMsgId(message_id)
          console.log('[ 通过 message_id 获取上下文 ] >', res)
        }

        // 获取机器人回复
        const { answer, conversationId } = await getClaudeReply(question, res?.conversationId)
        
        let content = handleReplyText(answer || '')
        console.log('[ 群聊回复内容 ] >', content, conversationId)
        
        const botReply = await replyPublicChat(data, content, client)
        console.log('[ botReply ] >', botReply)
        // 向数据库插入
        await insertDataBase({
          uid: data.msg.author.id, 
          message_id: botReply.id,
          answer,
          conversationId,
          question,
          isPrivate: 0
        })
      }
    } catch (error) {
      console.log('[ error ] >', error)
      await replyPublicChat(data, 'Error ' + JSON.stringify(error), client)
    }
  });
}

// 获取claude回复
async function getClaudeReply(question, conversationId) {
  console.log(question, conversationId);
  try {
    let res;
    if (conversationId) {
      res = await axios.post('https://t1nvfu.laf.run/claude-for-qqbot', { question, conversationId })
    } else {
      res = await axios.post('https://t1nvfu.laf.run/claude-for-qqbot', { question })
    }
    
    return { answer: res.data.text, conversationId: res.data.conversationId }
  } catch (error) {
    console.log('[ 获取claude 回复 error ] >', error)
    return {
      error: "问题太难了 出错了. (uДu〃).",
    }
  }
}
// 处理回复到qq的消息
function handleReplyText(content) {
  return content.replace(/\./g, ' . ').replace(/http:\/\//g, '').replace(/https:\/\//g, '')
}
// 发送私聊消息给用户
async function replyPrivateChat(data, content, client) {
  let extraMsg = {}
  if (data.msg.id) {
    // 如果是主动发送私信，就不会有这个参数，例如群聊中用户使用'/私聊'指令时
    extraMsg = {
      // 要回复的消息 id。带了 msg_id 视为被动回复消息，否则视为主动推送消息
      msg_id: data.msg.id, 
      // 引用消息
      message_reference: {
        // 需要引用回复的消息 ID
        message_id: data.msg.id 
      }
    }
  }
  let { data: sendCbData } = await client.directMessageApi.postDirectMessage(data.msg.guild_id, {
    // 回复内容
    content,
    ...extraMsg
  });
  return sendCbData
}

// 回复群消息
async function replyPublicChat(data, content, client) {
  let { data: sendCbData } = await client.messageApi.postMessage(data.msg.channel_id, {
    // 回复内容
    content,
    // 要回复的消息 id。带了 msg_id 视为被动回复消息，否则视为主动推送消息
    msg_id: data.msg.id, 
    // 引用消息
    message_reference: {
      // 需要引用回复的消息 ID
      message_id: data.msg.id 
    }
  });
  return sendCbData
}

async function gpt4Init() {
  // 创建 client
  const client = createOpenAPI(GPT4_CONFIG);
  // 创建 websocket 连接
  const ws = createWebsocket(GPT4_CONFIG);
  ws.on('DIRECT_MESSAGE', async data => {
    console.log('[DIRECT_MESSAGE] 事件接收 :', data);
  })
  ws.on('PUBLIC_GUILD_MESSAGES', async data => {
    console.log('[PUBLIC_GUILD_MESSAGES] 事件接收 :', data);
    if (data.eventType !== 'AT_MESSAGE_CREATE') {
      return
    }
    try {
      await client.messageApi.postMessage(data.msg.channel_id, {
        content: 'ai正在思考中，请稍后...',
        msg_id: data.msg.id,
        message_reference: {
          message_id: data.msg.id
        }
      });
      const question = data.msg.content.match(/> (.*)/)[1]
      if (!question) return
      const gpt4Res = await axios.get(`https://wecbxqdixdko.cloud.sealos.io/ask?prompt=${question}&model=gpt4&site=forefront`)
      console.log('[ gpt4Res ] >', gpt4Res)
      const gpt4Answer = gpt4Res.data
      console.log('[ gpt4Answer ] >', gpt4Answer)
      let content = gpt4Answer.content.replace(/\./g, ' . ').replace(/http:\/\//g, '').replace(/https:\/\//g, '')
      console.log('[ 回复内容content ] >', content)
      // return
      let { data: sendCbData } = await client.messageApi.postMessage(data.msg.channel_id, {
        // 回复内容
        content: '你好！' + content,
        // 要回复的消息 id。带了 msg_id 视为被动回复消息，否则视为主动推送消息
        msg_id: data.msg.id, 
        // 引用消息
        message_reference: {
          // 需要引用回复的消息 ID
          message_id: data.msg.id 
        }
      });
      console.log('[ 机器人发送消息返回data ] >', sendCbData)
    } catch (error) {
      console.log('[ error ] >', error)
      await client.messageApi.postMessage(data.msg.channel_id, {
        content: 'qq机器人报错了 ' + JSON.stringify(error),
        msg_id: data.msg.id,
        message_reference: {
          message_id: data.msg.id
        }
      });
      console.log('[ error ] >', error)
    }
  });
}


