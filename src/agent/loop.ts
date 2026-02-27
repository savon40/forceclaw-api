import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../lib/prisma";
import { salesforceService } from "../services/salesforce";
import { OrgContextService } from "../services/orgContext";
import { slackService } from "../services/slack";
import { buildSystemPrompt } from "./systemPrompt";
import { toolDefinitions, executeTool } from "./tools";

const MAX_TURNS = 10;
const MODEL = "claude-sonnet-4-5-20250929";

const anthropic = new Anthropic();

interface ConversationMessage {
  role: "user" | "assistant";
  content: string | Anthropic.ContentBlock[];
}

interface RunAgentParams {
  accountId: string;
  orgId: string;
  userId: string;
  messageText: string;
  channel: string;
  threadTs: string;
  accessToken: string;
}

export async function runAgentLoop(params: RunAgentParams): Promise<void> {
  const { accountId, orgId, userId, messageText, channel, threadTs, accessToken } = params;

  console.log(`\n========================================`);
  console.log(`=== AGENT LOOP START ===`);
  console.log(`ORG: ${orgId}`);
  console.log(`USER: ${userId}`);
  console.log(`CHANNEL: ${channel} THREAD: ${threadTs}`);
  console.log(`MESSAGE: ${messageText}`);
  console.log(`========================================\n`);

  try {
    // 1. Get jsforce connection
    console.log(`STEP 1: GETTING SALESFORCE CONNECTION`);
    const conn = await salesforceService.getConnection(orgId);

    // 2. Get org name for prompt
    const org = await prisma.org.findUnique({
      where: { id: orgId },
      select: { name: true },
    });
    const orgName = org?.name || "Salesforce Org";

    // 3. Build org context + summary
    console.log(`STEP 2: BUILDING ORG CONTEXT`);
    const orgContext = new OrgContextService(orgId, conn);
    const orgSummary = await orgContext.buildOrgSummary();

    // 4. Load or create conversation from DB
    console.log(`STEP 3: LOADING CONVERSATION HISTORY`);
    const existingJob = await prisma.job.findFirst({
      where: {
        orgId,
        slackChannel: channel,
        slackThreadTs: threadTs,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, conversation: true },
    });

    let conversationHistory: ConversationMessage[] = [];
    let jobId: string;

    if (existingJob?.conversation) {
      conversationHistory = existingJob.conversation as unknown as ConversationMessage[];
      jobId = existingJob.id;
      console.log(`LOADED EXISTING CONVERSATION: ${conversationHistory.length} messages, JOB: ${jobId}`);
    } else if (existingJob) {
      jobId = existingJob.id;
      console.log(`EXISTING JOB FOUND BUT NO CONVERSATION YET: ${jobId}`);
    } else {
      // Create new job
      const job = await prisma.job.create({
        data: {
          accountId,
          orgId,
          userId,
          status: "running",
          type: "query",
          title: messageText.slice(0, 200),
          description: messageText,
          slackChannel: channel,
          slackThreadTs: threadTs,
        },
      });
      jobId = job.id;
      console.log(`CREATED NEW JOB: ${jobId}`);
    }

    // Update job status to running
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "running" },
    });

    // Add the new user message
    conversationHistory.push({
      role: "user",
      content: messageText,
    });

    // 5. Build system prompt
    const systemPrompt = buildSystemPrompt(orgSummary, orgName);
    console.log(`SYSTEM PROMPT LENGTH: ${systemPrompt.length} chars`);

    // 6. Claude agentic loop
    let turnCount = 0;

    while (turnCount < MAX_TURNS) {
      turnCount++;
      console.log(`\n--- AGENT TURN ${turnCount}/${MAX_TURNS} ---`);

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: toolDefinitions,
        messages: conversationHistory as Anthropic.MessageParam[],
      });

      console.log(`CLAUDE RESPONSE: stop_reason=${response.stop_reason}, content_blocks=${response.content.length}`);

      // Add assistant response to conversation
      conversationHistory.push({
        role: "assistant",
        content: response.content as Anthropic.ContentBlock[],
      });

      if (response.stop_reason === "end_turn") {
        // Extract text from response
        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === "text"
        );
        const replyText = textBlocks.map((b) => b.text).join("\n");

        if (replyText) {
          console.log(`SENDING SLACK REPLY: ${replyText.slice(0, 200)}...`);
          await slackService.postThreadReply(accessToken, channel, threadTs, replyText);
        }

        // Save conversation and mark complete
        await prisma.job.update({
          where: { id: jobId },
          data: {
            conversation: JSON.parse(JSON.stringify(conversationHistory)),
            status: "completed",
            completedAt: new Date(),
          },
        });

        console.log(`=== AGENT LOOP END (completed, ${turnCount} turns) ===\n`);
        return;
      }

      if (response.stop_reason === "tool_use") {
        // Execute all tool calls
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
        );

        console.log(`TOOL CALLS: ${toolUseBlocks.length} tools to execute`);

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolCall of toolUseBlocks) {
          console.log(`EXECUTING TOOL: ${toolCall.name} (id: ${toolCall.id})`);

          const result = await executeTool(
            toolCall.name,
            toolCall.input as Record<string, unknown>,
            orgContext,
            conn
          );

          console.log(`TOOL RESULT (${toolCall.name}): isError=${result.isError}, length=${result.content.length}`);

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: result.content,
            is_error: result.isError,
          });
        }

        // Add tool results to conversation
        conversationHistory.push({
          role: "user",
          content: toolResults as unknown as string,
        });

        // Save conversation after each turn (in case of crash)
        await prisma.job.update({
          where: { id: jobId },
          data: {
            conversation: JSON.parse(JSON.stringify(conversationHistory)),
          },
        });

        // Continue the loop for Claude to process tool results
        continue;
      }

      // Unexpected stop reason
      console.warn(`UNEXPECTED STOP REASON: ${response.stop_reason}`);
      break;
    }

    // Hit max turns
    console.warn(`AGENT LOOP HIT MAX TURNS (${MAX_TURNS})`);
    await slackService.postThreadReply(
      accessToken,
      channel,
      threadTs,
      "I've reached my processing limit for this request. Please start a new message if you need more help."
    );

    await prisma.job.update({
      where: { id: jobId },
      data: {
        conversation: JSON.parse(JSON.stringify(conversationHistory)),
        status: "completed",
        completedAt: new Date(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`=== AGENT LOOP ERROR ===`);
    console.error(`ERROR: ${message}`);
    if (err instanceof Error && err.stack) {
      console.error(`STACK: ${err.stack}`);
    }

    // Best-effort error reply to Slack
    try {
      await slackService.postThreadReply(
        accessToken,
        channel,
        threadTs,
        `Sorry, I ran into an error processing your request: ${message}`
      );
    } catch (slackErr) {
      console.error(`FAILED TO SEND ERROR TO SLACK:`, slackErr);
    }
  }
}
