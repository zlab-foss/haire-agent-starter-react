import { type SentMessage } from "..";

export default abstract class MessageSender<Message extends SentMessage = SentMessage> {
  abstract send(message: Message): Promise<void>;
}
