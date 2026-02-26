import { Router, Request, Response } from "express";
import express from "express";
import { prisma } from "../lib/prisma";
import { slackService } from "../services/slack";

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
      const event = body.event;
      const teamId = body.team_id as string;
      handleEventAsync(teamId, event).catch((err) =>
        console.error("Error handling Slack event:", err)
      );
      return;
    }

    res.sendStatus(200);
  }
);

async function handleEventAsync(
  teamId: string,
  event: { type: string; bot_id?: string; user?: string; text?: string; channel?: string }
): Promise<void> {
  // Only handle messages
  if (event.type !== "message" || !event.text || !event.channel) {
    return;
  }

  // Look up the workspace connection
  const connection = await prisma.slackConnection.findFirst({
    where: { workspaceId: teamId },
  });

  if (!connection) {
    console.warn(`No SlackConnection found for team ${teamId}`);
    return;
  }

  // Skip messages from bots (including our own)
  if (event.bot_id || event.user === connection.botUserId) {
    return;
  }

  // Echo reply for now
  await slackService.postMessage(
    connection.accessToken,
    event.channel,
    `Echo: ${event.text}`
  );
}

// POST /interactions
router.post(
  "/interactions",
  verifySlackSignature,
  (req: RawBodyRequest, res: Response) => {
    // Slack sends interaction payloads as URL-encoded with a "payload" field
    const rawPayload = req.body.payload;
    if (rawPayload) {
      const payload = JSON.parse(rawPayload);
      console.log("Slack interaction received:", payload.type);
    }

    // Acknowledge immediately
    res.sendStatus(200);
  }
);

export default router;
