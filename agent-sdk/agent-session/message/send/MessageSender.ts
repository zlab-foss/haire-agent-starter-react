import { SentMessageOptions, type SentMessage } from "..";

export default abstract class MessageSender {
  abstract send(message: SentMessage, options: SentMessageOptions<SentMessage>): Promise<void>;
}
