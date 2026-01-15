//import conductor sdk for JS
import {
  orkesConductorClient,
  TaskManager,
} from '@io-orkes/conductor-javascript';

// Import main langchain agent
import { createSimpleExtractionAgent } from './langchainAgent.js';

// import the eval langchain agents
import { createGroundingEvalAgent } from './groundingEvalAgent.js'; 
import { createSchemaEvalAgent } from './schemaEvalAgent.js';
import { createRoutingEvalAgent } from './routingEvalAgent.js';
import { createQualityEvalAgent } from "./qualityEvalAgent.js";

import 'dotenv/config';

// Initialize all agents once (reuse across tasks)
const agent = createSimpleExtractionAgent();
const groundingEvalAgent = createGroundingEvalAgent();
const schemaEvalAgent = createSchemaEvalAgent();
const routingEvalAgent = createRoutingEvalAgent();
const qualityEvalAgent = createQualityEvalAgent();

// Wrapper 1
export const extractAgentWorker = {
  taskDefName: "extract_agent",
  execute: async (task) => {
    const query = task.inputData?.query;
    if (!query) {
      return {
        status: "FAILED_WITH_TERMINAL_ERROR",
        reasonForIncompletion: "Missing query",
        outputData: { response: null, error: "Missing query" },
      };
    }

    const result = await agent.invoke({
      messages: [{ role: "user", content: query }],
    });

    return {
      status: "COMPLETED",
      outputData: { response: result.structuredResponse ?? result },
    };
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

// Wrapper 4
export const qualityEvalAgentWorker = {
  taskDefName: "quality_eval_agent",
  execute: async (task) => {
    try {
      const input = task.inputData ?? {};
      const messageText = input.messageText ?? input.query ?? "";
      const ticketJson = input.ticketJson;

      if (!messageText || !ticketJson) {
        return {
          status: "FAILED_WITH_TERMINAL_ERROR",
          reasonForIncompletion: "Missing messageText or ticketJson",
          outputData: { response: null, error: "Missing messageText or ticketJson" },
        };
      }

      const result = await qualityEvalAgent.invoke({
        messages: [{ role: "user", content: JSON.stringify({ messageText, ticketJson }) }],
      });

      return {
        status: "COMPLETED",
        outputData: { response: result.structuredResponse ?? result },
      };
    } catch (error) {
      return {
        status: "FAILED",
        reasonForIncompletion: `Quality eval failed: ${error?.message ?? String(error)}`,
        outputData: { response: null, error: error?.message ?? String(error) },
      };
    }
  },
};

async function startWorker() {
  const client = await orkesConductorClient({
    serverUrl: 'https://developer.orkescloud.com/api',
    keyId: 'change-me',
    keySecret: 'change-me',
  });

  console.log('Connected to Conductor ✅');

  const taskManager = new TaskManager(client, [extractAgentWorker, groundingEvalAgentWorker, schemaEvalAgentWorker, routingEvalAgentWorker, qualityEvalAgentWorker], {
    options: { concurrency: 10, pollInterval: 200 },
  });

  taskManager.startPolling();

  process.on('SIGINT', () => {
    taskManager.stopPolling();
    process.exit(0);
  });
}

startWorker();
