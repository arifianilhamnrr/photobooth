import nodemailer from "nodemailer";

export interface BrevoEmailEnv {
  apiKey?: string;
  smtpLogin?: string;
  senderEmail?: string;
  senderName?: string;
}

export class BrevoEmailService {
  constructor(private readonly env: BrevoEmailEnv) {}

  isConfigured(): boolean {
    return Boolean(this.env.apiKey && this.env.smtpLogin && this.env.senderEmail);
  }

  async sendDownloadLink(input: { to: string; eventName: string; sessionId: string; publicUrl: string }) {
    if (!this.isConfigured()) {
      return { status: "skipped", reason: "missing_config" } as const;
    }

    const transporter = nodemailer.createTransport({
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      auth: {
        user: this.env.smtpLogin!,
        pass: this.env.apiKey!
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000
    });

    try {
      await transporter.sendMail({
        from: {
          address: this.env.senderEmail!,
          name: this.env.senderName || "Photobooth"
        },
        to: input.to,
        subject: `Link photobooth ${input.eventName}`,
        html: `
          <html>
            <body style="font-family: Arial, sans-serif; background: #111315; color: #f2f1ed; padding: 24px;">
              <div style="max-width: 560px; margin: 0 auto; background: #1a1d20; border-radius: 18px; padding: 24px;">
                <h1 style="margin-top: 0;">Hasil photobooth kamu siap</h1>
                <p>Sesi <strong>${input.sessionId}</strong> dari <strong>${input.eventName}</strong> sudah bisa dibuka.</p>
                <p><a href="${input.publicUrl}" style="display: inline-block; padding: 12px 18px; border-radius: 12px; background: #ff7048; color: #15110f; text-decoration: none; font-weight: 700;">Buka hasil photobooth</a></p>
                <p style="color: #b2b4b3;">Kalau tombolnya tidak bisa diklik, buka link ini:</p>
                <p style="color: #f2f1ed; word-break: break-word;">${input.publicUrl}</p>
              </div>
            </body>
          </html>`
      });

      return { status: "sent" } as const;
    } catch (error) {
      return {
        status: "failed",
        reason: error instanceof Error ? error.name : "unknown_error",
        detail: error instanceof Error ? error.message : String(error)
      } as const;
    }
  }
}
