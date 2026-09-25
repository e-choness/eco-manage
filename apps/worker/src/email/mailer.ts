import nodemailer from 'nodemailer';

// Outgoing mail. In development everything goes to Mailpit (http://localhost:8025).

export interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  /** Sends one message and returns its Message-ID. Throws if the server refuses it. */
  send(message: Message): Promise<string>;
}

export const createMailer = (smtpUrl: string, from: string): Mailer => {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(message) {
      const info = await transport.sendMail({ from, ...message });
      return info.messageId;
    },
  };
};
