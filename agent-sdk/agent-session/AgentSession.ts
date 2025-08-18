import type TypedEventEmitter from 'typed-emitter';
import { EventEmitter } from "events";
import { Room, RoomEvent, ConnectionState } from 'livekit-client';

import {
  type ReceivedMessage,
  type SentMessage,
  MessageSender,
  MessageReceiver,
  ChatMessageSender,
  CombinedMessageSender,
  CombinedMessageReceiver,
  TranscriptionMessageReceiver,
  ReceivedMessageAggregator,
  type ReceivedMessageAggregatorOptions,
  ReceivedMessageAggregatorEvent,
} from "./message";
import Agent, { AgentEvent, AgentState } from './Agent';
import { ConnectionCredentialsProvider } from './ConnectionCredentialsProvider';

export enum AgentSessionEvent {
  AgentStateChanged = 'agentStateChanged',
  AgentAttributesChanged = 'agentAttributesChanged',
  MessageReceived = 'messageReceived',
  Disconnected = 'disconnected',
  AgentConnectionFailure = 'agentConnectionFailure',
  AudioPlaybackStatusChanged = 'AudioPlaybackStatusChanged',
}

export type AgentSessionCallbacks = {
  [AgentSessionEvent.AgentStateChanged]: (newAgentState: AgentState) => void;
  [AgentSessionEvent.MessageReceived]: (newMessage: ReceivedMessage) => void;
  [AgentSessionEvent.AgentConnectionFailure]: (reason: string) => void;
  [AgentSessionEvent.AudioPlaybackStatusChanged]: (audioPlaybackPermitted: boolean) => void;
  [AgentSessionEvent.Disconnected]: () => void;
};


/**
  * AgentSession represents a connection to a LiveKit Agent, providing abstractions to make 1:1
  * agent/participant rooms easier to work with.
  */
export class AgentSession extends (EventEmitter as new () => TypedEventEmitter<AgentSessionCallbacks>) {
  room: Room; // FIXME: should this be private?

  agent: Agent | null = null;
  messageSender: MessageSender | null = null;
  messageReceiver: MessageReceiver | null = null;

  private connectionCredentialsProvider: ConnectionCredentialsProvider;

  constructor(provider: ConnectionCredentialsProvider) {
    super();
    this.connectionCredentialsProvider = provider;

    this.room = new Room();
    this.room.on(RoomEvent.Connected, this.handleRoomConnected);
    this.room.on(RoomEvent.Disconnected, this.handleRoomDisconnected);
    this.room.on(RoomEvent.AudioPlaybackStatusChanged, this.handleAudioPlaybackStatusChanged);

    this.prepareConnection().catch(err => {
      // FIXME: figure out a better logging solution?
      console.warn('WARNING: Room.prepareConnection failed:', err);
    });
  }

  async connect() {
    // await this.waitUntilRoomDisconnected()
    await Promise.all([
      this.connectionCredentialsProvider.generate().then(connection => (
        this.room.connect(connection.serverUrl, connection.participantToken)
      )),
      // FIXME: make it so the preconenct buffer thing can be disabled?
      this.room.localParticipant.setMicrophoneEnabled(true, undefined, { preConnectBuffer: true }),
    ]);

    await this.waitUntilAgentIsAvailable();
  }
  async disconnect() {
    await this.room.disconnect();
  }

  async prepareConnection() {
    const credentials = await this.connectionCredentialsProvider.generate();
    await this.room.prepareConnection(credentials.serverUrl, credentials.participantToken);
  }

  private handleRoomConnected = () => {
    console.log('!! CONNECTED');
    this.agent = new Agent(this.room);
    this.agent.on(AgentEvent.AgentStateChanged, this.handleAgentStateChanged);

    const chatMessageSender = new ChatMessageSender(this.localParticipant);
    this.messageSender = new CombinedMessageSender(
      chatMessageSender,
      // TODO: other types of messages that can be sent
    );

    this.messageReceiver = new CombinedMessageReceiver(
      new TranscriptionMessageReceiver(this.room),
      chatMessageSender.generateLoopbackMessageReceiver(),
      // TODO: images? attachments? rpc?
    );
    (async () => {
      // FIXME: is this sort of pattern a better idea than just making MessageReceiver an EventEmitter?
      // FIXME: this probably doesn't handle errors properly right now
      for await (const message of this.messageReceiver!.messages()) {
        this.handleIncomingMessage(message);
      }
    })();

    this.startAgentConnectedTimeout();
  }

  private handleRoomDisconnected = () => {
    console.log('!! DISCONNECTED');
    this.agent?.off(AgentEvent.AgentStateChanged, this.handleAgentStateChanged);
    this.agent?.teardown();
    this.agent = null;

    this.messageReceiver?.close();
    this.messageReceiver = null;

    if (this.agentConnectedTimeout) {
      clearTimeout(this.agentConnectedTimeout);
      this.agentConnectedTimeout = null;
    }

    this.emit(AgentSessionEvent.Disconnected);
  }

  private agentConnectedTimeout: NodeJS.Timeout | null = null;
  private startAgentConnectedTimeout = () => {
    this.agentConnectedTimeout = setTimeout(() => {
      if (!this.isAvailable) {
        const reason =
          this.state === 'connecting'
            ? 'Agent did not join the room. '
            : 'Agent connected but did not complete initializing. ';

        this.emit(AgentSessionEvent.AgentConnectionFailure, reason);
        this.disconnect();
      }
    }, 10_000);
  }

  private handleAgentStateChanged = async (newAgentState: AgentState) => {
    this.emit(AgentSessionEvent.AgentStateChanged, newAgentState);
  };

  private handleAudioPlaybackStatusChanged = async () => {
    this.emit(AgentSessionEvent.AudioPlaybackStatusChanged, this.room.canPlaybackAudio);
  };

  private handleIncomingMessage = (incomingMessage: ReceivedMessage) => {
    this.emit(AgentSessionEvent.MessageReceived, incomingMessage);
  }

  get state() {
    return this.agent?.state ?? 'disconnected';
  }

  get isAvailable() {
    return this.state == 'listening' || this.state == 'thinking' || this.state == 'speaking';
  }

  /** Returns a promise that resolves once the agent is available for interaction */
  private async waitUntilAgentIsAvailable(signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const stateChangedHandler = () => {
        if (!this.isAvailable) {
          return;
        }
        cleanup();
        resolve();
      };
      const abortHandler = () => {
        cleanup();
        reject(new Error('AgentSession.waitUntilAgentIsAvailable - signal aborted'));
      };

      const cleanup = () => {
        this.off(AgentSessionEvent.AgentStateChanged, stateChangedHandler);
        signal?.removeEventListener('abort', abortHandler);
      };

      this.on(AgentSessionEvent.AgentStateChanged, stateChangedHandler);
      signal?.addEventListener('abort', abortHandler);
    });
  }

  private async waitUntilRoomConnected(signal?: AbortSignal) {
    if (this.room.state === ConnectionState.Connected /* FIXME: should I check for other states too? */) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const onceRoomConnected = () => {
        cleanup();
        resolve();
      };
      const abortHandler = () => {
        cleanup();
        reject(new Error('AgentSession.waitUntilRoomConnected - signal aborted'));
      };

      const cleanup = () => {
        this.room.off(RoomEvent.Connected, onceRoomConnected);
        signal?.removeEventListener('abort', abortHandler);
      };

      this.room.on(RoomEvent.Connected, onceRoomConnected);
      signal?.addEventListener('abort', abortHandler);
    });
  }

  get localParticipant() {
    return this.room?.localParticipant ?? null;
  }

  /**
    * Create a ReceivedMessageAggregator, which allows one to view a snapshot of all received
    * messages at the current time.
    */
  async createMessageAggregator(options: ReceivedMessageAggregatorOptions = {}) {
    await this.waitUntilRoomConnected();

    const aggregator = new ReceivedMessageAggregator(options);
    this.on(AgentSessionEvent.MessageReceived, aggregator.upsert);

    const closeHandler = () => {
      this.off(AgentSessionEvent.MessageReceived, aggregator.upsert);
      aggregator.off(ReceivedMessageAggregatorEvent.Close, closeHandler);
    };
    aggregator.on(ReceivedMessageAggregatorEvent.Close, closeHandler);

    return aggregator;
  }

  // FIXME: maybe there should be a special case where if message is `string` it is converted into
  // a `SentChatMessage`?
  async sendMessage(message: SentMessage | string) {
    if (!this.messageSender) {
      throw new Error('AgentSession.sendMessage - cannot send message until room is connected and MessageSender initialized!');
    }
    const constructedMessage: SentMessage = typeof message === 'string' ? {
      id: `${Math.random()}`, /* FIXME: fix id generation */
      direction: 'outbound',
      timestamp: new Date(),
      content: { type: 'chat', text: message },
    } : message;
    await this.messageSender.send(constructedMessage);
  }
  // onMessage?: (callback: (reader: TextStreamReader) => void) => void | undefined;

  // TODO: RPC stuff
  // registerRpcHandler: (
  //   method: string,
  //   handler: (data: RpcInvocationData) => Promise<string>,
  // ) => void;
  // performRpc: (method: string, payload: string) => Promise<string>;

  // TODO: Client media controls
  // setCameraEnabled: (enabled: boolean) => Promise<LocalTrackPublication | undefined>;
  // setMicrophoneEnabled: (enabled: boolean) => Promise<LocalTrackPublication | undefined>;
  // setScreenShareEnabled: (enabled: boolean) => Promise<LocalTrackPublication | undefined>;
  // setCameraInput: (deviceId: string) => Promise<boolean>;
  // setMicrophoneInput: (deviceId: string) => Promise<boolean>;

  // Media Playback
  async startAudioPlayback() {
    await this.room.startAudio();

    // FIXME: add audio track to audio element / etc
    // This probably needs to contain much of the logic in RoomAudioRenderer?
    // And then make a similar type of component that then uses this function internally?
  }
}
