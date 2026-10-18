
import "dotenv/config";
import { Client } from "@elastic/elasticsearch";

export const EMAIL_INDEX = "reachinbox-emails";

export const elasticClient = new Client({
  node: process.env.ELASTICSEARCH_URL || "http://localhost:9200",
});

export interface EmailDocument {
  id: number | string;
  sender_email: string;
  recipient_email: string;
  subject: string;
  body: string;
  scheduled_at: string | Date;
  sent_at?: string | Date | null;
  status: string;
}

export async function ensureEmailIndex(): Promise<void> {
  const exists = await elasticClient.indices.exists({
    index: EMAIL_INDEX,
  });

  if (!exists) {
    await elasticClient.indices.create({
      index: EMAIL_INDEX,
      mappings: {
        properties: {
          id: { type: "keyword" },
          sender_email: { type: "keyword" },
          recipient_email: { type: "keyword" },
          subject: { type: "text" },
          body: { type: "text" },
          scheduled_at: { type: "date" },
          sent_at: { type: "date" },
          status: { type: "keyword" },
        },
      },
    });
  }
}

export async function indexEmail(email: EmailDocument): Promise<void> {
  await ensureEmailIndex();

  await elasticClient.index({
    index: EMAIL_INDEX,
    id: String(email.id),
    document: {
      ...email,
      id: String(email.id),
    },
    refresh: "wait_for",
  });
}

export async function searchEmails(query: string) {
  await ensureEmailIndex();

  const response = await elasticClient.search<EmailDocument>({
    index: EMAIL_INDEX,
    query: {
      multi_match: {
        query,
        fields: [
          "recipient_email",
          "sender_email",
          "subject",
          "body",
          "status",
        ],
        fuzziness: "AUTO",
      },
    },
    sort: [{ scheduled_at: "desc" }],
  });

  return response.hits.hits
    .filter((hit) => hit._source !== undefined)
    .map((hit) => hit._source);
}
