// Email adapter (W5): operator notifications. Stub logs deterministically;
// live sends through Resend. The surrounding code path is identical.
import { driverMode, type DriverMode } from "./env.js";

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailSender {
  readonly mode: DriverMode;
  send(message: EmailMessage): Promise<void>;
}

export function createEmailSender(opts?: { mode?: DriverMode }): EmailSender {
  const mode = opts?.mode ?? driverMode("EMAIL_MODE");
  return {
    mode,
    async send(message: EmailMessage): Promise<void> {
      if (mode === "stub") {
        console.log(
          JSON.stringify({ msg: "stub email send", to: message.to, subject: message.subject }),
        );
        return;
      }
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) throw new Error("RESEND_API_KEY required in live mode");
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM ?? "Ad Engine <onboarding@resend.dev>",
          to: [message.to],
          subject: message.subject,
          text: message.body,
        }),
      });
      if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
    },
  };
}
