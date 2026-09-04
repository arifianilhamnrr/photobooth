import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { google } from "googleapis";
import type { DriveStatus, StoredSession } from "@photobooth/domain";
export { CloudflareUploadService } from "./cloudflare";
export { BrevoEmailService } from "./brevo";

interface StoredDriveAuth {
  refresh_token?: string;
  access_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
  id_token?: string;
  rootFolderId?: string;
  rootFolderName?: string;
  email?: string;
}

export interface DriveEnv {
  clientId?: string;
  clientSecret?: string;
}

export interface DrivePublishInput {
  session: StoredSession;
  eventName: string;
}

export class GoogleDriveService {
  constructor(
    private readonly env: DriveEnv,
    private readonly authFilePath: string,
    private readonly opener: (url: string) => Promise<void>
  ) {}

  async getStatus(): Promise<DriveStatus> {
    const auth = await this.readAuth();
    if (!this.env.clientId || !this.env.clientSecret) return { mode: "mock" };
    if (!auth?.refresh_token) {
      return {
        mode: "configured",
        rootFolderId: auth?.rootFolderId,
        rootFolderName: auth?.rootFolderName
      };
    }
    return {
      mode: "authenticated",
      email: auth.email,
      rootFolderId: auth.rootFolderId,
      rootFolderName: auth.rootFolderName
    };
  }

  async signIn(): Promise<DriveStatus> {
    this.ensureConfigured();
    const redirectUri = "http://127.0.0.1:8789/oauth2callback";
    const oauth2Client = new google.auth.OAuth2(this.env.clientId, this.env.clientSecret, redirectUri);
    const state = Math.random().toString(36).slice(2);
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/userinfo.email"],
      prompt: "consent",
      state
    });

    const codePromise = new Promise<string>((resolve, reject) => {
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", redirectUri);
        if (url.pathname !== "/oauth2callback") {
          response.writeHead(404).end();
          return;
        }
        if (url.searchParams.get("state") !== state) {
          response.writeHead(400).end("State mismatch");
          server.close();
          reject(new Error("State mismatch"));
          return;
        }
        const authCode = url.searchParams.get("code");
        if (!authCode) {
          response.writeHead(400).end("Authorization code missing");
          server.close();
          reject(new Error("Authorization code missing"));
          return;
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<html><body><h1>Photobooth siap</h1><p>Kamu bisa kembali ke aplikasi.</p></body></html>");
        server.close();
        resolve(authCode);
      });
      server.listen(8789, "127.0.0.1", () => undefined);
      server.on("error", reject);
    });

    await this.opener(authUrl);
    const code = await codePromise;
    const tokenResponse = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokenResponse.tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const profile = await oauth2.userinfo.get();
    const current = (await this.readAuth()) ?? {};
    const tokens = tokenResponse.tokens;
    await this.writeAuth({
      ...current,
      refresh_token: tokens.refresh_token ?? current.refresh_token,
      access_token: tokens.access_token ?? undefined,
      scope: tokens.scope ?? undefined,
      token_type: tokens.token_type ?? undefined,
      expiry_date: tokens.expiry_date ?? undefined,
      id_token: tokens.id_token ?? undefined,
      email: profile.data.email ?? current.email,
      rootFolderId: current.rootFolderId,
      rootFolderName: current.rootFolderName
    });
    return this.getStatus();
  }

  async signOut(): Promise<DriveStatus> {
    const current = await this.readAuth();
    await this.writeAuth({
      rootFolderId: current?.rootFolderId,
      rootFolderName: current?.rootFolderName
    });
    return this.getStatus();
  }

  async setRootFolder(input: { id: string; name: string }): Promise<DriveStatus> {
    const current = (await this.readAuth()) ?? {};
    await this.writeAuth({ ...current, rootFolderId: input.id, rootFolderName: input.name });
    return this.getStatus();
  }

  async createRootFolder(name: string): Promise<DriveStatus> {
    const drive = await this.getDriveClient();
    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder"
      },
      fields: "id,name"
    });
    return this.setRootFolder({ id: created.data.id ?? "", name: created.data.name ?? name });
  }

  async publishSession(input: DrivePublishInput): Promise<{ folderUrl: string }> {
    const drive = await this.getDriveClient();
    const auth = await this.readAuth();
    if (!auth?.rootFolderId) throw new Error("Google Drive root folder belum dipilih");
    const folderName = `${input.eventName}-${input.session.id}`;
    const folder = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [auth.rootFolderId]
      },
      fields: "id,name"
    });
    const folderId = folder.data.id;
    if (!folderId) throw new Error("Gagal membuat folder sesi di Drive");

    await drive.permissions.create({
      fileId: folderId,
      requestBody: {
        role: "reader",
        type: "anyone"
      }
    });

    if (input.session.finalStripPath) {
      await drive.files.create({
        requestBody: {
          name: "strip.jpg",
          parents: [folderId]
        },
        media: {
          mimeType: "image/jpeg",
          body: createReadStream(input.session.finalStripPath)
        },
        fields: "id"
      });
    }

    for (const shot of input.session.shots) {
      if (!shot.filePath) continue;
      await drive.files.create({
        requestBody: {
          name: `photo-${String(shot.shotIndex + 1).padStart(2, "0")}.jpg`,
          parents: [folderId]
        },
        media: {
          mimeType: "image/jpeg",
          body: createReadStream(shot.filePath)
        },
        fields: "id"
      });
    }

    return { folderUrl: `https://drive.google.com/drive/folders/${folderId}` };
  }

  private ensureConfigured() {
    if (!this.env.clientId || !this.env.clientSecret) throw new Error("Set GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET dulu.");
  }

  private async getDriveClient() {
    this.ensureConfigured();
    const auth = await this.readAuth();
    if (!auth?.refresh_token) throw new Error("Google Drive belum login.");
    const oauth2Client = new google.auth.OAuth2(this.env.clientId, this.env.clientSecret, "http://127.0.0.1:8789/oauth2callback");
    oauth2Client.setCredentials(auth);
    return google.drive({ version: "v3", auth: oauth2Client });
  }

  private async readAuth(): Promise<StoredDriveAuth | null> {
    try {
      const raw = await readFile(this.authFilePath, "utf8");
      return JSON.parse(raw) as StoredDriveAuth;
    } catch {
      return null;
    }
  }

  private async writeAuth(auth: StoredDriveAuth): Promise<void> {
    await mkdir(dirname(this.authFilePath), { recursive: true });
    await writeFile(this.authFilePath, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
  }
}
