import type TypedEventEmitter from 'typed-emitter';
import { Room } from 'livekit-client';
import { EventEmitter } from "events";

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

type SendMessageFunction = {
  // Plain chat messages
  (message: string): Promise<void>;
  (message: string, options: SentChatMessageOptions): Promise<void>;

  // Custom messages
  // (if SentMessageOptions<SentMessage> can be undefined, then options is optional, otherwise it is required)
  <
    Message extends SentMessage,
    OptionalOptions extends SentMessageOptions<SentMessage> | undefined
  >(message: Message): Promise<void>;
  <Message extends SentMessage>(message: Message, options: SentMessageOptions<Message>): Promise<void>;
};

export type MessagesInstance = {
  [Symbol.toStringTag]: "MessagesInstance",

  list: Array<ReceivedMessage>;

  /** Is a send operation currently in progress? */
  sendPending: boolean;

  send: SendMessageFunction,

  /**
    * Create a ReceivedMessageAggregator, which allows one to view a snapshot of all received
    * messages at the current time.
    */
  createMessageAggregator: (options?: ReceivedMessageAggregatorOptions) => ReceivedMessageAggregator<ReceivedMessage>;

  subtle: {
    emitter: TypedEventEmitter<MessagesCallbacks>;
    initialize: () => void;
    teardown: () => void;

    messageSender: MessageSender | null;
    messageReceiver: MessageReceiver | null;
    defaultMessageAggreggator: ReceivedMessageAggregator<ReceivedMessage> | null;
  };
}

export enum MessagesEvent {
  MessageReceived = 'messageReceived',
  Disconnected = 'disconnected',
}

export type MessagesCallbacks = {
  [MessagesEvent.MessageReceived]: (message: ReceivedMessage) => void;
  [MessagesEvent.Disconnected]: () => void;
};

export function createMessages(
  room: Room,
  get: () => MessagesInstance,
  set: (fn: (old: MessagesInstance) => MessagesInstance) => void,
): MessagesInstance {
  const emitter = new EventEmitter() as TypedEventEmitter<MessagesCallbacks>;

  const handleIncomingMessage = (incomingMessage: ReceivedMessage) => {
    emitter.emit(MessagesEvent.MessageReceived, incomingMessage);
  };


  const handleDefaultMessageAggregatorUpdated = () => {
    set((old) => ({
      ...old,
      list: old.subtle.defaultMessageAggreggator?.toArray() ?? [],
    }));
  };

  const initialize = () => {
    const chatMessageSender = new ChatMessageSender(room.localParticipant);
    const messageSender = new CombinedMessageSender(
      chatMessageSender,
      // TODO: other types of messages that can be sent
    );
    set((old) => ({ ...old, subtle: { ...old.subtle, messageSender } }));

    const messageReceiver = new CombinedMessageReceiver(
      new TranscriptionMessageReceiver(room),
      chatMessageSender.generateLoopbackMessageReceiver(),
      // TODO: images? attachments? rpc?
    );
    set((old) => ({ ...old, subtle: { ...old.subtle, messageReceiver } }));
    (async () => {
      // FIXME: is this sort of pattern a better idea than just making MessageReceiver an EventEmitter?
      // FIXME: this probably doesn't handle errors properly right now
      for await (const message of messageReceiver.messages()) {
        handleIncomingMessage(message);
      }
    })();

    const defaultMessageAggreggator = createMessageAggregator();
    defaultMessageAggreggator.on(ReceivedMessageAggregatorEvent.Updated, handleDefaultMessageAggregatorUpdated);
    set((old) => ({ ...old, subtle: { ...old.subtle, defaultMessageAggreggator } }));
  };

  const teardown = () => {
    get().subtle.messageReceiver?.close();
    set((old) => ({ ...old, subtle: { ...old.subtle, messageReceiver: null } }));

    get().subtle.defaultMessageAggreggator?.off(ReceivedMessageAggregatorEvent.Updated, handleDefaultMessageAggregatorUpdated);
    set((old) => ({ ...old, subtle: { ...old.subtle, defaultMessageAggreggator: null } }));
  };

  const sendMessage: SendMessageFunction = async <Message extends SentMessage | string>(
    message: Message,
    options?: Message extends SentMessage ? SentMessageOptions<Message> : SentChatMessageOptions,
  ) => {
    const messageSender = get().subtle.messageSender;
    if (!messageSender) {
      throw new Error('AgentSession.sendMessage - cannot send message until room is connected and MessageSender initialized!');
    }

    set((old) => ({ ...old, sendPending: true }));

    const constructedMessage: SentMessage = typeof message === 'string' ? {
      id: `${Math.random()}`, /* FIXME: fix id generation */
      direction: 'outbound',
      timestamp: new Date(),
      content: { type: 'chat', text: message },
    } : message;
    try {
      await messageSender.send(constructedMessage, options);
    } finally {
      set((old) => ({ ...old, sendPending: false }));
    }
  };

  const createMessageAggregator = (options: ReceivedMessageAggregatorOptions = {}) => {
    const aggregator = new ReceivedMessageAggregator(options);
    emitter.on(MessagesEvent.MessageReceived, aggregator.upsert);
    emitter.on(MessagesEvent.Disconnected, aggregator.close);

    const closeHandler = () => {
      emitter.off(MessagesEvent.MessageReceived, aggregator.upsert);
      emitter.off(MessagesEvent.Disconnected, aggregator.close);
      aggregator.off(ReceivedMessageAggregatorEvent.Close, closeHandler);
    };
    aggregator.on(ReceivedMessageAggregatorEvent.Close, closeHandler);

    return aggregator;
  };

  return {
    [Symbol.toStringTag]: "MessagesInstance",

    list: [],
    sendPending: false,
    send: sendMessage,
    createMessageAggregator,

    subtle: {
      emitter,
      initialize,
      teardown,

      messageSender: null,
      messageReceiver: null,
      defaultMessageAggreggator: null,
    },
  };
}
