//import conductor sdk for JS
import {
  orkesConductorClient,
  TaskManager,
} from '@io-orkes/conductor-javascript';

// Import main langchang agent
import { createSimpleExtractionAgent } from './langchainAgent.ts';

// import the eval langchain agents
import { createGroundingEvalAgent } from './groundingEvalAgent.ts'; 
import { createSchemaEvalAgent } from './schemaEvalAgent.ts';
import { createRoutingEvalAgent } from './routingEvalAgent.ts';

import 'dotenv/config';

// initialize all 4 agents so we can use them in this file :) 
const agent = createSimpleExtractionAgent();
const groundingEvalAgent = createGroundingEvalAgent();
const schemaEvalAgent = createSchemaEvalAgent();
const routingEvalAgent = createRoutingEvalAgent();

const agentWorker = {
  taskDefName: 'extract_agent',
  execute: async (task) => {
    try {
      // Get query from Conductor input
      const query = task.inputData?.query;

      if (!query) {
        return {
          outputData: {
            error: 'No query provided',
            response: null,
          },
          status: 'FAILED_WITH_TERMINAL_ERROR',
          reasonForIncompletion: 'Missing required input: query',
        };
      }

      // Run agent with the query from Conductor
      const result = await agent.invoke({
        messages: [
          {
            role: 'user',
            content: query,
          },
        ],
      });

      const response = result.messages[result.messages.length - 1].content;

      const toolsUsed = result.messages
        .filter((msg) => msg.tool_calls && msg.tool_calls.length > 0)
        .flatMap((msg) => msg.tool_calls.map((tc) => tc.name));

      return {
        outputData: {
          response: response,
          toolsUsed: toolsUsed,
          messageCount: result.messages.length,
        },
        status: 'COMPLETED',
      };
    } catch (error) {
      return {
        outputData: { error: error.message, response: null },
        status: 'FAILED',
        reasonForIncompletion: `Agent execution failed: ${error.message}`,
      };
    }
  },
};

const groundingEvalAgentWorker = {
  taskDefName: 'grounding_eval_agent',
  execute: async (task) => {
    try {
      const input = task.inputData ?? {};

      // Prefer explicit inputs; fall back to query for messageText
      const messageText = input.messageText ?? input.query ?? '';
      const ticketJson = input.ticketJson ?? '';

      if (!messageText) {
        return {
          outputData: { error: 'Missing messageText (or query)', response: null },
          status: 'FAILED_WITH_TERMINAL_ERROR',
          reasonForIncompletion: 'Missing required input: messageText',
        };
      }

      if (!ticketJson) {
        return {
          outputData: { error: 'Missing ticketJson', response: null },
          status: 'FAILED_WITH_TERMINAL_ERROR',
          reasonForIncompletion: 'Missing required input: ticketJson',
        };
      }

      const result = await groundingEvalAgent.invoke({
  messages: [
    {
      role: 'user',
      content: JSON.stringify({ messageText, ticketJson }),
    },
  ],
});

      // Your agent returns tool JSON as plain string
      const response =
        typeof result === 'string'
          ? result
          : (result?.messages?.[result.messages.length - 1]?.content ?? JSON.stringify(result));

      const toolsUsed = result?.messages
        ? result.messages
            .filter((msg) => msg.tool_calls && msg.tool_calls.length > 0)
            .flatMap((msg) => msg.tool_calls.map((tc) => tc.name))
        : ['evaluate_grounding'];

      return {
        outputData: {
          response,
          toolsUsed,
          messageCount: result?.messages?.length ?? 0,
        },
        status: 'COMPLETED',
      };
    } catch (error) {
      return {
        outputData: { error: error.message, response: null },
        status: 'FAILED',
        reasonForIncompletion: `Agent execution failed: ${error.message}`,
      };
    }
  },
};


// Wrapper 2
const schemaEvalAgentWorker = {
  taskDefName: 'schema_eval_agent',
  execute: async (task) => {
    try {
      const input = task.inputData ?? {};

      // Prefer ticketJson; fall back to query if you want to keep it flexible
      const ticketJson = input.ticketJson ?? input.query ?? '';

      if (!ticketJson) {
        return {
          outputData: { error: 'Missing ticketJson (or query)', response: null },
          status: 'FAILED_WITH_TERMINAL_ERROR',
          reasonForIncompletion: 'Missing required input: ticketJson',
        };
      }

const result = await schemaEvalAgent.invoke({
  messages: [
    {
      role: 'user',
      content: JSON.stringify({ ticketJson }),
    },
  ],
});

      const response =
        typeof result === 'string'
          ? result
          : (result?.messages?.[result.messages.length - 1]?.content ?? JSON.stringify(result));

      const toolsUsed = result?.messages
        ? result.messages
            .filter((msg) => msg.tool_calls && msg.tool_calls.length > 0)
            .flatMap((msg) => msg.tool_calls.map((tc) => tc.name))
        : ['evaluate_schema'];

      return {
        outputData: {
          response,
          toolsUsed,
          messageCount: result?.messages?.length ?? 0,
        },
        status: 'COMPLETED',
      };
    } catch (error) {
      return {
        outputData: { error: error.message, response: null },
        status: 'FAILED',
        reasonForIncompletion: `Agent execution failed: ${error.message}`,
      };
    }
  },
};


// Wrapper 3
const routingEvalAgentWorker = {
  taskDefName: 'routing_eval_agent',
  execute: async (task) => {
    try {
      const input = task.inputData ?? {};

      const messageText = input.messageText ?? input.query ?? '';
      const ticketJson = input.ticketJson ?? '';

      if (!messageText) {
        return {
          outputData: { error: 'Missing messageText (or query)', response: null },
          status: 'FAILED_WITH_TERMINAL_ERROR',
          reasonForIncompletion: 'Missing required input: messageText',
        };
      }

      if (!ticketJson) {
        return {
          outputData: { error: 'Missing ticketJson', response: null },
          status: 'FAILED_WITH_TERMINAL_ERROR',
          reasonForIncompletion: 'Missing required input: ticketJson',
        };
      }

      const result = await routingEvalAgent.invoke({
        messages: [
          {
            role: 'user',
            content: JSON.stringify({ messageText, ticketJson }),
          },
        ],
      });

      const response =
        typeof result === 'string'
          ? result
          : (result?.messages?.[result.messages.length - 1]?.content ?? JSON.stringify(result));

      const toolsUsed = result?.messages
        ? result.messages
            .filter((msg) => msg.tool_calls && msg.tool_calls.length > 0)
            .flatMap((msg) => msg.tool_calls.map((tc) => tc.name))
        : ['evaluate_routing'];

      return {
        outputData: {
          response,
          toolsUsed,
          messageCount: result?.messages?.length ?? 0,
        },
        status: 'COMPLETED',
      };
    } catch (error) {
      return {
        outputData: { error: error.message, response: null },
        status: 'FAILED',
        reasonForIncompletion: `Agent execution failed: ${error.message}`,
      };
    }
  },
};


async function startWorker() {
  const client = await orkesConductorClient({
    serverUrl: 'https://developer.orkescloud.com/api',
    keyId: 'replace-me',
    keySecret: 'replace-me',
  });

  console.log('Connected to Conductor ✅');

  const taskManager = new TaskManager(client, [agentWorker, groundingEvalAgentWorker, schemaEvalAgentWorker, routingEvalAgentWorker], {
    options: { concurrency: 10, pollInterval: 200 },
  });

  taskManager.startPolling();

  process.on('SIGINT', () => {
    taskManager.stopPolling();
    process.exit(0);
  });
}

startWorker();
