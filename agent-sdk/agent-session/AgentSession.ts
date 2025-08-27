import type TypedEventEmitter from 'typed-emitter';
import { EventEmitter } from "events";
import { Room, RoomEvent, ConnectionState, TrackPublishOptions } from 'livekit-client';

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
  SentMessageOptions,
  SentChatMessageOptions,
} from "./message";
import Agent, { AgentConversationalState, AgentEvent, AgentInstance, createAgent } from './Agent';
import { ConnectionCredentialsProvider } from './ConnectionCredentialsProvider';
import { ParticipantAttributes } from '../lib/participant-attributes';
import { createMessages, MessagesEvent, MessagesInstance } from './Messages';
import { createLocal, LocalInstance } from './Local';

/** State representing the current connection status to the server hosted agent */
// FIXME: maybe just make this ConnectionState?
export type AgentSessionConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'signalReconnecting';

export enum AgentSessionEvent {
  AgentConnectionStateChanged = 'agentConnectionStateChanged',
  AgentConversationalStateChanged = 'agentConversationalStateChanged',
  AgentAttributesChanged = 'agentAttributesChanged',
  MessageReceived = 'messageReceived',
  Connected = 'connected',
  Disconnected = 'disconnected',
  AgentConnectionFailure = 'agentConnectionFailure',
  AudioPlaybackStatusChanged = 'AudioPlaybackStatusChanged',
  MediaDevicesError = 'MediaDevicesError',
}

export type AgentSessionCallbacks = {
  [AgentSessionEvent.AgentConnectionStateChanged]: (newAgentConnectionState: AgentSessionConnectionState) => void;
  [AgentSessionEvent.AgentConversationalStateChanged]: (newAgentConversationalState: AgentConversationalState) => void;
  [AgentSessionEvent.MessageReceived]: (newMessage: ReceivedMessage) => void;
  [AgentSessionEvent.AgentConnectionFailure]: (reason: string) => void;
  [AgentSessionEvent.AudioPlaybackStatusChanged]: (audioPlaybackPermitted: boolean) => void;
  [AgentSessionEvent.Connected]: () => void;
  [AgentSessionEvent.Disconnected]: () => void;
  [AgentSessionEvent.MediaDevicesError]: (error: Error) => void;
};

export type AgentSessionOptions = {
  /** Optional abort signal which if triggered will stop waiting for the room to be disconnected
    * prior to connecting
    *
    * FIXME: is this a confusing property to expose? Maybe expose one `signal` that universally
    * could apply across the whole agentSession.connect(...) call?
    */
  waitForDisconnectSignal?: AbortSignal;

  /**
    * Amount of time in milliseonds the system will wait for an agent to join the room, before
    * emitting an AgentSessionEvent.AgentConnectionFailure event.
    */
  agentConnectTimeoutMilliseconds?: number;

  // FIXME: not sure about this pattern, background thinking is that it would be good to be able to
  // abstract away enabling relevant media tracks to the caller so they don't have to interface with
  // the room.
  tracks?: {
    microphone?: {
      enabled?: boolean;
      publishOptions?: TrackPublishOptions;
    };
  };
};

// FIXME: make this 10 seconds once room dispatch booting info is discoverable
const DEFAULT_AGENT_CONNECT_TIMEOUT_MILLISECONDS = 20_000;


export type SwitchActiveDeviceOptions = {
  /**
   *  If true, adds an `exact` constraint to the getUserMedia request.
   *  The request will fail if this option is true and the device specified is not actually available
   */
  exact?: boolean;
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
  protected agentConnectTimeoutMilliseconds: AgentSessionOptions["agentConnectTimeoutMilliseconds"] | null = null;

  protected connectionCredentialsProvider: ConnectionCredentialsProvider;

  constructor(provider: ConnectionCredentialsProvider) {
    super();
    this.connectionCredentialsProvider = provider;

    this.room = new Room();
    this.room.on(RoomEvent.Connected, this.handleRoomConnected);
    this.room.on(RoomEvent.Disconnected, this.handleRoomDisconnected);
    this.room.on(RoomEvent.AudioPlaybackStatusChanged, this.handleAudioPlaybackStatusChanged);
    this.room.on(RoomEvent.MediaDevicesError, this.handleMediaDevicesError);

    this.prepareConnection().catch(err => {
      // FIXME: figure out a better logging solution?
      console.warn('WARNING: Room.prepareConnection failed:', err);
    });
  }

  async connect(options: AgentSessionOptions = {}) {
    const {
      waitForDisconnectSignal,
      agentConnectTimeoutMilliseconds = DEFAULT_AGENT_CONNECT_TIMEOUT_MILLISECONDS,
      tracks = { microphone: { enabled: true, publishOptions: { preConnectBuffer: true } } },
    } = options;
    this.agentConnectTimeoutMilliseconds = agentConnectTimeoutMilliseconds;

    await this.waitUntilRoomDisconnected(waitForDisconnectSignal);

    await Promise.all([
      this.connectionCredentialsProvider.generate().then(connection => (
        this.room.connect(connection.serverUrl, connection.participantToken)
      )),

      // Start microphone (with preconnect buffer) by default
      tracks.microphone?.enabled ? (
        this.room.localParticipant.setMicrophoneEnabled(true, undefined, tracks.microphone?.publishOptions ?? {})
      ) : Promise.resolve(),
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
    this.agent.on(AgentEvent.AgentConnectionStateChanged, this.handleAgentConnectionStateChanged);
    this.agent.on(AgentEvent.AgentConversationalStateChanged, this.handleAgentConversationalStateChanged);

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
    this.agent?.off(AgentEvent.AgentConnectionStateChanged, this.handleAgentConnectionStateChanged);
    this.agent?.off(AgentEvent.AgentConversationalStateChanged, this.handleAgentConversationalStateChanged);
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
          this.connectionState === 'connecting'
            ? 'Agent did not join the room. '
            : 'Agent connected but did not complete initializing. ';

        this.emit(AgentSessionEvent.AgentConnectionFailure, reason);
        this.disconnect();
      }
    }, this.agentConnectTimeoutMilliseconds ?? DEFAULT_AGENT_CONNECT_TIMEOUT_MILLISECONDS);
  }

  private handleAgentConnectionStateChanged = async (newConnectionState: AgentSessionConnectionState) => {
    this.emit(AgentSessionEvent.AgentConnectionStateChanged, newConnectionState);
  };

  private handleAgentConversationalStateChanged = async (newConversationalState: AgentConversationalState) => {
    this.emit(AgentSessionEvent.AgentConversationalStateChanged, newConversationalState);
  };

  private handleAudioPlaybackStatusChanged = async () => {
    this.emit(AgentSessionEvent.AudioPlaybackStatusChanged, this.room.canPlaybackAudio);
  };

  private handleMediaDevicesError = async (error: Error) => {
    this.emit(AgentSessionEvent.MediaDevicesError, error);
  };

  private handleIncomingMessage = (incomingMessage: ReceivedMessage) => {
    this.emit(AgentSessionEvent.MessageReceived, incomingMessage);
  }

  get connectionState() {
    return this.agent?.connectionState ?? 'disconnected';
  }
  get conversationalState() {
    return this.agent?.conversationalState ?? 'disconnected';
  }

  /** Has the session successfully connected to the running agent? */
  get isConnected() {
    return (
      this.connectionState === 'connected' ||
      this.connectionState === 'reconnecting' ||
      this.connectionState === 'signalReconnecting'
    );
  }

  /** Is the agent ready for user interaction? */
  get isAvailable() {
    return (
      this.conversationalState === 'listening' ||
      this.conversationalState === 'thinking' ||
      this.conversationalState === 'speaking'
    );
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
        this.off(AgentSessionEvent.AgentConnectionStateChanged, stateChangedHandler);
        this.off(AgentSessionEvent.AgentConversationalStateChanged, stateChangedHandler);
        signal?.removeEventListener('abort', abortHandler);
      };

      this.on(AgentSessionEvent.AgentConnectionStateChanged, stateChangedHandler);
      this.on(AgentSessionEvent.AgentConversationalStateChanged, stateChangedHandler);
      signal?.addEventListener('abort', abortHandler);
    });
  }

  private async waitUntilRoomConnected(signal?: AbortSignal) {
    return this.waitUntilRoomState(
      ConnectionState.Connected, /* FIXME: should I check for other states too? */
      RoomEvent.Connected,
      signal,
    );
  }

  private async waitUntilRoomDisconnected(signal?: AbortSignal) {
    return this.waitUntilRoomState(
      ConnectionState.Disconnected,
      RoomEvent.Disconnected,
      signal,
    );
  }

  private async waitUntilRoomState(state: ConnectionState, stateMonitoringEvent: RoomEvent, signal?: AbortSignal) {
    if (this.room.state === state) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const onceRoomEventOccurred = () => {
        cleanup();
        resolve();
      };
      const abortHandler = () => {
        cleanup();
        reject(new Error(`AgentSession.waitUntilRoomState(${state}, ...) - signal aborted`));
      };

      const cleanup = () => {
        this.room.off(stateMonitoringEvent, onceRoomEventOccurred);
        signal?.removeEventListener('abort', abortHandler);
      };

      this.room.on(stateMonitoringEvent, onceRoomEventOccurred);
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
    this.on(AgentSessionEvent.Disconnected, aggregator.close);

    const closeHandler = () => {
      this.off(AgentSessionEvent.MessageReceived, aggregator.upsert);
      this.off(AgentSessionEvent.Disconnected, aggregator.close);
      aggregator.off(ReceivedMessageAggregatorEvent.Close, closeHandler);
    };
    aggregator.on(ReceivedMessageAggregatorEvent.Close, closeHandler);

    return aggregator;
  }

  async sendMessage<Message extends SentMessage | string>(
    message: Message,
    options: Message extends SentMessage ? SentMessageOptions<Message> : SentChatMessageOptions,
  ) {
    if (!this.messageSender) {
      throw new Error('AgentSession.sendMessage - cannot send message until room is connected and MessageSender initialized!');
    }
    const constructedMessage: SentMessage = typeof message === 'string' ? {
      id: `${Math.random()}`, /* FIXME: fix id generation */
      direction: 'outbound',
      timestamp: new Date(),
      content: { type: 'chat', text: message },
    } : message;
    await this.messageSender.send(constructedMessage, options);
  }
  // onMessage?: (callback: (reader: TextStreamReader) => void) => void | undefined;

  getActiveDevice(kind: MediaDeviceKind) {
    return this.room.getActiveDevice(kind)
  }

  switchActiveDevice(kind: MediaDeviceKind, deviceId: string, options: SwitchActiveDeviceOptions = {}) {
    return this.room.switchActiveDevice(kind, deviceId, options.exact)
  }

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

  get subtle(): { readonly room: Room } {
    return { room: this.room };
  }
}











export type AgentSessionInstance = {
  [Symbol.toStringTag]: "AgentSessionInstance",

  credentials: ConnectionCredentialsProvider;

  agent: AgentInstance | null;
  local: LocalInstance | null;
  messages: MessagesInstance | null;

  connectionState: AgentSessionConnectionState;
  isConnected: boolean;

  /** Returns a promise that resolves once the room connects. */
  waitUntilConnected: (signal?: AbortSignal) => void;
  /** Returns a promise that resolves once the room disconnects */
  waitUntilDisconnected: (signal?: AbortSignal) => void;

  agentConnectTimeout: {
    delayInMilliseconds: number;
    timeoutId: NodeJS.Timeout | null;
  } | null,

  prepareConnection: () => Promise<void>,
  connect: (options?: AgentSessionOptions) => Promise<void>;
  disconnect: () => Promise<void>;

  canPlayAudio: boolean;
  startAudio: () => Promise<void>;

  subtle: {
    emitter: TypedEventEmitter<AgentSessionCallbacks>;
    room: Room;
  };
}


 /**
   * AgentSession represents a connection to a LiveKit Agent, providing abstractions to make 1:1
   * agent/participant rooms easier to work with.
   */
export function createAgentSession(
  options: { credentials: ConnectionCredentialsProvider },
  get: () => AgentSessionInstance,
  set: (fn: (old: AgentSessionInstance) => AgentSessionInstance) => void,
  emitter: TypedEventEmitter<AgentSessionCallbacks>,
): AgentSessionInstance {
  const room = new Room();

  // FIXME: is this event worth it? It's just proxying an event from the messages layer.
  const handleIncomingMessage = (incomingMessage: ReceivedMessage) => {
    emitter.emit(AgentSessionEvent.MessageReceived, incomingMessage);
  };

  const handleAgentAttributesChanged = () => {
    updateConnectionState();
  };


  const handleRoomConnected = async () => {
    console.log('!! CONNECTED');

    const agentEmitter = new EventEmitter(); // FIXME: can I get rid of this?
    const agent = createAgent(
      room,
      () => get().agent!, // FIXME: handle null case better
      (fn) => set((old) => ({ ...old, agent: fn(old.agent!) })),
      agentEmitter as any,
    );
    agent.subtle.emitter.on(AgentEvent.AgentAttributesChanged, handleAgentAttributesChanged);
    // agent.on(AgentEvent.AgentConnectionStateChanged, this.handleAgentConnectionStateChanged);
    // agent.on(AgentEvent.AgentConversationalStateChanged, this.handleAgentConversationalStateChanged);
    set((old) => ({ ...old, agent }));
    agent.initialize();
    updateConnectionState();

    const localEmitter = new EventEmitter(); // FIXME: can I get rid of this?
    const local = createLocal(
      room,
      () => get().local!, // FIXME: handle null case better
      (fn) => set((old) => ({ ...old, local: fn(old.local!) })),
      localEmitter as any,
    );
    set((old) => ({ ...old, local }));
    local.initialize();

    const messagesEmitter = new EventEmitter(); // FIXME: can I get rid of this?
    const messages = createMessages(
      room,
      () => get().messages!, // FIXME: handle null case better
      (fn) => set((old) => ({ ...old, messages: fn(old.messages!) })),
      messagesEmitter as any,
    );
    messages.subtle.emitter.on(MessagesEvent.MessageReceived, handleIncomingMessage);
    set((old) => ({ ...old, messages }));
    messages.initialize();

    set((old) => {
      if (!old.agentConnectTimeout) {
        // (this case shoudln't in practice ever happen)
        throw new Error('AgentSessionInstance.connect - agentConnectTimeout not set, aborting!');
      }

      return {
        ...old,
        agentConnectTimeout: {
          delayInMilliseconds: old.agentConnectTimeout.delayInMilliseconds,
          timeoutId: startAgentConnectedTimeout(old.agentConnectTimeout.delayInMilliseconds),
        },
      };
    });

    emitter.emit(AgentSessionEvent.Connected);
  };
  room.on(RoomEvent.Connected, handleRoomConnected);

  const handleRoomDisconnected = () => {
    console.log('!! DISCONNECTED');
    // old.subtle.agent?.off(AgentEvent.AgentConnectionStateChanged, this.handleAgentConnectionStateChanged);
    // old.subtle.agent?.off(AgentEvent.AgentConversationalStateChanged, this.handleAgentConversationalStateChanged);
    get().agent?.teardown();
    get().agent?.subtle.emitter.off(AgentEvent.AgentAttributesChanged, handleAgentAttributesChanged);
    set((old) => ({ ...old, agent: null }));

    get().local?.teardown();
    set((old) => ({ ...old, local: null }));

    get().messages?.teardown();
    get().messages?.subtle.emitter.off(MessagesEvent.MessageReceived, handleIncomingMessage);
    set((old) => ({ ...old, messages: null }));

    set((old) => {
      if (old.agentConnectTimeout?.timeoutId) {
        clearTimeout(old.agentConnectTimeout?.timeoutId);
      }
      return { ...old, agentConnectTimeout: null };
    });

    emitter.emit(AgentSessionEvent.Disconnected);

    options.credentials.refresh();
  };
  room.on(RoomEvent.Disconnected, handleRoomDisconnected);

  const handleAudioPlaybackStatusChanged = async () => {
    const canPlayAudio = get().subtle.room.canPlaybackAudio;
    set((old) => ({ ...old, canPlayAudio }));
    emitter.emit(AgentSessionEvent.AudioPlaybackStatusChanged, canPlayAudio);
  };
  room.on(RoomEvent.AudioPlaybackStatusChanged, handleAudioPlaybackStatusChanged);

  const handleMediaDevicesError = async (error: Error) => {
    emitter.emit(AgentSessionEvent.MediaDevicesError, error);
  };
  room.on(RoomEvent.MediaDevicesError, handleMediaDevicesError);

  const handleConnectionStateChanged = () => {
    updateConnectionState();
  };
  room.on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged);


  const connect = async (connectOptions: AgentSessionOptions = {}) => {
    const {
      waitForDisconnectSignal,
      agentConnectTimeoutMilliseconds = DEFAULT_AGENT_CONNECT_TIMEOUT_MILLISECONDS,
      tracks = { microphone: { enabled: true, publishOptions: { preConnectBuffer: true } } },
    } = connectOptions;

    set((old) => ({
      ...old,
      agentConnectTimeout: {
        delayInMilliseconds: agentConnectTimeoutMilliseconds,
        timeoutId: null,
      },
    }));

    await waitUntilDisconnected(waitForDisconnectSignal);

    const state = get();
    await Promise.all([
      options.credentials.generate().then(connection => (
        state.subtle.room.connect(connection.serverUrl, connection.participantToken)
      )),

      // Start microphone (with preconnect buffer) by default
      tracks.microphone?.enabled ? (
        state.subtle.room.localParticipant.setMicrophoneEnabled(true, undefined, tracks.microphone?.publishOptions ?? {})
      ) : Promise.resolve(),
    ]);

    await waitUntilConnected();
    await get().agent!.waitUntilAvailable();
  };
  const disconnect = async () => {
    await get().subtle.room.disconnect();
  };

  const prepareConnection = async () => {
    const credentials = await options.credentials.generate();
    await room.prepareConnection(credentials.serverUrl, credentials.participantToken);
  };
  prepareConnection().catch(err => {
    // FIXME: figure out a better logging solution?
    console.warn('WARNING: Room.prepareConnection failed:', err);
  });

  const startAudio = async () => get().subtle.room.startAudio();

  const startAgentConnectedTimeout = (agentConnectTimeoutMilliseconds: AgentSessionOptions["agentConnectTimeoutMilliseconds"] | null) => {
    return setTimeout(() => {
      const { connectionState, agent, disconnect } = get();
      if (!agent?.isAvailable) {
        const reason =
          connectionState === 'connecting'
            ? 'Agent did not join the room. '
            : 'Agent connected but did not complete initializing. ';

        emitter.emit(AgentSessionEvent.AgentConnectionFailure, reason);
        console.error('!! AGENT WAS NOT CONNECTED WITHIN TIMEOUT!');
        disconnect();
      }
    }, agentConnectTimeoutMilliseconds ?? DEFAULT_AGENT_CONNECT_TIMEOUT_MILLISECONDS);
  };

  const waitUntilConnected = async (signal?: AbortSignal) => {
    return waitUntilConnectionState(
      ConnectionState.Connected, /* FIXME: should I check for other states too? */
      AgentSessionEvent.Connected,
      signal,
    );
  };

  const waitUntilDisconnected = async (signal?: AbortSignal) => {
    return waitUntilConnectionState(
      ConnectionState.Disconnected,
      AgentSessionEvent.Disconnected,
      signal,
    );
  };

  const waitUntilConnectionState = async (
    state: ConnectionState,
    stateMonitoringEvent: keyof AgentSessionCallbacks,
    signal?: AbortSignal,
  ) => {
    const { connectionState } = get();
    if (connectionState === state) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const onceEventOccurred = () => {
        cleanup();
        resolve();
      };
      const abortHandler = () => {
        cleanup();
        reject(new Error(`AgentSession.waitUntilRoomState(${state}, ...) - signal aborted`));
      };

      const cleanup = () => {
        emitter.off(stateMonitoringEvent, onceEventOccurred);
        signal?.removeEventListener('abort', abortHandler);
      };

      emitter.on(stateMonitoringEvent, onceEventOccurred);
      signal?.addEventListener('abort', abortHandler);
    });
  };

  const updateConnectionState = () => {
    let newConnectionState: AgentSessionConnectionState;
    const { connectionState, agent } = get();

    const roomConnectionState = room.state;
    if (roomConnectionState === ConnectionState.Disconnected) {
      newConnectionState = 'disconnected';
    } else if (
      roomConnectionState === ConnectionState.Connecting ||
      !agent?.subtle.agentParticipant ||
      !agent?.attributes[ParticipantAttributes.state]
    ) {
      newConnectionState = 'connecting';
    } else {
      newConnectionState = roomConnectionState;
    }
    console.log('!! CONNECTION STATE:', newConnectionState);

    if (connectionState !== newConnectionState) {
      set((old) => ({
        ...old,
        connectionState: newConnectionState,
        ...generateDerivedConnectionStateValues(newConnectionState),
      }));
      emitter.emit(AgentSessionEvent.AgentConnectionStateChanged, newConnectionState);
    }
  };
  const generateDerivedConnectionStateValues = (conversationalState: AgentSessionInstance["connectionState"]) => ({
    isConnected: (
      conversationalState === 'connected' ||
      conversationalState === 'reconnecting' ||
      conversationalState === 'signalReconnecting'
    ),
  });

  return {
    [Symbol.toStringTag]: "AgentSessionInstance",

    credentials: options.credentials,

    agent: null,
    local: null,
    messages: null,

    connectionState: 'disconnected',
    ...generateDerivedConnectionStateValues('disconnected'),

    waitUntilConnected,
    waitUntilDisconnected,

    agentConnectTimeout: null,

    prepareConnection,
    connect,
    disconnect,

    canPlayAudio: false,
    startAudio,

    subtle: {
      emitter,
      room,
    },
  };
}
