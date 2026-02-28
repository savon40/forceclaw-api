import { Router, Request, Response } from "express";
import express from "express";
import { prisma } from "../lib/prisma";
import { slackService } from "../services/slack";
import { resolveSlackUser } from "../services/slackUserResolver";
import { getAgentJobQueue } from "../queue";
import type { AgentJobPayload } from "../queue/jobs/agentJob";

const router = Router();

// In-memory event deduplication
const processedEvents = new Set<string>();
setInterval(() => processedEvents.clear(), 5 * 60 * 1000);

// Extend Request to carry raw body
interface RawBodyRequest extends Request {
  rawBody?: string;
}

// Parse JSON and capture raw body via verify callback
router.use(
  express.json({
    verify: (req: RawBodyRequest, _res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

// Parse URL-encoded bodies (Slack interactions use this)
router.use(
  express.urlencoded({
    extended: false,
    verify: (req: RawBodyRequest, _res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

// Signature verification middleware
function verifySlackSignature(
  req: RawBodyRequest,
  res: Response,
  next: () => void
): void {
  const signature = req.headers["x-slack-signature"] as string | undefined;
  const timestamp = req.headers["x-slack-request-timestamp"] as
    | string
    | undefined;

  if (!signature || !timestamp || !req.rawBody) {
    res.status(401).json({ error: "Missing Slack signature headers" });
    return;
  }

  try {
    if (!slackService.verifySignature(signature, timestamp, req.rawBody)) {
      res.status(401).json({ error: "Invalid Slack signature" });
      return;
    }
  } catch {
    res.status(500).json({ error: "Signature verification failed" });
    return;
  }

  next();
}

interface SlackEvent {
  type: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  channel_type?: string;
}

// POST /events
router.post(
  "/events",
  verifySlackSignature,
  (req: RawBodyRequest, res: Response) => {
    const body = req.body;

    // Handle Slack URL verification challenge
    if (body.type === "url_verification") {
      res.json({ challenge: body.challenge });
      return;
    }

    // Handle event callbacks
    if (body.type === "event_callback") {
      const eventId = body.event_id as string;

      // Deduplicate
      if (processedEvents.has(eventId)) {
        res.sendStatus(200);
        return;
      }
      processedEvents.add(eventId);

      // Respond immediately to meet 3-second deadline
      res.sendStatus(200);

      // Process event asynchronously
      const event = body.event as SlackEvent;
      const teamId = body.team_id as string;
      handleEventAsync(teamId, event).catch((err) =>
        console.error("Error handling Slack event:", err)
      );
      return;
    }

    res.sendStatus(200);
  }
);

function stripMentionPrefix(text: string): string {
  // Remove @mention prefix like "<@U12345> do something" → "do something"
  return text.replace(/^<@[A-Z0-9]+>\s*/i, "").trim();
}

async function handleEventAsync(
  teamId: string,
  event: SlackEvent
): Promise<void> {
  // Handle both app_mention and DM messages
  const isAppMention = event.type === "app_mention";
  const isDM = event.type === "message" && event.channel_type === "im";

  if (!isAppMention && !isDM) {
    return;
  }

  if (!event.text || !event.channel || !event.user || !event.ts) {
    return;
  }

  // Skip bot messages and message subtypes (edits, deletes, etc.)
  if (event.bot_id || event.subtype) {
    return;
  }

  // 1. Look up the workspace connection
  const connection = await prisma.slackConnection.findFirst({
    where: { workspaceId: teamId },
  });

  if (!connection) {
    console.warn(`No SlackConnection found for team ${teamId}`);
    return;
  }

  // Skip messages from our own bot
  if (event.user === connection.botUserId) {
    return;
  }

  const accessToken = connection.accessToken;
  const accountId = connection.accountId;
  // For @mentions, use the event ts as thread_ts to start a thread.
  // For DMs, also use event ts so replies are threaded.
  const threadTs = event.thread_ts || event.ts;

  // 2. Resolve Slack user → ForceClaw user
  const resolved = await resolveSlackUser(accessToken, event.user, accountId);

  if (!resolved) {
    await slackService.postThreadReply(
      accessToken,
      event.channel,
      threadTs,
      "I couldn't find a ForceClaw account linked to your Slack email. Please sign up or log in at https://forceclaw.ai and make sure your email matches."
    );
    return;
  }

  // 3. Parse the message text
  const messageText = stripMentionPrefix(event.text);

  if (!messageText) {
    await slackService.postThreadReply(
      accessToken,
      event.channel,
      threadTs,
      "It looks like your message was empty. Tell me what you'd like to do in Salesforce!"
    );
    return;
  }

  // 4. Find connected orgs for the account
  const orgs = await prisma.org.findMany({
    where: { accountId, tokenStatus: "valid" },
    select: { id: true, name: true, type: true },
  });

  if (orgs.length === 0) {
    await slackService.postThreadReply(
      accessToken,
      event.channel,
      threadTs,
      "No Salesforce org is connected to your account. Set one up at https://forceclaw.ai"
    );
    return;
  }

  if (orgs.length === 1) {
    // Auto-select the only org
    console.log(`SINGLE ORG — AUTO-SELECTING: ${orgs[0].name} (${orgs[0].id})`);
    await handleOrgMessage({
      accountId,
      orgId: orgs[0].id,
      userId: resolved.userId,
      messageText,
      channel: event.channel,
      threadTs,
      accessToken,
    });
    return;
  }

  // Multiple orgs — try to resolve without asking

  // 4a. Check if an org was already used in this thread
  const existingJob = await prisma.job.findFirst({
    where: {
      accountId,
      slackChannel: event.channel,
      slackThreadTs: threadTs,
    },
    orderBy: { createdAt: "desc" },
    select: { orgId: true },
  });

  if (existingJob) {
    console.log(`THREAD ORG REUSE — FOUND EXISTING JOB WITH ORG: ${existingJob.orgId}`);
    await handleOrgMessage({
      accountId,
      orgId: existingJob.orgId,
      userId: resolved.userId,
      messageText,
      channel: event.channel,
      threadTs,
      accessToken,
    });
    return;
  }

  // 4b. Try to infer org from message text (match by name or type)
  const msgLower = messageText.toLowerCase();
  console.log(`ORG NAME MATCHING — MESSAGE: "${msgLower}"`);
  console.log(`ORG NAME MATCHING — AVAILABLE ORGS: ${orgs.map((o) => `"${o.name}" (${o.type})`).join(", ")}`);

  // Noise words to skip when matching org name tokens
  const noiseWords = new Set(["org", "the", "in", "my", "a", "an", "for", "of", "and", "llc", "inc", "corp", "ltd"]);

  const matchedOrgs = orgs.filter((org) => {
    const nameLower = org.name.toLowerCase();

    // Exact full-name match (message contains entire org name)
    if (msgLower.includes(nameLower)) return true;

    // Word-level match — check if any significant word from the org name appears in the message
    const nameTokens = nameLower.split(/[\s\-_.,]+/).filter((t) => t.length >= 3 && !noiseWords.has(t));
    for (const token of nameTokens) {
      if (msgLower.includes(token)) return true;
    }

    return false;
  });

  if (matchedOrgs.length === 1) {
    console.log(`ORG INFERRED FROM MESSAGE TEXT — MATCHED: ${matchedOrgs[0].name} (${matchedOrgs[0].id})`);
    await handleOrgMessage({
      accountId,
      orgId: matchedOrgs[0].id,
      userId: resolved.userId,
      messageText,
      channel: event.channel,
      threadTs,
      accessToken,
    });
    return;
  }
  if (matchedOrgs.length > 1) {
    // User mentioned something that matched multiple orgs — skip intent inference, go straight to picker
    console.log(`ORG NAME MATCHING — MULTIPLE MATCHES: ${matchedOrgs.map((o) => o.name).join(", ")} — SKIPPING TO PICKER`);
  } else {
    // No name match — try intent-based inference only if user didn't mention any org name
    console.log(`ORG NAME MATCHING — NO MATCH FOUND, FALLING THROUGH TO INTENT-BASED INFERENCE`);

    // 4c. Intent-based inference — if the message implies dev work and there's exactly one dev org, use it
    const devKeywords = [
      "create", "update", "write", "deploy", "build", "add a",
      "source code", "class body", "trigger body", "apex class", "apex trigger",
      "lwc source", "flow definition", "flow metadata",
      "run test", "run apex test", "code coverage", "test class",
      "refactor", "fix the code", "modify", "change the code",
    ];
    const looksLikeDev = devKeywords.some((kw) => msgLower.includes(kw));

    if (looksLikeDev) {
      const devOrgs = orgs.filter((o) => o.type === "sandbox" || o.type === "developer");
      if (devOrgs.length === 1) {
        console.log(`INTENT-BASED ORG INFERENCE — DEV KEYWORDS DETECTED, SINGLE DEV ORG: ${devOrgs[0].name} (${devOrgs[0].id})`);
        await handleOrgMessage({
          accountId,
          orgId: devOrgs[0].id,
          userId: resolved.userId,
          messageText,
          channel: event.channel,
          threadTs,
          accessToken,
        });
        return;
      }
      console.log(`INTENT-BASED ORG INFERENCE — DEV KEYWORDS DETECTED BUT ${devOrgs.length} DEV ORGS — FALLING THROUGH TO PICKER`);
    }

    // 4d. Read-only / data question with single prod org — auto-select it
    const prodKeywords = [
      "how many", "count", "list all", "show me the", "what are",
      "who has", "which users", "permission set", "report", "dashboard",
      "record", "query", "find all", "look up",
    ];
    const looksLikeProd = prodKeywords.some((kw) => msgLower.includes(kw));

    if (looksLikeProd) {
      const prodOrgs = orgs.filter((o) => o.type === "production");
      if (prodOrgs.length === 1) {
        console.log(`INTENT-BASED ORG INFERENCE — DATA QUESTION DETECTED, SINGLE PROD ORG: ${prodOrgs[0].name} (${prodOrgs[0].id})`);
        await handleOrgMessage({
          accountId,
          orgId: prodOrgs[0].id,
          userId: resolved.userId,
          messageText,
          channel: event.channel,
          threadTs,
          accessToken,
        });
        return;
      }
    }
  }

  // 4e. No match — ask user to pick
  console.log(`MULTIPLE ORGS (${orgs.length}) — NO THREAD HISTORY OR MESSAGE MATCH — SHOWING PICKER`);
  const orgBlocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "You have multiple Salesforce orgs connected. Which one should I use?",
      },
    },
    {
      type: "actions",
      block_id: "org_picker",
      elements: orgs.map((org) => ({
        type: "button",
        text: { type: "plain_text", text: org.name },
        action_id: `pick_org_${org.id}`,
        value: JSON.stringify({
          orgId: org.id,
          userId: resolved.userId,
          accountId,
          messageText,
          channel: event.channel,
          threadTs,
        }),
      })),
    },
  ];

  await slackService.postBlockMessage(
    accessToken,
    event.channel,
    threadTs,
    orgBlocks,
    "Which Salesforce org should I use?"
  );
}

interface CreateJobParams {
  accountId: string;
  orgId: string;
  userId: string;
  messageText: string;
  channel: string;
  threadTs: string;
  accessToken: string;
}

async function handleOrgMessage(params: CreateJobParams): Promise<void> {
  const { accountId, orgId, userId, messageText, channel, threadTs, accessToken } = params;

  console.log(`=== HANDLE ORG MESSAGE — ENQUEUING JOB ===`);
  console.log(`ACCOUNT: ${accountId}, ORG: ${orgId}, USER: ${userId}`);
  console.log(`MESSAGE: ${messageText}`);

  // Create a Job record in the DB first
  const job = await prisma.job.create({
    data: {
      accountId,
      orgId,
      userId,
      status: "queued",
      type: "query",
      title: messageText.slice(0, 200),
      description: messageText,
      slackChannel: channel,
      slackThreadTs: threadTs,
    },
  });

  console.log(`CREATED JOB RECORD: ${job.id}`);

  // Enqueue the job via BullMQ
  const payload: AgentJobPayload = {
    jobId: job.id,
    accountId,
    orgId,
    userId,
    type: "query",
    title: messageText.slice(0, 200),
    description: messageText,
    slackChannel: channel,
    slackThreadTs: threadTs,
    slackAccessToken: accessToken,
  };

  const queue = getAgentJobQueue();
  const bullJob = await queue.add("agent-job", payload, {
    jobId: job.id,
  });

  console.log(`ENQUEUED BULLMQ JOB: ${bullJob.id}`);
  console.log(`=== HANDLE ORG MESSAGE — ENQUEUED SUCCESSFULLY ===`);
}

// POST /interactions
router.post(
  "/interactions",
  verifySlackSignature,
  (req: RawBodyRequest, res: Response) => {
    const rawPayload = req.body.payload;
    if (!rawPayload) {
      res.sendStatus(200);
      return;
    }

    // Acknowledge immediately
    res.sendStatus(200);

    const payload = JSON.parse(rawPayload);
    handleInteractionAsync(payload).catch((err) =>
      console.error("Error handling Slack interaction:", err)
    );
  }
);

interface SlackInteractionPayload {
  type: string;
  team?: { id: string };
  actions?: Array<{
    action_id: string;
    value: string;
  }>;
}

async function handleInteractionAsync(
  payload: SlackInteractionPayload
): Promise<void> {
  if (payload.type !== "block_actions" || !payload.actions?.length) {
    return;
  }

  const action = payload.actions[0];

  // Handle org picker button clicks
  if (action.action_id.startsWith("pick_org_")) {
    const data = JSON.parse(action.value) as {
      orgId: string;
      userId: string;
      accountId: string;
      messageText: string;
      channel: string;
      threadTs: string;
    };

    // Look up the Slack connection to get the access token
    const connection = await prisma.slackConnection.findFirst({
      where: { accountId: data.accountId },
    });

    if (!connection) {
      console.error("No SlackConnection found for interaction");
      return;
    }

    await handleOrgMessage({
      accountId: data.accountId,
      orgId: data.orgId,
      userId: data.userId,
      messageText: data.messageText,
      channel: data.channel,
      threadTs: data.threadTs,
      accessToken: connection.accessToken,
    });
  }
}

export default router;
