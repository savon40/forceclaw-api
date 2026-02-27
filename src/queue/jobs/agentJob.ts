export interface AgentJobPayload {
  jobId: string;
  accountId: string;
  orgId: string;
  type: "flow" | "apex" | "report" | "permission_set" | "object" | "deployment" | "query" | "documentation";
  title: string;
  description: string;
  userId: string;
  slackChannel?: string;
  slackThreadTs?: string;
  slackAccessToken?: string;
}
