import type TypedEventEmitter from 'typed-emitter';
import { Room, RoomEvent, ConnectionState, TrackPublishOptions } from 'livekit-client';

import { type ReceivedMessage } from "./message";
import { AgentConversationalState, AgentEvent, AgentInstance, createAgent } from './Agent';
import { ConnectionCredentialsProvider } from './ConnectionCredentialsProvider';
import { ParticipantAttributes } from '../lib/participant-attributes';
import { createMessages, MessagesInstance } from './Messages';
import { createLocal, LocalInstance } from './Local';
import { createScopedGetSet } from '../lib/scoped-get-set';

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
  credentials: ConnectionCredentialsProvider;
};

export type AgentSessionConnectOptions = {
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

type AgentSessionInstanceCommon = {
  [Symbol.toStringTag]: "AgentSessionInstance",

  credentials: ConnectionCredentialsProvider;

  /** Returns a promise that resolves once the room connects. */
  waitUntilConnected: (signal?: AbortSignal) => void;
  /** Returns a promise that resolves once the room disconnects */
  waitUntilDisconnected: (signal?: AbortSignal) => void;

  agentConnectTimeout: {
    delayInMilliseconds: number;
    timeoutId: NodeJS.Timeout | null;
  } | null,

  prepareConnection: () => Promise<void>,
  connect: (options?: AgentSessionConnectOptions) => Promise<void>;
  disconnect: () => Promise<void>;

  canPlayAudio: boolean;
  startAudio: () => Promise<void>;

  subtle: {
    emitter: TypedEventEmitter<AgentSessionCallbacks>;
    room: Room;
  };
};

type AgentSessionInstanceConnected = AgentSessionInstanceCommon & {
  connectionState: "connected";
  isConnected: true;
  isReconnecting: boolean;

  agent: AgentInstance;
  local: LocalInstance;
  messages: MessagesInstance;
};

type AgentSessionInstanceReconnecting = AgentSessionInstanceCommon & {
  connectionState: "reconnecting" | "signalReconnecting";
  isConnected: true;
  isReconnecting: true;

  agent: AgentInstance;
  local: LocalInstance;
  messages: MessagesInstance;
};

type AgentSessionInstanceNotConnected = AgentSessionInstanceCommon & {
  connectionState: "connecting" | "disconnected";
  isConnected: false;
  isReconnecting: false;

  agent: null;
  local: null;
  messages: null;
};

export type AgentSessionInstance = AgentSessionInstanceConnected | AgentSessionInstanceReconnecting | AgentSessionInstanceNotConnected;

 /**
   * AgentSession represents a connection to a LiveKit Agent, providing abstractions to make 1:1
   * agent/participant rooms easier to work with.
   */
export function createAgentSession(
  options: AgentSessionOptions,
  get: () => AgentSessionInstance,
  set: (fn: (old: AgentSessionInstance) => AgentSessionInstance) => void,
  emitter: TypedEventEmitter<AgentSessionCallbacks>,
): AgentSessionInstance {
  const room = new Room();

  const handleAgentAttributesChanged = () => {
    set((old) => generateConnectionStateUpdate(old, old.agent, old.local, old.messages));
  };

  const handleRoomConnected = async () => {
    console.log('!! CONNECTED');

    const { get: agentGet, set: agentSet } = createScopedGetSet(get, set, 'agent');
    const agent = createAgent(room, agentGet, agentSet);
    agent.subtle.emitter.on(AgentEvent.AgentAttributesChanged, handleAgentAttributesChanged);

    const { get: localGet, set: localSet } = createScopedGetSet(get, set, 'local');
    const local = createLocal(room, localGet, localSet);

    const { get: messagesGet, set: messagesSet } = createScopedGetSet(get, set, 'messages');
    const messages = createMessages(room, messagesGet, messagesSet);

    set((old) => generateConnectionStateUpdate(old, agent, local, messages));
    agent.subtle.initialize();
    local.subtle.initialize();
    messages.subtle.initialize();

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
    get().agent?.subtle.teardown();
    get().agent?.subtle.emitter.off(AgentEvent.AgentAttributesChanged, handleAgentAttributesChanged);

    get().local?.subtle.teardown();
    get().messages?.subtle.teardown();

    set((old) => generateConnectionStateUpdate(old, null, null, null));

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
    set((old) => generateConnectionStateUpdate(old, old.agent, old.local, old.messages));
  };
  room.on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged);


  const connect = async (connectOptions: AgentSessionConnectOptions = {}) => {
    const {
      waitForDisconnectSignal,
      agentConnectTimeoutMilliseconds = DEFAULT_AGENT_CONNECT_TIMEOUT_MILLISECONDS,
      tracks = { microphone: { enabled: true, publishOptions: { preConnectBuffer: true } } },
    } = connectOptions;

    await waitUntilDisconnected(waitForDisconnectSignal);

    set((old) => ({
      ...old,
      agentConnectTimeout: {
        delayInMilliseconds: agentConnectTimeoutMilliseconds,
        timeoutId: null,
      },
    }));

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

  const startAgentConnectedTimeout = (agentConnectTimeoutMilliseconds: AgentSessionConnectOptions["agentConnectTimeoutMilliseconds"] | null) => {
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

  const generateConnectionState = (agent: AgentInstance | null): AgentSessionConnectionState => {
    const roomConnectionState = room.state;
    if (roomConnectionState === ConnectionState.Disconnected) {
      return 'disconnected';
    } else if (
      roomConnectionState === ConnectionState.Connecting ||
      !agent?.subtle.agentParticipant ||
      !agent?.attributes[ParticipantAttributes.state]
    ) {
      return 'connecting';
    } else {
      return roomConnectionState;
    }
  };
  const generateDerivedConnectionStateValues = <ConnectionState extends AgentSessionInstance["connectionState"]>(connectionState: ConnectionState) => ({
    isConnected: (
      connectionState === 'connected' ||
      connectionState === 'reconnecting' ||
      connectionState === 'signalReconnecting'
    ),
    isReconnecting: (
      connectionState === 'reconnecting' ||
      connectionState === 'signalReconnecting'
    ),
  } as {
    isConnected: ConnectionState extends 'connected' | 'reconnecting' | 'signalReconnecting' ? true : false,
    isReconnecting: ConnectionState extends 'reconnecting' | 'signalReconnecting' ? true : false,
  });

  const generateConnectionStateUpdate = (
    old: AgentSessionInstance,
    agent: AgentInstance | null,
    local: LocalInstance | null,
    messages: MessagesInstance | null,
  ): AgentSessionInstance => {
    const newConnectionState = generateConnectionState(agent);

    if (old.connectionState !== newConnectionState) {
      emitter.emit(AgentSessionEvent.AgentConnectionStateChanged, newConnectionState);
    }

    switch (newConnectionState) {
      case 'connected':
      case 'reconnecting':
      case 'signalReconnecting':
        if (!local || !agent || !messages) {
          throw new Error(`AgentSessionInstance.generateConnectionStateUpdate - attempted to transition to connection state ${newConnectionState}, but local / agent / messages not found.`);
        }
        return {
          ...old,

          connectionState: 'connected',
          ...generateDerivedConnectionStateValues('connected'),

          local,
          agent,
          messages,
        };

      default:
        return {
          ...old,

          connectionState: newConnectionState,
          ...generateDerivedConnectionStateValues(newConnectionState),

          // Clear inner values if no longer connected
          local: null,
          agent: null,
          messages: null,
        };
    }
  };

  return {
    [Symbol.toStringTag]: "AgentSessionInstance",

    credentials: options.credentials,

    connectionState: 'disconnected',
    ...generateDerivedConnectionStateValues('disconnected'),

    agent: null,
    local: null,
    messages: null,

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
