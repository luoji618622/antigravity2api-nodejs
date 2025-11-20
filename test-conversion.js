import { randomUUID } from 'crypto';

function handleUserMessage(message, antigravityMessages){
  antigravityMessages.push({
    role: "user",
    parts: [
      {
        text: message
      }
    ]
  })
}

function handleAssistantMessage(message, antigravityMessages){
  const lastMessage = antigravityMessages[antigravityMessages.length - 1];
  const hasToolCalls = message.tool_calls && message.tool_calls.length > 0;
  const hasContent = message.content && message.content.trim() !== '';
  let antigravityTool = {}
  
  if (hasToolCalls){
    antigravityTool = {
      functionCall: {
        id: message.tool_calls[0].id,
        name: message.tool_calls[0].function.name,
        args: {
          query: message.tool_calls[0].function.arguments
        }
      }
    }
  }
  
  if (lastMessage && lastMessage.role === "model" && hasToolCalls && !hasContent){
    lastMessage.parts.push(antigravityTool)
  }else{
    if (hasToolCalls){
      antigravityMessages.push({
        role: "model",
        parts: [
          {
            text: message.content
          },
          antigravityTool
        ]
      })
    }else{
      antigravityMessages.push({
        role: "model",
        parts: [
          {
            text: message.content
          }
        ]
      })
    }
  }
}

function handleToolCall(message, antigravityMessages){
  let functionName = '';
  for (let i = antigravityMessages.length - 1; i >= 0; i--) {
    if (antigravityMessages[i].role === 'model') {
      const parts = antigravityMessages[i].parts;
      for (const part of parts) {
        if (part.functionCall && part.functionCall.id === message.tool_call_id) {
          functionName = part.functionCall.name;
          break;
        }
      }
      if (functionName) break;
    }
  }
  
  antigravityMessages.push({
    role: "user",
    parts: [
      {
        functionResponse: {
          id: message.tool_call_id,
          name: functionName,
          reponse: {
            output: message.content
          }
        }
      }
    ]
  })
}

function openaiMessageToAntigravity(openaiMessages){
  const antigravityMessages = [];
  
  for (const message of openaiMessages) {
    if (message.role === "user" || message.role === "system") {
      handleUserMessage(message.content, antigravityMessages);
    } else if (message.role === "assistant") {
      handleAssistantMessage(message, antigravityMessages);
    } else if (message.role === "tool") {
      handleToolCall(message, antigravityMessages);
    }
  }
  
  return antigravityMessages;
}

// 测试数据
const testMessages = [
  { role: "user", content: "查询天气" },
  { role: "assistant", content: "", tool_calls: [{ id: "call_1", function: { name: "get_weather", arguments: '{"city":"北京"}' } }] },
  { role: "tool", tool_call_id: "call_1", content: "北京今天晴天，25度" },
  { role: "assistant", content: "北京今天天气不错，晴天25度" },
  { role: "user", content: "搜索用户信息" },
  { role: "assistant", content: "好的，让我搜索一下" },
  { role: "assistant", content: "", tool_calls: [{ id: "call_2", function: { name: "search_database", arguments: '{"query":"user_info","limit":10}' } }] },
  { role: "tool", tool_call_id: "call_2", content: "找到3条用户记录" }
];

console.log("OpenAI 格式消息:");
console.log(JSON.stringify(testMessages, null, 2));

console.log("\n转换后的 Antigravity 格式:");
const result = openaiMessageToAntigravity(testMessages);
console.log(JSON.stringify(result, null, 2));
