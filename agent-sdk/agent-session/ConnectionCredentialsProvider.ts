import { decodeJwt } from 'jose';

import { ConnectionDetails } from "@/app/api/connection-details/route";

const ONE_MINUTE_IN_MILLISECONDS = 60 * 1000;

/**
  * ConnectionDetails handles getting credentials for connecting to a new Room, caching
  * the last result and using it until it expires. */
export abstract class ConnectionCredentials {
  private cachedConnectionDetails: ConnectionDetails | null = null;

  protected isCachedConnectionDetailsExpired() {
    const token = this.cachedConnectionDetails?.participantToken;
    if (!token) {
      return true;
    }

    const jwtPayload = decodeJwt(token);
    if (!jwtPayload.exp) {
      return true;
    }
    const expiresAt = new Date(jwtPayload.exp - ONE_MINUTE_IN_MILLISECONDS);

    const now = new Date();
    return expiresAt >= now;
  }

  async generate() {
    if (this.isCachedConnectionDetailsExpired()) {
      await this.refresh();
    }

    return this.cachedConnectionDetails!;
  }

  async refresh() {
    this.cachedConnectionDetails = await this.fetch();
  }

  protected abstract fetch(): Promise<ConnectionDetails>;
};

export class ManualConnectionCredentials extends ConnectionCredentials {
  protected fetch: () => Promise<ConnectionDetails>;

  constructor(handler: () => Promise<ConnectionDetails>) {
    super();
    this.fetch = handler;
  }
}

export class LiteralConnectionCredentials extends ConnectionCredentials {
  payload: ConnectionDetails;

  constructor(payload: ConnectionDetails) {
    super();
    this.payload = payload;
  }

  async fetch() {
    if (this.isCachedConnectionDetailsExpired()) {
      // FIXME: figure out a better logging solution?
      console.warn('WARNING: The credentials within LiteralConnectionCredentials have expired, so any upcoming room connections will fail.');
    }
    return this.payload;
  }

  async refresh() { /* cannot refresh a literal set of credentials! */ }
}


type SandboxConnectionCredentialsOptions = {
  sandboxId: string;
  baseUrl?: string;

  /** The name of the room to join. If omitted, a random new room name will be generated instead. */
  roomName?: string;

  /** The identity of the participant the token should connect as connect as. If omitted, a random
    * identity will be used instead. */
  participantName?: string;
};

export class SandboxConnectionCredentials extends ConnectionCredentials {
  protected options: SandboxConnectionCredentialsOptions;

  constructor(options: SandboxConnectionCredentialsOptions) {
    super();
    this.options = options;

    if (process.env.NODE_ENV === 'production') {
      // FIXME: figure out a better logging solution?
      console.warn('WARNING: SandboxConnectionCredentials is meant for development, and is not security hardened. In production, implement your own token generation solution.');
    }
  }

  async fetch() {
    const baseUrl = this.options.baseUrl ?? "https://cloud-api.livekit.io";
    const response = await fetch(`${baseUrl}/api/sandbox/connection-details`, {
      method: "POST",
      headers: {
        "X-Sandbox-ID": this.options.sandboxId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        roomName: this.options.roomName,
        participantName: this.options.participantName,
      }),
    });

    if (!response.ok) {
      throw new Error(`Error generting token from sandbox token server: ${response.status} ${await response.text()}`);
    }

    return response.json();
  }
}
