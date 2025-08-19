import { type SentMessage } from "..";
import MessageSender from "./MessageSender";

/**
  * A `MessageSender` that routes any `SentMessage` to the first underlying `MessageSender` which
  * can accept it.
  */
export default class CombinedMessageSender extends MessageSender {
  private messageSenders: Array<MessageSender>;

  constructor(...messageSenders: Array<MessageSender>) {
    super();
    this.messageSenders = messageSenders;
  }

  async send(message: SentMessage) {
    await Promise.all(this.messageSenders.map(async (sender) => {
      return sender.send(message);
    }));
  }
}
