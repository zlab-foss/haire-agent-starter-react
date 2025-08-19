import { SendTextOptions } from 'livekit-client';
import { TextStreamInfo } from '@/agent-sdk/external-deps/client-sdk-js';

export type BaseMessageId = string;
export type BaseMessage<Direction extends 'inbound' | 'outbound', Content> = {
  id: BaseMessageId;
  direction: Direction;
  timestamp: Date;
  content: Content;
};

export type ReceivedTranscriptionMessage = BaseMessage<'inbound', {
  type: 'transcription';
  text: string;
  participantInfo: { identity: string };
  streamInfo: TextStreamInfo;
}>;

export type ReceivedChatLoopbackMessage = BaseMessage<'inbound', { type: 'chat'; text: string }>;

export type ReceivedMessage =
  | ReceivedTranscriptionMessage
  | ReceivedChatLoopbackMessage;
  // TODO: images? attachments? rpc?

export type SentChatMessage = BaseMessage<'outbound', | { type: 'chat', text: string }>;
export type SentChatMessageOptions = SendTextOptions | undefined;

export type SentMessage =
  | SentChatMessage;

export type SentMessageOptions<Message extends SentMessage> =
  | (Message extends SentChatMessage ? SentChatMessageOptions : never);

// FIXME: maybe update all these functions to not have default exports as to avoid the duplicate
// names being written here?
export { default as MessageSender } from './send/MessageSender';
export { default as ChatMessageSender } from './send/ChatMessageSender';
export { default as CombinedMessageSender } from './send/CombinedMessageSender';
export { default as MessageReceiver } from './receive/MessageReceiver';
export { default as CombinedMessageReceiver } from './receive/CombinedMessageReceiver';
export { default as TranscriptionMessageReceiver } from './receive/TranscriptionMessageReceiver';
export {
  default as ReceivedMessageAggregator,
  type ReceivedMessageAggregatorOptions,
  ReceivedMessageAggregatorEvent,
} from './ReceivedMessageAggregator';
