import type TypedEventEmitter from 'typed-emitter';
import { Room, RoomEvent, ConnectionState, TrackPublishOptions } from 'livekit-client';

import { type ReceivedMessage } from "./message";
import { AgentConversationalState, AgentEvent, AgentInstance, createAgent } from './Agent';
import { ConnectionCredentialsProvider } from './ConnectionCredentialsProvider';
import { ParticipantAttributes } from '../lib/participant-attributes';
import { createMessages, MessagesInstance } from './Messages';
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
  connect: (options?: AgentSessionConnectOptions) => Promise<void>;
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
  options: AgentSessionOptions,
  get: () => AgentSessionInstance,
  set: (fn: (old: AgentSessionInstance) => AgentSessionInstance) => void,
  emitter: TypedEventEmitter<AgentSessionCallbacks>,
): AgentSessionInstance {
  const room = new Room();

  const handleAgentAttributesChanged = () => {
    updateConnectionState();
  };

  const handleRoomConnected = async () => {
    console.log('!! CONNECTED');

    const agent = createAgent(
      room,
      () => get().agent!, // FIXME: handle null case better
      (fn) => set((old) => ({ ...old, agent: fn(old.agent!) })),
    );
    agent.subtle.emitter.on(AgentEvent.AgentAttributesChanged, handleAgentAttributesChanged);
    // agent.on(AgentEvent.AgentConnectionStateChanged, this.handleAgentConnectionStateChanged);
    // agent.on(AgentEvent.AgentConversationalStateChanged, this.handleAgentConversationalStateChanged);
    set((old) => ({ ...old, agent }));
    agent.subtle.initialize();
    updateConnectionState();

    const local = createLocal(
      room,
      () => get().local!, // FIXME: handle null case better
      (fn) => set((old) => ({ ...old, local: fn(old.local!) })),
    );
    set((old) => ({ ...old, local }));
    local.subtle.initialize();

    const messages = createMessages(
      room,
      () => get().messages!, // FIXME: handle null case better
      (fn) => set((old) => ({ ...old, messages: fn(old.messages!) })),
    );
    set((old) => ({ ...old, messages }));
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
    set((old) => ({ ...old, agent: null }));

    get().local?.subtle.teardown();
    set((old) => ({ ...old, local: null }));

    get().messages?.subtle.teardown();
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
